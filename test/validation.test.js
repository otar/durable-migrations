import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import * as namespace from "./fixtures/namespace.js";
import {
  history,
  migrate,
  migrateError,
  migrations,
  newObject,
  query,
  recordingLogger,
  tableNames,
  take,
} from "./helpers.js";

const SQL = "CREATE TABLE notes (id INTEGER);";

const AN_ARRAY =
  "[migrations] The list of migrations must be an object, not an array. " +
  "Write each migration as a property, in the same order. " +
  "The key is the name of the migration, and the value is its SQL. Remove the versions. " +
  'See "Upgrade from the copied files" in the README.';

const NOT_AN_OBJECT_LITERAL =
  "[migrations] The list of migrations must be an object literal. " +
  'Do not use a module namespace object ("import * as"), a Map, a class instance, ' +
  "an object without a prototype, or getters. A module namespace object can sort its keys. " +
  "Do not copy it with spread (...) or Object.assign(). " +
  'Import the list by its name, for example import { migrations } from "./migrations.js".';

function notAnObject(type) {
  return (
    "[migrations] The list of migrations must be an object. " +
    `Each key is the name of a migration, and each value is its SQL. It is ${type}.`
  );
}

function onlyDigits(name) {
  return (
    `[migrations] The name "${name}" contains only digits. ` +
    'JavaScript moves keys such as "1" and "42" before all other keys of an object, ' +
    "so the order of the migrations can change. " +
    `Add a letter to the name, for example "m${name}".`
  );
}

function noSql(version, name) {
  return (
    `[migrations] Migration ${version} (${name}) must have SQL. ` +
    "The value must be a string that is not empty and not only white space."
  );
}

// The objects that bundlers make for "import * as" from fixtures/namespace.js.
// Rollup makes a frozen object without a prototype. esbuild (Wrangler) and
// Rolldown make an object with a getter for each export, in sorted order.
const rollupNamespace = Object.freeze({
  __proto__: null,
  add_users_email: namespace.add_users_email,
  create_users: namespace.create_users,
});
const esbuildNamespace = {};
for (const name of ["add_users_email", "create_users"]) {
  Object.defineProperty(esbuildNamespace, name, { get: () => namespace[name], enumerable: true });
}

class MigrationList {
  constructor() {
    this.create_notes = SQL;
  }
}

// Makes a list with a getter or a setter for the key "add_index".
function withAccessor(accessor) {
  const list = { create_notes: SQL };
  Object.defineProperty(list, "add_index", { ...accessor, enumerable: true });
  return list;
}

