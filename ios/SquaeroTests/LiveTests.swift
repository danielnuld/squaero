// Live connections from the simulator (issue #576, task 4.7), through the
// app's own Connector, against the servers scripts/ios/live-servers.sh starts
// on the Mac: PostgreSQL and MongoDB with TLS verified against a CA picked as a
// file, and PostgreSQL through an SSH tunnel with a key held as text, as the
// Keychain holds it. Skipped unless QUAERO_LIVE=1 (ios-app.yml sets it).
// Informix is not here: its server only comes as a Docker image. Editing a
// row (task 5.6) runs against PostgreSQL and MySQL, the latter on libmywire
// (#583, task 9.7).

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

    private func mysql(_ extra: [String: String] = [:]) -> Connection {
        var params = ["host": "127.0.0.1", "port": "53306", "database": "live", "user": "squaero"]
        params.merge(extra) { _, new in new }
        return Connection(id: "live-my", name: "live", driver: "mysql", params: params)
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

    /// A row of `casos` on a fresh table, opened as the list opens it.
    private func pgCaso(_ session: Session) async throws -> RowRef {
        _ = try await Core.shared.call("query.run", ["connId": session.connId, "sql": """
            DROP TABLE IF EXISTS casos;
            CREATE TABLE casos (id int PRIMARY KEY, estado text NOT NULL, monto numeric(10,2));
            INSERT INTO casos VALUES (1, 'abierto', 10.50), (2, 'abierto', NULL)
            """])
        let pager = RowPager(session: session, object: ObjectRef(db: "live", schema: "public", name: "casos"))
        await pager.describe()
        await pager.reload()
        pager.close()
        XCTAssertEqual(pager.pk, ["id"])
        let row = try XCTUnwrap(pager.rows.first { $0.first == "1" }, pager.failure ?? "no row 1")
        return RowRef(object: pager.object, columns: pager.columns, row: row, types: pager.types, pk: pager.pk)
    }

    private func caso(_ connId: String) async throws -> [String?] {
        let r = try await Core.shared.resultSet("query.run", [
            "connId": connId, "sql": "SELECT estado, monto::text FROM casos WHERE id = 1",
        ])
        return try XCTUnwrap(r.rows.first)
    }

    // Task 5.6: editing, confirming and discarding against a real server.
    func testEditingAPostgresRowCommitsInATransaction() async throws {
        let conn = postgres(["sslmode": "require"])
        let id = try await Connector.open(conn, typed: ["password": "live"], protected: false)
        let session = Session(conn: conn, connId: id)
        let editor = RowEditor(session: session, ref: try await pgCaso(session))
        XCTAssertNil(editor.readOnlyReason)
        editor.begin()
        editor.set("estado", "cerrado")
        editor.set("monto", "99.90")
        await editor.review()
        let sql = try XCTUnwrap(editor.preview?.first, editor.failure ?? "no preview")
        XCTAssertTrue(sql.contains("UPDATE") && sql.contains("casos"), sql)
        let untouched = try await caso(id)
        XCTAssertEqual(untouched, ["abierto", "10.50"])

        await editor.commit()
        XCTAssertNil(editor.failure)
        let saved = try await caso(id)
        XCTAssertEqual(saved, ["cerrado", "99.90"])
        XCTAssertEqual(editor.value("estado"), "cerrado")
        await close(id)
    }

    func testDiscardingAPostgresEditSendsNothing() async throws {
        let conn = postgres(["sslmode": "require"])
        let id = try await Connector.open(conn, typed: ["password": "live"], protected: false)
        let session = Session(conn: conn, connId: id)
        let editor = RowEditor(session: session, ref: try await pgCaso(session))
        editor.begin()
        editor.set("estado", "cerrado")
        await editor.review()
        XCTAssertNotNil(editor.preview)
        editor.discard()
        XCTAssertEqual(editor.value("estado"), "abierto")
        let row = try await caso(id)
        XCTAssertEqual(row, ["abierto", "10.50"])
        await close(id)
    }

    func testARejectedPostgresEditIsRolledBack() async throws {
        let conn = postgres(["sslmode": "require"])
        let id = try await Connector.open(conn, typed: ["password": "live"], protected: false)
        let session = Session(conn: conn, connId: id)
        let editor = RowEditor(session: session, ref: try await pgCaso(session))
        editor.begin()
        editor.set("monto", "no es un número")
        await editor.review()
        await editor.commit()
        XCTAssertNotNil(editor.failure)
        XCTAssertTrue(editor.editing)
        // PostgreSQL refuses everything in an aborted transaction until it is
        // rolled back: reading works, so it was.
        let row = try await caso(id)
        XCTAssertEqual(row, ["abierto", "10.50"])

        editor.set("monto", "12.00")
        await editor.review()
        await editor.commit()
        XCTAssertNil(editor.failure)
        let fixed = try await caso(id)
        XCTAssertEqual(fixed, ["abierto", "12.00"])
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

    // Task 9.7: MySQL on libmywire, the client that can ship in the store.
    func testMySQLVerifiesTheServerAgainstThePickedCA() async throws {
        let conn = mysql(["ssl_mode": "verify_identity", "ssl_ca": ca])
        let id = try await Connector.open(conn, typed: ["password": "live"], protected: false)
        let r = try await Core.shared.resultSet("query.run", ["connId": id, "sql": "SHOW SESSION STATUS LIKE 'Ssl_cipher'"])
        let cipher = try XCTUnwrap(r.rows.first?.last ?? nil)
        XCTAssertFalse(cipher.isEmpty)
        await close(id)
    }

    func testEditingAMySQLRowCommitsInATransaction() async throws {
        let conn = mysql(["ssl_mode": "required"])
        let id = try await Connector.open(conn, typed: ["password": "live"], protected: false)
        for sql in ["DROP TABLE IF EXISTS casos",
                    "CREATE TABLE casos (id int PRIMARY KEY, estado varchar(20) NOT NULL, monto decimal(10,2))",
                    "INSERT INTO casos VALUES (1, 'abierto', 10.50), (2, 'abierto', NULL)"] {
            _ = try await Core.shared.call("query.run", ["connId": id, "sql": sql])
        }
        let tables = try Logic.shared.parseTreeRows(
            try await Core.shared.resultSet("schema.tree", ["connId": id, "db": "live"]), fallback: "schema")
        XCTAssertTrue(tables.contains(TreeRow(name: "casos", kind: "table")), "\(tables)")

        let session = Session(conn: conn, connId: id)
        let pager = RowPager(session: session, object: ObjectRef(db: "live", schema: nil, name: "casos"))
        await pager.describe()
        await pager.reload()
        pager.close()
        XCTAssertEqual(pager.pk, ["id"])
        let row = try XCTUnwrap(pager.rows.first { $0.first == "1" }, pager.failure ?? "no row 1")
        let editor = RowEditor(session: session, ref: RowRef(object: pager.object, columns: pager.columns, row: row,
                                                             types: pager.types, pk: pager.pk))
        XCTAssertNil(editor.readOnlyReason)
        editor.begin()
        editor.set("estado", "cerrado")
        editor.set("monto", "99.90")
        await editor.review()
        XCTAssertNotNil(editor.preview, editor.failure ?? "no preview")
        await editor.commit()
        XCTAssertNil(editor.failure)
        let saved = try await Core.shared.resultSet("query.run", [
            "connId": id, "sql": "SELECT estado, CAST(monto AS CHAR) FROM casos WHERE id = 1",
        ])
        XCTAssertEqual(saved.rows.first, ["cerrado", "99.90"])
        await close(id)
    }
}
