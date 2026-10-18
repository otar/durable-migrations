// src/migrations.js
//
// The schema migrations of the Durable Object, in order.
//
// Rules:
// - Add a new migration only at the end of the list.
// - Give it the next version number: 1, 2, 3, and more.
// - After you deploy a migration, do not change it, move it, or remove it.
//   If you rename or move it, the runner throws an error, and the object
//   does not start. To correct an error, add a new migration.
// - One migration can contain more than one SQL statement.
//   Put a semicolon after each statement.
// - The SQL must end with a statement. Do not put a comment or an extra
//   semicolon after the last statement. If you do, the migration fails.
// - Do not use BEGIN, COMMIT, ROLLBACK, or SAVEPOINT.
//   The runner controls the transaction.

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
  {
    version: 2,
    name: "add_users_email",
    sql: `
      ALTER TABLE users ADD COLUMN email TEXT;
      CREATE UNIQUE INDEX users_email ON users (email);
    `,
  },
];
