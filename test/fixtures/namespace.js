// A module that exports each migration as its own string. A test imports it
// with "import * as" and expects an error. The names are not in alphabetical
// order. A module namespace object can sort them.
export const create_users = "CREATE TABLE users (id INTEGER PRIMARY KEY);";
export const add_users_email = "ALTER TABLE users ADD COLUMN email TEXT;";
