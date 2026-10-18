// These tests use the objects in worker.js. The objects run the migrations
// in their constructor, inside ctx.blockConcurrencyWhile(), as the README shows.

import { env } from "cloudflare:workers";
import { evictDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { history, query } from "./helpers.js";
import { records } from "./worker.js";

// Sends a request to the object and returns the status and the JSON body.
// A Worker gets a new stub for each request. This function does the same.
// After a failed start, the old stub keeps the error and does not start the object again.
async function request(namespace, id) {
  const response = await namespace.get(id).fetch("http://object/");
  return { status: response.status, body: await response.json() };
}

const LINES = [
  "[migrations] Migration 1 (create_notes) ran.",
  "[migrations] Migration 2 (add_notes_created_at) ran.",
];

const HISTORY = [
  [1, "create_notes"],
  [2, "add_notes_created_at"],
];

describe("runMigrations() in the constructor", () => {
  it("runs the migrations before the first request", async () => {
    const id = env.MIGRATING_OBJECT.newUniqueId();

    const response = await request(env.MIGRATING_OBJECT, id);

    expect(response).toEqual({ status: 200, body: { notes: 1 } });
    expect(records.get(id.toString())).toEqual({ starts: 1, lines: LINES });
  });

  it("does not run again while the object stays in memory", async () => {
    const id = env.MIGRATING_OBJECT.newUniqueId();

    await request(env.MIGRATING_OBJECT, id);
    const response = await request(env.MIGRATING_OBJECT, id);

    expect(response).toEqual({ status: 200, body: { notes: 2 } });
    expect(records.get(id.toString())).toEqual({ starts: 1, lines: LINES });
  });

  it("runs no migration when the object starts again", async () => {
    const id = env.MIGRATING_OBJECT.newUniqueId();
    await request(env.MIGRATING_OBJECT, id);

    await evictDurableObject(env.MIGRATING_OBJECT.get(id));
    const response = await request(env.MIGRATING_OBJECT, id);

    expect(response).toEqual({ status: 200, body: { notes: 2 } });
    expect(records.get(id.toString())).toEqual({ starts: 2, lines: LINES });
  });

  // workerd writes each failed start to its log as an uncaught exception.
  // To see these lines, set WORKERD_VERBOSE=1.
  it("fails each request when a migration fails, and tries again at the next request", async () => {
    const id = env.FAILING_OBJECT.newUniqueId();
    const error =
      /^\[migrations\] Migration 2 \(index_orders\) failed\. The database stays at version 0\. Cause: no such table/;

    await expect(request(env.FAILING_OBJECT, id)).rejects.toThrow(error);
    expect(records.get(id.toString())).toEqual({ starts: 1, lines: [] });

    await expect(request(env.FAILING_OBJECT, id)).rejects.toThrow(error);
    expect(records.get(id.toString())).toEqual({ starts: 2, lines: [] });
  });
});

// Inside blockConcurrencyWhile(), an error from the logger can reset the object
// and cancel the migrations. The runner ignores errors from the logger.
describe("a logger that throws an error in the constructor", () => {
  it("does not stop the start when log() throws", async () => {
    const namespace = env.LOG_ERROR_OBJECT;
    const id = namespace.newUniqueId();

    const first = await request(namespace, id);
    const second = await request(namespace, id);

    expect(first).toEqual({ status: 200, body: { notes: 1 } });
    expect(second).toEqual({ status: 200, body: { notes: 2 } });
    expect(records.get(id.toString())).toEqual({ starts: 1, lines: LINES });
    expect(await history(namespace.get(id))).toEqual(HISTORY);

    // The migrations that ran stay in the database. At the next start, no migration runs.
    await evictDurableObject(namespace.get(id));
    const third = await request(namespace, id);

    expect(third).toEqual({ status: 200, body: { notes: 3 } });
    expect(records.get(id.toString())).toEqual({ starts: 2, lines: LINES });
    expect(await history(namespace.get(id))).toEqual(HISTORY);
  });

  it("does not stop the start when warn() throws", async () => {
    const namespace = env.WARN_ERROR_OBJECT;
    const id = namespace.newUniqueId();
    await request(namespace, id);

    // Newer code ran migration 3. Then the object starts again with the old code.
    await query(namespace.get(id), "INSERT INTO _migrations (version, name) VALUES (3, 'add_notes_index')");
    await evictDurableObject(namespace.get(id));

    const first = await request(namespace, id);
    const second = await request(namespace, id);

    expect(first).toEqual({ status: 200, body: { notes: 2 } });
    expect(second).toEqual({ status: 200, body: { notes: 3 } });
    expect(records.get(id.toString())).toEqual({
      starts: 2,
      lines: [
        ...LINES,
        "[migrations] The database is at version 3. " +
          "The code has migrations only up to version 2. No migration ran.",
      ],
    });
    expect(await history(namespace.get(id))).toEqual([...HISTORY, [3, "add_notes_index"]]);
  });
});
