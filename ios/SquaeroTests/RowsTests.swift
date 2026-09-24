// A table's rows (issue #577, task 5.2): pages from one cursor, and filters
// and sort rendered by desktop's code and run at the server.

import SquaeroLogic
import XCTest
@testable import Squaero

@MainActor
final class RowsTests: XCTestCase {
    private var session: Session!

    override func setUp() async throws {
        let open = try await Core.shared.call("conn.open", ["driver": "sqlite", "dsn": ["path": ":memory:"]])
        let id = try XCTUnwrap((open as? [String: Any])?["connId"] as? String)
        session = Session(conn: Connection(id: "t", name: "t", driver: "sqlite"), connId: id)
        _ = try await Core.shared.call("query.run", ["connId": id, "sql": "CREATE TABLE salas (n INTEGER, nombre TEXT)"])
        // 120 rows: two full pages and a short one.
        let values = (1...120).map { "(\($0), 'sala \($0)')" }.joined(separator: ",")
        _ = try await Core.shared.call("query.run", ["connId": id, "sql": "INSERT INTO salas VALUES \(values)"])
    }

    override func tearDown() async throws {
        _ = try? await Core.shared.call("conn.close", ["connId": session.connId])
    }

    func testPagesComeFromTheCursorUntilTheEnd() async throws {
        let pager = RowPager(session: session, object: ObjectRef(db: "main", schema: nil, name: "salas"))
        await pager.describe()
        await pager.reload()
        XCTAssertNil(pager.failure)
        XCTAssertEqual(pager.rows.count, RowPager.pageSize)
        XCTAssertTrue(pager.more)
        XCTAssertEqual(pager.names, ["n", "nombre"])

        await pager.page()
        await pager.page()
        XCTAssertEqual(pager.rows.count, 120)
        XCTAssertFalse(pager.more)
        XCTAssertEqual(pager.rows.last?.first ?? nil, "120")
        pager.close()
    }

    func testFiltersAndSortRunAtTheServer() async throws {
        let pager = RowPager(session: session, object: ObjectRef(db: "main", schema: nil, name: "salas"))
        await pager.describe()
        pager.draft.conditions = [Condition(column: "n", op: ">", value: "100")]
        pager.sort(by: "n")
        pager.sort(by: "n") // descending
        await pager.reload()
        XCTAssertNil(pager.failure)
        // The whole table was filtered, not the first page: 20 rows, 120 first.
        XCTAssertEqual(pager.rows.count, 20)
        XCTAssertFalse(pager.more)
        XCTAssertEqual(pager.rows.first?.first ?? nil, "120")
        pager.close()
    }

    func testABadFilterSaysWhy() async throws {
        let pager = RowPager(session: session, object: ObjectRef(db: "main", schema: nil, name: "salas"))
        pager.draft.conditions = [Condition(column: "no_existe", op: "=", value: "1")]
        await pager.reload()
        XCTAssertNotNil(pager.failure)
    }
}
