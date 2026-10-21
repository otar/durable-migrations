// These tests rebuild the table "users". The table "orders" refers to "users"
// with a foreign key. The tests also show the foreign key check that the
// runner does after the new migrations.

import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../src/index.js";
import {
  history,
  migrate,
  migrateError,
  newObject,
  query,
  recordingLogger,
  tableNames,
} from "./helpers.js";

// Makes the two tables. If the argument is an ON DELETE action, the foreign key gets it.
function schema(onDelete) {
  const action = onDelete ? ` ${onDelete}` : "";
  return {
    create_users: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT);",
    create_orders: `CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users (id)${action});`,
  };
}

const SCHEMA = schema();

const HISTORY = [
  [1, "create_users"],
  [2, "create_orders"],
];

const USERS = [
  { id: 1, name: "Ana", email: "ana@example.com" },
  { id: 2, name: "Ben", email: "ben@example.com" },
];

const ORDERS = [
  { id: 10, user_id: 1 },
  { id: 11, user_id: 2 },
  { id: 12, user_id: 2 },
];

const FOREIGN_KEY_ERROR =
  "[migrations] The new migrations left rows that break a foreign key in these tables: orders. " +
  "The database stays at version 2.";

// The rebuild order of docs/rebuild-a-table.md. It copies "users" to "users_old" first.
// The rebuild makes "name" NOT NULL with a CHECK, and makes "email" unique.
const COPY_USERS = {
  rebuild_users: `
    PRAGMA defer_foreign_keys = ON;
    CREATE TABLE users_old AS SELECT * FROM users;
    DROP TABLE users;
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL CHECK (length(name) > 0), email TEXT);
    INSERT INTO users (id, name, email) SELECT id, name, email FROM users_old;
    DROP TABLE users_old;
    CREATE UNIQUE INDEX users_email ON users (email);
  `,
};

// This order also copies "orders". DROP TABLE users runs the ON DELETE action
// of "orders". Then the copy puts the old rows of "orders" back.
const COPY_USERS_AND_ORDERS = {
  rebuild_users: `
    PRAGMA defer_foreign_keys = ON;
    CREATE TABLE users_old AS SELECT * FROM users;
    CREATE TABLE orders_old AS SELECT * FROM orders;
    DROP TABLE users;
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL CHECK (length(name) > 0), email TEXT);
    INSERT INTO users (id, name, email) SELECT id, name, email FROM users_old;
    DELETE FROM orders;
    INSERT INTO orders SELECT * FROM orders_old;
    DROP TABLE orders_old;
    DROP TABLE users_old;
  `,
};

// This order makes the new table first, and gives it the old name at the end.
const RENAME_NEW_TABLE = `
  CREATE TABLE users_new (id INTEGER PRIMARY KEY, name TEXT NOT NULL CHECK (length(name) > 0), email TEXT);
  INSERT INTO users_new (id, name, email) SELECT id, name, email FROM users;
  DROP TABLE users;
  ALTER TABLE users_new RENAME TO users;
`;

// Gets a new object with the two tables and with rows in each table.
async function newObjectWithData(list = SCHEMA) {
  const object = newObject();
  await migrate(object, list);
  await query(
    object,
    "INSERT INTO users (id, name, email) VALUES (1, 'Ana', 'ana@example.com'), (2, 'Ben', 'ben@example.com')",
  );
  await query(object, "INSERT INTO orders (id, user_id) VALUES (10, 1), (11, 2), (12, 2)");
  return object;
}

function users(object) {
  return query(object, "SELECT id, name, email FROM users ORDER BY id");
}

function orders(object) {
  return query(object, "SELECT id, user_id FROM orders ORDER BY id");
}

// Returns the SQL that created the table.
async function tableSql(object, name) {
  const [row] = await query(object, "SELECT sql FROM sqlite_master WHERE name = ?", name);
  return row.sql;
}

// Runs the migrations with a storage that records the SQL of each sql.exec() call.
// Returns the recorded SQL.
function migrateAndRecordSql(object, list) {
  return runInDurableObject(object, (instance, state) => {
    const statements = [];
    const storage = {
      sql: {
        exec(sql, ...bindings) {
          statements.push(sql);
          return state.storage.sql.exec(sql, ...bindings);
        },
      },
      transactionSync: (closure) => state.storage.transactionSync(closure),
    };
    runMigrations(storage, list, { logger: recordingLogger() });
    return statements;
  });
}

