// The agent's evaluation battery (issue #580, task 8.8): questions against
// the demo database with answers that can be checked, run on the phone
// because the model only runs there. The scoring is plain code, tested in CI;
// the hits of a run are what gets written down.

import Foundation
import SquaeroLogic
import SwiftUI

struct AgentEvalBattery: Decodable {
    struct FilterCase: Decodable {
        let table: String
        let request: String
        let expect: [[String]]
    }

    struct QuestionCase: Decodable {
        let question: String
        let reference: String
    }

    struct ErrorCase: Decodable {
        let sql: String
        let column: String
    }

    let filters: [FilterCase]
    let questions: [QuestionCase]
    let errors: [ErrorCase]

    static func bundled(_ bundle: Bundle = .main) -> AgentEvalBattery? {
        guard let url = bundle.url(forResource: "eval", withExtension: "json"),
              let data = try? Data(contentsOf: url)
        else { return nil }
        return try? JSONDecoder().decode(AgentEvalBattery.self, from: data)
    }
}

enum AgentEvalScore {
    /// Every expected condition is among the proposed ones (column and
    /// operator exact, value without regard to case).
    static func filter(expect: [[String]], got: [Condition]) -> Bool {
        expect.allSatisfy { e in
            got.contains { c in
                e.count == 3 && c.column == e[0] && c.op == e[1]
                    && c.value.caseInsensitiveCompare(e[2]) == .orderedSame
            }
        }
    }

    /// The same answer: as many rows, and every column of the reference found
    /// among the answer's columns with the same values (in any order). Extra
    /// columns, names and ordering do not count against it.
    static func sameAnswer(reference: ResultSet, got: ResultSet) -> Bool {
        guard reference.rows.count == got.rows.count else { return false }
        func column(_ r: ResultSet, _ i: Int) -> [String] {
            r.rows.map { row in i < row.count ? normalized(row[i]) : "NULL" }.sorted()
        }
        let theirs = got.columns.indices.map { column(got, $0) }
        return reference.columns.indices.allSatisfy { theirs.contains(column(reference, $0)) }
    }

    /// "12.0" and "12" are the same number.
    private static func normalized(_ value: String?) -> String {
        guard let value else { return "NULL" }
        if let d = Double(value), d.rounded() == d, abs(d) < 1e15 { return String(Int64(d)) }
        if let d = Double(value) { return String(format: "%.4f", d) }
        return value
    }
}

/// Ajustes › Asistente › Evaluar: runs the battery on the demo database and
/// shows each case with what the model did, and a report to copy.
struct AgentEvalView: View {
    struct Outcome: Identifiable {
        let id = UUID()
        let kind: String
        let prompt: String
        let got: String
        let hit: Bool
    }

    @State private var outcomes: [Outcome] = []
    @State private var running = false
    @State private var failure: String?

    private var hits: Int { outcomes.filter(\.hit).count }

    var body: some View {
        List {
            Section {
                Button(running ? Logic.t("ios.agent.thinking") : Logic.t("ios.agent.evalRun"), action: run)
                    .disabled(running)
                if !outcomes.isEmpty {
                    LabeledContent(Logic.t("ios.agent.evalScore"), value: "\(hits) / \(outcomes.count)")
                    Button(Logic.t("ios.agent.evalCopy")) { UIPasteboard.general.string = report() }
                }
            } footer: {
                Text(Logic.t("ios.agent.evalFooter"))
            }
            if let failure { Section { Text(failure).foregroundStyle(.red) } }
            ForEach(outcomes) { o in
                VStack(alignment: .leading, spacing: 4) {
                    Label(o.prompt, systemImage: o.hit ? "checkmark.circle.fill" : "xmark.circle")
                        .foregroundStyle(o.hit ? .green : .red)
                    Text(o.got).font(Theme.mono(11)).foregroundStyle(.secondary).textSelection(.enabled)
                }
            }
        }
        .navigationTitle(Logic.t("ios.agent.eval"))
        .navigationBarTitleDisplayMode(.inline)
    }

    private func report() -> String {
        var lines = ["Squaero agent eval: \(hits)/\(outcomes.count)"]
        lines += outcomes.map { "\($0.hit ? "OK " : "NO ") [\($0.kind)] \($0.prompt) -> \($0.got)" }
        return lines.joined(separator: "\n")
    }

    private func run() {
        guard let battery = AgentEvalBattery.bundled() else { return }
        running = true
        outcomes = []
        failure = nil
        Task {
            defer { running = false }
            #if canImport(FoundationModels)
            if #available(iOS 26.0, *) {
                var connId: String?
                do {
                    let url = try await DemoDatabase.ensure()
                    let conn = DemoDatabase.connection(url)
                    let id = try await Connector.open(conn, protected: false)
                    connId = id
                    guard let tools = await AgentTools.load(connId: id, conn: conn) else { return }
                    await evaluate(battery, tools: tools, connId: id)
                } catch {
                    failure = error.localizedDescription
                }
                if let connId { _ = try? await Core.shared.call("conn.close", ["connId": connId]) }
                return
            }
            #endif
            failure = Logic.t("ios.agent.unavailable")
        }
    }

    #if canImport(FoundationModels)
    @available(iOS 26.0, *)
    private func evaluate(_ battery: AgentEvalBattery, tools: AgentTools, connId: String) async {
        for c in battery.filters {
            var got = "—"
            var hit = false
            do {
                let d = try await Core.shared.resultSet("schema.describe",
                                                        ["connId": connId, "table": c.table, "db": "main"])
                let names = try Logic.shared.describeColumnNames(d)
                let types = try Logic.shared.describeColumnTypes(d)
                let conditions = try await AgentFilter.ask(c.request, table: c.table, columns: names, types: types)
                got = conditions.map { "\($0.column) \($0.op) \($0.value)" }.joined(separator: " AND ")
                hit = AgentEvalScore.filter(expect: c.expect, got: conditions)
            } catch {
                got = error.localizedDescription
            }
            outcomes.append(Outcome(kind: "filtro", prompt: c.request, got: got, hit: hit))
        }
        for c in battery.questions {
            var got = "—"
            var hit = false
            do {
                if let answer = try await Agent.ask(question: c.question, tools: tools) {
                    got = answer.sql
                    let reference = try await Core.shared.resultSet("query.run", ["connId": connId, "sql": c.reference])
                    let theirs = try await Core.shared.resultSet("query.run", ["connId": connId, "sql": answer.sql])
                    hit = AgentEvalScore.sameAnswer(reference: reference, got: theirs)
                } else {
                    got = Logic.t("ios.agent.notRead")
                }
            } catch {
                got += " · " + error.localizedDescription
            }
            outcomes.append(Outcome(kind: "datos", prompt: c.question, got: got, hit: hit))
        }
        for c in battery.errors {
            var got = "—"
            var hit = false
            do {
                let error: String
                do {
                    _ = try await Core.shared.call("query.run", ["connId": connId, "sql": c.sql])
                    error = "?"
                } catch let CoreError.rpc(_, message) {
                    error = message
                }
                let help = try await Agent.explainError(sql: c.sql, error: error, tools: tools)
                got = help.fix ?? help.explanation
                if let fix = help.fix, fix.localizedCaseInsensitiveContains(c.column) {
                    _ = try await Core.shared.call("query.run", ["connId": connId, "sql": fix, "limit": 1])
                    hit = true
                }
            } catch {
                got += " · " + error.localizedDescription
            }
            outcomes.append(Outcome(kind: "error", prompt: c.sql, got: got, hit: hit))
        }
    }
    #endif
}
