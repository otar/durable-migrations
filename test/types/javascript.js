// @ts-check

// A JavaScript file with "// @ts-check", as migrations.js in the README.
// tsc reads the types of the package also for this file.

import { runMigrations } from "durable-migrations";

/** @type {Record<string, string>} */
const migrations = {
  create_users: "CREATE TABLE users (id INTEGER PRIMARY KEY);",
};

/**
 * @param {DurableObjectState} ctx
 * @returns {number}
 */
export function migrate(ctx) {
  return runMigrations(ctx.storage, migrations);
}

/** @param {DurableObjectState} ctx */
export function migrateWithError(ctx) {
  // @ts-expect-error ctx is not the storage. Give ctx.storage.
  runMigrations(ctx, migrations);
}
