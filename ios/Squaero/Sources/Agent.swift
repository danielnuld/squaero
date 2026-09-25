// The on-device agent (issue #580, design D9): Apple's own model through
// Foundation Models, off until the user turns it on, and only where Apple
// Intelligence is. Its tools only read: the schema, a table's columns, and a
// SELECT that the core's classifier (dbcore/stmt_class.h, the MCP server's
// gate) proves read-only. Nothing it sees leaves the device.

import Foundation
import SquaeroCore
import SquaeroLogic
#if canImport(FoundationModels)
import FoundationModels
#endif

enum AgentSettings {
    static let key = "agent.enabled"

    /// Off by default (spec ios-ai-agent).
    static var enabled: Bool {
        get { UserDefaults.standard.bool(forKey: key) }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }

    /// iOS 26 with Apple Intelligence ready. Where it is false, no control of
    /// the agent is shown anywhere.
    static var available: Bool {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            return SystemLanguageModel.default.availability == .available
        }
        #endif
        return false
    }

    static var active: Bool { available && enabled }
}

/// The agent's tools, without the model, so they are tested anywhere. Plain
/// values only: the model calls them off the main actor.
struct AgentTools: Sendable {
    let connId: String
    let engine: String
    let db: String?
    let schema: String?
    let tables: [String]

    static let rowLimit = 50
    /// Tables whose columns searchSchema adds, and the text a result may take.
    static let describedMatches = 3
    static let maxChars = 4000

    /// What the model is told when a statement is refused.
    struct Refusal: Error, LocalizedError {
        let errorDescription: String?
    }

    /// The tools of the connection behind connId.
    @MainActor
    static func load(connId: String, conn: Connection) async -> AgentTools? {
        guard let found = await TreeLevel.tables(connId: connId, conn: conn) else { return nil }
        return AgentTools(connId: connId, engine: conn.driver, db: found.db, schema: found.schema,
                          tables: found.tables)
    }

    /// The only gate between the model and the server: every statement must be
    /// provably read-only, fail-closed (comments, strings, CTEs, `;`).
    static func isReadOnly(_ sql: String) -> Bool {
        stmt_classify(sql) == STMT_READ
    }

    /// buscarEsquema: the tables whose name contains text, with the columns
    /// of the closest few. A schema of hundreds of tables never reaches the
    /// model whole.
    @MainActor
    func searchSchema(_ text: String) async throws -> String {
        let needle = text.lowercased().trimmingCharacters(in: .whitespaces)
        let hits = tables.filter { needle.isEmpty || $0.lowercased().contains(needle) }
            .sorted { $0.count < $1.count }
        if hits.isEmpty {
            return Logic.t("ios.agent.noMatch", ["text": text, "tables": clip(tables.joined(separator: ", "))])
        }
        var lines = ["\(hits.count): " + hits.prefix(40).joined(separator: ", ")]
        for table in hits.prefix(Self.describedMatches) {
            lines.append(try await describeTable(table))
        }
        return clip(lines.joined(separator: "\n"))
    }

    /// describirTabla: name(col type, ...), with the primary key marked.
    @MainActor
    func describeTable(_ name: String) async throws -> String {
        guard let table = tables.first(where: { $0.caseInsensitiveCompare(name) == .orderedSame }) else {
            return Logic.t("ios.agent.noTable", ["name": name])
        }
        var p: [String: Any] = ["connId": connId, "table": table]
        if let db { p["db"] = db }
        if let schema { p["schema"] = schema }
        let d = try await Core.shared.resultSet("schema.describe", p)
        let names = try Logic.shared.describeColumnNames(d)
        let types = try Logic.shared.describeColumnTypes(d)
        let pk = Set(try Logic.shared.describePkColumns(d))
        let cols = names.map { "\($0) \(types[$0] ?? "?")\(pk.contains($0) ? " PK" : "")" }
        return "\(table)(\(cols.joined(separator: ", ")))"
    }

    /// ejecutarSelect: at most rowLimit rows as tab-separated text, or a
    /// refusal for anything that is not provably read-only.
    @MainActor
    func runSelect(_ sql: String) async throws -> String {
        guard Self.isReadOnly(sql) else { throw Refusal(errorDescription: Logic.t("ios.agent.notRead")) }
        let r = try await Core.shared.resultSet("query.run",
                                                ["connId": connId, "sql": sql, "limit": Self.rowLimit])
        var lines = [r.columns.map(\.name).joined(separator: "\t")]
        lines += r.rows.map { row in row.map { $0 ?? "NULL" }.joined(separator: "\t") }
        if r.truncated { lines.append("…") }
        return clip(lines.joined(separator: "\n"))
    }

    private func clip(_ s: String) -> String {
        s.count <= Self.maxChars ? s : String(s.prefix(Self.maxChars)) + "…"
    }
}
