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
        for sql in ["SELECT 1", "select * from audiencias where tipo = 'x'",
                    "WITH a AS (SELECT 1 AS n) SELECT n FROM a", "SELECT 'DELETE FROM x'"] {
            XCTAssertTrue(AgentTools.isReadOnly(sql), sql)
        }
        for sql in ["UPDATE audiencias SET tipo = 'x'", "DELETE FROM audiencias",
                    "SELECT 1; DELETE FROM audiencias", "/* SELECT */ DROP TABLE salas",
                    "WITH d AS (DELETE FROM audiencias RETURNING *) SELECT * FROM d",
                    "SELECT 'a'';' ; UPDATE salas SET nombre = 'x'", "INSERT INTO salas VALUES (99, 1, 'x')",
                    "CREATE TABLE t (n int)", "", "  -- nada"] {
            XCTAssertFalse(AgentTools.isReadOnly(sql), sql)
        }
    }

    // Task 8.7: whatever the model writes, the only tool that reaches the
    // server refuses a change, and nothing changes.
    func testTheAgentCannotChangeDataByAnyTool() async throws {
        let tools = try await tools()
        let before = try await first("SELECT COUNT(*) || '/' || MAX(tipo) FROM audiencias")
        for sql in ["UPDATE audiencias SET tipo = 'hackeada'", "DELETE FROM audiencias",
                    "SELECT 1; UPDATE audiencias SET tipo = 'x'", "DROP TABLE audiencias"] {
            do {
                _ = try await tools.runSelect(sql)
                XCTFail("ran: \(sql)")
            } catch let refusal as AgentTools.Refusal {
                XCTAssertFalse(refusal.localizedDescription.isEmpty)
            }
        }
        let after = try await first("SELECT COUNT(*) || '/' || MAX(tipo) FROM audiencias")
        XCTAssertEqual(before, after)
    }

    func testASelectComesBackAsTextWithARowLimit() async throws {
        let tools = try await tools()
        let text = try await tools.runSelect("SELECT id, tipo FROM audiencias ORDER BY id")
        let lines = text.split(separator: "\n")
        XCTAssertEqual(lines.first, "id\ttipo")
        XCTAssertEqual(lines.count, 1 + AgentTools.rowLimit + 1) // the header, the rows, "…"
        XCTAssertEqual(lines.last, "…")
    }

    func testTheSchemaIsSearchedNotSentWhole() async throws {
        let tools = try await tools()
        let found = try await tools.searchSchema("audien")
        XCTAssertTrue(found.contains("audiencias("), found)
        XCTAssertTrue(found.contains("fecha"), found)
        XCTAssertFalse(found.contains("juzgados("), found)

        let none = try await tools.searchSchema("zzz")
        XCTAssertTrue(none.contains("expedientes"), none) // the table names, to pick from

        let described = try await tools.describeTable("EXPEDIENTES")
        XCTAssertTrue(described.hasPrefix("expedientes("), described)
        XCTAssertTrue(described.contains(" PK"), described)
        let missing = try await tools.describeTable("nada")
        XCTAssertFalse(missing.contains("("), missing)
    }
}
