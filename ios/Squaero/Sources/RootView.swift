// The four tabs of the prototype (issue #575). Conexiones is live (#576);
// Consultas runs SQL on the connection it has open and Snippets keeps saved
// queries (#578); Ajustes shows what this build of the core carries.

import SwiftUI

struct RootView: View {
    @State private var nav = AppNavigation.shared

    var body: some View {
        TabView(selection: $nav.tab) {
            ConnectionsView()
                .tabItem { Label(Logic.t("ios.tab.connections"), systemImage: "cylinder.split.1x2") }
                .tag(AppNavigation.Tab.connections)
            QueriesView()
                .tabItem { Label(Logic.t("ios.tab.queries"), systemImage: "text.alignleft") }
                .tag(AppNavigation.Tab.queries)
            SnippetsView()
                .tabItem { Label(Logic.t("ios.tab.snippets"), systemImage: "curlybraces") }
                .tag(AppNavigation.Tab.snippets)
            SettingsView()
                .tabItem { Label(Logic.t("ios.tab.settings"), systemImage: "gearshape") }
                .tag(AppNavigation.Tab.settings)
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
                Section {
                    NavigationLink(Logic.t("ios.licenses.title")) { LicensesView() }
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
