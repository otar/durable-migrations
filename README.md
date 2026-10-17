# Schema migrations for SQLite-backed Durable Objects

This code runs schema migrations in a SQLite-backed Durable Object. It uses only raw SQL. It has no dependencies.

## Files

| File | Content |
|---|---|
| `migrate.js` | The runner: `runMigrations(storage, migrations)` |
| `migrations.js` | Your list of migrations |
| `example-durable-object.js` | An example Durable Object that uses the runner |

## How the runner operates

Each Durable Object has its own SQLite database. The runner keeps the migration history of the object in the table `_migrations`. Each row is one migration that ran: its version, its name, and the time (UTC).

When the object starts, the runner does these steps:

1. It makes sure that the list of migrations is correct.
2. If the table `_migrations` does not exist, it creates this table.
3. It reads the current version. This is the highest version in `_migrations`, or 0.
4. It runs each migration that has a higher version, in order. For each migration, it adds a row to `_migrations`.
5. It writes one log line for each migration that ran.

Steps 2 to 4 occur in one transaction.

| Condition | Result |
|---|---|
| The database has all migrations. | No migration runs. |
| The code has new migrations. | The runner runs them and records them. |
| A new migration fails. | SQLite cancels all new migrations. The database stays at its old version. The runner throws an error, and Cloudflare resets the object. The next request starts the object again, and the runner tries again. |
| The database version is higher than the last version in the code. This can occur after a rollback of a deployment. | The runner writes a warning to the log. No migration runs, and the object starts. |
| The list of migrations is not correct. | The runner throws an error before it changes the database. The object does not start. |

The error message gives the failed migration and the cause, for example:

```
[migrations] Migration 5 (add_index) failed. The database stays at version 3. Cause: no such table: main.orders
```

You can see the log lines and the errors in Workers Logs and in `wrangler tail`.

## When the migrations run

The runner runs in the constructor of the Durable Object. The constructor runs one time each time that the object starts. It does not run for each request. While the object stays in memory, all requests go to the same instance, and the runner does not run again.

An object starts when it gets a request or an alarm and it is not in memory. An object is not in memory in these conditions:

- The object is new. It did not start before.
- The object was idle, and Cloudflare removed it from memory. If the object can hibernate, this occurs after approximately 10 seconds. If not, this occurs after 70 to 140 seconds.
- You deployed the Worker. A deployment stops each object that is in memory and gets new code.
- Cloudflare moved the object to a different machine, or updated the Workers runtime.

[Lifecycle of a Durable Object](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/) gives the full lifecycle.

A deployment does not start an object. An object that is not in memory stays stopped. Each object starts with the new code at its next request or alarm.

At each start, the runner compares the highest version in `_migrations` with the list in `migrations.js`. Then it runs only the missing migrations. After a deployment, the first start of each object runs the new migrations. All other starts find no new migration. Then the runner does only two SQLite statements. The database is on the same machine as the object, so these statements do not use the network.

`blockConcurrencyWhile()` holds all requests until the runner is complete. As a result, a request never gets the new code with the old schema.

Do not add a flag in memory to skip the runner. The flag is lost each time that the object stops. The next start has a new instance without the flag, so the runner runs anyway.

## You do not need to run migrations on all objects

After a deployment, you do not need a script or a CLI command that runs the migrations on all objects. Each object runs the new migrations at its next start, before its first request.

An object that is not in memory keeps its old schema. This is not a problem. No code reads its database until the object starts, and the start runs the migrations first.

A script or a CLI command also cannot replace the runner in the constructor:

- Wrangler has no command that runs SQL in a Durable Object. Only the object can get access to its database. Thus a script must call each object through your Worker.
- A call to an object starts the object. The start runs the constructor, and thus the runner, anyway.
- A new object comes into existence at its first request. No script can run before this request. Thus each object must create its own schema when it starts.
- A script can run only after the deployment. Without the runner in the constructor, the new code runs with the old schema until the script gets to the object.
- A script must know the name or the ID of each object. If the script misses an object, that object keeps the old schema.

