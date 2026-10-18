// Helpers for the tests. Each test uses its own object,
// so the tests do not share a database.

import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { vi } from "vitest";
import { runMigrations } from "../src/index.js";

// Gets a new object with an empty database.
export function newObject(namespace = env.SQLITE_OBJECT) {
  return namespace.get(namespace.newUniqueId());
}

// Makes a logger that records each call and writes nothing.
export function recordingLogger() {
  return { log: vi.fn(), warn: vi.fn() };
}

// Runs runMigrations() inside the object and returns the result.
// If runMigrations() throws, the promise rejects with the same error.
export function migrate(object, migrations, options = { logger: recordingLogger() }) {
  return runInDurableObject(object, (instance, state) =>
    runMigrations(state.storage, migrations, options),
  );
}

// Runs runMigrations() inside the object and returns the error that it throws.
// If runMigrations() does not throw, the promise rejects.
export async function migrateError(object, migrations, options) {
  try {
    await migrate(object, migrations, options);
  } catch (error) {
    return error;
  }
  throw new Error("runMigrations() did not throw.");
}

// Runs SQL inside the object and returns all rows.
export function query(object, sql, ...bindings) {
  return runInDurableObject(object, (instance, state) =>
    state.storage.sql.exec(sql, ...bindings).toArray(),
  );
}

// Returns the names of all tables in the database, in alphabetical order.
export async function tableNames(object) {
  const rows = await query(
    object,
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  );
  return rows.map((row) => row.name);
}

// Returns the rows of _migrations as [version, name] pairs.
export async function history(object) {
  const rows = await query(object, "SELECT version, name FROM _migrations ORDER BY version");
  return rows.map((row) => [row.version, row.name]);
}

// A list of migrations for the tests. Each migration creates one table.
export const migrations = [
  {
    version: 1,
    name: "create_users",
    sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);",
  },
  {
    version: 2,
    name: "create_orders",
    sql: `
      CREATE TABLE orders (
        id      INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users (id),
        total   INTEGER NOT NULL
      );
      CREATE INDEX orders_user_id ON orders (user_id);
    `,
  },
  {
    version: 3,
    name: "create_products",
    sql: "CREATE TABLE products (id INTEGER PRIMARY KEY, title TEXT NOT NULL);",
  },
];

// Makes a migration with the version and the SQL that the test needs.
export function migration(version, sql, name = `migration_${version}`) {
  return { version, name, sql };
}
