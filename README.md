# durable-migrations

Schema migrations for SQLite-backed Cloudflare Durable Objects. Raw SQL. One function. No dependencies.

[![CI](https://github.com/otar/durable-migrations/actions/workflows/ci.yml/badge.svg)](https://github.com/otar/durable-migrations/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/durable-migrations)](https://www.npmjs.com/package/durable-migrations)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

```js
// migrations.js: each key is the name of a migration, and each value is its SQL.
export const migrations = {
  create_users: `
    CREATE TABLE users (
      id   INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    );
  `,
  add_users_email: "ALTER TABLE users ADD COLUMN email TEXT;",
};

// The constructor of your Durable Object:
ctx.blockConcurrencyWhile(async () => {
  runMigrations(ctx.storage, migrations);
});
```

The package exports one function, `runMigrations()` (the runner), and the TypeScript types for it. Each object runs its new migrations at its next start, before its first request. You do not need a script that runs the migrations on all objects.

## Why durable-migrations

- **All or nothing.** All new migrations run in one transaction. If one migration fails, SQLite cancels all of them.
- **History check.** If you rename or move a deployed migration, the runner throws an error, and no migration runs.
- **List check.** Before the database changes, the runner finds errors in the list. An example is a list from `import * as`, which can sort the keys.
- **Foreign key check.** If a migration defers foreign keys, the runner finds the rows that break a foreign key before the commit.
- **Tested in workerd.** The tests run the runner in the Workers runtime with Vitest.

## Quick start

**Requirement:** a SQLite-backed Durable Object class. In the Wrangler configuration file, this is `"storage": "sqlite"` in `exports`, or `new_sqlite_classes` in `migrations`. The runner does not operate with the old key-value storage.

1. Install the package:

   ```sh
   npm install durable-migrations
   ```

2. Make a file `migrations.js` next to your Durable Object class. Each key is the name of a migration, and each value is its SQL:

   ```js
   // @ts-check

   /** @type {Record<string, string>} */
   export const migrations = {
     create_users: `
       CREATE TABLE users (
         id   INTEGER PRIMARY KEY,
         name TEXT NOT NULL
       );
     `,
   };
   ```

   With the line `// @ts-check`, your editor shows an error for two keys with the same name.

3. If your constructor has `CREATE TABLE` or `CREATE INDEX` statements, move them into migration 1. Keep `IF NOT EXISTS` in these statements. [Move the tables of your constructor](docs/writing-migrations.md#move-the-tables-of-your-constructor-into-migration-1) gives the reason.

4. In the constructor of your Durable Object, call `runMigrations()` inside `ctx.blockConcurrencyWhile()`:

   ```js
   import { DurableObject } from "cloudflare:workers";
   import { runMigrations } from "durable-migrations";
   import { migrations } from "./migrations.js";

   export class MyDurableObject extends DurableObject {
     constructor(ctx, env) {
       super(ctx, env);
       ctx.blockConcurrencyWhile(async () => {
         runMigrations(ctx.storage, migrations);
       });
     }
   }
   ```

5. If the class is new, declare it in the Wrangler configuration file. Use `exports` or `migrations`. Do not use both for Durable Object classes in one configuration file.

   - `exports` (Wrangler 4.107.0 or later):

     ```jsonc
     "exports": {
       "MyDurableObject": { "type": "durable-object", "storage": "sqlite" }
     }
     ```

   - `migrations`:

     ```jsonc
     "migrations": [
       { "tag": "v1", "new_sqlite_classes": ["MyDurableObject"] }
     ]
     ```

     If `migrations` already has an entry, do not change it. Add a new entry with a new tag, for example `"v2"`.

6. Deploy the Worker.

[`examples/basic`](examples/basic) has a full Worker that uses the runner. If you copied `migrate.js` into your project before, see [Upgrade from the copied files](#upgrade-from-the-copied-files). If a different tool runs your migrations, for example durable-utils, `@cloudflare/actors`, or Drizzle, see [Change from other tools](docs/change-from-other-tools.md).

## How it works

Each Durable Object has its own SQLite database. The runner keeps the migration history of the object in the table `_migrations`. The version of a migration is its position in the list. The first key is version 1.

At each start, the runner compares `_migrations` with the list. Then it runs the new migrations in one transaction. For each migration that ran, it writes one log line:

```
[migrations] Migration 2 (add_users_email) ran.
```

`blockConcurrencyWhile()` holds all requests until the runner is complete. If the callback does not catch the error of the runner, a request never gets the new code with the old schema.

If a migration fails, SQLite cancels all new migrations, and the start of the object fails. The runner tries again at the next start. [How it works](docs/how-it-works.md) gives the full lifecycle.

## Rules

- Add a new migration only at the end of the list. After you deploy a migration, do not change, move, or remove it. To correct an error, add a new migration.
- Give each migration a name that no other migration has. For two keys with the same name, JavaScript keeps only the last value, and no error occurs.
- Do not use a name that contains only digits, for example `42`. Do not use the name `__proto__`.
- Keep all migrations in one object literal. Import the list by its name. Do not use `import * as`, spread syntax (`...`), or `Object.assign()`. Do not sort the keys.
- Do not put a comment or an extra semicolon after the last statement of a migration.
- Do not use `BEGIN`, `COMMIT`, `ROLLBACK`, or `SAVEPOINT`. The runner controls the transaction.
- Make sure that all new migrations complete in less than 30 seconds. This is the time limit of `blockConcurrencyWhile()` and the default CPU time limit. If you set a lower `limits.cpu_ms`, use that value. Local tests do not stop a slow migration.
- Do not catch the error of the runner in the callback of `blockConcurrencyWhile()`. If you catch it, throw it again.
- Each migration must be compatible with the old code that you can roll back to. See [Keep the schema compatible with old code](docs/writing-migrations.md#keep-the-schema-compatible-with-old-code).
- Before you deploy, do a test of the new migrations on an object that has the old schema.

[Write migrations](docs/writing-migrations.md) gives all rules and the reasons for them.

## API

```js
runMigrations(storage, migrations, options?)
```

- `storage`: the `ctx.storage` of the Durable Object. If you give `ctx` or `ctx.storage.sql`, the runner throws a `TypeError`.
- `migrations`: an object literal with all migrations, in order. Each key is the name of a migration, and each value is its SQL.
- `options.logger` (optional): an object with the functions `log(message)` and `warn(message)`. The default is `console`.

The runner is synchronous. It returns the database version after the call.

Each error of the runner starts with `[migrations]`. If a migration fails, the `cause` property of the error contains the original error. In all error conditions, the database does not change. [Errors and warnings](docs/api.md#errors-and-warnings) gives each message.

## Guides

| Guide | Content |
|---|---|
| [How it works](docs/how-it-works.md) | The steps of the runner, when an object runs its migrations, why you do not need a script, and how to delete all data |
| [Write migrations](docs/writing-migrations.md) | How to add a migration, names and order, linters that sort keys, `.sql` files, a schema that old code can use, and all rules |
| [Rebuild a table](docs/rebuild-a-table.md) | Changes that `ALTER TABLE` cannot do, with foreign keys |
| [Test and deploy](docs/test-and-deploy.md) | Tests with `wrangler dev` and Vitest, the time of the migrations, and compatible code during a deployment |
| [API](docs/api.md) | Parameters, logger, return value, and each error and warning |
| [TypeScript](docs/typescript.md) | The types of the package, and type checks with `tsc` and `// @ts-check` |
| [Change from other tools](docs/change-from-other-tools.md) | How to change from durable-utils, `@cloudflare/actors`, Drizzle, or a runner that you wrote |
| [Example](examples/basic) | A full Worker that uses the runner |
| [CHANGELOG.md](CHANGELOG.md) | The changes in each version. Before 1.0.0, a minor version can change the API. |

## Upgrade from the copied files

Before version 0.1.0, you copied the files `migrate.js` and `migrations.js` into your project. In these files, the list of migrations is an array. For an array, the runner of the package throws a `TypeError`, and the database does not change.

The table `_migrations` did not change. Thus the objects keep their migration history. [Upgrade from the copied files](docs/upgrade-from-copied-files.md) gives the steps to change to the package.

## License

MIT. See [LICENSE](LICENSE).
