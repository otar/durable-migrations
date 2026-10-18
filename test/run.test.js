import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { runMigrations } from "../src/index.js";
import {
  history,
  migrate,
  migrations,
  newObject,
  query,
  recordingLogger,
  tableNames,
  take,
} from "./helpers.js";

describe("a new database", () => {
  it("runs all migrations and returns the last version", async () => {
    const object = newObject();

    const version = await migrate(object, migrations);

    expect(version).toBe(3);
    expect(await tableNames(object)).toEqual(["_migrations", "orders", "products", "users"]);
    expect(await history(object)).toEqual([
      [1, "create_users"],
      [2, "create_orders"],
      [3, "create_products"],
    ]);
  });

  it("records the time of each migration in UTC as 'YYYY-MM-DD HH:MM:SS'", async () => {
    const object = newObject();
    const before = Date.now();

    await migrate(object, migrations);

    const rows = await query(object, "SELECT applied_at FROM _migrations ORDER BY version");
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.applied_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      const time = Date.parse(`${row.applied_at.replace(" ", "T")}Z`);
      expect(Math.abs(time - before)).toBeLessThan(60_000);
    }
  });

  it("writes one log line for each migration, in order", async () => {
    const object = newObject();
    const logger = recordingLogger();

    await migrate(object, migrations, { logger });

    expect(logger.log.mock.calls).toEqual([
      ["[migrations] Migration 1 (create_users) ran."],
      ["[migrations] Migration 2 (create_orders) ran."],
      ["[migrations] Migration 3 (create_products) ran."],
    ]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("returns 0 for an empty object and creates an empty table _migrations", async () => {
    const object = newObject();
    const logger = recordingLogger();

    const version = await migrate(object, {}, { logger });

    expect(version).toBe(0);
    expect(await tableNames(object)).toEqual(["_migrations"]);
    expect(await history(object)).toEqual([]);
    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe("a database that has all migrations", () => {
  it("runs no migration and returns the same version", async () => {
    const object = newObject();
    await migrate(object, migrations);
    const before = await query(object, "SELECT * FROM _migrations ORDER BY version");
    const logger = recordingLogger();

    const version = await migrate(object, migrations, { logger });

    expect(version).toBe(3);
    expect(await query(object, "SELECT * FROM _migrations ORDER BY version")).toEqual(before);
    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe("a database that has some of the migrations", () => {
  it("runs only the new migrations", async () => {
    const object = newObject();
    await migrate(object, take(1));
    const logger = recordingLogger();

    const version = await migrate(object, take(2), { logger });

    expect(version).toBe(2);
    expect(logger.log.mock.calls).toEqual([["[migrations] Migration 2 (create_orders) ran."]]);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(await tableNames(object)).toEqual(["_migrations", "orders", "users"]);
    expect(await history(object)).toEqual([
      [1, "create_users"],
      [2, "create_orders"],
    ]);
  });

  it("keeps the data of the old migrations", async () => {
    const object = newObject();
    await migrate(object, take(1));
    await query(object, "INSERT INTO users (id, name) VALUES (1, 'Ana')");

    await migrate(object, migrations);

    expect(await query(object, "SELECT id, name FROM users")).toEqual([{ id: 1, name: "Ana" }]);
  });
});

describe("the default logger", () => {
  it("is console when the call has no options", async () => {
    const object = newObject();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const version = await runInDurableObject(object, (instance, state) =>
        runMigrations(state.storage, take(1)),
      );

      expect(version).toBe(1);
      expect(log.mock.calls).toEqual([["[migrations] Migration 1 (create_users) ran."]]);
    } finally {
      log.mockRestore();
    }
  });

  it.each([
    ["the options have no logger", {}],
    ["the logger is null", { logger: null }],
    ["the logger is undefined", { logger: undefined }],
  ])("is console when %s", async (_, options) => {
    const object = newObject();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const version = await migrate(object, take(1), options);

      expect(version).toBe(1);
      expect(log.mock.calls).toEqual([["[migrations] Migration 1 (create_users) ran."]]);
    } finally {
      log.mockRestore();
    }
  });

  it("writes the warning with console.warn()", async () => {
    const object = newObject();
    await migrate(object, take(2));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const version = await migrate(object, take(1), {});

      expect(version).toBe(2);
      expect(warn.mock.calls).toEqual([
        [
          "[migrations] The database is at version 2. " +
            "The code has migrations only up to version 1. No migration ran.",
        ],
      ]);
    } finally {
      warn.mockRestore();
    }
  });
});

// Inside blockConcurrencyWhile(), an error from the logger resets the object.
// Thus the runner ignores errors from the logger.
describe("a logger that throws an error", () => {
  function throwing() {
    throw new Error("The logger cannot write.");
  }

  it("does not stop the runner when log() throws", async () => {
    const object = newObject();
    const logger = { log: vi.fn(throwing), warn: vi.fn() };

    const version = await migrate(object, migrations, { logger });

    expect(version).toBe(3);
    expect(logger.log.mock.calls).toEqual([
      ["[migrations] Migration 1 (create_users) ran."],
      ["[migrations] Migration 2 (create_orders) ran."],
      ["[migrations] Migration 3 (create_products) ran."],
    ]);
    expect(await history(object)).toEqual([
      [1, "create_users"],
      [2, "create_orders"],
      [3, "create_products"],
    ]);
  });

  it("does not stop the runner when an async logger rejects", async () => {
    const object = newObject();
    const logger = {
      log: vi.fn(async () => throwing()),
      warn: vi.fn(async () => throwing()),
    };

    const version = await migrate(object, migrations, { logger });

    expect(version).toBe(3);
    expect(logger.log).toHaveBeenCalledTimes(3);
    expect(await history(object)).toHaveLength(3);
  });

  it("adds a rejection handler to the promise of an async logger", async () => {
    // A rejected promise without a handler is an unhandled rejection.
    // The test cannot see that inside the object, so it records the handler.
    const object = newObject();
    const promises = [];
    const logger = {
      log: vi.fn(() => {
        const promise = { then: vi.fn() };
        promises.push(promise);
        return promise;
      }),
      warn: vi.fn(),
    };

    await migrate(object, take(2), { logger });

    expect(promises).toHaveLength(2);
    for (const promise of promises) {
      expect(promise.then).toHaveBeenCalledWith(undefined, expect.any(Function));
    }
  });

  it("returns the database version when warn() throws", async () => {
    const object = newObject();
    await migrate(object, take(2));
    const logger = { log: vi.fn(), warn: vi.fn(throwing) };

    const version = await migrate(object, take(1), { logger });

    expect(version).toBe(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.log).not.toHaveBeenCalled();
    expect(await history(object)).toEqual([
      [1, "create_users"],
      [2, "create_orders"],
    ]);
  });
});
