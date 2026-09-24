// Connection secrets in the Keychain (issue #576, design D6): bound to this
// device, and readable only after Face ID or the passcode. Nothing secret goes
// to the app's files; the DSN is built in memory right before conn.open.

import Foundation
import LocalAuthentication
import Security

enum KeychainError: Error, Equatable {
    /// The user cancelled Face ID / the passcode.
    case cancelled
    /// The device has no passcode, so a protected item cannot exist.
    case noPasscode
    case status(OSStatus)
}

enum Keychain {
    static let service = "io.github.danielnuld.Squaero.secret"

    /// Each secret is one item: "<connection id>/<field key>".
    static func account(_ connId: String, _ key: String) -> String { "\(connId)/\(key)" }

    /// `protected` false is for the tests only: the simulator has no Face ID
    /// to enrol and no passcode to set from a test.
    static func save(_ value: String, account: String, protected: Bool = true) throws {
        delete(account: account)
        var item: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: Data(value.utf8),
        ]
        if protected {
            var error: Unmanaged<CFError>?
            guard let access = SecAccessControlCreateWithFlags(
                nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
                [.biometryCurrentSet, .or, .devicePasscode], &error)
            else { throw KeychainError.status(errSecParam) }
            item[kSecAttrAccessControl as String] = access
        } else {
            item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        }
        let status = SecItemAdd(item as CFDictionary, nil)
        if status == errSecNotAvailable || status == errSecAuthFailed { throw KeychainError.noPasscode }
        guard status == errSecSuccess else { throw KeychainError.status(status) }
    }

    /// The secret, or nil when none is saved. `context` carries one Face ID
    /// check across every secret of a connection.
    static func read(account: String, context: LAContext? = nil) throws -> String? {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        if let context { query[kSecUseAuthenticationContext as String] = context }
        var out: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &out)
        switch status {
        case errSecSuccess:
            return (out as? Data).map { String(decoding: $0, as: UTF8.self) }
        case errSecItemNotFound:
            return nil
        case errSecUserCanceled, errSecAuthFailed:
            throw KeychainError.cancelled
        default:
            throw KeychainError.status(status)
        }
    }

    /// Whether an item exists, without asking for Face ID.
    static func exists(account: String) -> Bool {
        let context = LAContext()
        context.interactionNotAllowed = true
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecUseAuthenticationContext as String: context,
        ]
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        // A protected item answers "interaction not allowed": it is there.
        return status == errSecSuccess || status == errSecInteractionNotAllowed
    }

    static func delete(account: String) {
        SecItemDelete([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ] as CFDictionary)
    }
}
