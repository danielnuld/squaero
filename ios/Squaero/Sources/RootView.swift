// The four tabs of the prototype (issue #575). Conexiones is live (#576);
// Consultas runs SQL on the connection it has open (#578); Snippets fills in
// with #578; Ajustes shows what this build of the core carries.

import SwiftUI

struct RootView: View {
    var body: some View {
        TabView {
            ConnectionsView()
                .tabItem { Label(Logic.t("ios.tab.connections"), systemImage: "cylinder.split.1x2") }
            QueriesView()
                .tabItem { Label(Logic.t("ios.tab.queries"), systemImage: "text.alignleft") }
            Placeholder(title: Logic.t("ios.tab.snippets"), detail: "#578")
                .tabItem { Label(Logic.t("ios.tab.snippets"), systemImage: "curlybraces") }
            SettingsView()
                .tabItem { Label(Logic.t("ios.tab.settings"), systemImage: "gearshape") }
        }
    }
}

private struct Placeholder: View {
    let title: String
    let detail: String

    var body: some View {
        NavigationStack {
            ContentUnavailableView(title, systemImage: "hammer", description: Text(detail))
                .navigationTitle(title)
        }
    }
}

struct SettingsView: View {
    @State private var core: String = "…"

    var body: some View {
        NavigationStack {
            List {
                Section(Logic.t("ios.settings.core")) {
                    LabeledContent(Logic.t("ios.settings.version")) { Text(core).font(Theme.mono()) }
                    LabeledContent(Logic.t("ios.settings.engines")) {
                        Text("\(Core.shared.driverCount)").font(Theme.mono())
                    }
                }
            }
            .navigationTitle(Logic.t("ios.tab.settings"))
            .task {
                let hello = try? await Core.shared.call("app.hello") as? [String: Any]
                core = hello?["coreVersion"] as? String ?? "—"
            }
        }
    }
}
