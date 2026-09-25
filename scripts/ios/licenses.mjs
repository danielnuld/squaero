// The iPhone app's licenses screen (issue #579, task 7.5), generated from the
// iOS table in THIRD-PARTY.md (between <!-- ios-licenses:start --> and
// <!-- ios-licenses:end -->): each row's component, version, licence and the
// full text of the files it names, into ios/Squaero/Resources/Licenses.json.
//
//   node scripts/ios/licenses.mjs           write Licenses.json
//   node scripts/ios/licenses.mjs --check   fail if it is out of date (CI)
//
// Run from the repository root.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { parseTable } from "./third-party.mjs";

const OUT = "ios/Squaero/Resources/Licenses.json";

function build() {
  const components = parseTable(readFileSync("THIRD-PARTY.md", "utf8")).map((c) => ({
    name: c.name,
    version: c.version,
    license: c.license,
    texts: c.files.map((file) => {
      if (!existsSync(file)) throw new Error(`licence file missing: ${file}`);
      return { file: file.split("/").pop(), text: readFileSync(file, "utf8") };
    }),
  }));
  return JSON.stringify(components, null, 1) + "\n";
}

const json = build();
if (process.argv.includes("--check")) {
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (current !== json) {
    console.error(`${OUT} is out of date: run node scripts/ios/licenses.mjs`);
    process.exit(1);
  }
  console.log(`${OUT} matches THIRD-PARTY.md`);
} else {
  writeFileSync(OUT, json);
  console.log(`wrote ${OUT}`);
}
