// The iPhone app's third-party inventory: the table in THIRD-PARTY.md between
// <!-- ios-licenses:start --> and <!-- ios-licenses:end -->, read by
// licenses.mjs (the licences screen) and check-inventory.mjs (what the
// xcframework links). One reader, so both see the same rows.

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
