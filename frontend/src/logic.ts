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
export * as connections from "./utils/connections";
export * as connectionForm from "./utils/connectionFormSections";
export * as i18n from "./utils/translate";
export { quoteIdentifier, qualifiedName, parseTreeRows } from "./utils/schema";
export * as routines from "./utils/routines";
export * as pagination from "./utils/pagination";
export * as edit from "./utils/edit";
export * as editSession from "./utils/editSession";
export * as relatedData from "./utils/relatedData";
export * as sqlEditor from "./utils/sqlEditor";
export * as runScope from "./utils/runScope";
export * as duration from "./utils/duration";
export * as snippets from "./utils/snippets";
