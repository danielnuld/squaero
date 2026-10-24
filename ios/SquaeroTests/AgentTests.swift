// The agent's tools (issue #580, tasks 8.1, 8.2 and the read-only half of
// 8.7) against the demo database. The model itself does not run here: the
// simulator has no Apple Intelligence, which is why the tools are plain code.

import SquaeroLogic
import XCTest
@testable import Squaero

@MainActor
final class AgentTests: XCTestCase {
    private var directory: URL!
    private var connId: String?

    override func setUp() async throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    }

    override func tearDown() async throws {
        if let connId { _ = try? await Core.shared.call("conn.close", ["connId": connId]) }
        try? FileManager.default.removeItem(at: directory)
    }

    private func tools() async throws -> AgentTools {
        let url = try await DemoDatabase.ensure(in: directory)
        let conn = DemoDatabase.connection(url)
        let id = try await Connector.open(conn, protected: false)
        connId = id
        let tools = await AgentTools.load(connId: id, conn: conn)
        return try XCTUnwrap(tools)
    }

    private func first(_ sql: String) async throws -> String? {
        let r = try await Core.shared.resultSet("query.run", ["connId": try XCTUnwrap(connId), "sql": sql])
        return r.rows.first?.first ?? nil
    }

    func testTheAgentIsOffUntilTurnedOn() {
        UserDefaults.standard.removeObject(forKey: AgentSettings.key)
        XCTAssertFalse(AgentSettings.enabled)
        XCTAssertFalse(AgentSettings.active)
    }

    func testOnlyProvablyReadOnlyStatementsPassTheGate() {
        for sql in ["SELECT 1", "select * from entregas where tipo = 'x'",
                    "WITH a AS (SELECT 1 AS n) SELECT n FROM a", "SELECT 'DELETE FROM x'"] {
            XCTAssertTrue(AgentTools.isReadOnly(sql), sql)
        }
        for sql in ["UPDATE entregas SET tipo = 'x'", "DELETE FROM entregas",
                    "SELECT 1; DELETE FROM entregas", "/* SELECT */ DROP TABLE repartidores",
                    "WITH d AS (DELETE FROM entregas RETURNING *) SELECT * FROM d",
                    "SELECT 'a'';' ; UPDATE repartidores SET nombre = 'x'", "INSERT INTO repartidores VALUES (99, 1, 'x')",
                    "CREATE TABLE t (n int)", "", "  -- nada"] {
            XCTAssertFalse(AgentTools.isReadOnly(sql), sql)
        }
    }

    // Task 8.7: whatever the model writes, the only tool that reaches the
    // server refuses a change, and nothing changes.
    func testTheAgentCannotChangeDataByAnyTool() async throws {
        let tools = try await tools()
        let before = try await first("SELECT COUNT(*) || '/' || MAX(tipo) FROM entregas")
        for sql in ["UPDATE entregas SET tipo = 'hackeada'", "DELETE FROM entregas",
                    "SELECT 1; UPDATE entregas SET tipo = 'x'", "DROP TABLE entregas"] {
            do {
                _ = try await tools.runSelect(sql)
                XCTFail("ran: \(sql)")
            } catch let refusal as AgentTools.Refusal {
                XCTAssertFalse(refusal.localizedDescription.isEmpty)
            }
        }
        let after = try await first("SELECT COUNT(*) || '/' || MAX(tipo) FROM entregas")
        XCTAssertEqual(before, after)
    }

    func testASelectComesBackAsTextWithARowLimit() async throws {
        let tools = try await tools()
        let text = try await tools.runSelect("SELECT id, tipo FROM entregas ORDER BY id")
        let lines = text.split(separator: "\n")
        XCTAssertEqual(lines.first, "id\ttipo")
        XCTAssertEqual(lines.count, 1 + AgentTools.rowLimit + 1) // the header, the rows, "…"
        XCTAssertEqual(lines.last, "…")
    }

    func testTheSchemaIsSearchedNotSentWhole() async throws {
        let tools = try await tools()
        let found = try await tools.searchSchema("entreg")
        XCTAssertTrue(found.contains("entregas("), found)
        XCTAssertTrue(found.contains("fecha"), found)
        XCTAssertFalse(found.contains("tiendas("), found)

        let none = try await tools.searchSchema("zzz")
        XCTAssertTrue(none.contains("pedidos"), none) // the table names, to pick from

        let described = try await tools.describeTable("PEDIDOS")
        XCTAssertTrue(described.hasPrefix("pedidos("), described)
        XCTAssertTrue(described.contains(" PK"), described)
        let missing = try await tools.describeTable("nada")
        XCTAssertFalse(missing.contains("("), missing)
    }

    // Task 8.3: what the model proposes becomes chips only once checked.
    func testAProposedFilterKeepsOnlyRealColumnsAndKnownOperators() {
        let columns = ["id", "repartidor_id", "fecha", "estado"]
        let got = AgentFilter.conditions([
            ("Estado", "=", "pendiente"),                                   // case of the column
            ("fecha", "between", "2026-09-26 00:00:00...2026-09-26 23:59:59"), // case of the op, "..."
            ("repartidor", "=", "2"),                                        // no such column
            ("estado", "SOUNDS LIKE", "x"),                                  // no such operator
            ("repartidor_id", "IS NULL", "ignored"),                         // nullary: no value
            ("id", ">", "  "),                                               // a value is needed
        ], columns: columns)
        XCTAssertEqual(got, [
            Condition(column: "estado", op: "=", value: "pendiente"),
            Condition(column: "fecha", op: "BETWEEN", value: "2026-09-26 00:00:00…2026-09-26 23:59:59"),
            Condition(column: "repartidor_id", op: "IS NULL", value: ""),
        ])
    }

    func testThePromptCarriesTheColumnsAndToday() {
        var parts = DateComponents()
        parts.year = 2026; parts.month = 9; parts.day = 25
        let today = Calendar(identifier: .gregorian).date(from: parts)!
        let prompt = AgentFilter.prompt("solo las pendientes de mañana", table: "entregas",
                                        columns: ["fecha", "estado"], types: ["fecha": "datetime"], today: today)
        XCTAssertTrue(prompt.contains("entregas"))
        XCTAssertTrue(prompt.contains("fecha (datetime), estado (?)"), prompt)
        XCTAssertTrue(prompt.contains("2026-09-25 Friday"), prompt)
        XCTAssertTrue(prompt.contains("solo las pendientes de mañana"))
    }

    // Tasks 8.4 and 8.6: what the model writes, cleaned and checked.
    func testTheModelsSQLIsCleanedAndOnlyASelectReachesTheEditor() {
        XCTAssertEqual(AgentCheck.statement("```sql\nSELECT 1;\n```"), "SELECT 1")
        XCTAssertEqual(AgentCheck.statement("  SELECT a FROM t ;; "), "SELECT a FROM t")
        XCTAssertNil(AgentCheck.statement("  "))
        XCTAssertEqual(AgentCheck.select("SELECT repartidor_id, COUNT(*) FROM entregas GROUP BY repartidor_id;"),
                       "SELECT repartidor_id, COUNT(*) FROM entregas GROUP BY repartidor_id")
        XCTAssertNil(AgentCheck.select("UPDATE entregas SET tipo = 'x'"))
        XCTAssertNil(AgentCheck.select("SELECT 1; DELETE FROM entregas"))
    }

    func testAProposedChangeNeverTouchesThePrimaryKey() {
        let got = AgentCheck.changes([("TIPO", "entregada"), ("id", "99"), ("nada", "x"), ("fecha", "null")],
                                     columns: ["id", "tipo", "fecha"], pk: ["id"])
        XCTAssertEqual(got.map(\.column), ["tipo", "fecha"])
        XCTAssertEqual(got.map(\.value), ["entregada", nil])
    }

    // Task 8.7, the rest of it: a change the agent proposes fills in the edit
    // and opens the preview, and nothing reaches the table.
    func testAnAgentChangeOnlyOpensThePreview() async throws {
        _ = try await tools()
        let url = try await DemoDatabase.ensure(in: directory)
        let conn = DemoDatabase.connection(url)
        let session = Session(conn: conn, connId: try XCTUnwrap(connId))
        let pager = RowPager(session: session, object: ObjectRef(db: "main", schema: nil, name: "entregas"))
        await pager.describe()
        await pager.reload()
        pager.close()
        let row = try XCTUnwrap(pager.rows.first)
        let editor = RowEditor(session: session, ref: RowRef(object: pager.object, columns: pager.columns, row: row,
                                                             types: pager.types, pk: pager.pk))
        let id = try XCTUnwrap(row.first ?? nil)
        let before = try await first("SELECT tipo FROM entregas WHERE id = \(id)")

        let changes = AgentCheck.changes([("tipo", "agente")], columns: pager.columns.map(\.name), pk: pager.pk)
        AgentChangeSheet.fill(editor, with: changes)
        await editor.review()
        let preview = try XCTUnwrap(editor.preview, editor.failure ?? "no preview")
        XCTAssertTrue(preview.joined().contains("UPDATE"), "\(preview)")
        let after = try await first("SELECT tipo FROM entregas WHERE id = \(id)")
        XCTAssertEqual(before, after)
        XCTAssertNotEqual(after, "agente")
    }
}

