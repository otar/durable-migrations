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

// Migration 4 refers to a table that does not exist, so it fails.
const failing = { fill_missing_table: "INSERT INTO missing_table (id) VALUES (1);" };

describe("a migration that fails", () => {
  it("cancels all new migrations and keeps the old version", async () => {
    const object = newObject();
    await migrate(object, take(2));
    const logger = recordingLogger();

    const error = await migrateError(object, { ...migrations, ...failing }, { logger });

    expect(error.message).toMatch(
      /^\[migrations\] Migration 4 \(fill_missing_table\) failed\. The database stays at version 2\. Cause: /,
    );
    expect(await tableNames(object)).not.toContain("products");
    expect(await history(object)).toEqual([
      [1, "create_users"],
      [2, "create_orders"],
    ]);
    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("keeps the error of SQLite as the cause", async () => {
    const object = newObject();
    await migrate(object, take(2));

    const error = await migrateError(object, { ...migrations, ...failing });

    expect(error.constructor).toBe(Error);
    expect(error.cause).toBeInstanceOf(Error);
    expect(error.cause.message).toMatch(/^no such table: missing_table/);
    expect(error.message).toBe(
      "[migrations] Migration 4 (fill_missing_table) failed. " +
        `The database stays at version 2. Cause: ${error.cause.message}`,
    );
  });

  it("removes the table _migrations on a new database", async () => {
    const object = newObject();

    const error = await migrateError(object, {
      ...take(1),
      migration_2: "INSERT INTO missing_table (id) VALUES (1);",
    });

    expect(error.message).toMatch(
      /^\[migrations\] Migration 2 \(migration_2\) failed\. The database stays at version 0\. /,
    );
    expect(await tableNames(object)).toEqual([]);
  });

  it("cancels the statements before the failed statement in the same migration", async () => {
    const object = newObject();
    await migrate(object, take(1));

    const error = await migrateError(object, {
      ...take(1),
      migration_2: `
        CREATE TABLE notes (id INTEGER PRIMARY KEY);
        INSERT INTO users (id, name) VALUES (1, 'Ana');
        INSERT INTO missing_table (id) VALUES (1);
      `,
    });

    expect(error.message).toContain("The database stays at version 1.");
    expect(await tableNames(object)).toEqual(["_migrations", "users"]);
    expect(await query(object, "SELECT * FROM users")).toEqual([]);
    expect(await history(object)).toEqual([[1, "create_users"]]);
  });

  it("runs the migrations again after the list is correct", async () => {
    const object = newObject();
    await migrate(object, take(2));
    await migrateError(object, { ...migrations, ...failing });
    const logger = recordingLogger();

    const version = await migrate(
      object,
      { ...migrations, create_notes: "CREATE TABLE notes (id INTEGER PRIMARY KEY);" },
      { logger },
    );

    expect(version).toBe(4);
    expect(logger.log.mock.calls).toEqual([
      ["[migrations] Migration 3 (create_products) ran."],
      ["[migrations] Migration 4 (create_notes) ran."],
    ]);
    expect(await tableNames(object)).toEqual([
      "_migrations",
      "notes",
      "orders",
      "products",
      "users",
    ]);
  });
});
