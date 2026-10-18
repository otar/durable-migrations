# Write migrations

The list of migrations is an object in `migrations.js`. Each key is the name of a migration, and each value is its SQL. This page tells you how to add a migration and how to name it. It also gives all rules for the list.

## Move the tables of your constructor into migration 1

If your constructor has `CREATE TABLE` or `CREATE INDEX` statements, move them into migration 1 (the first key). Keep `IF NOT EXISTS` in these statements.

Objects that started with the old constructor already have these tables, but they do not have the table `_migrations`. Thus migration 1 runs on these objects at their next start. Without `IF NOT EXISTS`, migration 1 fails on these objects with `table users already exists`. With `IF NOT EXISTS`, SQLite skips these statements, and the objects keep their old schema. Thus migration 1 must make the same schema as the old constructor.

## Add a migration

1. Open `migrations.js`.
2. Add a new key at the end of the list. The key is the name of the migration.
3. Use a short name that no other migration has, for example `create_orders`. Do not use a name that contains only digits. After you deploy the migration, do not change this name.
4. Set the value to the SQL of the change. Put a semicolon after each statement. Do not put a comment or an extra semicolon after the last statement.
5. Do a test of the migration on an object that has the old schema. See [Do a test of your migrations](test-and-deploy.md#do-a-test-of-your-migrations).
6. If you changed the methods of the object, make sure that the old code can still use them. See [Keep the methods compatible during a deployment](test-and-deploy.md#keep-the-methods-compatible-during-a-deployment).
7. Deploy the Worker.

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

- Keep all migrations in one object literal in one file.
- Add a new migration only at the end of the list.
- Do not make the list with spread syntax (`...`), `Object.assign()`, or `Object.fromEntries()`.
- Do not use `import * as`. Import the list by its name, for example `import { migrations } from "./migrations.js"`.
- Do not sort the keys. For example, do not use a tool that sorts the keys of objects.

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
- Wrangler. It shows a warning such as `[WARNING] Duplicate key "add_users_email" in object literal [duplicate-object-key]`. The build and the deployment continue. Thus treat this warning as an error.

These tools do not find the key `__proto__` in an object literal.

## Rules

- After you deploy a migration, do not change it, move it, or remove it. To correct an error, add a new migration.
- Add a new migration only at the end of the list. Give it a name that no other migration has. See [Names and order](#names-and-order).
- The runner compares the names in `_migrations` with the names at the same positions in the list. If you rename or move a deployed migration, or add a migration before it, the runner throws an error. Then the object does not start until you deploy code with the old name at the old position.
- The runner does not compare the SQL. If you change the SQL of a deployed migration, the runner does not find the change. Objects that ran the old SQL keep the old schema. New objects get the new schema.
- A migration must contain one or more statements. Do not put a comment or an extra semicolon after the last statement. `sql.exec()` then fails with `SQL code did not contain a statement.` The runner adds this hint to the error: `The SQL must end with a statement. Remove comments and extra semicolons after the last statement.` A migration that has only a comment fails with the same hint. You can put comments before a statement or between statements.
- Do not use `BEGIN`, `COMMIT`, `ROLLBACK`, or `SAVEPOINT` in a migration. The SQL API of Durable Objects does not accept these statements. The runner controls the transaction.
- Do not use `PRAGMA user_version`. Durable Objects do not support it. It fails with `not authorized: SQLITE_AUTH`.
- Do not use the table name `_migrations` for your data.
- Do not change the table `_migrations` in a migration. The runner records the migrations that ran in this table. For example, if a migration removes or renames this table, the runner fails the migration with a `[migrations]` error: `[migrations] Migration 2 (drop_it) failed. The database stays at version 1. Cause: no such table: _migrations: SQLITE_ERROR`

CAUTION: Make sure that all new migrations complete in less than 30 seconds. This is the time limit of `blockConcurrencyWhile()`. If the migrations do not complete in this time, Cloudflare resets the object, and SQLite cancels the migrations. The object then cannot start until you deploy code that corrects the migrations. A migration that changes many rows can be slow.

CAUTION: Do not deploy a migration without a test. A failed migration runs again at each start of the object. The stub that got the error keeps the error. At the next request, the Worker must get a new stub with `namespace.get(id)`. Then the object starts again, and the failed migration runs again. If the migration is slow, each of these requests uses CPU time before it fails. This continues until you deploy a correction.
