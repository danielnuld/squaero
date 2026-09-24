// Saved connections (issue #576): the list, without secrets, as JSON in
// Application Support, parsed and grouped by the same code as desktop
// (connections.ts through SquaeroLogic). Secrets go to the Keychain; files a
// connection needs (a SQLite database, later a CA) are copied into the app's
// own folder for that connection, so they stay readable after the picker.
// An SSH private key is the exception: it is a secret, so it goes to the
// Keychain as text and reaches the core as ssh_private_key, never as a file.

import Foundation
import Observation
import SquaeroLogic

@MainActor
@Observable
final class ConnectionStore {
    private(set) var connections: [Connection] = []
    /// Why the last load or save failed, for the list to show.
    var lastError: String?

    private let directory: URL
    /// Off only in tests (see Keychain.save).
    private let protectSecrets: Bool

    init(directory: URL = ConnectionStore.defaultDirectory, protectSecrets: Bool = true) {
        self.directory = directory
        self.protectSecrets = protectSecrets
        load()
    }

    nonisolated static var defaultDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Squaero", isDirectory: true)
    }

    private var file: URL { directory.appendingPathComponent("connections.json") }

    /// The DSN field (docs/IPC.md) and Keychain entry of the SSH private key.
    nonisolated static let sshKey = "ssh_private_key"

    /// Where the files of one connection live.
    func filesDirectory(_ connId: String) -> URL {
        directory.appendingPathComponent("files", isDirectory: true)
            .appendingPathComponent(connId, isDirectory: true)
    }

    func load() {
        guard let data = try? Data(contentsOf: file) else { connections = []; return }
        do {
            connections = try Logic.shared.parseConnections(String(decoding: data, as: UTF8.self))
        } catch {
            lastError = "\(error)"
        }
    }

    var groups: [ConnectionGroup] { (try? Logic.shared.groupConnections(connections)) ?? [] }

    func newId() -> String { (try? Logic.shared.nextConnectionId(connections)) ?? UUID().uuidString }

    /// Saves `conn`. Its secret fields go to the Keychain when `keep` is on and
    /// are dropped otherwise (asked at every connect); either way the file
    /// never holds them.
    func save(_ conn: Connection, keep: Bool) throws {
        for key in try Logic.shared.secretKeys(driver: conn.driver) {
            let account = Keychain.account(conn.id, key)
            let value = conn.params[key] ?? ""
            if keep, !value.isEmpty {
                try Keychain.save(value, account: account, protected: protectSecrets)
            } else if !keep {
                Keychain.delete(account: account)
            }
            // keep with an empty field: leave what the Keychain already has,
            // so editing a name does not wipe a saved password.
        }
        // The key is kept whatever `keep` says: there is no typing it at
        // connect time. It goes when the tunnel stops using key auth.
        let keyAccount = Keychain.account(conn.id, Self.sshKey)
        if let key = conn.params[Self.sshKey], !key.isEmpty {
            try Keychain.save(key, account: keyAccount, protected: protectSecrets)
        } else if conn.params["ssh_auth"] != "key" {
            Keychain.delete(account: keyAccount)
        }
        var stripped = try Logic.shared.stripSecrets(conn)
        stripped.params[Self.sshKey] = nil
        if let i = connections.firstIndex(where: { $0.id == conn.id }) {
            connections[i] = stripped
        } else {
            connections.append(stripped)
        }
        try write()
    }

    func delete(_ conn: Connection) throws {
        for key in (try? Logic.shared.secretKeys(driver: conn.driver)) ?? [] {
            Keychain.delete(account: Keychain.account(conn.id, key))
        }
        Keychain.delete(account: Keychain.account(conn.id, Self.sshKey))
        try? FileManager.default.removeItem(at: filesDirectory(conn.id))
        connections.removeAll { $0.id == conn.id }
        try write()
    }

    /// Copies a file picked in Files into the connection's folder and returns
    /// the path to store in its field.
    func importFile(_ url: URL, connId: String) throws -> String {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let folder = filesDirectory(connId)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let target = folder.appendingPathComponent(url.lastPathComponent)
        try? FileManager.default.removeItem(at: target)
        try FileManager.default.copyItem(at: url, to: target)
        return target.path
    }

    /// Merges desktop's export file (issue #576), with desktop's rules. Its
    /// passwords, when the export carried them, go to the Keychain. Its file
    /// fields name paths on the other machine, so they are cleared, keeping
    /// what this iPhone already had picked; `needFiles` counts the connections
    /// left without one (a CA, a SQLite file) or without their SSH key.
    func importConnections(from url: URL) throws -> (summary: MergeSummary, needFiles: Int) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let raw = try String(contentsOf: url, encoding: .utf8)
        let before = connections
        let result = try Logic.shared.importConnectionsFile(connections, raw: raw)
        let schemas = try Logic.shared.driverSchemas()
        var needFiles = 0
        for id in result.ids {
            guard var conn = result.list.first(where: { $0.id == id }) else { continue }
            let old = before.first { $0.id == id }
            var missing = false
            for f in schemas[conn.driver]?.fields ?? [] where f.type == "file" {
                guard !(conn.params[f.key] ?? "").isEmpty else { continue }
                conn.params[f.key] = old?.params[f.key]
                if f.key == "ssh_key" {
                    conn.params[f.key] = nil
                    missing = missing || !Keychain.exists(account: Keychain.account(id, Self.sshKey))
                } else if (conn.params[f.key] ?? "").isEmpty {
                    missing = true
                }
            }
            if missing { needFiles += 1 }
            try save(conn, keep: true)
        }
        return (result.summary, needFiles)
    }

    /// The text of a key picked in Files, read without copying the file.
    func readKey(_ url: URL) throws -> String {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        return try String(contentsOf: url, encoding: .utf8)
    }

    private func write() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(connections)
        // Complete protection: unreadable while the iPhone is locked.
        try data.write(to: file, options: [.atomic, .completeFileProtection])
    }
}
