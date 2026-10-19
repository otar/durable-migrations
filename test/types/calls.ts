// Correct calls of runMigrations(). tsc must find no error in this file.

import { DurableObject } from "cloudflare:workers";
import {
  runMigrations,
  type MigrationLogger,
  type MigrationStorage,
  type RunMigrationsOptions,
} from "durable-migrations";

const migrations = {
  create_users: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);",
  add_users_email: "ALTER TABLE users ADD COLUMN email TEXT;",
};

// The call in the README, in a class that extends DurableObject.
export class MyDurableObject extends DurableObject {
  version = 0;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.version = runMigrations(ctx.storage, migrations);
    });
  }

  migrateAgain(): number {
    return runMigrations(this.ctx.storage, migrations);
  }
}

declare const ctx: DurableObjectState;

// The runner returns a number. The error on the second line shows that the
// return type is not any.
const version: number = runMigrations(ctx.storage, migrations);
// @ts-expect-error The runner returns a number, not a string.
const name: string = runMigrations(ctx.storage, migrations);

// The storage of a Durable Object has all members of MigrationStorage.
const storage: MigrationStorage = ctx.storage;
runMigrations(storage, migrations);

// The empty list.
runMigrations(ctx.storage, {});

// A list "as const", a frozen list, and a list with the type Record<string, string>.
const constList = {
  create_users: "CREATE TABLE users (id INTEGER PRIMARY KEY);",
} as const;
runMigrations(ctx.storage, constList);

const frozenList = Object.freeze({
  create_users: "CREATE TABLE users (id INTEGER PRIMARY KEY);",
});
runMigrations(ctx.storage, frozenList);

const recordList: Record<string, string> = {
  create_users: "CREATE TABLE users (id INTEGER PRIMARY KEY);",
};
runMigrations(ctx.storage, recordList);

const readonlyList: Readonly<Record<string, string>> = recordList;
runMigrations(ctx.storage, readonlyList);

// The options.
runMigrations(ctx.storage, migrations, {});
runMigrations(ctx.storage, migrations, { logger: console });
runMigrations(ctx.storage, migrations, { logger: undefined });
runMigrations(ctx.storage, migrations, { logger: null });
runMigrations(ctx.storage, migrations, { logger: { log() {}, warn() {} } });

// A logger with functions that return a promise.
declare function send(level: string, message: string): Promise<void>;

runMigrations(ctx.storage, migrations, {
  logger: {
    log: async (message) => send("info", message),
    warn: async (message) => send("warn", message),
  },
});

// The exported types of the logger and the options.
const logger: MigrationLogger = console;
const options: RunMigrationsOptions = { logger };
runMigrations(ctx.storage, migrations, options);

