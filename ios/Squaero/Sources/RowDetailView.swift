// One row as a form (issue #577, task 5.3): every column with its type and
// value, then its related data, both ways, as desktop's related-data modal
// (#310, #364): the row each of its foreign keys points at, and the rows of
// other tables that point at it, each with its count. The keys come from the
// engine's catalog (foreignKeys.ts), the filters from relatedData.ts.
// Editing (tasks 5.4, 5.5) lives in RowEditor; this view only shows it.

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
    @Environment(\.dismiss) private var dismiss
    @State private var related: RowRelations
    @State private var editor: RowEditor

    init(session: Session, ref: RowRef) {
        _related = State(initialValue: RowRelations(session: session, ref: ref))
        _editor = State(initialValue: RowEditor(session: session, ref: ref))
    }

    private var ref: RowRef { related.ref }

    var body: some View {
        List {
            if let failure = editor.failure {
                Section {
                    Label(failure, systemImage: "exclamationmark.triangle").foregroundStyle(.red).font(.footnote)
                }
            } else if let done = editor.done {
                Section { Label(done, systemImage: "checkmark.circle").foregroundStyle(.green).font(.footnote) }
            }
            Section {
                ForEach(ref.columns, id: \.name) { col in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text(col.name).font(.footnote.weight(.semibold))
                            if ref.pk.contains(col.name) {
                                Image(systemName: "key.fill").font(.caption2).foregroundStyle(.secondary)
                                    .accessibilityLabel(Logic.t("ios.edit.key"))
                            }
                            Spacer()
                            Text(ref.types[col.name] ?? col.type).font(Theme.mono(11)).foregroundStyle(.secondary)
                        }
                        if editor.editing {
                            field(col.name)
                        } else {
                            let value = editor.value(col.name)
                            Text(value ?? "NULL")
                                .font(Theme.mono())
                                .foregroundStyle(value == nil ? .tertiary : .primary)
                                .textSelection(.enabled)
                        }
                    }
                    .padding(.vertical, 2)
                }
            } footer: {
                if let reason = editor.readOnlyReason { Text(reason) }
            }
            if !editor.editing { relatedSections }
        }
        .navigationTitle(editor.row.first.flatMap { $0 } ?? ref.object.name)
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(editor.editing)
        .toolbar { editToolbar }
        // A deleted row has no form left: back to its table.
        .onChange(of: editor.deleted) { _, gone in if gone { dismiss() } }
        .sheet(isPresented: Binding(get: { editor.preview != nil }, set: { if !$0 { editor.cancelPreview() } })) {
            EditPreviewSheet(editor: editor)
        }
        .task { await related.load() }
    }

    @ToolbarContentBuilder
    private var editToolbar: some ToolbarContent {
        if editor.readOnlyReason == nil {
            if editor.editing {
                ToolbarItem(placement: .cancellationAction) {
                    Button(Logic.t("ios.edit.discard"), role: .destructive) { editor.discard() }
                        .disabled(editor.busy)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(Logic.t("ios.edit.review")) { Task { await editor.review() } }
                        .disabled(editor.busy || editor.changes.isEmpty)
                }
            } else if !editor.deleted {
                ToolbarItem(placement: .primaryAction) {
                    Button(Logic.t("ios.edit.action")) { editor.begin() }
                }
                ToolbarItem(placement: .secondaryAction) {
                    Button(role: .destructive) {
                        Task { await editor.reviewDelete() }
                    } label: {
                        Label(Logic.t("ios.edit.delete"), systemImage: "trash")
                    }
                    .disabled(editor.busy)
                }
            }
        }
    }

    /// A column's value as typed, with a button that makes it NULL; typing
    /// into a NULL field gives it a value again.
    private func field(_ column: String) -> some View {
        let value = editor.value(column)
        let original = ref.columns.firstIndex { $0.name == column }.flatMap { editor.row[$0] }
        return VStack(alignment: .leading, spacing: 4) {
            fieldEditor(column, value: value)
            // What it held, once it is about to change.
            if editor.changes.keys.contains(column) {
                Text(Logic.t("ios.edit.was", ["value": original ?? "NULL"]))
                    .font(Theme.mono(11)).foregroundStyle(.secondary)
            }
        }
    }

    private func fieldEditor(_ column: String, value: String?) -> some View {
        HStack {
            TextField("NULL", text: Binding(get: { value ?? "" }, set: { editor.set(column, $0) }), axis: .vertical)
                .font(Theme.mono())
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button(Logic.t("ios.edit.null")) { editor.set(column, nil) }
                .font(Theme.mono(11))
                .buttonStyle(.bordered)
                .disabled(value == nil)
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

/// What a change will run, before it runs: the driver's own SQL, how many rows
/// it touches, and, on a production connection, a warning first.
private struct EditPreviewSheet: View {
    let editor: RowEditor

    var body: some View {
        NavigationStack {
            List {
                if editor.deleting {
                    Section {
                        Label(Logic.t("ios.edit.delete"), systemImage: "trash")
                            .foregroundStyle(.red)
                            .font(.subheadline.weight(.semibold))
                    }
                }
                if editor.production {
                    Section {
                        Label(Logic.t("ios.edit.production", ["name": editor.session.conn.name]),
                              systemImage: "exclamationmark.octagon.fill")
                            .foregroundStyle(.red)
                            .font(.subheadline.weight(.semibold))
                    }
                }
                Section {
                    ForEach(Array((editor.preview ?? []).enumerated()), id: \.offset) { _, sql in
                        Text(sql).font(Theme.mono(12)).textSelection(.enabled)
                    }
                } footer: {
                    let n = editor.preview?.count ?? 0
                    Text((n == 1 ? Logic.t("ios.edit.affectsOne") : Logic.t("ios.edit.affectsN", ["n": "\(n)"]))
                         + " " + Logic.t("ios.edit.transaction"))
                }
                Section {
                    Button {
                        Task { await editor.confirm() }
                    } label: {
                        Label(Logic.t("ios.edit.confirm"), systemImage: "faceid").frame(maxWidth: .infinity)
                    }
                    .disabled(editor.busy)
                }
            }
            .navigationTitle(Logic.t("ios.edit.previewTitle"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(Logic.t("common.cancel")) { editor.cancelPreview() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
