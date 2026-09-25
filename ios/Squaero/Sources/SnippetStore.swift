// Snippets and the values of their variables (issue #578, task 6.2): saved
// queries as JSON in Application Support, managed by desktop's snippets.ts, and
// the value last given to each `:nombre` or `${nombre}`, so the next run asks
// with it already filled in. Neither holds a secret.

import Foundation
import Observation
import SquaeroLogic

@MainActor
@Observable
final class SnippetStore {
    static let shared = SnippetStore()

    private(set) var snippets: [Snippet] = []
    /// The value last given to each variable, by token (":sala", "${tabla}").
    private(set) var values: [String: VarValue] = [:]
    /// Why the last load or save failed.
    var lastError: String?

    private let directory: URL

    init(directory: URL = ConnectionStore.defaultDirectory) {
        self.directory = directory
        load()
    }

    private var snippetsFile: URL { directory.appendingPathComponent("snippets.json") }
    private var valuesFile: URL { directory.appendingPathComponent("variables.json") }

    func load() {
        if let data = try? Data(contentsOf: snippetsFile) {
            snippets = (try? Logic.shared.parseSnippets(String(decoding: data, as: UTF8.self))) ?? []
        }
        if let data = try? Data(contentsOf: valuesFile) {
            values = (try? JSONDecoder().decode([String: VarValue].self, from: data)) ?? [:]
        }
    }

    func search(_ query: String) -> [Snippet] {
        (try? Logic.shared.searchSnippets(snippets, query: query)) ?? snippets
    }

    /// Saves `body` under `name`, or under "name (2)" when that one is taken:
    /// saving never overwrites another snippet. Nil for a blank name or body.
    @discardableResult
    func add(name: String, body: String) throws -> Snippet? {
        let unique = try Logic.shared.uniqueSnippetName(snippets, name: name)
        let list = try Logic.shared.addSnippet(snippets, name: unique, body: body)
        guard list.count > snippets.count else { return nil }
        try write(list)
        return list.last
    }

    func rename(_ id: String, to name: String) throws {
        try write(try Logic.shared.renameSnippet(snippets, id: id, name: name))
    }

    func remove(_ id: String) throws {
        try write(try Logic.shared.removeSnippet(snippets, id: id))
    }

    /// Keeps `given` for next time, over what was remembered before.
    func remember(_ given: [String: VarValue]) throws {
        let merged = values.merging(given) { _, new in new }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(merged).write(to: valuesFile, options: .atomic)
        values = merged
    }

    private func write(_ list: [Snippet]) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data(try Logic.shared.serializeSnippets(list).utf8).write(to: snippetsFile, options: .atomic)
        snippets = list
    }
}

/// Which tab is showing, and a query another tab hands to Consultas.
@MainActor
@Observable
final class AppNavigation {
    static let shared = AppNavigation()

    enum Tab: Hashable { case connections, queries, snippets, settings }

    /// SQL for the editor; `run` runs it as soon as Consultas takes it.
    struct PendingQuery: Equatable {
        let id = UUID()
        var text: String
        var run: Bool
    }

    var tab = Tab.connections
    var pending: PendingQuery?

    /// Opens `text` in Consultas, running it when `run`.
    func openQuery(_ text: String, run: Bool) {
        pending = PendingQuery(text: text, run: run)
        tab = .queries
    }
}
