# durable-migrations

This package runs schema migrations in SQLite-backed Cloudflare Durable Objects. You write the migrations in raw SQL. The package has no dependencies.

**Requirement:** a SQLite-backed Durable Object class (`new_sqlite_classes`). The package does not operate with the old key-value storage.

The package exports one function, `runMigrations()`. This README calls this function "the runner".

## Install

1. Install the package:

   ```sh
   npm install durable-migrations
   ```

2. Make a file `migrations.js` next to your Durable Object class. Put your list of migrations in this file:

   ```js
   export const migrations = [
     {
       version: 1,
       name: "create_users",
       sql: `
         CREATE TABLE users (
           id   INTEGER PRIMARY KEY,
           name TEXT NOT NULL
         );
       `,
     },
   ];
   ```

   The package does not include this list. You keep it in your project. [`examples/basic/src/migrations.js`](examples/basic/src/migrations.js) has an example list.

3. If your constructor has `CREATE TABLE` or `CREATE INDEX` statements, move them into migration 1. Keep `IF NOT EXISTS` in these statements.

   Objects that started with the old constructor already have these tables, but they do not have the table `_migrations`. Thus migration 1 runs on these objects at their next start. Without `IF NOT EXISTS`, migration 1 fails on these objects with `table users already exists`. With `IF NOT EXISTS`, SQLite skips these statements, and the objects keep their old schema. Thus migration 1 must make the same schema as the old constructor.

4. In the file of your Durable Object class, import the runner and the list:

   ```js
   import { DurableObject } from "cloudflare:workers";
   import { runMigrations } from "durable-migrations";
   import { migrations } from "./migrations.js";
   ```

5. In the constructor of your Durable Object, call `runMigrations()` inside `ctx.blockConcurrencyWhile()`:

   ```js
   export class MyDurableObject extends DurableObject {
     constructor(ctx, env) {
       super(ctx, env);
       ctx.blockConcurrencyWhile(async () => {
         runMigrations(ctx.storage, migrations);
       });
     }
   }
   ```

6. If the class is new, add it to `new_sqlite_classes` in the Wrangler configuration file:

   ```jsonc
   "migrations": [
     { "tag": "v1", "new_sqlite_classes": ["MyDurableObject"] }
   ]
   ```

7. Deploy the Worker.

[`examples/basic`](examples/basic) has a full Worker that uses the runner.

The runner operates only in SQLite-backed Durable Objects. A class in `new_classes` uses the old key-value storage. In an object of this class, the runner fails with an error that starts with `SQL is not enabled for this Durable Object class.` This error also says that you cannot change the storage of a class after you deploy it to production.

## TypeScript

The package has no type declarations. `src/index.js` in the package has JSDoc types for `runMigrations()`.

If `"strict": true` is in your `tsconfig.json`, `tsc` fails on the import. The error starts with this text:

```
error TS7016: Could not find a declaration file for module 'durable-migrations'.
```

Wrangler does not check types. Thus `wrangler dev` and `wrangler deploy` operate, also when `tsc` fails.

To use the JSDoc types, add `allowJs` and `maxNodeModuleJsDepth` to `compilerOptions` in `tsconfig.json`:

```jsonc
{
  "compilerOptions": {
    "allowJs": true,
    "maxNodeModuleJsDepth": 1
  }
}
```

Then `tsc` reads the JSDoc types in the package, and it finds incorrect calls of `runMigrations()`. Example: for a version that is a string, `tsc` fails with `error TS2322: Type 'string' is not assignable to type 'number'.`

To use no types, add a file such as `src/durable-migrations.d.ts` with this line:

```ts
declare module "durable-migrations";
```

The file must be in a folder that `tsconfig.json` includes. Then `runMigrations()` has the type `any`, and `tsc` does not check its calls.

## API

```js
runMigrations(storage, migrations, options?)
```

The runner runs the migrations that did not run on the object before. It is synchronous, and it returns the database version.

### Parameters

