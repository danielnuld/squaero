// Live connections from the simulator (issue #576, task 4.7), through the
// app's own Connector, against the servers scripts/ios/live-servers.sh starts
// on the Mac: PostgreSQL and MongoDB with TLS verified against a CA picked as a
// file, and PostgreSQL through an SSH tunnel with a key held as text, as the
// Keychain holds it. Skipped unless QUAERO_LIVE=1 (ios-app.yml sets it).
// Informix is not here: its server only comes as a Docker image.

import SquaeroLogic
import XCTest
@testable import Squaero

@MainActor
final class LiveTests: XCTestCase {
    private let env = ProcessInfo.processInfo.environment
    private var ca: String!

    override func setUp() async throws {
        try XCTSkipUnless(env["QUAERO_LIVE"] == "1", "no live servers")
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("ca.pem")
        try decoded("QUAERO_LIVE_CA").write(to: url)
        ca = url.path
    }

    private func decoded(_ name: String) throws -> Data {
        try XCTUnwrap(Data(base64Encoded: env[name] ?? ""), name)
    }

    private func postgres(_ extra: [String: String] = [:]) -> Connection {
        var params = ["host": "127.0.0.1", "port": "55432", "database": "live", "user": "squaero"]
        params.merge(extra) { _, new in new }
        return Connection(id: "live-pg", name: "live", driver: "postgres", params: params)
    }

    private func firstCell(_ connId: String, _ sql: String) async throws -> String? {
        let result = try await Core.shared.call("query.run", ["connId": connId, "sql": sql, "limit": 1])
        return ((result as? [String: Any])?["rows"] as? [[Any]])?.first?.first as? String
    }

    private func close(_ connId: String) async {
        _ = try? await Core.shared.call("conn.close", ["connId": connId])
    }

    func testPostgresVerifiesTheServerAgainstThePickedCA() async throws {
        let conn = postgres(["sslmode": "verify-full", "sslrootcert": ca])
        let id = try await Connector.open(conn, typed: ["password": "live"], protected: false)
        let ssl = try await firstCell(id, "SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()")
        XCTAssertTrue(["t", "true", "1"].contains(ssl ?? ""), ssl ?? "nil")
        await close(id)
    }

    func testWithoutTheCAThereIsNothingToVerifyAgainst() async throws {
        // iOS has no trust store OpenSSL can read: verifying needs the CA.
        do {
            _ = try await Connector.open(postgres(["sslmode": "verify-full"]), typed: ["password": "live"], protected: false)
            XCTFail("verify-full without a CA connected")
        } catch ConnectError.core(let message) {
            XCTAssertFalse(message.isEmpty)
        }
    }

    func testMongoWithTLSAndItsCA() async throws {
        let conn = Connection(id: "live-mongo", name: "live", driver: "mongodb",
                              params: ["host": "127.0.0.1", "port": "57017", "database": "live",
                                       "tls": "true", "tls_ca": ca])
        let id = try await Connector.open(conn, protected: false)
        await close(id)
    }

    func testMongoTLSWithoutTheCAFails() async throws {
        let conn = Connection(id: "live-mongo", name: "live", driver: "mongodb",
                              params: ["host": "127.0.0.1", "port": "57017", "database": "live", "tls": "true"])
        do {
            _ = try await Connector.open(conn, protected: false)
            XCTFail("TLS without a CA connected")
        } catch ConnectError.core(let message) {
            XCTAssertFalse(message.isEmpty)
        }
    }

    func testBrowsingPostgres() async throws {
        let conn = postgres(["sslmode": "require"])
        let id = try await Connector.open(conn, typed: ["password": "live"], protected: false)
        _ = try await Core.shared.call("query.run", ["connId": id, "sql": "CREATE TABLE IF NOT EXISTS salas (n int)"])
        _ = try await Core.shared.call("query.run", ["connId": id, "sql":
            "CREATE OR REPLACE FUNCTION doble(n int) RETURNS int AS 'SELECT n * 2' LANGUAGE sql"])

        // The screens' walk: the connection's database lists schemas, public its tables.
        let root = TreeLevel.root(conn)
        let schemas = try Logic.shared.parseTreeRows(
            try await Core.shared.resultSet("schema.tree", ["connId": id, "db": root.db!]), fallback: "schema")
        XCTAssertTrue(schemas.contains(TreeRow(name: "public", kind: "schema")), "\(schemas)")
        let tables = try Logic.shared.parseTreeRows(
            try await Core.shared.resultSet("schema.tree", ["connId": id, "db": root.db!, "schema": "public"]),
            fallback: "schema")
        XCTAssertTrue(tables.contains(TreeRow(name: "salas", kind: "table")), "\(tables)")

        let routines = try Logic.shared.routinesFor("postgres", db: root.db)
        let listed = try await Core.shared.resultSet("query.run", ["connId": id, "sql": routines.listSql!, "limit": 100_000])
        let name = try XCTUnwrap(listed.columns.firstIndex { $0.name == routines.nameCol })
        XCTAssertTrue(listed.rows.contains { $0[name] == "doble" })
        await close(id)
    }

    func testRowsOfAPostgresTablePagedAndFiltered() async throws {
        let conn = postgres(["sslmode": "require"])
        let id = try await Connector.open(conn, typed: ["password": "live"], protected: false)
        _ = try await Core.shared.call("query.run", ["connId": id, "sql":
            "DROP TABLE IF EXISTS filas; CREATE TABLE filas AS SELECT g AS n FROM generate_series(1, 70) g"])
        let session = Session(conn: conn, connId: id)
        let object = ObjectRef(db: "live", schema: "public", name: "filas")

        let all = RowPager(session: session, object: object)
        await all.describe()
        await all.reload()
        XCTAssertNil(all.failure)
        XCTAssertEqual(all.rows.count, RowPager.pageSize)
        await all.page()
        XCTAssertEqual(all.rows.count, 70)
        all.close()

        // The declared int type quotes 60 as a number, not '60'.
        let some = RowPager(session: session, object: object)
        await some.describe()
        some.draft.conditions = [Condition(column: "n", op: ">=", value: "60")]
        await some.reload()
        XCTAssertNil(some.failure)
        XCTAssertEqual(some.rows.count, 11)
        some.close()
        await close(id)
    }

    func testPostgresThroughAnSSHTunnelWithAKeyFromTheKeychain() async throws {
        let key = String(decoding: try decoded("QUAERO_LIVE_SSH_KEY"), as: UTF8.self)
        let conn = postgres([
            "sslmode": "require",
            "ssh_host": "127.0.0.1", "ssh_port": "2222",
            "ssh_user": try XCTUnwrap(env["QUAERO_LIVE_SSH_USER"]),
            "ssh_auth": "key", "ssh_host_key_policy": "accept-new",
        ])
        let id = try await Connector.open(conn, typed: ["password": "live", ConnectionStore.sshKey: key],
                                          protected: false)
        let one = try await firstCell(id, "SELECT 1")
        XCTAssertEqual(one, "1")
        await close(id)
    }
}
