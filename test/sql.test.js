import { describe, expect, it } from "vitest";
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

const HINT =
  " The SQL must end with a statement. Remove comments and extra semicolons after the last statement.";

describe("the SQL of a migration", () => {
  it("can contain more than one statement", async () => {
    const object = newObject();

    const version = await migrate(object, {
      create_notes: `
        CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT NOT NULL);
        CREATE INDEX notes_text ON notes (text);
        INSERT INTO notes (id, text) VALUES (1, 'first');
        INSERT INTO notes (id, text) VALUES (2, 'second');
      `,
    });

    expect(version).toBe(1);
    expect(await query(object, "SELECT id, text FROM notes ORDER BY id")).toEqual([
      { id: 1, text: "first" },
      { id: 2, text: "second" },
    ]);
    expect(
      await query(object, "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'notes_text'"),
    ).toEqual([{ name: "notes_text" }]);
  });

  it.each([
    ["trailing whitespace", "CREATE TABLE notes (id INTEGER);\n\n  \t\n"],
    ["no semicolon after the last statement", "CREATE TABLE notes (id INTEGER)"],
    ["a comment before the first statement", "-- The notes.\nCREATE TABLE notes (id INTEGER);"],
    ["a block comment before the first statement", "/* The notes. */\nCREATE TABLE notes (id INTEGER);"],
    [
      "a comment between statements",
      "CREATE TABLE notes (id INTEGER);\n-- An index.\nCREATE INDEX notes_id ON notes (id);",
    ],
    [
      "an empty statement between statements",
      "CREATE TABLE notes (id INTEGER);;\nCREATE INDEX notes_id ON notes (id);",
    ],
    [
      "a comment after the last statement without a semicolon",
      "CREATE TABLE notes (id INTEGER) -- The notes.",
    ],
  ])("can have %s", async (_, sql) => {
    const object = newObject();

    const version = await migrate(object, { create_notes: sql });

    expect(version).toBe(1);
    expect(await tableNames(object)).toEqual(["_migrations", "notes"]);
    expect(await history(object)).toEqual([[1, "create_notes"]]);
  });

  it.each([
    ["a comment after the last statement", "CREATE TABLE notes (id INTEGER);\n-- The end."],
    ["a block comment after the last statement", "CREATE TABLE notes (id INTEGER);\n/* The end. */"],
    ["two semicolons after the last statement", "CREATE TABLE notes (id INTEGER);;"],
    ["a semicolon on a new line after the last statement", "CREATE TABLE notes (id INTEGER);\n ;"],
    ["only a comment", "-- Disabled."],
  ])("fails with a hint when it has %s", async (_, sql) => {
    const object = newObject();

    const error = await migrateError(object, { create_notes: sql });

    expect(error.cause.message).toContain("SQL code did not contain a statement");
    expect(error.message).toBe(
      "[migrations] Migration 1 (create_notes) failed. The database stays at version 0. " +
        `Cause: ${error.cause.message}${HINT}`,
    );
    expect(await tableNames(object)).toEqual([]);
  });

  it("fails without the hint for a different SQL error", async () => {
    const object = newObject();

    const error = await migrateError(object, {
      index_orders: "CREATE INDEX orders_user_id ON orders (user_id);",
    });

    expect(error.cause.message).toMatch(/no such table/);
    expect(error.message).toBe(
      "[migrations] Migration 1 (index_orders) failed. The database stays at version 0. " +
        `Cause: ${error.cause.message}`,
    );
    expect(error.message).not.toContain("The SQL must end with a statement.");
    expect(error.message).not.toContain("Remove comments");
  });

  it("fails when the last statement fails at a later row", async () => {
    const object = newObject();

    // The first row is correct. The second row has JSON that is not correct.
    const error = await migrateError(object, {
      create_notes:
        "CREATE TABLE notes (id INTEGER);\n" +
        "SELECT CASE WHEN value = 2 THEN json('not json') ELSE value END FROM json_each('[1,2]');",
    });

    expect(error.message).toMatch(
      /^\[migrations\] Migration 1 \(.*\) failed\. The database stays at version 0\. Cause: malformed JSON/,
    );
    expect(await tableNames(object)).toEqual([]);
  });

  // The runner reads all rows of the last statement, but it does not keep them in memory.
  it("can end with a statement that returns many rows", async () => {
    const object = newObject();

    const version = await migrate(object, {
      create_notes: `
        CREATE TABLE notes (id INTEGER);
        WITH RECURSIVE numbers (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 200000)
        SELECT n, 'row' AS payload FROM numbers;
      `,
    });

    expect(version).toBe(1);
    expect(await tableNames(object)).toEqual(["_migrations", "notes"]);
    expect(await history(object)).toEqual([[1, "create_notes"]]);
  }, 30_000);

  it.each([
    ["BEGIN", "BEGIN;\nCREATE TABLE notes (id INTEGER);\nCOMMIT;"],
    ["BEGIN TRANSACTION", "BEGIN TRANSACTION;\nCREATE TABLE notes (id INTEGER);\nCOMMIT;"],
    ["COMMIT", "CREATE TABLE notes (id INTEGER);\nCOMMIT;"],
    ["SAVEPOINT", "SAVEPOINT before_notes;\nCREATE TABLE notes (id INTEGER);\nRELEASE before_notes;"],
  ])("fails and changes nothing when it contains %s", async (_, sql) => {
    const object = newObject();
    await migrate(object, take(1));

    const error = await migrateError(object, { ...take(1), migration_2: sql });

    expect(error.message).toMatch(
      /^\[migrations\] Migration 2 \(migration_2\) failed\. The database stays at version 1\. Cause: To execute a transaction, please use the state\.storage\.transaction\(\) or state\.storage\.transactionSync\(\) APIs/,
    );
    expect(await tableNames(object)).toEqual(["_migrations", "users"]);
    expect(await history(object)).toEqual([[1, "create_users"]]);
  });
});

