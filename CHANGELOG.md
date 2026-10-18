# Changelog

This file records the changes in each version of `durable-migrations`. It uses the format of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The package uses [semantic versioning](https://semver.org/).

## [0.1.0] - Unreleased

This is the first version as an npm package. Before this version, you copied the files `migrate.js` and `migrations.js` into your project.

### Added

- The npm package `durable-migrations`. It has one ESM export, `runMigrations()`. The package has no dependencies.
- A name check of the migrations that ran. At each start, the runner compares the names in `_migrations` with the names in the list. If a name is different, the runner throws an error, and no migration runs.
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
- At each start, the runner reads all rows of `_migrations`. Before, it read only the highest version.
- The runner throws an error for a list with an empty slot, for example `[m1, , m3]`. The database does not change. Before, the runner accepted this list on an object at version 2 or higher.
- A migration that drops or renames `_migrations`, or that adds a row with its own version to it, now fails with a `[migrations]` error. The error gives the version and the name of the migration. Before, the runner threw the error of SQLite without the name of the migration.
- The runner reads all rows of the last statement of each migration, but it does not keep them in memory. Before, it kept all rows in memory. A last statement that returned millions of rows used too much memory.
- The error for an incorrect version in the list shows more types of versions. For example, it shows `1n` for a BigInt, `NaN` for `NaN`, and `an object` for an object. It still shows a string in quotes. Before, it showed `null` for `NaN`, and it threw a `TypeError` for a BigInt.

### Fixed

- The README procedure that rebuilds a table. The old procedure failed with `FOREIGN KEY constraint failed` when rows in other tables referred to the table.

### Upgrade from the copied files

1. Install the package with `npm install durable-migrations`.
2. Remove `migrate.js` from your project.
3. Change the import of the runner to `import { runMigrations } from "durable-migrations";`.
4. Keep your list of migrations. The format of the list did not change.
5. Make sure that the list has an item for each version in `_migrations`, with the same name.

CAUTION: Before you deploy, give each deployed migration its old name in your list. If a name is different, the runner throws an error, and the object does not start.

[0.1.0]: https://github.com/otar/durable-migrations/releases/tag/v0.1.0