describe("a list that is not correct", () => {
  it.each([
    ["undefined", undefined, notAnObject("undefined")],
    ["null", null, notAnObject("null")],
    ["a string", "migrations", notAnObject("a string")],
    ["a function", () => ({ create_notes: SQL }), notAnObject("a function")],
    ["an array in the old format", [{ version: 1, name: "create_notes", sql: SQL }], AN_ARRAY],
    ["an empty array", [], AN_ARRAY],
    ["a module namespace object", namespace, NOT_AN_OBJECT_LITERAL],
    ["the object that Rollup makes for import * as", rollupNamespace, NOT_AN_OBJECT_LITERAL],
    ["the object that esbuild makes for import * as", esbuildNamespace, NOT_AN_OBJECT_LITERAL],
    ["an object without a prototype", { __proto__: null, create_notes: SQL }, NOT_AN_OBJECT_LITERAL],
    ["a Map", new Map([["create_notes", SQL]]), NOT_AN_OBJECT_LITERAL],
    ["a class instance", new MigrationList(), NOT_AN_OBJECT_LITERAL],
    ["a getter", withAccessor({ get: () => SQL }), NOT_AN_OBJECT_LITERAL],
    ["a setter", withAccessor({ set() {} }), NOT_AN_OBJECT_LITERAL],
  ])("%s causes a TypeError before the database changes", async (_, list, message) => {
    const object = newObject();

    const error = await migrateError(object, list);

    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toBe(message);
    expect(await tableNames(object)).toEqual([]);
  });

  it.each([
    ["a name with only digits", { create_notes: SQL, 42: "SELECT 1;" }, onlyDigits("42")],
    ["a name with leading zeros", { create_notes: SQL, "007": SQL }, onlyDigits("007")],
    ["an empty name", { create_notes: SQL, "": SQL }, "[migrations] Migration 2 must have a name."],
    ["a name with only whitespace", { " \t\n": SQL }, "[migrations] Migration 1 must have a name."],
    [
      "the name __proto__",
      JSON.parse('{"create_notes": "SELECT 1;", "__proto__": "SELECT 1;"}'),
      '[migrations] Do not use the name "__proto__". ' +
        "In an object literal, JavaScript makes no property for this key, and the migration is lost.",
    ],
    ...[
      ["undefined", undefined],
      ["empty", ""],
      ["only whitespace", " \t\n"],
      ["a number", 1],
      ["an array", [SQL]],
      ["an object with sql", { sql: SQL }],
      ["a function", () => SQL],
    ].map(([type, value]) => [`SQL that is ${type}`, { create_notes: SQL, add_index: value }, noSql(2, "add_index")]),
    ["an incorrect value after correct values", { a: SQL, b: "SELECT 1;", empty: "" }, noSql(3, "empty")],
  ])("%s causes an error before the database changes", async (_, list, message) => {
    const object = newObject();

    const error = await migrateError(object, list);

    expect(error.constructor).toBe(Error);
    expect(error.message).toBe(message);
    expect(await tableNames(object)).toEqual([]);
  });

  it("does not call a getter", async () => {
    const get = vi.fn(() => SQL);

    await migrateError(newObject(), withAccessor({ get }));

    expect(get).not.toHaveBeenCalled();
  });

  it("causes an error before a database with migrations changes", async () => {
    const object = newObject();
    await migrate(object, take(1));

    const error = await migrateError(object, { ...migrations, 4: "SELECT 1;" });

    expect(error.message).toBe(onlyDigits("4"));
    expect(await tableNames(object)).toEqual(["_migrations", "users"]);
    expect(await history(object)).toEqual([[1, "create_users"]]);
  });
});

describe("a correct list", () => {
  it("can be a frozen object", async () => {
    const object = newObject();

    const version = await migrate(object, Object.freeze({ create_notes: SQL }));

    expect(version).toBe(1);
    expect(await history(object)).toEqual([[1, "create_notes"]]);
  });

  it("keeps names with digits that JavaScript does not move in the order of the file", async () => {
    const object = newObject();

    await migrate(object, { "001_create_notes": SQL, "-1": "SELECT 1;", "1.5": "SELECT 1;" });

    expect(await history(object)).toEqual([
      [1, "001_create_notes"],
      [2, "-1"],
      [3, "1.5"],
    ]);
  });

  it("records the position of each key as its version, not the alphabetical order", async () => {
    const object = newObject();

    await migrate(object, { zeta_first: "SELECT 1;", alpha_second: "SELECT 2;" });

    expect(await history(object)).toEqual([
      [1, "zeta_first"],
      [2, "alpha_second"],
    ]);
  });
});

describe("a database from the array format", () => {
  // In the array format, each migration had a version and a name.
  // The version was always the position of the migration in the array.
  it("runs only the new migrations when the keys have the old names in the old order", async () => {
    const object = newObject();
    await query(
      object,
      `CREATE TABLE _migrations (
         version INTEGER PRIMARY KEY, name TEXT NOT NULL,
         applied_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    );
    await query(object, "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
    await query(object, "INSERT INTO _migrations (version, name) VALUES (1, 'create_users')");
    const logger = recordingLogger();

    const version = await migrate(object, take(2), { logger });

    expect(version).toBe(2);
    expect(logger.log.mock.calls).toEqual([["[migrations] Migration 2 (create_orders) ran."]]);
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
