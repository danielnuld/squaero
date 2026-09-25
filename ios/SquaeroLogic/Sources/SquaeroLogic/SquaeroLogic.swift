// The pure frontend modules, run in JavaScriptCore instead of rewritten in
// Swift (issue #574, design D2). squaero-logic.js defines the global
// SquaeroLogic; every call crosses as JSON, both ways, so the types below are
// plain Codable mirrors of the TypeScript ones (frontend/src/utils).
//
// Not thread-safe: a JSContext must not run on two threads at once. Keep one
// instance per queue.

import Foundation
import JavaScriptCore

public struct ResultColumn: Codable, Equatable, Hashable {
    public var name: String
    /// Neutral type name: int, float, bool, text, blob, date, time, timestamp, json, null.
    public var type: String
    public init(name: String, type: String) { self.name = name; self.type = type }
}

public struct ResultSet: Codable, Equatable {
    public var columns: [ResultColumn]
    /// Each cell's text, or nil for a SQL NULL.
    public var rows: [[String?]]
    public var truncated = false
    public var rowsAffected = 0
    /// query.run with cursor: the driver's result set is still open, and
    /// query.next reads on from it (docs/IPC.md, v8).
    public var cursor: Bool?
    public init(columns: [ResultColumn], rows: [[String?]]) { self.columns = columns; self.rows = rows }
}

/// How to read an engine's foreign keys, or why it cannot (foreignKeys.ts).
public struct ForeignKeyQuery: Codable, Equatable {
    public var supported: Bool
    public var bulkSql: String?
    public var reason: String?
}

/// A whole foreign key: fromTable's columns reference toTable's.
public struct ForeignKeyRelation: Codable, Equatable, Hashable {
    public struct Pair: Codable, Equatable, Hashable {
        public var from: String
        public var to: String
    }
    public var fromTable: String
    public var toTable: String
    public var constraint: String
    public var columns: [Pair]
}

/// A relationship prepared against one row (relatedData.ts): the rows of
/// relation.fromTable that `where` selects, or `missing` when the row lacks
/// a key column to fill it.
public struct RelatedQuery: Codable, Equatable, Hashable {
    public var relation: ForeignKeyRelation
    public var `where`: String?
    public var missing: String?
    public var label: String
}

/// One child of a schema.tree level: kind is database, schema, table or view.
public struct TreeRow: Codable, Equatable, Hashable {
    public var name: String
    public var kind: String
    public init(name: String, kind: String) { self.name = name; self.kind = kind }
}

/// How an engine lists its stored routines (routines.ts); unsupported for
/// SQLite and MongoDB.
public struct RoutineSupport: Codable, Equatable {
    public var supported: Bool
    public var listSql: String?
    public var nameCol: String?
    public var typeCol: String?
    public var schemaCol: String?
    public var idCol: String?
}

public struct SqlVariable: Codable, Equatable {
    public var name: String
    /// "value" (`:name`, a SQL literal) or "raw" (`${name}`, text as typed).
    public var kind: String
    public var token: String
}

public struct VarValue: Codable, Equatable {
    public var text: String
    /// Write the keyword NULL instead of a literal (value variables only).
    public var isNull: Bool?
    public init(text: String, isNull: Bool? = nil) { self.text = text; self.isNull = isNull }
}

public struct Condition: Codable, Equatable {
    public var column: String
    public var op: String
    public var value: String
    public var enabled: Bool?
    public init(column: String, op: String, value: String, enabled: Bool? = nil) {
        self.column = column; self.op = op; self.value = value; self.enabled = enabled
    }
}

public struct OrderBy: Codable, Equatable {
    public var column: String
    /// "ASC" or "DESC".
    public var dir: String
    public init(column: String, dir: String) { self.column = column; self.dir = dir }
}

/// The part of the filter panel's state that renders to SQL.
public struct FilterDraft: Codable, Equatable {
    public var conditions: [Condition]
    /// "AND" or "OR".
    public var conjunction = "AND"
    public var order: [OrderBy] = []
    public init(conditions: [Condition], conjunction: String = "AND", order: [OrderBy] = []) {
        self.conditions = conditions; self.conjunction = conjunction; self.order = order
    }
}

