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

    /// Drivers linked into this build, registered once.
    let driverCount: Int

    private let queue = DispatchQueue(label: "squaero.core")
    private let cancelQueue = DispatchQueue(label: "squaero.core.cancel")
    private let lock = NSLock()
    private var nextId = 0

    private init() {
        driverCount = Int(quaero_register_static_drivers(dbcore_runtime_get()))
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
            throw CoreError.rpc(code: error["code"] as? Int ?? 0, message: error["message"] as? String ?? "")
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
