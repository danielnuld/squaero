# Squaero M14 redesign — brief and conventions for every artboard

We are prototyping the NEW interface of Squaero (desktop DB client), not the current one. Every screen of the app is redesigned with ONE new layout and component language; four visual styles (B · Nativo — default, A · Quiet pro, C · Editorial, Rosa pastel) are themes over it, switchable with the `theme` tweak.

Use the real app only as the source of FUNCTION and CONTENT (what each screen does, its fields, data, labels in Spanish): screenshots `…\scratchpad\screens\<id>.png`, `inventory.md`. Then design it the new way below. Don't copy the old look (pill buttons with borders everywhere, ALL-CAPS labels, monospace bold grid, 12 unlabeled icons, etc.).

Folder (write here, `.body` files only): `docs/design/m14/redesign\bodies\`
Build: `python docs/design/m14/redesign\build.py Name1 Name2 …` assembles `bodies/<Name>.body` into `project/<Name>.dc.html` with the shared head + theme helmet. Body format (see `bodies/DataGrid.body`): line 1 = page title; then the markup; a line `---PROPS---`; one line of data-props JSON; a line `---JS---`; the `class Component extends DCLogic {…}`.

READ FIRST: `bodies/DataGrid.body` (the reference screen), the shared components `bodies/TitleBar.body, Rail.body, Explorer.body, DocTabs.body, StatusBar.body, Grid.body, SqlEditor.body`, `theme-helmet.txt` (the CSS variables and utility classes you must use), `icons.md` (the icon set). Do not edit shared components or the helmet; if you need something they lack, draw it in your screen and report it.

## The new layout (every full-window screen, 1280×800)
```
<div class="th th-{{theme}}" style="width: 1280px; height: 800px; display: flex; flex-direction: column; overflow: hidden; position: relative; background: var(--chrome)">
  <dc-import name="TitleBar" theme="{{theme}}" hint-size="1280px,38px"></dc-import>      ← app menu + Ctrl K search + notifications
  <div style="flex: 1; min-height: 0; display: flex">
    <dc-import name="Rail" theme="{{theme}}" active="…" height="738px" hint-size="64px,738px"></dc-import>   ← labelled tool rail
    <dc-import name="Explorer" theme="{{theme}}" … height="738px" hint-size="248px,738px"></dc-import>   ← connection + db + filter + tree
    <main style="flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--content); border-radius: var(--content-radius); border-top: var(--content-edge); border-left: var(--content-edge); overflow: hidden">
      <dc-import name="DocTabs" theme="{{theme}}" tabs="{{tabs}}" hint-size="100%,36px"></dc-import>
      DOCUMENT TOOLBAR (44px) · document body · optional footer (32px)
    </main>
  </div>
  <dc-import name="StatusBar" theme="{{theme}}" conn="…" db="…" info="a · b · c" hint-size="1280px,24px"></dc-import>
  overlays (menus, popovers, dialogs, toasts, palettes) — absolutely positioned here
