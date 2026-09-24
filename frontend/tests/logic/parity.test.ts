// @vitest-environment node
//
// parity.json holds cases and the output the TypeScript modules give for them.
// This test keeps it true; the Swift facade's tests (ios/SquaeroLogic) run the
// same cases through squaero-logic.js in JavaScriptCore and must match it
// (issue #574). After an intended change in a module, regenerate with
// UPDATE_PARITY=1 pnpm vitest run tests/logic/parity.test.ts

import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { exportResult, type ExportFormat } from "../../src/utils/exporters";
import { draftFilter, emptyFilter } from "../../src/utils/dataFilter";
import { applyVariables, findVariables } from "../../src/utils/sqlVariables";
import { informixErrorText } from "../../src/utils/informixErrors";
import { quoteIdentifier } from "../../src/utils/schema";
import {
  buildDsn,
  DRIVER_SCHEMAS,
  fieldErrors,
  groupConnections,
  importConnectionsFile,
  parseConnections,
  stripSecrets,
} from "../../src/utils/connections";
import { formSections } from "../../src/utils/connectionFormSections";
import { translate } from "../../src/utils/translate";

const file = fileURLToPath(new URL("./parity.json", import.meta.url));
const cases = JSON.parse(readFileSync(file, "utf8"));

function compute(c: typeof cases) {
  for (const e of c.exports) e.expected = exportResult(e.result, e.format as ExportFormat, e.table);
  for (const f of c.filters) f.expected = draftFilter(f.engine, { ...emptyFilter(), ...f.state }, f.types);
  for (const v of c.variables) {
    v.found = findVariables(v.sql, v.engine);
    v.expected = applyVariables(v.sql, v.values, v.engine);
  }
  for (const e of c.informixErrors) e.expected = informixErrorText(e.msg, e.locale);
  for (const q of c.quote) q.expected = quoteIdentifier(q.id, q.engine);
  const k = c.connections;
  for (const x of k.buildDsn) x.expected = buildDsn(x.conn);
  for (const x of k.fieldErrors) x.expected = fieldErrors(x.conn, { sshRequired: x.sshRequired });
  for (const x of k.stripSecrets) x.expected = stripSecrets(x.conn, DRIVER_SCHEMAS[x.conn.driver]);
  for (const x of k.groupConnections) x.expected = groupConnections(x.list);
  // Keys only: the Swift side reads the fields from the same schemas.
  for (const x of k.formSections) {
    x.expected = formSections(DRIVER_SCHEMAS[x.driver]).map((s) => ({
      id: s.id,
      keys: s.fields.map((f) => f.key),
    }));
  }
  for (const x of k.parseConnections) x.expected = parseConnections(x.raw);
  for (const x of k.importConnectionsFile) x.expected = importConnectionsFile(x.existing, x.raw);
  for (const x of k.translate) x.expected = translate(x.locale, x.key, x.params);
  return c;
}

describe("parity.json matches the TypeScript modules", () => {
  it("every case", () => {
    const actual = compute(structuredClone(cases));
    if (process.env.UPDATE_PARITY) {
      writeFileSync(file, JSON.stringify(actual, null, 2) + "\n");
    }
    expect(actual).toEqual(cases);
  });
});
