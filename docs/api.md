# API

The package exports one function, `runMigrations()`. The documentation calls this function "the runner". The package also exports TypeScript types. See [TypeScript](typescript.md).

```js
runMigrations(storage, migrations, options?)
```

The runner runs the migrations that did not run on the object before. It is synchronous, and it returns the database version.

## Parameters

- `storage`: the `ctx.storage` of the Durable Object. Do not give `ctx` or `ctx.storage.sql`. The class of the object must be SQLite-backed (`new_sqlite_classes`).
- `migrations`: an object with all migrations, in order. Each key is the name of a migration, and each value is its SQL:
  - The version of a migration is its position in the list. The first key is version 1, the second key is version 2, and more.
  - The name is a string that is not empty and not only white space. It must not contain only digits, and it must not be `__proto__`. The runner records the name in `_migrations` and compares it at each start.
  - The SQL is a string that is not empty and not only white space. It can contain more than one statement.
  - The list must be an object literal. Import it by its name, for example `import { migrations } from "./migrations.js"`. See [Names and order](writing-migrations.md#names-and-order).
- `options` (optional): an object with this property:
  - `logger` (optional): an object with the functions `log(message)` and `warn(message)`. The default is `console`. The runner ignores errors from these functions.

## Logger

The runner calls `logger.log()` one time for each migration that ran. These calls occur after `transactionSync()` returns. Cloudflare writes the changes when the `blockConcurrencyWhile()` callback completes. Example:

```
[migrations] Migration 2 (add_users_email) ran.
```

If the runner throws an error, it writes no log line.

If the database version is higher than the last version in the list, the runner calls `logger.warn()`. See [Errors and warnings](#errors-and-warnings).

The runner ignores errors from the logger. Thus a logger error does not stop the object. If a function of the logger returns a promise, the runner does not wait for it. The runner also ignores a rejection of this promise.

To send the lines to your own logger, give an object with the functions `log()` and `warn()`:

```js
runMigrations(ctx.storage, migrations, {
  logger: {
    log: (message) => console.log(JSON.stringify({ level: "info", message })),
    warn: (message) => console.warn(JSON.stringify({ level: "warn", message })),
  },
});
```

To write no lines, give functions that do nothing:

```js
runMigrations(ctx.storage, migrations, { logger: { log() {}, warn() {} } });
```

If the logger writes no lines, you do not see the warning.

## Return value

The runner returns the database version after the call:

- If the database version is higher than the last version in the list, the runner returns the database version.
- In all other conditions, it returns the last version in the list. For an empty list (`{}`), this is 0.

## Errors and warnings

The runner throws an error in these conditions. Each message starts with `[migrations]`.

- **The storage is not correct.** If `storage` is not an object, the runner throws a `TypeError`. If `storage` does not have the function `transactionSync()`, or if it does not have the property `sql`, the runner also throws a `TypeError`. Examples are `ctx` and `ctx.storage.sql`. The message is: `[migrations] The storage must be ctx.storage, the storage of the Durable Object. Do not give ctx or ctx.storage.sql.` The storage of a class without SQLite passes this check. For this storage, the error from Cloudflare starts with `SQL is not enabled for this Durable Object class.`
- **The list is not correct.** The runner finds these errors before it changes the database:
  - If `migrations` is not an object, the runner throws a `TypeError`. The message gives the type. Example: `[migrations] The list of migrations must be an object. Each key is the name of a migration, and each value is its SQL. It is undefined.`
  - If `migrations` is an array, the runner throws a `TypeError`. This also applies to an empty array. The message tells you how to change the list: `[migrations] The list of migrations must be an object, not an array. Write each migration as a property, in the same order. The key is the name of the migration, and the value is its SQL. Remove the versions. See "Upgrade from the copied files" in the README.` See [Upgrade from the copied files](upgrade-from-copied-files.md).
  - If the prototype of `migrations` is not `Object.prototype`, or if `migrations` has a getter or a setter, the runner throws a `TypeError`. Examples are a module namespace object from `import * as`, a `Map`, a class instance, and an object without a prototype. The message is: `[migrations] The list of migrations must be an object literal. Do not use a module namespace object ("import * as"), a Map, a class instance, an object without a prototype, or getters. A module namespace object can sort its keys. Do not copy it with spread (...) or Object.assign(). Import the list by its name, for example import { migrations } from "./migrations.js".`
  - If a name contains only digits, the runner throws an `Error`. The message gives no position. Example: `[migrations] The name "42" contains only digits. JavaScript moves keys such as "1" and "42" before all other keys of an object, so the order of the migrations can change. Add a letter to the name, for example "m42".`
  - If a name is empty or only white space, the runner throws an `Error`. Example: `[migrations] Migration 2 must have a name.`
  - If the list has a property with the name `__proto__`, for example from `JSON.parse()`, the runner throws an `Error`: `[migrations] Do not use the name "__proto__". In an object literal, JavaScript makes no property for this key, and the migration is lost.`
  - If a value is not a string, or if it is empty or only white space, the runner throws an `Error`. Example: `[migrations] Migration 2 (add_users_email) must have SQL. The value must be a string that is not empty and not only white space.`
- **The options are not correct.** If `options` is not an object, the runner throws a `TypeError`. If the logger does not have the functions `log()` and `warn()`, the runner also throws a `TypeError`.
- **The runner cannot read `_migrations`.** Other code made a table or a view with the name `_migrations` without the column `version` or `name`. The runner throws an `Error`, and no migration runs. The `cause` property of this error contains the original error. Example: `[migrations] The runner cannot read the table _migrations. Make sure that no other code uses this table name. Cause: no such column: version at offset 7: SQLITE_ERROR`
  - The runner does not find all tables from other code. If a table or a view has the columns `version` and `name`, the runner reads it.
  - If an index has the name `_migrations`, the error does not start with `[migrations]`. Example: `there is already an index named _migrations: SQLITE_ERROR`
- **A name is different.** A row in `_migrations` has a name that is different from the name at the same position in the list. The runner throws an `Error`, and no migration runs. Example: `[migrations] Migration 2 ran with the name "add_email". The list has the name "add_users_email" at position 2. Do not change, move, or remove a deployed migration. Put "add_email" back at position 2, and add your change as a new migration at the end.`
- **A migration fails.** SQLite cancels all new migrations, and the runner throws an `Error`. The `cause` property of this error contains the original error. Example: `[migrations] Migration 5 (add_index) failed. The database stays at version 3. Cause: no such table: main.orders: SQLITE_ERROR`
- **Rows break a foreign key after the new migrations.** If a new migration contains `defer_foreign_keys`, or if `PRAGMA defer_foreign_keys` is ON after the new migrations, the runner runs `PRAGMA foreign_key_check`. If this check finds rows that break a foreign key, SQLite cancels all new migrations, and the runner throws an `Error`. The message gives the tables, not the migration. Example: `[migrations] The new migrations left rows that break a foreign key in these tables: orders. The database stays at version 2.` See [Rebuild a table](rebuild-a-table.md).
- **The foreign key check fails.** If `PRAGMA foreign_key_check` fails, SQLite cancels all new migrations, and the runner throws an `Error`. The `cause` property of this error contains the original error. Example: `[migrations] The foreign key check after the new migrations failed. The database stays at version 2. Cause: foreign key mismatch - "orders" referencing "users": SQLITE_ERROR`

In all these conditions, the database does not change. If the error occurs after a new migration ran, SQLite cancels all new migrations. If the error occurs in steps 2 to 7 of [How the runner operates](how-it-works.md#how-the-runner-operates), the runner also sets `PRAGMA defer_foreign_keys` to OFF.

Errors from Cloudflare do not start with `[migrations]`. An example is the error for an object without SQLite. A class in `new_classes` uses the old key-value storage. In an object of this class, the runner fails with an error that starts with `SQL is not enabled for this Durable Object class.` This error also says that you cannot change the storage of a class after you deploy it to production.

If the database version is higher than the last version in the list, the runner does not throw an error. It calls `logger.warn()`, and no migration runs. Example:

```
[migrations] The database is at version 3. The code has migrations only up to version 2. No migration ran.
```

## Versions

This package uses [semantic versioning](https://semver.org/). Before version 1.0.0, a minor version can change the API. [CHANGELOG.md](../CHANGELOG.md) gives the changes in each version.

The table `_migrations` and its columns `version`, `name`, and `applied_at` are part of the API. A change to them is a breaking change. The column `version` contains the position of the migration in the list.
