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
6. Deploy the Worker.

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

Each Durable Object runs the new migration the next time that it starts. An object that does not start keeps its old schema.

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
