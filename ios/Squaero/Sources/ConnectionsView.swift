// The Conexiones tab (issue #576): saved connections grouped as on desktop,
// with add, edit, delete and connect.

import SquaeroLogic
import SwiftUI

struct ConnectionsView: View {
    @State private var store = ConnectionStore()
    @State private var editing: Connection?
    @State private var creating = false
    @State private var asking: Connection?
    @State private var typed: [String: String] = [:]
    @State private var open: OpenConnection?
    @State private var busy: String?
    @State private var failure: String?

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
                Button { creating = true } label: { Image(systemName: "plus") }
                    .accessibilityLabel(Logic.t("ios.conn.new"))
            }
            .sheet(isPresented: $creating) {
                ConnectionForm(store: store, original: nil)
            }
            .sheet(item: $editing) { conn in
                ConnectionForm(store: store, original: conn)
            }
            .sheet(item: $asking) { conn in askSheet(conn) }
            .navigationDestination(item: $open) { OpenConnectionView(open: $0) }
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

    private func start(_ conn: Connection) {
        if Connector.missingSecrets(conn).isEmpty { connect(conn, typed: [:]) } else { asking = conn }
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
struct OpenConnectionView: View {
    let open: OpenConnection
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
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
