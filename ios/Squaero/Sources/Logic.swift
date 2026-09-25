// The app's one SquaeroLogic (squaero-logic.js in JavaScriptCore), used from
// the main actor only: a JSContext must not run on two threads at once.

import Foundation
import SquaeroLogic

@MainActor
enum Logic {
    static let shared: SquaeroLogic = {
        do { return try SquaeroLogic() } catch {
            // The script ships inside the app; without it nothing works.
            fatalError("squaero-logic.js: \(error)")
        }
    }()

    /// "en" when the iPhone speaks English, else Spanish, like desktop.
    static let locale: String = Locale.preferredLanguages.first?.hasPrefix("en") == true ? "en" : "es"

    /// Text for an i18n key of the shared catalogs (frontend/src/utils/messages).
    static func t(_ key: String, _ params: [String: String]? = nil) -> String {
        (try? shared.translate(key, locale: locale, params: params)) ?? key
    }

    /// The core's message, or the text for its SQLCODE on Informix (#559).
    static func readable(_ error: Error) -> String {
        guard case let CoreError.rpc(_, message) = error else { return "\(error)" }
        let text: String?? = try? shared.informixErrorText(message, locale: locale)
        return text.flatMap { $0 } ?? message
    }
}
