// Makes sure that the npm package has only the expected files.
//
// The script runs "npm pack --dry-run --json" and compares the files in the
// package with EXPECTED. If a file is missing or extra, the script gives the
// file and exits with code 1. Run it with "npm run check:package".

import { execFileSync } from "node:child_process";

// The files that the package must have. The field "files" in package.json
// adds the folder src. npm always adds LICENSE, README.md, and package.json.
const EXPECTED = ["LICENSE", "README.md", "package.json", "src/index.d.ts", "src/index.js"];

// Runs "npm pack --dry-run --json" and returns its output. npm can write
// notices to stderr. Thus only stdout goes to the JSON parser.
function pack() {
  const options = { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] };

  // On Windows, npm is the batch file npm.cmd. Node.js runs a batch file
  // only in a shell. The command is one string, so the shell gets no
  // separate arguments.
  if (process.platform === "win32") {
    return execFileSync("npm.cmd pack --dry-run --json", { ...options, shell: true });
  }

  return execFileSync("npm", ["pack", "--dry-run", "--json"], options);
}

// npm 10 and npm 11 give an array. npm 12 gives an object with the package
// name as the key.
const output = JSON.parse(pack());
const [result] = Array.isArray(output) ? output : Object.values(output);
const files = result.files.map((file) => file.path).sort();
const missing = EXPECTED.filter((path) => !files.includes(path));
const extra = files.filter((path) => !EXPECTED.includes(path));

if (missing.length > 0 || extra.length > 0) {
  console.error("The files in the package are not the expected files.");
  if (missing.length > 0) {
    console.error(`These files are missing:\n  ${missing.join("\n  ")}`);
  }
  if (extra.length > 0) {
    console.error(`These files are extra:\n  ${extra.join("\n  ")}`);
  }
  console.error(
    'Correct "files" in package.json. ' +
      "If the package must have a new file, add the file to EXPECTED in scripts/check-package.js.",
  );
  process.exitCode = 1;
} else {
  console.log(`The package has only the expected files:\n  ${files.join("\n  ")}`);
}