To find a migration error before your users find it, do a test before you deploy. See [Add a migration](#add-a-migration).

## Install the runner

1. Copy `migrate.js` and `migrations.js` into your Worker project, next to your Durable Object class.
2. In the file of your Durable Object class, import the runner and the list:

   ```js
   import { runMigrations } from "./migrate.js";
   import { migrations } from "./migrations.js";
   ```

3. In the constructor of your Durable Object, call `runMigrations()` inside `ctx.blockConcurrencyWhile()`:

   ```js
   constructor(ctx, env) {
     super(ctx, env);
     ctx.blockConcurrencyWhile(async () => {
       runMigrations(ctx.storage, migrations);
     });
   }
   ```

4. In `migrations.js`, replace the example migrations with your schema.
5. If your constructor has `CREATE TABLE` statements, move them into migration 1.
6. Deploy the Worker.

The runner operates only in SQLite-backed Durable Objects.

## Add a migration

1. Open `migrations.js`.
2. Add a new item at the end of the list.
3. Set `version` to the last version plus 1.
4. Set `name` to a short name, for example `create_orders`.
5. Set `sql` to the SQL of the change. Put a semicolon after each statement.
6. Do a test of the migration on an object that has the old schema. See the procedure below.
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

To do a test of the migration on an object that has the old schema:

1. Run `wrangler dev` with the old code.
2. Send requests that make some objects and write data to them.
3. Change to the new code, and run `wrangler dev` again. The local data stays in `.wrangler/state`.
4. Send a request to each object.
5. Make sure that the migration ran and that the requests succeed.

CAUTION: Do this test before you deploy. If a migration fails, each object that starts with the new code cannot get requests. This continues until you deploy a correction.

Each Durable Object runs the new migration the next time that it starts. An object that does not start keeps its old schema. See [When the migrations run](#when-the-migrations-run).

## Keep the methods compatible during a deployment

Cloudflare releases a new version to all locations over a short time, usually seconds to minutes. During this time, the old code and the new code run at the same time:

- A Worker with the new code can call an object that still has the old code.
- A Worker with the old code can call an object that already has the new code.

A gradual deployment and a rollback also mix the two versions.

The schema does not cause errors here. Only the object reads its database, and each object runs its migrations before its code runs. The risk is in the methods that the Worker calls on the object.

Use these rules when you change the methods of the object:

- Do not change the arguments of an existing method. You can add an optional argument at the end.
- Do not remove a property from a return value, and do not change the type of a property. You can add a property.
- To replace a method, add a new method with a new name. Remove the old method only in a later release.
- A new method does not exist in an object that still has the old code. Thus a call to a new method can fail during the deployment. To prevent this, add the method in one release. Call it from the Worker in a later release.

These rules also apply to `fetch()` routes and to the request and response bodies of the object.

## Rules

- After you deploy a migration, do not change it or remove it. The runner does not find changes in old migrations. To correct an error, add a new migration.
- Do not use `BEGIN`, `COMMIT`, `ROLLBACK`, or `SAVEPOINT` in a migration. The SQL API of Durable Objects does not accept these statements. The runner controls the transaction.
- Do not use `PRAGMA user_version`. Durable Objects do not support it.
- Do not use the table name `_migrations` for your data.

CAUTION: Make sure that all new migrations complete in less than 30 seconds. This is the time limit of `blockConcurrencyWhile()`. If the migrations do not complete in this time, Cloudflare resets the object, and SQLite cancels the migrations. The object then cannot start until you deploy code that corrects the migrations. A migration that changes many rows can be slow.

## Change a table in a way that ALTER TABLE cannot

SQLite `ALTER TABLE` can add, rename, and drop columns. For other changes, make a new table in one migration. Example: add a `CHECK` constraint to `users.name`.

```sql
CREATE TABLE users_new (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL CHECK (length(name) > 0),
  email TEXT
);
INSERT INTO users_new (id, name, email) SELECT id, name, email FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE UNIQUE INDEX users_email ON users (email);
```

`DROP TABLE` also removes the indexes of the table. As a result, the migration must create them again.

CAUTION: If other tables have foreign keys to this table, do a test of the migration before you deploy it. Use local development (`wrangler dev`) for this test. Foreign keys can make the `DROP TABLE` statement fail.

## See the migration history

```js
this.ctx.storage.sql
  .exec("SELECT version, name, applied_at FROM _migrations ORDER BY version")
  .toArray();
```

The example Durable Object has this query in `listMigrations()`.

## Wrangler migrations are a different thing

The Wrangler configuration file also has migrations, for example `new_sqlite_classes`. These migrations create or change Durable Object classes. They do not change your tables. For your tables, use `migrations.js`.