/// The rendered WHERE and ORDER BY, without the keywords.
public struct PreviewFilter: Codable, Equatable {
    public var `where`: String?
    public var orderBy: String?
    public init(where: String? = nil, orderBy: String? = nil) { self.where = `where`; self.orderBy = orderBy }
}

// MARK: Connections (connections.ts, connectionFormSections.ts)

public struct FieldOption: Codable, Equatable, Hashable {
    public var value: String
    /// i18n key.
    public var label: String
}

public struct DriverField: Codable, Equatable, Hashable, Identifiable {
    public var key: String
    /// i18n key ("field.host"); resolve with `translate`.
    public var label: String
    /// text, number, password, file or select.
    public var type: String
    public var required: Bool
    /// A literal ("localhost") or an i18n key; `translate` returns a literal as is.
    public var placeholder: String?
    public var options: [FieldOption]?
    public var group: String?
    public var fetch: String?
    public var id: String { key }
}

public struct DriverSchema: Codable, Equatable {
    public var driver: String
    public var label: String
    public var fields: [DriverField]
}

public struct FormSection: Codable, Equatable, Identifiable {
    /// server, file, auth, security or ssh.
    public var id: String
    public var fields: [DriverField]
}

public struct Connection: Codable, Equatable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var driver: String
    /// Field values by DriverField.key.
    public var params: [String: String]
    public var color: String?
    public var group: String?
    public var icon: String?
    public init(id: String, name: String, driver: String, params: [String: String] = [:], group: String? = nil) {
        self.id = id; self.name = name; self.driver = driver; self.params = params; self.group = group
    }
}

public struct MergeSummary: Codable, Equatable {
    public var added: Int
    public var updated: Int
    public var skipped: Int
    public init(added: Int, updated: Int, skipped: Int) {
        self.added = added; self.updated = updated; self.skipped = skipped
    }
}

public struct ImportedConnections: Codable, Equatable {
    /// The whole list after the merge.
    public var list: [Connection]
    public var summary: MergeSummary
    /// The ids, in `list`, of the connections the file brought.
    public var ids: [String]
}

public struct ConnectionGroup: Codable, Equatable {
    /// nil for the connections with no group.
    public var name: String?
    public var conns: [Connection]
}

/// One row operation to apply (editSession.ts' PlanItem): kind is update,
/// delete or insert; a nil value in `set`, `where` or `values` is SQL NULL.
public struct PlanItem: Codable, Equatable {
    public var kind: String
    public var set: [String: String?]?
    public var `where`: [String: String?]?
    public var values: [String: String?]?
    /// Neutral type per column set, so the driver leaves numbers unquoted.
    public var setTypes: [String: String]?
}

/// A coloured run of the SQL editor (sqlEditor.ts): kind is keyword, string,
/// number, comment, variable or ident; offsets are UTF-16, as NSString's.
public struct HighlightSpan: Codable, Equatable {
    public var kind: String
    public var start: Int
    public var end: Int
}

/// The word a completion replaces, [from, cursor), and after `t.` its table.
public struct CompletionContext: Codable, Equatable {
    public var from: Int
    public var word: String
    public var table: String?
}

/// What the editor knows of the schema: tables, and columns by table.
public struct EditorSchema: Codable, Equatable {
    public var tables: [String]
    public var columns: [String: [String]]
    public init(tables: [String] = [], columns: [String: [String]] = [:]) {
        self.tables = tables; self.columns = columns
    }
}

/// One top-level statement of a script (runScope.ts), UTF-16 offsets.
public struct SqlStatement: Codable, Equatable {
    public var from: Int
    public var to: Int
    public var text: String
}

/// A saved query (snippets.ts): id "snip-N", a name and the SQL.
public struct Snippet: Codable, Equatable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var body: String
    public init(id: String, name: String, body: String) { self.id = id; self.name = name; self.body = body }
}

public enum SquaeroLogicError: Error, Equatable {
    /// squaero-logic.js is not in the bundle (run `pnpm build:logic`).
    case scriptMissing
    /// An export format this build does not know.
    case unknownFormat(String)
    /// The script threw; the message is JavaScript's.
    case script(String)
}

public final class SquaeroLogic {
    public static let formats = ["csv", "json", "sql", "xml", "html", "xlsx"]

    private let context: JSContext
    private var thrown: String?

