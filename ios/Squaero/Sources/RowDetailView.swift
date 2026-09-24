// One row as a form (issue #577, task 5.3): every column with its type and
// value, then its related data, both ways, as desktop's related-data modal
// (#310, #364): the row each of its foreign keys points at, and the rows of
// other tables that point at it, each with its count. The keys come from the
// engine's catalog (foreignKeys.ts), the filters from relatedData.ts.

import SquaeroLogic
import SwiftUI

/// The related data of one row, loaded from the catalog.
@MainActor
@Observable
final class RowRelations {
    let session: Session
    let ref: RowRef
    /// The rows this one points at (its own foreign keys, read backwards).
    private(set) var parents: [RelatedQuery] = []
    /// The rows of other tables that point at this one.
    private(set) var children: [RelatedQuery] = []
    private(set) var counts: [RelatedQuery: String] = [:]
    /// Why there are none to show: the engine has no foreign keys, or the
    /// catalog query failed. Nil when the list simply is empty.
    private(set) var reason: String?

    init(session: Session, ref: RowRef) {
        self.session = session
        self.ref = ref
    }

    private var driver: String { session.conn.driver }
    /// Where the catalog is scoped: PostgreSQL's schema, else the database.
    private var scope: String? { ref.object.schema ?? ref.object.db }

    func load() async {
        do {
            let parentKeys = try await relations(outbound: true).map { try Logic.shared.invertRelation($0) }
            parents = try Logic.shared.relatedQueries(parentKeys, columns: ref.columns, row: ref.row, engine: driver)
            children = try Logic.shared.relatedQueries(try await relations(outbound: false), columns: ref.columns,
                                                       row: ref.row, engine: driver)
        } catch let CatalogError.unsupported(why) {
            reason = why
            return
        } catch {
            // Say why, or a failed catalog reads as "no relations" (#552).
            reason = Logic.t("related.catalogFailed", ["detail": Self.text(error)])
            return
        }
        for q in children {
            guard let sql = try? Logic.shared.relatedCount(q, engine: driver, db: ref.object.db,
                                                           schema: ref.object.schema),
                  let n = try? await Core.shared.resultSet("query.run", ["connId": session.connId, "sql": sql, "limit": 1])
            else { continue }
            counts[q] = n.rows.first?.first ?? nil
        }
    }

    private enum CatalogError: Error { case unsupported(String) }

    private func relations(outbound: Bool) async throws -> [ForeignKeyRelation] {
        let plan = try Logic.shared.foreignKeysFor(driver, db: scope, table: ref.object.name, outbound: outbound)
        guard plan.supported, let sql = plan.bulkSql else { throw CatalogError.unsupported(plan.reason ?? "") }
        // desktop's FK_CATALOG_LIMIT: one table's keys, not the database's.
        let result = try await Core.shared.resultSet("query.run", ["connId": session.connId, "sql": sql, "limit": 200])
        return try Logic.shared.foreignKeyRelations(result)
    }

    /// The rows a relationship selects, as a table to open narrowed to them.
    func object(_ q: RelatedQuery) -> ObjectRef? {
        guard let condition = q.where else { return nil }
        return ObjectRef(db: ref.object.db, schema: ref.object.schema, name: q.relation.fromTable,
                         where: condition, label: q.label)
    }

    private static func text(_ error: Error) -> String {
        if case let CoreError.rpc(_, message) = error { return message }
        return "\(error)"
    }
}

struct RowDetailView: View {
    @State private var related: RowRelations
    @State private var editor: RowEditor
    @State private var editing = false
    @State private var reviewing: RowEditor.Change?
    @Environment(\.dismiss) private var dismiss

    init(session: Session, ref: RowRef) {
        _related = State(initialValue: RowRelations(session: session, ref: ref))
        _editor = State(initialValue: RowEditor(session: session, ref: ref))
    }

    private var ref: RowRef { related.ref }

    var body: some View {
        List {
            fields
            if editing {
                Section {
                    Button(Logic.t("ios.edit.deleteRow"), role: .destructive) { review(.delete) }
                }
            } else {
                relatedSections
            }
        }
        .navigationTitle(editor.row.first.flatMap { $0 } ?? ref.object.name)
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(editing)
        .toolbar { toolbar }
        .sheet(item: $reviewing) { change in reviewSheet(change) }
        .task { await related.load() }
    }

    private var fields: some View {
        Section {
            ForEach(Array(ref.columns.enumerated()), id: \.offset) { i, col in
                field(col, value: editor.row[i])
            }
        } footer: {
            if let reason = editor.readOnlyReason { Text(reason) }
        }
    }

