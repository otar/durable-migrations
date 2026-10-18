# Upgrade from the copied files

Before version 0.1.0, you copied the files `migrate.js` and `migrations.js` into your project. In these files, the list of migrations is an array. Each item of the array has the properties `version`, `name`, and `sql`. For an array, the runner of the package throws a `TypeError`, and the database does not change. The message of this error refers to the section "Upgrade from the copied files" in the README. That section refers to this page.

The table `_migrations` did not change. Thus the objects keep their migration history. To change to the package, do these steps:

1. Install the package with `npm install durable-migrations`.
2. Remove `migrate.js` from your project.
3. Change the import of the runner to `import { runMigrations } from "durable-migrations";`.
4. Make sure that the array has the names of the deployed migrations. The item at each position must have the name of the row with that version in `_migrations`. The copied runner did not compare the names. Thus a name in the array can be different from the name in `_migrations`. [See the migration history](how-it-works.md#see-the-migration-history) gives a query for these rows.

   If the array has an empty slot, for example `[m1, , m3]`, put the deployed migration back at that position. Get its name from `_migrations`. Get its SQL from your version control.

5. Before you change the array, do a check of its names. Each item must have a name that no other item has. A name must not contain only digits, and it must not be `__proto__`. To find the names that do not pass the check, run this command in the folder of your project:

   ```sh
   node --input-type=module -e '
     import { migrations } from "./src/migrations.js";
     const names = migrations.map((item) => item.name);
     console.log(names.filter((name, index) =>
       names.indexOf(name) !== index || /^[0-9]+$/.test(name) || name === "__proto__"));
   '
   ```

   If `migrations.js` is not in the folder `src`, change the path in the command. If the command shows `[]`, all names pass the check.

   CAUTION: If the command shows a name, do not change the array to an object. An object literal cannot hold this migration history. For a name with only digits, the runner throws an error, and the objects do not start. For two items with the same name, or for `__proto__`, the list loses a migration. If the lost migration is not at the end of the array, the name check throws an error. Then the deployed objects do not start. If the lost migration is at the end of the array, the deployed objects start with only a warning. New objects then get a schema that is different from the schema of the deployed objects.

6. Change the array to an object. For each item, in the same order, write a property. The key is the old `name`, and the value is the old `sql`. Remove `version`. If the file has the rule "Give it the next version number" in a comment, remove this rule. Also add the lines `// @ts-check` and `/** @type {Record<string, string>} */`, as in this example. Then your editor shows an error for two keys with the same name while you change the list.

   Before:

   ```js
   export const migrations = [
     {
       version: 1,
       name: "create_users",
       sql: `
         CREATE TABLE users (
           id   INTEGER PRIMARY KEY,
           name TEXT NOT NULL
         );
       `,
     },
     {
       version: 2,
       name: "add_users_email",
       sql: `
         ALTER TABLE users ADD COLUMN email TEXT;
         CREATE UNIQUE INDEX users_email ON users (email);
       `,
     },
   ];
   ```

   After:

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
     add_users_email: `
       ALTER TABLE users ADD COLUMN email TEXT;
       CREATE UNIQUE INDEX users_email ON users (email);
     `,
   };
   ```

   If a name is not a JavaScript identifier, put it in quotes, for example `"add-email"`. Do not change the array to an object at run time, for example with `Object.fromEntries()`. Such code hides two items with the same name.

7. Make sure that the keys have the same names in the same order as the rows in `_migrations`. The key at each position must have the name of the row with that version. If a name is different, the runner throws an error, and the deployed objects do not start.
8. Do a test with `wrangler dev` on an object that has the old data. See [Do a test of your migrations](test-and-deploy.md#do-a-test-of-your-migrations).