describe("a migration that changes the table _migrations", () => {
  it.each([
    ["drops", "DROP TABLE _migrations;"],
    ["renames", "ALTER TABLE _migrations RENAME TO old_migrations;"],
  ])("fails and changes nothing when it %s the table", async (_, sql) => {
    const object = newObject();
    await migrate(object, take(1));

    const error = await migrateError(object, { ...take(1), change_history: sql });

    expect(error.message).toMatch(
      /^\[migrations\] Migration 2 \(change_history\) failed\. The database stays at version 1\. Cause: no such table: _migrations/,
    );
    expect(error.cause).toBeInstanceOf(Error);
    expect(await tableNames(object)).toEqual(["_migrations", "users"]);
    expect(await history(object)).toEqual([[1, "create_users"]]);
  });

  it("fails and changes nothing when it adds its own row", async () => {
    const object = newObject();

    const error = await migrateError(object, {
      create_notes:
        "CREATE TABLE notes (id INTEGER);\n" +
        "INSERT INTO _migrations (version, name) VALUES (1, 'create_notes');",
    });

    expect(error.message).toMatch(
      /^\[migrations\] Migration 1 \(create_notes\) failed\. The database stays at version 0\. Cause: UNIQUE constraint failed/,
    );
    expect(await tableNames(object)).toEqual([]);
  });
});

// Other code can make a table, a view, or an index with the name _migrations.
// If a table or a view does not have the columns version and name, the runner
// cannot read it.
describe("_migrations from other code", () => {
  // Returns the type, the name, and the SQL of each table, index, and view.
  function schema(object) {
    return query(object, "SELECT type, name, sql FROM sqlite_master ORDER BY name");
  }

  it.each([
    [
      "a table without the column version",
      "CREATE TABLE _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL);\n" +
        "INSERT INTO _migrations (id, name) VALUES (1, 'init');",
      "version",
    ],
    [
      "a table without the column name",
      "CREATE TABLE _migrations (version INTEGER PRIMARY KEY, title TEXT NOT NULL);\n" +
        "INSERT INTO _migrations (version, title) VALUES (1, 'init');",
      "name",
    ],
    ["a view", "CREATE VIEW _migrations AS SELECT 1 AS id, 'init' AS title;", "version"],
  ])("causes an error and changes nothing when it is %s", async (_, sql, column) => {
    const object = newObject();
    await query(object, sql);
    const before = await schema(object);
    const rows = await query(object, "SELECT * FROM _migrations");
    const logger = recordingLogger();

    const error = await migrateError(object, migrations, { logger });

    expect(error.constructor).toBe(Error);
    expect(error.cause).toBeInstanceOf(Error);
    expect(error.cause.message).toMatch(new RegExp(`^no such column: ${column}`));
    expect(error.message).toBe(
      "[migrations] The runner cannot read the table _migrations. " +
        `Make sure that no other code uses this table name. Cause: ${error.cause.message}`,
    );
    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(await schema(object)).toEqual(before);
    expect(await query(object, "SELECT * FROM _migrations")).toEqual(rows);
  });

  // An index stops the CREATE of the runner. The runner does not change the
  // error of SQLite. See "Errors and warnings" in docs/api.md.
  it("keeps the error of SQLite when it is an index", async () => {
    const object = newObject();
    await query(object, "CREATE TABLE notes (id INTEGER);\nCREATE INDEX _migrations ON notes (id);");

    const error = await migrateError(object, migrations);

    expect(error.message).toMatch(/^there is already an index named _migrations/);
    expect(await tableNames(object)).toEqual(["notes"]);
  });
});