// Returns how many times the recorded SQL runs PRAGMA foreign_key_check.
function foreignKeyChecks(statements) {
  return statements.filter((sql) => /foreign_key_check/i.test(sql)).length;
}

// Runs the migrations, and reads PRAGMA defer_foreign_keys in the same call.
// Cloudflare writes the changes only after the call, so the pragma still has
// the value that the runner left.
function migrateAndReadPragma(object, list) {
  return runInDurableObject(object, (instance, state) => {
    const version = runMigrations(state.storage, list, { logger: recordingLogger() });
    const pragma = state.storage.sql.exec("PRAGMA defer_foreign_keys").one();
    return { version, deferForeignKeys: pragma.defer_foreign_keys };
  });
}

describe("a table rebuild", () => {
  it("keeps the rows and the foreign keys when it copies the table first", async () => {
    const object = await newObjectWithData();

    const result = await migrateAndReadPragma(object, { ...SCHEMA, ...COPY_USERS });

    expect(result).toEqual({ version: 3, deferForeignKeys: 0 });
    expect(await tableNames(object)).toEqual(["_migrations", "orders", "users"]);
    expect(await users(object)).toEqual(USERS);
    expect(await orders(object)).toEqual(ORDERS);
    expect(await query(object, "PRAGMA foreign_key_check")).toEqual([]);
    expect(await tableSql(object, "orders")).toMatch(/REFERENCES users \(id\)/);

    await expect(query(object, "INSERT INTO users (id, name) VALUES (3, '')")).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await expect(query(object, "INSERT INTO orders (id, user_id) VALUES (13, 99)")).rejects.toThrow(
      /FOREIGN KEY constraint failed/,
    );
  });

  it("can give the new table the old name at the end when PRAGMA defer_foreign_keys is on", async () => {
    const object = await newObjectWithData();
    const rebuild = { rebuild_users: `PRAGMA defer_foreign_keys = ON;\n${RENAME_NEW_TABLE}` };

    const version = await migrate(object, { ...SCHEMA, ...rebuild });

    expect(version).toBe(3);

    // After the eviction, a new stub starts the object again with the stored database.
    await evictDurableObject(object);
    const stub = env.SQLITE_OBJECT.get(object.id);
    expect(await history(stub)).toEqual([...HISTORY, [3, "rebuild_users"]]);
    expect(await tableNames(stub)).toEqual(["_migrations", "orders", "users"]);
    expect(await users(stub)).toEqual(USERS);
    expect(await orders(stub)).toEqual(ORDERS);
    expect(await query(stub, "PRAGMA foreign_key_check")).toEqual([]);
    expect(await tableSql(stub, "orders")).toMatch(/REFERENCES users \(id\)/);
    expect(await tableSql(stub, "users")).toMatch(/CHECK \(length\(name\) > 0\)/);
  });

  it("fails and changes nothing when it drops a table that other rows refer to and PRAGMA defer_foreign_keys is off", async () => {
    const object = await newObjectWithData();
    const rebuild = { rebuild_users: RENAME_NEW_TABLE };

    const error = await migrateError(object, { ...SCHEMA, ...rebuild });

    expect(error.message).toMatch(
      /^\[migrations\] Migration 3 \(rebuild_users\) failed\. The database stays at version 2\. Cause: FOREIGN KEY constraint failed/,
    );
    expect(await tableNames(object)).toEqual(["_migrations", "orders", "users"]);
    expect(await orders(object)).toEqual(ORDERS);
    expect(await history(object)).toEqual(HISTORY);
  });

  // DROP TABLE runs the ON DELETE actions of "orders", also with PRAGMA defer_foreign_keys = ON.
  // Then PRAGMA foreign_key_check finds no error, and the runner does not find the change.
  it.each([
    ["ON DELETE CASCADE", "deletes", []],
    ["ON DELETE SET NULL", "changes", ORDERS.map((order) => ({ ...order, user_id: null }))],
  ])("with %s %s the rows of the other table when it copies only the rebuilt table", async (
    onDelete,
    _,
    expected,
  ) => {
    const list = schema(onDelete);
    const object = await newObjectWithData(list);

    const version = await migrate(object, { ...list, ...COPY_USERS });

    expect(version).toBe(3);
    expect(await users(object)).toEqual(USERS);
    expect(await orders(object)).toEqual(expected);
    expect(await query(object, "PRAGMA foreign_key_check")).toEqual([]);
  });

  it.each(["ON DELETE CASCADE", "ON DELETE SET NULL"])(
    "with %s keeps the rows of the other table when it also copies that table",
    async (onDelete) => {
      const list = schema(onDelete);
      const object = await newObjectWithData(list);

      const result = await migrateAndReadPragma(object, { ...list, ...COPY_USERS_AND_ORDERS });

      expect(result).toEqual({ version: 3, deferForeignKeys: 0 });
      expect(await tableNames(object)).toEqual(["_migrations", "orders", "users"]);
      expect(await users(object)).toEqual(USERS);
      expect(await orders(object)).toEqual(ORDERS);
      expect(await query(object, "PRAGMA foreign_key_check")).toEqual([]);
      expect(await tableSql(object, "orders")).toContain(`REFERENCES users (id) ${onDelete}`);
    },
  );
});

