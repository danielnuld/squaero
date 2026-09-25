// A table's rows (issue #577, task 5.2): on a phone a row is a card, not a
// grid line. Filters and the sort run at the server, like desktop's filter
// panel (#347): the conditions are chips, rendered to WHERE / ORDER BY by
// desktop's dataFilter and pagination. Pages come from one open cursor
// (query.run + query.next, #478), read on as the list scrolls.

import SquaeroLogic
import SwiftUI

/// A table or view to open, where it lives in the tree. `where` narrows it
/// for good (the rows related to another row, relatedData.ts), under whatever
/// the user filters; `label` then says by what.
struct ObjectRef: Hashable {
    var db: String?
    var schema: String?
    var name: String
    var `where`: String? = nil
    var label: String? = nil
}

/// One row, opened from its table's list.
struct RowRef: Hashable {
    var object: ObjectRef
    var columns: [ResultColumn]
    var row: [String?]
    /// Declared type per column (schema.describe), when there was one.
    var types: [String: String]
    /// The primary key's columns; empty means the row cannot be edited.
    var pk: [String] = []
}

/// Loads a table's rows page by page. Kept apart from the view so the paging
/// can be tested without one.
@MainActor
@Observable
final class RowPager {
    static let pageSize = 50

    let session: Session
    let object: ObjectRef
    var draft = FilterDraft(conditions: [])
    private(set) var columns: [ResultColumn] = []
    private(set) var rows: [[String?]] = []
    private(set) var more = false
    private(set) var cursor = false
    private(set) var loading = false
    private(set) var failure: String?
    private(set) var types: [String: String] = [:]
    private(set) var names: [String] = []
    private(set) var pk: [String] = []

    init(session: Session, object: ObjectRef) {
        self.session = session
        self.object = object
    }

    private var driver: String { session.conn.driver }
    /// MongoDB's preview is find({}): desktop shows no filter panel for it
    /// rather than one that would not filter (pagination.ts).
    var filterable: Bool { driver != "mongodb" }

    func describe() async {
        var p: [String: Any] = ["connId": session.connId, "table": object.name]
        if let db = object.db { p["db"] = db }
        if let schema = object.schema { p["schema"] = schema }
        guard let d = try? await Core.shared.resultSet("schema.describe", p) else { return }
        types = (try? Logic.shared.describeColumnTypes(d)) ?? [:]
        names = (try? Logic.shared.describeColumnNames(d)) ?? []
        pk = (try? Logic.shared.describePkColumns(d)) ?? []
    }

    private func sql() throws -> String {
        var filter = filterable ? try Logic.shared.draftFilter(engine: driver, draft, types: types) : nil
        if let fixed = object.where {
            let own = filter?.where.flatMap { $0.isEmpty ? nil : $0 }
            filter = PreviewFilter(where: own.map { "(\(fixed)) AND (\($0))" } ?? fixed, orderBy: filter?.orderBy)
        }
        return try Logic.shared.objectPreviewQuery(db: object.db, schema: object.schema, name: object.name,
                                                  engine: driver, filter: filter)
    }

    /// The first page of the filtered object, on a fresh cursor.
    func reload() async {
        loading = true
        defer { loading = false }
        do {
            let first = try await Core.shared.resultSet("query.run", [
                "connId": session.connId, "sql": try sql(), "limit": Self.pageSize, "cursor": true,
            ])
            columns = first.columns
            rows = first.rows
            more = first.truncated
            cursor = first.cursor == true
            if names.isEmpty { names = first.columns.map(\.name) }
            failure = nil
        } catch {
            failure = Self.text(error)
        }
    }

    /// The next page: from the open cursor, or re-run from an offset when the
    /// driver could not keep one (drainQuery on desktop does the same).
    func page() async {
        guard more, !loading else { return }
        loading = true
        defer { loading = false }
        do {
            let next = cursor
                ? try await Core.shared.resultSet("query.next", ["connId": session.connId, "limit": Self.pageSize])
                : try await Core.shared.resultSet("query.run", [
                    "connId": session.connId, "sql": try sql(), "limit": Self.pageSize, "offset": rows.count,
                ])
            rows += next.rows
            more = next.truncated && !next.rows.isEmpty
            cursor = next.cursor == true
        } catch {
            failure = Self.text(error)
        }
    }

    /// One cursor per connection: leave none behind for the next screen.
    func close() {
        guard cursor else { return }
        cursor = false
        let id = session.connId
        Task { _ = try? await Core.shared.call("query.cursorClose", ["connId": id]) }
    }

