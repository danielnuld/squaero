// The demo database (issue #579, task 7.4): built on first use from demo.sql,
// shipped in the app, into Application Support, and opened like any SQLite
// connection. Edits stay until the user resets it. No server, account or
// network: what App Review opens first.

import Foundation
import SquaeroLogic

@MainActor
enum DemoDatabase {
    static let connectionId = "demo"

    static func url(in directory: URL = ConnectionStore.defaultDirectory) -> URL {
        directory.appendingPathComponent("demo", isDirectory: true).appendingPathComponent("demo.sqlite")
    }

    static func connection(_ url: URL) -> Connection {
        Connection(id: connectionId, name: Logic.t("ios.demo.name"), driver: "sqlite", params: ["path": url.path])
    }

    enum DemoError: Error { case scriptMissing }

    /// The database file, built from demo.sql when it is not there yet. It is
    /// built beside the final name and moved in, so a failure leaves nothing
    /// half-made to open next time.
    static func ensure(in directory: URL = ConnectionStore.defaultDirectory) async throws -> URL {
        let url = url(in: directory)
        let files = FileManager.default
        if files.fileExists(atPath: url.path) { return url }
        guard let scriptURL = Bundle.main.url(forResource: "demo", withExtension: "sql") else {
            throw DemoError.scriptMissing
        }
        let script = try String(contentsOf: scriptURL, encoding: .utf8)
        try files.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let building = url.deletingLastPathComponent().appendingPathComponent("demo-building.sqlite")
        try? files.removeItem(at: building)

        let open = try await Core.shared.call("conn.open", ["driver": "sqlite", "dsn": ["path": building.path]])
        guard let id = (open as? [String: Any])?["connId"] as? String else { throw CoreError.badResponse }
        do {
            for statement in try Logic.shared.splitStatements(script, engine: "sqlite") {
                let sql = statement.text.trimmingCharacters(in: .whitespacesAndNewlines)
                if !sql.isEmpty { _ = try await Core.shared.call("query.run", ["connId": id, "sql": sql]) }
            }
        } catch {
            _ = try? await Core.shared.call("conn.close", ["connId": id])
            try? files.removeItem(at: building)
            throw error
        }
        _ = try await Core.shared.call("conn.close", ["connId": id])
        try files.moveItem(at: building, to: url)
        return url
    }

    /// Drops the user's edits: the next open builds it afresh.
    static func reset(in directory: URL = ConnectionStore.defaultDirectory) throws {
        let url = url(in: directory)
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
    }
}
