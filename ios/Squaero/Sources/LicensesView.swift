// Ajustes › Licencias (issue #579, task 7.5): every third-party component in
// the app with its version, licence and full text, from Licenses.json, which
// scripts/ios/licenses.mjs generates from THIRD-PARTY.md.

import SwiftUI

struct LicensedComponent: Decodable, Identifiable, Hashable {
    struct Part: Decodable, Hashable {
        let file: String
        let text: String
    }
    let name: String
    /// Nil for Squaero itself (the app's version) and the fonts.
    let version: String?
    let license: String
    let texts: [Part]
    var id: String { name }

    /// The components shipped in the bundle; empty when the file is missing,
    /// which DistributionTests does not allow.
    static func bundled(_ bundle: Bundle = .main) -> [LicensedComponent] {
        guard let url = bundle.url(forResource: "Licenses", withExtension: "json"),
              let data = try? Data(contentsOf: url)
        else { return [] }
        return (try? JSONDecoder().decode([LicensedComponent].self, from: data)) ?? []
    }
}

struct LicensesView: View {
    private let components = LicensedComponent.bundled()
    private let appVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String

    var body: some View {
        List {
            Section {
                ForEach(components) { component in
                    NavigationLink(value: component) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(component.name).font(.body.weight(.semibold))
                            Text([component.version ?? (component.name == "Squaero" ? appVersion : nil), component.license]
                                    .compactMap { $0 }.joined(separator: " · "))
                                .font(Theme.mono(12)).foregroundStyle(.secondary)
                        }
                    }
                }
            } footer: {
                Text(Logic.t("ios.licenses.footer"))
            }
        }
        .navigationTitle(Logic.t("ios.licenses.title"))
    }
}

/// One component's licence texts; its destination is declared at the root of
/// Ajustes' stack, with the rest of the stack's (RootView).
struct LicenseTextView: View {
    let component: LicensedComponent

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                ForEach(component.texts, id: \.file) { text in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(text.file).font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
                        Text(text.text).font(Theme.mono(11)).textSelection(.enabled)
                    }
                }
            }
            .padding()
        }
        .navigationTitle(component.name)
        .navigationBarTitleDisplayMode(.inline)
    }
}
