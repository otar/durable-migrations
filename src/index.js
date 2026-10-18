// durable-migrations
//
// Schema migrations for SQLite-backed Durable Objects.
// Raw SQL only. No dependencies.
//
// Call runMigrations() in the constructor of your Durable Object,
// inside ctx.blockConcurrencyWhile(). See README.md.

const TABLE = "_migrations";

// sql.exec() throws this error when the SQL has no statement, or when
// only a comment or an extra semicolon follows the last statement.
const NO_STATEMENT = "SQL code did not contain a statement";

/**
 * Runs the migrations that did not run on this Durable Object yet.
 *
 * All new migrations run in one transaction. If one of them fails,
 * SQLite cancels all of them, and the runner throws a `[migrations]` error.
 * The `cause` property of this error contains the original error.
 *
 * Before a migration runs, the runner compares the names in the table
 * `_migrations` with the names in the list. If a name is different, the
 * runner throws an error, and no migration runs.
 *
 * @param {DurableObjectStorage} storage The ctx.storage of the Durable Object.
 * @param {{version: number, name: string, sql: string}[]} migrations
 *   All migrations, in order. The versions must be 1, 2, 3, and more.
 * @param {{logger?: {log(message: string): void, warn(message: string): void}}} [options]
 *   The logger gets one line for each migration that ran, and the warnings.
 *   The default is `console`. The runner ignores errors from the logger.
 * @returns {number} The database version after the call.
 */
export function runMigrations(storage, migrations, options = {}) {
  checkList(migrations);
  const logger = getLogger(options);

  const sql = storage.sql;
  const latest = migrations.length;

  let result;
  try {
    result = storage.transactionSync(() => migrate(sql, migrations));
  } catch (error) {
    // SQLite cancels the new migrations, but a migration can leave
    // PRAGMA defer_foreign_keys = ON. Then the later writes of the caller
    // also defer their foreign key errors, and a failed commit resets the
    // object. Thus the runner sets the pragma to OFF again.
    try {
      sql.exec("PRAGMA defer_foreign_keys = OFF");
    } catch {
      // The runner throws the first error.
    }
    throw error;
  }

  if (result.current > latest) {
    write(
      logger,
      "warn",
      `[migrations] The database is at version ${result.current}. ` +
        `The code has migrations only up to version ${latest}. No migration ran.`,
    );
    return result.current;
  }

  for (const migration of result.applied) {
    write(logger, "log", `[migrations] Migration ${migration.version} (${migration.name}) ran.`);
  }

  return latest;
}

// Runs the new migrations inside the transaction of runMigrations().
// Returns the version before the call and the migrations that ran.
function migrate(sql, migrations) {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const history = sql
    .exec(`SELECT version, name FROM ${TABLE} ORDER BY version`)
    .toArray();

  checkHistory(history, migrations);

  const current = history.length > 0 ? history[history.length - 1].version : 0;
  const applied = [];

  // The versions are 1, 2, 3, and more, so the new migrations
  // start at index `current` of the list.
  for (const migration of migrations.slice(current)) {
    try {
      // The last statement runs only while the cursor reads its rows.
      // The loop reads all rows, but it does not keep them in memory.
      for (const _row of sql.exec(migration.sql)) {
      }

      sql.exec(
        `INSERT INTO ${TABLE} (version, name) VALUES (?, ?)`,
        migration.version,
        migration.name,
      );
    } catch (error) {
      const hint = String(error?.message).includes(NO_STATEMENT)
        ? " The SQL must end with a statement." +
          " Remove comments and extra semicolons after the last statement."
        : "";
      throw new Error(
        `[migrations] Migration ${migration.version} (${migration.name}) failed. ` +
          `The database stays at version ${current}. Cause: ${error?.message}${hint}`,
        { cause: error },
      );
    }

    applied.push(migration);
  }

  if (applied.length > 0) {
    checkDeferredForeignKeys(sql, applied, current);
  }

  return { current, applied };
}

