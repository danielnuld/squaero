// Editing a row (issue #577, task 5.4), against SQLite: the statement the core
// previews, the transaction, the one-row guard, the rollback that keeps the
// edit, and the rows that cannot be edited. Face ID is skipped (the simulator
// has no face enrolled); everything after it is the real path.

import SquaeroLogic
import XCTest
@testable import Squaero

@MainActor
final class RowEditorTests: XCTestCase {
    private var session: Session!

    override func setUp() async throws {
        let open = try await Core.shared.call("conn.open", ["driver": "sqlite", "dsn": ["path": ":memory:"]])
        let id = try XCTUnwrap((open as? [String: Any])?["connId"] as? String)
        session = Session(conn: Connection(id: "t", name: "t", driver: "sqlite"), connId: id)
        for sql in [
            "CREATE TABLE salas (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, piso INTEGER)",
            "INSERT INTO salas VALUES (1, 'Primera', 2), (2, 'Segunda', 2)",
        ] {
            _ = try await Core.shared.call("query.run", ["connId": id, "sql": sql])
        }
    }

    override func tearDown() async throws {
        _ = try? await Core.shared.call("conn.close", ["connId": session.connId])
    }

    private func firstRow() async throws -> RowRef {
        let pager = RowPager(session: session, object: ObjectRef(db: "main", schema: nil, name: "salas"))
        await pager.describe()
        await pager.reload()
        pager.close()
        let row = try XCTUnwrap(pager.rows.first, pager.failure ?? "no rows")
        return RowRef(object: pager.object, columns: pager.columns, row: row, types: pager.types, pk: pager.pk)
    }

    private func cell(_ sql: String) async throws -> String? {
        let r = try await Core.shared.resultSet("query.run", ["connId": session.connId, "sql": sql])
        return r.rows.first?.first ?? nil
    }

    func testConfirmingRunsThePreviewedUpdate() async throws {
        let ref = try await firstRow()
        XCTAssertEqual(ref.pk, ["id"])
        let editor = RowEditor(session: session, ref: ref)
        XCTAssertNil(editor.readOnlyReason)
        editor.values["nombre"] = "Sala 1"
        XCTAssertEqual(Array(editor.changed.keys), ["nombre"])

        await editor.review(.update)
        let sql = try XCTUnwrap(editor.preview, editor.failure ?? "no preview")
        XCTAssertTrue(sql.uppercased().hasPrefix("UPDATE"), sql)
        XCTAssertTrue(sql.contains("Sala 1"), sql)
        // A preview runs nothing.
        let before = try await cell("SELECT nombre FROM salas WHERE id = 1")
        XCTAssertEqual(before, "Primera")

        let applied = await editor.apply(.update, authenticate: false)
        XCTAssertTrue(applied, editor.failure ?? "")
        let after = try await cell("SELECT nombre FROM salas WHERE id = 1")
        XCTAssertEqual(after, "Sala 1")
        XCTAssertEqual(editor.row[1], "Sala 1")
        XCTAssertTrue(editor.changed.isEmpty)
    }

    func testDiscardingSendsNothing() async throws {
        let editor = RowEditor(session: session, ref: try await firstRow())
        editor.values["piso"] = "9"
        editor.discard()
        XCTAssertTrue(editor.changed.isEmpty)
        let piso = try await cell("SELECT piso FROM salas WHERE id = 1")
        XCTAssertEqual(piso, "2")
    }

    func testARejectedChangeRollsBackAndKeepsTheEdit() async throws {
        let editor = RowEditor(session: session, ref: try await firstRow())
        editor.values["piso"] = "7"
        editor.values["nombre"] = .some(nil) // NOT NULL
        let applied = await editor.apply(.update, authenticate: false)
        XCTAssertFalse(applied)
        XCTAssertNotNil(editor.failure)
        XCTAssertEqual(Set(editor.changed.keys), ["nombre", "piso"])
        let piso = try await cell("SELECT piso FROM salas WHERE id = 1")
        XCTAssertEqual(piso, "2")
    }

    func testDeletingARow() async throws {
        let editor = RowEditor(session: session, ref: try await firstRow())
        await editor.review(.delete)
        XCTAssertTrue(editor.preview?.uppercased().hasPrefix("DELETE") == true, editor.preview ?? "nil")
        let applied = await editor.apply(.delete, authenticate: false)
        XCTAssertTrue(applied, editor.failure ?? "")
        let left = try await cell("SELECT COUNT(*) FROM salas")
        XCTAssertEqual(left, "1")
    }

    func testMoreThanOneRowIsUndone() async throws {
        // A "key" that is not unique: piso is 2 on both rows.
        var ref = try await firstRow()
        ref.pk = ["piso"]
        let editor = RowEditor(session: session, ref: ref)
        editor.values["nombre"] = "Otra"
        let applied = await editor.apply(.update, authenticate: false)
        XCTAssertFalse(applied)
        XCTAssertTrue(editor.failure?.contains("2") == true, editor.failure ?? "nil")
        let names = try await Core.shared.resultSet("query.run", ["connId": session.connId,
                                                                  "sql": "SELECT nombre FROM salas ORDER BY id"])
        XCTAssertEqual(names.rows.map { $0.first ?? nil }, ["Primera", "Segunda"])
    }

    func testRowsThatCannotBeEdited() async throws {
        var ref = try await firstRow()
        ref.pk = []
        XCTAssertNotNil(RowEditor(session: session, ref: ref).readOnlyReason)

        let mongo = Session(conn: Connection(id: "m", name: "m", driver: "mongodb"), connId: "none")
        let row = try await firstRow()
        XCTAssertNotNil(RowEditor(session: mongo, ref: row).readOnlyReason)
    }

    func testProductionIsDesktopsRed() throws {
        var conn = Connection(id: "p", name: "Juzgados", driver: "informix")
        XCTAssertFalse(try Logic.shared.isProduction(conn))
        conn = try Logic.shared.markProduction(conn, true)
        XCTAssertTrue(try Logic.shared.isProduction(conn))
        let editor = RowEditor(session: Session(conn: conn, connId: "none"),
                               ref: RowRef(object: ObjectRef(name: "t"), columns: [], row: [], types: [:]))
        XCTAssertTrue(editor.production)
    }
}
