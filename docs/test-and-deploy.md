# Test and deploy

This page tells you how to do a test of your migrations before you deploy them. It also tells you how to change the methods of an object during a deployment.

## Do a test of your migrations

To do a test of a migration on an object that has the old schema:

1. Run `wrangler dev` with the old code.
2. Send requests that make some objects and write data to them.
3. Change to the new code.
4. Run `wrangler dev` again. The local data stays in `.wrangler/state`.
5. Send a request to each object.
6. Make sure that the migration ran and that the requests succeed.

CAUTION: Before you deploy, do this test. If a migration fails, each object that starts with the new code cannot get requests. This continues until you deploy a correction.

You can also do a test with Vitest and `@cloudflare/vitest-plugin`. In the test, `runInDurableObject()` from `cloudflare:test` starts a new object. The constructor of the object runs all migrations. If a migration fails, `runInDurableObject()` rejects with the `[migrations]` error.

```js
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { migrations } from "../src/migrations.js";

it("runs all migrations on a new object", async () => {
  const stub = env.MY_DURABLE_OBJECT.get(env.MY_DURABLE_OBJECT.idFromName("test"));
  const rows = await runInDurableObject(stub, (instance, state) =>
    state.storage.sql.exec("SELECT version FROM _migrations").toArray(),
  );
  expect(rows.length).toBe(Object.keys(migrations).length);
});
```

A test can also call `runMigrations(state.storage, migrations)` inside `runInDurableObject()`. A test on a new object does not replace the test on an object with the old schema.

## Keep the methods compatible during a deployment

Cloudflare deploys a new version to all locations over a short time, usually seconds to minutes. During this time, the old code and the new code run at the same time:

- A Worker with the new code can call an object that still has the old code.
- A Worker with the old code can call an object that already has the new code.

A gradual deployment and a rollback also mix the two versions.

The schema does not cause errors here. Only the object reads its database, and each object runs its migrations before its code runs. The risk is in the methods that the Worker calls on the object.

When you change the methods of the object, use these rules:

- Do not change the arguments of a method that already exists. You can add an optional argument at the end.
- Do not remove a property from a return value. Do not change the type of a property. You can add a property.
- To replace a method, add a new method with a new name. Remove the old method only in a later deployment.
- A new method does not exist in an object that still has the old code. Thus a call to a new method can fail during the deployment. To prevent this, add the method in one deployment. Call it from the Worker in a later deployment.

These rules also apply to `fetch()` routes and to the request and response bodies of the object.
