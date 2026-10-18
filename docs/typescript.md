# TypeScript

The package has no type declarations. `src/index.js` in the package has JSDoc types for `runMigrations()`.

If `"strict": true` is in your `tsconfig.json`, `tsc` fails on the import. The error starts with this text:

```
error TS7016: Could not find a declaration file for module 'durable-migrations'.
```

Wrangler does not check types. Thus `wrangler dev` and `wrangler deploy` operate, also when `tsc` fails.

To use the JSDoc types, add `allowJs` and `maxNodeModuleJsDepth` to `compilerOptions` in `tsconfig.json`:

```jsonc
{
  "compilerOptions": {
    "allowJs": true,
    "maxNodeModuleJsDepth": 1
  }
}
```

Then `tsc` reads the JSDoc types in the package, and it finds incorrect calls of `runMigrations()`. For example, if `migrations.js` has no `@type` line and a value is a number, `tsc` fails at the call of `runMigrations()` with this error:

```
error TS2345: Argument of type '{ create_users: string; add_users_email: number; }' is not assignable to parameter of type 'Record<string, string>'.
  Property 'add_users_email' is incompatible with index signature.
    Type 'number' is not assignable to type 'string'.
```

With only `allowJs`, `tsc` does not find two keys with the same name in `migrations.js`. To find them, put `// @ts-check` on the first line of `migrations.js`, as in the [quick start](../README.md#quick-start). Then `tsc` and your editor show this error for the second key:

```
error TS1117: An object literal cannot have multiple properties with the same name.
```

You do not need to change `tsconfig.json` for `// @ts-check`. Your editor shows the error also in a project without `tsconfig.json`.

Also put `/** @type {Record<string, string>} */` above `export const migrations`, as in the [quick start](../README.md#quick-start). With `// @ts-check` and this line, `tsc` shows the error for a value that is not a string in `migrations.js`. It does not show this error at the call of `runMigrations()`. Example: `error TS2322: Type 'number' is not assignable to type 'string'.`

Without `// @ts-check`, the `@type` line hides the error, and `tsc` shows no error. Thus use the `@type` line only with `// @ts-check`.

`tsc` does not find a name with only digits or the name `__proto__`. If each migration is a separate export of `migrations.js`, `tsc` also does not find `import * as`. See [Names and order](writing-migrations.md#names-and-order).

To use no types, add a file such as `src/durable-migrations.d.ts` with this line:

```ts
declare module "durable-migrations";
```

The file must be in a folder that `tsconfig.json` includes. Then `runMigrations()` has the type `any`, and `tsc` does not check its calls.
