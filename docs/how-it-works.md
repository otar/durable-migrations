# How it works

The runner (`runMigrations()`) runs in the constructor of each Durable Object. This page gives the steps of the runner, and it tells you when an object runs its migrations.

## How the runner operates

Each Durable Object has its own SQLite database. The runner keeps the migration history of the object in the table `_migrations`. Each row is one migration that ran: its version, its name, and the time (UTC).

When the object starts, the runner does these steps:

1. It makes sure that the storage, the list of migrations, and the options are correct. The version of each migration is the position of its key in the list.
2. If the table `_migrations` does not exist, it creates this table.
3. It reads all rows of `_migrations`.
4. It compares the name of each row with the name at the same position in the list. For example, it compares the second key with the name of the row that has version 2. If a name is different, it throws an error, and no migration runs. A row with a version that is higher than the number of migrations in the list comes from newer code. The runner does not compare its name.
5. It finds the database version. This is the highest version in `_migrations`, or 0.
6. It runs each migration that has a higher version, in the order of the keys. For each migration, it adds a row to `_migrations`.
7. If one or more migrations ran, and a new migration contains `defer_foreign_keys` or `PRAGMA defer_foreign_keys` is ON, it runs `PRAGMA foreign_key_check`. If rows break a foreign key, it throws an error. If not, it sets `PRAGMA defer_foreign_keys = OFF`.
8. It writes one log line for each migration that ran.

Steps 2 to 7 occur in one transaction, inside `storage.transactionSync()`.

