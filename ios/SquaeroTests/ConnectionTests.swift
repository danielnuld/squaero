// Connections on the iPhone (issue #576): secrets only in the Keychain, the
// list in a file without them, SQLite opened from a file of the app, and only
// the engines this build links offered.

import SquaeroLogic
import XCTest
@testable import Squaero

@MainActor
final class ConnectionTests: XCTestCase {
    private var dir: URL!
    private let secret = "s3cr3t-\(UUID().uuidString)"

    override func setUp() async throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: dir)
    }

    private func informix(_ store: ConnectionStore) -> Connection {
        Connection(id: store.newId(), name: "Juzgados", driver: "informix",
                   params: ["host": "10.0.0.5", "port": "9089", "user": "informix", "password": secret],
                   group: "Producción")
    }

    func testTheSecretGoesToTheKeychainAndNowhereElse() throws {
        let store = ConnectionStore(directory: dir, protectSecrets: false)
        let conn = informix(store)
        try store.save(conn, keep: true)
        defer { try? store.delete(conn) }

        XCTAssertEqual(try Keychain.read(account: Keychain.account(conn.id, "password")), secret)
        XCTAssertNil(store.connections[0].params["password"])
        XCTAssertEqual(Connector.missingSecrets(store.connections[0]), [])

        // Nothing under the app's container holds it: the store's file, the
        // preferences, caches, anything the app wrote.
        let roots = [dir!, URL(fileURLWithPath: NSHomeDirectory())]
        for root in roots {
            let files = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil)
            while let url = files?.nextObject() as? URL {
                guard let data = try? Data(contentsOf: url) else { continue }
                XCTAssertNil(data.range(of: Data(secret.utf8)), url.path)
            }
        }

        // A fresh store reads the same list back, still without it.
        let again = ConnectionStore(directory: dir, protectSecrets: false)
        XCTAssertEqual(again.connections.map(\.name), ["Juzgados"])
        XCTAssertEqual(again.groups.map(\.name), ["Producción"])
        XCTAssertNil(again.connections[0].params["password"])
    }

    func testTheSshKeyGoesToTheKeychainNotToAFile() throws {
        let store = ConnectionStore(directory: dir, protectSecrets: false)
        let key = "-----BEGIN OPENSSH PRIVATE KEY-----\n\(secret)\n"
        let picked = dir.appendingPathComponent("id_ed25519")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try Data(key.utf8).write(to: picked)

        var conn = informix(store)
        conn.params.merge(["ssh_host": "bastion", "ssh_user": "me", "ssh_auth": "key"]) { _, new in new }
        conn.params[ConnectionStore.sshKey] = try store.readKey(picked)
        try FileManager.default.removeItem(at: picked)
        try store.save(conn, keep: false)
        defer { try? store.delete(conn) }

        // Kept even with keep off: a key cannot be typed at connect time.
        let account = Keychain.account(conn.id, ConnectionStore.sshKey)
        XCTAssertEqual(try Keychain.read(account: account), key)
        XCTAssertNil(store.connections[0].params[ConnectionStore.sshKey])
        let files = FileManager.default.enumerator(at: dir, includingPropertiesForKeys: nil)
        while let url = files?.nextObject() as? URL {
            guard let data = try? Data(contentsOf: url) else { continue }
            XCTAssertNil(data.range(of: Data(secret.utf8)), url.path)
        }

        // Switching the tunnel to password auth drops it.
        var edited = store.connections[0]
        edited.params["ssh_auth"] = "password"
        try store.save(edited, keep: false)
        XCTAssertFalse(Keychain.exists(account: account))
    }

    func testImportingDesktopsFile() throws {
        let store = ConnectionStore(directory: dir, protectSecrets: false)
        let file = dir.appendingPathComponent("squaero-connections.json")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        // What desktop's Exportar writes, passwords included (its opt-in).
        let export: [String: Any] = ["version": 1, "connections": [
            ["id": "conn-1", "name": "Juzgados", "driver": "informix", "group": "Producción",
             "params": ["host": "10.0.0.5", "port": "9089", "user": "informix", "password": secret,
                        "tls": "verify-ca", "tls_ca": #"C:\certs\ca.pem"#]],
            ["id": "conn-2", "name": "Pruebas", "driver": "postgres",
             "params": ["host": "db", "database": "app", "user": "u"]],
        ]]
        try JSONSerialization.data(withJSONObject: export).write(to: file)

        let (summary, needFiles) = try store.importConnections(from: file)
        defer { for c in store.connections { try? store.delete(c) } }
        XCTAssertEqual(summary, MergeSummary(added: 2, updated: 0, skipped: 0))
        XCTAssertEqual(needFiles, 1)
        let juzgados = try XCTUnwrap(store.connections.first { $0.name == "Juzgados" })
        XCTAssertNil(juzgados.params["tls_ca"], "a path on the other machine")
        XCTAssertNil(juzgados.params["password"])
        XCTAssertEqual(try Keychain.read(account: Keychain.account(juzgados.id, "password")), secret)

        // Again: the same names update in place, nothing doubles.
        let (again, _) = try store.importConnections(from: file)
        XCTAssertEqual(again, MergeSummary(added: 0, updated: 2, skipped: 0))
        XCTAssertEqual(store.connections.count, 2)
    }

    func testAnUnreadableFileSaysWhy() throws {
        let store = ConnectionStore(directory: dir, protectSecrets: false)
        let file = dir.appendingPathComponent("bad.json")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try Data("{\"version\":9}".utf8).write(to: file)
        XCTAssertThrowsError(try store.importConnections(from: file)) { error in
            guard case SquaeroLogicError.script(let message) = error else { return XCTFail("\(error)") }
            XCTAssertTrue(message.contains("9"), message)
        }
    }

    func testNotKeepingMeansAskingEveryTime() throws {
        let store = ConnectionStore(directory: dir, protectSecrets: false)
        let conn = informix(store)
        try store.save(conn, keep: false)
        defer { try? store.delete(conn) }
        XCTAssertFalse(Keychain.exists(account: Keychain.account(conn.id, "password")))
        XCTAssertEqual(Connector.missingSecrets(store.connections[0]), ["password"])
    }

    func testEditingWithAnEmptyPasswordKeepsTheSavedOne() throws {
        let store = ConnectionStore(directory: dir, protectSecrets: false)
        var conn = informix(store)
        try store.save(conn, keep: true)
        defer { try? store.delete(conn) }
        conn.name = "Juzgados 2"
        conn.params["password"] = ""
        try store.save(conn, keep: true)
        XCTAssertEqual(try Keychain.read(account: Keychain.account(conn.id, "password")), secret)
    }

    func testDeleteRemovesTheSecretAndTheFiles() throws {
        let store = ConnectionStore(directory: dir, protectSecrets: false)
        let conn = informix(store)
        try store.save(conn, keep: true)
        let picked = dir.appendingPathComponent("ca.pem")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try Data("pem".utf8).write(to: picked)
        _ = try store.importFile(picked, connId: conn.id)

        try store.delete(conn)
        XCTAssertFalse(Keychain.exists(account: Keychain.account(conn.id, "password")))
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.filesDirectory(conn.id).path))
        XCTAssertTrue(store.connections.isEmpty)
    }

    func testSqliteFromAPickedFile() async throws {
        let store = ConnectionStore(directory: dir, protectSecrets: false)
        let picked = dir.appendingPathComponent("picked.db")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: picked.path, contents: nil)

        var conn = Connection(id: store.newId(), name: "", driver: "sqlite")
        conn.params["path"] = try store.importFile(picked, connId: conn.id)
        XCTAssertTrue(conn.params["path"]!.hasPrefix(store.filesDirectory(conn.id).path))
        XCTAssertEqual(try Logic.shared.defaultConnectionName(conn), "picked.db")
        try store.save(conn, keep: true)
        defer { try? store.delete(conn) }

        // Read and write, in the app's copy.
        let id = try await Connector.open(conn, protected: false)
        _ = try await Core.shared.call("query.run", ["connId": id, "sql": "CREATE TABLE t (n INTEGER)", "limit": 1])
        _ = try await Core.shared.call("query.run", ["connId": id, "sql": "INSERT INTO t VALUES (7)", "limit": 1])
        let result = try await Core.shared.call("query.run", ["connId": id, "sql": "SELECT n FROM t", "limit": 1])
        XCTAssertEqual(((result as? [String: Any])?["rows"] as? [[Any]])?.first?.first as? String, "7")
        _ = try await Core.shared.call("conn.close", ["connId": id])
    }

    func testAFailedOpenSaysWhy() async throws {
        let conn = Connection(id: "conn-x", name: "Nadie", driver: "sqlite",
                              params: ["path": "/no/such/dir/x.db"])
        do {
            _ = try await Connector.open(conn, protected: false)
            XCTFail("expected an error")
        } catch ConnectError.core(let message) {
            XCTAssertFalse(message.isEmpty)
        }
    }

    func testOnlyLinkedEnginesAreOffered() {
        XCTAssertTrue(Core.shared.hasDriver("sqlite"))
        XCTAssertTrue(Core.shared.hasDriver("informix"))
        XCTAssertTrue(Core.shared.hasDriver("postgres"))
        XCTAssertTrue(Core.shared.hasDriver("mongodb"))
        XCTAssertTrue(Core.shared.hasDriver("mysql")) // on libmywire (#583)
        XCTAssertFalse(Core.shared.hasDriver("mssql"))
    }

    func testTheCatalogSpeaksBothLanguages() throws {
        XCTAssertEqual(try Logic.shared.translate("ios.conn.keychain", locale: "es"), "Guardar en el llavero")
        XCTAssertEqual(try Logic.shared.translate("ios.conn.keychain", locale: "en"), "Save in the Keychain")
    }
}
