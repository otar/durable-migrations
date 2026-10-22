# Change from other tools

This page tells you how to change to the runner from durable-utils, `@cloudflare/actors`, Drizzle, or a runner that you wrote. If you copied `migrate.js` from this project before version 0.1.0, see [Upgrade from the copied files](upgrade-from-copied-files.md).

In each object, the old runner records which old migrations ran. The runner does not read these records. Thus the old runner must continue to run the old migrations, and the runner runs only the new migrations.

## Change to the runner

1. Install the package with `npm install durable-migrations`.
2. Keep the old runner and its list of migrations. Do not change the old list.
3. Make a file `migrations.js` for the new migrations. Do not copy the old migrations into this file.
4. In the constructor, inside `ctx.blockConcurrencyWhile()`, call the old runner first. Then call `runMigrations()` inside the same `ctx.blockConcurrencyWhile()`. The new migrations change the tables that the old migrations make.

   If the old runner runs in a method, for example before each query, move this call into the constructor.

5. Do a test with each of these objects. See [Do a test of your migrations](test-and-deploy.md#do-a-test-of-your-migrations).
   - An object that ran all old migrations.
   - An object that ran only some old migrations. To make this object, start it with an older version of your code.
   - A new object.

   Make sure that the three objects get the same schema.

6. Deploy the Worker.

## Example

This example uses durable-utils:

```js
import { DurableObject } from "cloudflare:workers";
import { SQLSchemaMigrations } from "durable-utils/sql-migrations";
import { runMigrations } from "durable-migrations";
// The old list of durable-utils. Do not change it.
import { oldMigrations } from "./old-migrations.js";
// Only the migrations that you add after the change.
import { migrations } from "./migrations.js";

export class MyDurableObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const oldRunner = new SQLSchemaMigrations({
      doStorage: ctx.storage,
      migrations: oldMigrations,
    });
    ctx.blockConcurrencyWhile(async () => {
      await oldRunner.runAll();
      runMigrations(ctx.storage, migrations);
    });
  }
}
```

`await oldRunner.runAll()` operates with all versions of durable-utils.

For `@cloudflare/actors`, the old runner is `await this.storage.runMigrations()`, and the old list is in `this.storage.migrations`. In an `Actor`, `this.storage` is not `ctx.storage`. Give `ctx.storage` to `runMigrations()`.

For Drizzle, the old runner is `await migrate(db, oldMigrations)` from `drizzle-orm/durable-sqlite/migrator`, and the old list is the default export of the `migrations.js` file that `drizzle-kit generate` made.

## Rules

- Do not remove the old runner, its list, or its package. Each new object needs the old migrations to make its first tables. An object that ran only some old migrations needs the old runner at its next start.
- Add each new migration to `migrations.js`. Do not add a migration to the old list. For Drizzle, after the change, do not run `drizzle-kit generate`. If the Drizzle schema changed, this command adds a migration to the old list.
- Make sure that the old runner does not use a table with the name `_migrations`. The runner keeps its history in this table. If the old runner also uses it, the runner can throw an error. Then the object does not start. See [Errors and warnings](api.md#errors-and-warnings).

CAUTION: Do not copy the old migrations into `migrations.js`. The old runner does not write to `_migrations`. Thus the runner runs the old migrations again on each object that ran them. If a migration fails, for example with `table users already exists`, the object does not start. If no migration fails, the statements that change rows run again, for example `INSERT` and `UPDATE`.

CAUTION: Do not replace the old migrations with one migration that has `CREATE TABLE IF NOT EXISTS` for the current schema. On an object that ran only some old migrations, SQLite skips this statement. The object keeps its old schema, and no error occurs.
