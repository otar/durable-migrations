// src/index.js
//
// An example Worker with a Durable Object that runs its migrations with durable-migrations.
// Copy the constructor into your own Durable Object class.

import { DurableObject } from "cloudflare:workers";
import { runMigrations } from "durable-migrations";
import { migrations } from "./migrations.js";

export class MyDurableObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);

    // Run the new migrations before the object accepts requests.
    // If a migration fails, Cloudflare resets the object.
    ctx.blockConcurrencyWhile(async () => {
      runMigrations(ctx.storage, migrations);
    });
  }

  async addUser(name, email) {
    return this.ctx.storage.sql
      .exec("INSERT INTO users (name, email) VALUES (?, ?) RETURNING id", name, email)
      .one().id;
  }

  async listUsers() {
    return this.ctx.storage.sql
      .exec("SELECT id, name, email FROM users ORDER BY id")
      .toArray();
  }

  // Shows the migration history of this object.
  async listMigrations() {
    return this.ctx.storage.sql
      .exec("SELECT version, name, applied_at FROM _migrations ORDER BY version")
      .toArray();
  }
}

// Sends each request to one object. Routes:
//   GET  /users       Lists the users.
//   POST /users       Adds a user. Body: {"name": "Ada", "email": "ada@example.com"}
//   GET  /migrations  Lists the migrations that ran on the object.
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    // Get a new stub for each request. After a failed start, an old stub
    // keeps the error and does not start the object again.
    const object = env.MY_DURABLE_OBJECT.get(env.MY_DURABLE_OBJECT.idFromName("example"));

    if (pathname === "/users" && request.method === "GET") {
      return Response.json(await object.listUsers());
    }

    if (pathname === "/users" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      if (typeof body?.name !== "string" || body.name.trim() === "") {
        return Response.json({ error: "The body must have a name." }, { status: 400 });
      }
      const id = await object.addUser(body.name, body.email ?? null);
      return Response.json({ id }, { status: 201 });
    }

    if (pathname === "/migrations" && request.method === "GET") {
      return Response.json(await object.listMigrations());
    }

    return Response.json({ error: "Not found." }, { status: 404 });
  },
};
