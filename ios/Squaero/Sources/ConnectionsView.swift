// The Conexiones tab (issue #576): saved connections grouped as on desktop,
// with add, edit, delete and connect.

import SquaeroLogic
import SwiftUI
import UniformTypeIdentifiers

struct ConnectionsView: View {
    @State private var store = ConnectionStore()
    @State private var editing: Connection?
    @State private var creating = false
    @State private var asking: Connection?
    @State private var typed: [String: String] = [:]
    @State private var session: Session?
    @Environment(\.scenePhase) private var phase
    @State private var busy: String?
    @State private var failure: String?
    @State private var importing = false
    @State private var imported: String?

    var body: some View {
        NavigationStack {
            List {
                ForEach(store.groups, id: \.name) { group in
                    Section(group.name ?? (store.groups.count > 1 ? Logic.t("ios.conn.ungrouped") : "")) {
                        ForEach(group.conns) { conn in row(conn) }
                    }
                }
                // Always there, so the first screen has something to open
                // with no server (task 7.4).
                Section {
                    demoRow
                } header: {
                    Text(Logic.t("ios.demo.section"))
                } footer: {
                    if store.connections.isEmpty { Text(Logic.t("ios.conn.emptyHint")) }
                }
            }
            .navigationTitle(Logic.t("ios.tab.connections"))
            .toolbar {
                Button { importing = true } label: { Image(systemName: "square.and.arrow.down") }
                    .accessibilityLabel(Logic.t("ios.import.action"))
                Button { creating = true } label: { Image(systemName: "plus") }
                    .accessibilityLabel(Logic.t("ios.conn.new"))
            }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
                guard case .success(let url) = result else { return }
                importFile(url)
            }
            .alert(Logic.t("ios.import.done"), isPresented: Binding(get: { imported != nil }, set: { if !$0 { imported = nil } })) {
                Button("OK") { imported = nil }
            } message: { Text(imported ?? "") }
            #if DEBUG
            // CI screenshots open the form straight away (ios-app.yml).
            .onAppear { if CommandLine.arguments.contains("-newConnection") { creating = true } }
            #endif
            .sheet(isPresented: $creating) {
                ConnectionForm(store: store, original: nil)
            }
            .sheet(item: $editing) { conn in
                ConnectionForm(store: store, original: conn)
            }
            .sheet(item: $asking) { conn in askSheet(conn) }
            .navigationDestination(item: $session) { s in
                BrowseView(session: s, level: .root(s.conn))
            }
            // Deeper screens of the session, declared once for the whole stack.
            .navigationDestination(for: TreeLevel.self) { level in
                if let session { BrowseView(session: session, level: level) }
            }
            .navigationDestination(for: ObjectRef.self) { object in
                if let session { RowsView(session: session, object: object) }
            }
            .navigationDestination(for: RowRef.self) { row in
                if let session { RowDetailView(session: session, ref: row) }
            }
            .onChange(of: session) { old, _ in
                OpenSession.shared.current = session
                // Back out of the browser: the session ends with it.
                if let old, old !== session {
                    let id = old.connId
                    Task { _ = try? await Core.shared.call("conn.close", ["connId": id]) }
                }
            }
            .onChange(of: phase) { before, now in
                // iOS closes a suspended app's sockets (design D7). Not
                // .inactive: Control Center or a call banner suspends nothing.
                if before == .background && now != .background { session?.lost = true }
            }
            .alert(Logic.t("ios.conn.failed"), isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
                Button("OK") { failure = nil }
            } message: { Text(failure ?? "") }
        }
    }

    private var demoRow: some View {
        Button(action: openDemo) {
            HStack(spacing: 12) {
                EngineBadge(driver: "sqlite")
                VStack(alignment: .leading, spacing: 2) {
                    Text(Logic.t("ios.demo.name")).font(.body.weight(.semibold)).foregroundStyle(.primary)
                    Text(Logic.t("ios.demo.detail")).font(.footnote).foregroundStyle(.secondary)
                }
                Spacer()
                if busy == DemoDatabase.connectionId { ProgressView() }
            }
        }
        .disabled(busy != nil)
        .swipeActions {
            Button(Logic.t("ios.demo.reset")) {
                do { try DemoDatabase.reset() } catch { failure = "\(error)" }
            }
            .tint(.orange)
        }
    }

    /// Builds the demo database the first time, then opens it like any
    /// SQLite connection (no secrets, so no Face ID).
    private func openDemo() {
        busy = DemoDatabase.connectionId
        Task {
            do {
                let url = try await DemoDatabase.ensure()
                busy = nil
                connect(DemoDatabase.connection(url), typed: [:])
            } catch {
                busy = nil
                failure = Logic.readable(error)
            }
        }
    }

    private func row(_ conn: Connection) -> some View {
        Button { start(conn) } label: {
            HStack(spacing: 12) {
                EngineBadge(driver: conn.driver)
                VStack(alignment: .leading, spacing: 2) {
                    Text(conn.name).font(.body.weight(.semibold)).foregroundStyle(.primary)
                    Text((try? Logic.shared.connectionTarget(conn)) ?? "")
                        .font(Theme.mono(12)).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                if busy == conn.id { ProgressView() }
            }
        }
        .disabled(busy != nil)
        .swipeActions {
            Button(role: .destructive) { try? store.delete(conn) } label: {
                Label(Logic.t("common.delete"), systemImage: "trash")
            }
            Button { editing = conn } label: { Label(Logic.t("ios.conn.edit"), systemImage: "pencil") }
                .tint(Theme.accent)
        }
    }

    private func askSheet(_ conn: Connection) -> some View {
        NavigationStack {
            Form {
                ForEach(Connector.missingSecrets(conn), id: \.self) { key in
                    SecureField(Logic.t(key == "password" ? "field.password" : "field.sshPassword"),
                                text: Binding(get: { typed[key] ?? "" }, set: { typed[key] = $0 }))
                        .textContentType(.password)
                }
            }
            .navigationTitle(Logic.t("ios.conn.askSecret", ["name": conn.name]))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(Logic.t("common.cancel")) { asking = nil; typed = [:] }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(Logic.t("ios.conn.connect")) {
                        let values = typed
                        asking = nil; typed = [:]
                        connect(conn, typed: values)
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }

    /// Desktop's export file (Conexiones → Exportar), with or without passwords.
    private func importFile(_ url: URL) {
        do {
            let (s, needFiles) = try store.importConnections(from: url)
            var text = Logic.t("ios.import.summary", ["added": "\(s.added)", "updated": "\(s.updated)", "skipped": "\(s.skipped)"])
            if needFiles > 0 { text += "\n\n" + Logic.t("ios.import.needFiles", ["n": "\(needFiles)"]) }
            imported = text
        } catch SquaeroLogicError.script(let message) {
            failure = message
        } catch {
            failure = "\(error)"
        }
    }

    private func start(_ conn: Connection) {
        if Connector.missingSecrets(conn).isEmpty { connect(conn, typed: [:]) } else { asking = conn }
    }

    /// Drops the dead session and opens a new one the usual way: Face ID, or
    /// the sheet asking for what the Keychain does not hold. The SSH tunnel
    /// is reopened with it, by the core.
    private func reconnect(_ s: Session) {
        let dead = s.connId
        Task { _ = try? await Core.shared.call("conn.close", ["connId": dead]) }
        start(s.conn)
    }

    private func connect(_ conn: Connection, typed: [String: String]) {
        busy = conn.id
        Task {
            defer { busy = nil }
            do {
                let id = try await Connector.open(conn, typed: typed)
                if let s = session, s.conn.id == conn.id {
                    // A reconnect: the same session, wherever the user is in it.
                    s.connId = id
                    s.lost = false
                } else {
                    let s = Session(conn: conn, connId: id)
                    s.reconnect = { [weak s] in if let s { reconnect(s) } }
                    session = s
                }
            } catch ConnectError.cancelled {
                failure = Logic.t("ios.faceid.cancelled")
            } catch ConnectError.core(let message) {
                // A refused local-network permission looks like any other
                // unreachable host: say where to allow it (task 7.1).
                let local = (try? Logic.shared.usesLocalNetwork(conn)) ?? false
                failure = local ? message + "\n\n" + Logic.t("ios.conn.localNetwork") : message
            } catch ConnectError.keychain(let message) {
                failure = message
            } catch {
                failure = "\(error)"
            }
        }
    }
}

/// The engine's two letters on the accent colour, like desktop's monogram.
struct EngineBadge: View {
    let driver: String

    var body: some View {
        Text((try? Logic.shared.engineMonogram(driver)) ?? "DB")
            .font(Theme.mono(11).weight(.bold))
            .foregroundStyle(.white)
            .frame(width: 34, height: 34)
            .background(Theme.accent, in: RoundedRectangle(cornerRadius: 8))
    }
}
