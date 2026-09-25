// Snippets and variables (issue #578, task 6.2): the store keeps snippets and
// the values last given, across a reload; a query's :nombre and ${nombre} are
// found in what a run takes and written in as desktop writes them.

import SquaeroLogic
import XCTest
@testable import Squaero

@MainActor
final class SnippetTests: XCTestCase {
    private var directory: URL!
    private var session: Session!

    override func setUp() async throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let open = try await Core.shared.call("conn.open", ["driver": "sqlite", "dsn": ["path": ":memory:"]])
        let id = try XCTUnwrap((open as? [String: Any])?["connId"] as? String)
        session = Session(conn: Connection(id: "t", name: "t", driver: "sqlite"), connId: id)
        _ = try await Core.shared.call("query.run", ["connId": id, "sql": "CREATE TABLE salas (n INTEGER, nombre TEXT)"])
        _ = try await Core.shared.call("query.run", ["connId": id, "sql":
            "INSERT INTO salas VALUES (1, 'Primera'), (2, 'Segunda'), (3, NULL)"])
    }

    override func tearDown() async throws {
        _ = try? await Core.shared.call("conn.close", ["connId": session.connId])
        try? FileManager.default.removeItem(at: directory)
    }

    func testSnippetsAreSavedRenamedRemovedAndKept() throws {
        let store = SnippetStore(directory: directory)
        XCTAssertTrue(store.snippets.isEmpty)
        let first = try XCTUnwrap(try store.add(name: "Audiencias del día", body: "SELECT * FROM salas WHERE n = :sala"))
        // The same name again never overwrites the first one.
        let second = try XCTUnwrap(try store.add(name: "Audiencias del día", body: "SELECT 1"))
        XCTAssertEqual(second.name, "Audiencias del día (2)")
        XCTAssertNil(try store.add(name: "  ", body: "SELECT 1"))

        try store.rename(second.id, to: "Uno")
        XCTAssertEqual(store.search("audiencias").map(\.id), [first.id])
        XCTAssertEqual(store.search(":sala").map(\.id), [first.id])

        let reloaded = SnippetStore(directory: directory)
        XCTAssertEqual(reloaded.snippets.map(\.name), ["Audiencias del día", "Uno"])
        try reloaded.remove(first.id)
        XCTAssertEqual(SnippetStore(directory: directory).snippets.map(\.name), ["Uno"])
    }

    func testTheValuesGivenAreRememberedForNextTime() throws {
        let store = SnippetStore(directory: directory)
        try store.remember([":sala": VarValue(text: "3")])
        try store.remember([":desde": VarValue(text: "", isNull: true)])
        let reloaded = SnippetStore(directory: directory)
        XCTAssertEqual(reloaded.values[":sala"], VarValue(text: "3"))
        XCTAssertEqual(reloaded.values[":desde"]?.isNull, true)
    }

    func testARunAsksForTheVariablesOfWhatItTakes() {
        let model = QueryModel(session: session)
        model.text = "SELECT 1;\nSELECT nombre FROM ${tabla} WHERE n = :sala"
        XCTAssertEqual(model.variables(selection: NSRange(location: 0, length: 0)).map(\.token), ["${tabla}", ":sala"])
        XCTAssertTrue(model.variables(selection: NSRange(location: 0, length: 8)).isEmpty)
    }

    func testVariablesAreWrittenInAsDesktopWritesThem() async throws {
        let model = QueryModel(session: session)
        model.text = "SELECT nombre FROM ${tabla} WHERE n = :sala"
        let none = NSRange(location: 0, length: 0)
        let vars = model.variables(selection: none)
        let blank: [String: VarValue] = [":sala": VarValue(text: " ")]
        XCTAssertEqual(try Logic.shared.missingVariables(vars, values: blank).map(\.token), ["${tabla}", ":sala"])

        // A number goes in unquoted, the raw one as typed.
        await model.run(selection: none, values: ["${tabla}": VarValue(text: "salas"), ":sala": VarValue(text: "2")])
        XCTAssertNil(model.failure)
        XCTAssertEqual(model.rows, [["Segunda"]])
        model.close()

        // NULL is a switch, whatever the box holds: IS NULL finds the third.
        model.text = "SELECT n FROM salas WHERE nombre IS :nombre"
        await model.run(selection: none, values: [":nombre": VarValue(text: "Primera", isNull: true)])
        XCTAssertNil(model.failure)
        XCTAssertEqual(model.rows, [["3"]])
        model.close()
        // The editor keeps what was written, with its variables.
        XCTAssertEqual(model.text, "SELECT n FROM salas WHERE nombre IS :nombre")
    }

    func testASnippetHandedToConsultasIsRunOrOpened() {
        let nav = AppNavigation()
        nav.openQuery("SELECT 1", run: true)
        XCTAssertEqual(nav.tab, .queries)
        XCTAssertEqual(nav.pending?.text, "SELECT 1")
        XCTAssertEqual(nav.pending?.run, true)
    }
}
