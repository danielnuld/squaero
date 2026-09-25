// Exporting a result from the phone (issue #578, tasks 6.3 and 6.4): the six
// formats of desktop's exporters (through JavaScriptCore), every row or only
// the ones on screen, an editable file name that follows the format, and the
// file saved to Files or handed to the share sheet. Every row means reading on
// from the open cursor (query.next), never re-running the query.

import SquaeroLogic
import SwiftUI
import UIKit

/// A result that can be exported: a table's rows or a query's.
@MainActor
protocol ExportSource: AnyObject {
    var columns: [ResultColumn] { get }
    var rows: [[String?]] { get }
    /// More rows wait in the cursor (or past the offset).
    var more: Bool { get }
    var failure: String? { get }
    /// The INSERT target, the XLSX sheet and the file's default name.
    var exportTable: String { get }
    /// Reads the next page onto `rows`.
    func page() async
}

extension RowPager: ExportSource {
    var exportTable: String { object.name }
}

extension QueryModel: ExportSource {
    var exportTable: String {
        ((try? Logic.shared.proposedSnippetName(lastRunSql, engine: engine)) ?? nil) ?? Logic.t("snip.fallbackName")
    }
}

/// Builds the file. Kept apart from the sheet so it can be tested without one.
@MainActor
@Observable
final class Exporter {
    /// Excel's last row, less the header (xlsx.ts' XLSX_MAX_ROWS).
    static let xlsxMaxRows = 1_048_575

    let source: any ExportSource
    let formats: [String]
    private(set) var format = "csv"
    var name: String
    /// Every row, read from the cursor; else only those on screen.
    var allRows = true
    private(set) var busy = false
    private(set) var failure: String?
    /// What the last file holds, read back from it.
    private(set) var done: String?

    init(source: any ExportSource) {
        self.source = source
        formats = (try? Logic.shared.sheetFormats()) ?? SquaeroLogic.formats
        name = (try? Logic.shared.nameForFormat(source.exportTable, format: "csv")) ?? "export.csv"
    }

    /// Another format: the name's extension changes with it.
    func setFormat(_ format: String) {
        self.format = format
        name = (try? Logic.shared.nameForFormat(name, format: format)) ?? name
    }

    var formatDescription: String { Logic.t("ios.export.desc.\(format)") }

    private enum ReadError: Error { case failed(String) }

    /// Pages on until the source has no more. A page that did not come
    /// (the list was already reading one) is waited for, not skipped.
    func readAll() async throws {
        while source.more {
            let before = source.rows.count
            await source.page()
            if let failure = source.failure { throw ReadError.failed(failure) }
            if source.rows.count == before { try await Task.sleep(for: .milliseconds(50)) }
        }
    }

    /// Writes the file into a fresh temporary folder and returns it, or nil
    /// with `failure` set.
    func file() async -> URL? {
        busy = true
        defer { busy = false }
        failure = nil
        done = nil
        do {
            let visible = source.rows.count
            if allRows { try await readAll() }
            let rows = allRows ? source.rows : Array(source.rows.prefix(visible))
            if format == "xlsx" && rows.count > Self.xlsxMaxRows {
                failure = Logic.t("export.tooManyForXlsx", ["n": "\(rows.count)", "max": "\(Self.xlsxMaxRows)"])
                return nil
            }
            let data = try Logic.shared.export(ResultSet(columns: source.columns, rows: rows), format: format,
                                               table: source.exportTable)
            let fileName = try Logic.shared.nameForFormat(name, format: format)
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent("export-\(UUID().uuidString)")
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let url = folder.appendingPathComponent(fileName)
            try data.write(to: url, options: .atomic)
            let held = (try? Logic.shared.countExportedRows(format: format, data)) ?? rows.count
            done = Logic.t("ios.export.done", ["n": "\(held)", "file": fileName])
            return url
        } catch ReadError.failed(let message) {
            failure = Logic.t("export.failed", ["reason": message])
        } catch {
            failure = Logic.t("export.failed", ["reason": Logic.readable(error)])
        }
        return nil
    }
}

struct ExportSheet: View {
    @State private var exporter: Exporter
    @State private var moving: URL?
    @State private var sharing: SharedFile?
    @Environment(\.dismiss) private var dismiss

    init(source: any ExportSource) {
        _exporter = State(initialValue: Exporter(source: source))
    }

    private struct SharedFile: Identifiable {
        let id = UUID()
        let url: URL
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker(Logic.t("ios.export.format"),
                           selection: Binding(get: { exporter.format }, set: { exporter.setFormat($0) })) {
                        ForEach(exporter.formats, id: \.self) { Text($0.uppercased()).tag($0) }
                    }
                } footer: {
                    Text(exporter.formatDescription)
                }
                Section(Logic.t("ios.export.rows")) {
                    Picker(Logic.t("ios.export.rows"), selection: $exporter.allRows) {
                        let n = "\(exporter.source.rows.count)"
                        Text(exporter.source.more ? Logic.t("ios.export.all", ["n": n])
                                                  : Logic.t("ios.export.allKnown", ["n": n])).tag(true)
                        Text(Logic.t("ios.export.visible", ["n": n])).tag(false)
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                }
                Section(Logic.t("ios.export.name")) {
                    TextField(Logic.t("ios.export.name"), text: $exporter.name)
                        .font(Theme.mono())
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                Section {
                    Button {
                        Task { moving = await exporter.file() }
                    } label: {
                        Label(Logic.t("ios.export.save"), systemImage: "folder")
                    }
                    Button {
                        Task { if let url = await exporter.file() { sharing = SharedFile(url: url) } }
                    } label: {
                        Label(Logic.t("ios.export.share"), systemImage: "square.and.arrow.up")
                    }
                } footer: {
                    if exporter.busy {
                        Text(Logic.t("ios.export.reading", ["n": "\(exporter.source.rows.count)"]))
                    } else if let failure = exporter.failure {
                        Text(failure).foregroundStyle(.red)
                    } else if let done = exporter.done {
                        Text(done)
                    }
                }
                .disabled(exporter.busy)
            }
            .navigationTitle(Logic.t("ios.export.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(Logic.t("common.close")) { dismiss() } }
            }
            .fileMover(isPresented: Binding(get: { moving != nil }, set: { if !$0 { moving = nil } }),
                       file: moving) { _ in moving = nil }
            .sheet(item: $sharing) { ShareSheet(url: $0.url) }
        }
    }
}

/// The system share sheet (Mail, AirDrop, any app) for one file.
struct ShareSheet: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
