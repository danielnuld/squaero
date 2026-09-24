// New / edit connection (issue #576). The fields, their sections, their
// labels and their validation all come from desktop's code (DRIVER_SCHEMAS,
// formSections, fieldErrors, the catalogs) through SquaeroLogic, so an engine
// gains a field in one place. Only the engines this build links are offered.

import SquaeroLogic
import SwiftUI
import UniformTypeIdentifiers

struct ConnectionForm: View {
    let store: ConnectionStore
    let original: Connection?

    @Environment(\.dismiss) private var dismiss
    @State private var conn: Connection
    @State private var keep = true
    @State private var sshOn: Bool
    @State private var errors: [String: String] = [:]
    @State private var picking: String?
    @State private var failure: String?

    init(store: ConnectionStore, original: Connection?) {
        self.store = store
        self.original = original
        let start = original ?? Connection(id: store.newId(), name: "", driver: "informix")
        _conn = State(initialValue: start)
        _sshOn = State(initialValue: !(start.params["ssh_host"] ?? "").isEmpty)
        // Editing: the switch shows what is true now, a saved secret or none.
        if let original {
            let keys = (try? Logic.shared.secretKeys(driver: original.driver)) ?? []
            _keep = State(initialValue: keys.isEmpty
                || keys.contains { Keychain.exists(account: Keychain.account(original.id, $0)) })
        }
    }

    private var drivers: [DriverSchema] {
        let schemas = (try? Logic.shared.driverSchemas()) ?? [:]
        return schemas.values.filter { Core.shared.hasDriver($0.driver) }.sorted { $0.label < $1.label }
    }

    /// Fields that mean nothing on iOS: sqli_server names the SQLI fallback,
    /// which exists only on Windows (the IBM client).
    private static let desktopOnly: Set<String> = ["sqli_server"]

    private var sections: [FormSection] {
        ((try? Logic.shared.formSections(driver: conn.driver)) ?? []).map { section in
            var s = section
            s.fields.removeAll { Self.desktopOnly.contains($0.key) }
            return s
        }
    }

    private var secretKeys: [String] { (try? Logic.shared.secretKeys(driver: conn.driver)) ?? [] }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if original == nil {
                        Picker(Logic.t("ios.conn.engine"), selection: $conn.driver) {
                            ForEach(drivers, id: \.driver) { Text($0.label).tag($0.driver) }
                        }
                    }
                    labeled(Logic.t("cform.name")) {
                        TextField("", text: $conn.name, prompt: Text(namePrompt))
                    }
                    labeled(Logic.t("cform.group")) {
                        TextField("", text: Binding(
                            get: { conn.group ?? "" }, set: { conn.group = $0.isEmpty ? nil : $0 }))
                    }
                }
                ForEach(sections) { section in
                    if section.id == "ssh" {
                        Section {
                            Toggle(Logic.t("cform.section.ssh"), isOn: $sshOn)
                            if sshOn { ForEach(section.fields) { field($0) } }
                        }
                    } else {
                        Section {
                            ForEach(section.fields) { field($0) }
                        } header: {
                            Text(Logic.t("cform.section.\(section.id)"))
                        } footer: {
                            if section.id == "server" && conn.driver == "informix" {
                                Text(Logic.t("ios.conn.informixHint"))
                            }
                        }
                    }
                }
                if !secretKeys.isEmpty {
                    Section {
                        Toggle(Logic.t("ios.conn.keychain"), isOn: $keep)
                    } footer: { Text(Logic.t("ios.conn.keychainHint")) }
                }
            }
            .navigationTitle(Logic.t(original == nil ? "ios.conn.new" : "ios.conn.edit"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(Logic.t("common.cancel")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(Logic.t("cform.save"), action: save)
                }
            }
            .fileImporter(isPresented: Binding(get: { picking != nil }, set: { if !$0 { picking = nil } }), allowedContentTypes: [.data, .item]) { result in
                defer { picking = nil }
                guard let key = picking, case .success(let url) = result else { return }
                do {
                    conn.params[key] = try store.importFile(url, connId: conn.id)
                } catch {
                    failure = "\(error)"
                }
            }
            .alert(Logic.t("ios.conn.failed"), isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
                Button("OK") { failure = nil }
            } message: { Text(failure ?? "") }
        }
    }

    @ViewBuilder
    private func field(_ f: DriverField) -> some View {
        let label = Logic.t(f.label)
        let prompt = f.placeholder.map { Text(Logic.t($0)) }
        let value = Binding(get: { conn.params[f.key] ?? "" }, set: { conn.params[f.key] = $0 })
        VStack(alignment: .leading, spacing: 4) {
            switch f.type {
            case "password":
                labeled(label) {
                    SecureField("", text: value, prompt: savedPrompt(f.key) ?? prompt)
                        .textContentType(.password)
                }
            case "select":
                Picker(label, selection: value) {
                    ForEach(f.options ?? [], id: \.value) { Text(Logic.t($0.label)).tag($0.value) }
                }
            case "file":
                LabeledContent(label) {
                    Button(fileName(conn.params[f.key]) ?? Logic.t("ios.conn.pickFile")) { picking = f.key }
                }
            default:
                labeled(label) {
                    TextField("", text: value, prompt: prompt)
                        .keyboardType(f.type == "number" ? .numberPad : .default)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(f.type == "number" ? Theme.mono() : .body)
                }
            }
            if let error = errors[f.key] {
                Text(Logic.t(error)).font(.footnote).foregroundStyle(.red)
            }
        }
    }

    /// Settings style: the label on the left, what is typed on the right. A
    /// bare TextField shows its placeholder instead of its label, so "127.0.0.1"
    /// stood where "Host" should be.
    private func labeled<Content: View>(_ label: String, @ViewBuilder _ content: () -> Content) -> some View {
        LabeledContent(label) { content().multilineTextAlignment(.trailing) }
    }

    /// What the name becomes if left empty, else the catalog's example.
    private var namePrompt: String {
        let suggested = (try? Logic.shared.defaultConnectionName(conn)) ?? ""
        return suggested.isEmpty ? Logic.t("cform.namePlaceholder") : suggested
    }

    /// An edited connection with a saved secret shows it is there, without it.
    private func savedPrompt(_ key: String) -> Text? {
        guard let original, Keychain.exists(account: Keychain.account(original.id, key)) else { return nil }
        return Text("••••••••")
    }

    private func fileName(_ path: String?) -> String? {
        guard let path, !path.isEmpty else { return nil }
        return URL(fileURLWithPath: path).lastPathComponent
    }

    private func save() {
        var out = conn
        if !sshOn {
            // The tunnel exists only while ssh_host has a value (docs/IPC.md).
            for key in out.params.keys where key.hasPrefix("ssh_") { out.params[key] = nil }
        }
        errors = (try? Logic.shared.fieldErrors(out, sshRequired: sshOn)) ?? [:]
        guard errors.isEmpty else { return }
        if out.name.trimmingCharacters(in: .whitespaces).isEmpty {
            out.name = (try? Logic.shared.defaultConnectionName(out)) ?? ""
        }
        do {
            try store.save(out, keep: keep)
            dismiss()
        } catch KeychainError.noPasscode {
            failure = Logic.t("ios.keychain.noPasscode")
        } catch {
            failure = "\(error)"
        }
    }
}