| Condition | Result |
|---|---|
| The database has all migrations. | No migration runs. |
| The code has new migrations. | The runner runs them and records them. |
| A new migration fails. | SQLite cancels all new migrations. The database stays at its old version. The runner throws an error, and Cloudflare resets the object. The stub that got the error keeps the error. At the next request, the Worker must get a new stub with `namespace.get(id)`. Then the object starts again, and the runner tries again. This occurs at each request until you deploy a correction. If an alarm starts the object, Cloudflare can delete the alarm. See [When the migrations run](#when-the-migrations-run). |
| A migration leaves rows that break a foreign key (with `PRAGMA defer_foreign_keys`). | SQLite cancels all new migrations. The database stays at its old version. The runner throws an error that gives the tables. The result is the same as for a failed migration. |
| A row in `_migrations` has a name that is different from the name at the same position in the list. Example: you renamed or moved a deployed migration, or you added a migration before it. | The runner throws an error before a migration runs. The database does not change. The object does not start until you deploy code with the old name at the old position. |
| The database version is higher than the last version in the list. This can occur after a rollback of a deployment. | The runner writes a warning to the log. No migration runs, and the object starts. The old code then runs on the new schema, so each migration must be [compatible with the old code](writing-migrations.md#keep-the-schema-compatible-with-old-code). |
| The storage, the list of migrations, or the options are not correct. | The runner throws an error before it changes the database. The object does not start. |

The error message gives the failed migration and the cause, for example:

```
[migrations] Migration 5 (add_index) failed. The database stays at version 3. Cause: no such table: main.orders: SQLITE_ERROR
```

You can see the errors in Workers Logs and in `wrangler tail`. If the logger is `console`, the log lines and the warnings also show there.

## When the migrations run

The runner runs in the constructor of the Durable Object. The constructor runs one time each time that the object starts. It does not run for each request. While the object stays in memory, all requests go to the same instance, and the runner does not run again.

An object starts when it gets a request or an alarm and it is not in memory. An object is not in memory in these conditions:

- The object is new. It did not start before.
- The object was idle, and Cloudflare removed it from memory. If the object can hibernate, this occurs after approximately 10 seconds. If not, this occurs after 70 to 140 seconds.
- You deployed the Worker. A deployment stops each object that is in memory and gets new code.
- Cloudflare moved the object to a different machine, or updated the Workers runtime.

[Lifecycle of a Durable Object](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/) gives the full lifecycle.

A deployment does not start an object. An object that is not in memory stays stopped. Each object starts with the new code at its next request or alarm.

At each start, the runner compares `_migrations` with your list of migrations. Then it runs only the new migrations. After a deployment, the first start of each object runs the new migrations. All other starts find no new migration.

At a start without new migrations, the runner runs only two SQLite statements. If `_migrations` does not exist, the first statement creates it. The second statement reads all rows of `_migrations`. The database is on the same machine as the object, so these statements do not use the network.

`blockConcurrencyWhile()` holds all requests until the runner is complete. If the callback does not catch the error of the runner, a request never gets the new code with the old schema. Thus do not catch this error in the callback. If you catch it, throw it again. See [Rules](writing-migrations.md#rules).

If the runner throws an error, the start fails, and the request gets the error. The stub that got the error keeps the error. It does not start the object again. At the next request, the Worker must get a new stub with `namespace.get(id)`, for example `env.MY_DURABLE_OBJECT.get(id)`. Then the object starts again, and the runner tries again. Most Workers get a new stub for each request. If your Worker keeps a stub in a variable, it must get a new stub after an error. [Error handling](https://developers.cloudflare.com/durable-objects/best-practices/error-handling/) gives more information about stubs after an error.

CAUTION: If an alarm starts the object and the runner throws an error, `alarm()` does not run. Cloudflare tries the alarm again up to 6 times in a few minutes. Then Cloudflare deletes the alarm. If you deploy a correction after this time, the alarm does not run. Thus an object that gets only alarms does not start again. This applies to each error of the runner, and to migrations that go above the [time limit](writing-migrations.md#rules). Each failed try writes the error to the log, but no log line tells you that Cloudflare deleted the alarm.

Do not add a flag in memory to skip the runner. The object loses the flag each time that it stops. The next start has a new instance without the flag, so the runner runs anyway.

## You do not need to run migrations on all objects

After a deployment, you do not need a script or a CLI command that runs the migrations on all objects. Each object runs the new migrations at its next start, before its first request.

An object that is not in memory keeps its old schema. This is not a problem. No code reads its database until the object starts, and the start runs the migrations first.

A script or a CLI command also cannot replace the runner in the constructor:

- Wrangler has no command that runs SQL in a deployed Durable Object. You can send SQL to an object through your Worker, by hand in [Data Studio](#see-the-migration-history), or with the Cloudflare API. Each of these runs SQL on one object at a time. Thus a script must send SQL to each object.
- A call to an object starts the object. The start runs the constructor, and thus the runner, anyway.
- A new object comes into existence at its first request. No script can run before this request. Thus each object must create its own schema at its start.
- A script can run only after the deployment. Without the runner in the constructor, the new code runs with the old schema until the script gets to the object.
- A script must know the name or the ID of each object. If the script misses an object, that object keeps the old schema.

Before you deploy, do a test of the migrations. See [Do a test of your migrations](test-and-deploy.md#do-a-test-of-your-migrations).

## Delete all data of an object

`ctx.storage.deleteAll()` deletes all tables of the object. It also deletes `_migrations`. The instance stays in memory, and the runner runs only in the constructor. Thus each later request to this instance that uses one of these tables fails, for example with `no such table: users`. This continues until the instance leaves memory. If the object gets requests without a pause, the instance can stay in memory for a long time.

After `deleteAll()`, call `ctx.abort()`. This resets the object. At the next request, the object starts again, and the runner makes the schema again.

```js
async deleteAllData() {
  await this.ctx.storage.deleteAll();
  this.ctx.abort("The object deleted all its data.");
}
```

In `alarm()`, give `{ retryAlarm: false }` as the second argument of `ctx.abort()`. Then Cloudflare does not try the alarm again after the reset.

The call that aborts the object fails on purpose. Its error has the message that you gave to `ctx.abort()`, and its stub keeps this error. Thus the Worker must catch this error. Then it must send its own response. At the next request, the Worker must get a new stub. See [When the migrations run](#when-the-migrations-run).

## See the migration history

```js
this.ctx.storage.sql
  .exec("SELECT version, name, applied_at FROM _migrations ORDER BY version")
  .toArray();
```

The example Durable Object in [`examples/basic`](../examples/basic) has this query in `listMigrations()`.

To see the history of one deployed object without a deployment, use Data Studio in the Cloudflare dashboard:

1. Go to the **Durable Objects** page.
2. Select the namespace of your class.
3. Select **Data Studio**.
4. Give the name or the ID of the object.
5. Run `SELECT version, name, applied_at FROM _migrations ORDER BY version`.

Data Studio sends each query to the deployed object as a request. If the object is not in memory, this request starts it. Then the runner runs the new migrations before your query. You must have permission to change the Worker of the object. With read-only access, you cannot open Data Studio. See [Data Studio](https://developers.cloudflare.com/durable-objects/observability/data-studio/) and [Durable Objects roles and permissions](https://developers.cloudflare.com/workers/authorization/durable-objects/).

CAUTION: Do not change `_migrations` or the schema in Data Studio. See [Rules](writing-migrations.md#rules).

## Wrangler migrations are a different thing

The Wrangler configuration file declares the Durable Object classes in `exports` or in `migrations`. Examples are `"storage": "sqlite"` in `exports` and `new_sqlite_classes` in `migrations`. These declarations create or change Durable Object classes. They do not change your tables. For your tables, use `migrations.js` and the runner.