    @ViewBuilder
    private var relatedSections: some View {
        if !related.parents.isEmpty {
            Section(Logic.t("ios.row.pointsAt")) {
                ForEach(related.parents, id: \.self) { link($0, count: nil) }
            }
        }
        if !related.children.isEmpty {
            Section(Logic.t("ios.row.dependents")) {
                ForEach(related.children, id: \.self) { link($0, count: related.counts[$0]) }
            }
        }
        if let reason = related.reason {
            Section(Logic.t("ios.row.related")) {
                Text(reason).font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        if editing {
            ToolbarItem(placement: .cancellationAction) {
                Button(Logic.t("common.cancel")) { editor.discard(); editing = false }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button(Logic.t("ios.edit.review")) { review(.update) }
                    .disabled(editor.changed.isEmpty)
            }
        } else if editor.readOnlyReason == nil {
            ToolbarItem(placement: .primaryAction) {
                Button(Logic.t("common.edit")) { editing = true }
            }
        }
    }

    private func review(_ change: RowEditor.Change) {
        reviewing = change
        Task { await editor.review(change) }
    }

    private func field(_ col: ResultColumn, value: String?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(col.name).font(.footnote.weight(.semibold))
                Spacer()
                Text(ref.types[col.name] ?? col.type).font(Theme.mono(11)).foregroundStyle(.secondary)
            }
            if editing {
                editable(col.name, was: value)
            } else {
                Text(value ?? "NULL")
                    .font(Theme.mono())
                    .foregroundStyle(value == nil ? .tertiary : .primary)
                    .textSelection(.enabled)
            }
        }
        .padding(.vertical, 2)
    }

    /// Whether the value being typed for `name` is SQL NULL.
    private func isNull(_ name: String) -> Bool {
        if case .some(.none) = editor.values[name] { return true }
        return false
    }

    private func text(_ name: String) -> Binding<String> {
        Binding(
            get: {
                if case .some(.some(let v)) = editor.values[name] { return v }
                return ""
            },
            set: { editor.values[name] = .some($0) })
    }

    /// NULL is not an empty string: a switch, not a guess.
    private func nullSwitch(_ name: String) -> Binding<Bool> {
        Binding(get: { isNull(name) }, set: { on in editor.values[name] = .some(on ? nil : "") })
    }

    @ViewBuilder
    private func editable(_ name: String, was: String?) -> some View {
        let null = isNull(name)
        HStack {
            TextField("", text: text(name), prompt: null ? Text("NULL") : nil, axis: .vertical)
                .font(Theme.mono())
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .disabled(null)
            Toggle("NULL", isOn: nullSwitch(name))
                .toggleStyle(.button)
                .font(Theme.mono(11))
        }
        if editor.changed.keys.contains(name) {
            Text(Logic.t("ios.edit.was", ["value": was ?? "NULL"]))
                .font(Theme.mono(11)).foregroundStyle(.secondary)
        }
    }

    /// "Revisa el cambio": the statement the core generated, what it touches,
    /// a production connection saying so, then Face ID.
    private func reviewSheet(_ change: RowEditor.Change) -> some View {
        NavigationStack {
            List {
                if editor.production { productionWarning }
                statementSection
                if let failure = editor.failure {
                    Section {
                        Label(failure, systemImage: "xmark.octagon").foregroundStyle(.red)
                    } footer: { Text(Logic.t("ios.edit.rolledBack")) }
                }
                Section { confirmButton(change) }
            }
            .navigationTitle(Logic.t("ios.edit.reviewTitle"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(Logic.t("common.cancel")) { reviewing = nil }
                }
            }
        }
        .interactiveDismissDisabled(editor.busy)
    }

    private var productionWarning: some View {
        Section {
            Label(Logic.t("ios.edit.production", ["name": related.session.conn.name]),
                  systemImage: "exclamationmark.octagon.fill")
                .foregroundStyle(.red)
        }
    }

    private var statementSection: some View {
        Section {
            if let sql = editor.preview {
                Text(sql).font(Theme.mono(13)).textSelection(.enabled)
            } else if editor.failure == nil {
                ProgressView()
            }
        } header: {
            Text(Logic.t("ios.edit.sql"))
        } footer: {
            Text(Logic.t("ios.edit.oneRow"))
        }
    }

    private func confirmButton(_ change: RowEditor.Change) -> some View {
        let key = change == .delete ? "ios.edit.confirmDelete" : "ios.edit.confirm"
        return Button {
            Task { await confirm(change) }
        } label: {
            HStack {
                Spacer()
                if editor.busy { ProgressView() } else { Label(Logic.t(key), systemImage: "faceid") }
                Spacer()
            }
        }
        .disabled(editor.preview == nil || editor.busy)
        .tint(change == .delete ? Color.red : Theme.accent)
    }

    private func confirm(_ change: RowEditor.Change) async {
        guard await editor.apply(change) else { return }
        reviewing = nil
        if change == .delete { dismiss() } else { editing = false }
    }

    @ViewBuilder
    private func link(_ q: RelatedQuery, count: String?) -> some View {
        if let object = related.object(q) {
            NavigationLink(value: object) {
                LabeledContent {
                    if let count { Text(count).font(Theme.mono()) }
                } label: {
                    Text(q.label).font(Theme.mono(13)).lineLimit(2)
                }
            }
        } else {
            // The list did not carry a key column: say which, do not guess.
            Text(Logic.t("ios.row.missingKey", ["table": q.relation.fromTable, "column": q.missing ?? ""]))
                .font(.footnote).foregroundStyle(.secondary)
        }
    }
}
