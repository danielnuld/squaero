// Editing one row (issue #577, task 5.4). The change is kept here until the
// user confirms it: the core generates the statement (row.update / row.delete
// with preview), the user reads it, Face ID confirms, and it runs inside a
// transaction that is committed only if it touched exactly that one row.
// Anything else rolls back and says why, keeping the edit to correct it.

import Foundation
import LocalAuthentication
import SquaeroLogic

@MainActor
@Observable
final class RowEditor {
    enum Change: Identifiable { case update, delete; var id: Self { self } }

    let session: Session
    let ref: RowRef
    /// What the row holds now: the original, then what was committed.
    private(set) var row: [String?]
    /// The values being typed, by column. Nil is SQL NULL.
    var values: [String: String?] = [:]
    /// The statement the core will run, once previewed.
    private(set) var preview: String?
    private(set) var failure: String?
    private(set) var busy = false

    init(session: Session, ref: RowRef) {
        self.session = session
        self.ref = ref
        row = ref.row
        discard()
    }

    private var driver: String { session.conn.driver }

    /// Why this row cannot be edited, or nil when it can. MongoDB's driver
    /// has no row.* (it does not announce DML); a table without a primary key
    /// has no way to name one row.
    var readOnlyReason: String? {
        if driver == "mongodb" { return Logic.t("ios.edit.readOnlyEngine") }
        if ref.pk.isEmpty { return Logic.t("ios.edit.noPk") }
        return nil
    }

    var production: Bool { (try? Logic.shared.isProduction(session.conn)) ?? false }

    /// Only the columns whose value differs from the row's.
    var changed: [String: String?] {
        var out: [String: String?] = [:]
        for (i, col) in ref.columns.enumerated() where values[col.name] != row[i] {
            out[col.name] = values[col.name] ?? nil
        }
        return out
    }

    /// Back to the row as it is: nothing was sent.
    func discard() {
        values = Dictionary(uniqueKeysWithValues: zip(ref.columns.map(\.name), row))
        preview = nil
        failure = nil
    }

    private func params(_ change: Change, preview: Bool) throws -> (String, [String: Any]) {
        guard let pkWhere = try Logic.shared.whereForRow(columns: ref.columns, row: row, pk: ref.pk) else {
            throw EditError.message(Logic.t("ios.edit.noPk"))
        }
        var p: [String: Any] = ["connId": session.connId, "table": ref.object.name,
                                "where": Self.json(pkWhere)]
        if let db = ref.object.db { p["db"] = db }
        if let schema = ref.object.schema { p["schema"] = schema }
        if preview { p["preview"] = true }
        guard change == .update else { return ("row.delete", p) }
        let set = changed
        p["set"] = Self.json(set)
        // Neutral types, so the driver writes numbers unquoted (docs/IPC.md).
        var types: [String: String] = [:]
        for col in ref.columns where set.keys.contains(col.name) { types[col.name] = col.type }
        p["setTypes"] = types
        return ("row.update", p)
    }

    /// Asks the core for the exact statement it will run, without running it.
    func review(_ change: Change) async {
        failure = nil
        do {
            let (method, p) = try params(change, preview: true)
            let result = try await Core.shared.call(method, p) as? [String: Any]
            preview = result?["sql"] as? String
        } catch {
            preview = nil
            failure = readable(error)
        }
    }

    /// Face ID, then the change in a transaction. True when it was committed.
    func apply(_ change: Change, authenticate: Bool = true) async -> Bool {
        busy = true
        defer { busy = false }
        failure = nil
        if authenticate {
            do {
                _ = try await LAContext().evaluatePolicy(
                    .deviceOwnerAuthentication,
                    localizedReason: Logic.t("ios.edit.faceIdReason", ["table": ref.object.name]))
            } catch {
                failure = Logic.t("ios.faceid.cancelled")
                return false
            }
        }
        var began = false
        do {
            let (method, p) = try params(change, preview: false)
            _ = try await Core.shared.call("tx.begin", ["connId": session.connId])
            began = true
            let result = try await Core.shared.call(method, p) as? [String: Any]
            let affected = result?["rowsAffected"] as? Int ?? -1
            // By primary key it is one row; anything else means the row moved
            // under us (or the key was not unique): do not keep it.
            guard affected == 1 else {
                throw EditError.message(Logic.t("ios.edit.affected", ["n": "\(affected)"]))
            }
            _ = try await Core.shared.call("tx.commit", ["connId": session.connId])
            if change == .update {
                row = ref.columns.map { values[$0.name] ?? nil }
            }
            preview = nil
            return true
        } catch {
            if began { _ = try? await Core.shared.call("tx.rollback", ["connId": session.connId]) }
            failure = readable(error)
            return false
        }
    }

    enum EditError: Error { case message(String) }

    /// {column: value} for the core, a nil value as JSON null (SQL NULL).
    private static func json(_ map: [String: String?]) -> [String: Any] {
        map.mapValues { $0.map { $0 as Any } ?? NSNull() }
    }

    /// The core's message, or for Informix the text of its SQLCODE.
    private func readable(_ error: Error) -> String {
        switch error {
        case let EditError.message(text): return text
        case let CoreError.rpc(_, message):
            if driver == "informix",
               let text = try? Logic.shared.informixErrorText(message, locale: Logic.locale) {
                return text
            }
            return message
        default: return "\(error)"
        }
    }
}
