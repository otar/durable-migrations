// The Worker that the tests run in. The tests call runMigrations()
// inside these objects with runInDurableObject().

import { DurableObject } from "cloudflare:workers";
import { runMigrations } from "../src/index.js";

// A SQLite-backed Durable Object.
export class SqliteObject extends DurableObject {}

// A Durable Object with the old key-value storage, without SQLite.
export class KvObject extends DurableObject {}

// The objects below run the migrations in their constructor, as the README shows.
// This map records what each object did, by object ID. The tests read it.
// The tests and the objects run in the same isolate, so they share this module.
export const records = new Map();

function getRecord(ctx) {
  const id = ctx.id.toString();
  if (!records.has(id)) {
    records.set(id, { starts: 0, lines: [] });
  }
  return records.get(id);
}

const migrations = {
  create_notes: "CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT NOT NULL);",
  add_notes_created_at: "ALTER TABLE notes ADD COLUMN created_at TEXT;",
};

// Migration 2 refers to a table that does not exist, so it fails.
const failingMigrations = {
  create_notes: migrations.create_notes,
  index_orders: "CREATE INDEX orders_user_id ON orders (user_id);",
};

// Makes a logger that records each line. If `failing` is "log" or "warn",
// this function of the logger throws an error after it records the line.
function makeLogger(record, failing) {
  const write = (method) => (message) => {
    record.lines.push(message);
    if (method === failing) {
      throw new Error(`The logger cannot write with ${method}().`);
    }
  };
  return { log: write("log"), warn: write("warn") };
}

// Counts the start, and runs the migrations before the object accepts requests.
function start(ctx, list, failing) {
  const record = getRecord(ctx);
  record.starts += 1;

  const logger = makeLogger(record, failing);

  ctx.blockConcurrencyWhile(async () => {
    runMigrations(ctx.storage, list, { logger });
  });
}

// Adds a note and returns the number of notes.
function addNote(ctx) {
  const sql = ctx.storage.sql;
  sql.exec("INSERT INTO notes (text, created_at) VALUES ('hello', datetime('now'))");
  const notes = sql.exec("SELECT count(*) AS count FROM notes").one().count;
  return Response.json({ notes });
}

// An object with a correct list of migrations.
export class MigratingObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    start(ctx, migrations);
  }

  async fetch() {
    return addNote(this.ctx);
  }
}

// An object with a correct list of migrations and a logger that throws in log().
export class LogErrorObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    start(ctx, migrations, "log");
  }

  async fetch() {
    return addNote(this.ctx);
  }
}

// An object with a correct list of migrations and a logger that throws in warn().
export class WarnErrorObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    start(ctx, migrations, "warn");
  }

  async fetch() {
    return addNote(this.ctx);
  }
}

// An object with a list of migrations that fails.
export class FailingObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    start(ctx, failingMigrations);
  }

  async fetch() {
    return Response.json({ started: true });
  }
}

export default {
  async fetch() {
    return new Response("Not found", { status: 404 });
  },
};
