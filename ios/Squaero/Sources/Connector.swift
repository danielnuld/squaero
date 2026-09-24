// Opening a saved connection (issue #576): read its secrets after one Face ID
// check, add what the user typed for the ones not saved, build the DSN in
// memory and hand it to conn.open. The DSN is never stored.

import Foundation
import LocalAuthentication
import SquaeroLogic

enum ConnectError: Error {
    case cancelled
    case keychain(String)
    case core(String)
}

@MainActor
enum Connector {
    /// Secret fields this connection needs and the Keychain does not hold,
    /// so the app has to ask for them before connecting.
    static func missingSecrets(_ conn: Connection) -> [String] {
        let keys = (try? Logic.shared.secretKeys(driver: conn.driver)) ?? []
        return keys.filter { key in
            if Keychain.exists(account: Keychain.account(conn.id, key)) { return false }
            switch key {
            case "password": return true
            case "ssh_password": return conn.params["ssh_auth"] == "password"
            default: return false
            }
        }
    }

    /// Opens `conn` and returns the core's connId.
    static func open(_ conn: Connection, typed: [String: String] = [:], protected: Bool = true) async throws -> String {
        var params = conn.params
        let saved = ((try? Logic.shared.secretKeys(driver: conn.driver)) ?? [])
            .filter { typed[$0] == nil && Keychain.exists(account: Keychain.account(conn.id, $0)) }
        if !saved.isEmpty {
            let context = LAContext()
            if protected {
                do {
                    _ = try await context.evaluatePolicy(
                        .deviceOwnerAuthentication,
                        localizedReason: Logic.t("ios.faceid.reason", ["name": conn.name]))
                } catch {
                    throw ConnectError.cancelled
                }
            }
            for key in saved {
                do {
                    params[key] = try Keychain.read(account: Keychain.account(conn.id, key), context: context)
                } catch KeychainError.cancelled {
                    throw ConnectError.cancelled
                } catch {
                    throw ConnectError.keychain(Logic.t("ios.faceid.failed", ["status": "\(error)"]))
                }
            }
        }
        params.merge(typed) { _, new in new }

        var withSecrets = conn
        withSecrets.params = params
        let dsn = try Logic.shared.buildDsn(withSecrets)
        do {
            let result = try await Core.shared.call("conn.open", ["driver": conn.driver, "dsn": dsn])
            guard let id = (result as? [String: Any])?["connId"] as? String else {
                throw ConnectError.core("conn.open: no connId")
            }
            return id
        } catch let CoreError.rpc(_, message) {
            throw ConnectError.core(message)
        }
    }
}
