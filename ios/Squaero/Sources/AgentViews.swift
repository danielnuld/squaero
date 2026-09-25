// The agent's sheets (issue #580, tasks 8.4-8.7). They only exist where the
// agent is on (AgentSettings.active); what the model writes lands in the
// editor or in the change preview, never runs from here.

import SquaeroLogic
import SwiftUI

/// What the query screen asks the agent.
enum AgentQueryTask: Identifiable {
    case explainError(sql: String, error: String)
    case explain(sql: String)
    case ask

    var id: String {
        switch self {
        case .explainError: return "error"
        case .explain: return "explain"
        case .ask: return "ask"
        }
    }

    @MainActor var title: String {
        switch self {
        case .explainError: return Logic.t("ios.agent.explainError")
        case .explain: return Logic.t("ios.agent.explain")
        case .ask: return Logic.t("ios.agent.ask")
        }
    }
}

struct AgentQuerySheet: View {
    let task: AgentQueryTask
    let session: Session
    /// Puts SQL in the editor; the user runs it.
    let use: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var question = ""
    @State private var thinking = false
    @State private var answer: String?
    @State private var sql: String?
    @State private var failure: String?

    var body: some View {
        NavigationStack {
            Form {
                if case .ask = task {
                    Section {
                        TextField(Logic.t("ios.agent.askPrompt2"), text: $question, axis: .vertical)
                            .lineLimit(2...4)
                            .submitLabel(.go)
                            .onSubmit(run)
                        Button(Logic.t("ios.agent.send"), action: run)
                            .disabled(thinking || question.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
                if thinking { HStack { Spacer(); ProgressView(Logic.t("ios.agent.thinking")); Spacer() } }
                if let answer { Section { Text(answer) } }
                if let sql {
                    Section {
                        Text(sql).font(Theme.mono()).textSelection(.enabled)
                        Button(Logic.t("ios.agent.useInEditor")) { use(sql); dismiss() }
                    } footer: {
                        Text(Logic.t("ios.agent.notRun"))
                    }
                }
                if let failure { Section { Text(failure).foregroundStyle(.red) } }
            }
            .navigationTitle(task.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(Logic.t("common.close")) { dismiss() } }
            }
            .task {
                if case .ask = task { return }
                run()
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func run() {
        guard !thinking else { return }
        thinking = true
        failure = nil
        answer = nil
        sql = nil
        Task {
            defer { thinking = false }
            #if canImport(FoundationModels)
            if #available(iOS 26.0, *) {
                do {
                    guard let tools = await AgentTools.load(connId: session.connId, conn: session.conn) else {
                        failure = Logic.t("ios.agent.noSchema")
                        return
                    }
                    switch task {
                    case let .explainError(statement, error):
                        let help = try await Agent.explainError(sql: statement, error: error, tools: tools)
                        answer = help.explanation
                        sql = help.fix
                    case let .explain(statement):
                        answer = try await Agent.explain(sql: statement, tools: tools)
                    case .ask:
                        if let found = try await Agent.ask(question: question, tools: tools) {
                            answer = found.summary
                            sql = found.sql
                        } else {
                            failure = Logic.t("ios.agent.notRead")
                        }
                    }
                } catch {
                    failure = error.localizedDescription
                }
                return
            }
            #endif
            failure = Logic.t("ios.agent.unavailable")
        }
    }
}

/// Task 8.7: a change asked in plain words fills in the edit and opens the
/// usual preview; Face ID and the transaction stay where they were.
struct AgentChangeSheet: View {
    let editor: RowEditor

    @Environment(\.dismiss) private var dismiss
    @State private var request = ""
    @State private var thinking = false
    @State private var failure: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(Logic.t("ios.agent.changePrompt"), text: $request, axis: .vertical)
                        .lineLimit(2...4)
                        .submitLabel(.go)
                        .onSubmit(run)
                } footer: {
                    Text(Logic.t("ios.agent.changeFooter"))
                }
                if thinking { HStack { Spacer(); ProgressView(Logic.t("ios.agent.thinking")); Spacer() } }
                if let failure { Section { Text(failure).foregroundStyle(.red) } }
            }
            .navigationTitle(Logic.t("ios.agent.change"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(Logic.t("common.cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(Logic.t("ios.edit.review"), action: run)
                        .disabled(thinking || request.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func run() {
        guard !thinking else { return }
        thinking = true
        failure = nil
        Task {
            defer { thinking = false }
            #if canImport(FoundationModels)
            if #available(iOS 26.0, *) {
                do {
                    let ref = editor.ref
                    let changes = try await Agent.change(
                        request: request, table: ref.object.name, columns: ref.columns.map(\.name),
                        values: editor.row, pk: ref.pk, engine: editor.session.conn.driver)
                    if changes.isEmpty {
                        failure = Logic.t("ios.agent.noChange")
                        return
                    }
                    AgentChangeSheet.fill(editor, with: changes)
                    dismiss()
                    // The preview is a sheet too: let this one go first.
                    try? await Task.sleep(for: .milliseconds(500))
                    await editor.review()
                } catch {
                    failure = error.localizedDescription
                }
                return
            }
            #endif
            failure = Logic.t("ios.agent.unavailable")
        }
    }

    /// The agent's values into the edit, as if typed: nothing is sent.
    static func fill(_ editor: RowEditor, with changes: [(column: String, value: String?)]) {
        editor.begin()
        for change in changes { editor.set(change.column, change.value) }
    }
}