    /// Loads the squaero-logic.js shipped in this package.
    public convenience init() throws {
        guard let url = Bundle.module.url(forResource: "squaero-logic", withExtension: "js"),
              let script = try? String(contentsOf: url, encoding: .utf8)
        else { throw SquaeroLogicError.scriptMissing }
        try self.init(script: script)
    }

    public init(script: String) throws {
        guard let context = JSContext() else { throw SquaeroLogicError.script("no JSContext") }
        self.context = context
        context.exceptionHandler = { [weak self] _, exception in
            self?.thrown = exception?.toString() ?? "unknown error"
        }
        context.evaluateScript(script)
        // One entry point: resolve "module.fn" on SquaeroLogic, call it with
        // the JSON arguments, answer {v: result} as JSON (bytes as an array).
        context.evaluateScript("""
            var __squaeroCall = function (path, args) {
              var self = SquaeroLogic, fn = SquaeroLogic;
              path.split(".").forEach(function (p) { self = fn; fn = fn == null ? fn : fn[p]; });
              if (fn === undefined) throw new Error("unknown name: " + path);
              // A constant (DRIVER_SCHEMAS) is read, not called.
              var r = typeof fn === "function" ? fn.apply(self, JSON.parse(args)) : fn;
              if (r instanceof Uint8Array) r = Array.from(r);
              return JSON.stringify({ v: r === undefined ? null : r });
            };
            """)
        if let error = thrown { throw SquaeroLogicError.script(error) }
    }

    private struct Box<T: Decodable>: Decodable { let v: T }

    private func call<T: Decodable>(_ path: String, _ args: [any Encodable]) throws -> T {
        let json = try JSONEncoder().encode(args.map(AnyEncodable.init))
        thrown = nil
        let out = context.objectForKeyedSubscript("__squaeroCall")
            .call(withArguments: [path, String(decoding: json, as: UTF8.self)])
        if let error = thrown { throw SquaeroLogicError.script(error) }
        guard let text = out?.toString() else { throw SquaeroLogicError.script("no result from \(path)") }
        return try JSONDecoder().decode(Box<T>.self, from: Data(text.utf8)).v
    }

    /// The file contents for `format` (one of `formats`). `table` names the
    /// INSERT target, the HTML title and the XLSX sheet.
    public func export(_ result: ResultSet, format: String, table: String = "exported") throws -> Data {
        switch format {
        case "csv", "json", "sql", "xml", "html":
            let text: String = try call("exporters.exportResult", [result, format, table])
            return Data(text.utf8)
        case "xlsx":
            // ponytail: bytes cross as a JSON array, fine for a phone-sized
            // export; move to a typed array read if large sheets get slow.
            let bytes: [UInt8] = try call("xlsx.buildXlsx", [result, table])
            return Data(bytes)
        default:
            throw SquaeroLogicError.unknownFormat(format)
        }
    }

    /// The formats the export sheet offers, in its order (exportSheet.ts).
    public func sheetFormats() throws -> [String] {
        try call("exportSheet.SHEET_FORMATS", [])
    }

    /// `name` with `format`'s extension, made safe for a file name.
    public func nameForFormat(_ name: String, format: String) throws -> String {
        try call("exportSheet.nameForFormat", [name, format])
    }

    /// The rows an exported file holds, read back from its bytes.
    public func countExportedRows(format: String, _ data: Data) throws -> Int {
        try call("exportSheet.countExportedRows", [format, [UInt8](data)])
    }

    public func draftFilter(engine: String, _ draft: FilterDraft, types: [String: String] = [:]) throws -> PreviewFilter {
        try call("dataFilter.draftFilter", [engine, draft, types])
    }

    public func findVariables(sql: String, engine: String? = nil) throws -> [SqlVariable] {
        try call("sqlVariables.findVariables", [sql, engine])
    }

    public func applyVariables(sql: String, values: [String: VarValue], engine: String? = nil) throws -> String {
        try call("sqlVariables.applyVariables", [sql, values, engine])
    }

    /// The variables of `vars` that have nothing to write yet (blank, not NULL).
    public func missingVariables(_ vars: [SqlVariable], values: [String: VarValue]) throws -> [SqlVariable] {
        try call("sqlVariables.missingVariables", [vars, values])
    }

    // MARK: Snippets (snippets.ts)

