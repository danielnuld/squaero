// The Consultas tab (issue #578, task 6.1, design D8): SQL against the
// connection Conexiones has open. The editor is a UITextView; its colours and
// completions come from sqlEditor.ts in JavaScriptCore, the statements are
// split as desktop splits them (runScope.ts), and the result pages from one
// open cursor, as a table's rows do.

import SquaeroLogic
import SwiftUI
import UIKit

/// Runs what the editor holds and keeps its result. Kept apart from the views
/// so running, paging and completing can be tested without them.
@MainActor
@Observable
final class QueryModel {
    static let pageSize = 50

    let session: Session
    var text = ""
    private(set) var schema = EditorSchema()
    private(set) var columns: [ResultColumn] = []
    private(set) var rows: [[String?]] = []
    private(set) var more = false
    private(set) var cursor = false
    private(set) var running = false
    private(set) var failure: String?
    /// Set when a script ran more than one statement.
    private(set) var note: String?
    private(set) var affected = 0
    private(set) var elapsed: String?
    /// Where the tables were listed, to describe them there.
    @ObservationIgnored private var level: (db: String?, schema: String?) = (nil, nil)
    @ObservationIgnored private var described: Set<String> = []
    @ObservationIgnored private var lastSql = ""
    /// The statement whose result is shown.
    var lastRunSql: String { lastSql }

    init(session: Session) {
        self.session = session
    }

    var engine: String { session.conn.driver }

    /// "12 filas · 34 ms", "50+ filas · …", or the rows a change affected.
    var summary: String? {
        guard let elapsed else { return nil }
        if columns.isEmpty { return Logic.t("ios.query.affected", ["n": "\(affected)", "time": elapsed]) }
        return Logic.t(more ? "ios.query.rowsMore" : "ios.query.rows", ["n": "\(rows.count)", "time": elapsed])
    }

    // MARK: Schema, for completion

    /// The tables of the connection's own database (PostgreSQL's public
    /// schema), walking down while there is one container to walk into.
    func loadTables() async {
        guard let found = await TreeLevel.tables(connId: session.connId, conn: session.conn) else { return }
        schema.tables = found.tables
        level = (found.db, found.schema)
    }

    /// Describes the tables the text names that are not described yet.
    func describeMentioned() async {
        guard let names = try? Logic.shared.tablesInStatement(text) else { return }
        for name in names where !described.contains(name.lowercased()) {
            described.insert(name.lowercased())
            var p: [String: Any] = ["connId": session.connId, "table": name]
            if let db = level.db { p["db"] = db }
            if let schema = level.schema { p["schema"] = schema }
            guard let d = try? await Core.shared.resultSet("schema.describe", p),
                  let cols = try? Logic.shared.describeColumnNames(d), !cols.isEmpty
            else { continue }
            schema.columns[name] = cols
        }
    }

    /// What to offer at `cursor` in `text`, and where it would go.
    func suggestions(_ text: String, cursor: Int) -> (from: Int, items: [String]) {
        guard let ctx = try? Logic.shared.completionContext(text, cursor: cursor),
              let items = try? Logic.shared.completionItems(text, ctx, schema: schema)
        else { return (cursor, []) }
        return (ctx.from, items)
    }

    // MARK: Running

    /// What a run takes: the selection when there is one, else the whole text.
    func target(_ selection: NSRange) -> String {
        let whole = text as NSString
        return selection.length > 0 && NSMaxRange(selection) <= whole.length ? whole.substring(with: selection) : text
    }

    /// The `:nombre` and `${nombre}` of what a run would take, each once.
    func variables(selection: NSRange) -> [SqlVariable] {
        (try? Logic.shared.findVariables(sql: target(selection), engine: engine)) ?? []
    }

