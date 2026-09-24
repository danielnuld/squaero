import SwiftUI

@main
struct SquaeroApp: App {
    init() { Theme.applyNavigationBar() }

    var body: some Scene {
        WindowGroup {
            RootView()
                .tint(Theme.accent)
        }
    }
}