    /// Header-click semantics from desktop: ascending, descending, off.
    func sort(by column: String) {
        let current = draft.order.count == 1 && draft.order[0].column == column ? draft.order[0].dir : nil
        switch current {
        case nil: draft.order = [OrderBy(column: column, dir: "ASC")]
        case "ASC": draft.order = [OrderBy(column: column, dir: "DESC")]
        default: draft.order = []
        }
    }

    private static func text(_ error: Error) -> String {
        if case let CoreError.rpc(_, message) = error { return message }
        return "\(error)"
    }
}

struct RowsView: View {
    @State private var pager: RowPager
    @State private var adding = false
    /// A row of this table was saved from its form: read the rows again on
    /// coming back, not while the form still uses the connection.
    @State private var stale = false
    @State private var exporting = false
    @State private var askingFilter = false

    init(session: Session, object: ObjectRef) {
        _pager = State(initialValue: RowPager(session: session, object: object))
    }

    private var session: Session { pager.session }

    var body: some View {
        List {
            if session.lost {
                Section {
                    Label(Logic.t("conn.lost", ["name": session.conn.name]), systemImage: "bolt.horizontal.circle")
                        .foregroundStyle(.orange)
                    Button(Logic.t("conn.reconnect"), action: session.reconnect)
                }
            }
            if pager.filterable && !(pager.draft.conditions.isEmpty && pager.draft.order.isEmpty) {
                Section { chips }
            }
            if let label = pager.object.label {
                Section { Label(label, systemImage: "link").font(Theme.mono(12)).foregroundStyle(.secondary) }
            }
            ForEach(pager.rows.indices, id: \.self) { i in
                NavigationLink(value: RowRef(object: pager.object, columns: pager.columns, row: pager.rows[i],
                                             types: pager.types, pk: pager.pk)) {
                    RowCard(columns: pager.columns, row: pager.rows[i])
                }
                // Opening a row leaves this screen, which closes the cursor:
                // the next page then comes from an offset (RowPager.page).
                .onAppear { if i == pager.rows.count - 1 { Task { await pager.page() } } }
            }
            if pager.loading { HStack { Spacer(); ProgressView(); Spacer() } }
        }
        .overlay {
            if let failure = pager.failure {
                ContentUnavailableView(Logic.t("ios.browse.failed"), systemImage: "exclamationmark.triangle",
                                       description: Text(failure))
            } else if !pager.loading && pager.rows.isEmpty && !pager.columns.isEmpty {
                ContentUnavailableView(Logic.t("ios.rows.none"), systemImage: "tray")
            }
        }
        .navigationTitle(pager.object.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if pager.filterable {
                Menu {
                    Button { adding = true } label: { Label(Logic.t("ios.rows.addFilter"), systemImage: "plus") }
                    // The on-device agent (#580), where it is and is on.
                    if AgentSettings.active {
                        Button { askingFilter = true } label: {
                            Label(Logic.t("ios.agent.askFilter"), systemImage: "sparkles")
                        }
                    }
                    Menu {
                        ForEach(pager.names, id: \.self) { col in
                            Button(col) { pager.sort(by: col); Task { await pager.reload() } }
                        }
                    } label: { Label(Logic.t("ios.rows.sort"), systemImage: "arrow.up.arrow.down") }
                } label: { Image(systemName: "line.3.horizontal.decrease.circle") }
                    .accessibilityLabel(Logic.t("ios.rows.filter"))
            }
            Button { exporting = true } label: { Image(systemName: "square.and.arrow.up") }
                .accessibilityLabel(Logic.t("ios.export.action"))
                .disabled(pager.columns.isEmpty)
        }
        .sheet(isPresented: $exporting) { ExportSheet(source: pager) }
        .sheet(isPresented: $askingFilter) {
            AskFilterSheet(table: pager.object.name, columns: pager.names, types: pager.types) { conditions in
                pager.draft.conditions += conditions
                Task { await pager.reload() }
            }
        }
        .sheet(isPresented: $adding) {
            ConditionSheet(columns: pager.names) { condition in
                pager.draft.conditions.append(condition)
                Task { await pager.reload() }
            }
        }
        .task(id: session.connId) {
            await pager.describe()
            await pager.reload()
        }
        .refreshable { await pager.reload() }
        .onReceive(NotificationCenter.default.publisher(for: RowEditor.saved)) { note in
            if note.object as? ObjectRef == pager.object { stale = true }
        }
        .onAppear {
            guard stale else { return }
            stale = false
            Task { await pager.reload() }
        }
        .onDisappear { pager.close() }
    }

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(pager.draft.conditions.indices, id: \.self) { i in
                    let c = pager.draft.conditions[i]
                    chip("\(c.column) \(c.op)\(c.value.isEmpty ? "" : " \(c.value)")") {
                        pager.draft.conditions.remove(at: i)
                        Task { await pager.reload() }
                    }
                }
                ForEach(pager.draft.order.indices, id: \.self) { i in
                    let o = pager.draft.order[i]
                    chip("\(o.column) \(o.dir == "ASC" ? "↑" : "↓")") {
                        pager.draft.order.remove(at: i)
                        Task { await pager.reload() }
                    }
                }
            }
        }
        .listRowInsets(EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12))
    }

    private func chip(_ text: String, remove: @escaping () -> Void) -> some View {
        Button(action: remove) {
            HStack(spacing: 4) {
                Text(text).font(Theme.mono(12))
                Image(systemName: "xmark.circle.fill").font(.caption)
            }
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(Theme.accent.opacity(0.15), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityHint(Logic.t("ios.rows.removeFilter"))
    }
}

/// A row as a card: the first column is its title, the next few its lines.
/// Shared by a table's rows and a query's result.
struct RowCard: View {
    let columns: [ResultColumn]
    let row: [String?]

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(row.first.flatMap { $0 } ?? "NULL")
                .font(Theme.mono(14).weight(.semibold))
                .lineLimit(1)
            ForEach(Array(zip(columns.dropFirst().prefix(3), row.dropFirst().prefix(3))), id: \.0.name) { col, value in
                HStack(spacing: 6) {
                    Text(col.name).foregroundStyle(.secondary)
                    Text(value ?? "NULL").foregroundStyle(value == nil ? .tertiary : .primary)
                }
                .font(Theme.mono(12))
                .lineLimit(1)
            }
        }
        .padding(.vertical, 2)
    }
}

