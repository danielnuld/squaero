// One row and its related data (issue #577, task 5.3): the row its foreign
// key points at and the rows pointing at it, from SQLite's real catalog.

import SquaeroLogic
import XCTest
@testable import Squaero

@MainActor
final class RowDetailTests: XCTestCase {
    private var session: Session!

    override func setUp() async throws {
        let open = try await Core.shared.call("conn.open", ["driver": "sqlite", "dsn": ["path": ":memory:"]])
        let id = try XCTUnwrap((open as? [String: Any])?["connId"] as? String)
        session = Session(conn: Connection(id: "t", name: "t", driver: "sqlite"), connId: id)
        for sql in [
            "CREATE TABLE clientes (id INTEGER PRIMARY KEY, nombre TEXT)",
            "CREATE TABLE pedidos (id INTEGER PRIMARY KEY, cliente_id INTEGER REFERENCES clientes(id))",
            "INSERT INTO clientes VALUES (1, 'Ana'), (2, 'Luis')",
            "INSERT INTO pedidos VALUES (10, 1), (11, 1), (12, 2)",
        ] {
            _ = try await Core.shared.call("query.run", ["connId": id, "sql": sql])
        }
    }

    override func tearDown() async throws {
        _ = try? await Core.shared.call("conn.close", ["connId": session.connId])
    }

    private func firstRow(_ table: String) async throws -> RowRef {
        let pager = RowPager(session: session, object: ObjectRef(db: "main", schema: nil, name: table))
        await pager.describe()
        await pager.reload()
        pager.close()
        let row = try XCTUnwrap(pager.rows.first, pager.failure ?? "no rows")
        return RowRef(object: pager.object, columns: pager.columns, row: row, types: pager.types)
    }

    func testAClientsOrdersDependOnIt() async throws {
        let related = RowRelations(session: session, ref: try await firstRow("clientes"))
        await related.load()
        XCTAssertNil(related.reason)
        XCTAssertTrue(related.parents.isEmpty)
        let orders = try XCTUnwrap(related.children.first)
        XCTAssertEqual(orders.relation.fromTable, "pedidos")
        XCTAssertEqual(related.counts[orders] ?? nil, "2")

        // Opening them lists exactly those two.
        let object = try XCTUnwrap(related.object(orders))
        let pager = RowPager(session: session, object: object)
        await pager.reload()
        pager.close()
        XCTAssertEqual(pager.rows.map { $0.first ?? nil }, ["10", "11"])
    }

    func testAnOrderPointsAtItsClient() async throws {
        let related = RowRelations(session: session, ref: try await firstRow("pedidos"))
        await related.load()
        let client = try XCTUnwrap(related.parents.first)
        XCTAssertEqual(client.relation.fromTable, "clientes")
        let pager = RowPager(session: session, object: try XCTUnwrap(related.object(client)))
        await pager.reload()
        pager.close()
        XCTAssertEqual(pager.rows.first?[1] ?? nil, "Ana")
    }
}