// Makes sure that the list is correct before the database changes.
function checkList(migrations) {
  if (!Array.isArray(migrations)) {
    throw new TypeError("[migrations] The list of migrations must be an array.");
  }

  // A for loop also reads empty slots. forEach() skips them.
  for (let index = 0; index < migrations.length; index++) {
    const migration = migrations[index];
    const expected = index + 1;

    if (migration?.version !== expected) {
      throw new Error(
        `[migrations] Item ${expected} of the list must have version ${expected}. ` +
          `It has version ${describe(migration?.version)}.`,
      );
    }
    if (typeof migration.name !== "string" || migration.name.trim() === "") {
      throw new Error(`[migrations] Migration ${expected} must have a name.`);
    }
    if (typeof migration.sql !== "string" || migration.sql.trim() === "") {
      throw new Error(`[migrations] Migration ${expected} must have SQL.`);
    }
  }
}

// Makes sure that each migration that ran has the same name in the list.
// A different name shows that a person renamed, moved, or replaced a
// deployed migration. Then the new migrations can run on the wrong schema.
function checkHistory(history, migrations) {
  for (const row of history) {
    const migration = migrations[row.version - 1];

    // A version that is not in the list comes from newer code.
    // runMigrations() writes a warning for this condition.
    if (migration === undefined) {
      continue;
    }

    if (migration.name !== row.name) {
      throw new Error(
        `[migrations] Migration ${row.version} ran with the name "${row.name}". ` +
          `The list has the name "${migration.name}" for version ${row.version}. ` +
          `Do not change, move, or remove a deployed migration. ` +
          `Give version ${row.version} its old name, and add your change as a new migration.`,
      );
    }
  }
}

// A migration can set PRAGMA defer_foreign_keys = ON, for example to rebuild
// a table. Then SQLite finds foreign key errors only at the commit, after
// runMigrations() returns. A failed commit resets the object with an error
// that does not name the migrations. This check finds the errors before the
// transaction ends, so that SQLite cancels the new migrations.
//
// The check also runs if a new migration mentions the pragma but sets it to
// OFF again. Setting it to OFF clears the count of errors in SQLite, so the
// commit succeeds and keeps the rows that break a foreign key.
function checkDeferredForeignKeys(sql, applied, current) {
  const deferred =
    sql.exec("PRAGMA defer_foreign_keys").one().defer_foreign_keys ||
    applied.some((migration) => /defer_foreign_keys/i.test(migration.sql));

  if (!deferred) {
    return;
  }

  const tables = new Set();
  try {
    for (const row of sql.exec("PRAGMA foreign_key_check")) {
      tables.add(row.table);
    }
  } catch (error) {
    throw new Error(
      `[migrations] The foreign key check after the new migrations failed. ` +
        `The database stays at version ${current}. Cause: ${error?.message}`,
      { cause: error },
    );
  }

  if (tables.size > 0) {
    throw new Error(
      `[migrations] The new migrations left rows that break a foreign key ` +
        `in these tables: ${[...tables].join(", ")}. The database stays at version ${current}.`,
    );
  }

  // The check found no errors. SQLite can still count errors that the
  // rows no longer have, for example after a table rename. Setting the
  // pragma to OFF clears this count, so that the commit does not fail.
  sql.exec("PRAGMA defer_foreign_keys = OFF");
}

// Gets the logger from the options and makes sure that it can write.
function getLogger(options) {
  if (options === null || typeof options !== "object") {
    throw new TypeError("[migrations] The options must be an object.");
  }

  const logger = options.logger ?? console;

  if (typeof logger?.log !== "function" || typeof logger?.warn !== "function") {
    throw new TypeError("[migrations] The logger must have the functions log() and warn().");
  }

  return logger;
}

// Sends one line to the logger. An error from the logger must not stop
// the object. Inside blockConcurrencyWhile(), such an error resets the
// object and cancels the migrations that ran.
function write(logger, method, message) {
  try {
    const value = logger[method](message);

    // An async logger returns a promise. The runner also ignores its rejection.
    if (typeof value?.then === "function") {
      value.then(undefined, () => {});
    }
  } catch {
    // The runner ignores the error.
  }
}

// Shows a value in an error message. JSON.stringify() can throw an
// error, and it shows NaN and Infinity as null.
function describe(value) {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") {
    return `${value}n`;
  }
  if (typeof value === "function") {
    return "a function";
  }
  if (typeof value === "object" && value !== null) {
    return "an object";
  }
  return String(value);
}