/// One condition for the server-side filter: a column, an operator and, unless
/// the operator takes none, a value (BETWEEN's two bounds joined by "…").
private struct ConditionSheet: View {
    let columns: [String]
    let add: (Condition) -> Void

    private static let operators = AgentFilter.operators

    @Environment(\.dismiss) private var dismiss
    @State private var column = ""
    @State private var op = "="
    @State private var value = ""

    private var nullary: Bool { op == "IS NULL" || op == "IS NOT NULL" }

    var body: some View {
        NavigationStack {
            Form {
                Picker(Logic.t("ios.rows.column"), selection: $column) {
                    ForEach(columns, id: \.self) { Text($0).tag($0) }
                }
                Picker(Logic.t("ios.rows.operator"), selection: $op) {
                    ForEach(Self.operators, id: \.self) { Text($0).tag($0) }
                }
                if !nullary {
                    TextField(Logic.t("ios.rows.value"), text: $value,
                              prompt: Text(op == "BETWEEN" ? "1…10" : op == "IN" ? "1, 2, 3" : ""))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(Theme.mono())
                }
            }
            .navigationTitle(Logic.t("ios.rows.addFilter"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(Logic.t("common.cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(Logic.t("ios.rows.apply")) {
                        add(Condition(column: column, op: op, value: nullary ? "" : value))
                        dismiss()
                    }
                    .disabled(column.isEmpty)
                }
            }
            .onAppear { if column.isEmpty { column = columns.first ?? "" } }
        }
        .presentationDetents([.medium])
    }
}

/// Filtering by asking (task 8.3): a request in plain words, the model's
/// conditions checked against the columns, then the usual chips.
private struct AskFilterSheet: View {
    let table: String
    let columns: [String]
    let types: [String: String]
    let add: ([Condition]) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var request = ""
    @State private var thinking = false
    @State private var failure: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(Logic.t("ios.agent.askPrompt"), text: $request, axis: .vertical)
                        .lineLimit(2...4)
                        .submitLabel(.go)
                        .onSubmit(ask)
                } footer: {
                    if let failure { Text(failure).foregroundStyle(.red) }
                }
                if thinking { HStack { Spacer(); ProgressView(Logic.t("ios.agent.thinking")); Spacer() } }
            }
            .navigationTitle(Logic.t("ios.agent.askFilter"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(Logic.t("common.cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(Logic.t("ios.rows.apply"), action: ask)
                        .disabled(thinking || request.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func ask() {
        guard !thinking else { return }
        thinking = true
        failure = nil
        Task {
            defer { thinking = false }
            #if canImport(FoundationModels)
            if #available(iOS 26.0, *) {
                do {
                    let conditions = try await AgentFilter.ask(request, table: table, columns: columns, types: types)
                    if conditions.isEmpty {
                        failure = Logic.t("ios.agent.noFilter")
                    } else {
                        add(conditions)
                        dismiss()
                    }
                } catch {
                    failure = error.localizedDescription
                }
                return
            }
            #endif
            failure = Logic.t("ios.agent.noFilter")
        }
    }
}
