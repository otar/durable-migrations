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

// JavaScript moves keys such as "1" and "42" before all other keys of an
// object, in numeric order. Thus such a name can change the order of the
// migrations. The runner refuses each name that contains only digits.
const ONLY_DIGITS = /^[0-9]+$/;

const AN_ARRAY =
  "[migrations] The list of migrations must be an object, not an array. " +
  "Write each migration as a property, in the same order. " +
  "The key is the name of the migration, and the value is its SQL. Remove the versions. " +
  'See "Upgrade from the copied files" in the README.';

const NOT_AN_OBJECT_LITERAL =
  "[migrations] The list of migrations must be an object literal. " +
  'Do not use a module namespace object ("import * as"), a Map, a class instance, ' +
  "an object without a prototype, or getters. A module namespace object can sort its keys. " +
  "Do not copy it with spread (...) or Object.assign(). " +
  'Import the list by its name, for example import { migrations } from "./migrations.js".';

/**
 * Runs the migrations that did not run on this Durable Object yet.
 *
 * All new migrations run in one transaction. If one of them fails,
 * SQLite cancels all of them, and the runner throws a `[migrations]` error.
 * The `cause` property of this error contains the original error.
 *
 * Before a migration runs, the runner compares the names in the table
 * `_migrations` with the names at the same positions in the list. If a name
 * is different, the runner throws an error, and no migration runs.
 *
 * @param {DurableObjectStorage} storage The ctx.storage of the Durable Object.
 * @param {Record<string, string>} migrations
 *   All migrations, in order. Each key is the name of a migration, and each
 *   value is its SQL. The version of a migration is its position: the first
 *   key is version 1, the second key is version 2, and more.
 * @param {{logger?: {log(message: string): void, warn(message: string): void}}} [options]
 *   The logger gets one line for each migration that ran, and the warnings.
 *   The default is `console`. The runner ignores errors from the logger.
 * @returns {number} The database version after the call.
 */
export function runMigrations(storage, migrations, options = {}) {
  checkStorage(storage);
  const list = readList(migrations);
  const logger = getLogger(options);

  const sql = storage.sql;
  const latest = list.length;

  let result;
  try {
    result = storage.transactionSync(() => migrate(sql, list));
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
  // The table and its columns are part of the API. A change to them is a
  // breaking change. See "Versions" in docs/api.md.
  sql.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Other code can make a table or a view with the same name. If it does not
  // have the columns version and name, the SELECT fails.
  let history;
  try {
    history = sql
      .exec(`SELECT version, name FROM ${TABLE} ORDER BY version`)
      .toArray();
  } catch (error) {
    throw new Error(
      `[migrations] The runner cannot read the table ${TABLE}. ` +
        `Make sure that no other code uses this table name. Cause: ${error?.message}`,
      { cause: error },
    );
  }

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
// Returns the migrations as an array of {version, name, sql}. The version of
// a migration is the position of its key: 1, 2, 3, and more.
//
// The runner reads the object only here. It reads each value one time, from
// the property descriptor. Thus it calls no getter, and a later change to the
// object has no effect.
function readList(migrations) {
  if (migrations === null || typeof migrations !== "object") {
    throw new TypeError(
      "[migrations] The list of migrations must be an object. " +
        "Each key is the name of a migration, and each value is its SQL. " +
        `It is ${describeType(migrations)}.`,
    );
  }

  if (Array.isArray(migrations)) {
    throw new TypeError(AN_ARRAY);
  }

  // "import * as" gives a module namespace object. In Node.js, in workerd,
  // and in the Wrangler bundle, this object sorts its keys. Without a bundler,
  // and in Vitest, this object has no prototype. Rollup makes a frozen object
  // without a prototype. esbuild (Wrangler) and Rolldown make an object with
  // a getter for each export. The property check below finds the getters.
  if (Object.getPrototypeOf(migrations) !== Object.prototype) {
    throw new TypeError(NOT_AN_OBJECT_LITERAL);
  }

  return Object.keys(migrations).map((name, index) => {
    const version = index + 1;

    // Keys such as "1" and "42" are first in Object.keys(), so their position
    // is not the position in the file. Thus this error gives no position.
    if (ONLY_DIGITS.test(name)) {
      throw new Error(
        `[migrations] The name "${name}" contains only digits. ` +
          'JavaScript moves keys such as "1" and "42" before all other keys of an object, ' +
          "so the order of the migrations can change. " +
          `Add a letter to the name, for example "m${name}".`,
      );
    }
    if (name.trim() === "") {
      throw new Error(`[migrations] Migration ${version} must have a name.`);
    }
    // In an object literal, "__proto__: value" makes no property. The runner
    // also refuses this name when it gets it in a different way, for example
    // from JSON.parse(). Thus the rule is the same for all lists.
    if (name === "__proto__") {
      throw new Error(
        '[migrations] Do not use the name "__proto__". ' +
          "In an object literal, JavaScript makes no property for this key, and the migration is lost.",
      );
    }

    const property = Object.getOwnPropertyDescriptor(migrations, name);

    if (property === undefined || !("value" in property)) {
      throw new TypeError(NOT_AN_OBJECT_LITERAL);
    }
    if (typeof property.value !== "string" || property.value.trim() === "") {
      throw new Error(
        `[migrations] Migration ${version} (${name}) must have SQL. ` +
          "The value must be a string that is not empty and not only white space.",
      );
    }

    return { version, name, sql: property.value };
  });
}

// Makes sure that each migration that ran has the same name at the same
// position in the list. A different name shows that a person renamed, moved,
// or replaced a deployed migration. Then the new migrations can run on the
// wrong schema.
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
          `The list has the name "${migration.name}" at position ${row.version}. ` +
          `Do not change, move, or remove a deployed migration. ` +
          `Put "${row.name}" back at position ${row.version}, and add your change as a new migration at the end.`,
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

// Makes sure that the storage is ctx.storage, not ctx or ctx.storage.sql.
// A function with transactionSync() and sql also passes. In a unit test, a
// deep mock of ctx makes ctx.storage a Proxy around a function.
//
// The storage of a class without SQLite also has transactionSync() and sql.
// Thus it passes this check, and the first sql.exec() throws the error from
// Cloudflare. That error tells the caller that the class has no SQLite.
// The "in" operator calls no getter, and runMigrations() reads storage.sql
// only after all checks.
function checkStorage(storage) {
  if (
    storage === null ||
    (typeof storage !== "object" && typeof storage !== "function") ||
    typeof storage.transactionSync !== "function" ||
    !("sql" in storage)
  ) {
    throw new TypeError(
      "[migrations] The storage must be ctx.storage, the storage of the Durable Object. " +
        "Do not give ctx or ctx.storage.sql.",
    );
  }
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

// Names the type of a value in an error message, for example "a string".
function describeType(value) {
  return value === null || value === undefined ? String(value) : `a ${typeof value}`;
}
