// Saved connections (issue #576): the list, without secrets, as JSON in
// Application Support, parsed and grouped by the same code as desktop
// (connections.ts through SquaeroLogic). Secrets go to the Keychain; files a
// connection needs (a SQLite database, later a CA) are copied into the app's
// own folder for that connection, so they stay readable after the picker.

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

    static var defaultDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Squaero", isDirectory: true)
    }

    private var file: URL { directory.appendingPathComponent("connections.json") }

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
        let stripped = try Logic.shared.stripSecrets(conn)
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

    private func write() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(connections)
        // Complete protection: unreadable while the iPhone is locked.
        try data.write(to: file, options: [.atomic, .completeFileProtection])
    }
}
