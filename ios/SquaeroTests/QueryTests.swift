// The Consultas tab (issue #578, task 6.1), against SQLite: a script runs one
// statement at a time and shows the last, a failure keeps the text and says
// which statement, a selection runs alone, the result pages from the cursor,
// and completion offers the tables and, once described, their columns.

import SquaeroLogic
import XCTest
@testable import Squaero

@MainActor
final class QueryTests: XCTestCase {
    private var session: Session!

    override func setUp() async throws {
        let open = try await Core.shared.call("conn.open", ["driver": "sqlite", "dsn": ["path": ":memory:"]])
        let id = try XCTUnwrap((open as? [String: Any])?["connId"] as? String)
        session = Session(conn: Connection(id: "t", name: "t", driver: "sqlite"), connId: id)
        _ = try await Core.shared.call("query.run", ["connId": id, "sql": "CREATE TABLE salas (n INTEGER, nombre TEXT)"])
        let values = (1...120).map { "(\($0), 'sala \($0)')" }.joined(separator: ",")
        _ = try await Core.shared.call("query.run", ["connId": id, "sql": "INSERT INTO salas VALUES \(values)"])
    }

    override func tearDown() async throws {
        _ = try? await Core.shared.call("conn.close", ["connId": session.connId])
    }

    private let none = NSRange(location: 0, length: 0)

    func testAQueryShowsItsRowsCountAndTime() async throws {
        let model = QueryModel(session: session)
        model.text = "SELECT n, nombre FROM salas WHERE n <= 3 ORDER BY n"
        await model.run(selection: none)
        XCTAssertNil(model.failure)
        XCTAssertEqual(model.columns.map(\.name), ["n", "nombre"])
        XCTAssertEqual(model.rows.map { $0.first ?? nil }, ["1", "2", "3"])
        let summary = try XCTUnwrap(model.summary)
        XCTAssertTrue(summary.hasPrefix("3 "), summary)
        XCTAssertTrue(summary.contains("ms") || summary.contains(" s"), summary)
        XCTAssertNil(model.note)
    }

    func testTheResultPagesFromTheCursor() async throws {
        let model = QueryModel(session: session)
        model.text = "SELECT * FROM salas"
        await model.run(selection: none)
        XCTAssertEqual(model.rows.count, QueryModel.pageSize)
        XCTAssertTrue(model.more)
        XCTAssertTrue(model.summary?.contains("+") == true, model.summary ?? "nil")
        await model.page()
        await model.page()
        XCTAssertEqual(model.rows.count, 120)
        XCTAssertFalse(model.more)
        model.close()
    }

    func testAScriptRunsInOrderAndShowsTheLastStatement() async throws {
        let model = QueryModel(session: session)
        model.text = """
            CREATE TABLE notas (t TEXT);
            INSERT INTO notas VALUES ('uno; con punto y coma');
            SELECT t FROM notas;
            """
        await model.run(selection: none)
        XCTAssertNil(model.failure)
        XCTAssertEqual(model.rows, [["uno; con punto y coma"]])
        XCTAssertEqual(model.note, Logic.t("ios.query.statements", ["n": "3"]))
        model.close()
    }

    func testAChangeSaysHowManyRowsItAffected() async throws {
        let model = QueryModel(session: session)
        model.text = "UPDATE salas SET nombre = 'x' WHERE n <= 4"
        await model.run(selection: none)
        XCTAssertNil(model.failure)
        XCTAssertTrue(model.columns.isEmpty)
        XCTAssertTrue(model.summary?.hasPrefix("4 ") == true, model.summary ?? "nil")
    }

    func testAFailureKeepsTheTextAndNamesTheStatement() async throws {
        let model = QueryModel(session: session)
        let text = "SELECT 1; SELECT * FROM no_existe; SELECT 2"
        model.text = text
        await model.run(selection: none)
        let failure = try XCTUnwrap(model.failure)
        XCTAssertTrue(failure.contains("2") && failure.contains("3") && failure.contains("no_existe"), failure)
        XCTAssertEqual(model.text, text)
        XCTAssertTrue(model.rows.isEmpty)
        XCTAssertNil(model.summary)
    }

    func testASelectionRunsAlone() async throws {
        let model = QueryModel(session: session)
        model.text = "SELECT 1;\nSELECT n FROM salas WHERE n = 7"
        let second = (model.text as NSString).range(of: "SELECT n FROM salas WHERE n = 7")
        await model.run(selection: second)
        XCTAssertEqual(model.rows, [["7"]])
        XCTAssertNil(model.note)
        model.close()
    }

    func testCompletionOffersTablesThenTheirColumns() async throws {
        let model = QueryModel(session: session)
        await model.loadTables()
        XCTAssertTrue(model.schema.tables.contains("salas"), "\(model.schema.tables)")
        let tables = model.suggestions("SELECT * FROM sa", cursor: 16)
        XCTAssertEqual(tables.from, 14)
        XCTAssertEqual(tables.items.first, "salas")

        model.text = "SELECT no FROM salas"
        await model.describeMentioned()
        XCTAssertEqual(model.schema.columns["salas"], ["n", "nombre"])
        let columns = model.suggestions(model.text, cursor: 9)
        XCTAssertEqual(columns.from, 7)
        XCTAssertEqual(columns.items.first, "nombre")
        XCTAssertEqual(model.suggestions("SELECT salas.", cursor: 13).items, ["n", "nombre"])
    }

    func testTheEditorColoursThroughTheSharedLogic() throws {
        let spans = try Logic.shared.highlightSql("SELECT 'a' FROM t -- x", engine: "sqlite")
        XCTAssertEqual(spans.map(\.kind), ["keyword", "string", "keyword", "comment"])
        XCTAssertEqual(SQLEditor.Coordinator.color("keyword"), Theme.accentUI)
    }
}
