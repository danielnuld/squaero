// The Snippets tab (issue #578, task 6.2): saved queries, searched by name or
// by what they do (snippets.ts' searchSnippets). A tap runs one in Consultas,
// asking for its variables first; a long press opens it without running,
// renames or deletes it.

import SquaeroLogic
import SwiftUI

struct SnippetsView: View {
    @State private var search = ""
    @State private var renaming: Snippet?
    @State private var newName = ""
    @State private var failure: String?

    private var store: SnippetStore { .shared }

    var body: some View {
        NavigationStack {
            List {
                let list = store.search(search)
                if !list.isEmpty {
                    Section {
                        ForEach(list) { snippet in row(snippet) }
                    } footer: {
                        Text(Logic.t("ios.snip.openHint"))
                    }
                }
            }
            .overlay {
                if store.snippets.isEmpty {
                    ContentUnavailableView(Logic.t("ios.tab.snippets"), systemImage: "curlybraces",
                                           description: Text(Logic.t("snip.paletteEmptySet")))
                } else if store.search(search).isEmpty {
                    ContentUnavailableView.search(text: search)
                }
            }
            .searchable(text: $search, prompt: Logic.t("snip.searchPlaceholder"))
            .navigationTitle(Logic.t("ios.tab.snippets"))
            .alert(Logic.t("snip.renameLabel"), isPresented: Binding(get: { renaming != nil },
                                                                      set: { if !$0 { renaming = nil } })) {
                TextField(Logic.t("snip.namePlaceholder"), text: $newName)
                Button(Logic.t("common.cancel"), role: .cancel) { renaming = nil }
                Button(Logic.t("snip.rename")) {
                    if let id = renaming?.id { attempt { try store.rename(id, to: newName) } }
                    renaming = nil
                }
            }
            .alert(failure ?? "", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
                Button("OK") { failure = nil }
            }
        }
    }

    private func row(_ snippet: Snippet) -> some View {
        Button {
            AppNavigation.shared.openQuery(snippet.body, run: true)
        } label: {
            VStack(alignment: .leading, spacing: 3) {
                Text(snippet.name).font(.body.weight(.semibold)).foregroundStyle(.primary)
                Text(snippet.body).font(Theme.mono(12)).foregroundStyle(.secondary).lineLimit(2)
            }
        }
        .contextMenu {
            Button { AppNavigation.shared.openQuery(snippet.body, run: false) } label: {
                Label(Logic.t("snip.open"), systemImage: "square.and.pencil")
            }
            Button { newName = snippet.name; renaming = snippet } label: {
                Label(Logic.t("snip.rename"), systemImage: "pencil")
            }
            Button(role: .destructive) { attempt { try store.remove(snippet.id) } } label: {
                Label(Logic.t("snip.remove"), systemImage: "trash")
            }
        }
        .swipeActions {
            Button(role: .destructive) { attempt { try store.remove(snippet.id) } } label: {
                Label(Logic.t("snip.remove"), systemImage: "trash")
            }
        }
    }

    private func attempt(_ action: () throws -> Void) {
        do { try action() } catch { failure = "\(error)" }
    }
}
