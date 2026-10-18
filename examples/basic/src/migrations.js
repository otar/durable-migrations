// @ts-check
// src/migrations.js
//
// The schema migrations of the Durable Object, in order.
// Each key is the name of a migration. Each value is its SQL.
// The version of a migration is its position: 1, 2, 3, and more.
//
// Rules:
// - Add a new migration only at the end of the list.
// - Give each migration a name that no other migration has. If two keys
//   have the same name, JavaScript keeps only the last value, and the
//   runner cannot find the error. The line "// @ts-check" makes your
//   editor show it.
// - A name must not contain only digits, for example "42". Do not use
//   the name "__proto__".
// - Keep all migrations in this one object literal. Do not use spread
//   (...), Object.assign(), or "import * as". Do not sort the keys.
// - After you deploy a migration, do not change it, move it, or remove it.
//   If you rename or move it, the runner throws an error, and the object
//   does not start. To correct an error, add a new migration.
// - One migration can contain more than one SQL statement.
//   Put a semicolon after each statement.
// - The SQL must end with a statement. Do not put a comment or an extra
//   semicolon after the last statement. If you do, the migration fails.
// - Do not use BEGIN, COMMIT, ROLLBACK, or SAVEPOINT.
//   The runner controls the transaction.

/** @type {Record<string, string>} */
export const migrations = {
  create_users: `
    CREATE TABLE users (
      id   INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    );
  `,
  add_users_email: `
    ALTER TABLE users ADD COLUMN email TEXT;
    CREATE UNIQUE INDEX users_email ON users (email);
  `,
};
