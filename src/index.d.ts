// Type declarations for durable-migrations. The code is in index.js.
//
// The types do not use @cloudflare/workers-types. MigrationStorage has
// only the members of ctx.storage that the runner uses.

/**
 * The members of `ctx.storage` that the runner uses.
 *
 * The `ctx.storage` of a SQLite-backed Durable Object has all members of
 * this interface. `ctx` and `ctx.storage.sql` do not have them.
 */
export interface MigrationStorage {
  /**
   * The SQL API of the storage. The runner reads the rows of each cursor
   * with a loop, `toArray()`, or `one()`.
   */
  readonly sql: {
    exec(query: string, ...bindings: any[]): Iterable<unknown> & {
      toArray(): unknown[];
      one(): unknown;
    };
  };

  /** The runner runs all new migrations in one call of this function. */
  transactionSync<T>(closure: () => T): T;
}

/**
 * An object that gets the log lines and the warnings of the runner.
 *
 * `console` has all members of this interface. A function can return a
 * promise. The runner does not wait for this promise, and it ignores its
 * rejection.
 */
export interface MigrationLogger {
  /** Gets one line for each migration that ran. */
  log(message: string): void;

  /**
   * Gets a warning, for example if the database version is higher than
   * the last version in the list.
   */
  warn(message: string): void;
}

/** The options of `runMigrations()`. */
export interface RunMigrationsOptions {
  /**
   * The logger gets one line for each migration that ran, and the warnings.
   * The default is `console`. The runner ignores errors from the logger.
   */
  logger?: MigrationLogger | null | undefined;
}

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
 * Call this function in the constructor of your Durable Object, inside
 * `ctx.blockConcurrencyWhile()`:
 *
 * ```ts
 * ctx.blockConcurrencyWhile(async () => {
 *   runMigrations(ctx.storage, migrations);
 * });
 * ```
 *
 * @param storage The `ctx.storage` of a SQLite-backed Durable Object.
 * @param migrations
 *   All migrations, in order. Each key is the name of a migration, and each
 *   value is its SQL. The version of a migration is its position: the first
 *   key is version 1, the second key is version 2, and more.
 * @param options An object with the optional property `logger`.
 * @returns The database version after the call.
 */
export function runMigrations(
  storage: MigrationStorage,
  migrations: Readonly<Record<string, string>>,
  options?: RunMigrationsOptions,
): number;
