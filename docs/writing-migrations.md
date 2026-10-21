# Write migrations

The list of migrations is an object in `migrations.js`. Each key is the name of a migration, and each value is its SQL. This page tells you how to add a migration and how to name it. It also gives all rules for the list.

## Move the tables of your constructor into migration 1

If your constructor has `CREATE TABLE` or `CREATE INDEX` statements, move them into migration 1 (the first key). Keep `IF NOT EXISTS` in these statements.

Objects that started with the old constructor already have these tables, but they do not have the table `_migrations`. Thus migration 1 runs on these objects at their next start. Without `IF NOT EXISTS`, migration 1 fails on these objects with `table users already exists`. With `IF NOT EXISTS`, SQLite skips these statements, and the objects keep their old schema. Thus migration 1 must make the same schema as the old constructor.

If a migration tool made your tables, do not move its migrations into migration 1. See [Change from other tools](change-from-other-tools.md).

## Add a migration

1. Open `migrations.js`.
2. Add a new key at the end of the list. The key is the name of the migration.
3. Use a short name that no other migration has, for example `create_orders`. Do not use a name that contains only digits. After you deploy the migration, do not change this name.
4. Set the value to the SQL of the change. Put a semicolon after each statement. Do not put a comment or an extra semicolon after the last statement.
5. Do a test of the migration on an object that has the old schema. See [Do a test of your migrations](test-and-deploy.md#do-a-test-of-your-migrations).
6. If you changed the methods of the object, make sure that the old code can still use them. See [Keep the methods compatible during a deployment](test-and-deploy.md#keep-the-methods-compatible-during-a-deployment).
7. Make sure that the new schema is compatible with the old code. See [Keep the schema compatible with old code](#keep-the-schema-compatible-with-old-code).
8. Deploy the Worker.

The runner gives the new migration the next version. You do not write the version.

One migration can contain more than one statement. Example:

```js
create_orders: `
  CREATE TABLE orders (
    id      INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users (id),
    total   INTEGER NOT NULL
  );
  CREATE INDEX orders_user_id ON orders (user_id);
`,
```

CAUTION: Do not give two migrations the same name. JavaScript keeps only the last value, and the runner cannot find this error. See [Names and order](#names-and-order).

Each object runs the new migration at its next start. An object that does not start keeps its old schema. See [When the migrations run](how-it-works.md#when-the-migrations-run).

## Names and order

The runner gets the migrations from the keys of the list. The key of a migration is its name. The position of the key is the version of the migration.

The runner reads the keys in the order of `Object.keys()`. For an object literal, this is the order in the file, with one exception. JavaScript moves keys such as `1` and `42` before all other keys, in numeric order.

Use these rules for the names:

- Give each migration a name that no other migration has.
- Do not use a name that contains only digits, for example `42` or `20240101`. Names such as `001_create_users` and `20240101_create_users` are correct.
- Do not use the name `__proto__`.
- Do not use a name that is empty or only white space.
- If a name is not a JavaScript identifier, put it in quotes, for example `"add-email"`.

Use these rules for the list:

- Keep all migrations in one object literal in one file. The SQL can be in `.sql` files. See [Keep each migration in a .sql file](#keep-each-migration-in-a-sql-file).
- Add a new migration only at the end of the list.
- Do not make the list with spread syntax (`...`), `Object.assign()`, or `Object.fromEntries()`.
- Do not use `import * as`. Import the list by its name, for example `import { migrations } from "./migrations.js"`.
- Do not sort the keys. For example, do not use a tool that sorts the keys of objects. See [Linters that sort the keys](#linters-that-sort-the-keys).

The runner finds these errors before it changes the database. [Errors and warnings](api.md#errors-and-warnings) gives the messages.

- A name that contains only digits. JavaScript moves keys such as `1` and `42`, so the order of the migrations can change.
- A module namespace object from `import * as`. In Node.js, in workerd, and in the Wrangler bundle, this object sorts its keys. In Vitest, the keys keep the order of the file. Without the check of the runner, your tests can pass, and production can run the migrations in a different order. The runner also finds this error in Vitest.
- A list with a prototype that is not `Object.prototype`, or with a getter or a setter. Examples are a `Map`, a class instance, and an object without a prototype. In a bundle from Wrangler or Rollup, a module namespace object is an object with getters or an object without a prototype.
- An array. The copied files used an array. See [Upgrade from the copied files](upgrade-from-copied-files.md).
- A name that is empty or only white space.
- A property with the name `__proto__`, for example from `JSON.parse()`.
- A value that is not a string, or a value that is empty or only white space.

The runner cannot find these errors:

- Two keys with the same name. JavaScript keeps only the last value, at the position of the first key.
- The key `__proto__` in an object literal. `__proto__: "..."` makes no property, with or without quotes. The list loses the migration, and no error occurs.
- A new order on a new object. If you move or sort the keys, the name check finds the change on the objects that ran these migrations. A new object has no history. Thus it runs the migrations in the new order, and no error occurs.
- A copy of a module namespace object, for example `{ ...namespace }`. The runner accepts the copy, but the copy has sorted keys.

CAUTION: Give each migration a name that no other migration has. If two keys have the same name, JavaScript keeps only the last value. No error occurs. If the new key has the name of a deployed migration, the count of migrations does not change. Objects that ran the deployed migration do not run the new SQL. New objects run the new SQL in place of the old SQL. Thus old and new objects get different schemas.

These tools find two keys with the same name in one object literal:

- `tsc` and your editor, with `// @ts-check` on the first line of `migrations.js`. They show `error TS1117: An object literal cannot have multiple properties with the same name.` See [TypeScript](typescript.md).
- The ESLint rule `no-dupe-keys`. This rule is in `js.configs.recommended`.
- The Biome rule `noDuplicateObjectKeys`. This rule is in the recommended rules of Biome.
- The oxlint rule `no-dupe-keys`. By default, oxlint shows a warning and does not fail. To make it fail, run `oxlint --deny-warnings`.
- Wrangler. It shows a warning such as `[WARNING] Duplicate key "add_users_email" in object literal [duplicate-object-key]`. The build and the deployment continue. Thus treat this warning as an error.

These tools do not find the key `__proto__` in an object literal.

Before you deploy, correct two keys with the same name. Rename the second key, which is the new migration. Do not use the Biome fix `Remove this property`. This fix removes the first key, which is the deployed migration.

## Linters that sort the keys

Some linters check that the keys of objects are in sorted order. Examples are the Biome action `useSortedKeys` and the rule `sort-keys` of ESLint and oxlint. Some shared configurations turn on these rules, for example the Biome and oxlint configurations of Ultracite. `biome check --write` and `oxlint --fix` sort the list and give no warning. ESLint does not sort the list. It shows an error that tells you to sort the keys. After you deploy the sorted list, an object that ran a moved migration does not start. A new object runs the migrations in a different order.

If your configuration turns on one of these rules, turn it off for `migrations.js`. Put these comments after `// @ts-check` on line 1:

```js
// @ts-check
// biome-ignore-all assist/source/useSortedKeys: The position of a migration is its version.
/* eslint-disable sort-keys -- The position of a migration is its version. */
```

The second line is for Biome. The third line is for ESLint and oxlint. Add only the lines for the rules that your configuration turns on. If ESLint does not use `sort-keys`, it shows `Unused eslint-disable directive`, and `eslint --fix` removes the comment. If you use oxlint with ESLint, and only oxlint uses `sort-keys`, write `oxlint-disable` in place of `eslint-disable`. ESLint ignores this comment.

Names that start with a number of fixed length, for example `001_create_users` and `002_add_users_email`, are already in sorted order. This also applies to names that start with a date, for example `20240101_create_users`. This is true only if each new name has a higher prefix than all names before it. A branch that you merge later can add a name with a lower prefix. Then `biome check --write` and `oxlint --fix` move this name. If you cannot make sure that each new prefix is higher, add these comments.

## Keep each migration in a .sql file

You can keep the SQL of each migration in its own `.sql` file. Then your editor and your SQL tools can read the SQL. The list stays one object literal in `migrations.js`.

1. Make one `.sql` file for each migration, for example `migrations/0001_create_users.sql`.
2. In `migrations.js`, import each file with its own default import.
3. In the list, add one key for each import, in the order of the migrations.

```js
// @ts-check
import createUsers from "./migrations/0001_create_users.sql";
import addUsersEmail from "./migrations/0002_add_users_email.sql";

/** @type {Record<string, string>} */
export const migrations = {
  create_users: createUsers,
  add_users_email: addUsersEmail,
};
```

Use these rules:

- Keep the text part of the file name in the key, for example `create_users`. The runner throws an error for a key that contains only digits, for example `"0001"`.
- Do not make the list with `import.meta.glob()` or a loop. Write each key in the object literal.
- Wrangler 4.57.0 or later imports a `.sql` file as a string. For an older version, add this rule to the Wrangler configuration file: `"rules": [{ "type": "Text", "globs": ["**/*.sql"], "fallthrough": true }]`
- In TypeScript, and in JavaScript with `// @ts-check`, `tsc` shows `error TS2307` for each `.sql` import. To prevent this, run `wrangler types`, or add this declaration to a `.d.ts` file:

  ```ts
  declare module "*.sql" {
    const sql: string;
    export default sql;
  }
  ```

  The declaration file must be in the same project as `migrations.js` or `migrations.ts`. Make sure that `tsconfig.json` or `jsconfig.json` includes both files. If your project does not have one of these files, add `jsconfig.json`. Without it, your editor does not read the declaration file.

- In tests, use `@cloudflare/vitest-plugin`. Vitest without this plugin cannot import a `.sql` file.
- The rules for the SQL of a migration also apply to the files. Do not put a comment or an extra semicolon after the last statement. After you deploy a file, do not change it.
- Do not let a formatter change a deployed file.

## Keep the schema compatible with old code

After a rollback, objects that ran the new migrations start with the old code. The runner writes a warning, and no migration runs. Thus the old code runs on the new schema. Some gradual deployments do the same. See [Keep the methods compatible during a deployment](test-and-deploy.md#keep-the-methods-compatible-during-a-deployment).

Each migration must be compatible with the code of each version that you can roll back to.

These changes are safe:

- A new table.
- An index that is not `UNIQUE`.
- A new column that accepts `NULL` or that has a `DEFAULT`. This is safe only if the old `INSERT` statements give the names of their columns. If not, they fail, for example with `table users has 3 columns but 2 values were supplied`.

These changes are not safe in one deployment:

- A rename or a drop of a column or a table that the old code uses.
- A `UNIQUE` index on a column that the old code writes, or on a column with a `DEFAULT`. The old code can write rows that break it.
- A new column or a table rebuild that adds a constraint that the writes of the old code break. Examples are `NOT NULL` without `DEFAULT`, and `CHECK`.

Do these changes in two deployments. In the first deployment, change the code so that it also operates with the new schema. If necessary, add only the safe part of the change, for example a column that accepts `NULL`. In the second deployment, add the rest of the change. Then the code that you can roll back to operates with the new schema. For example, to drop a column, first deploy code that does not use the column.

If a deployed migration is not compatible with the old code, do not roll back. Deploy a correction.

After a rollback, keep the rolled-back migrations at the same positions in the next deployment. The objects that ran these migrations keep their rows in `_migrations`. If a different name is at one of these positions, the runner throws an error, and the object does not start.

## Rules

- After you deploy a migration, do not change it, move it, or remove it. To correct an error, add a new migration.
- Add a new migration only at the end of the list. Give it a name that no other migration has. See [Names and order](#names-and-order).
- The runner compares the names in `_migrations` with the names at the same positions in the list. If you rename or move a deployed migration, or add a migration before it, the runner throws an error. Then the object does not start until you deploy code with the old name at the old position.
- The runner does not compare the SQL. If you change the SQL of a deployed migration, the runner does not find the change. Objects that ran the old SQL keep the old schema. New objects get the new schema.
- A migration must contain one or more statements. Do not put a comment or an extra semicolon after the last statement. `sql.exec()` then fails with `SQL code did not contain a statement.` The runner adds this hint to the error: `The SQL must end with a statement. Remove comments and extra semicolons after the last statement.` A migration that has only a comment fails with the same hint. You can put comments before a statement or between statements.
- Do not use `BEGIN`, `COMMIT`, `ROLLBACK`, or `SAVEPOINT` in a migration. The SQL API of Durable Objects does not accept these statements. The runner controls the transaction.
- Do not use `PRAGMA user_version`. Durable Objects do not support it. It fails with `not authorized: SQLITE_AUTH`.
- Do not use the table name `_migrations` for your data. If other code uses this name, the runner can throw an error. See [Errors and warnings](api.md#errors-and-warnings).
- Make each change of the schema a migration. Do not change the schema by hand, for example in [Data Studio](how-it-works.md#see-the-migration-history). A change by hand occurs only in one object. Other objects and new objects do not get it. A later migration can also fail on it, for example with `table orders already exists`.
- Do not change the table `_migrations` by hand or in a migration. Do not delete, insert, or update its rows. The runner records the migrations that ran in this table. If you delete the row of the last migration, this migration runs again at the next start. Then it can fail, for example with `duplicate column name: email`. If you delete an earlier row, the runner does not find the change. If you change a name, the object does not start. If a migration removes or renames this table, the runner fails the migration with a `[migrations]` error: `[migrations] Migration 2 (drop_it) failed. The database stays at version 1. Cause: no such table: _migrations: SQLITE_ERROR`
- Each migration must be compatible with the code of each version that you can roll back to. See [Keep the schema compatible with old code](#keep-the-schema-compatible-with-old-code).
- Do not catch the error of `runMigrations()` in the callback of `blockConcurrencyWhile()`. If you catch it, throw it again. If the callback does not throw the error, the object starts with the old schema. Then each request that uses the new schema fails with an SQL error. The runner does not try again while the object stays in memory. The [Cloudflare documentation of `blockConcurrencyWhile()`](https://developers.cloudflare.com/durable-objects/api/state/#blockconcurrencywhile) tells you to use `try...catch` to prevent the reset. For the runner, the reset is necessary. Workers Logs and `wrangler tail` already show the error, so a catch that only writes the error to the log is not necessary.

CAUTION: Make sure that all new migrations complete in less than 30 seconds. This is the time limit of `blockConcurrencyWhile()`. The start of the object must also stay below the CPU time limit. This limit is 30 seconds by default. If you set a lower `limits.cpu_ms` in the Wrangler configuration file, use that value. If the migrations go above a limit, Cloudflare resets the object, and SQLite cancels the migrations. The object then cannot start until you deploy code that corrects the migrations. A migration that changes many rows can be slow. Local tests do not stop a slow migration. See [Measure the time of the migrations](test-and-deploy.md#measure-the-time-of-the-migrations).

CAUTION: Do not deploy a migration without a test. A failed migration runs again at each start of the object. The stub that got the error keeps the error. At the next request, the Worker must get a new stub with `namespace.get(id)`. Then the object starts again, and the failed migration runs again. If the migration is slow, each of these requests uses CPU time before it fails. This continues until you deploy a correction. If an alarm starts the object, Cloudflare can delete the alarm. See [When the migrations run](how-it-works.md#when-the-migrations-run).
