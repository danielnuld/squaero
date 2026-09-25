// Editing one row (issue #577, tasks 5.4 and 5.5): the changes are kept here
// until the user reviews them. The review asks the driver for the exact SQL
// (row.update with preview, the same statement it runs later, #29); only after
// Face ID do they run, inside one transaction, and a failure rolls it back and
// keeps the edit so it can be corrected. Discarding sends nothing: the
// transaction is opened at confirm time, not when editing starts.

import LocalAuthentication
import SquaeroLogic
import SwiftUI

@MainActor
@Observable
final class RowEditor {
    /// Posted with the table's RowRef.object when a change was committed, so
    /// the list it came from reads its rows again.
    static let saved = Notification.Name("SquaeroRowSaved")

    let session: Session
    let ref: RowRef
    /// The row as shown: the one opened, then what was committed.
    private(set) var row: [String?]
    private(set) var editing = false
    /// Column → typed value; nil is SQL NULL. Only the columns touched.
    private(set) var drafts: [String: String?] = [:]
    /// The statements the review showed, in the plan's order.
    private(set) var preview: [String]?
    private(set) var busy = false
    private(set) var failure: String?
    private(set) var done: String?
    private var plan: [PlanItem] = []

    init(session: Session, ref: RowRef) {
        self.session = session
        self.ref = ref
        row = ref.row
    }

    /// Why this row cannot be edited, or nil when it can. MongoDB's driver
    /// has no row.* (no DBC_FEAT_DML); a table without a primary key cannot
    /// point at one row, as on desktop.
    var readOnlyReason: String? {
        if session.conn.driver == "mongodb" { return Logic.t("ios.row.readOnlyEngine", ["engine": "MongoDB"]) }
        if ref.pk.isEmpty { return Logic.t("ios.row.readOnlyNoPk") }
        return nil
    }

    var production: Bool { (try? Logic.shared.isProductionConnection(session.conn)) ?? false }

    func value(_ column: String) -> String? {
        if let draft = drafts[column] { return draft }
        return ref.columns.firstIndex { $0.name == column }.flatMap { row[$0] }
    }

    func set(_ column: String, _ value: String?) {
        drafts[column] = .some(value)
    }

    /// The touched columns whose value differs from the row's.
    var changes: [String: String?] {
        drafts.filter { column, value in
            guard let i = ref.columns.firstIndex(where: { $0.name == column }) else { return false }
            return row[i] != value
        }
    }

    func begin() {
        guard readOnlyReason == nil else { return }
        editing = true
        failure = nil
        done = nil
    }

    /// Back to the row as it was. Nothing was sent, so nothing to undo.
    func discard() {
        drafts = [:]
        editing = false
        preview = nil
        failure = nil
    }

    /// The SQL each change runs, from the driver itself, without running it.
    func review() async {
        busy = true
        defer { busy = false }
        failure = nil
        do {
            plan = try Logic.shared.rowUpdatePlan(table: ref.object.name, db: ref.object.db, schema: ref.object.schema,
                                                  pk: ref.pk, columns: ref.columns, row: row, set: changes)
            guard !plan.isEmpty else {
                failure = Logic.t("edit.noChanges")
                return
            }
            var sqls: [String] = []
            for item in plan {
                let r = try await Core.shared.call("row.\(item.kind)", params(item, preview: true))
                sqls.append((r as? [String: Any])?["sql"] as? String ?? "")
            }
            preview = sqls
        } catch {
            failure = Self.readable(error)
        }
    }

    func cancelPreview() { preview = nil }

    /// Face ID (or the passcode), then `commit`. A cancelled check sends nothing.
    func confirm() async {
        let context = LAContext()
        do {
            _ = try await context.evaluatePolicy(.deviceOwnerAuthentication,
                                                 localizedReason: Logic.t("ios.edit.faceid", ["name": session.conn.name]))
        } catch {
            preview = nil
            failure = Logic.t("ios.edit.cancelled")
            return
        }
        await commit()
    }

    /// Runs the reviewed plan in one transaction. On failure the transaction
    /// is rolled back and the edit kept; on success the row shows the new
    /// values. Kept apart from `confirm` so tests can run it without Face ID.
    func commit() async {
        busy = true
        defer { busy = false }
        preview = nil
        var affected = 0
        do {
            _ = try await Core.shared.call("tx.begin", ["connId": session.connId])
        } catch {
            // Nothing was opened: a driver without transactions says so (-32001).
            failure = Logic.t("ios.edit.failed", ["reason": Self.readable(error)])
            return
        }
        do {
            for item in plan {
                let r = try await Core.shared.call("row.\(item.kind)", params(item, preview: false))
                affected += (r as? [String: Any])?["rowsAffected"] as? Int ?? 0
            }
            _ = try await Core.shared.call("tx.commit", ["connId": session.connId])
        } catch {
            var text = Logic.t("ios.edit.failed", ["reason": Self.readable(error)])
            do {
                _ = try await Core.shared.call("tx.rollback", ["connId": session.connId])
            } catch {
                text += " " + Logic.t("ios.edit.rollbackFailed", ["reason": Self.readable(error)])
            }
            failure = text
            return
        }
        for (column, value) in changes {
            if let i = ref.columns.firstIndex(where: { $0.name == column }) { row[i] = value }
        }
        drafts = [:]
        plan = []
        editing = false
        failure = nil
        done = Logic.t("ios.edit.done", ["n": "\(affected)"])
        NotificationCenter.default.post(name: Self.saved, object: ref.object)
    }

    /// row.* params (edit.ts' updateParams): JSON null for SQL NULL.
    private func params(_ item: PlanItem, preview: Bool) -> [String: Any] {
        func json(_ map: [String: String?]?) -> [String: Any]? {
            map?.mapValues { (value: String?) -> Any in
                if let value { return value }
                return NSNull()
            }
        }
        var p: [String: Any] = ["connId": session.connId, "table": ref.object.name]
        if let db = ref.object.db { p["db"] = db }
        if let schema = ref.object.schema { p["schema"] = schema }
        if let set = json(item.set) { p["set"] = set }
        if let values = json(item.values) { p["values"] = values }
        if let w = json(item.where) { p["where"] = w }
        if let types = item.setTypes { p["setTypes"] = types }
        if preview { p["preview"] = true }
        return p
    }

    /// The core's message, or the text for its SQLCODE on Informix (#559).
    static func readable(_ error: Error) -> String {
        guard case let CoreError.rpc(_, message) = error else { return "\(error)" }
        let text: String?? = try? Logic.shared.informixErrorText(message, locale: Logic.locale)
        return text.flatMap { $0 } ?? message
    }
}
