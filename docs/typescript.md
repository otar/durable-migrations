# TypeScript

The package has type declarations in `src/index.d.ts`. You do not need to change `tsconfig.json` for the package. `tsc` reads the types through the `"types"` condition in `"exports"` of `package.json`.

The types operate with `"moduleResolution": "bundler"` and with `"nodenext"`. They also operate with `"strict": true` and `"exactOptionalPropertyTypes": true`.

In TypeScript 5, the types also operate with `"moduleResolution": "node"`. With `"node"`, `tsc` reads the field `"types"` of `package.json`, not `"exports"`.

## The types

The package exports the function `runMigrations()` and these types:

| Type | Description |
|---|---|
| `MigrationStorage` | The members of `ctx.storage` that the runner uses: `sql.exec()` and `transactionSync()`. |
| `MigrationLogger` | An object with the functions `log(message)` and `warn(message)`. A function can return a promise. |
| `RunMigrationsOptions` | The type of `options`. Its optional property `logger` is a `MigrationLogger`, `null`, or `undefined`. If `logger` is `null` or `undefined`, the runner uses `console`. |

The parameter `migrations` has the type `Readonly<Record<string, string>>`. The return type is `number`.

The types do not use `@cloudflare/workers-types`. The `ctx.storage` of a Durable Object has all members of `MigrationStorage`. This is true with the types from `@cloudflare/workers-types` and from `wrangler types`. `ctx` and `ctx.storage.sql` do not have these members. `console` has all members of `MigrationLogger`.

Example:

```ts
import { runMigrations, type MigrationLogger } from "durable-migrations";
import { migrations } from "./migrations.js";

const logger: MigrationLogger = {
  log: (message) => console.log(JSON.stringify({ level: "info", message })),
  warn: (message) => console.warn(JSON.stringify({ level: "warn", message })),
};

// The constructor of your Durable Object:
ctx.blockConcurrencyWhile(async () => {
  runMigrations(ctx.storage, migrations, { logger });
});
```

In a JavaScript file, use the types in JSDoc, for example `/** @type {import("durable-migrations").MigrationLogger} */`.

## Errors that tsc finds

`tsc` shows an error at the call of `runMigrations()` in these conditions:

- The first argument is `ctx` or `ctx.storage.sql`, not `ctx.storage`. Example in TypeScript 7:

  ```
  error TS2739: Type 'DurableObjectState<unknown>' is missing the following properties from type 'MigrationStorage': sql, transactionSync
  ```

  In TypeScript 5 and 6, the error is `TS2345`. The text of `TS2739` is on the second line:

  ```
  error TS2345: Argument of type 'DurableObjectState<unknown>' is not assignable to parameter of type 'MigrationStorage'.
    Type 'DurableObjectState<unknown>' is missing the following properties from type 'MigrationStorage': sql, transactionSync
  ```

- The list of migrations is not an object, or it is an array.
- A value in the list is not a string. Example:

  ```
  error TS2345: Argument of type '{ create_users: string; add_users_email: number; }' is not assignable to parameter of type 'Readonly<Record<string, string>>'.
    Property 'add_users_email' is incompatible with index signature.
      Type 'number' is not assignable to type 'string'.
  ```

- The logger does not have the functions `log()` and `warn()`.
- `options` is not an object.

In a JavaScript file, `tsc` checks the call only if the file has `// @ts-check` or if `checkJs` is true. In a JavaScript constructor, the parameter `ctx` has the type `any`. Thus `tsc` does not check the first argument there. If the first argument is `ctx` or `ctx.storage.sql`, the runner throws a `TypeError` when the object starts. See [Errors and warnings](api.md#errors-and-warnings).

## Write the list in migrations.ts

In a TypeScript project, you can write the list in `migrations.ts`:

```ts
export const migrations: Record<string, string> = {
  create_users: `
    CREATE TABLE users (
      id   INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    );
  `,
};
```

In `migrations.ts`, `tsc` always finds two keys with the same name. You do not need `// @ts-check`. The error is:

```
error TS1117: An object literal cannot have multiple properties with the same name.
```

With the type `Record<string, string>`, `tsc` shows the error for a value that is not a string in `migrations.ts`. Without this type, `tsc` shows the error at the call of `runMigrations()`.

If the list has an interface type without an index signature, `tsc` shows an error at the call of `runMigrations()`. Example:

```
error TS2345: Argument of type 'MigrationList' is not assignable to parameter of type 'Readonly<Record<string, string>>'.
  Index signature for type 'string' is missing in type 'MigrationList'.
```

The runner accepts this list. Thus use `Record<string, string>`, a type alias, or no type for the list.

## Check migrations.js

If your TypeScript project has a `migrations.js` file, `allowJs` must be true in `tsconfig.json`. If `allowJs` is not true, the list from `migrations.js` has the type `any`, and `tsc` does not check it. Then, if `noImplicitAny` is true, `tsc` fails with `error TS7016` for `./migrations.js`. The default of `noImplicitAny` is the value of `"strict"`.

Put `// @ts-check` on the first line of `migrations.js`, as in the [quick start](../README.md#quick-start). Then `tsc` and your editor show this error for the second key with the same name:

```
error TS1117: An object literal cannot have multiple properties with the same name.
```

If `migrations.js` does not have `// @ts-check` and `checkJs` is not true, `tsc` does not find two keys with the same name. You do not need to change `tsconfig.json` for `// @ts-check`. Your editor shows the error also in a project without `tsconfig.json`.

Also put `/** @type {Record<string, string>} */` above `export const migrations`, as in the [quick start](../README.md#quick-start). With `// @ts-check` and this line, `tsc` shows the error for a value that is not a string in `migrations.js`. It does not show this error at the call of `runMigrations()`. Example: `error TS2322: Type 'number' is not assignable to type 'string'.`

If `migrations.js` does not have `// @ts-check` and `checkJs` is not true, the `@type` line hides the error, and `tsc` shows no error. This is true in a TypeScript project and in a JavaScript project. Thus use the `@type` line only with `// @ts-check` or with `checkJs`.

Without the `@type` line, `tsc` shows the error at the call of `runMigrations()`. See [Errors that tsc finds](#errors-that-tsc-finds).

## Errors that tsc does not find

`tsc` does not find a name with only digits or the name `__proto__`. If each migration is a separate export of `migrations.js` or `migrations.ts`, `tsc` also does not find `import * as`. See [Names and order](writing-migrations.md#names-and-order).

## Wrangler does not check types

Wrangler does not check types. Thus `wrangler dev` and `wrangler deploy` operate, also when `tsc` fails. To find type errors before you deploy, run `tsc`.
