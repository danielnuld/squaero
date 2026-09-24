// Browsing (issue #577, task 5.1): schema.tree through Core.resultSet and
// desktop's parseTreeRows, and how the screens walk the tree.

import SquaeroLogic
import XCTest
@testable import Squaero

@MainActor
final class BrowseTests: XCTestCase {
    func testTablesAndViewsOfASqliteDatabase() async throws {
        let open = try await Core.shared.call("conn.open", ["driver": "sqlite", "dsn": ["path": ":memory:"]])
        let id = try XCTUnwrap((open as? [String: Any])?["connId"] as? String)
        defer { Task { _ = try? await Core.shared.call("conn.close", ["connId": id]) } }
        _ = try await Core.shared.call("query.run", ["connId": id, "sql": "CREATE TABLE salas (n INTEGER)"])
        _ = try await Core.shared.call("query.run", ["connId": id, "sql": "CREATE VIEW grandes AS SELECT n FROM salas"])

        let result = try await Core.shared.resultSet("schema.tree", ["connId": id, "db": "main"])
        let rows = try Logic.shared.parseTreeRows(result, fallback: "schema")
        XCTAssertEqual(Set(rows), [TreeRow(name: "salas", kind: "table"), TreeRow(name: "grandes", kind: "view")])
        XCTAssertFalse(try Logic.shared.routinesFor("sqlite", db: nil).supported)
    }

    func testTheTreeStartsAtTheConnectionsDatabase() {
        let pg = Connection(id: "c", name: "Juzgados", driver: "postgres", params: ["database": "siaj"])
        XCTAssertEqual(TreeLevel.root(pg), TreeLevel(db: "siaj", schema: nil, title: "Juzgados"))
        XCTAssertEqual(TreeLevel.root(pg).child("public"), TreeLevel(db: "siaj", schema: "public", title: "public"))

        let none = Connection(id: "c", name: "Servidor", driver: "informix", params: ["database": ""])
        XCTAssertEqual(TreeLevel.root(none).child("siaj"), TreeLevel(db: "siaj", schema: nil, title: "siaj"))
    }
}
