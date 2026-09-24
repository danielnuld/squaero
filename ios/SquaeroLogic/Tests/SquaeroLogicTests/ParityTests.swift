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

    struct Connections: Decodable {
        struct ConnCase<T: Decodable>: Decodable { let conn: Connection; let expected: T }
        struct FieldErrorsCase: Decodable {
            struct Expected: Decodable { let params: [String: String] }
            let conn: Connection; let sshRequired: Bool; let expected: Expected
        }
        struct GroupCase: Decodable { let list: [Connection]; let expected: [ConnectionGroup] }
        struct SectionsCase: Decodable {
            struct Section: Decodable { let id: String; let keys: [String] }
            let driver: String; let expected: [Section]
        }
        struct ParseCase: Decodable { let raw: String; let expected: [Connection] }
        struct ImportCase: Decodable { let existing: [Connection]; let raw: String; let expected: ImportedConnections }
        struct TranslateCase: Decodable {
            let locale: String; let key: String; let params: [String: String]?; let expected: String
        }
        let buildDsn: [ConnCase<[String: String]>]
        let fieldErrors: [FieldErrorsCase]
        let stripSecrets: [ConnCase<Connection>]
        let groupConnections: [GroupCase]
        let formSections: [SectionsCase]
        let parseConnections: [ParseCase]
        let importConnectionsFile: [ImportCase]
        let translate: [TranslateCase]
    }

    let exports: [Export]
    let filters: [Filter]
    let variables: [Variables]
    let informixErrors: [InformixError]
    let quote: [Quote]
    let connections: Connections
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

    func testConnections() throws {
        let k = cases.connections
        for c in k.buildDsn { XCTAssertEqual(try logic.buildDsn(c.conn), c.expected, c.conn.driver) }
        for c in k.fieldErrors {
            XCTAssertEqual(try logic.fieldErrors(c.conn, sshRequired: c.sshRequired), c.expected.params)
        }
        for c in k.stripSecrets { XCTAssertEqual(try logic.stripSecrets(c.conn), c.expected) }
        for c in k.groupConnections { XCTAssertEqual(try logic.groupConnections(c.list), c.expected) }
        for c in k.formSections {
            let got = try logic.formSections(driver: c.driver)
            XCTAssertEqual(got.map(\.id), c.expected.map(\.id), c.driver)
            XCTAssertEqual(got.map { $0.fields.map(\.key) }, c.expected.map(\.keys), c.driver)
        }
        for c in k.parseConnections { XCTAssertEqual(try logic.parseConnections(c.raw), c.expected) }
        for c in k.importConnectionsFile {
            XCTAssertEqual(try logic.importConnectionsFile(c.existing, raw: c.raw), c.expected)
        }
        XCTAssertThrowsError(try logic.importConnectionsFile([], raw: "{\"version\":9}"))
        for c in k.translate {
            XCTAssertEqual(try logic.translate(c.key, locale: c.locale, params: c.params), c.expected, c.key)
        }
    }

    func testEverySchemaHasItsSecrets() throws {
        let schemas = try logic.driverSchemas()
        XCTAssertEqual(Set(schemas.keys), ["sqlite", "postgres", "mysql", "informix", "mongodb", "mssql"])
        XCTAssertEqual(try logic.secretKeys(driver: "postgres"), ["password", "ssh_password", "ssh_key_passphrase"])
        XCTAssertEqual(try logic.secretKeys(driver: "sqlite"), [])
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
