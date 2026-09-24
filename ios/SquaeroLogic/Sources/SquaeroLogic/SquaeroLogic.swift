// The pure frontend modules, run in JavaScriptCore instead of rewritten in
// Swift (issue #574, design D2). squaero-logic.js defines the global
// SquaeroLogic; every call crosses as JSON, both ways, so the types below are
// plain Codable mirrors of the TypeScript ones (frontend/src/utils).
//
// Not thread-safe: a JSContext must not run on two threads at once. Keep one
// instance per queue.

import Foundation
import JavaScriptCore

public struct ResultColumn: Codable, Equatable {
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
    public init(columns: [ResultColumn], rows: [[String?]]) { self.columns = columns; self.rows = rows }
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

    public func draftFilter(engine: String, _ draft: FilterDraft, types: [String: String] = [:]) throws -> PreviewFilter {
        try call("dataFilter.draftFilter", [engine, draft, types])
    }

    public func findVariables(sql: String, engine: String? = nil) throws -> [SqlVariable] {
        try call("sqlVariables.findVariables", [sql, engine])
    }

    public func applyVariables(sql: String, values: [String: VarValue], engine: String? = nil) throws -> String {
        try call("sqlVariables.applyVariables", [sql, values, engine])
    }

    /// A readable text for an Informix error message, or nil when it has none.
    /// `locale` is "es" or "en".
    public func informixErrorText(_ message: String, locale: String) throws -> String? {
        try call("informixErrors.informixErrorText", [message, locale])
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
