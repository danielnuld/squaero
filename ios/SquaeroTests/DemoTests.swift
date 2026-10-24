// The demo database (issue #579, task 7.4): built from demo.sql on first use,
// opened like any SQLite connection with no secret, browsable, editable and
// related both ways; edits survive until a reset rebuilds it.

import SquaeroLogic
import XCTest
@testable import Squaero

@MainActor
final class DemoTests: XCTestCase {
    private var directory: URL!
    private var connId: String?

    override func setUp() async throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    }

    override func tearDown() async throws {
        if let connId { _ = try? await Core.shared.call("conn.close", ["connId": connId]) }
        try? FileManager.default.removeItem(at: directory)
    }

    private func open() async throws -> Session {
        let url = try await DemoDatabase.ensure(in: directory)
        let conn = DemoDatabase.connection(url)
        XCTAssertTrue(Connector.missingSecrets(conn).isEmpty)
        let id = try await Connector.open(conn, protected: false)
        connId = id
        return Session(conn: conn, connId: id)
    }

    private func count(_ session: Session, _ sql: String) async throws -> String? {
        let r = try await Core.shared.resultSet("query.run", ["connId": session.connId, "sql": sql])
        return r.rows.first?.first ?? nil
    }

    func testItOpensWithItsTablesAndRows() async throws {
        let session = try await open()
        let pedidos = try await count(session, "SELECT COUNT(*) FROM pedidos")
        let entregas = try await count(session, "SELECT COUNT(*) FROM entregas")
        XCTAssertEqual(pedidos, "1284")
        XCTAssertEqual(entregas, "2400")

        let tables = try Logic.shared.parseTreeRows(
            try await Core.shared.resultSet("schema.tree", ["connId": session.connId, "db": "main"]),
            fallback: "schema")
        for name in ["tiendas", "repartidores", "pedidos", "entregas"] {
            XCTAssertTrue(tables.contains(TreeRow(name: name, kind: "table")), "\(name): \(tables)")
        }
        XCTAssertTrue(tables.contains(TreeRow(name: "pedidos_pendientes", kind: "view")))
    }

    func testAnOrderCanBeEditedAndPointsAtItsStore() async throws {
        let session = try await open()
        let pager = RowPager(session: session, object: ObjectRef(db: "main", schema: nil, name: "pedidos"))
        await pager.describe()
        await pager.reload()
        pager.close()
        XCTAssertEqual(pager.pk, ["id"])
        let row = try XCTUnwrap(pager.rows.first)
        let ref = RowRef(object: pager.object, columns: pager.columns, row: row, types: pager.types, pk: pager.pk)

        let editor = RowEditor(session: session, ref: ref)
        XCTAssertNil(editor.readOnlyReason)
        editor.begin()
        editor.set("estado", "cancelado")
        await editor.review()
        await editor.commit()
        XCTAssertNil(editor.failure)

        let related = RowRelations(session: session, ref: ref)
        await related.load()
        XCTAssertEqual(related.parents.first?.relation.fromTable, "tiendas")
        XCTAssertTrue(related.children.contains { $0.relation.fromTable == "entregas" })
    }

    func testEditsStayUntilAReset() async throws {
        var session = try await open()
        _ = try await Core.shared.call("query.run", ["connId": session.connId, "sql":
            "UPDATE tiendas SET nombre = 'Cambiado' WHERE id = 1"])
        _ = try await Core.shared.call("conn.close", ["connId": session.connId])
        connId = nil

        session = try await open()
        let kept = try await count(session, "SELECT nombre FROM tiendas WHERE id = 1")
        XCTAssertEqual(kept, "Cambiado")
        _ = try await Core.shared.call("conn.close", ["connId": session.connId])
        connId = nil

        try DemoDatabase.reset(in: directory)
        session = try await open()
        let fresh = try await count(session, "SELECT nombre FROM tiendas WHERE id = 1")
        XCTAssertEqual(fresh, "Centro")
    }
}
