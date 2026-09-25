// Checks what SquaeroCore.xcframework links against THIRD-PARTY.md (issue
// #579, task 7.6), from the archives on the build's own link line
// (build-xcframework.sh writes it as <slice>/static_registry_test.link):
//
// - every archive belongs to a component of the iOS inventory; one that does
//   not is named, since nothing may reach the app without being listed;
// - no archive is by another author under GPL or LGPL (MariaDB Connector/C,
//   FreeTDS and the like are named outright), and no listed component but
//   Squaero carries a GPL-family licence;
// - every linked component of the inventory is actually there, so the table
//   does not list what the build dropped.
//
//   node scripts/ios/check-inventory.mjs build-ios/device/static_registry_test.link [more.link]
//
// Run from the repository root.

import { readFileSync } from "node:fs";
import { parseTable } from "./third-party.mjs";

// Archive file name → inventory component. Most specific first: Squaero's own
// target for libpq is named quaero_libpq.
const ARCHIVES = [
  [/^libquaero_libpq\.a$|^libpg(common|port)\w*\.a$/, "libpq (PostgreSQL)"],
  // utf8proc ships inside mongo-c-driver, under its THIRD_PARTY_NOTICES.
  [/^lib(mongoc|bson|utf8proc)[\w.-]*\.a$/, "mongo-c-driver (libmongoc, libbson)"],
  [/^libdrda\w*\.a$/, "libdrda"],
  [/^lib(ssl|crypto)\.a$/, "OpenSSL"],
  [/^libssh2\w*\.a$/, "libssh2"],
  [/^libcjson\.a$/, "cJSON"],
  [/^libsqlite3\.a$/, "SQLite"],
  // Squaero's own: the core, the static-driver table, and the drivers, whose
  // archives carry the driver's name with no "lib" (sqlite.a, postgres.a…).
  [/^lib(dbcore|\w+_driver|quaero_\w+)\.a$|^(sqlite|postgres|informix|mongodb|mysql|mssql)\.a$/, "Squaero"],
];

// Known copyleft clients that must never reach the iOS build.
const COPYLEFT = /^lib(mariadb|mysqlclient|sybdb|ct|tds|freetds)\w*\.a$/;

// Listed in the inventory but bundled by the app, not linked by the core.
const NOT_LINKED = new Set(["fflate", "Schibsted Grotesk", "Martian Mono"]);

export function checkInventory(linkLines, inventory) {
  const problems = new Set();
  const byName = new Map(inventory.map((c) => [c.name, c]));
  const seen = new Set();
  for (const line of linkLines) {
    const archives = line.split(/\s+/).filter((t) => t.endsWith(".a")).map((t) => t.split("/").pop());
    for (const archive of new Set(archives)) {
      if (COPYLEFT.test(archive)) {
        problems.add(`${archive}: a GPL/LGPL client by another author is linked into the iOS build`);
        continue;
      }
      const hit = ARCHIVES.find(([re]) => re.test(archive));
      if (!hit) {
        problems.add(`${archive}: linked, but no component of THIRD-PARTY.md's iOS table claims it`);
        continue;
      }
      const component = byName.get(hit[1]);
      if (!component) {
        problems.add(`${archive}: belongs to "${hit[1]}", which THIRD-PARTY.md's iOS table does not list`);
        continue;
      }
      seen.add(component.name);
    }
  }
  for (const c of inventory) {
    if (c.name !== "Squaero" && /\bL?GPL\b/i.test(c.license)) {
      problems.add(`${c.name}: listed under ${c.license}, a copyleft licence by another author`);
    }
    if (!NOT_LINKED.has(c.name) && !seen.has(c.name)) {
      problems.add(`${c.name}: listed in THIRD-PARTY.md's iOS table, but no archive of it is linked`);
    }
  }
  return { problems: [...problems], linked: [...seen] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("usage: check-inventory.mjs <slice>/static_registry_test.link …");
    process.exit(2);
  }
  const inventory = parseTable(readFileSync("THIRD-PARTY.md", "utf8"));
  const { problems, linked } = checkInventory(files.map((f) => readFileSync(f, "utf8")), inventory);
  console.log(`linked: ${linked.sort().join(", ")}`);
  if (problems.length > 0) {
    for (const p of problems) console.error(`error: ${p}`);
    process.exit(1);
  }
  console.log("the iOS build links exactly THIRD-PARTY.md's iOS inventory, with no copyleft by another author");
}
