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
    @State private var open: OpenConnection?
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
            }
            .overlay {
                if store.connections.isEmpty {
                    ContentUnavailableView(Logic.t("ios.conn.empty"), systemImage: "cylinder.split.1x2",
                                           description: Text(Logic.t("ios.conn.emptyHint")))
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
            .navigationDestination(item: $open) { o in
                // A fresh session is a fresh view: its lost flag starts clear.
                OpenConnectionView(open: o, reconnect: { reconnect(o) }).id(o.connId)
            }
            .alert(Logic.t("ios.conn.failed"), isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
                Button("OK") { failure = nil }
            } message: { Text(failure ?? "") }
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
    private func reconnect(_ o: OpenConnection) {
        Task { _ = try? await Core.shared.call("conn.close", ["connId": o.connId]) }
        start(o.conn)
    }

    private func connect(_ conn: Connection, typed: [String: String]) {
        busy = conn.id
        Task {
            defer { busy = nil }
            do {
                let id = try await Connector.open(conn, typed: typed)
                open = OpenConnection(conn: conn, connId: id)
            } catch ConnectError.cancelled {
                failure = Logic.t("ios.faceid.cancelled")
            } catch ConnectError.keychain(let message), ConnectError.core(let message) {
                failure = message
            } catch {
                failure = "\(error)"
            }
        }
    }
}

struct OpenConnection: Hashable {
    let conn: Connection
    let connId: String
}

/// What a connection shows once open, until the browser (#577) replaces it.
/// iOS closes the sockets of a suspended app, so coming back from the
/// background marks the session lost rather than trusting it (design D7), as
/// does any call that fails for want of a connection.
struct OpenConnectionView: View {
    let open: OpenConnection
    let reconnect: () -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @State private var lost = false

    var body: some View {
        List {
            if lost {
                Section {
                    Label(Logic.t("conn.lost", ["name": open.conn.name]), systemImage: "bolt.horizontal.circle")
                        .foregroundStyle(.orange)
                    Button(Logic.t("conn.reconnect"), action: reconnect)
                }
            }
            Section {
                LabeledContent(Logic.t("ios.conn.connected")) {
                    Text(open.connId).font(Theme.mono())
                }
                Text((try? Logic.shared.connectionTarget(open.conn)) ?? "").font(Theme.mono(12))
            } footer: { Text(Logic.t("ios.conn.tablesSoon")) }
            Button(Logic.t("ios.conn.disconnect"), role: .destructive) {
                Task {
                    _ = try? await Core.shared.call("conn.close", ["connId": open.connId])
                    dismiss()
                }
            }
        }
        .navigationTitle(open.conn.name)
        .onChange(of: phase) { before, now in
            // Not .inactive: Control Center or a call banner suspends nothing.
            if before == .background && now != .background { lost = true }
        }
        .onReceive(NotificationCenter.default.publisher(for: Core.connectionLost)) {
            if $0.object as? String == open.connId { lost = true }
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
