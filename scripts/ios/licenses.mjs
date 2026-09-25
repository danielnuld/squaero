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

const OUT = "ios/Squaero/Resources/Licenses.json";

export function parseTable(markdown) {
  const start = markdown.indexOf("<!-- ios-licenses:start -->");
  const end = markdown.indexOf("<!-- ios-licenses:end -->");
  if (start < 0 || end < start) throw new Error("THIRD-PARTY.md: no ios-licenses table");
  const rows = markdown
    .slice(start, end)
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .slice(2); // header and separator
  return rows.map((line) => {
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length !== 4) throw new Error(`THIRD-PARTY.md: bad row: ${line}`);
    const [name, version, license, texts] = cells;
    const files = [...texts.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    if (files.length === 0) throw new Error(`THIRD-PARTY.md: ${name} names no licence file`);
    return { name, version: version === "—" ? null : version, license, files };
  });
}

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
