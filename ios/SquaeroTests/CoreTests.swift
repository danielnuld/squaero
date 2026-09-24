// The app's JSON-RPC client against the real core linked into the app
// (issue #575): handshake, an error, a SQLite round trip and op.cancel on
// its own queue.

import UIKit
import XCTest
@testable import Squaero

final class CoreTests: XCTestCase {
    func testHelloAndDrivers() async throws {
        let hello = try await Core.shared.call("app.hello") as? [String: Any]
        XCTAssertGreaterThanOrEqual(hello?["protocolVersion"] as? Int ?? 0, 8)
        // SQLite, PostgreSQL, Informix and MongoDB until #583/#584.
        XCTAssertGreaterThanOrEqual(Core.shared.driverCount, 4)
    }

    func testUnknownMethodIsAnRpcError() async {
        do {
            _ = try await Core.shared.call("no.such.method")
            XCTFail("expected an error")
        } catch let CoreError.rpc(code, _) {
            XCTAssertEqual(code, -32601)
        } catch {
            XCTFail("\(error)")
        }
    }

    func testSqliteRoundTrip() async throws {
        let open = try await Core.shared.call("conn.open", ["driver": "sqlite", "dsn": ["path": ":memory:"]])
        let connId = try XCTUnwrap((open as? [String: Any])?["connId"] as? String)
        let result = try await Core.shared.call("query.run", ["connId": connId, "sql": "SELECT 41 + 1 AS n", "limit": 10])
        let rows = (result as? [String: Any])?["rows"] as? [[Any]]
        XCTAssertEqual(rows?.first?.first as? String, "42")
        _ = try await Core.shared.call("conn.close", ["connId": connId])
    }

    func testCancelWithNothingRunning() async throws {
        let open = try await Core.shared.call("conn.open", ["driver": "sqlite", "dsn": ["path": ":memory:"]])
        let connId = try XCTUnwrap((open as? [String: Any])?["connId"] as? String)
        // Nothing to cancel: the core answers from the other queue, honestly false.
        let cancel = try await Core.shared.call("op.cancel", ["connId": connId]) as? [String: Any]
        XCTAssertEqual(cancel?["canceled"] as? Bool, false)
        _ = try await Core.shared.call("conn.close", ["connId": connId])
    }

    func testFontsAreRegistered() {
        XCTAssertNotNil(UIFont(name: "SchibstedGrotesk-Regular", size: 12))
        XCTAssertNotNil(UIFont(name: "MartianMono-SemiExpandedRegular", size: 12))
    }
}
