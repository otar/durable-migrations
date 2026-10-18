import { describe, expect, it } from "vitest";
import {
  history,
  migrate,
  migrateError,
  migration,
  migrations,
  newObject,
  query,
  recordingLogger,
  tableNames,
} from "./helpers.js";

describe("a database with a higher version than the list", () => {
  // This occurs after a rollback of a deployment.
  it("writes one warning, runs no migration, and returns the version of the database", async () => {
    const object = newObject();
    await migrate(object, migrations.slice(0, 2));
    const logger = recordingLogger();

    const version = await migrate(object, migrations.slice(0, 1), { logger });

    expect(version).toBe(2);
    expect(logger.warn.mock.calls).toEqual([
      [
        "[migrations] The database is at version 2. " +
          "The code has migrations only up to version 1. No migration ran.",
      ],
    ]);
    expect(logger.log).not.toHaveBeenCalled();
    expect(await history(object)).toEqual([
      [1, "create_users"],
      [2, "create_orders"],
    ]);
  });

  it("writes one warning for an empty list", async () => {
    const object = newObject();
    await migrate(object, migrations.slice(0, 2));
    const logger = recordingLogger();

    const version = await migrate(object, [], { logger });

    expect(version).toBe(2);
    expect(logger.warn.mock.calls).toEqual([
      [
        "[migrations] The database is at version 2. " +
          "The code has migrations only up to version 0. No migration ran.",
      ],
    ]);
    expect(logger.log).not.toHaveBeenCalled();
    expect(await history(object)).toHaveLength(2);
  });

  it("runs only the missing migrations when the code has them again", async () => {
    const object = newObject();
    await migrate(object, migrations.slice(0, 2));
    await migrate(object, migrations.slice(0, 1));
    const logger = recordingLogger();

    const version = await migrate(object, migrations, { logger });

    expect(version).toBe(3);
    expect(logger.log.mock.calls).toEqual([["[migrations] Migration 3 (create_products) ran."]]);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe("the name check", () => {
  it("throws before a migration runs when a migration that ran has a different name", async () => {
    const object = newObject();
    await migrate(object, migrations.slice(0, 2));
    const renamed = { ...migrations[0], name: "create_people" };
    const logger = recordingLogger();

    const error = await migrateError(object, [renamed, migrations[1], migrations[2]], { logger });

    expect(error.constructor).toBe(Error);
    expect(error.message).toBe(
      '[migrations] Migration 1 ran with the name "create_users". ' +
        'The list has the name "create_people" for version 1. ' +
        "Do not change, move, or remove a deployed migration. " +
        "Give version 1 its old name, and add your change as a new migration.",
    );
    expect(await tableNames(object)).not.toContain("products");
    expect(await history(object)).toEqual([
      [1, "create_users"],
      [2, "create_orders"],
    ]);
    expect(logger.log).not.toHaveBeenCalled();
  });

  it("throws the name error before a new migration can fail", async () => {
    const object = newObject();
    await migrate(object, migrations.slice(0, 2));
    const renamed = { ...migrations[0], name: "create_people" };
    const failing = migration(3, "INSERT INTO missing_table (id) VALUES (1);", "fill_missing_table");

    const error = await migrateError(object, [renamed, migrations[1], failing]);

    expect(error.message).toMatch(/^\[migrations\] Migration 1 ran with the name/);
    expect(error.cause).toBeUndefined();
    expect(await history(object)).toEqual([
      [1, "create_users"],
      [2, "create_orders"],
    ]);
  });

  it("throws when the latest migration that ran has a different name", async () => {
    const object = newObject();
    await migrate(object, migrations.slice(0, 2));
    const renamed = { ...migrations[1], name: "create_purchases" };

    const error = await migrateError(object, [migrations[0], renamed]);

    expect(error.message).toMatch(
      /^\[migrations\] Migration 2 ran with the name "create_orders"\. The list has the name "create_purchases" for version 2\. /,
    );
    expect(await history(object)).toEqual([
      [1, "create_users"],
      [2, "create_orders"],
    ]);
  });

  it("throws when a different migration takes the place of a migration that ran", async () => {
    const object = newObject();
    await migrate(object, migrations);
    const replaced = migration(3, "CREATE TABLE invoices (id INTEGER PRIMARY KEY);", "create_invoices");

    const error = await migrateError(object, [migrations[0], migrations[1], replaced]);

    expect(error.message).toMatch(/^\[migrations\] Migration 3 ran with the name "create_products"\. /);
    expect(await tableNames(object)).not.toContain("invoices");
  });

  it("throws when the database has a higher version and a name in the list is different", async () => {
    const object = newObject();
    await migrate(object, migrations);
    const renamed = { ...migrations[0], name: "create_people" };
    const logger = recordingLogger();

    const error = await migrateError(object, [renamed], { logger });

    expect(error.message).toMatch(/^\[migrations\] Migration 1 ran with the name "create_users"\. /);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("ignores the rows with a version higher than the list", async () => {
    const object = newObject();
    await migrate(object, migrations);
    const logger = recordingLogger();

    const version = await migrate(object, migrations.slice(0, 2), { logger });

    expect(version).toBe(3);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});

describe("a gap in the history", () => {
  // Migrations 2 and 3 add their version to the table "runs".
  // Thus the table shows how many times each of them ran.
  const counted = [
    migration(1, "CREATE TABLE runs (version INTEGER NOT NULL);"),
    migration(2, "INSERT INTO runs (version) VALUES (2);"),
    migration(3, "INSERT INTO runs (version) VALUES (3);"),
  ];

  async function runs(object) {
    const rows = await query(object, "SELECT version FROM runs ORDER BY rowid");
    return rows.map((row) => row.version);
  }

  it("runs the latest migration again when its row is missing", async () => {
    const object = newObject();
    await migrate(object, counted);
    await query(object, "DELETE FROM _migrations WHERE version = 3");
    const logger = recordingLogger();

    const version = await migrate(object, counted, { logger });

    expect(version).toBe(3);
    expect(logger.log.mock.calls).toEqual([["[migrations] Migration 3 (migration_3) ran."]]);
    expect(await runs(object)).toEqual([2, 3, 3]);
    expect(await history(object)).toEqual([
      [1, "migration_1"],
      [2, "migration_2"],
      [3, "migration_3"],
    ]);
  });

  it("uses the highest version as the current version when an earlier row is missing", async () => {
    const object = newObject();
    await migrate(object, counted);
    await query(object, "DELETE FROM _migrations WHERE version = 2");
    const logger = recordingLogger();

    const version = await migrate(object, counted, { logger });

    expect(version).toBe(3);
    expect(logger.log).not.toHaveBeenCalled();
    expect(await runs(object)).toEqual([2, 3]);
    expect(await history(object)).toEqual([
      [1, "migration_1"],
      [3, "migration_3"],
    ]);
  });
});
