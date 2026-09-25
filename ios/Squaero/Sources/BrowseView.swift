// Browsing an open connection (issue #577, task 5.1): one schema.tree level
// per screen, databases → schemas → tables, as on desktop; where the tables
// are, Tablas / Vistas / Rutinas with a search. Routines come from the same
// catalog SQL as desktop (routines.ts). Every level shows the connection's
// state, and a lost one offers to reconnect in place.

import SquaeroLogic
import SwiftUI

/// An open connection. A reconnect swaps connId in place, so every screen of
/// the session keeps working; lost is set on a failed call (Core posts it)
/// or on returning from the background (ConnectionsView).
@MainActor
@Observable
final class Session: Hashable {
    let conn: Connection
    var connId: String
    var lost = false
    /// Set by ConnectionsView: Face ID or the secrets sheet, then connId.
    @ObservationIgnored var reconnect: () -> Void = {}
    @ObservationIgnored private var observer: NSObjectProtocol?

    init(conn: Connection, connId: String) {
        self.conn = conn
        self.connId = connId
        observer = NotificationCenter.default.addObserver(forName: Core.connectionLost, object: nil, queue: .main) {
            [weak self] note in
            let id = note.object as? String
            MainActor.assumeIsolated { if let self, id == self.connId { self.lost = true } }
        }
    }

    deinit { if let observer { NotificationCenter.default.removeObserver(observer) } }

    nonisolated static func == (a: Session, b: Session) -> Bool { a === b }
    nonisolated func hash(into h: inout Hasher) { h.combine(ObjectIdentifier(self)) }
}

/// The session Conexiones has open, for the other tabs (Consultas, #578):
/// one open connection at a time, as the browser has it.
@MainActor
@Observable
final class OpenSession {
    static let shared = OpenSession()
    var current: Session?
}

/// Where in the tree a screen is. The root starts at the connection's own
/// database when it names one, as desktop picks it.
struct TreeLevel: Hashable {
    var db: String?
    var schema: String?
    var title: String

    static func root(_ conn: Connection) -> TreeLevel {
        let db = conn.params["database"].flatMap { $0.isEmpty ? nil : $0 }
        return TreeLevel(db: db, schema: nil, title: conn.name)
    }

    func child(_ name: String) -> TreeLevel {
        db == nil ? TreeLevel(db: name, schema: nil, title: name) : TreeLevel(db: db, schema: name, title: name)
    }
}

struct RoutineRow: Hashable {
    var name: String
    var type: String
}

struct BrowseView: View {
    let session: Session
    let level: TreeLevel

    enum Kind: String, CaseIterable { case table, view, routine }

    @State private var rows: [TreeRow]?
    @State private var routines: [RoutineRow]?
    @State private var kind = Kind.table
    @State private var search = ""
    @State private var failure: String?

    private var support: RoutineSupport? {
        try? Logic.shared.routinesFor(session.conn.driver, db: level.db)
    }

    /// Tables and views, or containers when this level holds none.
    private var holdsObjects: Bool { rows?.contains { $0.kind == "table" || $0.kind == "view" } ?? false }

    var body: some View {
        List {
            if session.lost {
                Section {
                    Label(Logic.t("conn.lost", ["name": session.conn.name]), systemImage: "bolt.horizontal.circle")
                        .foregroundStyle(.orange)
                    Button(Logic.t("conn.reconnect"), action: session.reconnect)
                }
            }
            if holdsObjects {
                Section {
                    Picker("", selection: $kind) {
                        Text(Logic.t("ios.browse.tables")).tag(Kind.table)
                        Text(Logic.t("ios.browse.views")).tag(Kind.view)
                        if support?.supported == true { Text(Logic.t("ios.browse.routines")).tag(Kind.routine) }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                }
            }
            if let rows {
                if holdsObjects {
                    objects(rows)
                } else {
                    ForEach(matching(rows.map(\.name)), id: \.self) { name in
                        NavigationLink(value: level.child(name)) {
                            Label(name, systemImage: level.db == nil ? "cylinder" : "folder")
                        }
                    }
                }
            }
        }
        .overlay {
            if rows == nil && failure == nil {
                ProgressView()
            } else if let failure {
                ContentUnavailableView(Logic.t("ios.browse.failed"), systemImage: "exclamationmark.triangle",
                                       description: Text(failure))
            }
        }
        .searchable(text: $search)
        .navigationTitle(level.title)
        .task(id: session.connId) { await load() }
        .task(id: kind) { if kind == .routine && routines == nil { await loadRoutines() } }
        .refreshable { await load(); if kind == .routine { await loadRoutines() } }
    }

    @ViewBuilder
    private func objects(_ rows: [TreeRow]) -> some View {
        switch kind {
        case .table, .view:
            let names = matching(rows.filter { $0.kind == kind.rawValue }.map(\.name))
            if names.isEmpty { empty }
            ForEach(names, id: \.self) { name in
                NavigationLink(value: ObjectRef(db: level.db, schema: level.schema, name: name)) {
                    Label(name, systemImage: kind == .table ? "tablecells" : "eye")
                        .font(Theme.mono())
                }
            }
        case .routine:
            let list = (routines ?? []).filter { search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) }
            if routines != nil && list.isEmpty { empty }
            ForEach(list, id: \.self) { r in
                LabeledContent {
                    Text(r.type.lowercased()).font(.caption).foregroundStyle(.secondary)
                } label: {
                    Label(r.name, systemImage: "function").font(Theme.mono())
                }
            }
        }
    }

    private var empty: some View {
        Text(Logic.t("ios.browse.empty")).foregroundStyle(.secondary)
    }

    private func matching(_ names: [String]) -> [String] {
        search.isEmpty ? names : names.filter { $0.localizedCaseInsensitiveContains(search) }
    }

    private func params() -> [String: Any] {
        var p: [String: Any] = ["connId": session.connId]
        if let db = level.db { p["db"] = db }
        if let schema = level.schema { p["schema"] = schema }
        return p
    }

    private func load() async {
        do {
            let result = try await Core.shared.resultSet("schema.tree", params())
            rows = try Logic.shared.parseTreeRows(result, fallback: level.db == nil ? "database" : "schema")
            failure = nil
            if !holdsObjects && kind != .table { kind = .table }
        } catch let CoreError.rpc(_, message) {
            failure = message
        } catch {
            failure = "\(error)"
        }
    }

    /// The whole list, like desktop's (#590): a database with thousands of
    /// routines is the case that made desktop drop its limit.
    // ponytail: one query.run with a high limit instead of desktop's paged
    // drainQuery; page with cursor + query.next if a catalog ever tops it.
    private func loadRoutines() async {
        guard let s = support, s.supported, let sql = s.listSql, let nameCol = s.nameCol else { return }
        do {
            let result = try await Core.shared.resultSet("query.run", ["connId": session.connId, "sql": sql, "limit": 100_000])
            func col(_ name: String?) -> Int? { name.flatMap { n in result.columns.firstIndex { $0.name == n } } }
            let nameAt = col(nameCol), typeAt = col(s.typeCol), schemaAt = col(s.schemaCol)
            routines = result.rows.compactMap { row in
                guard let nameAt, let name = row[nameAt] else { return nil }
                // PostgreSQL lists every schema's; this screen is one schema.
                if let schemaAt, let schema = level.schema, row[schemaAt] != schema { return nil }
                return RoutineRow(name: name, type: typeAt.flatMap { row[$0] }?.trimmingCharacters(in: .whitespaces) ?? "")
            }
        } catch let CoreError.rpc(_, message) {
            failure = message
        } catch {
            failure = "\(error)"
        }
    }
}
