// The same cases as frontend/tests/logic/parity.test.ts, run through the
// facade and squaero-logic.js in JavaScriptCore (issue #574). parity.json holds
// what the TypeScript modules answer; Swift has to answer the same.

import Foundation
import SquaeroLogic
import XCTest

private struct Cases: Decodable {
    struct Export: Decodable { let result: ResultSet; let format: String; let table: String; let expected: String }
    struct Filter: Decodable {
        struct State: Decodable { let conditions: [Condition]; let conjunction: String; let order: [OrderBy] }
        let engine: String; let state: State; let types: [String: String]; let expected: PreviewFilter
    }
    struct Variables: Decodable {
        let sql: String; let values: [String: VarValue]; let engine: String?
        let found: [SqlVariable]; let expected: String
    }
    struct InformixError: Decodable { let msg: String; let locale: String; let expected: String? }
    struct Quote: Decodable { let id: String; let engine: String; let expected: String }

    let exports: [Export]
    let filters: [Filter]
    let variables: [Variables]
    let informixErrors: [InformixError]
    let quote: [Quote]
}

final class ParityTests: XCTestCase {
    private var logic: SquaeroLogic!
    private var cases: Cases!

    override func setUpWithError() throws {
        logic = try SquaeroLogic()
        let file = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().appendingPathComponent("../../../../frontend/tests/logic/parity.json")
        cases = try JSONDecoder().decode(Cases.self, from: Data(contentsOf: file.standardized))
    }

    func testExports() throws {
        XCTAssertFalse(cases.exports.isEmpty)
        for c in cases.exports {
            let data = try logic.export(c.result, format: c.format, table: c.table)
            XCTAssertEqual(String(decoding: data, as: UTF8.self), c.expected, c.format)
        }
    }

    func testXlsxIsAZip() throws {
        let data = try logic.export(cases.exports[0].result, format: "xlsx", table: "pagos")
        XCTAssertEqual(Array(data.prefix(2)), [0x50, 0x4B])
    }

    func testFilters() throws {
        for c in cases.filters {
            let draft = FilterDraft(conditions: c.state.conditions, conjunction: c.state.conjunction, order: c.state.order)
            XCTAssertEqual(try logic.draftFilter(engine: c.engine, draft, types: c.types), c.expected, c.engine)
        }
    }

    func testVariables() throws {
        for c in cases.variables {
            XCTAssertEqual(try logic.findVariables(sql: c.sql, engine: c.engine), c.found, c.sql)
            XCTAssertEqual(try logic.applyVariables(sql: c.sql, values: c.values, engine: c.engine), c.expected, c.sql)
        }
    }

    func testInformixErrors() throws {
        for c in cases.informixErrors {
            XCTAssertEqual(try logic.informixErrorText(c.msg, locale: c.locale), c.expected, c.msg)
        }
    }

    func testQuoting() throws {
        for c in cases.quote {
            XCTAssertEqual(try logic.quoteIdentifier(c.id, engine: c.engine), c.expected, c.engine)
        }
    }

    func testUnknownFormatIsAnError() {
        XCTAssertThrowsError(try logic.export(cases.exports[0].result, format: "pdf")) {
            XCTAssertEqual($0 as? SquaeroLogicError, .unknownFormat("pdf"))
        }
    }

    func testABrokenScriptIsAnError() {
        XCTAssertThrowsError(try SquaeroLogic(script: "this is not javascript")) {
            guard case .script = $0 as? SquaeroLogicError else { return XCTFail("\($0)") }
        }
    }
}
