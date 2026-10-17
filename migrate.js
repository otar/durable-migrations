// migrate.js
//
// Schema migrations for SQLite-backed Durable Objects.
// Raw SQL only. No dependencies.
//
// Call runMigrations() in the constructor of your Durable Object,
// inside ctx.blockConcurrencyWhile(). See README.md.

const TABLE = "_migrations";

/**
 * Runs the migrations that did not run on this Durable Object yet.
 *
 * All new migrations run in one transaction. If one of them fails,
 * SQLite cancels all of them, and this function throws the error.
 *
 * @param {DurableObjectStorage} storage The ctx.storage of the Durable Object.
 * @param {{version: number, name: string, sql: string}[]} migrations
 *   All migrations, in order. The versions must be 1, 2, 3, and more.
 * @returns {number} The schema version of the database after the call.
 */
export function runMigrations(storage, migrations) {
  checkList(migrations);

  const sql = storage.sql;
  const latest = migrations.length;

  const result = storage.transactionSync(() => {
    sql.exec(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        version    INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    const current = sql
      .exec(`SELECT COALESCE(MAX(version), 0) AS version FROM ${TABLE}`)
      .one().version;

    const applied = [];

    // The versions are 1, 2, 3, and more, so the new migrations
    // start at index `current` of the list.
    for (const migration of migrations.slice(current)) {
      try {
        sql.exec(migration.sql).toArray();
      } catch (error) {
        throw new Error(
          `[migrations] Migration ${migration.version} (${migration.name}) failed. ` +
            `The database stays at version ${current}. Cause: ${error.message}`,
          { cause: error },
        );
      }

      sql.exec(
        `INSERT INTO ${TABLE} (version, name) VALUES (?, ?)`,
        migration.version,
        migration.name,
      );
      applied.push(migration);
    }

    return { current, applied };
  });

  if (result.current > latest) {
    console.warn(
      `[migrations] The database is at version ${result.current}. ` +
        `The code has migrations only up to version ${latest}. No migration ran.`,
    );
    return result.current;
  }

  for (const migration of result.applied) {
    console.log(`[migrations] Migration ${migration.version} (${migration.name}) ran.`);
  }

  return latest;
}

// Makes sure that the list is correct before the database changes.
function checkList(migrations) {
  if (!Array.isArray(migrations)) {
    throw new TypeError("[migrations] The list of migrations must be an array.");
  }

  migrations.forEach((migration, index) => {
    const expected = index + 1;

    if (migration?.version !== expected) {
      throw new Error(
        `[migrations] Item ${expected} of the list must have version ${expected}. ` +
          `It has version ${JSON.stringify(migration?.version)}.`,
      );
    }
    if (typeof migration.name !== "string" || migration.name.trim() === "") {
      throw new Error(`[migrations] Migration ${expected} must have a name.`);
    }
    if (typeof migration.sql !== "string" || migration.sql.trim() === "") {
      throw new Error(`[migrations] Migration ${expected} must have SQL.`);
    }
  });
}
