// migrations.js
//
// The schema migrations of the Durable Object, in order.
//
// Rules:
// - Add a new migration only at the end of the list.
// - Give it the next version number: 1, 2, 3, and more.
// - After you deploy a migration, do not change it or remove it.
//   To correct an error, add a new migration.
// - One migration can contain more than one SQL statement.
//   Put a semicolon after each statement.
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