describe("the foreign key check after the new migrations", () => {
  it("throws and cancels the new migrations when rows break a foreign key", async () => {
    const object = await newObjectWithData();
    const logger = recordingLogger();
    const deleteUsers = { delete_users: "PRAGMA defer_foreign_keys = ON;\nDELETE FROM users;" };

    const error = await migrateError(object, { ...SCHEMA, ...deleteUsers }, { logger });

    expect(error.constructor).toBe(Error);
    expect(error.message).toBe(FOREIGN_KEY_ERROR);
    expect(error.cause).toBeUndefined();
    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(await history(object)).toEqual(HISTORY);
    expect(await users(object)).toEqual(USERS);
    expect(await orders(object)).toEqual(ORDERS);

    // After a reset, each call through the same stub fails. This stub still operates.
    const version = await migrate(object, {
      ...SCHEMA,
      create_notes: "CREATE TABLE notes (id INTEGER PRIMARY KEY);",
    });
    expect(version).toBe(3);
    expect(await history(object)).toEqual([...HISTORY, [3, "create_notes"]]);
  });

  it("names each table one time", async () => {
    const list = {
      ...SCHEMA,
      create_reviews: "CREATE TABLE reviews (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users (id));",
    };
    const object = await newObjectWithData(list);
    await query(object, "INSERT INTO reviews (id, user_id) VALUES (20, 1), (21, 2)");
    const deleteUsers = { delete_users: "PRAGMA defer_foreign_keys = ON;\nDELETE FROM users;" };

    const error = await migrateError(object, { ...list, ...deleteUsers });

    const match = error.message.match(
      /^\[migrations\] The new migrations left rows that break a foreign key in these tables: (.+)\. The database stays at version 3\.$/,
    );
    expect(match[1].split(", ").sort()).toEqual(["orders", "reviews"]);
  });

  it("finds an error that a later migration of the same run makes", async () => {
    // Migration 3 sets the pragma. All new migrations share one transaction,
    // so the pragma also applies to migration 4.
    const object = await newObjectWithData();
    const logger = recordingLogger();
    const orphan = { add_order: "INSERT INTO orders (id, user_id) VALUES (13, 99);" };

    const error = await migrateError(object, { ...SCHEMA, ...COPY_USERS, ...orphan }, { logger });

    expect(error.message).toBe(FOREIGN_KEY_ERROR);
    expect(error.cause).toBeUndefined();
    expect(logger.log).not.toHaveBeenCalled();
    expect(await history(object)).toEqual(HISTORY);
    expect(await tableNames(object)).toEqual(["_migrations", "orders", "users"]);
    expect(await tableSql(object, "users")).not.toContain("CHECK");
    expect(await orders(object)).toEqual(ORDERS);
  });

  // SQLite accepts the name of a pragma in any letter case. The runner must also find it.
  it.each(["PRAGMA defer_foreign_keys", "PRAGMA DEFER_FOREIGN_KEYS", "pragma Defer_Foreign_Keys"])(
    "finds the errors when a migration sets the pragma to OFF again with %s",
    async (pragma) => {
      // PRAGMA defer_foreign_keys = OFF clears the count of errors in SQLite.
      // Without the check, the commit succeeds and keeps the orphan rows.
      const object = await newObjectWithData();
      const deleteUsers = {
        delete_users: `${pragma} = ON;\nDELETE FROM users;\n${pragma} = OFF;`,
      };

      const error = await migrateError(object, { ...SCHEMA, ...deleteUsers });

      expect(error.message).toBe(FOREIGN_KEY_ERROR);
      expect(await history(object)).toEqual(HISTORY);
      expect(await users(object)).toEqual(USERS);
    },
  );

  it("finds the errors when the pragma is ON before the call", async () => {
    // The new migration does not contain defer_foreign_keys.
    // Thus the runner must read the pragma to find the errors.
    const object = await newObjectWithData();
    const deleteUsers = { delete_users: "DELETE FROM users;" };

    const result = await runInDurableObject(object, (instance, state) => {
      state.storage.sql.exec("PRAGMA defer_foreign_keys = ON");
      let message;
      try {
        runMigrations(state.storage, { ...SCHEMA, ...deleteUsers }, { logger: recordingLogger() });
      } catch (error) {
        message = error.message;
      }
      const pragma = state.storage.sql.exec("PRAGMA defer_foreign_keys").one();
      return { message, deferForeignKeys: pragma.defer_foreign_keys };
    });

    expect(result).toEqual({ message: FOREIGN_KEY_ERROR, deferForeignKeys: 0 });
    expect(await history(object)).toEqual(HISTORY);
    expect(await users(object)).toEqual(USERS);
    expect(await orders(object)).toEqual(ORDERS);
  });

  it.each([
    ["rows break a foreign key", { migration_3: "PRAGMA defer_foreign_keys = ON;\nDELETE FROM users;" }],
    ["a later migration fails", { migration_3: "PRAGMA defer_foreign_keys = ON;", migration_4: "DELETE FROM missing_table;" }],
  ])("sets the pragma to OFF after an error when %s", async (title, newMigrations) => {
    // After the error, a write that breaks a foreign key must fail at once.
    // If the pragma stays on, the write fails only at the commit, and Cloudflare resets the object.
    const object = await newObjectWithData();

    const result = await runInDurableObject(object, (instance, state) => {
      let message;
      try {
        runMigrations(state.storage, { ...SCHEMA, ...newMigrations }, { logger: recordingLogger() });
      } catch (error) {
        message = error.message;
      }
      const pragma = state.storage.sql.exec("PRAGMA defer_foreign_keys").one();
      let writeError;
      try {
        state.storage.sql.exec("INSERT INTO orders (id, user_id) VALUES (99, 999)");
      } catch (error) {
        writeError = error.message;
      }
      return { message, deferForeignKeys: pragma.defer_foreign_keys, writeError };
    });

    expect(result.message).toMatch(/^\[migrations\] /);
    expect(result.deferForeignKeys).toBe(0);
    expect(result.writeError).toMatch(/^FOREIGN KEY constraint failed/);
    expect(await history(object)).toEqual(HISTORY);
    expect(await orders(object)).toEqual(ORDERS);
  });

  it("throws with the cause when the check fails", async () => {
    // A foreign key must refer to a primary key or to a column with a unique index.
    // "users.email" has no unique index, so PRAGMA foreign_key_check fails.
    const object = await newObjectWithData();
    const createTags = {
      create_tags:
        "PRAGMA defer_foreign_keys = ON;\n" +
        "CREATE TABLE tags (id INTEGER PRIMARY KEY, user_email TEXT REFERENCES users (email));",
    };

    const error = await migrateError(object, { ...SCHEMA, ...createTags });

    expect(error.constructor).toBe(Error);
    expect(error.cause.message).toMatch(/^foreign key mismatch - "tags" referencing "users"/);
    expect(error.message).toBe(
      "[migrations] The foreign key check after the new migrations failed. " +
        `The database stays at version 2. Cause: ${error.cause.message}`,
    );
    expect(await tableNames(object)).toEqual(["_migrations", "orders", "users"]);
    expect(await history(object)).toEqual(HISTORY);
  });
});

describe("the SQL that the runner runs", () => {
  it("runs only two statements at a start without new migrations", async () => {
    const object = await newObjectWithData();

    const statements = await migrateAndRecordSql(object, SCHEMA);

    expect(statements).toHaveLength(2);
  });

  it("does not run PRAGMA foreign_key_check when PRAGMA defer_foreign_keys is OFF and no new migration contains defer_foreign_keys", async () => {
    const statements = await migrateAndRecordSql(newObject(), SCHEMA);

    expect(foreignKeyChecks(statements)).toBe(0);
  });

  it("runs PRAGMA foreign_key_check one time when a new migration contains defer_foreign_keys", async () => {
    const object = await newObjectWithData();

    const statements = await migrateAndRecordSql(object, { ...SCHEMA, ...COPY_USERS });

    expect(foreignKeyChecks(statements)).toBe(1);
    expect(await history(object)).toEqual([...HISTORY, [3, "rebuild_users"]]);
  });
});
