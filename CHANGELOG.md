# Changelog

This file records the changes in each version of `durable-migrations`. It uses the format of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The package uses [semantic versioning](https://semver.org/).

## [0.1.0] - Unreleased

This is the first version as an npm package. Before this version, you copied the files `migrate.js` and `migrations.js` into your project.

### Added

- The npm package `durable-migrations`. It has one ESM export, `runMigrations()`. The package has no dependencies.
- A storage check. If `storage` is not an object, the runner throws a `TypeError`. If `storage` does not have the function `transactionSync()`, or if it does not have the property `sql`, the runner also throws a `TypeError`. Examples are `ctx` and `ctx.storage.sql`. The runner does this check first, before it changes the database. The message is: `[migrations] The storage must be ctx.storage, the storage of the Durable Object. Do not give ctx or ctx.storage.sql.`
  - The storage of a class without SQLite passes this check. For this storage, the error from Cloudflare starts with `SQL is not enabled for this Durable Object class.`
  - Before, the runner threw a `TypeError` without `[migrations]`, for example `storage.transactionSync is not a function`.
- A name check of the migrations that ran. At each start, the runner compares the names in `_migrations` with the names at the same positions in the list. If a name is different, the runner throws an error, and no migration runs. The error gives the position, the name in `_migrations`, and the name in the list.
- A hint for comments or extra semicolons after the last statement. If `sql.exec()` fails with `SQL code did not contain a statement.`, the runner adds this hint to the error: `The SQL must end with a statement. Remove comments and extra semicolons after the last statement.` A migration that has only a comment gets the same hint.
- A foreign key check after the new migrations. If a new migration contains `defer_foreign_keys`, or if `PRAGMA defer_foreign_keys` is ON after the new migrations, the runner runs `PRAGMA foreign_key_check` before the transaction ends. If no migration runs, the runner does not do this check.
  - If rows break a foreign key, SQLite cancels all new migrations. The runner throws an error that gives each table one time, for example `[migrations] The new migrations left rows that break a foreign key in these tables: orders. The database stays at version 2.` The error does not give the migration.
  - If `PRAGMA foreign_key_check` fails, the runner throws an error that starts with `[migrations] The foreign key check after the new migrations failed.`
  - If no rows break a foreign key, the runner sets `PRAGMA defer_foreign_keys = OFF`. This also clears the count of foreign key errors that SQLite keeps. Thus the commit does not fail.
  - If an error occurs inside the transaction of the runner, the runner sets `PRAGMA defer_foreign_keys` to OFF. Thus the later writes of the caller do not defer their foreign key errors.
  - Before, a migration with deferred foreign key errors did not fail. The commit failed after the runner returned, and Cloudflare reset the object with `FOREIGN KEY constraint failed`.
- The option `logger`. The runner sends its log lines and its warnings to this object. The default is `console`.
- The runner ignores errors from the logger. Thus a logger error does not stop the object and does not cancel the migrations that ran. The runner also ignores a rejected promise from an async logger.
- Tests that run the runner in workerd with Vitest and `@cloudflare/vitest-plugin`.
- An example Worker in `examples/basic`.
- A CI workflow. On each push to `main` and on each pull request, it runs the tests and builds the example. To build the example, it installs the package as from the registry.
- A release workflow. It publishes the package to npm with trusted publishing and provenance. It publishes only from a tag that is on `main` and that has the version in `package.json`.

### Changed

- `migrate.js` is now `src/index.js` in the package. You import the runner from `durable-migrations`.
- The list of migrations is an object, not an array. Each key is the name of a migration, and each value is its SQL. Example: `{ create_users: "CREATE TABLE users (id INTEGER PRIMARY KEY);", add_users_email: "ALTER TABLE users ADD COLUMN email TEXT;" }`. Before, the list was an array of items with the properties `version`, `name`, and `sql`.
  - The version of a migration is its position in the list. The first key is version 1, the second key is version 2, and more. The list does not contain the versions.
  - The table `_migrations` did not change. Its column `version` contains the position of the migration. The copied runner required version N for item N of the list. Thus the versions that are already in `_migrations` agree with the positions.
  - If two keys have the same name, JavaScript keeps only the last value, and no error occurs. The runner cannot find this error. To find it, put `// @ts-check` on the first line of `migrations.js`. Then your editor shows an error for two keys with the same name. The ESLint rule `no-dupe-keys` also finds them.
  - Keep all migrations in one object literal. Do not make the list with spread syntax (`...`), `Object.assign()`, or `Object.fromEntries()`. Do not sort the keys. See [Names and order](docs/writing-migrations.md#names-and-order).
- The runner checks the list before the database changes. It throws an error in these conditions:
  - The list is not an object, for example `undefined`. The `TypeError` gives the type.
  - The list is an array, also `[]`. The `TypeError` tells you how to change the array to an object, and it refers to the README. The empty list is `{}`.
  - The prototype of the list is not `Object.prototype`. Examples are a module namespace object from `import * as`, a `Map`, a class instance, and an object without a prototype. The runner throws a `TypeError`. In Node.js, in workerd, and in the Wrangler bundle, a module namespace object sorts its keys. Thus the order of the migrations can change.
  - The list has a getter or a setter. The runner throws the same `TypeError`, and it does not call the getter. Wrangler bundles `import * as` into an object with a getter for each export.
  - A name contains only digits, for example `42` or `007`. JavaScript moves keys such as `1` and `42` before all other keys of an object. Names such as `001_create_users` are correct.
  - A name is `__proto__`, for example in a list from `JSON.parse()`. In an object literal, JavaScript makes no property for this key. Thus the list loses the migration, and the runner cannot find the error. Do not use this name.
  - A value is not a string, or it is empty or only white space. The error gives the position and the name of the migration. Example: `[migrations] Migration 2 (add_index) must have SQL. The value must be a string that is not empty and not only white space.`
- At each start, the runner reads all rows of `_migrations`. Before, it read only the highest version.
- A migration that drops or renames `_migrations`, or that adds a row with its own version to it, now fails with a `[migrations]` error. The error gives the version and the name of the migration. Before, the runner threw the error of SQLite without the name of the migration.
- The runner reads all rows of the last statement of each migration, but it does not keep them in memory. Before, it kept all rows in memory. A last statement that returned millions of rows used too much memory.
- The README gives only the quick start, the rules, and a short API. The full documentation is in the folder `docs/`.

### Fixed

- The procedure that rebuilds a table, in [Rebuild a table](docs/rebuild-a-table.md). The old procedure in the README failed with `FOREIGN KEY constraint failed` when rows in other tables referred to the table.

### Upgrade from the copied files

In this version, the list of migrations is an object. Thus you must change your list. The steps are in [Upgrade from the copied files](docs/upgrade-from-copied-files.md). Before you change the list, do the check of the old names on that page. If an old name does not pass the check, the new format of the list cannot hold your migration history.

CAUTION: Before you deploy, make sure that each deployed migration has its old name at its old position in the list. If a name is different, the runner throws an error, and the object does not start.

[0.1.0]: https://github.com/otar/durable-migrations/releases/tag/v0.1.0
