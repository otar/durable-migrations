// Incorrect calls of runMigrations(). Each @ts-expect-error comment applies to
// the next line. If that line has no error, tsc fails.

import { runMigrations } from "durable-migrations";

declare const ctx: DurableObjectState;

const migrations = {
  create_users: "CREATE TABLE users (id INTEGER PRIMARY KEY);",
};

runMigrations(
  // @ts-expect-error ctx is not the storage. Give ctx.storage.
  ctx,
  migrations,
);

runMigrations(
  // @ts-expect-error ctx.storage.sql is not the storage. Give ctx.storage.
  ctx.storage.sql,
  migrations,
);

runMigrations(
  // @ts-expect-error The storage must have transactionSync().
  { sql: ctx.storage.sql },
  migrations,
);

runMigrations(
  // @ts-expect-error The storage must have the property sql.
  { transactionSync: <T>(closure: () => T): T => closure() },
  migrations,
);

// @ts-expect-error The storage must be an object.
runMigrations(null, migrations);

// @ts-expect-error The storage is necessary.
runMigrations(undefined, migrations);

// @ts-expect-error The list must be an object.
runMigrations(ctx.storage, null);

// @ts-expect-error The list is necessary.
runMigrations(ctx.storage, undefined);

runMigrations(
  ctx.storage,
  // @ts-expect-error The list must be an object, not a string.
  "CREATE TABLE users (id INTEGER PRIMARY KEY);",
);

// The list is in a variable, as a list from migrations.js.
const numberValue = {
  create_users: "CREATE TABLE users (id INTEGER PRIMARY KEY);",
  add_users_email: 1,
};
runMigrations(
  ctx.storage,
  // @ts-expect-error Each value must be a string.
  numberValue,
);

runMigrations(
  ctx.storage,
  // @ts-expect-error The list must be an object, not an array.
  ["CREATE TABLE users (id INTEGER PRIMARY KEY);"],
);

// The list of the copied files is an array of objects.
const copiedList = [
  { version: 1, name: "create_users", sql: "CREATE TABLE users (id INTEGER PRIMARY KEY);" },
];
runMigrations(
  ctx.storage,
  // @ts-expect-error The list must be an object, not an array.
  copiedList,
);

runMigrations(ctx.storage, migrations, {
  // @ts-expect-error The logger must have the function warn().
  logger: { log() {} },
});

runMigrations(ctx.storage, migrations, {
  // @ts-expect-error The logger must have the function log().
  logger: { warn() {} },
});

runMigrations(
  ctx.storage,
  migrations,
  // @ts-expect-error The options must be an object.
  "verbose",
);

// @ts-expect-error The options must be an object, not null.
runMigrations(ctx.storage, migrations, null);

// @ts-expect-error The list of migrations is necessary.
runMigrations(ctx.storage);
