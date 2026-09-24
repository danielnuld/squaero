// squaero-logic.js (issue #574): the pure modules the iPhone app runs with
// JavaScriptCore instead of rewriting them in Swift (design D2). Built by
// `pnpm build:logic` into dist-logic/, exposed as the global SquaeroLogic.
//
// Everything reachable from here must run without window or document:
// tests/logic/bundle.test.ts evaluates each module alone and names the one
// that does not.

export * as exporters from "./utils/exporters";
export * as xlsx from "./utils/xlsx";
export * as dataFilter from "./utils/dataFilter";
export * as sqlVariables from "./utils/sqlVariables";
export * as foreignKeys from "./utils/foreignKeys";
export * as informixErrors from "./utils/informixErrors";
export { quoteIdentifier, qualifiedName } from "./utils/schema";
