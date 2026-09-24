// The app's line to the core (issue #575, design D5): JSON-RPC as in
// docs/IPC.md, through dbcore_ipc_handle. The core is single-threaded, like
// desktop's worker thread, so every call runs on one serial queue, except
// op.cancel, which must be able to interrupt a query that queue is running.

import Foundation
import SquaeroCore

enum CoreError: Error, Equatable {
    /// The core answered with a JSON-RPC error.
    case rpc(code: Int, message: String)
    /// The core's answer was not JSON-RPC.
    case badResponse
}

final class Core: @unchecked Sendable {
    static let shared = Core()

    /// Posted on the main actor, with the connId as `object`, when a call fails
    /// because its connection is gone (issue #576, design D7).
    static let connectionLost = Notification.Name("SquaeroConnectionLost")

    /// Desktop's rule (transport.ts, #407): -32000 is "could not open OR use
    /// the connection", and only conn.open opens, so from any other method the
    /// connection was open and has stopped working.
    static func saysConnectionLost(method: String, code: Int) -> Bool {
        method != "conn.open" && code == -32000
    }

    /// Drivers linked into this build, registered once.
    let driverCount: Int

    private let queue = DispatchQueue(label: "squaero.core")
    private let cancelQueue = DispatchQueue(label: "squaero.core.cancel")
    private let lock = NSLock()
    private var nextId = 0

    private init() {
        driverCount = Int(quaero_register_static_drivers(dbcore_runtime_get()))
    }

    /// Whether this build links the driver (MySQL and SQL Server wait for
    /// their own clients, #583/#584). Asks the runtime, not the IPC.
    func hasDriver(_ name: String) -> Bool {
        queue.sync { dbcore_runtime_find_driver(dbcore_runtime_get(), name) != nil }
    }

    /// Calls `method` and returns its `result`, or throws the core's error.
    func call(_ method: String, _ params: [String: Any] = [:]) async throws -> Any {
        let request = try JSONSerialization.data(withJSONObject: [
            "jsonrpc": "2.0", "id": allocateId(), "method": method, "params": params,
        ])
        let target = method == "op.cancel" ? cancelQueue : queue
        let response: Data = await withCheckedContinuation { done in
            target.async {
                let text = String(decoding: request, as: UTF8.self)
                let out = dbcore_ipc_handle(text)
                defer { dbcore_ipc_free(out) }
                done.resume(returning: out.map { Data(String(cString: $0).utf8) } ?? Data())
            }
        }
        guard let body = try? JSONSerialization.jsonObject(with: response) as? [String: Any] else {
            throw CoreError.badResponse
        }
        if let error = body["error"] as? [String: Any] {
            let code = error["code"] as? Int ?? 0
            if Core.saysConnectionLost(method: method, code: code), let connId = params["connId"] as? String {
                await MainActor.run { NotificationCenter.default.post(name: Core.connectionLost, object: connId) }
            }
            throw CoreError.rpc(code: code, message: error["message"] as? String ?? "")
        }
        guard let result = body["result"] else { throw CoreError.badResponse }
        return result
    }

    private func allocateId() -> Int {
        lock.lock()
        defer { lock.unlock() }
        nextId += 1
        return nextId
    }
}