- `storage`: the `ctx.storage` of the Durable Object.
- `migrations`: an array with all migrations, in order. Each item is an object with these properties:
  - `version`: a number. Item 1 has version 1, item 2 has version 2, and more.
  - `name`: a string that is not empty and not only white space. The runner records the name in `_migrations` and compares it at each start.
  - `sql`: a string that is not empty and not only white space. It can contain more than one statement.
- `options` (optional): an object with this property:
  - `logger` (optional): an object with the functions `log(message)` and `warn(message)`. The default is `console`. The runner ignores errors from these functions.

### Logger

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

### Return value

The runner returns the database version after the call:

- If the database version is higher than the last version in the list, the runner returns the database version.
- In all other conditions, it returns the last version in the list. For an empty list, this is 0.

### Errors and warnings

The runner throws an error in these conditions. Each message starts with `[migrations]`.

- **The list is not correct.** If `migrations` is not an array, the runner throws a `TypeError`. If an item has an incorrect version, no name, or no SQL, the runner throws an `Error`. Example: `[migrations] Item 2 of the list must have version 2. It has version 3.` The message shows a version that is a string in quotes. Example: `[migrations] Item 1 of the list must have version 1. It has version "1".`
- **The options are not correct.** If `options` is not an object, the runner throws a `TypeError`. If the logger does not have the functions `log()` and `warn()`, the runner also throws a `TypeError`.
- **A name is different.** A version in `_migrations` has a different name in the list. The runner throws an `Error`, and no migration runs. Example: `[migrations] Migration 2 ran with the name "add_email". The list has the name "add_users_email" for version 2. Do not change, move, or remove a deployed migration. Give version 2 its old name, and add your change as a new migration.`
- **A migration fails.** SQLite cancels all new migrations, and the runner throws an `Error`. The `cause` property of this error contains the original error. Example: `[migrations] Migration 5 (add_index) failed. The database stays at version 3. Cause: no such table: main.orders: SQLITE_ERROR`
- **Rows break a foreign key after the new migrations.** If a new migration contains `defer_foreign_keys`, or if `PRAGMA defer_foreign_keys` is ON after the new migrations, the runner runs `PRAGMA foreign_key_check`. If this check finds rows that break a foreign key, SQLite cancels all new migrations, and the runner throws an `Error`. The message gives the tables, not the migration. Example: `[migrations] The new migrations left rows that break a foreign key in these tables: orders. The database stays at version 2.` See [Change a table in a way that ALTER TABLE cannot](#change-a-table-in-a-way-that-alter-table-cannot).
- **The foreign key check fails.** If `PRAGMA foreign_key_check` fails, SQLite cancels all new migrations, and the runner throws an `Error`. The `cause` property of this error contains the original error. Example: `[migrations] The foreign key check after the new migrations failed. The database stays at version 2. Cause: foreign key mismatch - "orders" referencing "users": SQLITE_ERROR`

In all these conditions, the database does not change. If the error occurs after a new migration ran, SQLite cancels all new migrations. If the error occurs in steps 2 to 7 of [How the runner operates](#how-the-runner-operates), the runner also sets `PRAGMA defer_foreign_keys` to OFF.

Errors from Cloudflare do not start with `[migrations]`. An example is the error for an object without SQLite. See [Install](#install).

If the database version is higher than the last version in the list, the runner does not throw an error. It calls `logger.warn()`, and no migration runs. Example:

```
[migrations] The database is at version 3. The code has migrations only up to version 2. No migration ran.
```

## How the runner operates

Each Durable Object has its own SQLite database. The runner keeps the migration history of the object in the table `_migrations`. Each row is one migration that ran: its version, its name, and the time (UTC).

When the object starts, the runner does these steps:

1. It makes sure that the list of migrations and the options are correct.
2. If the table `_migrations` does not exist, it creates this table.
3. It reads all rows of `_migrations`.
4. It compares the name of each row with the name of the same version in the list. If a name is different, it throws an error, and no migration runs. A row with a version that is not in the list comes from newer code. The runner does not compare its name.
5. It finds the database version. This is the highest version in `_migrations`, or 0.
6. It runs each migration that has a higher version, in order. For each migration, it adds a row to `_migrations`.
7. If one or more migrations ran, and a new migration contains `defer_foreign_keys` or `PRAGMA defer_foreign_keys` is ON, it runs `PRAGMA foreign_key_check`. If rows break a foreign key, it throws an error. If not, it sets `PRAGMA defer_foreign_keys = OFF`.
8. It writes one log line for each migration that ran.

Steps 2 to 7 occur in one transaction, inside `storage.transactionSync()`.

| Condition | Result |
|---|---|
| The database has all migrations. | No migration runs. |
| The code has new migrations. | The runner runs them and records them. |
| A new migration fails. | SQLite cancels all new migrations. The database stays at its old version. The runner throws an error, and Cloudflare resets the object. The stub that got the error keeps the error. At the next request, the Worker must get a new stub with `namespace.get(id)`. Then the object starts again, and the runner tries again. This occurs at each request until you deploy a correction. See [When the migrations run](#when-the-migrations-run). |
| A migration leaves rows that break a foreign key (with `PRAGMA defer_foreign_keys`). | SQLite cancels all new migrations. The database stays at its old version. The runner throws an error that gives the tables. The result is the same as for a failed migration. |
| A version in `_migrations` has a different name in the list. Example: you renamed or moved a deployed migration. | The runner throws an error before a migration runs. The database does not change. The object does not start until you deploy code with the old name. |
| The database version is higher than the last version in the list. This can occur after a rollback of a deployment. | The runner writes a warning to the log. No migration runs, and the object starts. |
| The list of migrations or the options are not correct. | The runner throws an error before it changes the database. The object does not start. |

The error message gives the failed migration and the cause, for example:

```
[migrations] Migration 5 (add_index) failed. The database stays at version 3. Cause: no such table: main.orders: SQLITE_ERROR
```

You can see the errors in Workers Logs and in `wrangler tail`. If the logger is `console`, the log lines and the warnings also show there.

## When the migrations run

The runner runs in the constructor of the Durable Object. The constructor runs one time each time that the object starts. It does not run for each request. While the object stays in memory, all requests go to the same instance, and the runner does not run again.

An object starts when it gets a request or an alarm and it is not in memory. An object is not in memory in these conditions:

- The object is new. It did not start before.
- The object was idle, and Cloudflare removed it from memory. If the object can hibernate, this occurs after approximately 10 seconds. If not, this occurs after 70 to 140 seconds.
- You deployed the Worker. A deployment stops each object that is in memory and gets new code.
- Cloudflare moved the object to a different machine, or updated the Workers runtime.

[Lifecycle of a Durable Object](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/) gives the full lifecycle.

A deployment does not start an object. An object that is not in memory stays stopped. Each object starts with the new code at its next request or alarm.

At each start, the runner compares `_migrations` with your list of migrations. Then it runs only the new migrations. After a deployment, the first start of each object runs the new migrations. All other starts find no new migration.

At a start without new migrations, the runner runs only two SQLite statements. If `_migrations` does not exist, the first statement creates it. The second statement reads all rows of `_migrations`. The database is on the same machine as the object, so these statements do not use the network.

`blockConcurrencyWhile()` holds all requests until the runner is complete. As a result, a request never gets the new code with the old schema.

If the runner throws an error, the start fails, and the request gets the error. The stub that got the error keeps the error. It does not start the object again. At the next request, the Worker must get a new stub with `namespace.get(id)`, for example `env.MY_DURABLE_OBJECT.get(id)`. Then the object starts again, and the runner tries again. Most Workers get a new stub for each request. If your Worker keeps a stub in a variable, it must get a new stub after an error. [Error handling](https://developers.cloudflare.com/durable-objects/best-practices/error-handling/) gives more information about stubs after an error.

Do not add a flag in memory to skip the runner. The object loses the flag each time that it stops. The next start has a new instance without the flag, so the runner runs anyway.

## You do not need to run migrations on all objects

After a deployment, you do not need a script or a CLI command that runs the migrations on all objects. Each object runs the new migrations at its next start, before its first request.

An object that is not in memory keeps its old schema. This is not a problem. No code reads its database until the object starts, and the start runs the migrations first.

A script or a CLI command also cannot replace the runner in the constructor:

- Wrangler has no command that runs SQL in a Durable Object. Only the object can get access to its database. Thus a script must call each object through your Worker.
- A call to an object starts the object. The start runs the constructor, and thus the runner, anyway.
- A new object comes into existence at its first request. No script can run before this request. Thus each object must create its own schema at its start.
- A script can run only after the deployment. Without the runner in the constructor, the new code runs with the old schema until the script gets to the object.
- A script must know the name or the ID of each object. If the script misses an object, that object keeps the old schema.

Before you deploy, do a test of the migrations. See [Do a test of your migrations](#do-a-test-of-your-migrations).

## Add a migration

1. Open `migrations.js`.
2. Add a new item at the end of the list.
3. Set `version` to the last version in the list plus 1.
4. Set `name` to a short name, for example `create_orders`. After you deploy the migration, do not change this name.
5. Set `sql` to the SQL of the change. Put a semicolon after each statement. Do not put a comment or an extra semicolon after the last statement.
6. Do a test of the migration on an object that has the old schema. See [Do a test of your migrations](#do-a-test-of-your-migrations).
7. If you changed the methods of the object, make sure that the old code can still use them. See [Keep the methods compatible during a deployment](#keep-the-methods-compatible-during-a-deployment).
8. Deploy the Worker.

One migration can contain more than one statement. Example:

```js
{
  version: 3,
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
```

Each object runs the new migration at its next start. An object that does not start keeps its old schema. See [When the migrations run](#when-the-migrations-run).

## Do a test of your migrations

To do a test of a migration on an object that has the old schema:

1. Run `wrangler dev` with the old code.
2. Send requests that make some objects and write data to them.
3. Change to the new code.
4. Run `wrangler dev` again. The local data stays in `.wrangler/state`.
5. Send a request to each object.
6. Make sure that the migration ran and that the requests succeed.

CAUTION: Before you deploy, do this test. If a migration fails, each object that starts with the new code cannot get requests. This continues until you deploy a correction.

You can also do a test with Vitest and `@cloudflare/vitest-plugin`. In the test, `runInDurableObject()` from `cloudflare:test` starts a new object. The constructor of the object runs all migrations. If a migration fails, `runInDurableObject()` rejects with the `[migrations]` error.

```js
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { migrations } from "../src/migrations.js";

it("runs all migrations on a new object", async () => {
  const stub = env.MY_DURABLE_OBJECT.get(env.MY_DURABLE_OBJECT.idFromName("test"));
  const rows = await runInDurableObject(stub, (instance, state) =>
    state.storage.sql.exec("SELECT version FROM _migrations").toArray(),
  );
  expect(rows.length).toBe(migrations.length);
});
```

A test can also call `runMigrations(state.storage, migrations)` inside `runInDurableObject()`. A test on a new object does not replace the test on an object with the old schema.

## Keep the methods compatible during a deployment

Cloudflare deploys a new version to all locations over a short time, usually seconds to minutes. During this time, the old code and the new code run at the same time:

- A Worker with the new code can call an object that still has the old code.
- A Worker with the old code can call an object that already has the new code.

A gradual deployment and a rollback also mix the two versions.

The schema does not cause errors here. Only the object reads its database, and each object runs its migrations before its code runs. The risk is in the methods that the Worker calls on the object.

When you change the methods of the object, use these rules:

- Do not change the arguments of a method that already exists. You can add an optional argument at the end.
- Do not remove a property from a return value. Do not change the type of a property. You can add a property.
- To replace a method, add a new method with a new name. Remove the old method only in a later deployment.
- A new method does not exist in an object that still has the old code. Thus a call to a new method can fail during the deployment. To prevent this, add the method in one deployment. Call it from the Worker in a later deployment.

These rules also apply to `fetch()` routes and to the request and response bodies of the object.

## Rules

- After you deploy a migration, do not change it, move it, or remove it. To correct an error, add a new migration.
- The runner compares the names in `_migrations` with the names in the list. If you rename or move a deployed migration, the runner throws an error. Then the object does not start until you deploy code with the old name.
- The runner does not compare the SQL. If you change the SQL of a deployed migration, the runner does not find the change. Objects that ran the old SQL keep the old schema. New objects get the new schema.
- A migration must contain one or more statements. Do not put a comment or an extra semicolon after the last statement. `sql.exec()` then fails with `SQL code did not contain a statement.` The runner adds this hint to the error: `The SQL must end with a statement. Remove comments and extra semicolons after the last statement.` A migration that has only a comment fails with the same hint. You can put comments before a statement or between statements.
- Do not use `BEGIN`, `COMMIT`, `ROLLBACK`, or `SAVEPOINT` in a migration. The SQL API of Durable Objects does not accept these statements. The runner controls the transaction.
- Do not use `PRAGMA user_version`. Durable Objects do not support it. It fails with `not authorized: SQLITE_AUTH`.
- Do not use the table name `_migrations` for your data.
- Do not change the table `_migrations` in a migration. The runner records the migrations that ran in this table. For example, if a migration removes or renames this table, the runner fails the migration with a `[migrations]` error: `[migrations] Migration 2 (drop_it) failed. The database stays at version 1. Cause: no such table: _migrations: SQLITE_ERROR`

CAUTION: Make sure that all new migrations complete in less than 30 seconds. This is the time limit of `blockConcurrencyWhile()`. If the migrations do not complete in this time, Cloudflare resets the object, and SQLite cancels the migrations. The object then cannot start until you deploy code that corrects the migrations. A migration that changes many rows can be slow.

CAUTION: Do not deploy a migration without a test. A failed migration runs again at each start of the object. The stub that got the error keeps the error. At the next request, the Worker must get a new stub with `namespace.get(id)`. Then the object starts again, and the failed migration runs again. If the migration is slow, each of these requests uses CPU time before it fails. This continues until you deploy a correction.

## Change a table in a way that ALTER TABLE cannot

SQLite `ALTER TABLE` can add, rename, and drop columns. For other changes, make a new table in one migration. Example: add a `CHECK` constraint to `users.name`. In this example, the table `orders` has a foreign key to `users`.

```sql
PRAGMA defer_foreign_keys = ON;
CREATE TABLE users_old AS SELECT * FROM users;
DROP TABLE users;
CREATE TABLE users (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL CHECK (length(name) > 0),
  email TEXT
);
INSERT INTO users (id, name, email) SELECT id, name, email FROM users_old;
DROP TABLE users_old;
CREATE UNIQUE INDEX users_email ON users (email);
```

If no other table has a foreign key to `users`, the same procedure also operates.

The order of the statements is important:

- Durable Objects always enforce foreign keys. `PRAGMA foreign_keys = OFF` has no effect in a migration.
- If rows in `orders` refer to `users`, `DROP TABLE users` fails with `FOREIGN KEY constraint failed`. With `ON DELETE CASCADE`, `ON DELETE SET NULL`, or `ON DELETE SET DEFAULT`, this statement does not fail. It changes the rows in `orders`. See the CAUTION below.
- With `PRAGMA defer_foreign_keys = ON`, `DROP TABLE users` does not fail. SQLite does not report foreign key errors until the end of the transaction.
- The `INSERT` puts the rows back into a table with the name `users`. Then each row in `orders` refers to a row in `users` again.
- Do not make the copy with `ALTER TABLE users RENAME TO users_old`. SQLite then changes the foreign keys of the other tables. For example, `orders` then refers to `users_old`.

The runner checks the foreign keys at the end of the new migrations. It does this check only if a new migration contains `defer_foreign_keys`, or if `PRAGMA defer_foreign_keys` is ON after the new migrations. If rows break a foreign key, SQLite cancels all new migrations, and the runner throws a `[migrations]` error. See [Errors and warnings](#errors-and-warnings). If no rows break a foreign key, the runner sets `PRAGMA defer_foreign_keys = OFF`. This also clears the count of foreign key errors that SQLite keeps. Thus the commit does not fail.

With the runner, a different order also operates. In this order, the migration makes `users_new` and copies the rows into it. Then it drops `users` and renames `users_new` to `users`. This order also needs `PRAGMA defer_foreign_keys = ON`.

All new migrations run in one transaction. Thus, after a migration sets `PRAGMA defer_foreign_keys = ON`, the later migrations of the same start also defer their foreign key errors. The check at the end finds these errors too. The error message gives the tables, not the migration.

The check does not find the errors of a foreign key with `DEFERRABLE INITIALLY DEFERRED` if no new migration contains `defer_foreign_keys`. SQLite finds these errors only at the commit. Then Cloudflare resets the object with `FOREIGN KEY constraint failed`, and the error does not give the migration.

`DROP TABLE` also removes the indexes and the triggers of the table. As a result, the migration must create them again.

CAUTION: Before you drop a table, look at the foreign keys that refer to it. `DROP TABLE users` runs the `ON DELETE` actions of these foreign keys, also with `PRAGMA defer_foreign_keys = ON`. With `ON DELETE CASCADE`, SQLite deletes the rows in `orders`. With `ON DELETE SET NULL` or `ON DELETE SET DEFAULT`, SQLite changes the values in `orders.user_id`. The foreign key check does not find deleted rows or `NULL` values.

If a table has one of these actions, copy that table too. Then put its rows back after the `INSERT` into `users`. Example for `orders`:

```sql
PRAGMA defer_foreign_keys = ON;
CREATE TABLE users_old AS SELECT * FROM users;
CREATE TABLE orders_old AS SELECT * FROM orders;
DROP TABLE users;
CREATE TABLE users (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL CHECK (length(name) > 0),
  email TEXT
);
INSERT INTO users (id, name, email) SELECT id, name, email FROM users_old;
DELETE FROM orders;
INSERT INTO orders SELECT * FROM orders_old;
DROP TABLE orders_old;
DROP TABLE users_old;
CREATE UNIQUE INDEX users_email ON users (email);
```

With `ON DELETE SET NULL` or `ON DELETE SET DEFAULT`, the rows stay in `orders` with changed values. Thus `DELETE FROM orders` removes them before the procedure puts the copies back.

`DELETE FROM orders` also runs the `ON DELETE` actions of the tables that refer to `orders`. This procedure also runs the triggers of `orders`. Before you use the procedure, look at these tables and triggers.

Both procedures copy all rows of `users` two times. The second procedure also copies all rows of `orders` two times. If the tables are large, make sure that all new migrations complete in less than 30 seconds.

CAUTION: Before you deploy this migration, do a test of it in `wrangler dev`. Before the test, put data in all tables. Before and after the migration, count the rows of each table that refers to the rebuilt table. Make sure that the counts are the same. Also make sure that the foreign key columns of these tables did not change. After the migration, make sure that `PRAGMA foreign_key_check` returns no rows.

## See the migration history

```js
this.ctx.storage.sql
  .exec("SELECT version, name, applied_at FROM _migrations ORDER BY version")
  .toArray();
```

The example Durable Object in [`examples/basic`](examples/basic) has this query in `listMigrations()`.

## Wrangler migrations are a different thing

The Wrangler configuration file also has migrations, for example `new_sqlite_classes`. These migrations create or change Durable Object classes. They do not change your tables. For your tables, use `migrations.js` and the runner.

## Versions

This package uses [semantic versioning](https://semver.org/). Before version 1.0.0, a minor version can change the API. [CHANGELOG.md](CHANGELOG.md) gives the changes in each version.

The table `_migrations` and its columns `version`, `name`, and `applied_at` are part of the API. A change to them is a breaking change.

## License

MIT. See [LICENSE](LICENSE).
