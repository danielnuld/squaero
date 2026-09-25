// Editing a row (issue #577, tasks 5.4 and 5.5), against SQLite's real
// row.update and tx.*: the preview is the driver's SQL, a commit shows the new
// value, a discard sends nothing, a rejected change is rolled back and kept,
// and MongoDB or a table without a key offer no editing. Face ID is not in
// these tests: `commit` is what runs after it.

import SquaeroLogic
import XCTest
@testable import Squaero

@MainActor
final class RowEditTests: XCTestCase {
    private var session: Session!

    override func setUp() async throws {
        let open = try await Core.shared.call("conn.open", ["driver": "sqlite", "dsn": ["path": ":memory:"]])
        let id = try XCTUnwrap((open as? [String: Any])?["connId"] as? String)
        session = Session(conn: Connection(id: "t", name: "t", driver: "sqlite"), connId: id)
        for sql in [
            "CREATE TABLE casos (id INTEGER PRIMARY KEY, estado TEXT NOT NULL, nota TEXT)",
            "CREATE TABLE bitacora (texto TEXT)",
            "INSERT INTO casos VALUES (1, 'abierto', NULL), (2, 'abierto', 'x')",
            "INSERT INTO bitacora VALUES ('uno')",
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
        return RowRef(object: pager.object, columns: pager.columns, row: row, types: pager.types, pk: pager.pk)
    }

    private func estado(_ id: Int) async throws -> String? {
        let r = try await Core.shared.resultSet("query.run", [
            "connId": session.connId, "sql": "SELECT estado FROM casos WHERE id = \(id)",
        ])
        return r.rows.first?.first ?? nil
    }

    func testConfirmingRunsThePreviewedUpdateAndShowsTheNewValue() async throws {
        let editor = RowEditor(session: session, ref: try await firstRow("casos"))
        XCTAssertNil(editor.readOnlyReason)
        editor.begin()
        editor.set("estado", "cerrado")
        await editor.review()
        XCTAssertNil(editor.failure)
        let sql = try XCTUnwrap(editor.preview?.first)
        XCTAssertEqual(editor.preview?.count, 1)
        XCTAssertTrue(sql.hasPrefix("UPDATE"), sql)
        XCTAssertTrue(sql.contains("cerrado") && sql.contains("id"), sql)
        // Previewing ran nothing.
        let before = try await estado(1)
        XCTAssertEqual(before, "abierto")

        await editor.commit()
        XCTAssertNil(editor.failure)
        XCTAssertFalse(editor.editing)
        XCTAssertNil(editor.preview)
        XCTAssertEqual(editor.value("estado"), "cerrado")
        let after = try await estado(1)
        XCTAssertEqual(after, "cerrado")
        let other = try await estado(2)
        XCTAssertEqual(other, "abierto")
    }

    func testDiscardingSendsNothingAndShowsTheOriginal() async throws {
        let editor = RowEditor(session: session, ref: try await firstRow("casos"))
        editor.begin()
        editor.set("estado", "cerrado")
        editor.set("nota", "texto")
        XCTAssertEqual(editor.changes.count, 2)
        editor.discard()
        XCTAssertFalse(editor.editing)
        XCTAssertEqual(editor.value("estado"), "abierto")
        XCTAssertNil(editor.value("nota"))
        let now = try await estado(1)
        XCTAssertEqual(now, "abierto")
        // No transaction was left open: a new one begins.
        _ = try await Core.shared.call("tx.begin", ["connId": session.connId])
        _ = try await Core.shared.call("tx.rollback", ["connId": session.connId])
    }

    func testAnUntouchedValueIsNoChange() async throws {
        let editor = RowEditor(session: session, ref: try await firstRow("casos"))
        editor.begin()
        editor.set("estado", "abierto")
        XCTAssertTrue(editor.changes.isEmpty)
        editor.set("nota", nil) // it already is NULL
        XCTAssertTrue(editor.changes.isEmpty)
        await editor.review()
        XCTAssertNil(editor.preview)
        XCTAssertEqual(editor.failure, Logic.t("edit.noChanges"))
    }

    func testARejectedChangeIsRolledBackAndKept() async throws {
        let editor = RowEditor(session: session, ref: try await firstRow("casos"))
        editor.begin()
        editor.set("nota", "revisada")
        editor.set("estado", nil) // NOT NULL
        await editor.review()
        XCTAssertNotNil(editor.preview)
        await editor.commit()
        let failure = try XCTUnwrap(editor.failure)
        XCTAssertTrue(failure.contains("NOT NULL"), failure)
        // The edit stays, to be corrected.
        XCTAssertTrue(editor.editing)
        XCTAssertNil(editor.value("estado"))
        XCTAssertEqual(editor.value("nota"), "revisada")
        // Nothing reached the table, and the transaction is closed.
        let r = try await Core.shared.resultSet("query.run", [
            "connId": session.connId, "sql": "SELECT estado, nota FROM casos WHERE id = 1",
        ])
        XCTAssertEqual(r.rows.first ?? [], ["abierto", nil])
        _ = try await Core.shared.call("tx.begin", ["connId": session.connId])
        _ = try await Core.shared.call("tx.rollback", ["connId": session.connId])

        // Corrected, it goes through.
        editor.set("estado", "en revisión")
        await editor.review()
        await editor.commit()
        XCTAssertNil(editor.failure)
        let fixed = try await estado(1)
        XCTAssertEqual(fixed, "en revisión")
    }

    func testATableWithoutAKeyIsReadOnly() async throws {
        let editor = RowEditor(session: session, ref: try await firstRow("bitacora"))
        XCTAssertEqual(editor.readOnlyReason, Logic.t("ios.row.readOnlyNoPk"))
        editor.begin()
        XCTAssertFalse(editor.editing)
    }

    func testMongoDBIsReadOnly() {
        let mongo = Session(conn: Connection(id: "m", name: "m", driver: "mongodb"), connId: "none")
        let ref = RowRef(object: ObjectRef(db: "app", schema: nil, name: "users"),
                         columns: [ResultColumn(name: "_id", type: "text")], row: ["1"], types: [:], pk: ["_id"])
        let editor = RowEditor(session: mongo, ref: ref)
        XCTAssertEqual(editor.readOnlyReason, Logic.t("ios.row.readOnlyEngine", ["engine": "MongoDB"]))
        editor.begin()
        XCTAssertFalse(editor.editing)
    }

    func testAProductionConnectionIsSaidSo() {
        var conn = Connection(id: "p", name: "p", driver: "sqlite", group: "Producción")
        XCTAssertTrue(RowEditor(session: Session(conn: conn, connId: "none"), ref: emptyRef()).production)
        conn.group = "Desarrollo"
        XCTAssertFalse(RowEditor(session: Session(conn: conn, connId: "none"), ref: emptyRef()).production)
        conn.color = "#e5484d"
        XCTAssertTrue(RowEditor(session: Session(conn: conn, connId: "none"), ref: emptyRef()).production)
    }

    private func emptyRef() -> RowRef {
        RowRef(object: ObjectRef(db: nil, schema: nil, name: "t"), columns: [], row: [], types: [:])
    }
}
