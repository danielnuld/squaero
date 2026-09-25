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
    /// Ajustes' screens, as values of one path: a view pushed with a closure
    /// link that then pushes values looped back, as Conexiones did.
    enum Route: Hashable { case licenses, agentEval }

    @State private var core: String = "…"
    @State private var agent = AgentSettings.enabled

    var body: some View {
        NavigationStack {
            List {
                Section(Logic.t("ios.settings.core")) {
                    LabeledContent(Logic.t("ios.settings.version")) { Text(core).font(Theme.mono()) }
                    LabeledContent(Logic.t("ios.settings.engines")) {
                        Text("\(Core.shared.driverCount)").font(Theme.mono())
                    }
                }
                // Only where Apple Intelligence is (issue #580).
                if AgentSettings.available {
                    Section {
                        Toggle(Logic.t("ios.agent.toggle"), isOn: $agent)
                            .onChange(of: agent) { _, on in AgentSettings.enabled = on }
                        if agent {
                            NavigationLink(Logic.t("ios.agent.eval"), value: Route.agentEval)
                        }
                    } header: {
                        Text(Logic.t("ios.agent.title"))
                    } footer: {
                        Text(Logic.t("ios.agent.about"))
                    }
                }
                Section {
                    NavigationLink(Logic.t("ios.licenses.title"), value: Route.licenses)
                }
            }
            .navigationTitle(Logic.t("ios.tab.settings"))
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .licenses: LicensesView()
                case .agentEval: AgentEvalView()
                }
            }
            .navigationDestination(for: LicensedComponent.self) { LicenseTextView(component: $0) }
            .task {
                let hello = try? await Core.shared.call("app.hello") as? [String: Any]
                core = hello?["coreVersion"] as? String ?? "—"
            }
        }
    }
}