</div>
```
Screens that are not tied to a connection (welcome, settings, connections manager) may hide the Explorer (`state="none"` shows its empty state) — or for Settings replace the Explorer column with the settings category list (same 248px column, `background: var(--chrome)`), since Settings is a document of its own.

Component props:
- TitleBar: theme, notif (int, badge on the bell), placeholder, menuOpen ("Archivo"|"Editar"|…|"Herramientas" highlights that menu while you draw its dropdown below it).
- Rail: theme, active (explorer|history|snippets|search|er|monitor|tools|plug|settings|""), disabled (no connection), height.
- Explorer: theme, state (none|connected), tree (db|tables|expanded), selected (row label), filter, connName ("Ventas" default; "Producción (PostgreSQL)", "Producción (MySQL)" switch engine badge/db), safe (read-only lock), tx (TX chip), height.
- DocTabs: theme, tabs `[{label, kind: query|table|view|tool|settings, active, dirty, href}]`, overflow (int).
- StatusBar: theme, conn ("" = Sin conexión), db, tx (e.g. "Transacción · 1 sentencia"), safe, info ("12 filas · 7 columnas · 20 ms", split on " · ").
- Grid: theme, columns `[{name, type, kind: num|text|date|bool, w, key, sort, filter}]`, rows (array of arrays, null = NULL pill), filters (show the per-column filter row), checks (row checkboxes instead of numbers), marked (row indices), selected {r,c}, edited `[{r,c,old}]`, rowState `{index: 'added'|'removed'|'changed'}`, typeColors, density, height, label. Wrap it in a sized box (`flex: 1; min-height: 0`) and pass height="100%".
- SqlEditor: theme, sql (string, \n lines), current (current line), caretLine, errorWord (wavy underline), selectLines ("2,3"), height.

## Design language (apply consistently)
- Hierarchy by weight/tone, not boxes. Sentence case everywhere (never ALL CAPS; small section labels use class `lbl`, which turns lowercase in style C by itself).
- Buttons: `class="btn"` (secondary), `btn btn-primary` (the ONE main action of a view), `btn btn-ghost` (toolbar actions with icon + label), `btn btn-icon` (icon only, needs aria-label), `btn btn-danger`. Segmented choices: `class="seg"` with `.on`. Fields: `class="field"` (+ `is-focus` to show focus). Keys: `class="kbd"`. Chips: `class="chip"` with a soft bg (e.g. `background: var(--accent-soft); color: var(--accent-text)`).
- Document toolbar (44px, border-bottom): primary action first (Editar for a table, ▶ Ejecutar for a query, the wizard's main verb…), then ghost buttons with icon+label grouped by separators, then `flex: 1`, then rarely-used actions collapsed into "Más ⋯" (a menu). Never more than ~7 visible actions.
- Menus/popovers: `class="menu"` box with `.mi` items (`.mi.on`, `.mi.dis`, `.mi.danger`, `.k` for the shortcut), `.msep` separators.
- Dialogs: ONE pattern — `.dlg-scrim` > `.dlg` (width 440–720) with `.dlg-h` (title + close icon button), `.dlg-b` body, `.dlg-f` footer: secondary left-aligned helpers, then `flex: 1`, then buttons right-aligned in Windows order: [Primary] [Cancelar]. Enter/Esc hints optional with `.kbd`.
- Wizards (import, transfer, schema/data sync, generator, backup): open as a document tab (tool kind) with a step header: numbered steps `1 Origen › 2 Columnas › 3 Revisar` (current step accent, done steps with check), body as a form with labels left (fixed 160px column) and fields right, consistent widths, and a footer bar (border-top, 52px) with [Atrás] … [Siguiente/Importar primary] [Cancelar].
- Forms: label column 160px, field max-width 360px, help text `var(--text-dim)` 12px under the field, groups separated by `lbl` headings and 24px spacing.
- Grid: always the shared Grid component (UI font, numbers right-aligned tabular mono, NULL as a pill, subtle type dot in the header, zebra, accent selection). Per-column filters are hidden by default (toolbar toggle "Filtros por columna").
- Empty states: short title + one sentence + one primary action, no illustrations; secondary suggestions as plain links.
- Notifications: toasts bottom-right (`class="toast"`) with an icon, a title line and a detail line, and the bell in the TitleBar keeps a history (Notifications screen).
- Status bar: only connection · db · transaction/safety chips on the left, facts on the right. Settings/help/theme are NOT in the status bar any more (they live in the Rail, the menu and Settings).
- Colours ONLY through the variables in theme-helmet.txt (`--chrome --chrome-2 --content --surface --overlay --border --border-strong --text --text-dim --text-faint --accent --accent-fg --accent-text --accent-soft --hover --sel --zebra --danger(-fg/-soft) --warn(-soft) --ok(-soft) --null --type-dot-* --syntax-* --obj-*`), radii `--r-sm --r-md --r-lg`, fonts `--font-ui --font-mono`, sizes `--fs-xs..xl`, heights `--h-row --h-control --h-bar --h-tabs`, shadows `--shadow-sm --shadow-lg`, `--scrim`.
- Icons: inline SVG from icons.md only (stroke, currentColor, aria-hidden). No emoji.

## Format rules (fail silently if broken)
- Holes `{{x}}` are dotted lookups only; compute in renderVals (per-item `style` strings). `<sc-for list="{{…}}" as="x" hint-placeholder-count="N">`, `<sc-if value="{{flag}}" hint-placeholder-val="{{ true }}">`; never `{{!x}}`.
- Never put `<sc-if>`/`<sc-for>` INSIDE an `<svg>`: wrap whole `<svg>` elements instead.
- Close every element, quote every attribute; no innerHTML; no global key handlers; real `<a href>`/`<button>`/`<input>`+`<label>`; aria-label on icon-only controls.
- Links between screens: `<a href="Other.dc.html" class="btn …">` (style the a; no button inside an a). Closing a menu/dialog links back to its base screen. You may link to any file in the full list below.
- data-props: `"theme":{"editor":"enum","options":["b","a","c","rosa"],"default":"b"}` + `"$preview":{"width":1280,"height":800}`; extra tweaks only for real behavioural switches.
- An overlay screen may import its base screen whole (`<dc-import name="DataGrid" theme="{{theme}}" hint-size="1280px,800px">` inside an absolutely positioned 1280×800 box) and draw the overlay on top.

Spanish copy: keep the app's real labels where they still fit; improve wording where the old one was awkward (sentence case, no ALL CAPS). Data: the same fixtures (Ventas: clientes, productos, pedidos, detalle_pedido; vista ventas_por_ciudad; trigger trg_pedidos_total; "Ventas copia"; "Producción" read-only). Tools that SQLite cannot do: show them populated on "Producción (PostgreSQL)" (users & grants on "Producción (MySQL)").

Do NOT publish, do NOT touch the git repo, do NOT render or re-read to verify. Run build.py for your files at the end (it must print "built X" for each). Reply with a table: file | title | what changed vs. the current app (one line) | notes/needs.

## Full list of screens (group) — file names
[shell] Welcome, ConnectionSearch, ConnectedNoTab, RestoreSessionPrompt, ConnectionForm (tweak engine: postgres|sqlite|mysql|mssql|informix|mongodb), ConnectionFormAdvanced, ConnectionManager, SafeModeReadonly, ObjectTreeFiltered, TreeContextMenu, TreeDbContextMenu, ToolsMenu, TabContextMenu, DropdownOpen, Notifications (NEW: bell panel with history)
[data] DataGrid (DONE — reference), ViewData, GridColumnFilter, DataFilterCondition, DataFilterSql, GridContextMenu, GridContextMenuFk, GridEditMode, GridPendingChanges, GridRowActionBar, RowDetail, FkBrowser, RelatedData, GridTransposed, PinnedResult, CompareMenu, ResultCompare, Chart, ExportMenu, SyncMenu
[editor] EditorEmpty, EditorAutocomplete, EditorFind, EditorResult, EditorDmlResult, EditorError, EditorMultipleResults, TxControlsMenu, TxManualPending, VariablesDialog, SnippetSaveInline, ExplainPlan, ExplainPlanTable, EditorRecentQueries, HistoryPanel, SnippetsPanel, SnippetsTool, LocalHistory
[wizards] ImportWizard, ImportWizardClipboard, ImportWizardMapping, DataGenerator, TransferWizard, TransferWizardResult, SchemaSync, SchemaSyncResult, DataDiff, DataDiffResult, ObjectList, StructureView, DdlView, TableDesigner, NewTableDesigner, IndexManager, ConfirmDrop
[tools] Notebook, QueryBuilder, ErDiagram, Routines, Triggers, ServerMonitor, SlowQueries, UsersGrants, BackupRestore, DataSearch, DataSearchResults
[overlays] CommandPalette, CommandPaletteSearch, ObjectPalette, SnippetPalette, ShortcutsHelp, SettingsGeneral, SettingsAppearance (theme cards for the 4 styles + the built-in themes; picking a style switches the artboard live via state), SettingsEditor, SettingsGrid, SettingsQueries, SettingsShortcuts, SettingsWindow, SettingsAbout

Editor screens: the editor document = DocTabs, then a run toolbar (▶ Ejecutar primary + scope split "Selección/Todo", Formatear, Plan, transaction segmented "Auto | Manual", Más ⋯), then SqlEditor, then a resizable splitter, then a results panel with its own header tabs ("Resultado · 8 filas · 11 ms", "Mensajes", "Plan") and a compact result toolbar, then the Grid.
