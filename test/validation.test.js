import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  history,
  migrate,
  migrateError,
  migration,
  migrations,
  newObject,
  tableNames,
} from "./helpers.js";

const SQL = "CREATE TABLE notes (id INTEGER);";

// JSON.stringify() throws an error for this object.
const circular = {};
circular.self = circular;

describe("an incorrect list of migrations", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["an object", { 0: migration(1, SQL), length: 1 }],
    ["a string", "migrations"],
  ])("%s causes a TypeError before the database changes", async (_, list) => {
    const object = newObject();

    const error = await migrateError(object, list);

    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toBe("[migrations] The list of migrations must be an array.");
    expect(await tableNames(object)).toEqual([]);
  });

  it.each([
    [
      "a null item",
      [null],
      "[migrations] Item 1 of the list must have version 1. It has version undefined.",
    ],
    [
      "an item without a version",
      [{ name: "create_notes", sql: SQL }],
      "[migrations] Item 1 of the list must have version 1. It has version undefined.",
    ],
    [
      "a list with an empty slot",
      Object.assign([], { 0: migration(1, SQL), 2: migration(3, "SELECT 1;") }),
      "[migrations] Item 2 of the list must have version 2. It has version undefined.",
    ],
    [
      "a version that starts at 0",
      [migration(0, SQL)],
      "[migrations] Item 1 of the list must have version 1. It has version 0.",
    ],
    [
      "a gap in the versions",
      [migration(1, SQL), migration(3, "SELECT 1;")],
      "[migrations] Item 2 of the list must have version 2. It has version 3.",
    ],
    [
      "a duplicate version",
      [migration(1, SQL), migration(1, "SELECT 1;")],
      "[migrations] Item 2 of the list must have version 2. It has version 1.",
    ],
    [
      "versions in the wrong order",
      [migration(2, SQL), migration(1, "SELECT 1;")],
      "[migrations] Item 1 of the list must have version 1. It has version 2.",
    ],
    [
      "a version that is a string",
      [{ version: "1", name: "create_notes", sql: SQL }],
      '[migrations] Item 1 of the list must have version 1. It has version "1".',
    ],
    [
      "a version that is a BigInt",
      [{ version: 1n, name: "create_notes", sql: SQL }],
      "[migrations] Item 1 of the list must have version 1. It has version 1n.",
    ],
    [
      "a version that is NaN",
      [{ version: Number.NaN, name: "create_notes", sql: SQL }],
      "[migrations] Item 1 of the list must have version 1. It has version NaN.",
    ],
    [
      "a version that is Infinity",
      [{ version: Number.POSITIVE_INFINITY, name: "create_notes", sql: SQL }],
      "[migrations] Item 1 of the list must have version 1. It has version Infinity.",
    ],
    [
      "a version that is an object with a circular reference",
      [{ version: circular, name: "create_notes", sql: SQL }],
      "[migrations] Item 1 of the list must have version 1. It has version an object.",
    ],
    [
      "a version that is an array",
      [{ version: [1], name: "create_notes", sql: SQL }],
      "[migrations] Item 1 of the list must have version 1. It has version an object.",
    ],
    [
      "a version that is a function",
      [{ version: () => 1, name: "create_notes", sql: SQL }],
      "[migrations] Item 1 of the list must have version 1. It has version a function.",
    ],
    [
      "an item without a name",
      [{ version: 1, sql: SQL }],
      "[migrations] Migration 1 must have a name.",
    ],
    [
      "an empty name",
      [{ version: 1, name: "", sql: SQL }],
      "[migrations] Migration 1 must have a name.",
    ],
    [
      "a name with only whitespace",
      [{ version: 1, name: " \t\n", sql: SQL }],
      "[migrations] Migration 1 must have a name.",
    ],
    [
      "a name that is not a string",
      [{ version: 1, name: 1, sql: SQL }],
      "[migrations] Migration 1 must have a name.",
    ],
    [
      "an item without SQL",
      [{ version: 1, name: "create_notes" }],
      "[migrations] Migration 1 must have SQL.",
    ],
    [
      "empty SQL",
      [{ version: 1, name: "create_notes", sql: "" }],
      "[migrations] Migration 1 must have SQL.",
    ],
    [
      "SQL with only whitespace",
      [{ version: 1, name: "create_notes", sql: " \t\n" }],
      "[migrations] Migration 1 must have SQL.",
    ],
    [
      "SQL that is not a string",
      [{ version: 1, name: "create_notes", sql: ["CREATE TABLE notes (id INTEGER);"] }],
      "[migrations] Migration 1 must have SQL.",
    ],
    [
      "an incorrect item after correct items",
      [migration(1, SQL), migration(2, "SELECT 1;"), { version: 3, name: "empty", sql: "" }],
      "[migrations] Migration 3 must have SQL.",
    ],
  ])("%s causes an error before the database changes", async (_, list, message) => {
    const object = newObject();

    const error = await migrateError(object, list);

    expect(error.constructor).toBe(Error);
    expect(error.message).toBe(message);
    expect(await tableNames(object)).toEqual([]);
  });

  it("causes an error before a database with migrations changes", async () => {
    const object = newObject();
    await migrate(object, migrations.slice(0, 1));

    const error = await migrateError(object, [migrations[0], migrations[2]]);

    expect(error.message).toBe(
      "[migrations] Item 2 of the list must have version 2. It has version 3.",
    );
    expect(await tableNames(object)).toEqual(["_migrations", "users"]);
    expect(await history(object)).toEqual([[1, "create_users"]]);
  });
});

describe("incorrect options", () => {
  it.each([
    ["null", null],
    ["a string", "quiet"],
    ["a number", 1],
    ["a boolean", true],
    ["a function", () => {}],
  ])("%s causes a TypeError before the database changes", async (_, options) => {
    const object = newObject();

    const error = await migrateError(object, migrations, options);

    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toBe("[migrations] The options must be an object.");
    expect(await tableNames(object)).toEqual([]);
  });

  it.each([
    ["a logger without warn()", { log() {} }],
    ["a logger without log()", { warn() {} }],
    ["a logger with a log property that is not a function", { log: "yes", warn() {} }],
    ["a logger that is a string", "console"],
    ["a logger that is false", false],
    ["a logger that is 0", 0],
    ["a logger that is an empty string", ""],
  ])("%s causes a TypeError before the database changes", async (_, logger) => {
    const object = newObject();

    const error = await migrateError(object, migrations, { logger });

    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toBe(
      "[migrations] The logger must have the functions log() and warn().",
    );
    expect(await tableNames(object)).toEqual([]);
  });
});

describe("the storage", () => {
  it("must be SQLite-backed", async () => {
    const object = newObject(env.KV_OBJECT);

    const error = await migrateError(object, migrations);

    expect(error.message).toMatch(/SQL is not enabled for this Durable Object class/);
  });
});
