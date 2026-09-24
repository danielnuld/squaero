// The four tabs of the prototype (issue #575). Each fills in with its own
// issue: Conexiones #576, Consultas and Snippets #578; Ajustes shows what this
// build of the core carries.

import SwiftUI

struct RootView: View {
    var body: some View {
        TabView {
            Placeholder(title: "Conexiones", detail: "Llegan con #576.")
                .tabItem { Label("Conexiones", systemImage: "cylinder.split.1x2") }
            Placeholder(title: "Consultas", detail: "Llegan con #578.")
                .tabItem { Label("Consultas", systemImage: "text.alignleft") }
            Placeholder(title: "Snippets", detail: "Llegan con #578.")
                .tabItem { Label("Snippets", systemImage: "curlybraces") }
            SettingsView()
                .tabItem { Label("Ajustes", systemImage: "gearshape") }
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
                Section("Núcleo") {
                    LabeledContent("Versión") { Text(core).font(Theme.mono()) }
                    LabeledContent("Motores") { Text("\(Core.shared.driverCount)").font(Theme.mono()) }
                }
            }
            .navigationTitle("Ajustes")
            .task {
                let hello = try? await Core.shared.call("app.hello") as? [String: Any]
                core = hello?["coreVersion"] as? String ?? "sin respuesta"
            }
        }
    }
}
