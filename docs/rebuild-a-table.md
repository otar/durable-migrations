# Rebuild a table

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

The runner checks the foreign keys at the end of the new migrations. It does this check only if a new migration contains `defer_foreign_keys`, or if `PRAGMA defer_foreign_keys` is ON after the new migrations. If rows break a foreign key, SQLite cancels all new migrations, and the runner throws a `[migrations]` error. See [Errors and warnings](api.md#errors-and-warnings). If no rows break a foreign key, the runner sets `PRAGMA defer_foreign_keys = OFF`. This also clears the count of foreign key errors that SQLite keeps. Thus the commit does not fail.

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

Both procedures copy all rows of `users` two times. The second procedure also copies all rows of `orders` two times. If the tables are large, make sure that all new migrations complete in less than 30 seconds. See [Measure the time of the migrations](test-and-deploy.md#measure-the-time-of-the-migrations).

A new constraint can break the writes of the old code after a rollback. See [Keep the schema compatible with old code](writing-migrations.md#keep-the-schema-compatible-with-old-code).

CAUTION: Before you deploy this migration, do a test of it in `wrangler dev`. Before the test, put data in all tables. Before and after the migration, count the rows of each table that refers to the rebuilt table. Make sure that the counts are the same. Also make sure that the foreign key columns of these tables did not change. After the migration, make sure that `PRAGMA foreign_key_check` returns no rows.