    /// The selection when there is one, else the whole text, with `values`
    /// written in for its variables (sqlVariables.ts), one statement at a
    /// time. The last statement's result is shown; a failure stops the run.
    func run(selection: NSRange, values: [String: VarValue] = [:]) async {
        guard !running else { return }
        var target = self.target(selection)
        if !values.isEmpty {
            do {
                target = try Logic.shared.applyVariables(sql: target, values: values, engine: engine)
            } catch {
                failure = "\(error)"
                return
            }
        }
        let statements = ((try? Logic.shared.splitStatements(target, engine: engine)) ?? [])
            .map { $0.text.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard !statements.isEmpty else { return }
        close()
        await describeMentioned()
        running = true
        defer { running = false }
        failure = nil
        note = nil
        elapsed = nil
        let clock = ContinuousClock()
        let start = clock.now
        for (i, sql) in statements.enumerated() {
            let last = i == statements.count - 1
            var p: [String: Any] = ["connId": session.connId, "sql": sql]
            if last {
                p["limit"] = Self.pageSize
                p["cursor"] = true
            } else {
                p["limit"] = 1
            }
            do {
                let r = try await Core.shared.resultSet("query.run", p)
                if last {
                    columns = r.columns
                    rows = r.rows
                    more = r.truncated
                    cursor = r.cursor == true
                    affected = r.rowsAffected
                    lastSql = sql
                }
            } catch {
                columns = []
                rows = []
                more = false
                let reason = Logic.readable(error)
                failure = statements.count == 1 ? reason
                    : Logic.t("ios.query.failedAt", ["n": "\(i + 1)", "total": "\(statements.count)", "reason": reason])
                return
            }
        }
        let d = (clock.now - start).components
        let ms = Double(d.seconds) * 1000 + Double(d.attoseconds) / 1e15
        elapsed = (try? Logic.shared.formatDuration(ms: ms)) ?? "\(Int(ms)) ms"
        if statements.count > 1 { note = Logic.t("ios.query.statements", ["n": "\(statements.count)"]) }
    }

    /// The next page: from the open cursor, or re-run from an offset.
    func page() async {
        guard more, !running else { return }
        running = true
        defer { running = false }
        do {
            let next = cursor
                ? try await Core.shared.resultSet("query.next", ["connId": session.connId, "limit": Self.pageSize])
                : try await Core.shared.resultSet("query.run", [
                    "connId": session.connId, "sql": lastSql, "limit": Self.pageSize, "offset": rows.count,
                ])
            rows += next.rows
            more = next.truncated && !next.rows.isEmpty
            cursor = next.cursor == true
        } catch {
            failure = Logic.readable(error)
        }
    }

    /// One cursor per connection: leave none behind for another screen.
    func close() {
        guard cursor else { return }
        cursor = false
        let id = session.connId
        Task { _ = try? await Core.shared.call("query.cursorClose", ["connId": id]) }
    }
}

struct QueriesView: View {
    var body: some View {
        NavigationStack {
            Group {
                if let session = OpenSession.shared.current {
                    QueryScreen(session: session).id(ObjectIdentifier(session))
                } else {
                    ContentUnavailableView(Logic.t("ios.query.noConnection"), systemImage: "text.alignleft",
                                           description: Text(Logic.t("ios.query.noConnectionHint")))
                }
            }
            .navigationTitle(Logic.t("ios.tab.queries"))
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

private struct QueryScreen: View {
    @State private var model: QueryModel
    @State private var selection = NSRange(location: 0, length: 0)
    @State private var asking: VariablePrompt?
    @State private var naming = false
    @State private var name = ""
    @State private var saved: String?
    @State private var exporting = false

    init(session: Session) {
        _model = State(initialValue: QueryModel(session: session))
    }

    private var blank: Bool { model.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        List {
            if model.session.lost {
                Section {
                    Label(Logic.t("conn.lost", ["name": model.session.conn.name]),
                          systemImage: "bolt.horizontal.circle")
                        .foregroundStyle(.orange)
                    Button(Logic.t("conn.reconnect"), action: model.session.reconnect)
                }
            }
            Section {
                SQLEditor(text: $model.text, selection: $selection, engine: model.engine) { text, cursor in
                    model.suggestions(text, cursor: cursor)
                }
                .frame(height: 180)
                .listRowInsets(EdgeInsets(top: 6, leading: 6, bottom: 6, trailing: 6))
            } header: {
                Text(model.session.conn.name)
            } footer: {
                if let failure = model.failure {
                    Label(failure, systemImage: "exclamationmark.triangle").foregroundStyle(.red)
                } else if let summary = model.summary {
                    Text(summary + (model.note.map { "\n" + $0 } ?? "")).font(Theme.mono(11))
                }
            }
            ForEach(model.rows.indices, id: \.self) { i in
                RowCard(columns: model.columns, row: model.rows[i])
                    .onAppear { if i == model.rows.count - 1 { Task { await model.page() } } }
            }
            if model.running { HStack { Spacer(); ProgressView(); Spacer() } }
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button(action: start) {
                    Label(Logic.t("ios.query.run"), systemImage: "play.fill")
                }
                .disabled(model.running || blank)
            }
            ToolbarItem(placement: .secondaryAction) {
                Button {
                    let target = model.target(selection)
                    name = ((try? Logic.shared.proposedSnippetName(target, engine: model.engine)) ?? nil)
                        ?? Logic.t("snip.fallbackName")
                    naming = true
                } label: {
                    Label(Logic.t("ios.snip.save"), systemImage: "star")
                }
                .disabled(blank)
            }
            ToolbarItem(placement: .secondaryAction) {
                Button { exporting = true } label: {
                    Label(Logic.t("ios.export.action"), systemImage: "square.and.arrow.up")
                }
                .disabled(model.columns.isEmpty || model.running)
            }
        }
        .sheet(isPresented: $exporting) { ExportSheet(source: model) }
        .sheet(item: $asking) { prompt in
            VariablesSheet(prompt: prompt) { values in
                try? SnippetStore.shared.remember(values)
                Task { await model.run(selection: prompt.selection, values: values) }
            }
        }
        .alert(Logic.t("snip.nameLabel"), isPresented: $naming) {
            TextField(Logic.t("snip.namePlaceholder"), text: $name)
            Button(Logic.t("common.cancel"), role: .cancel) {}
            Button(Logic.t("ios.snip.saveButton")) { save() }
        }
        .alert(saved ?? "", isPresented: Binding(get: { saved != nil }, set: { if !$0 { saved = nil } })) {
            Button("OK") { saved = nil }
        }
        .task(id: AppNavigation.shared.pending?.id) { take() }
        .task(id: model.session.connId) { await model.loadTables() }
        .task(id: model.text) {
            // Describe the tables typed so far, once the typing pauses, and
            // not under an open cursor (it would be the connection's next query).
            do { try await Task.sleep(for: .milliseconds(600)) } catch { return }
            if !model.cursor { await model.describeMentioned() }
        }
        .onDisappear { model.close() }
    }

    /// Runs at once, or first asks for the variables, filled in with the
    /// values they had last time.
    private func start() {
        let variables = model.variables(selection: selection)
        if variables.isEmpty {
            Task { await model.run(selection: selection) }
        } else {
            asking = VariablePrompt(variables: variables, selection: selection, values: SnippetStore.shared.values)
        }
    }

    /// A query handed over by the Snippets tab.
    private func take() {
        guard let pending = AppNavigation.shared.pending else { return }
        AppNavigation.shared.pending = nil
        model.text = pending.text
        selection = NSRange(location: 0, length: 0)
        if pending.run { start() }
    }

    private func save() {
        do {
            if let snippet = try SnippetStore.shared.add(name: name, body: model.target(selection)) {
                saved = Logic.t("ios.snip.saved", ["name": snippet.name])
            }
        } catch {
            saved = "\(error)"
        }
    }
}

/// The variables of a run and where it runs from.
struct VariablePrompt: Identifiable {
    let id = UUID()
    let variables: [SqlVariable]
    let selection: NSRange
    /// What each one had last time.
    let values: [String: VarValue]
}

/// One field per variable, as desktop's dialog: `:nombre` is a value (a number
/// goes unquoted, NULL is a switch), `${nombre}` is text written in as typed.
struct VariablesSheet: View {
    let prompt: VariablePrompt
    let run: ([String: VarValue]) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var values: [String: VarValue]

    init(prompt: VariablePrompt, run: @escaping ([String: VarValue]) -> Void) {
        self.prompt = prompt
        self.run = run
        _values = State(initialValue: prompt.values.filter { key, _ in prompt.variables.contains { $0.token == key } })
    }

    private var missing: Bool {
        !((try? Logic.shared.missingVariables(prompt.variables, values: values))?.isEmpty ?? false)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach(prompt.variables, id: \.token) { v in field(v) }
                } footer: {
                    Text(Logic.t("ios.vars.hint"))
                }
            }
            .navigationTitle(Logic.t("vars.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(Logic.t("common.cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(Logic.t("ios.query.run")) {
                        let given = values
                        dismiss()
                        run(given)
                    }
                    .disabled(missing)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func field(_ v: SqlVariable) -> some View {
        let value = values[v.token] ?? VarValue(text: "")
        let isNull = value.isNull == true
        return VStack(alignment: .leading, spacing: 6) {
            Text(v.token).font(Theme.mono(12).weight(.semibold))
            HStack {
                TextField(Logic.t(v.kind == "raw" ? "vars.rawHint" : "vars.valueHint"),
                          text: Binding(get: { value.text },
                                        set: { values[v.token] = VarValue(text: $0, isNull: isNull ? true : nil) }))
                    .font(Theme.mono())
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .disabled(isNull)
                if v.kind == "value" {
                    Toggle(Logic.t("ios.vars.null"), isOn: Binding(
                        get: { isNull },
                        set: { values[v.token] = VarValue(text: value.text, isNull: $0 ? true : nil) }))
                        .toggleStyle(.button)
                        .font(Theme.mono(11))
                }
            }
        }
    }
}

/// The SQL editor: a UITextView coloured by sqlEditor.ts, with a bar above the
/// keyboard holding the completions first and then SQL keys.
struct SQLEditor: UIViewRepresentable {
    @Binding var text: String
    @Binding var selection: NSRange
    let engine: String
    let suggest: (String, Int) -> (from: Int, items: [String])

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UITextView {
        let tv = UITextView()
        tv.delegate = context.coordinator
        tv.font = Theme.monoUI()
        tv.autocapitalizationType = .none
        tv.autocorrectionType = .no
        tv.spellCheckingType = .no
        tv.smartQuotesType = .no
        tv.smartDashesType = .no
        tv.smartInsertDeleteType = .no
        tv.keyboardType = .asciiCapable
        tv.backgroundColor = .secondarySystemBackground
        tv.layer.cornerRadius = 8
        tv.textContainerInset = UIEdgeInsets(top: 10, left: 6, bottom: 10, right: 6)
        tv.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        tv.inputAccessoryView = context.coordinator.bar
        tv.accessibilityIdentifier = "sql-editor"
        tv.text = text
        context.coordinator.textView = tv
        context.coordinator.highlight()
        return tv
    }

    func updateUIView(_ tv: UITextView, context: Context) {
        context.coordinator.parent = self
        guard tv.text != text else { return }
        context.coordinator.updating = true
        tv.text = text
        context.coordinator.highlight()
        context.coordinator.updating = false
    }

    @MainActor
    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: SQLEditor
        weak var textView: UITextView?
        var updating = false
        let bar = KeyBar()
        private var from = 0
        private var shown: [String] = []

        init(_ parent: SQLEditor) {
            self.parent = parent
            super.init()
            bar.onKey = { [weak self] key in self?.insert(key) }
            bar.onSuggestion = { [weak self] item in self?.complete(item) }
        }

        func textViewDidChange(_ tv: UITextView) {
            parent.text = tv.text
            highlight()
            refreshSuggestions()
        }

        func textViewDidChangeSelection(_ tv: UITextView) {
            guard !updating else { return }
            parent.selection = tv.selectedRange
            refreshSuggestions()
        }

        /// Colours the whole text again: a phone's queries are short.
        func highlight() {
            guard let tv = textView, tv.markedTextRange == nil else { return }
            let base: [NSAttributedString.Key: Any] = [.font: Theme.monoUI(), .foregroundColor: UIColor.label]
            let storage = tv.textStorage
            let spans = (try? Logic.shared.highlightSql(tv.text, engine: parent.engine)) ?? []
            storage.beginEditing()
            storage.setAttributes(base, range: NSRange(location: 0, length: storage.length))
            for span in spans where span.end <= storage.length && span.start < span.end {
                storage.addAttribute(.foregroundColor, value: Self.color(span.kind),
                                     range: NSRange(location: span.start, length: span.end - span.start))
            }
            storage.endEditing()
            tv.typingAttributes = base
        }

        static func color(_ kind: String) -> UIColor {
            switch kind {
            case "keyword": return Theme.accentUI
            case "string": return .systemGreen
            case "number": return .systemOrange
            case "comment": return .secondaryLabel
            case "variable": return .systemPink
            default: return .label
            }
        }

        private func refreshSuggestions() {
            guard let tv = textView else { return }
            var items: [String] = []
            if tv.selectedRange.length == 0 {
                let r = parent.suggest(tv.text, tv.selectedRange.location)
                from = r.from
                items = r.items
            }
            guard items != shown else { return }
            shown = items
            bar.show(suggestions: items)
        }

        /// A word key goes in with a space after it; a symbol as it is.
        private func insert(_ key: String) {
            textView?.insertText(key.first?.isLetter == true ? key + " " : key)
        }

        /// Replaces the word being typed with `item`.
        private func complete(_ item: String) {
            guard let tv = textView else { return }
            let cursor = tv.selectedRange.location
            guard from <= cursor else { return }
            tv.selectedRange = NSRange(location: from, length: cursor - from)
            tv.insertText(item)
        }
    }
}

/// The bar above the keyboard: completions (in the accent colour), then the
/// SQL keys a phone keyboard buries under two taps.
final class KeyBar: UIInputView {
    static let keys = ["SELECT", "FROM", "WHERE", "AND", "=", "*", "'", "(", ")", ",", ";", ":",
                       "ORDER BY", "GROUP BY", "JOIN", "LIKE", "IS NULL", "<", ">"]

    var onKey: (String) -> Void = { _ in }
    var onSuggestion: (String) -> Void = { _ in }
    private let stack = UIStackView()

    init() {
        super.init(frame: CGRect(x: 0, y: 0, width: 320, height: 46), inputViewStyle: .keyboard)
        let scroll = UIScrollView()
        scroll.showsHorizontalScrollIndicator = false
        scroll.translatesAutoresizingMaskIntoConstraints = false
        stack.axis = .horizontal
        stack.spacing = 6
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(scroll)
        scroll.addSubview(stack)
        NSLayoutConstraint.activate([
            scroll.leadingAnchor.constraint(equalTo: leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: trailingAnchor),
            scroll.topAnchor.constraint(equalTo: topAnchor),
            scroll.bottomAnchor.constraint(equalTo: bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 8),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -8),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 7),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -7),
            stack.heightAnchor.constraint(equalTo: scroll.frameLayoutGuide.heightAnchor, constant: -14),
        ])
        accessibilityLabel = Logic.t("ios.query.keys")
        show(suggestions: [])
    }

    required init?(coder: NSCoder) { fatalError("KeyBar is built in code") }

    func show(suggestions: [String]) {
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        for item in suggestions {
            stack.addArrangedSubview(button(item, accent: true) { [weak self] in self?.onSuggestion(item) })
        }
        for key in Self.keys {
            stack.addArrangedSubview(button(key, accent: false) { [weak self] in self?.onKey(key) })
        }
    }

    private func button(_ title: String, accent: Bool, action: @escaping () -> Void) -> UIButton {
        var config: UIButton.Configuration = accent ? .filled() : .gray()
        if accent { config.baseBackgroundColor = Theme.accentUI }
        config.title = title
        config.contentInsets = NSDirectionalEdgeInsets(top: 4, leading: 10, bottom: 4, trailing: 10)
        config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
            var a = attributes
            a.font = Theme.monoUI(13)
            return a
        }
        return UIButton(configuration: config, primaryAction: UIAction { _ in action() })
    }
}