    /// Tolerant parse of a stored list: malformed entries are dropped.
    public func parseSnippets(_ raw: String) throws -> [Snippet] {
        try call("snippets.parseSnippets", [raw])
    }

    public func serializeSnippets(_ list: [Snippet]) throws -> String {
        try call("snippets.serializeSnippets", [list])
    }

    /// `list` with a new snippet; unchanged when the name or body is blank.
    public func addSnippet(_ list: [Snippet], name: String, body: String) throws -> [Snippet] {
        try call("snippets.addSnippet", [list, name, body])
    }

    public func renameSnippet(_ list: [Snippet], id: String, name: String) throws -> [Snippet] {
        try call("snippets.renameSnippet", [list, id, name])
    }

    public func removeSnippet(_ list: [Snippet], id: String) throws -> [Snippet] {
        try call("snippets.removeSnippet", [list, id])
    }

    /// Name or body containing `query`, any case; all of them for "".
    public func searchSnippets(_ list: [Snippet], query: String) throws -> [Snippet] {
        try call("snippets.searchSnippets", [list, query])
    }

    /// `name`, or "name (2)"… when a snippet already has it.
    public func uniqueSnippetName(_ list: [Snippet], name: String) throws -> String {
        try call("snippets.uniqueSnippetName", [list, name])
    }

    /// The table a query reads, as a name to propose; nil for a join or DDL.
    public func proposedSnippetName(_ sql: String, engine: String) throws -> String? {
        try call("snippets.proposedSnippetName", [sql, engine])
    }

    /// A readable text for an Informix error message, or nil when it has none.
    /// `locale` is "es" or "en".
    public func informixErrorText(_ message: String, locale: String) throws -> String? {
        try call("informixErrors.informixErrorText", [message, locale])
    }

    /// A schema.tree result as typed rows; containers take `fallback`
    /// ("database" or "schema"), a result with a type column holds tables and views.
    public func parseTreeRows(_ result: ResultSet, fallback: String) throws -> [TreeRow] {
        try call("parseTreeRows", [result, fallback])
    }

    /// The query that opens an object's rows in the engine's own surface: a
    /// qualified, filtered SELECT, or db.<collection>.find() for MongoDB (which
    /// takes no filter). `limit` 0 means no cap, for paging with a cursor.
    public func objectPreviewQuery(db: String?, schema: String?, name: String, engine: String,
                                   limit: Int = 0, filter: PreviewFilter? = nil) throws -> String {
        struct Parts: Encodable { let db: String?; let schema: String?; let name: String }
        return try call("pagination.objectPreviewQuery",
                        [Parts(db: db, schema: schema, name: name), engine, limit, 0, filter])
    }

    /// Declared type per column, from schema.describe: how the filter quotes values.
    public func describeColumnTypes(_ describe: ResultSet) throws -> [String: String] {
        try call("edit.describeColumnTypes", [describe])
    }

    public func describeColumnNames(_ describe: ResultSet) throws -> [String] {
        try call("edit.describeColumnNames", [describe])
    }

    /// The primary key's columns; empty when the table has none, and then it
    /// is read-only: no UPDATE that could match several rows (edit.ts).
    public func describePkColumns(_ describe: ResultSet) throws -> [String] {
        try call("edit.describePkColumns", [describe])
    }

    /// The operations that save `set` (column → new value) on one row, keyed
    /// by the row's original primary key, as desktop's grid builds them
    /// (editSession.buildPlan). Empty when nothing changed or the row does
    /// not carry every key column.
    /// The DELETE of one row, keyed by its primary key (editSession.buildPlan);
    /// empty when the row does not carry every key column.
    public func rowDeletePlan(table: String, db: String?, schema: String?, pk: [String],
                              columns: [ResultColumn], row: [String?]) throws -> [PlanItem] {
        struct Source: Encodable { let table: String; let db: String?; let schema: String?; let pk: [String] }
        struct Pending: Encodable {
            let edits: [String: [String: String?]] = [:]
            let deletes = [0]
            let inserts: [[String: String?]] = []
        }
        return try call("editSession.buildPlan", [Source(table: table, db: db, schema: schema, pk: pk), columns,
                                                  [row], Pending()])
    }

    /// Whether a row.* call touched the one row it should have (edit.ts):
    /// MySQL's unchanged UPDATE reports 0 and passes; no count cannot be checked.
    public func rowCountOk(engine: String, kind: String, rowsAffected: Int?) throws -> Bool {
        try call("edit.rowCountOk", [engine, kind, rowsAffected])
    }

