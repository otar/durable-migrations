# Test and deploy

This page tells you how to do a test of your migrations and how to measure their time before you deploy them. It also tells you how to keep the code compatible during a deployment.

## Do a test of your migrations

To do a test of a migration on an object that has the old schema:

1. Run `wrangler dev` with the old code.
2. Send requests that make some objects and write data to them.
3. Change to the new code.
4. Run `wrangler dev` again. The local data stays in `.wrangler/state`.
5. Send a request to each object.
6. Make sure that the migration ran and that the requests succeed.

CAUTION: Before you deploy, do this test. If a migration fails, each object that starts with the new code cannot get requests. This continues until you deploy a correction. If an alarm starts the object, Cloudflare can delete the alarm. See [When the migrations run](how-it-works.md#when-the-migrations-run).

## Do a test with Vitest

You can also do a test with Vitest and `@cloudflare/vitest-plugin`. [Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/) tells you how to set up the plugin. In the test, `runInDurableObject()` from `cloudflare:test` starts the object. The constructor of the object runs all migrations. If a migration fails, `runInDurableObject()` rejects with the `[migrations]` error.

The plugin keeps the storage for all tests in one test file. If two tests in one file use the same ID, for example `idFromName("test")`, they get the same object. The second test then gets the data and the schema of the first test, and no migration runs. Thus use `newUniqueId()` in each test.

```js
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { migrations } from "../src/migrations.js";

it("runs all migrations on a new object", async () => {
  const stub = env.MY_DURABLE_OBJECT.get(env.MY_DURABLE_OBJECT.newUniqueId());
  const rows = await runInDurableObject(stub, (instance, state) =>
    state.storage.sql.exec("SELECT version FROM _migrations").toArray(),
  );
  expect(rows.length).toBe(Object.keys(migrations).length);
});
```

A test can also call `runMigrations(state.storage, migrations)` inside `runInDurableObject()`. A test on a new object does not replace the test on an object with the old schema. Some migrations fail only on old data. For example, a `UNIQUE` index fails on duplicate rows, but a new object has no rows.

## Do a test with Vitest on an object with the old schema

This test makes the schema of the deployed code and adds old rows. Then the constructor of the object runs the new migrations on these rows. In this example, the list has the migrations `create_users` and `add_users_email` from the README. The deployed code has only migration 1.

```js
import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { runMigrations } from "durable-migrations";
import { expect, it } from "vitest";
import { migrations } from "../src/migrations.js";

it("runs the new migrations on an object with the old schema", async () => {
  const id = env.MY_DURABLE_OBJECT.newUniqueId();
  const stub = env.MY_DURABLE_OBJECT.get(id);

  // The constructor already ran all migrations. Remove them, make the old schema, and add old rows.
  const oldVersion = await runInDurableObject(stub, async (instance, state) => {
    await state.storage.deleteAll();
    runMigrations(state.storage, Object.fromEntries(Object.entries(migrations).slice(0, 1)));
    state.storage.sql.exec("INSERT INTO users (name) VALUES ('Ada'), ('Grace')");
    return state.storage.sql.exec("SELECT max(version) AS version FROM _migrations").one().version;
  });
  // Make sure that the setup made the old schema. Without this check, an incorrect setup also passes.
  expect(oldVersion).toBe(1);

  // Stop the object. A new stub starts it again, and the constructor runs the new migrations.
  await evictDurableObject(stub);
  const result = await runInDurableObject(env.MY_DURABLE_OBJECT.get(id), (instance, state) => ({
    version: state.storage.sql.exec("SELECT max(version) AS version FROM _migrations").one().version,
    columns: state.storage.sql.exec("PRAGMA table_info(users)").toArray().map((column) => column.name),
    users: state.storage.sql.exec("SELECT name, email FROM users ORDER BY id").toArray(),
  }));

  expect(result.version).toBe(Object.keys(migrations).length);
  expect(result.columns).toEqual(["id", "name", "email"]);
  expect(result.users).toEqual([
    { name: "Ada", email: null },
    { name: "Grace", email: null },
  ]);
});
```

The call to `deleteAll()` is necessary. On an object that ran all migrations, a shorter list does nothing. The runner writes a warning, and no migration runs. `deleteAll()` removes all tables and `_migrations`. In the code of your object, after `deleteAll()`, call `ctx.abort()`. See [Delete all data of an object](how-it-works.md#delete-all-data-of-an-object).

The test makes the list of the deployed code with `Object.fromEntries()` and a slice of the list in `migrations.js`. The slice keeps the order of the keys, so this is correct in a test. Do not use `Object.fromEntries()` in `migrations.js`. See [Names and order](writing-migrations.md#names-and-order).

## Measure the time of the migrations

CAUTION: Local tests do not stop a slow migration. In `wrangler dev` and in Vitest, a migration that runs for more than 30 seconds can complete without an error. In production, the same migration can go above the time limit, and Cloudflare resets the object. See the time limit in [Rules](writing-migrations.md#rules).

To measure the time of the new migrations:

1. Make an object with the old schema. Add as many rows as your largest object has.
2. Start the object with the new code. Measure the time of the first request.
   - `wrangler dev` shows the time of each request, for example `[wrangler:info] GET /migrations 200 OK (35ms)`.
   - In Vitest, use the test of [the old schema](#do-a-test-with-vitest-on-an-object-with-the-old-schema). Give the test a long timeout. The default timeout of Vitest is 5 seconds. Measure the time of the request after `evictDurableObject()` with `Date.now()`.
3. Make sure that the time is much less than the time limit.

```js
it("runs the new migrations in less than 10 seconds", async () => {
  // Make the old schema, add the rows, and call evictDurableObject(stub), as in the test above.

  const start = Date.now();
  await runInDurableObject(env.MY_DURABLE_OBJECT.get(id), () => {});
  expect(Date.now() - start).toBeLessThan(10_000);
}, 120_000);
```

## Keep the methods compatible during a deployment

Cloudflare deploys a new version to all locations over a short time, usually seconds to minutes. During this time, the old code and the new code run at the same time:

- A Worker with the new code can call an object that still has the old code.
- A Worker with the old code can call an object that already has the new code.

A gradual deployment and a rollback also mix the two versions.

When you deploy a new version to all objects, the schema does not cause errors. Only the object reads its database, and each object runs its migrations before its code runs. A gradual deployment is also safe if it only increases the percentage of the new version, and the versions stay in the same order. Then an object that has the new version does not go back to the old version. See [Gradual deployments with Durable Objects](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/with-durable-objects/).

A rollback is different. A gradual deployment that decreases the percentage of the new version or changes the order of the versions is also different. Then an object that ran the new migrations can start with the old code. The runner writes a warning, and the old code runs on the new schema. Thus each migration must be compatible with the old code. See [Keep the schema compatible with old code](writing-migrations.md#keep-the-schema-compatible-with-old-code).

The methods that the Worker calls on the object are also a risk. When you change the methods of the object, use these rules:

- Do not change the arguments of a method that already exists. You can add an optional argument at the end.
- Do not remove a property from a return value. Do not change the type of a property. You can add a property.
- To replace a method, add a new method with a new name. Remove the old method only in a later deployment.
- A new method does not exist in an object that still has the old code. Thus a call to a new method can fail during the deployment. To prevent this, add the method in one deployment. Call it from the Worker in a later deployment.

These rules also apply to `fetch()` routes and to the request and response bodies of the object.
