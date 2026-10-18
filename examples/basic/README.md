# Example: basic

This example is a Worker with one SQLite-backed Durable Object. The object runs its migrations with `durable-migrations` in its constructor.

| File | Content |
|---|---|
| `src/index.js` | The Durable Object, and the Worker that sends the requests to it |
| `src/migrations.js` | The list of migrations |
| `wrangler.jsonc` | The Wrangler configuration file |

The example installs the package from this repository (`file:../..`). In your project, use `npm install durable-migrations`.

## Run the example

1. Go to the folder of the example:

   ```sh
   cd examples/basic
   ```

2. Install the dependencies:

   ```sh
   npm install
   ```

3. Start the Worker:

   ```sh
   npm run dev
   ```

4. In a different terminal, add a user:

   ```sh
   curl -X POST http://localhost:8787/users -H "content-type: application/json" -d '{"name": "Ada", "email": "ada@example.com"}'
   ```

5. Get the list of users:

   ```sh
   curl http://localhost:8787/users
   ```

6. Get the migration history of the object:

   ```sh
   curl http://localhost:8787/migrations
   ```

The first request starts the object. The runner then runs migrations 1 and 2. The terminal of `npm run dev` shows these lines:

```
[migrations] Migration 1 (create_users) ran.
[migrations] Migration 2 (add_users_email) ran.
```

## Add a migration

1. Stop the Worker.
2. In `src/migrations.js`, add this migration at the end of the list, after `add_users_email`:

   ```js
   add_users_created_at: "ALTER TABLE users ADD COLUMN created_at TEXT;",
   ```

   The key is the name of the migration, and the value is its SQL. The migration is the third key in the list. Thus its version is 3.

3. Start the Worker again with `npm run dev`. The local data stays in `.wrangler/state`.
4. Send a request to the Worker, for example `curl http://localhost:8787/migrations`.

The runner runs only migration 3. The users that you added stay in the database.

Before you add your own migrations, read the rules in the comment at the top of `src/migrations.js`.

## Deploy the example

1. Run this command:

   ```sh
   npm run deploy
   ```

2. If Wrangler asks you to log in, log in to your Cloudflare account.

To remove the example Worker from your account, run `npx wrangler delete`.