    public func rowUpdatePlan(table: String, db: String?, schema: String?, pk: [String],
                              columns: [ResultColumn], row: [String?], set: [String: String?]) throws -> [PlanItem] {
        struct Source: Encodable { let table: String; let db: String?; let schema: String?; let pk: [String] }
        struct Pending: Encodable {
            let edits: [String: [String: String?]]
            let deletes: [Int] = []
            let inserts: [[String: String?]] = []
        }
        return try call("editSession.buildPlan", [Source(table: table, db: db, schema: schema, pk: pk), columns,
                                                  [row], Pending(edits: set.isEmpty ? [:] : ["0": set])])
    }

    /// The catalog query for one table's foreign keys: `outbound` the keys it
    /// holds, else the keys pointing at it.
    public func foreignKeysFor(_ engine: String, db: String?, table: String, outbound: Bool) throws -> ForeignKeyQuery {
        struct Scope: Encodable { let table: String; let direction: String }
        return try call("foreignKeys.foreignKeysFor",
                        [engine, db, Scope(table: table, direction: outbound ? "from" : "to")])
    }

    /// A foreign-key catalog result as whole keys, composite ones together.
    public func foreignKeyRelations(_ result: ResultSet) throws -> [ForeignKeyRelation] {
        // foreignKeys.ts' ForeignKey, only carried from one call to the next.
        struct Pair: Codable {
            let fromTable, fromColumn, toTable, toColumn: String
            let constraint: String?
            let position: Double?
        }
        let pairs: [Pair] = try call("foreignKeys.parseForeignKeys", [result.columns, result.rows])
        return try call("foreignKeys.groupForeignKeys", [pairs])
    }

    /// The same key read from the other end: the parent row a column points at.
    public func invertRelation(_ rel: ForeignKeyRelation) throws -> ForeignKeyRelation {
        try call("relatedData.invertRelation", [rel])
    }

    public func relatedQueries(_ relations: [ForeignKeyRelation], columns: [ResultColumn], row: [String?],
                               engine: String) throws -> [RelatedQuery] {
        try call("relatedData.relatedQueries", [relations, columns, row, engine])
    }

    /// COUNT(*) of a relationship's rows, or nil when the row cannot fill it.
    public func relatedCount(_ query: RelatedQuery, engine: String, db: String?, schema: String?) throws -> String? {
        struct Scope: Encodable { let db: String?; let schema: String? }
        return try call("relatedData.relatedCount", [query, engine, Scope(db: db, schema: schema)])
    }

    // MARK: SQL editor

    public func highlightSql(_ sql: String, engine: String?) throws -> [HighlightSpan] {
        try call("sqlEditor.highlightSql", [sql, engine])
    }

    public func completionContext(_ sql: String, cursor: Int) throws -> CompletionContext {
        try call("sqlEditor.completionContext", [sql, cursor])
    }

    public func completionItems(_ sql: String, _ ctx: CompletionContext, schema: EditorSchema,
                                limit: Int = 12) throws -> [String] {
        try call("sqlEditor.completionItems", [sql, ctx, schema, limit])
    }

    /// The tables a statement names, unqualified, in first-seen order.
    public func tablesInStatement(_ sql: String) throws -> [String] {
        try call("sqlEditor.tablesInStatement", [sql])
    }

    /// The statements of a script, split where desktop splits them (a routine
    /// body keeps its semicolons).
    public func splitStatements(_ sql: String, engine: String?) throws -> [SqlStatement] {
        try call("runScope.splitStatements", [sql, engine])
    }

    /// "834 ms", "1.2 s", "1 m 5 s".
    public func formatDuration(ms: Double) throws -> String {
        try call("duration.formatDuration", [ms])
    }

    public func routinesFor(_ engine: String, db: String?) throws -> RoutineSupport {
        try call("routines.routinesFor", [engine, db])
    }

    public func quoteIdentifier(_ id: String, engine: String? = nil) throws -> String {
        try call("quoteIdentifier", [id, engine])
    }

    // MARK: Connections

    private var schemaCache: [String: DriverSchema]?

