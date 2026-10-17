// example-durable-object.js
//
// An example Durable Object that uses the migration runner.
// Copy the constructor into your own Durable Object class.

import { DurableObject } from "cloudflare:workers";
import { runMigrations } from "./migrate.js";
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
