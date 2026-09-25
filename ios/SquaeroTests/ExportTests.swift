// Exporting from the phone (issue #578, tasks 6.3–6.5): 1 284 rows shown 50 at
// a time are exported whole to each of the six formats, reading on from the
// cursor, and every file is opened again and counted; only the visible rows
// means exactly those; the file name follows the format.

import SquaeroLogic
import XCTest
@testable import Squaero

@MainActor
final class ExportTests: XCTestCase {
    private var session: Session!
    private let total = 1_284

    override func setUp() async throws {
        let open = try await Core.shared.call("conn.open", ["driver": "sqlite", "dsn": ["path": ":memory:"]])
        let id = try XCTUnwrap((open as? [String: Any])?["connId"] as? String)
        session = Session(conn: Connection(id: "t", name: "t", driver: "sqlite"), connId: id)
        _ = try await Core.shared.call("query.run", ["connId": id, "sql":
            "CREATE TABLE expedientes (n INTEGER PRIMARY KEY, nota TEXT, monto REAL)"])
        let values = (1...total).map { i in
            i % 7 == 0 ? "(\(i), NULL, NULL)" : "(\(i), 'línea \(i), con \"comillas\"', \(Double(i) / 4))"
        }
        _ = try await Core.shared.call("query.run", ["connId": id, "sql":
            "INSERT INTO expedientes VALUES " + values.joined(separator: ",")])
    }

    override func tearDown() async throws {
        _ = try? await Core.shared.call("conn.close", ["connId": session.connId])
    }

    private func query() async -> QueryModel {
        let model = QueryModel(session: session)
        model.text = "SELECT * FROM expedientes ORDER BY n"
        await model.run(selection: NSRange(location: 0, length: 0))
        return model
    }

    func testEveryRowToEachFormatAndBack() async throws {
        for format in try Logic.shared.sheetFormats() {
            let model = await query()
            XCTAssertEqual(model.rows.count, QueryModel.pageSize)
            XCTAssertTrue(model.cursor, "the rest must come from the cursor")
            let exporter = Exporter(source: model)
            exporter.setFormat(format)
            let file = await exporter.file()
            let url = try XCTUnwrap(file, exporter.failure ?? format)
            XCTAssertEqual(url.lastPathComponent, "expedientes.\(format)")
            let data = try Data(contentsOf: url)
            XCTAssertEqual(try Logic.shared.countExportedRows(format: format, data), total, format)
            XCTAssertEqual(model.rows.count, total)
            XCTAssertFalse(model.more)
            XCTAssertEqual(exporter.done, Logic.t("ios.export.done", ["n": "\(total)", "file": url.lastPathComponent]))
        }
    }

    func testOnlyTheVisibleRows() async throws {
        let model = await query()
        let exporter = Exporter(source: model)
        exporter.allRows = false
        exporter.setFormat("json")
        let file = await exporter.file()
        let url = try XCTUnwrap(file, exporter.failure ?? "")
        XCTAssertEqual(try Logic.shared.countExportedRows(format: "json", try Data(contentsOf: url)),
                       QueryModel.pageSize)
        // Nothing more was read.
        XCTAssertEqual(model.rows.count, QueryModel.pageSize)
        XCTAssertTrue(model.more)
        model.close()
    }

    func testATablesRowsExportWholeUnderItsName() async throws {
        let pager = RowPager(session: session, object: ObjectRef(db: "main", schema: nil, name: "expedientes"))
        await pager.describe()
        await pager.reload()
        let exporter = Exporter(source: pager)
        XCTAssertEqual(exporter.name, "expedientes.csv")
        let file = await exporter.file()
        let url = try XCTUnwrap(file, exporter.failure ?? "")
        XCTAssertEqual(try Logic.shared.countExportedRows(format: "csv", try Data(contentsOf: url)), total)
        let text = try String(contentsOf: url, encoding: .utf8)
        XCTAssertTrue(text.contains("\"línea 1, con \"\"comillas\"\"\""), String(text.prefix(200)))
    }

    func testTheNameFollowsTheFormat() async {
        let exporter = Exporter(source: await query())
        exporter.name = "audiencias.csv"
        exporter.setFormat("json")
        XCTAssertEqual(exporter.name, "audiencias.json")
        XCTAssertEqual(exporter.formatDescription, Logic.t("ios.export.desc.json"))
        exporter.name = "sin extensión"
        exporter.setFormat("xlsx")
        XCTAssertEqual(exporter.name, "sin extensión.xlsx")
    }
}