    /// Every driver's form, by driver name, as desktop has it.
    public func driverSchemas() throws -> [String: DriverSchema] {
        if let cached = schemaCache { return cached }
        let schemas: [String: DriverSchema] = try call("connections.DRIVER_SCHEMAS", [])
        schemaCache = schemas
        return schemas
    }

    private func schema(_ driver: String) throws -> DriverSchema {
        guard let schema = try driverSchemas()[driver] else {
            throw SquaeroLogicError.script("unknown driver: \(driver)")
        }
        return schema
    }

    public func formSections(driver: String) throws -> [FormSection] {
        try call("connectionForm.formSections", [schema(driver)])
    }

    /// The keys whose values are secrets (the password fields).
    public func secretKeys(driver: String) throws -> [String] {
        try call("connections.secretFieldKeys", [schema(driver)])
    }

    public func stripSecrets(_ conn: Connection) throws -> Connection {
        try call("connections.stripSecrets", [conn, schema(conn.driver)])
    }

    /// The `dsn` for conn.open. Build it in memory, right before opening.
    public func buildDsn(_ conn: Connection) throws -> [String: String] {
        try call("connections.buildDsn", [conn])
    }

    /// Field key → i18n key of its error ("valid.required"); empty when valid.
    public func fieldErrors(_ conn: Connection, sshRequired: Bool = false) throws -> [String: String] {
        struct Errors: Decodable { let params: [String: String] }
        struct Options: Encodable { let sshRequired: Bool }
        let errors: Errors = try call("connections.fieldErrors", [conn, Options(sshRequired: sshRequired)])
        return errors.params
    }

    /// Where a connection points, in one line ("siaj @ 10.0.0.5:9089").
    public func connectionTarget(_ conn: Connection) throws -> String {
        try call("connections.connectionTarget", [conn])
    }

    /// Whether the connection carries desktop's red, the explicit production mark.
    public func hasProductionColor(_ conn: Connection) throws -> Bool {
        try call("connections.hasProductionColor", [conn])
    }

    /// `conn` with the production mark (the red) put on or taken off.
    public func markProduction(_ conn: Connection, _ on: Bool) throws -> Connection {
        try call("connections.markProduction", [conn, on])
    }

    /// Whether an edit's preview warns that this is production: the palette's
    /// red or a group named for it.
    public func isProductionConnection(_ conn: Connection) throws -> Bool {
        try call("connections.isProductionConnection", [conn])
    }

    /// Whether reaching `conn` (or its SSH host) goes through the local
    /// network, which iOS asks the user about first.
    public func usesLocalNetwork(_ conn: Connection) throws -> Bool {
        try call("connections.usesLocalNetwork", [conn])
    }

    /// The engine's two letters ("PG"), as desktop's badge.
    public func engineMonogram(_ driver: String) throws -> String {
        try call("connections.engineMonogram", [driver])
    }

    /// The name to save under when none was typed ("siaj @ 10.0.0.5", a file's name).
    public func defaultConnectionName(_ conn: Connection) throws -> String {
        try call("connections.defaultConnectionName", [conn])
    }

    public func groupConnections(_ list: [Connection]) throws -> [ConnectionGroup] {
        try call("connections.groupConnections", [list])
    }

    public func nextConnectionId(_ list: [Connection]) throws -> String {
        try call("connections.nextConnectionId", [list])
    }

    /// Tolerant parse of a stored list: malformed entries are dropped and old
    /// Informix connections are migrated to DRDA, as on desktop.
    public func parseConnections(_ raw: String) throws -> [Connection] {
        try call("connections.parseConnections", [raw])
    }

    /// Merges desktop's export file into `existing` with desktop's rules; an
    /// unreadable file throws `.script` with the reason.
    public func importConnectionsFile(_ existing: [Connection], raw: String) throws -> ImportedConnections {
        try call("connections.importConnectionsFile", [existing, raw])
    }

    // MARK: i18n

    /// `key` in `locale` ("es" or "en"), then Spanish, then the key itself.
    public func translate(_ key: String, locale: String, params: [String: String]? = nil) throws -> String {
        try call("i18n.translate", [locale, key, params])
    }
}

private struct AnyEncodable: Encodable {
    let value: any Encodable
    init(_ value: any Encodable) { self.value = value }
    func encode(to encoder: Encoder) throws { try value.encode(to: encoder) }
}