// Task 8.8: the battery ships in the app, and its scoring is right.
@MainActor
final class AgentEvalTests: XCTestCase {
    func testTheBatteryShipsWithFifteenCases() throws {
        let battery = try XCTUnwrap(AgentEvalBattery.bundled())
        XCTAssertEqual(battery.filters.count + battery.questions.count + battery.errors.count, 15)
    }

    func testAFilterHitsWhenEveryExpectedConditionIsThere() {
        let expect = [["estado", "=", "pendiente"]]
        XCTAssertTrue(AgentEvalScore.filter(expect: expect, got: [
            Condition(column: "categoria", op: "=", value: "ropa"), Condition(column: "estado", op: "=", value: "Pendiente"),
        ]))
        XCTAssertFalse(AgentEvalScore.filter(expect: expect, got: [Condition(column: "estado", op: "LIKE", value: "pendiente")]))
    }

    func testTheSameAnswerIgnoresExtraColumnsOrderAndNumberForms() {
        let reference = ResultSet(columns: [ResultColumn(name: "n", type: "int")], rows: [["2"], ["10"]])
        let same = ResultSet(columns: [ResultColumn(name: "nombre", type: "text"), ResultColumn(name: "total", type: "int")],
                             rows: [["b", "10.0"], ["a", "2"]])
        let other = ResultSet(columns: [ResultColumn(name: "total", type: "int")], rows: [["2"], ["11"]])
        XCTAssertTrue(AgentEvalScore.sameAnswer(reference: reference, got: same))
        XCTAssertFalse(AgentEvalScore.sameAnswer(reference: reference, got: other))
    }
}
