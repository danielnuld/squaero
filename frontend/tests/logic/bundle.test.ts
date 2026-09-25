// @vitest-environment node
//
// squaero-logic.js runs in JavaScriptCore on the iPhone (issue #574, design
// D2): no window, no document, no TextEncoder, no timers. Each module the
// bundle carries is built alone and evaluated in an empty context like that,
// so the failure names the module that reached for the DOM.

import { describe, expect, it } from "vitest";
import { build, type Rollup } from "vite";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

const MODULES = [
  "exporters",
  "xlsx",
  "dataFilter",
  "sqlVariables",
  "foreignKeys",
  "informixErrors",
  "schema",
  "connections",
  "connectionFormSections",
  "translate",
  "routines",
  "pagination",
  "edit",
  "editSession",
  "relatedData",
  "sqlEditor",
  "runScope",
  "duration",
  "snippets",
];

const DOM = "(?:window|document|localStorage|navigator)";
const DOM_USE = new RegExp(
  `(?<![\\w"'.])${DOM}\\s*[.[(]|typeof\\s+${DOM}\\b|globalThis\\.${DOM}\\b`,
  "g",
);

async function bundle(entry: string): Promise<string> {
  const out = (await build({
    root,
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      target: "es2020",
      minify: false,
      lib: { entry, name: "SquaeroLogic", formats: ["iife"] },
    },
  })) as Rollup.RollupOutput[];
  return out[0].output[0].code;
}

// An empty global: only what the language itself defines.
function evaluate(code: string): Record<string, unknown> {
  const ctx = vm.createContext({});
  vm.runInContext(`${code};this.SquaeroLogic = SquaeroLogic;`, ctx);
  return ctx.SquaeroLogic as Record<string, unknown>;
}

describe("squaero-logic.js without a DOM", () => {
  for (const name of MODULES) {
    it(`${name} uses no window or document`, async () => {
      const code = await bundle(`src/utils/${name}.ts`);
      expect(() => evaluate(code), name).not.toThrow();
      // Loading is not enough: a function that touches the DOM only when
      // called would pass. So no code may use these globals: `document.x`,
      // `typeof document`, `globalThis.localStorage`. The same words inside a
      // string (the catalogs say "document") are not code and do not count.
      expect(code.match(DOM_USE), name).toBeNull();
    });
  }

  it("the whole bundle exposes every module and runs them", async () => {
    const L = evaluate(await bundle("src/logic.ts")) as any;
    expect(Object.keys(L).sort()).toEqual([
      "connectionForm",
      "connections",
      "dataFilter",
      "duration",
      "edit",
      "editSession",
      "exporters",
      "foreignKeys",
      "i18n",
      "informixErrors",
      "pagination",
      "parseTreeRows",
      "qualifiedName",
      "quoteIdentifier",
      "relatedData",
      "routines",
      "runScope",
      "snippets",
      "sqlEditor",
      "sqlVariables",
      "xlsx",
    ]);
    const rs = {
      columns: [
        { name: "a", type: "varchar" },
        { name: "n", type: "integer" },
      ],
      rows: [["x,\"y", null]],
    };
    expect(L.exporters.toCsv(rs)).toBe('a,n\r\n"x,""y",');
    // XLSX goes through fflate, which falls back when TextEncoder is missing.
    const zip = L.xlsx.buildXlsx(rs) as Uint8Array;
    expect([zip[0], zip[1]]).toEqual([0x50, 0x4b]);
    expect(L.quoteIdentifier("a`b", "mysql")).toBe("`a``b`");
  }, 30000);
});
