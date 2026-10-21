# Changelog

This file records the changes in each version of `durable-migrations`. It uses the format of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The package uses [semantic versioning](https://semver.org/).

## [0.1.0] - Unreleased

This is the first version as an npm package. Before this version, you copied the files `migrate.js` and `migrations.js` into your project.

### Added

- The npm package `durable-migrations`. It exports one function, `runMigrations()`, and the TypeScript types for this function. The package has no dependencies.
- Type declarations in `src/index.d.ts`. They export the types `MigrationStorage`, `MigrationLogger`, and `RunMigrationsOptions`. `tsc` reads them through the `"types"` condition in `"exports"` of `package.json`. With `"moduleResolution": "node"`, `tsc` reads the field `"types"` of `package.json`. You do not need to change `tsconfig.json` for the package. See [TypeScript](docs/typescript.md).
  - If the first argument of `runMigrations()` is `ctx` or `ctx.storage.sql`, `tsc` shows an error at the call. `tsc` also finds other incorrect arguments. See [Errors that tsc finds](docs/typescript.md#errors-that-tsc-finds).
- A storage check. If `storage` is not an object, the runner throws a `TypeError`. If `storage` does not have the function `transactionSync()`, or if it does not have the property `sql`, the runner also throws a `TypeError`. Examples are `ctx` and `ctx.storage.sql`. The runner does this check first, before it changes the database. The message is: `[migrations] The storage must be ctx.storage, the storage of the Durable Object. Do not give ctx or ctx.storage.sql.`
  - The storage of a class without SQLite passes this check. For this storage, the error from Cloudflare starts with `SQL is not enabled for this Durable Object class.`
  - Before, the runner threw a `TypeError` without `[migrations]`, for example `storage.transactionSync is not a function`.
- A `[migrations]` error when the runner cannot read `_migrations`. An example is a table or a view from other code without the column `version` or `name`. The message starts with `[migrations] The runner cannot read the table _migrations.` The `cause` property contains the error of SQLite. Before, the runner threw the error of SQLite without `[migrations]`. See [Errors and warnings](docs/api.md#errors-and-warnings).
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
  - The tests include a deployed migration that moved, and a new migration before the deployed migrations. They also include a table, a view, and an index with the name `_migrations` from other code.
  - The tests of the foreign key check use `defer_foreign_keys` in lower case, upper case, and mixed case. One test sets the pragma to ON before the call.
  - Other tests count the SQL statements of a start, check the columns of `_migrations`, and use a logger that is a class instance.
- Type tests in `test/types`. `npm run test:types` runs `tsc` on correct and incorrect calls of `runMigrations()`, in TypeScript and in JavaScript with `// @ts-check`. It does the tests with `"moduleResolution": "bundler"`, with `"nodenext"`, and with `"exactOptionalPropertyTypes": true`. It also checks `src/index.d.ts` without `@cloudflare/workers-types`.
- A check of the package files. `npm run check:package` runs `npm pack --dry-run --json`, and it compares the files with this list: `LICENSE`, `README.md`, `package.json`, `src/index.d.ts`, and `src/index.js`. If a file is missing or extra, the command gives the file and fails.
- An example Worker in `examples/basic`.
- More documentation:
  - A Vitest test on an object with the old schema. The Vitest example uses `newUniqueId()`, because the plugin keeps the storage for all tests in one file. See [Do a test with Vitest on an object with the old schema](docs/test-and-deploy.md#do-a-test-with-vitest-on-an-object-with-the-old-schema).
  - A rule for the callback of `blockConcurrencyWhile()`. Do not catch the error of the runner. If you catch it, throw it again. See [Rules](docs/writing-migrations.md#rules).
  - A CAUTION for an object that an alarm starts. If the runner throws an error, Cloudflare can delete the alarm. See [When the migrations run](docs/how-it-works.md#when-the-migrations-run).
  - How to measure the time of the migrations. Local tests do not stop a slow migration. See [Measure the time of the migrations](docs/test-and-deploy.md#measure-the-time-of-the-migrations).
  - The `exports` form of the Wrangler configuration file, `"storage": "sqlite"`, next to `new_sqlite_classes`. See [Quick start](README.md#quick-start).
  - How to stop a linter that sorts the keys of the list, and how to correct two keys with the same name. See [Linters that sort the keys](docs/writing-migrations.md#linters-that-sort-the-keys).
  - What to do after `deleteAll()`: call `ctx.abort()`. See [Delete all data of an object](docs/how-it-works.md#delete-all-data-of-an-object).
  - How to see the migration history of a deployed object in Data Studio. Rules that tell you not to change `_migrations` or the schema by hand. See [See the migration history](docs/how-it-works.md#see-the-migration-history) and [Rules](docs/writing-migrations.md#rules).
  - How to keep each migration in a `.sql` file. See [Keep each migration in a .sql file](docs/writing-migrations.md#keep-each-migration-in-a-sql-file).
  - How to change from durable-utils, `@cloudflare/actors`, Drizzle, or a runner that you wrote. See [Change from other tools](docs/change-from-other-tools.md).
- A CI workflow. It runs on each push to `main` and on each pull request. It runs the tests and the type tests, and it checks the package files. It also builds the example. To build the example, it installs the package as from the registry.
- A release workflow. It publishes the package to npm with trusted publishing and provenance. It publishes only from a tag that is on `main` and that has the version in `package.json`. Before it publishes, it does the same tests and checks as the CI workflow.
- The workflows refer to each action by its full commit SHA, with the version in a comment. A tag can move to different code, but a commit SHA cannot change.
- A Dependabot configuration in `.github/dependabot.yml`. Each week, Dependabot opens pull requests for new versions of the dev dependencies and of the actions.
  - One pull request contains all version updates of the dev dependencies, because some of them must change together. For example, `vitest` is a peer dependency of `@cloudflare/vitest-plugin`.
  - `@cloudflare/vitest-plugin` brings workerd, the Workers runtime. Thus the tests run on newer versions of workerd, and they find changes in the runtime that can break the runner.
  - Dependabot waits 7 days after the release of a new version before it opens a pull request. This wait does not apply to security updates.

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
- The statement about a rollback, in [Keep the methods compatible during a deployment](docs/test-and-deploy.md#keep-the-methods-compatible-during-a-deployment). The old README said that the schema does not cause errors during a gradual deployment or a rollback. After a rollback, and after some gradual deployments, the old code runs on the new schema. Thus each migration must be compatible with the old code. See [Keep the schema compatible with old code](docs/writing-migrations.md#keep-the-schema-compatible-with-old-code).

### Upgrade from the copied files

In this version, the list of migrations is an object. Thus you must change your list. The steps are in [Upgrade from the copied files](docs/upgrade-from-copied-files.md). Before you change the list, do the check of the old names on that page. If an old name does not pass the check, the new format of the list cannot hold your migration history.

CAUTION: Before you deploy, make sure that each deployed migration has its old name at its old position in the list. If a name is different, the runner throws an error, and the object does not start.

[0.1.0]: https://github.com/otar/durable-migrations/releases/tag/v0.1.0
