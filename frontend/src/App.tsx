import {
  For,
  Show,
  Switch,
  Match,
  createMemo,
  createSignal,
  createEffect,
  onMount,
  onCleanup,
  untrack,
  on,
} from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import {
  runQuery,
  queryNext,
  drainQuery,
  drainCursor,
  runStatements,
  type ResultSet,
} from "./utils/query";
import { scriptSets, pickActiveSet, type ScriptSet } from "./utils/scriptRuns";
import {
  cancelQuery,
  connActivity,
  onConnectionLost,
  setSafeModeUi,
  setConnGuard,
  withWriteConsent,
} from "./utils/transport";
import {
  keepAliveDue,
  keepAliveProbe,
  lostInfo,
  mayReconnect,
  retryDelaySec,
  secondsLeft,
} from "./utils/reconnect";
import { confirmListing, guardFor, type SafeModeGuard } from "./utils/safeMode";
import { errorText, describeError } from "./utils/errors";
import {
  openSession,
  closeConnection,
  testConnection,
  listDatabases,
  type ConnFeatures,
} from "./utils/conn";
import {
  findVariables,
  applyVariables,
  missingVariables,
  type SqlVariable,
  type VarValues,
} from "./utils/sqlVariables";
import { VariablesDialog } from "./components/VariablesDialog";
import {
  applyCellColors,
  colorsFor,
  normalizeHex,
  paletteKey,
  withColors,
  type CellColors,
  type CellColorStore,
} from "./utils/cellColors";
import { loadCellColors, saveCellColors } from "./utils/cellColorStore";
import type { CellKind } from "./utils/format";
import {
  addTab,
  emptySession,
  openTool,
  GLOBAL_TOOLS,
  openSnippetTab,
  closeTab,
  closeOtherTabs,
  closeTabsToRight,
  closeTabsForConn,
  cycleTab,
  updateTabSql,
  bindTabConn,
  updateTabVars,
  activeTab,
  objectTabKey,
  findObjectTab,
  setObjectKey,
  worthRestoring,
  restoreConnIds,
  type TabState,
  type QueryTab,
  type ToolTab,
  type Tab,
  type ToolKind,
} from "./utils/tabs";
import { loadWorkspace, saveWorkspace } from "./utils/tabsStore";
import { openContextMenu, type MenuItem } from "./utils/contextMenu";
import { engineFamily } from "./utils/engineFamily";
import { DataFilterBar } from "./components/DataFilterBar";
import {
  addCellCondition,
  applyFilter,
  cellFilterOps,
  cycleSortColumn,
  emptyFilter,
  filterIsDirty,
  filterIsEmpty,
  type FilterState,
} from "./utils/dataFilter";
import { emptyCondition, type ColumnTypes } from "./utils/queryBuilder";
import { autoFocus } from "./utils/autoFocus";
import { errorOffset, runnableStatements, type RunInfo, type RunScope } from "./utils/runScope";
import { copyRows, rowToJson, rowsAsInserts, copyText } from "./utils/rowCopy";
import {
  saveTheme,
  nextTheme,
  applyTheme,
  resolveTheme,
  type ThemePref,
  type ResolvedTheme,
} from "./utils/theme";
import { installHostGuards } from "./utils/hostGuards";
import { setShellTheme, setShellTitle, windowTitle } from "./utils/shell";
import { buildMenuModel, hasShellMenu, onShellMenu, setShellMenu } from "./utils/nativeMenu";
import { detectOs } from "./utils/titleBar";
import { TitleBar } from "./components/TitleBar";
import {
  loadThemeChoice,
  saveThemeId,
  loadCustomThemes,
  saveCustomThemes,
  addCustomTheme,
  removeCustomTheme,
  customThemeId,
  findTheme,
} from "./utils/themeStore";
import { themeCss, type Theme } from "./utils/themeSchema";
import { BUILTIN_THEMES, DEFAULT_THEME_ID } from "./utils/themes";
import {
  displayKeys,
  effectiveShortcuts,
  matchShortcut,
  type ActionId,
  type ShortcutOverrides,
} from "./utils/shortcuts";
import { loadShortcutOverrides, saveShortcutOverrides } from "./utils/shortcutStore";
import type { ConfigBundle } from "./utils/settingsCatalog";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import {
  clampEditorPct,
  clampSidebarWidth,
  EDITOR_PCT_DEFAULT,
  SIDEBAR_DEFAULT,
} from "./utils/layout";
import { applyOrder } from "./utils/gridColumnOrder";
import {
  toggleSection,
  connObjects,
  setConnObjects,
  dropConnObjects,
} from "./utils/sidebarSections";
import {
  buildDsn,
  dsnForDatabaseList,
  nextConnectionId,
  upsertConnection,
  connectionGroups,
  connectionTarget,
  driverSchema,
  setConnectionGroup,
  removeConnection,
  restoreConnection,
  AVAILABLE_DRIVERS,
  type Connection,
} from "./utils/connections";
import { loadConnections, saveConnections } from "./utils/connectionStore";
import { exportConnections, importConnections, summaryText } from "./utils/connectionsIO";
import {
  addHistory,
  clampLimit,
  oneLine,
  recentForEngine,
  timeAgo,
  type HistoryEntry,
} from "./utils/history";
import { formatClock, formatDuration, formatElapsed } from "./utils/duration";
import {
  loadHistory,
  saveHistory,
  loadHistoryLimit,
  saveHistoryLimit,
} from "./utils/historyStore";
import {
  addSnippet,
  nextSnippetId,
  proposedSnippetName,
  uniqueSnippetName,
  renameSnippet,
  updateSnippetBody,
  removeSnippet,
  setSnippetAbbr,
  mergeSnippets,
  parseSnippets,
  serializeSnippets,
  type Snippet,
} from "./utils/snippets";
import { loadSnippets, saveSnippets } from "./utils/snippetStore";
import { BUILTIN_TEMPLATES, resolveTemplates } from "./utils/sqlTemplates";
import { rowHeightFor, type Settings } from "./utils/settings";
import {
  applyTypography,
  gridScale,
  nextZoom,
  prevZoom,
  treeRowHeight,
  typographyVars,
} from "./utils/typography";
import { applyPlan } from "./utils/editApply";
import { idleTx, readsOnly, runInTx, type TxSession, type TxVerb } from "./utils/txMode";
import { TxControls } from "./components/TxControls";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { countText, deleteRowsConfirm, needsTypedName } from "./utils/confirmText";

/** Rows to read from a table's index catalog; one per index, so plenty. */
const UNIQUE_CATALOG_LIMIT = 500;
import {
  findConflicts,
  planPaste,
  type PastePlan,
  type PkMode,
  type RowClipboard,
  type RowSource,
} from "./utils/rowPaste";
import { RowActionBar } from "./components/RowActionBar";
import { PendingRowsBar } from "./components/PendingRowsBar";
import { indexListFor, uniqueSetsFrom } from "./utils/indexes";
import { loadSettings, saveSettings } from "./utils/settingsStore";
import { pushRecent } from "./utils/recentTables";
import type { Command } from "./utils/commandPalette";
import { schemaDescribe, schemaTree, parseTreeRows } from "./utils/schema";
import { objectPreviewQuery, objectCountQuery } from "./utils/pagination";
import {
  pageStep,
  pageHasMore,
  contiguousPages,
  refreshAction,
  refreshBlock,
  rerunnable,
} from "./utils/gridPaging";
import { useDatabaseSql } from "./utils/dbContext";
import {
  describePkColumns,
  describeColumnTypes,
  describeColumnNames,
  runPlanItem,
  hasTransactions,
  txBegin,
  txBeginIfSupported,
  txCommit,
  txCommitIfOpen,
  txRollback,
  txRollbackIfOpen,
} from "./utils/edit";
import {
  emptyPending,
  setCell,
  revertCell,
  revertRow,
  rowChange,
  toggleDelete,
  toggleDeleteRows,
  addInsert,
  addInserts,
  insertBatchOf,
  pkModeOf,
  removeBatch,
  setBatchEmptyAsNull,
  setPkMode,
  setInsertCell,
  removeInsert,
  hasChanges,
  changeCount,
  buildPlan,
  type EditSource,
  type PendingChanges,
} from "./utils/editSession";
import {
  exportChunks,
  mimeFor,
  fileNameFor,
  toInserts,
  type ExportFormat,
} from "./utils/exporters";
import { pickRows } from "./utils/rowSelection";
import { ExportDialog, type ExportChoice } from "./components/ExportDialog";
import { editablePk, engineEdits, queryEditCheck, type EditBlock } from "./utils/queryTarget";
import { tablesInStatement } from "./utils/queryTables";
import { changesCatalog } from "./utils/sqlEffects";
import {
  createMetaCacheStore,
  connFingerprint,
  colsKey,
  type CacheProblem,
  type DdlTargets,
} from "./utils/metaCache";
import { resolveStore } from "./utils/kvStore";
import {
  foreignKeysFor,
  groupForeignKeys,
  parseForeignKeys,
  type ForeignKeyRelation,
} from "./utils/foreignKeys";
import {
  buildLookup,
  fkColumnsOf,
  fkLookupSql,
  FK_CATALOG_LIMIT,
  FK_LOOKUP_LIMIT,
  type FkLookup,
} from "./utils/fkLookup";
import { buildXlsx, XLSX_MAX_ROWS, XLSX_MIME } from "./utils/xlsx";
import { saveText, pickSaveTarget, sqlFileName } from "./utils/download";
import { errorLine } from "./utils/errors";
import type { TreeNode } from "./utils/tree";
import { objectNodeFor } from "./utils/sqlNavigation";
import { definitionFor as routineDefinitionFor } from "./utils/routines";
import { readDefinitionText } from "./utils/treeObjects";
import { runnableRoutineDdl } from "./utils/routineDdl";
import type { ObjectTarget } from "./components/editorNavigation";
import { SqlEditor, type ErrorMark } from "./components/SqlEditor";
import { EditorToolbar } from "./components/EditorToolbar";
import { RunStatus } from "./components/RunStatus";
import { ResultGrid } from "./components/ResultGrid";
import { StatusBar } from "./components/StatusBar";
import { Welcome, ConnectedHome } from "./components/Welcome";
import { loadUsage, recentConnections, saveUsage, touchConnection } from "./utils/recentConnections";
import { Notifications } from "./components/Notifications";
import { loadNotes, pushNote, saveNotes, unreadCount, type NoteLevel, type NoteLog } from "./utils/notifications";
import type { StatusTabKind } from "./utils/statusBar";
import { SettingsPanel } from "./components/SettingsPanel";
import { EmptyState } from "./components/EmptyState";
import { CommandPalette } from "./components/CommandPalette";
import { SlowQueries } from "./components/SlowQueries";
import { ExplainPlan } from "./components/ExplainPlan";
import { UpdateModal } from "./components/UpdateModal";
import { stripeColor } from "./utils/connectionEnv";
import { TOOL_CATALOG, toolUnsupported, toolsByGroup } from "./utils/toolCatalog";
import { sourceLabel } from "./utils/resultFacts";
import { summarizeRange } from "./utils/cellSummary";
import { transposeResult, TRANSPOSE_MAX_ROWS } from "./utils/transpose";
import { compareResults, comparisonView, type ComparisonView } from "./utils/resultCompare";
import { Icon } from "./components/icons";
import { locale, setLocale, t } from "./utils/i18n";
import { currentOs, orderActions } from "./utils/dialog";
import { APP_VERSION } from "./utils/version";
import {
  checkForUpdate,
  loadSkippedVersion,
  saveSkippedVersion,
  type UpdateInfo,
} from "./utils/update";
import { openExternal } from "./utils/openExternal";
import { canInstall, installUpdate } from "./utils/installUpdate";
import { ConnectionBar } from "./components/ConnectionBar";
import { ConnectionManager } from "./components/ConnectionManager";
import { ObjectToolbar, type ObjectView } from "./components/ObjectToolbar";
import { DocTabs } from "./components/DocTabs";
import { Pager } from "./components/Pager";
import { pagerView, parsePageSize, offsetForPageSize, PAGE_SIZE_KEY } from "./utils/pager";
import { paneSize, savePaneSize } from "./utils/paneSizes";
import { Rail } from "./components/Rail";
import { loadSideState, railClick, saveSideState } from "./utils/sidePanel";
import { tabIcon } from "./utils/tabStrip";
import { ResultTabs, type ResultView } from "./components/ResultTabs";
import { ResultMessages } from "./components/ResultMessages";
import { ErrorHints } from "./components/ErrorHints";
import { engineErrorCode, didYouMean } from "./utils/errorHints";
import { editorSchema } from "./utils/sqlEditor";
import { runMessages, appendMessages, type RunMessage } from "./utils/runMessages";
import {
  PinStrip,
  PinNote,
  CompareBar,
  pinLabel,
  type PinnedResult,
} from "./components/PinnedResults";
import { ObjectListView } from "./components/ObjectListView";
import { ConnectionForm } from "./components/ConnectionForm";
import { RelatedData } from "./components/RelatedData";
import { RestorePrompt } from "./components/RestorePrompt";
import {
  relatedCount,
  relatedQueries,
  relatedAvailability,
  relatedSelect,
  relationsForColumn,
  invertRelation,
  RELATED_LIMIT,
  type RelatedQuery,
} from "./utils/relatedData";
import { Notebook } from "./components/Notebook";
import { TreeSkeleton, ObjectTree } from "./components/ObjectTree";
import { StructureView } from "./components/StructureView";
import { ImportWizard } from "./components/ImportWizard";
import { DataGenerator } from "./components/DataGenerator";
import { ServerMonitor } from "./components/ServerMonitor";
import { UserManager } from "./components/UserManager";
import { ChartView } from "./components/ChartView";
import { ErDiagram } from "./components/ErDiagram";
import { QueryBuilder } from "./components/QueryBuilder";
import { RoutineExplorer } from "./components/RoutineExplorer";
import { TriggersExplorer } from "./components/TriggersExplorer";
import { ContextMenu } from "./components/ContextMenu";
import { TableDesigner } from "./components/TableDesigner";
import { IndexManager } from "./components/IndexManager";
import { SchemaSyncWizard } from "./components/SchemaSyncWizard";
import { DataDiffWizard } from "./components/DataDiffWizard";
import { TransferWizard } from "./components/TransferWizard";
import { BackupPanel } from "./components/BackupPanel";
import { DataSearchPanel } from "./components/DataSearchPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { LocalHistoryPanel } from "./components/LocalHistoryPanel";
import {
  recordVersion,
  pruneHistory,
  AUTO_SNAPSHOT_MS,
  MAX_VERSION_CHARS,
  type Retention,
  type TabHistory,
  type VersionReason,
} from "./utils/localHistory";
import { loadLocalHistory, saveLocalHistory } from "./utils/localHistoryStore";
import { SnippetsPanel } from "./components/SnippetsPanel";
import { RowDetail } from "./components/RowDetail";
import { stepRowIndex } from "./utils/rowDetail";

// Per-tab execution state, keyed by tab id.
interface TabResult {
  loading: boolean;
  error: string | null;
  result: ResultSet | null;
  elapsedMs: number | null;
  /** When the last editor run started, epoch ms (issue #643). */
  ranAt?: number;
  /** The SQL of the last fresh run, for «Ver en el historial» (#691). */
  ranSql?: string;
  /** Where that run's writes stand: committed (auto) or in the open transaction. */
  ranTx?: "auto" | "pending";
  /** What the last run executed — selection / statement / document (issue #130). */
  ranScope?: RunScope | null;
  /** When the run in flight started, epoch ms: the result panel's clock (#691). */
  startedAt?: number;
  /** Which statement of a script is running (issue #691). */
  progress?: { n: number; total: number } | null;
  /** The statement that failed, as sent: the editor marks its line (#691). */
  errorSql?: string;
  /** The table this result was read from + its PK, when opened from the tree.
      Present + pk non-empty => the grid is editable. */
  source?: EditSource | null;
  /** Why a query's result got no edit source (issue #718): the toolbar shows
      it on a disabled Editar instead of hiding the edit functions. */
  editBlock?: EditBlock | null;
  /** Offset pagination (issue #134): the SQL that produced this page, the current
      row offset, and the page size — so prev/next re-run the same SQL at a new
      offset. `truncated` on the result means a further page exists. */
  pageSql?: string;
  offset?: number;
  pageSize?: number;
  /** The core still holds an open cursor for this result, so the NEXT page
      continues that execution instead of running the query again (issue #478).
      One cursor per connection: another tab's query drops it, and paging then
      falls back to re-running at an offset. */
  cursor?: boolean;
  /** Pages already fetched for `pageSql`, indexed by page number. Turning back
      is instant, and a cursor only ever moves forward, so going back would
      otherwise mean re-running the query — the very cost this avoids.
      ponytail: grows with the pages visited; drop the oldest if it ever bites. */
  pages?: ResultSet[];
  /** Set when this result is an "open table" preview: paging regenerates the
      preview SQL with a server-side LIMIT/OFFSET (the baked cap otherwise makes
      the core's row-skip pagination return an empty page 2). */
  preview?: { parts: { db?: string; schema?: string; name: string }; engine: string };
  /** A script's statements, one entry each (issue #450), and which one is on
      screen. Absent for a single statement: one result needs no tabs. The fields
      above always mirror the ACTIVE entry, so everything downstream — the grid,
      the toolbar, export, chart — keeps reading one result and is unchanged. */
  sets?: ScriptSet[];
  activeSet?: number;
}

// Per-tab edit-session state (M7). Present only while editing a tab.
interface EditSessionState {
  editing: boolean;
  pending: PendingChanges;
  busy: boolean;
  error: string | null;
  /** Generated SQL statements to confirm; non-null shows the preview dialog. */
  preview: string[] | null;
  /** The pending row whose insert failed on the last apply, or null. */
  failedInsert: number | null;
}

const emptyEdit = (): EditSessionState => ({
  editing: false,
  pending: emptyPending(),
  busy: false,
  error: null,
  preview: null,
  failedInsert: null,
});

// The live connection opened in the core: its core-side connId plus the saved
// connection's display name.
interface ActiveConnection {
  /** The saved connection's id (stable across reconnects). */
  defId: string;
  /** The core session id (changes on reconnect). */
  connId: string;
  name: string;
  driver: string;
  /** Accent color carried from the saved connection, for the bar/tabs. */
  color?: string;
  /** What the engine can do, from conn.open (#668); null = an older core that
      does not say, so nothing is disabled on its account. */
  features?: ConnFeatures | null;
  /** The core said this session is gone (issue #407). The entry is KEPT rather
      than dropped: the tabs bound to it, and what the user was writing in them,
      have to survive a server that went away. Cleared by reconnecting. */
  lost?: boolean;
  /** A fresh session is being opened in its place by itself (issue #676). */
  reconnecting?: boolean;
  /** It just was: said in the bar for a few seconds. */
  reconnected?: boolean;
  /** When the next automatic attempt to reopen a lost session runs (ms), and
      how many have failed so far (R-05). Absent: it waits for the user. */
  retryAt?: number;
  retries?: number;
}


// Rows per round trip when EXPORTING (issue #479). Bigger than a screen's page
// on purpose: the grid pages for the eye, an export pages only to keep any one
// response bounded, and a million rows at the screen's page size is a thousand
// bridge round trips whose latency is the export.
const EXPORT_PAGE = 10_000;

// Rows per piece handed to the file writer. The file is never one string: a
// million rows is past the engine's maximum string length (issue #479).
const EXPORT_CHUNK_ROWS = 2000;

const emptyResult = (): TabResult => ({
  loading: false,
  error: null,
  result: null,
  elapsedMs: null,
  ranAt: undefined,
  // Explicitly cleared, not merely absent: setResults MERGES, so a tab that ran
  // a script and then a single statement would otherwise keep the old strip.
  sets: undefined,
  activeSet: 0,
  editBlock: undefined,
  startedAt: undefined,
  progress: null,
  errorSql: undefined,
});

// A table target (import / generator / diff / transfer / structure).
type EditTarget = { table: string; db?: string; schema?: string };

// Any export the workspace offers: the text formats plus binary XLSX (issue #141).
type AnyExportFormat = ExportFormat | "xlsx";
const EXPORT_FORMATS: { fmt: AnyExportFormat; label: string }[] = [
  { fmt: "csv", label: "CSV" },
  { fmt: "json", label: "JSON" },
  { fmt: "xlsx", label: "Excel" },
  { fmt: "xml", label: "XML" },
  { fmt: "html", label: "HTML" },
  { fmt: "sql", label: "SQL" },
];

// Root layout: resizable sidebar (connection manager) | tabbed workspace
// (editor over result grid), with a status bar across the bottom. Connecting
// opens a real connection in the core; running SQL goes through query.run and
// renders into the virtualized grid — the demonstrable end-to-end path (#17).
export function App() {
  // The workspace comes back from the last session when there is one (issue
  // #401): the query you had not run yet is what a crash or a power cut takes,
  // and the history only keeps what was executed.
  //
  // It is now OFFERED rather than applied (issue #465): coming back is right
  // when you were interrupted and wrong when you have moved on. A saved session
  // worth asking about waits in `pendingRestore` while the app opens with no
  // tab behind the prompt — numbering on from the stored `seq`, so nothing gets
  // a recycled id whichever way the user answers (issue #355).
  const stored = loadWorkspace();
  const [pendingRestore, setPendingRestore] = createSignal<TabState | null>(
    stored && worthRestoring(stored) ? stored : null,
  );
  // «Ahora no» / Esc on that offer (audit R-37, A-36): nothing is thrown away.
  // The saved session stays on disk for the next start until there is new work
  // worth saving in its place.
  const [restoreDeferred, setRestoreDeferred] = createSignal(false);
  const keepsDeferred = (state: TabState) => restoreDeferred() && !worthRestoring(state);
  // Whether or not there is a session to offer, the app opens with no tab, on
  // the welcome screen (issue #694); a saved session comes back only when resumed.
  const [tabs, setTabs] = createSignal<TabState>(emptySession(stored));
  const [results, setResults] = createStore<Record<number, TabResult>>({});
  // The result pane's view per query tab (#691): the result(s), the run
  // messages, or the plan of the statement last explained there.
  const [resultViews, setResultViews] = createStore<Record<number, ResultView>>({});
  const [runLogs, setRunLogs] = createStore<Record<number, RunMessage[]>>({});
  const [planSqls, setPlanSqls] = createStore<Record<number, string>>({});
  const resultView = (tabId: number): ResultView => resultViews[tabId] ?? "result";
  const logRun = (tabId: number, lines: RunMessage[]) =>
    setRunLogs(tabId, (log) => appendMessages(log ?? [], lines));
  // Rows per page, owned by the UI (sent explicitly, not the core default) and
  // remembered (A-20, R-38). Table previews fetch page-by-page with a server-side
  // LIMIT/OFFSET (runPreviewPage); a plain query pages via the core's row-skip
  // offset. Each result keeps the size it was read with (`pageSize`), so a
  // change applies to the next read and never mis-counts an open result's pages.
  const [pageSize, setPageSize] = createSignal(parsePageSize(resolveStore().getItem(PAGE_SIZE_KEY)));
  const [edits, setEdits] = createStore<Record<number, EditSessionState>>({});
  // Foreign-key pickers per tab, column -> referenced table + its candidate rows.
  // Filled when an edit session starts (loadFkLookups) and cleared with the result.
  const [fkLookups, setFkLookups] = createStore<Record<number, Record<string, FkLookup>>>({});
  // Remembered layout (#688): the side column's width, which panel it shows and
  // whether it is folded, and the editor's share of a query tab.
  const [sidebarWidth, setSidebarWidth] = createSignal(
    clampSidebarWidth(paneSize("sidebar", SIDEBAR_DEFAULT)),
  );
  const [side, setSide] = createSignal(loadSideState());
  createEffect(() => saveSideState(side()));
  let sidebarEl: HTMLElement | undefined;
  // How much of a query tab the editor takes (issue #423). Dragged, not fixed:
  // a procedure's definition needs the height that an empty grid was holding.
  const [editorPct, setEditorPct] = createSignal(
    clampEditorPct(paneSize("editorPct", EDITOR_PCT_DEFAULT)),
  );
  // The grid's page search row ("Buscar en la página", #690), driven by the
  // toolbar button and by the grid's own Ctrl+F.
  const [gridSearch, setGridSearch] = createSignal(false);
  let panesEl: HTMLDivElement | undefined;

  const [connections, setConnections] = createSignal<Connection[]>(loadConnections());
  // Several connections can be open at once; `focusedDefId` names the one the
  // object tree and newly-created query tabs bind to. `active`/`activeDefId` are
  // derived views of the focused connection, so most of the app keeps referring
  // to "the current connection" unchanged.
  const [openConns, setOpenConns] = createSignal<ActiveConnection[]>([]);
  const [focusedDefId, setFocusedDefId] = createSignal<string | null>(null);
  const active = () => openConns().find((o) => o.defId === focusedDefId()) ?? null;
  const activeDefId = focusedDefId;
  // Explorer sections the user folded away, by connection id (issue #444).
  const [collapsedSections, setCollapsedSections] = createSignal<Set<string>>(new Set());
  // Anything done in a connection's tree acts on THAT connection: focus it
  // first, then run the handler. `setFocusedDefId` is synchronous, so openData
  // and friends read the new `focusedDefId()` in the same tick — which is why
  // stacking one tree per connection needed no connection argument threaded
  // through every handler (issue #444).
  const inConn =
    <A extends unknown[]>(defId: string, fn: (...args: A) => void) =>
    (...args: A) => {
      setFocusedDefId(defId);
      fn(...args);
    };
  // Title base for a generic new query tab: the connection it will run against
  // ("Ventas 3"), because "Consulta 3" spelled out the only thing the tab could
  // not fail to be, while hiding the one thing worth knowing when several
  // connections are open. Falls back to the generic word with nothing connected.
  const newQueryTitle = () => active()?.name ?? t("toolbar.newQuery.label");
  // The connection a tab runs against: its bound one (if still open), else — for
  // an unbound tab — the focused connection.
  const tabConn = (tab: Tab | undefined): ActiveConnection | null => {
    if (tab && tab.connDefId) {
      return openConns().find((o) => o.defId === tab.connDefId) ?? null;
    }
    return active();
  };
  // The accent color of a tab's bound connection, for the tab strip. Tool tabs
  // carry one too (issue #492): they are per-connection now, so the dot that
  // tells two query tabs apart has to tell two monitors apart as well.
  const tabColor = (tab: Tab): string | undefined =>
    tab.connDefId
      ? connections().find((c) => c.id === tab.connDefId)?.color
      : undefined;
  // Safe mode (issue #666), read live from the SAVED connection so editing its
  // protection takes effect on the open session too (the effect below).
  const safeModeOf = (defId?: string | null) =>
    defId ? connections().find((c) => c.id === defId)?.safeMode : undefined;
  const tabSafeMode = (tab: Tab | undefined) => safeModeOf(tabConn(tab)?.defId);
  createEffect(() => {
    for (const o of openConns()) {
      const c = connections().find((x) => x.id === o.defId);
      if (c) setConnGuard(o.connId, guardFor(c));
    }
  });
  // The confirmation a protected connection asks before writing. One at a
  // time: a second request while one is open is declined rather than queued —
  // two write actions racing on protected connections is not a flow to support.
  // The name a protected connection asks to have typed before a write that
  // loses data (audit A-25, R-15); read from the signal, not from the <Show>
  // accessor, which is stale for an instant while the dialog closes.
  const typedNameFor = (w: { guard: SafeModeGuard; writes: string[] } | null) =>
    w && needsTypedName(w.guard.mode, w.writes) ? w.guard.name : undefined;
  const [writeConfirm, setWriteConfirm] = createSignal<{
    guard: SafeModeGuard;
    writes: string[];
    resolve: (ok: boolean) => void;
  } | null>(null);
  onMount(() =>
    setSafeModeUi({
      confirm: (guard, writes) =>
        new Promise<boolean>((resolve) => {
          if (writeConfirm()) resolve(false);
          else setWriteConfirm({ guard, writes, resolve });
        }),
      blocked: (name) => t("safe.blocked", { name }),
      declined: () => t("safe.declined"),
    }),
  );
  onCleanup(() => setSafeModeUi(null));
  const answerWriteConfirm = (ok: boolean) => {
    writeConfirm()?.resolve(ok);
    setWriteConfirm(null);
  };
  // Working database context: the databases available on the active connection
  // and the one selected. Scopes the ER diagram / query builder and (on engines
  // that allow it) sets the editor's default database via USE.
  const [databases, setDatabases] = createSignal<string[]>([]);
  const [activeDb, setActiveDb] = createSignal<string | null>(null);
  const [connectingId, setConnectingId] = createSignal<string | null>(null);
  // Connect failure shown as a global toast: a failed conn.open must be visible
  // wherever the user is — before this, it was written into the current tab's
  // results, and with no tab open (first connect) it vanished entirely.
  const [connError, setConnError] = createSignal<string | null>(null);
  const [treeReload, setTreeReload] = createSignal(0);
  // Bumped when executed SQL changed the catalog (issue #317): the tree re-lists
  // what is open instead of collapsing, which is what an explicit refresh does.
  const [treeSoftReload, setTreeSoftReload] = createSignal(0);
  const refreshTreeInPlace = () => setTreeSoftReload((n) => n + 1);
  // Introspection cache (issue #675): tree levels and table columns per saved
  // connection, persisted, shown marked "from cache" while re-read. What could
  // not be cached is said once per kind of problem, not swallowed.
  const [cacheNotice, setCacheNotice] = createSignal<string | null>(null);
  // A plain informational toast (issue #694: an import's outcome).
  const [notice, setNotice] = createSignal<string | null>(null);
  const cacheProblems = new Set<CacheProblem>();
  const metaCache = createMetaCacheStore(resolveStore(), (p) => {
    if (cacheProblems.has(p)) return;
    cacheProblems.add(p);
    setCacheNotice(t(p === "tooLarge" ? "cache.tooLarge" : "cache.storage"));
  });
  // An explicit refresh (or a GUI tool that changed the catalog): nothing cached
  // is trusted any more — it is marked stale, then the tree reloads.
  const reloadTree = () => {
    for (const o of openConns()) metaCache.markStale(o.defId);
    setTreeReload((n) => n + 1);
  };
  // Row form/detail view (issue #133): index of the loaded row shown as a form,
  // or null when closed. Navigation walks the loaded rows in original order.
  const [detailIndex, setDetailIndex] = createSignal<number | null>(null);

  // --- Query history (issue #128) ----------------------------------------
  const [history, setHistory] = createSignal<HistoryEntry[]>(loadHistory());
  const [historyLimit, setHistoryLimit] = createSignal(loadHistoryLimit());

  // --- Favorites / snippets (issue #129) ---------------------------------
  const [snippets, setSnippets] = createSignal<Snippet[]>(loadSnippets());
  const [snippetInsert, setSnippetInsert] = createSignal({ text: "", tick: 0 });

  // --- Recently opened tables (issue #178, editor empty state) -----------
  const [recentTables, setRecentTables] = createSignal<TreeNode[]>([]);
  const recordRecent = (node: TreeNode) => setRecentTables((l) => pushRecent(l, node));

  // --- Command palette (issue #174) --------------------------------------
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  // "all" is the full palette (Mod+K); "objects" scopes it to the connection's
  // tables/views (Mod+P), for a quick go-to-object jump.
  const [paletteMode, setPaletteMode] = createSignal<"all" | "objects" | "snippets">("all");
  // The objects each open connection's tree has loaded, keyed by connection id.
  // With one tree per connection in the sidebar (issue #444) a single shared
  // list meant the last tree to finish loading overwrote the autocomplete and
  // the command palette; `focusedObjects` is what the rest of the app reads.
  const [loadedObjects, setLoadedObjects] = createSignal<Record<string, TreeNode[]>>({});
  const focusedObjects = () => connObjects(loadedObjects(), focusedDefId());

  // Bumped by Ctrl/Cmd+F to open the SQL editor's find panel (see SqlEditor).
  const [findTick, setFindTick] = createSignal(0);

  // A run from the toolbar (issue #691): a bumped tick, and the scope picked in
  // the run button's menu (none: what Ctrl/Cmd+Enter would run). The editor
  // reports what that is, so the button can name it.
  const [runRequest, setRunRequest] = createSignal<{ tick: number; scope?: RunScope }>({ tick: 0 });
  const requestRun = (scope?: RunScope) => setRunRequest((r) => ({ tick: r.tick + 1, scope }));
  const [runInfo, setRunInfo] = createSignal<RunInfo>({ hasSelection: false, statement: null, statements: 0 });
  // Bumped by «Ir a la línea» in the result panel: the editor shows the failed line.
  const [revealErrorTick, setRevealErrorTick] = createSignal(0);

  // A newer release found on startup (autoupdater); drives the update modal.
  const [update, setUpdate] = createSignal<UpdateInfo | null>(null);


  // --- User preferences (issue #181) -------------------------------------
  // Theme (above) and the history limit (below) keep their own stores; this
  // holds only the settings owned by settings.ts (density, slow threshold,
  // check-updates-on-start). Patched immutably so the panel stays controlled.
  const [settings, setSettings] = createSignal<Settings>(loadSettings());
  // The user's rebound keys (issue #684): the matcher, the help overlay and the
  // settings editor all read the one effective table.
  const [shortcutOverrides, setShortcutOverridesSignal] = createSignal<ShortcutOverrides>(
    loadShortcutOverrides(),
  );
  const shortcuts = createMemo(() => effectiveShortcuts(shortcutOverrides()));
  const setShortcutOverrides = (o: ShortcutOverrides) => {
    setShortcutOverridesSignal(o);
    saveShortcutOverrides(o);
  };
  const paletteKeys = () =>
    displayKeys(shortcuts().find((sc) => sc.id === "command-palette")?.keys ?? "Mod+K", isMac());
  const patchSettings = (patch: Partial<Settings>) => {
    const next = { ...settings(), ...patch };
    setSettings(next);
    saveSettings(next);
  };

  // --- Theme, shortcuts, help (issue #42) --------------------------------
  const safeStorage = (): Storage | undefined => {
    try {
      return typeof localStorage !== "undefined" ? localStorage : undefined;
    } catch {
      return undefined;
    }
  };
  // One read gives the mode AND the theme id, migrating the old skin key (#680).
  const themeChoice = loadThemeChoice(safeStorage());
  const [theme, setTheme] = createSignal<ThemePref>(themeChoice.mode);

  const prefersDark = () =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  /** The mode on screen (never "system"), as last stamped on the root. */
  const [resolved, setResolved] = createSignal<ResolvedTheme>(
    resolveTheme(themeChoice.mode, prefersDark()),
  );
  // Stamp the resolved mode on the document and tell the shell, so the native
  // title bar changes with it (issue #685).
  const stampMode = () => {
    if (typeof document !== "undefined") {
      const r = applyTheme(theme(), document.documentElement, prefersDark());
      setResolved(r);
      setShellTheme(r);
    }
  };
  const isMac = () =>
    typeof navigator !== "undefined" &&
    /mac/i.test(navigator.platform || navigator.userAgent || "");

  const applyThemePref = (pref: ThemePref) => {
    setTheme(pref);
    saveTheme(pref, safeStorage());
    stampMode();
  };
  const toggleTheme = () => applyThemePref(nextTheme(theme()));

  // The theme (issue #680): built-in or imported, every one with both variants.
  // Its tokens go into a generated <style> block rather than inline on the root,
  // so the per-type cell colour overrides below — which ARE inline — keep
  // winning over the theme, as they did over the stylesheet.
  const [themeId, setThemeId] = createSignal(themeChoice.themeId);
  const [customThemes, setCustomThemes] = createSignal<Theme[]>(loadCustomThemes(safeStorage()));
  const allThemes = () => [...BUILTIN_THEMES, ...customThemes()];
  const setThemeChoice = (id: string) => {
    setThemeId(id);
    saveThemeId(id, safeStorage());
  };
  const importTheme = (t: Theme) => {
    const list = addCustomTheme(customThemes(), t);
    setCustomThemes(list);
    saveCustomThemes(list, safeStorage());
    setThemeChoice(customThemeId(t.id));
  };
  const removeTheme = (id: string) => {
    const list = removeCustomTheme(customThemes(), id);
    setCustomThemes(list);
    saveCustomThemes(list, safeStorage());
    if (themeId() === id) setThemeChoice(DEFAULT_THEME_ID);
  };
  createEffect(() => {
    if (typeof document === "undefined") return;
    let el = document.getElementById("quaero-theme");
    if (!el) {
      el = document.createElement("style");
      el.id = "quaero-theme";
      document.head.appendChild(el);
    }
    el.textContent = themeCss(findTheme(themeId(), customThemes()), resolved());
  });

  // Colours per data type (issue #483). The store holds one set of overrides
  // PER LOOK: a blue that reads on the light theme is invisible on Terminal, so
  // "adapt them between themes" cannot mean carrying one value everywhere.
  const [cellColorStore, setCellColorStore] = createSignal<CellColorStore>(loadCellColors());
  /** The palette the overrides on screen belong to. */
  const palette = () => paletteKey(resolved(), themeId());
  const cellColors = (): CellColors => colorsFor(cellColorStore(), palette());

  // Applied as inline custom properties on the root, so the CSS keeps its own
  // colours as the default and an override is a single value on top — nothing
  // has to know which theme is in force, including the settings panel's swatch.
  createEffect(() => {
    if (typeof document === "undefined") return;
    applyCellColors(document.documentElement.style, cellColors());
  });

  // The switch is an attribute rather than a class swap: one CSS rule then
  // outranks the per-type ones without !important (see styles.css).
  createEffect(() => {
    if (typeof document === "undefined") return;
    if (settings().colorTypes) document.documentElement.removeAttribute("data-cell-colors");
    else document.documentElement.setAttribute("data-cell-colors", "off");
  });

  // The grid's style is an attribute on the root too (issue #540): every visual
  // difference between the three is CSS under `:root[data-grid-style="…"]`, so
  // the component draws ONE structure and there are no three trees to keep in
  // step. What the component does take is the text a cell shows.
  createEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-grid-style", settings().gridStyle);
  });

  // Typography and zoom (issue #681): the type scale, spacing, control heights
  // and the editor's and grid's fonts go inline on the root, the same route as
  // the cell colours, so the stylesheet keeps its values as the default.
  createEffect(() => {
    if (typeof document === "undefined") return;
    applyTypography(document.documentElement.style, typographyVars(settings()));
  });

  /** Set (or, with null, take back) one type's colour for the look in use. */
  const setCellColor = (kind: CellKind, hex: string | null) => {
    const key = palette();
    const current = cellColors();
    const next: CellColors = { ...current };
    const normalized = hex === null ? null : normalizeHex(hex);
    if (normalized === null) delete next[kind];
    else next[kind] = normalized;
    const store = withColors(cellColorStore(), key, next);
    setCellColorStore(store);
    saveCellColors(store);
  };

  /** Give this look its theme colours back. */
  const resetCellColors = () => {
    const store = withColors(cellColorStore(), palette(), {});
    setCellColorStore(store);
    saveCellColors(store);
  };

  /** The mounted filter panel's "add a condition" (#592); one panel at a time. */
  let addFilterCondition: (() => void) | undefined;
  let addFilterSort: (() => void) | undefined;
  const runShortcut = (action: ReturnType<typeof matchShortcut>) => {
    switch (action) {
      case "zoom-in":
        patchSettings({ zoom: nextZoom(settings().zoom) });
        break;
      case "zoom-out":
        patchSettings({ zoom: prevZoom(settings().zoom) });
        break;
      case "zoom-reset":
        patchSettings({ zoom: 100 });
        break;
      case "new-tab":
        setTabs((s) => addTab(s, newQueryTitle(), focusedDefId() ?? undefined));
        break;
      case "close-tab": {
        // NOT `t`: a `const t` here shadows the i18n `t` across the whole switch
        // block, and the earlier cases that call it threw before ever running.
        const tab = current();
        if (tab) setTabs((s) => closeTab(s, tab.id));
        break;
      }
      case "filter-add-condition": {
        // Only a table/view tab has the panel; elsewhere the key does nothing.
        const tab = current();
        if (tab && isDataTab(tab.id)) addFilterCondition?.();
        break;
      }
      case "filter-add-sort": {
        const tab = current();
        if (tab && isDataTab(tab.id)) addFilterSort?.();
        break;
      }
      case "next-tab":
        setTabs((s) => cycleTab(s, 1));
        break;
      case "prev-tab":
        setTabs((s) => cycleTab(s, -1));
        break;
      case "refresh":
        refreshAll();
        break;
      case "cancel-query":
        // Only while the tab's query runs: there is nothing to stop otherwise.
        if (currentResult().loading) cancelActive();
        break;
      case "toggle-theme":
        toggleTheme();
        break;
      case "toggle-help":
        showTool("help", t("status.shortcuts"), { key: "help" });
        break;
      case "command-palette":
        setPaletteMode("all");
        setPaletteOpen((v) => !v);
        break;
      case "object-palette":
        // Always open scoped to objects (a "go to table/view" jump), never a
        // toggle — pressing Ctrl+P should reliably land on the object search.
        setPaletteMode("objects");
        setPaletteOpen(true);
        break;
      case "snippet-palette":
        // Always open scoped to snippets, never a toggle — the same rule as the
        // object palette (issue #320).
        setPaletteMode("snippets");
        setPaletteOpen(true);
        break;
      case "save-snippet":
        requestSaveSnippet();
        break;
      case "save-edits": {
        // Same gate as the toolbar's "Confirmar" button: only while editing,
        // idle, and with something to write. Otherwise the key is swallowed.
        const ed = currentEdit();
        if (ed.editing && !ed.busy && hasChanges(ed.pending)) void confirmEdit();
        break;
      }
      case "editor-find":
        setFindTick((t) => t + 1);
        break;
      case "tx-commit":
        void endTabTx("commit");
        break;
      case "tx-rollback":
        void endTabTx("rollback");
        break;
    }
  };

  // Refresh (issue #107): reload the object tree from the root and re-run the
  // active tab's query. An in-progress edit session is left untouched so a
  // refresh never silently discards pending changes.
  const refreshAll = () => {
    if (!active()) return;
    reloadTree();
    const t = current();
    if (t && !currentEdit().editing) reloadCurrent(t.id);
  };

  // Check GitHub for a newer release once at startup; a hit (that the user has
  // not skipped) opens the update modal. Failures are swallowed in checkForUpdate.
  onMount(() => {
    void (async () => {
      const info = await checkForUpdate(APP_VERSION);
      if (info && info.version !== loadSkippedVersion()) setUpdate(info);
    })();
  });

  onMount(() => {
    stampMode();
    // Follow the OS live while the preference is "system".
    const onSystemChange = () => {
      if (theme() === "system") stampMode();
    };
    const mql =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : undefined;
    mql?.addEventListener?.("change", onSystemChange);

    const onKey = (e: KeyboardEvent) => {
      const action = matchShortcut(e, shortcuts());
      if (!action) return;
      // While the command palette owns the screen, only the palette toggles act;
      // other shortcuts are swallowed (preventDefault, no-op) so the webview host
      // never runs its own find/print behind the overlay.
      if (paletteOpen() && action !== "command-palette" && action !== "object-palette") {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      runShortcut(action);
    };
    document.addEventListener("keydown", onKey);

    // Suppress the native WebView2/Chromium context menu everywhere. We ONLY
    // preventDefault here — we must not close our menu, because Solid delegates
    // `contextmenu` to the document, so this listener shares the node with the
    // surface handlers that just opened a menu (stopPropagation there does not
    // stop a same-node listener). Closing on an outside click is handled by the
    // ContextMenu's own mousedown listener, which fires before this on any
    // right-click (mousedown precedes contextmenu).
    const onNativeMenu = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", onNativeMenu);

    // Paste delimited text over a table's grid to import it (issue #383). The
    // event is what carries the data: reading the clipboard through
    // navigator.clipboard needs a permission the webview may deny outright,
    // while a paste always arrives. Nothing is written to the database here —
    // it opens the import wizard with the text, which previews and maps it
    // first, exactly as a file goes through.
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      const src = currentResult().source;
      if (!src || !active()) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      // Over a table that takes new rows, a paste that fits the grid becomes
      // pending rows (#517); any other shape still goes to the wizard.
      if (currentEditable()) {
        const plan = pastePlanFor(text);
        if (!plan || plan.kind === "none") return;
        e.preventDefault();
        runPastePlan(plan, text);
        return;
      }
      // One value is a cell, not a table: leave it to whatever wanted it.
      if (!text.includes("\t") && !text.includes("\n")) return;
      e.preventDefault();
      openImport(text);
    };
    document.addEventListener("paste", onPaste);

    // What the host would still do as a browser — reload, zoom, navigate to a
    // dropped file — refused here for every engine alike (issue #685).
    const uninstallGuards = installHostGuards(document, isMac());

    onCleanup(() => {
      uninstallGuards();
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("contextmenu", onNativeMenu);
      document.removeEventListener("paste", onPaste);
      mql?.removeEventListener?.("change", onSystemChange);
    });
  });

  // SQL formatting (issue #106): a bumped counter asks the editor to reformat,
  // using the active connection's engine to pick the dialect.
  const [formatTick, setFormatTick] = createSignal(0);
  const activeDialect = createMemo(() => {
    const id = activeDefId();
    if (!id) return "";
    return connections().find((c) => c.id === id)?.driver ?? "";
  });

  // Window title (issues #192, #685): "<tab> — <connection> — Squaero" for what
  // is on screen, pushed to the native title bar through the shell.
  createEffect(() => {
    setShellTitle(windowTitle(current()?.title, active()?.name));
  });

  // Keep the workspace on disk (issue #401). Debounced because the editor emits
  // per keystroke and this serializes every tab; and written as you type rather
  // than on the way out, because the case this exists for — the machine losing
  // power — never reaches an exit handler. One second is short enough that at
  // most a sentence is lost and long enough that typing does not hit storage.
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    const state = tabs();
    // Nothing is written while the restore prompt is up (issue #465): the empty
    // workspace behind it would overwrite the very session being offered, and a
    // machine that dies with the dialog open would take it with no answer given.
    if (pendingRestore() || keepsDeferred(state)) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveWorkspace(state), 1000);
  });
  // A clean close within that second would still lose the last keystrokes, so
  // the window going away flushes what is pending. Both events, because which
  // of them a webview fires on close is not something to bet the buffer on.
  const flushWorkspace = () => {
    metaCache.flush();
    clearTimeout(saveTimer);
    if (pendingRestore()) return; // the offer outlives the window, unanswered
    if (keepsDeferred(tabs())) return;
    saveWorkspace(tabs());
  };
  const onHidden = () => {
    if (document.visibilityState === "hidden") flushWorkspace();
  };
  window.addEventListener("pagehide", flushWorkspace);
  document.addEventListener("visibilitychange", onHidden);
  onCleanup(() => {
    clearTimeout(saveTimer);
    window.removeEventListener("pagehide", flushWorkspace);
    document.removeEventListener("visibilitychange", onHidden);
  });

  // SQL autocomplete schema (issue #110). Table/view NAMES come from the loaded
  // object tree (no IPC), so name completion is instant. COLUMNS are cached
  // lazily as tables are opened (openData describes the table anyway) — we do NOT
  // eagerly describe dozens of tables at connect: on a single-connection engine
  // like Informix that avalanche of schema.describe calls monopolized the
  // connection and left the first table-open "loading" for seconds (issue: the
  // sidebar open hangs). Columns fill in progressively as the user browses.
  const [columnCache, setColumnCache] = createSignal<Record<string, string[]>>({});
  // Names the editor asked to describe and got nothing for (lower case): the
  // only tables the diagnostics may call unknown (#662) — the tree's list alone
  // is not proof, it holds just the branches that were opened.
  const [missingTables, setMissingTables] = createSignal<string[]>([]);
  // Outbound foreign keys of the tables a statement joins, by table: JOIN … ON
  // completes the condition from them (#661).
  const [fkCache, setFkCache] = createSignal<Record<string, ForeignKeyRelation[]>>({});
  // Tables described in this session, by `${connId}:${table}`: each is asked
  // about once; a cached entry not in here is re-described when mentioned.
  const describedColumns = new Set<string>();
  createEffect(() => {
    const conn = active();
    void treeReload(); // a connection switch or refresh clears the cache
    describedColumns.clear();
    // Seeded from the persistent cache (issue #675) — but only entries neither
    // invalidated nor old: the autocomplete has nowhere to say "from cache".
    const seed: Record<string, string[]> = {};
    if (conn) {
      for (const { key, entry } of metaCache.list(conn.defId, colsKey(""))) {
        const v = entry.value;
        if (!entry.stale && Array.isArray(v) && v.every((x) => typeof x === "string")) {
          seed[key.slice(colsKey("").length)] = v;
        }
      }
    }
    setColumnCache(seed);
    setMissingTables([]);
    setFkCache({});
  });
  // A describe's column names, kept for the autocomplete and the cache.
  const rememberColumns = (conn: ActiveConnection, table: string, cols: string[]) => {
    describedColumns.add(`${conn.connId}:${table}`);
    if (conn.defId === focusedDefId()) setColumnCache((c) => ({ ...c, [table]: cols }));
    metaCache.conn(conn.defId).put(colsKey(table), cols);
  };
  // DDL from the editor: drop the columns it may have changed, so they are
  // described again instead of offered as they were.
  const forgetColumns = (conn: ActiveConnection, targets: DdlTargets) => {
    if (targets === null || conn.defId !== focusedDefId()) return;
    if (targets === "all") {
      describedColumns.clear();
      setColumnCache({});
      return;
    }
    const names = new Set(targets.tables.map((n) => n.toLowerCase()));
    setColumnCache((c) => {
      const next = { ...c };
      for (const k of Object.keys(next)) {
        if (!names.has(k.toLowerCase())) continue;
        delete next[k];
        describedColumns.delete(`${conn.connId}:${k}`);
      }
      return next;
    });
  };
  // Columns for the tables the statement being written actually mentions.
  //
  // Until now the cache only filled when a table was OPENED, so typing
  // `SELECT ... FROM clientes` offered the table's name and then nothing: no column
  // suggestions for a table you had not already browsed, which is most of them.
  //
  // Deliberately NOT gated on the object tree having been expanded. That was the
  // first attempt and it fixed nothing: the tree only reports objects for branches
  // the user has opened, so the very case being complained about — a table you never
  // browsed — still came up empty.
  //
  // Describing every table at connect remains off the table: that is what
  // monopolized a single-connection engine and left the first table-open hanging for
  // seconds. This asks only about names the query itself mentions, once per name per
  // connection, and after the typing settles — so a name being typed one letter at a
  // time does not fire a describe per keystroke. A name that turns out not to exist
  // costs one failed describe, swallowed: completions are a convenience, not a
  // contract.
  const fetchedFks = new Set<string>();
  let columnFetchTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    const conn = active();
    const sql = lastQuerySql();
    if (columnFetchTimer !== undefined) clearTimeout(columnFetchTimer);
    if (!conn || sql.trim() === "") return;

    // Where the tree HAS loaded an object, reuse its db/schema qualifiers so the
    // describe lands on the right one; otherwise ask by bare name.
    const known = new Map(
      focusedObjects()
        .filter((n) => n.kind === "table" || n.kind === "view")
        .map((n) => [n.label.toLowerCase(), n]),
    );
    const names = tablesInStatement(sql);

    columnFetchTimer = setTimeout(() => {
      for (const name of names) {
        const node = known.get(name.toLowerCase());
        const label = node?.label ?? name;
        const guard = `${conn.connId}:${label}`;
        if (describedColumns.has(guard)) continue;
        describedColumns.add(guard);
        void (async () => {
          const missing = () => setMissingTables((m) => [...m, label.toLowerCase()]);
          try {
            const desc = await schemaDescribe(conn.connId, label, node?.db, node?.schema);
            const cols = describeColumnNames(desc);
            if (cols.length > 0) rememberColumns(conn, label, cols);
            else missing();
          } catch {
            // Not a table, or not reachable. Either way the name suggestions still
            // work and nothing needs to be said about it.
            missing();
          }
        })();
      }
      // Foreign keys only matter once there is something to join, and then
      // once per table: its outbound keys cover both directions between any
      // two tables of the statement.
      if (names.length < 2) return;
      for (const name of names) {
        const node = known.get(name.toLowerCase());
        const label = node?.label ?? name;
        const guard = `${conn.connId}:${label}`;
        if (fetchedFks.has(guard)) continue;
        fetchedFks.add(guard);
        const plan = foreignKeysFor(conn.driver, node?.db, { table: label, direction: "from" });
        if (!plan.supported || !plan.bulkSql) continue;
        void runQuery(conn.connId, plan.bulkSql, FK_CATALOG_LIMIT)
          .then((res) => {
            const rels = groupForeignKeys(parseForeignKeys(res.columns, res.rows));
            if (rels.length > 0) setFkCache((c) => ({ ...c, [label]: rels }));
          })
          .catch(() => {
            /* no FK metadata: JOIN … ON just completes columns. */
          });
      }
    }, 400);
  });
  onCleanup(() => {
    if (columnFetchTimer !== undefined) clearTimeout(columnFetchTimer);
  });

  const sqlForeignKeys = createMemo(() => Object.values(fkCache()).flat());

  const sqlSchema = createMemo<Record<string, string[]>>(() => {
    const cache = columnCache();
    const out: Record<string, string[]> = {};
    for (const n of focusedObjects()) {
      if (n.kind === "table" || n.kind === "view") out[n.label] = cache[n.label] ?? [];
    }
    // Tables the query mentioned and we described, even though the tree never
    // listed them: without this the columns were fetched and then thrown away.
    for (const [table, cols] of Object.entries(cache)) {
      if (out[table] === undefined || out[table].length === 0) out[table] = cols;
    }
    return out;
  });

  const current = createMemo(() => activeTab(tabs()));
  // The active tab split by kind: query tabs drive the editor+grid panes; tool
  // tabs render their panel in the same workspace area (UX refactor: tools open
  // as tabs in-window instead of modals).
  const currentQuery = createMemo<QueryTab | undefined>(() => {
    const t = current();
    return t && t.kind === "query" ? t : undefined;
  });
  const currentTool = createMemo<ToolTab | undefined>(() => {
    const t = current();
    return t && t.kind === "tool" ? t : undefined;
  });
  // The connection a tool panel acts on: the tool tab's bound one, else focused.
  const toolConn = () => tabConn(currentTool());
  // Open (or focus) a tool tab, and close one by id. Bind the tab to the focused
  // connection at creation so the panel stays on that connection even if another
  // is focused later; an explicit opts.connDefId (e.g. EXPLAIN from a bound query
  // tab) overrides it.
  const showTool = (
    tool: Parameters<typeof openTool>[1],
    title: string,
    opts?: Parameters<typeof openTool>[3],
  ) => {
    const defId = GLOBAL_TOOLS.has(tool)
      ? undefined
      : opts?.connDefId ?? focusedDefId() ?? undefined;
    // With several connections open the tab has to say which one it belongs to
    // (issue #492): every users panel is called "Usuarios" otherwise, and now
    // that each connection gets its own there would be no telling them apart.
    // With a single connection the name is the only thing the tab could be, so
    // it is left out — the same reasoning as the new query tab's title (#421).
    const conn = openConns().find((o) => o.defId === defId);
    const label =
      conn && openConns().length > 1 ? `${title} · ${conn.name}` : title;
    setTabs((s) => openTool(s, tool, label, { ...opts, connDefId: defId }));
  };
  // The sidebar tools live behind a single wrench button in the object-tree header
  // now (the always-open list was removed in the Explorer-first layout): open a
  // context menu of the tool catalog, each launching its tool tab.
  // Grouped as the menu bar's Herramientas (audit A-18): what the engine cannot
  // run stays listed, disabled, with the reason beside it.
  const toolsMenuItems = (engine: string | undefined): MenuItem[] =>
    toolsByGroup().flatMap(({ group, tools }) => [
      group ? { heading: true, label: t(`tool.group.${group}`) } : { separator: true },
      ...tools.map((item): MenuItem => {
        const reason = toolUnsupported(item, engine);
        return {
          label: t(item.label),
          Icon: item.Icon,
          disabled: reason !== null,
          hint: reason ?? undefined,
          title: reason ? `${t(item.label)}: ${reason}` : undefined,
          action: () => showTool(item.tool, t(item.tabTitle), { key: item.key }),
        };
      }),
    ]);
  // Row counts the trees read from the catalog, per connection (R-35): the
  // connected home shows them beside its tables.
  const [rowCountsByConn, setRowCountsByConn] = createSignal<Record<string, Record<string, number>>>({});
  const rowCountsOf = (defId: string) => rowCountsByConn()[defId];

  // «Exportar…» on a tree table: its data opens (or is focused) and the export
  // dialog follows once the first page is in.
  const [exportWhenLoaded, setExportWhenLoaded] = createSignal<number | null>(null);
  const exportTable = (node: TreeNode) => {
    openData(node);
    setExportWhenLoaded(current()?.id ?? null);
  };
  createEffect(() => {
    const id = exportWhenLoaded();
    if (id === null) return;
    const tab = current();
    if (!tab || tab.id !== id) return setExportWhenLoaded(null);
    const r = results[id];
    if (!r || r.loading || !r.result) return;
    setExportWhenLoaded(null);
    doExport(EXPORT_FORMATS[0].fmt as AnyExportFormat);
  });

  // The connection's own menu (TreeDbContextMenu, R-05): on its header and on
  // its database nodes. A database right-clicked becomes the working one first,
  // so what opens is scoped to it.
  const connMenuItems = (conn: ActiveConnection, db?: string): MenuItem[] => {
    const run = (fn: () => void) => () => {
      setFocusedDefId(conn.defId);
      if (db) syncWorkingDb(db);
      fn();
    };
    const saved = connections().find((c) => c.id === conn.defId);
    const engine = driverSchema(conn.driver)?.label ?? conn.driver;
    return [
      {
        heading: true,
        label: [conn.name, engine, db].filter(Boolean).join(" · "),
      },
      { label: t("connmenu.newQuery"), action: run(() => runShortcut("new-tab")) },
      { label: t("connmenu.newTable"), action: run(() => openTableDesigner(db)) },
      { label: t("connmenu.objectList"), action: run(openObjectList) },
      { separator: true },
      { label: t("connmenu.er"), action: run(() => openCatalogTool("erDiagram")) },
      { label: t("connmenu.dataSearch"), action: run(() => openCatalogTool("dataSearch")) },
      { label: t("connmenu.backup"), action: run(() => openCatalogTool("backup")) },
      { label: t("connmenu.moreTools"), submenu: toolsMenuItems(conn.driver) },
      { separator: true },
      { label: t("tree.copyName"), action: () => copyText(db ?? conn.name) },
      { label: t("tree.refresh"), action: run(refreshAll) },
      { separator: true },
      ...(saved ? [{ label: t("connmenu.edit"), action: () => onEditConnection(saved) }] : []),
      { label: t("conn.disconnect"), action: () => void disconnect(conn.defId) },
    ];
  };

  /** A catalog tool, by kind, as the tools menu opens it. */
  const openCatalogTool = (tool: ToolKind) => {
    const item = TOOL_CATALOG.find((x) => x.tool === tool);
    if (item) showTool(item.tool, t(item.tabTitle), { key: item.key });
  };
  /** The working database's object list. */
  const openObjectList = () => {
    const db = activeDb();
    if (db) showTool("objectList", t("tab.objectList", { db }), { key: `objlist:${db}`, params: { db } });
  };
  const openToolsMenu = (e: MouseEvent) => {
    openContextMenu(e, toolsMenuItems(active()?.driver));
  };
  const closeTool = (id: number) => setTabs((s) => closeTab(s, id));
  const closeToolByKind = (tool: ToolTab["tool"]) =>
    setTabs((s) => {
      const t = s.tabs.find((x): x is ToolTab => x.kind === "tool" && x.tool === tool);
      return t ? closeTab(s, t.id) : s;
    });
  // Track the last active query tab so tool tabs (snippets) can act on the query
  // editor even when a tool tab is the active one.
  const [lastQueryId, setLastQueryId] = createSignal<number | null>(null);
  createEffect(() => {
    const q = currentQuery();
    if (q) setLastQueryId(q.id);
  });
  // The remembered id is only good while that tab is still open: nothing clears
  // it when the tab is closed, so acting on it blindly used to focus a tab that
  // no longer existed — leaving the workspace blank and swallowing the action
  // (issue #338). Every reader goes through here.
  const liveQueryTab = (): QueryTab | undefined => {
    const id = lastQueryId();
    const t = id !== null ? tabs().tabs.find((x) => x.id === id) : undefined;
    return t && t.kind === "query" ? t : undefined;
  };
  const lastQuerySql = () => liveQueryTab()?.sql ?? "";

  // The table whose columns may be suggested unqualified: the first one the
  // statement names that we have columns for. Without it lang-sql completes keywords
  // where a column was wanted — `e2e_items.nom` worked while a bare `nom` did not.
  const sqlDefaultTable = createMemo<string | undefined>(() => {
    const cache = columnCache();
    const names = tablesInStatement(lastQuerySql());
    for (const name of names) {
      const key = Object.keys(cache).find(
        (k) => k.toLowerCase() === name.toLowerCase(),
      );
      if (key !== undefined && (cache[key]?.length ?? 0) > 0) return key;
    }
    return names[0];
  });
  // A memo so reads in JSX/StatusBar track the per-tab store entry reactively.
  const currentResult = createMemo<TabResult>(() => {
    const t = current();
    return (t && results[t.id]) || emptyResult();
  });
  const currentEdit = createMemo<EditSessionState>(() => {
    const t = current();
    return (t && edits[t.id]) || emptyEdit();
  });
  // A read-only connection (issue #666) edits nothing, whatever its keys.
  const currentReadOnly = createMemo(() => tabSafeMode(current()) === "readOnly");
  // A tab is editable when it was opened from a table whose primary key is known
  // and projected — otherwise a row cannot be identified unambiguously — on an
  // engine whose driver can write rows at all.
  const currentEditable = createMemo<boolean>(() => {
    const src = currentResult().source;
    return !!src && src.pk.length > 0 && !currentReadOnly() && engineEdits(tabConn(current())?.driver ?? "", tabConn(current())?.features?.dml);
  });
  // Why it is not (issue #718), translated, or null when it is or when there is
  // nothing to say (a result still loading, a statement that returned no rows).
  const currentReadOnlyReason = createMemo<string | null>(() => {
    if (currentEditable()) return null;
    const r = currentResult();
    // A read-only connection (#666) is the reason wherever there is a grid to edit.
    if (currentReadOnly() && (r.source || r.editBlock)) return t("safe.readOnlyHint");
    const block: EditBlock | null | undefined = r.source
      ? engineEdits(tabConn(current())?.driver ?? "", tabConn(current())?.features?.dml) ? "noPk" : "engine"
      : r.editBlock;
    return block ? t(`objbar.readOnly.${block}`) : null;
  });
  // Why a grid action that writes is unavailable: the protection, else `noPk`.
  const readOnlyReason = (noPk: string) =>
    currentReadOnly() ? t("safe.readOnlyHint") : t(noPk);
  // The FK pickers of the active tab (empty until an edit session loads them).
  const currentFk = createMemo<Record<string, FkLookup>>(() => {
    const t = current();
    return (t && fkLookups[t.id]) || {};
  });

  // Resolve the row-detail target reactively: null unless an in-range row of the
  // current result is selected. Closes itself (returns null) when a reload shrinks
  // the result past the selected index, so navigating after an apply is safe.
  const detailData = createMemo(() => {
    const idx = detailIndex();
    const res = currentResult().result;
    if (idx === null || !res || idx < 0 || idx >= res.rows.length) return null;
    return { idx, res };
  });

  const newTab = () => setTabs((s) => addTab(s, newQueryTitle(), focusedDefId() ?? undefined));
  /** The SQL held by the query tab with `id`; "" for a tool tab or none. Read
      through here rather than off `Tab` directly: only a query tab has `sql`,
      and reaching for it on the union quietly relied on `?? ""` to cover a tool
      tab instead of saying so. */
  const sqlOfTab = (id: number): string => {
    const tab = tabs().tabs.find((t) => t.id === id);
    return tab?.kind === "query" ? tab.sql : "";
  };
  const selectTab = (id: number) => setTabs((s) => ({ ...s, activeId: id }));
  // A snippet's tab holding text the snippet does not have yet (issue #338). Shown
  // as a dot, but the tab's accessible name says it in words — a bullet next to a
  // title tells a screen reader nothing about unsaved work.
  const isUnsaved = (tab: Tab): boolean => {
    if (tab.kind !== "query" || tab.snippetId === undefined) return false;
    const snip = snippets().find((s) => s.id === tab.snippetId);
    return snip !== undefined && snip.body !== tab.sql;
  };
  // Arrows walk the tab list, selection following focus (the usual tablist
  // behaviour, and the same wrap-around Ctrl+PageUp/PageDown already gives).
  const onTabKeyDown = (e: KeyboardEvent, id: number) => {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (dir === 0) return;
    e.preventDefault();
    const bar = (e.currentTarget as HTMLElement).parentElement;
    setTabs((s) => cycleTab({ ...s, activeId: id }, dir));
    // The roving tabindex only moves once the new active tab has rendered.
    queueMicrotask(() => bar?.querySelector<HTMLElement>('[role="tab"][tabindex="0"]')?.focus());
  };
  const removeTab = (id: number, e: MouseEvent) => {
    e.stopPropagation();
    setTabs((s) => closeTab(s, id));
  };

  const onEditorChange = (id: number, sql: string) =>
    setTabs((s) => updateTabSql(s, id, sql));

  // --- Query history actions (issue #128) --------------------------------
  // Re-run a stored query in a fresh tab so the current one is preserved.
  const runFromHistory = (sql: string) => {
    let newId = 0;
    setTabs((s) => {
      const added = addTab(s, newQueryTitle(), focusedDefId() ?? undefined);
      newId = added.activeId;
      return updateTabSql(added, newId, sql);
    });
    void run(sql);
  };
  // The history panel's «Insertar» (#689 / audit P1): at the caret, like a snippet.
  const insertFromHistory = (sql: string) =>
    insertSnippet({ id: "", name: oneLine(sql, 30), body: sql });

  // The editor's quick recall (issue #642): the latest distinct queries run on
  // this tab's ENGINE, from any connection of it, as a menu under the button.
  // Picking one inserts it at the caret like a snippet, so nothing written is
  // lost. The full text is the tooltip; the label is cut to one line.
  const openRecentHistory = (e: MouseEvent, tab: Tab) => {
    const engine = tabConn(tab)?.driver;
    const recent = engine ? recentForEngine(history(), engine) : [];
    const now = Date.now();
    const items: MenuItem[] =
      recent.length === 0
        ? [{ label: t(engine ? "hist.recentNone" : "hist.recentNoConn"), disabled: true }]
        : recent.map((h) => ({
            label: oneLine(h.sql),
            hint: timeAgo(h.ts, now, locale()),
            title: h.sql,
            action: () => insertSnippet({ id: "", name: oneLine(h.sql, 30), body: h.sql }),
          }));
    openContextMenu(e, items);
  };

  // Open SQL in a fresh tab WITHOUT running it (e.g. a routine's CREATE DDL,
  // which would error if executed against an object that already exists).
  // `name` (when the caller knows the object) titles the tab instead of "Consulta N".
  const openSqlInNewTab = (
    sql: string,
    name?: string,
    object?: { db?: string; schema?: string; name: string; kind: string },
    connDefId?: string,
  ) => {
    // When the SQL is an object's definition, the tab belongs to that object and
    // reopening it goes back there rather than stacking a copy (issue #414).
    // Without `object` this is what its name says: a fresh tab, which is what
    // "send this to the editor" means everywhere else it is called from.
    const key = object
      ? objectTabKey({ ...object, connDefId: focusedDefId() ?? undefined })
      : null;
    if (key !== null) {
      const already = findObjectTab(tabs(), key);
      if (already) {
        setTabs((s) => ({ ...s, activeId: already.id }));
        return;
      }
    }
    let newId = 0;
    setTabs((s) => {
      // An explicit connection (a migration script meant for the target, #672)
      // wins over whichever one is focused.
      const defId = connDefId ?? focusedDefId() ?? undefined;
      const added = name ? addTab(s, name, defId, false) : addTab(s, newQueryTitle(), defId);
      newId = added.activeId;
      const withSql = updateTabSql(added, newId, sql);
      return key !== null ? setObjectKey(withSql, newId, key) : withSql;
    });
  };

  const clearHistory = () => {
    setHistory([]);
    saveHistory([]);
  };

  // A configuration file (issue #684) is every store at once; each part goes
  // through the same handler its own control uses. A theme the file names but
  // this machine does not have is left alone — the built-ins are always there.
  const importConfig = (b: ConfigBundle) => {
    patchSettings(b.settings);
    setShortcutOverrides(b.shortcuts);
    applyThemePref(b.theme);
    if (allThemes().some((th) => th.id === b.themeId)) setThemeChoice(b.themeId);
    changeHistoryLimit(b.historyLimit);
    if (b.locale) setLocale(b.locale);
  };

  const changeHistoryLimit = (n: number) => {
    const cap = clampLimit(n); // keep signal, in-memory purge and storage in sync
    setHistoryLimit(cap);
    saveHistoryLimit(cap);
    // Apply the new cap immediately by purging the current log.
    setHistory((list) => {
      const next = list.slice(0, cap);
      saveHistory(next);
      return next;
    });
  };

  // --- Favorites / snippets actions (issue #129) -------------------------
  const persistSnippets = (list: Snippet[]) => {
    setSnippets(list);
    saveSnippets(list);
  };
  const renameSnip = (id: string, name: string) =>
    persistSnippets(renameSnippet(snippets(), id, name));
  const removeSnip = (id: string) => persistSnippets(removeSnippet(snippets(), id));
  // Deleting a snippet from the panel (audit P1) takes effect at once and offers
  // an undo that puts the very snippet back where it was.
  let snipUndoTimer: ReturnType<typeof setTimeout> | undefined;
  const deleteSnip = (id: string) => {
    const index = snippets().findIndex((x) => x.id === id);
    if (index === -1) return;
    const gone = snippets()[index];
    removeSnip(id);
    const toast = {
      text: t("snip.deleted", { name: gone.name }),
      undo: () => {
        const list = [...snippets()];
        list.splice(index, 0, gone);
        persistSnippets(list);
      },
    };
    setSnipToast(toast);
    clearTimeout(snipUndoTimer);
    snipUndoTimer = setTimeout(() => {
      if (snipToast() === toast) setSnipToast(null);
    }, 10_000);
  };
  const setSnipAbbr = (id: string, abbr: string) =>
    persistSnippets(setSnippetAbbr(snippets(), id, abbr));
  // Editor templates (issue #665): snippets with an abbreviation, then the
  // built-ins they do not override, unless the user turned those off.
  const editorTemplates = createMemo(() =>
    resolveTemplates(snippets(), settings().builtinTemplates ? BUILTIN_TEMPLATES : []),
  );
  // A copy to take somewhere else, under the first free "name (N)" so duplicating
  // twice does not silently make one of them unfindable.
  const duplicateSnip = (s: Snippet) => {
    const list = snippets();
    persistSnippets(addSnippet(list, uniqueSnippetName(list, s.name), s.body));
  };
  // Opening a snippet is what activating one means (issue #338): it lands in a
  // tab of its own, so the query the user was writing is never merged with it.
  const openSnippet = (s: Snippet) =>
    setTabs((st) => openSnippetTab(st, s, focusedDefId() ?? undefined));
  // Inserting at the cursor stays available, but has to be asked for. It acts on
  // the last query editor — which may have been closed since, and then there is
  // no cursor to insert at, so the snippet opens in its own tab instead of the
  // action silently doing nothing.
  const insertSnippet = (s: Snippet) => {
    const target = liveQueryTab();
    if (!target) {
      openSnippet(s);
      return;
    }
    setTabs((st) => ({ ...st, activeId: target.id }));
    setSnippetInsert((r) => ({ text: s.body, tick: r.tick + 1 }));
  };
  // --- Save the query being written as a snippet (issue #320) -------------
  // The editor answers a bumped saveTick with the text it WOULD RUN (selection /
  // statement / document), which then gets named in the editor's own toolbar —
  // never a tab over the query the user is looking at.
  const [saveTick, setSaveTick] = createSignal(0);
  const [naming, setNaming] = createSignal<{ body: string; scope: RunScope; name: string } | null>(
    null,
  );
  // Undo travels as the action, not as an id: undoing a save deletes the snippet
  // that was just created, while undoing an update puts the previous body back —
  // and deleting the user's snippet because the two shared a shape would be the
  // worst possible reading of "Deshacer".
  // The run that is waiting for its variables (issue #481). Held rather than
  // executed: the dialog is the only thing between asking to run and running,
  // so it carries everything the run will need when it comes back.
  const [varPrompt, setVarPrompt] = createSignal<{
    tabId: number;
    sql: string;
    scope: RunScope;
    variables: SqlVariable[];
    values: VarValues;
  } | null>(null);

  // The app's undo toast: a saved snippet, and a deleted connection (#762).
  const [snipToast, setSnipToast] = createSignal<{ text: string; undo: () => void } | null>(null);
  // Reading every row of a big table takes a while and can fail halfway; an
  // export that says nothing looks like an export that did nothing (issue #479).
  // `hint` carries the part that is not obvious: the chosen file stays EMPTY
  // until the very end, because the save dialog creates it when the name is
  // picked and the content lands when the writer closes. Somebody who opens it
  // meanwhile finds 0 bytes and concludes the export failed.
  const [exportStatus, setExportStatus] = createSignal<{
    text: string;
    hint?: string;
    error?: boolean;
    /** Rows read so far; a bar is shown while this is set. */
    rows?: number;
    /** Rows in total, when it is known WITHOUT running the query twice — a
        table can be counted, an arbitrary query cannot. Absent means the bar
        moves without claiming a percentage. */
    total?: number;
  } | null>(null);

  /** The snippet the active query tab was opened from, if it still exists. */
  const boundSnippet = (): Snippet | undefined => {
    const id = currentQuery()?.snippetId;
    return id === undefined ? undefined : snippets().find((s) => s.id === id);
  };

  // Open a .sql file in a tab of its own (issue #553). UTF-8 first; a file that
  // is not valid UTF-8 is read as Windows-1252, which is what an Informix
  // client on Windows writes, instead of arriving full of replacement marks.
  const openSqlFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".sql,text/plain,application/sql";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const bytes = await file.arrayBuffer();
      let sql: string;
      try {
        sql = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        sql = new TextDecoder("windows-1252").decode(bytes);
      }
      openSqlInNewTab(sql, file.name.replace(/\.sql$/i, ""));
    };
    input.click();
  };

  const requestSaveSnippet = () => {
    setSnipToast(null);
    setSaveTick((n) => n + 1);
  };

  const beginNaming = (body: string, scope: RunScope) => {
    if (!body.trim()) {
      setSnipToast(null);
      setConnError(t("snip.emptyQuery"));
      return;
    }
    // In a snippet's own tab the offered name is that snippet's, so accepting it
    // saves back to where the text came from; typing another name forks a new one.
    const bound = boundSnippet();
    const proposed =
      bound?.name ?? proposedSnippetName(body, activeDialect()) ?? t("snip.fallbackName");
    setNaming({ body, scope, name: proposed });
  };

  const commitNaming = () => {
    const pending = naming();
    if (!pending) return;
    const typed = pending.name.trim();
    if (!typed) return;
    if (!pending.body.trim()) return; // nothing to store either way
    const list = snippets();
    const scope = t(`snip.scope.${pending.scope}`);
    setNaming(null);

    // Accepting a bound tab's own name replaces that snippet's body in place.
    const bound = boundSnippet();
    if (bound && typed === bound.name) {
      const previous = bound.body;
      persistSnippets(updateSnippetBody(list, bound.id, pending.body));
      setSnipToast({
        text: t("snip.updated", { name: bound.name, scope }),
        undo: () => persistSnippets(updateSnippetBody(snippets(), bound.id, previous)),
      });
      return;
    }

    // A name already in use never overwrites the snippet holding it: the save
    // lands under a numbered variant and the toast says which.
    const name = uniqueSnippetName(list, typed);
    const id = nextSnippetId(list);
    persistSnippets(addSnippet(list, name, pending.body));
    setSnipToast({
      text: t(name === typed ? "snip.saved" : "snip.savedRenamed", { name, scope }),
      undo: () => removeSnip(id),
    });
  };

  const undoSaveSnippet = () => {
    snipToast()?.undo();
    setSnipToast(null);
  };

  const exportSnippets = () =>
    void saveText("quaero-snippets.json", serializeSnippets(snippets()), "application/json");
  const importSnippets = (file: File) => {
    void file.text().then((text) => persistSnippets(mergeSnippets(snippets(), parseSnippets(text))));
  };

  // --- Connection management (issue #16) ---------------------------------
  const persist = (list: Connection[]) => {
    setConnections(list);
    saveConnections(list);
  };

  // Export/import saved connections (issue #188). Export defaults to no passwords;
  // import merges into the saved list and reports what changed.
  const exportConns = (includePasswords: boolean, ids?: string[]) =>
    void saveText(
      "quaero-connections.json",
      exportConnections(
        ids ? connections().filter((c) => ids.includes(c.id)) : connections(),
        includePasswords,
      ),
      "application/json",
    );
  /**
   * Import saved connections from one file, or from the two DBeaver writes: the
   * list and the credentials beside it (issue #391). Which is which comes from
   * the content, not the name — the list is the one that reads as text.
   */
  const importConns = async (files: File[]): Promise<string> => {
    let listText: string | null = null;
    let credentials: ArrayBuffer | undefined;
    for (const file of files) {
      const bytes = await file.arrayBuffer();
      const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      // DBeaver's credentials file is ciphertext: it decodes to replacement
      // characters, never to the JSON or XML a connection list is.
      if (listText === null && /[[<{]/.test(text.slice(0, 64)) && !text.includes("�")) {
        listText = text;
      } else {
        credentials = bytes;
      }
    }
    if (listText === null) return t("error.importNoConns");
    const res = await importConnections(connections(), listText, credentials);
    if ("error" in res) return `No se pudo importar: ${res.error}`;
    persist(res.list);
    return summaryText(res.summary);
  };

  // The connection form opens as a tool tab carrying the draft in its params.
  const openConnForm = (draft: Connection) =>
    showTool(
      "connectionForm",
      draft.name ? t("tab.editConn", { name: draft.name }) : t("conn.new"),
      { key: "connform", params: { draft } },
    );

  const onNewConnection = () =>
    openConnForm({
      id: nextConnectionId(connections()),
      name: "",
      driver: AVAILABLE_DRIVERS[0],
      params: {},
    });

  const onEditConnection = (c: Connection) =>
    openConnForm({ ...c, params: { ...c.params } });

  // Deleting a saved connection (issue #762) takes effect at once and offers an
  // undo toast that puts back the very object — password, tunnel, group, colour,
  // safe mode — at its old position. The password lives in that object (no
  // keychain), so nothing is lost before the toast leaves. An OPEN connection
  // asks first: deleting it disconnects a live session.
  const [deletingConn, setDeletingConn] = createSignal<Connection | null>(null);
  let connUndoTimer: ReturnType<typeof setTimeout> | undefined;
  const deleteConnection = async (c: Connection) => {
    if (openConns().some((o) => o.defId === c.id)) {
      await disconnect(c.id);
      // An open transaction sent the user to its own prompt: delete nothing yet.
      if (openConns().some((o) => o.defId === c.id)) return;
    }
    const index = connections().findIndex((x) => x.id === c.id);
    if (index === -1) return;
    persist(removeConnection(connections(), c.id));
    const toast = {
      text: t("conn.deleted", { name: c.name }),
      undo: () => persist(restoreConnection(connections(), c, index)),
    };
    setSnipToast(toast);
    clearTimeout(connUndoTimer);
    connUndoTimer = setTimeout(() => {
      if (snipToast() === toast) setSnipToast(null);
    }, 10_000);
  };
  const onDeleteConnection = (id: string) => {
    const c = connections().find((x) => x.id === id);
    if (!c) return;
    if (openConns().some((o) => o.defId === id)) setDeletingConn(c);
    else void deleteConnection(c);
  };

  // The saved connections get a tab of their own (issue #525): the sidebar bar
  // answers "what is open", and everything that OUTLIVES a session — creating,
  // renaming, grouping, importing, exporting — needs room the popover never had.
  const openConnectionsTab = () =>
    showTool("connections", t("tool.connections.tab"), { key: "connections" });

  // Move a connection between existing groups from the list's context menu.
  const moveConnToGroup = (id: string, group: string) =>
    persist(setConnectionGroup(connections(), id, group));

  const onSaveConnection = (c: Connection) => {
    persist(upsertConnection(connections(), c));
    closeToolByKind("connectionForm");
    // Land on the list, where the connection that was just saved is visible.
    // The bar cannot show it — it lists what is OPEN — so without this, saving
    // would close the form onto whatever was behind it and confirm nothing.
    openConnectionsTab();
  };

  // Save and open it in one go (issue #531). No detour through the list: the
  // connection opening IS the confirmation that it saved, and landing on the
  // manager instead would put a list between the user and the database they
  // just said they wanted to work in.
  const onSaveAndConnectConnection = (c: Connection) => {
    persist(upsertConnection(connections(), c));
    closeToolByKind("connectionForm");
    void onConnect(c);
  };

  // Close one open connection (the focused one when no id is given). Other open
  // connections stay up; focus falls to another, or none.
  // An open transaction is asked about first (issue #667): closing the session
  // would roll it back without a word. `txSettled` = the user already chose.
  const disconnect = async (defId?: string, txSettled = false) => {
    const target = defId ?? focusedDefId();
    if (target == null) return;
    const o = openConns().find((x) => x.defId === target);
    if (!o) return;
    if (!txSettled && txOpenCount(o) !== null) {
      setTxPrompt(o);
      return;
    }
    try {
      await closeConnection(o.connId);
    } catch {
      /* best-effort close */
    }
    const rest = openConns().filter((x) => x.defId !== target);
    setOpenConns(rest);
    // Its explorer section goes with it: leaving the entries behind would keep
    // stale objects in the autocomplete and reopen the connection folded away.
    setLoadedObjects((m) => dropConnObjects(m, target));
    setCollapsedSections((s) => {
      if (!s.has(target)) return s;
      const next = new Set(s);
      next.delete(target);
      return next;
    });
    // Its tabs go with it: a tab bound to a closed session can only fail.
    setTabs((s) => closeTabsForConn(s, target));
    if (focusedDefId() === target) {
      setFocusedDefId(rest[0]?.defId ?? null);
    }
    if (rest.length === 0) {
      setDatabases([]);
      setActiveDb(null);
    }
  };

  // --- End-to-end connect path (issue #17) -------------------------------
  // Opening a connection ADDS it to the open set (others stay up) and focuses it;
  // if it is already open, this just focuses it. `force` (Reconectar) drops the
  // existing session and opens a fresh one to recover a dropped/killed server.
  // When each saved connection was last opened, for the welcome (issue #694).
  const [connUsage, setConnUsage] = createSignal(loadUsage(resolveStore()));
  createEffect(
    on(
      [connUsage, connections],
      ([u, list]) => saveUsage(resolveStore(), u, list.map((c) => c.id)),
      { defer: true },
    ),
  );
  // «Importar conexiones…» from the welcome: the same import as the
  // connections tab, its outcome said in a toast (and kept in the history).
  const pickConnectionsFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".json,.ncx,.xml,application/json,text/xml";
    input.onchange = async () => {
      const files = [...(input.files ?? [])];
      if (files.length > 0) setNotice(await importConns(files));
    };
    input.click();
  };
  // When the open in flight started: the explorer counts it (TreeLoading).
  const [connectingSince, setConnectingSince] = createSignal(0);
  const onConnect = async (c: Connection, force = false) => {
    if (connectingId() !== null) return;
    const existing = openConns().find((o) => o.defId === c.id);
    if (existing && !force) {
      setFocusedDefId(c.id); // already open — just bring it into focus
      return;
    }
    setConnectingId(c.id);
    setConnectingSince(Date.now());
    setConnError(null);
    try {
      if (existing) {
        // Reconnect: drop the stale session before opening a fresh one.
        try {
          await closeConnection(existing.connId);
        } catch {
          /* best-effort */
        }
        setOpenConns((list) => list.filter((o) => o.defId !== c.id));
      }
      const { connId, features } = await openSession(c.driver, buildDsn(c));
      setConnGuard(connId, guardFor(c));
      // Before the tree mounts: a connection whose host/database changed since
      // it was cached starts from an empty cache (issue #675).
      metaCache.open(c.id, connFingerprint(c));
      setOpenConns((list) => [
        ...list,
        { defId: c.id, connId, name: c.name, driver: c.driver, color: c.color, features },
      ]);
      setFocusedDefId(c.id);
      setConnUsage((u) => touchConnection(u, c.id, Date.now()));
      // Closing the dead session above fails with the very error that raises the
      // "connection lost" banner, so a successful reconnect must take it down
      // again or it outlives the problem it reported (issue #407).
      setConnError(null);
    } catch (err) {
      const f = describeError(err);
      const detail = f.detail ?? f.title;
      setConnError(t("conn.failed", { name: c.name, detail }));
    } finally {
      setConnectingId(null);
    }
  };

  // The answer to the restore prompt (issue #465). Resuming puts the saved tabs
  // back AND reopens the connections they are bound to — a restored tab used to
  // come back announcing that its connection was closed, which is not a session
  // resumed, it is a list of things to reconnect by hand.
  //
  // Sequentially, because onConnect refuses a second open while one is in
  // flight; the active tab's connection is opened last (restoreConnIds), so the
  // focus ends where the user left it.
  const resumeSession = async () => {
    const saved = pendingRestore();
    setPendingRestore(null);
    if (!saved) return;
    // Numbering goes on from the resumed session's titles.
    setTabs({ ...saved, seq: Math.max(saved.seq ?? 0, tabs().seq ?? 0), num: saved.num });
    for (const defId of restoreConnIds(saved)) {
      const c = connections().find((x) => x.id === defId);
      // eslint-disable-next-line no-await-in-loop -- one open at a time by design
      if (c) await onConnect(c);
    }
  };

  // The core reported that a connection died (issue #407). It used to surface as
  // whatever error the failing call happened to produce, with the bar still
  // showing the green dot, so the user had to know that Reconectar was the
  // answer. Now the connection is marked and says so, and the banner offers it.
  //
  // Registered on the transport, so it fires for a query, a commit, a row write
  // or a catalog read alike — every method goes through the same call().
  //
  // Automatic reconnection (issue #676): when no transaction dies with the
  // session, a fresh one replaces it by itself, and the transport re-sends the
  // failed call once if the core proved it a read. Otherwise it is marked lost as
  // before and the failed call says why it was not retried.
  // `retry`: the session could be reopened without losing anything (no
  // transaction died with it) and only the attempt failed — try again by itself,
  // backing off, while the band counts down (R-05).
  const markLost = (connId: string, retry = false) => {
    const conn = openConns().find((o) => o.connId === connId);
    if (!conn) return;
    const retries = retry ? (conn.retries ?? 0) + 1 : 0;
    const retryAt = retry ? Date.now() + retryDelaySec(retries - 1) * 1000 : undefined;
    setOpenConns((list) =>
      list.map((o) =>
        o.connId === connId ? { ...o, lost: true, reconnecting: false, retryAt, retries } : o,
      ),
    );
    // Said once: a keep-alive probe on a session already marked lost is no news.
    if (!conn.lost) setConnError(t("conn.lost", { name: conn.name }));
  };
  /** Open a fresh session in place of `conn`'s dead one; its new connId, or
      null (and marked lost) when that fails. Tabs follow by defId. */
  const replaceSession = async (conn: ActiveConnection): Promise<string | null> => {
    const saved = connections().find((c) => c.id === conn.defId);
    if (!saved) {
      markLost(conn.connId);
      return null;
    }
    setOpenConns((list) =>
      list.map((o) => (o.connId === conn.connId ? { ...o, reconnecting: true } : o)),
    );
    try {
      const { connId, features } = await openSession(saved.driver, buildDsn(saved));
      setConnGuard(connId, guardFor(saved));
      // Closed or reconnected by hand meanwhile: this session is nobody's.
      if (!openConns().some((o) => o.connId === conn.connId)) {
        void closeConnection(connId).catch(() => {});
        return null;
      }
      const manual = txOf(conn).manual;
      setOpenConns((list) =>
        list.map((o) =>
          o.connId === conn.connId
            ? {
                ...o,
                connId,
                features,
                lost: false,
                reconnecting: false,
                reconnected: true,
                retryAt: undefined,
                retries: 0,
              }
            : o,
        ),
      );
      setTimeout(
        () =>
          setOpenConns((list) =>
            list.map((o) => (o.connId === connId ? { ...o, reconnected: false } : o)),
          ),
        5000,
      );
      // The mode is the user's choice and outlives the session; the
      // transaction did not (there was none, or this would not run).
      if (manual) setTxs(connId, idleTx(true));
      void closeConnection(conn.connId).catch(() => {});
      setConnError(null);
      return connId;
    } catch {
      markLost(conn.connId, true);
      return null;
    }
  };
  // By the DEAD connId: every call that met the same dead session waits on one
  // reconnect, including those answering after it finished (they still name the
  // old id). A failed attempt is forgotten so the next call can try again.
  const replacing = new Map<string, Promise<string | null>>();
  onMount(() => {
    onConnectionLost(async (connId, data) => {
      const pending = replacing.get(connId);
      if (pending) return { reconnectedTo: await pending, txLost: false };
      const conn = openConns().find((o) => o.connId === connId);
      if (!conn) return; // not ours (a session closed meanwhile)
      const info = lostInfo(data);
      const uiTx = txOf(conn).open;
      if (!mayReconnect(info, uiTx)) {
        markLost(connId);
        return { reconnectedTo: null, txLost: uiTx || info?.inTx === true };
      }
      const p = replaceSession(conn);
      replacing.set(connId, p);
      const to = await p;
      if (to === null) replacing.delete(connId);
      return { reconnectedTo: to, txLost: false };
    });
  });
  onCleanup(() => onConnectionLost(null));

  // Keep-alive (issue #676): a session with an interval set gets a cheap probe
  // once it has been quiet that long, and never while a call is in flight on it
  // (the shell runs one call at a time, so a query sent during a probe waits for
  // that one SELECT). Failing probes back off. A probe that finds the session
  // dead takes the path above.
  const keepAliveFailures = new Map<string, number>();
  // The lost band's clock: ticks only while a session is lost.
  const [clock, setClock] = createSignal(Date.now());
  onMount(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      if (openConns().some((o) => o.lost) || connectingId() !== null) setClock(now);
      // A lost session whose retry is due is reopened by itself (R-05).
      for (const o of openConns()) {
        if (o.lost && !o.reconnecting && o.retryAt !== undefined && o.retryAt <= now) {
          void replaceSession(o);
        }
      }
      for (const o of openConns()) {
        const probe = keepAliveProbe(o.driver);
        const sec = connections().find((c) => c.id === o.defId)?.keepAlive ?? 0;
        const failures = keepAliveFailures.get(o.defId) ?? 0;
        if (!probe || o.reconnecting || !keepAliveDue(now, sec, connActivity(o.connId), failures)) {
          continue;
        }
        runQuery(o.connId, probe, 1).then(
          () => keepAliveFailures.delete(o.defId),
          () => keepAliveFailures.set(o.defId, failures + 1),
        );
      }
    }, 1000);
    onCleanup(() => clearInterval(timer));
  });

  // Reconnect the active connection (fresh session) — recovers after the server
  // dropped or the process was killed.
  const reconnect = () => {
    const id = activeDefId();
    const c = id ? connections().find((x) => x.id === id) : undefined;
    if (c) void onConnect(c, true);
  };

  // Load the connection's databases and pick a default working one (the DSN's
  // database if set, else the first). Runs whenever the active connection
  // changes; failures leave the list empty (the selector just hides).
  createEffect(() => {
    const conn = active();
    if (!conn) {
      setDatabases([]);
      setActiveDb(null);
      return;
    }
    const connId = conn.connId;
    void (async () => {
      try {
        const dbs = parseTreeRows(await schemaTree(connId), "database")
          .filter((n) => n.kind === "database" || n.kind === "schema")
          .map((n) => n.name);
        if (active()?.connId !== connId) return; // connection changed meanwhile
        setDatabases(dbs);
        const configured = connections().find((c) => c.id === activeDefId())?.params.database;
        setActiveDb(configured && dbs.includes(configured) ? configured : (dbs[0] ?? null));
      } catch {
        setDatabases([]);
      }
    })();
  });

  // Select the working database: scope the tools + (where supported) set the
  // editor's default database on the live session via USE.
  const selectDb = (db: string) => {
    setActiveDb(db);
    const conn = active();
    const sql = useDatabaseSql(activeDialect(), db);
    if (conn && sql) void runQuery(conn.connId, sql).catch(() => {});
  };

  // Keep the working-database selector in sync when the user navigates the tree
  // into another database (clicking a db node or opening one of its tables).
  // Guarded: only switch to a name that is actually a selectable database, and
  // only when it differs from the current one, to avoid redundant USE queries.
  const syncWorkingDb = (name?: string | null) => {
    if (name && name !== activeDb() && databases().includes(name)) {
      selectDb(name);
    }
  };

  // Record an executed query in the client-side history (issue #128), collapsing
  // immediate repeats and purging past the configured limit, then persist.
  // When the run happened and how long it took (issue #643), said once and gone:
  // the status bar keeps the same two facts for after the toast has left.
  const [runToast, setRunToast] = createSignal<{ text: string; error: boolean } | null>(null);
  let runToastTimer: ReturnType<typeof setTimeout> | undefined;
  //
  // Issue #693 (audit R-30, A-33): no toast for a run whose result is on
  // screen — the run status band and the status bar already say it. Only a run
  // that finished in a tab the user has left is announced, and an error stays
  // until it is closed.
  const showRunToast = (tabId: number, ranAt: number, elapsedMs: number, failed: boolean) => {
    if (current()?.id === tabId) return;
    clearTimeout(runToastTimer);
    const args = { time: formatClock(ranAt), duration: formatDuration(elapsedMs) };
    setRunToast({ text: t(failed ? "run.failed" : "run.done", args), error: failed });
    if (!failed) runToastTimer = setTimeout(() => setRunToast(null), 6000);
  };
  const showErrorToast = (text: string) => {
    clearTimeout(runToastTimer);
    setRunToast({ text, error: true });
  };

  // --- Manual transactions (issue #667) -----------------------------------
  // Per CORE connection (connId): every tab bound to it shares the session, and
  // a reconnect — a new connId — starts clean, as the transaction died with the
  // old session. The policy is pure and tested in utils/txMode.ts.
  const [txs, setTxs] = createStore<Record<string, TxSession>>({});
  const txOf = (conn: ActiveConnection | null | undefined): TxSession =>
    (conn && txs[conn.connId]) || idleTx();
  /** The open transaction's statement count, or null when none is open (or the
      session is lost, which took the transaction with it). */
  const txOpenCount = (conn: ActiveConnection | null | undefined): number | null =>
    conn && !conn.lost && txOf(conn).open ? txOf(conn).statements : null;
  const [txBusy, setTxBusy] = createSignal(false);
  /** The connection whose disconnect waits on Commit / Rollback / Cancel. */
  const [txPrompt, setTxPrompt] = createSignal<ActiveConnection | null>(null);
  const [txPromptError, setTxPromptError] = createSignal<string | null>(null);
  const settleTxPrompt = async (verb: "commit" | "rollback") => {
    const conn = txPrompt();
    if (!conn) return;
    const err = await endTx(conn, verb);
    setTxPromptError(err);
    if (err) return; // the prompt stays, saying why
    setTxPrompt(null);
    void disconnect(conn.defId, true);
  };
  const closeTxPrompt = () => {
    setTxPrompt(null);
    setTxPromptError(null);
  };
  const txCall = (connId: string, verb: TxVerb) =>
    verb === "begin" ? txBegin(connId) : verb === "commit" ? txCommit(connId) : txRollback(connId);
  /** Run `sql` (one statement) through the connection's transaction state. */
  const runTx = (
    conn: ActiveConnection,
    sql: string,
    query: () => Promise<ResultSet>,
    onImplicitCommit?: () => void,
  ) =>
    runInTx(sql, conn.driver, {
      get: () => txOf(conn),
      set: (s) => setTxs(conn.connId, s),
      query,
      tx: (verb) => txCall(conn.connId, verb),
      empty: () => ({ columns: [], rows: [], truncated: false, rowsAffected: 0 }),
      onImplicitCommit,
    });
  /** Commit or roll back the connection's open transaction (toolbar, shortcut,
      disconnect prompt). Resolves with the error text, or null once it ended.
      Through runInTx, so the state follows the same rules as a typed COMMIT. */
  const endTx = async (
    conn: ActiveConnection | null,
    verb: "commit" | "rollback",
  ): Promise<string | null> => {
    if (!conn || !txOf(conn).open) return null;
    setTxBusy(true);
    try {
      await runTx(conn, verb.toUpperCase(), () => Promise.reject(new Error("unreachable")));
      return null;
    } catch (err) {
      return errorText(err);
    } finally {
      setTxBusy(false);
    }
  };
  /** The toolbar's and the shortcuts' Commit / Rollback, on the tab's connection. */
  const endTabTx = async (verb: "commit" | "rollback") => {
    const err = await endTx(tabConn(current()), verb);
    if (err) showErrorToast(err);
  };
  const toggleTxMode = (conn: ActiveConnection | null) => {
    if (!conn || txOf(conn).open) return;
    setTxs(conn.connId, idleTx(!txOf(conn).manual));
  };
  /** Why the tab's connection cannot use manual mode, or null. */
  const txUnsupported = (conn: ActiveConnection | null): string | null =>
    conn?.features?.transactions === false ? t("tx.unsupported") : null;
  /** Grid editing brackets its changes in its own transaction: never inside the
      user's, whose commit it would otherwise take over. The core refuses the
      nested tx.begin as well; this says why in the user's words. */
  const txEditBlocked = (conn: ActiveConnection | null): string | null =>
    txOpenCount(conn) !== null ? t("tx.editBlocked") : null;
  const recordHistory = (sql: string, conn: ActiveConnection, durationMs?: number) => {
    const entry: HistoryEntry = {
      sql,
      ts: Date.now(),
      connId: activeDefId() ?? "",
      connName: conn.name,
      engine: conn.driver,
      durationMs,
    };
    setHistory((list) => {
      const next = addHistory(list, entry, historyLimit());
      saveHistory(next);
      return next;
    });
  };

  // A hand-written single-table SELECT is editable too: the tree's "open table"
  // path is not the only way to look at a table's rows. Derive the table from the
  // SQL (utils/queryTarget), describe it, and attach the edit source only when its
  // primary key came back in the result — without the key a row cannot be
  // addressed unambiguously. Out of band, and never silent: whatever stops it
  // (a join, a view, a keyless table, a describe error) is recorded as the
  // tab's editBlock, which the toolbar shows on a disabled Editar (issue #718).
  const attachQuerySource = async (
    tabId: number,
    sql: string,
    conn: ActiveConnection,
    result: ResultSet,
  ) => {
    // The tab may have run something else meanwhile; only the run that is still
    // on screen gets a verdict.
    const settle = (patch: { source: EditSource } | { editBlock: EditBlock }) => {
      if (results[tabId]?.pageSql === sql) setResults(tabId, patch);
    };
    // A statement with no columns (DDL, DML) is not a grid to edit: say nothing.
    if (result.columns.length === 0) return;
    const check = queryEditCheck(sql, conn.driver, conn.features?.dml);
    if ("block" in check) return settle({ editBlock: check.block });
    const { target } = check;
    let desc: ResultSet;
    try {
      desc = await schemaDescribe(conn.connId, target.table, target.db, target.schema);
    } catch {
      return settle({ editBlock: "noTable" });
    }
    // The describe is done anyway — feed its columns to the autocomplete cache.
    rememberColumns(conn, target.table, describeColumnNames(desc));
    const key = editablePk(desc, result.columns);
    settle("block" in key ? { editBlock: key.block } : { source: { ...target, pk: key.pk } });
  };

  // `tabId` names the tab to run into; omitted it is the focused one. A refresh
  // must pass it explicitly (like runPreviewPage) — the request can come from a
  // tool tab that is focused while its SOURCE tab is the one to re-run (#314).
  const run = async (
    sql: string,
    scope: RunScope = "document",
    offset = 0,
    tabId?: number,
  ) => {
    const tab = tabId !== undefined ? tabs().tabs.find((x) => x.id === tabId) : current();
    if (!tab) return;
    const id = tab.id;
    // A page turn keeps the size its result was read with: its offset counts
    // pages of THAT size. A fresh run takes the remembered one.
    const limit = offset > 0 ? (results[id]?.pageSize ?? pageSize()) : pageSize();
    const trimmed = sql.trim();
    if (!trimmed) {
      setResults(id, { ...emptyResult(), error: t("error.emptyQuery") });
      return;
    }
    // What the editor held when it ran (issue #674); page turns are not a run.
    if (offset === 0 && tab.kind === "query" && !isDataTab(id)) recordLocal(tab, "run");
    // A fresh run shows its result, whichever view the pane was on.
    if (offset === 0) setResultViews(id, "result");
    // Run against the tab's OWN connection (bound at creation), so a prod tab and
    // a dev tab keep hitting their own servers regardless of which is focused. A
    // tab with no binding follows whatever is focused.
    const conn = tabConn(tab);
    if (!conn) {
      setResults(id, {
        ...emptyResult(),
        error:
          tab.kind === "query" && tab.connDefId
            ? t("error.tabConnClosed")
            : t("error.noActiveConn"),
      });
      return;
    }
    // Paging the same query keeps the edit source so the grid stays editable
    // across pages; a fresh query (different SQL) drops it.
    const prev = results[id];
    const keepSource =
      prev?.source && prev.pageSql === trimmed ? prev.source : undefined;
    setResults(id, { ...emptyResult(), loading: true, ranScope: scope, startedAt: Date.now() });
    if (!keepSource) {
      setFkLookups(id, {}); // the pickers belong to the old table
      dropUniqueSets(id); // and so do its unique indexes
    }
    const started = performance.now();
    const ranAt = Date.now();
    // Several statements in one run go to the engine one by one: no engine takes
    // a whole script in a single call (MySQL answers `PREPARE …; EXECUTE …;`
    // with a syntax error). A script is not pageable — turning the page would
    // re-run its DDL — so it gets no pageSql.
    const stmts = runnableStatements(trimmed, conn.driver);
    const script = stmts.length > 1;
    // Every statement of a fresh run goes through the connection's transaction
    // state (issue #667); a page turn re-reads what already ran and does not.
    let implicitCommit = false;
    // Which statement is running, for the result panel (issue #691): a script
    // sends them one at a time through here.
    let sent = 0;
    const exec = (stmt: string, query: () => Promise<ResultSet>) => {
      if (script) setResults(id, { progress: { n: ++sent, total: stmts.length } });
      return offset === 0 ? runTx(conn, stmt, query, () => (implicitCommit = true)) : query();
    };
    try {
      // A script keeps one entry per statement (issue #450) and opens one of
      // them; the mirrored fields below are that entry, so nothing downstream
      // has to know a script ran.
      const sets = script
        ? scriptSets(
            await withWriteConsent(conn.connId, stmts, () =>
              runStatements(conn.connId, stmts, limit, exec),
            ),
            activeDialect(),
          )
        : undefined;
      const activeSet = sets ? pickActiveSet(sets) : 0;
      const shown = sets ? sets[activeSet] : undefined;
      // A fresh run asks the core to keep the result open (issue #478): the
      // pages after this one then continue it instead of paying for the query
      // again. A page turn that got here is the fallback path (the cursor was
      // lost), and re-runs with an offset as it always did.
      const result = sets
        ? (shown?.result ?? null)
        : await withWriteConsent(conn.connId, [trimmed], () =>
            exec(trimmed, () => runQuery(conn.connId, trimmed, limit, offset, offset === 0)),
          );
      const elapsedMs = performance.now() - started;
      // The page cache starts here and grows only through the cursor: pages of
      // ONE execution are a consistent snapshot, while pages stitched from
      // separate re-runs are not (a refresh would leave the earlier pages
      // showing yesterday's rows). It is indexed by page number, so a re-run at
      // an offset lands in its own slot.
      const pages: ResultSet[] | undefined = script || !result ? undefined : [];
      if (pages && result) pages[Math.round(offset / limit)] = result;
      setResults(id, {
        loading: false,
        error: shown?.error ?? null,
        errorSql: shown?.error ? shown.sql : undefined,
        progress: null,
        result,
        elapsedMs,
        ranAt,
        ranScope: scope,
        ...(offset === 0 ? { ranSql: trimmed, ranTx: txOf(conn).open ? "pending" : "auto" } : {}),
        pageSql: script ? undefined : trimmed,
        offset,
        pageSize: limit,
        cursor: result?.cursor ?? false,
        pages,
        source: keepSource,
        // A script's results are not pageable, nor editable: its statements
        // are read back, not re-run against one table.
        editBlock: script ? "statement" : undefined,
        sets,
        activeSet,
      });
      // Record after the run so the entry carries its duration (issue #179);
      // page turns (offset > 0) are not logged.
      if (offset === 0) {
        recordHistory(trimmed, conn, elapsedMs);
        showRunToast(id, ranAt, elapsedMs, !!shown?.error);
        logRun(
          id,
          runMessages({
            at: ranAt,
            sql: trimmed,
            sets,
            result,
            error: shown?.error ?? null,
            elapsedMs,
            warnings: implicitCommit ? [t("tx.implicitCommit")] : undefined,
          }),
        );
      }
      if (implicitCommit) showErrorToast(t("tx.implicitCommit"));
      // A page turn keeps the source it already had; a fresh query derives it.
      // A statement that failed has no result to derive one from.
      if (!keepSource && result) void attachQuerySource(id, trimmed, conn, result);
      // DDL from the editor is the only way to create a stored routine, and it
      // left the tree showing yesterday's catalog until a manual refresh (#317).
      // The introspection cache is told too (issue #675): what the script may
      // have changed is marked stale — the whole connection when unsure.
      if (changesCatalog(trimmed)) {
        refreshTreeInPlace();
        forgetColumns(conn, metaCache.invalidateSql(conn.defId, trimmed));
      }
    } catch (err) {
      const elapsedMs = performance.now() - started;
      setResults(id, {
        loading: false,
        error: errorText(err),
        errorSql: trimmed,
        progress: null,
        result: null,
        elapsedMs,
        ranAt,
        ranScope: scope,
        sets: undefined,
        activeSet: 0,
      });
      if (offset === 0) {
        recordHistory(trimmed, conn, elapsedMs);
        showRunToast(id, ranAt, elapsedMs, true);
        logRun(
          id,
          runMessages({
            at: ranAt,
            sql: trimmed,
            result: null,
            error: errorText(err),
            elapsedMs,
            warnings: implicitCommit ? [t("tx.implicitCommit")] : undefined,
          }),
        );
      }
      if (implicitCommit) showErrorToast(t("tx.implicitCommit"));
    }
  };

  /**
   * Show another statement of the script that ran in this tab (issue #450).
   * The entry is copied into the mirrored fields, which is what the grid and the
   * toolbar read. No pageSql: a script's statement is not pageable, the same
   * rule the run itself follows — turning the page would re-run its DDL.
   */
  const selectSet = (tabId: number, index: number) => {
    const set = results[tabId]?.sets?.[index];
    if (!set) return;
    setResults(tabId, {
      activeSet: index,
      result: set.result,
      error: set.error,
      errorSql: set.error ? set.sql : undefined,
      elapsedMs: set.elapsedMs,
      pageSql: undefined,
      source: undefined,
      editBlock: "statement",
    });
  };

  // Run one page of an "open table" preview into tab `tabId`. The offset is
  // pushed INTO the SQL (server-side LIMIT/OFFSET) so the core-side offset stays
  // 0 — a preview caps its own row count, which the core's row-skip pagination
  // cannot page past. The SAME SQL is shown in the editor and executed (so a
  // manual Ctrl+Enter stays consistent); "has a further page" is inferred from a
  // full page (see utils/gridPaging). An explicit tabId avoids acting on whatever
  // tab happens to be focused (a reload from a tool tab targets its source tab).
  const runPreviewPage = async (
    tabId: number,
    preview: { parts: { db?: string; schema?: string; name: string }; engine: string },
    offset: number,
  ) => {
    const tab = tabs().tabs.find((t) => t.id === tabId);
    const conn = tabConn(tab);
    if (!conn) {
      setResults(tabId, {
        ...emptyResult(),
        error: t("error.noActiveConn"),
      });
      return;
    }
    const limit = pageSize();
    // The filter the panel applied travels INTO the paged query, so narrowing a
    // table narrows the table and not the page (issue #347).
    const sql = objectPreviewQuery(
      preview.parts,
      preview.engine,
      limit,
      offset,
      filters[tabId]?.applied ?? undefined,
    );
    // Keep the edit source across page turns of the same table so the grid stays editable.
    const keepSource = results[tabId]?.source ?? undefined;
    if (!keepSource) {
      setFkLookups(tabId, {}); // a fresh table: drop the old pickers
      dropUniqueSets(tabId); // and its unique indexes
    }
    setResults(tabId, { ...emptyResult(), loading: true, ranScope: "document", source: keepSource, preview });
    setTabs((s) => updateTabSql(s, tabId, sql));
    const started = performance.now();
    try {
      const result = await runQuery(conn.connId, sql, limit, 0);
      // The preview caps its own rows, so the core can't mark truncation; infer a
      // further page from a full page.
      const paged: ResultSet = { ...result, truncated: pageHasMore(result.rows.length, limit) };
      setResults(tabId, {
        loading: false,
        error: null,
        result: paged,
        elapsedMs: performance.now() - started,
        ranScope: "document",
        pageSql: sql,
        offset,
        pageSize: limit,
        source: keepSource,
        preview,
      });
    } catch (err) {
      setResults(tabId, {
        loading: false,
        error: errorText(err),
        result: null,
        elapsedMs: performance.now() - started,
        ranScope: "document",
      });
    }
  };

  // The next page off the cursor the core kept open for this tab's query
  // (issue #478). The query is NOT executed again — which is the whole point:
  // paging a heavy query used to cost the heavy query, once per page. The rows
  // on screen stay put while the page is fetched, and a cursor that is gone
  // (another tab queried the same connection) falls back to the offset re-run.
  const nextPage = async (tabId: number, index: number) => {
    const conn = tabConn(tabs().tabs.find((x) => x.id === tabId));
    const r = results[tabId];
    if (!conn || !r) return;
    const size = r.pageSize ?? pageSize();
    setResults(tabId, { loading: true });
    const started = performance.now();
    try {
      const page = await queryNext(conn.connId, size);
      const pages = [...(r.pages ?? [])];
      pages[index] = page;
      setResults(tabId, {
        loading: false,
        error: null,
        result: page,
        elapsedMs: performance.now() - started,
        offset: index * size,
        cursor: page.cursor ?? false,
        pages,
      });
    } catch (err) {
      setResults(tabId, { loading: false, cursor: false });
      // The fallback re-runs the statement: only ever a read.
      if (rerunnable(r.pageSql)) {
        void run(r.pageSql, r.ranScope ?? "document", index * size, tabId);
      } else {
        setResults(tabId, { error: errorText(err) });
      }
    }
  };

  // Cancel the query running in the current tab (op.cancel). Best-effort: the
  // core interrupts the driver where it can (e.g. SQLite); the awaited runQuery
  // then rejects with a query error, which the run() catch turns into the tab's
  // error state. Harmless when nothing is running or the engine cannot cancel.
  const cancelActive = () => {
    const tab = current();
    const conn = tab ? tabConn(tab) : undefined;
    if (conn) void cancelQuery(conn.connId).catch(() => {});
  };

  // Turn the page (issues #134, #478). Guarded while editing so a page turn
  // never discards pending changes. Where the page comes from is decided by
  // pageStep: memory first, then the open cursor, and only then a re-run —
  // table previews regenerate their paged SQL (server-side offset), a plain
  // query re-runs at a new core-side offset.
  const pageBy = (delta: 1 | -1) => {
    const t = current();
    if (!t) return;
    const r = results[t.id];
    if (!r || r.loading || currentEdit().editing) return;
    const step = pageStep(r, delta);
    if (!step) return;
    const size = r.pageSize ?? pageSize();
    if (step.kind === "cached") {
      const page = r.pages?.[step.index];
      if (page) setResults(t.id, { result: page, offset: step.index * size, error: null });
      return;
    }
    if (step.kind === "cursor") {
      void nextPage(t.id, step.index);
    } else if (step.kind === "preview" && r.preview) {
      void runPreviewPage(t.id, r.preview, step.offset);
    } else if (step.kind === "query" && r.pageSql) {
      void run(r.pageSql, r.ranScope ?? "document", step.offset);
    }
  };

  // --- The table pager (issue #688) ----------------------------------------
  // The total is counted on demand («Contar total») with the same filter the
  // page uses, and kept against that exact count query: a new filter makes it
  // stale, and a stale total would offer a last page that is not there.
  const [totals, setTotals] = createStore<Record<number, { sql: string; n: number }>>({});
  const [counting, setCounting] = createSignal<number | null>(null);
  const dataCountSql = (tabId: number): string | null => {
    const r = results[tabId];
    if (!r?.preview) return null;
    return objectCountQuery(r.preview.parts, r.preview.engine, filters[tabId]?.applied ?? undefined);
  };
  const dataTotal = (tabId: number): number | null => {
    const sql = dataCountSql(tabId);
    const got = totals[tabId];
    return sql && got?.sql === sql ? got.n : null;
  };
  const dataPager = (tabId: number) => {
    const r = results[tabId];
    return pagerView({
      offset: r?.offset ?? 0,
      rows: r?.result?.rows.length ?? 0,
      size: r?.pageSize ?? pageSize(),
      total: dataTotal(tabId),
      more: !!r?.result?.truncated,
      paused: !!edits[tabId]?.editing || !!r?.loading,
    });
  };
  const countDataTotal = async (tabId: number) => {
    const sql = dataCountSql(tabId);
    const conn = tabConn(tabs().tabs.find((x) => x.id === tabId));
    if (!sql || !conn) return;
    setCounting(tabId);
    try {
      const res = await runQuery(conn.connId, sql, 1);
      const n = Number(res.rows[0]?.[0]);
      if (Number.isFinite(n) && n >= 0) setTotals(tabId, { sql, n });
    } catch (err) {
      setRunToast({ text: errMsg(err), error: true });
    } finally {
      setCounting(null);
    }
  };
  const goToDataOffset = (tabId: number, offset: number) => {
    const r = results[tabId];
    if (!r?.preview || r.loading || edits[tabId]?.editing) return;
    void runPreviewPage(tabId, r.preview, offset);
  };
  // The pager's size selector (A-20, R-38): remembered for every table, and the
  // table re-read at once on the page that still holds its first row.
  const changePageSize = (tabId: number, size: number) => {
    setPageSize(size);
    resolveStore().setItem(PAGE_SIZE_KEY, String(size));
    goToDataOffset(tabId, offsetForPageSize(results[tabId]?.offset ?? 0, size));
  };

  /** The variable values this tab last ran with. */
  const varsOfTab = (tabId: number): VarValues => {
    const tab = tabs().tabs.find((x) => x.id === tabId);
    return tab?.kind === "query" ? (tab.vars ?? {}) : {};
  };

  /** The SQL dialect of a tab: its OWN connection's, not whatever is focused. */
  const dialectOfTab = (tabId: number): string => {
    const tab = tabs().tabs.find((x) => x.id === tabId);
    return (tab ? tabConn(tab)?.driver : undefined) ?? activeDialect();
  };

  /**
   * Run `sql` after filling in its variables (issue #481).
   *
   * What goes to the engine is the substituted text; the editor keeps what the
   * user wrote, which is the whole point of a variable. A statement with a
   * variable nobody has answered opens the dialog instead of running — and the
   * dialog comes back through here, so there is one path, not two.
   */
  const runWithVariables = (tabId: number, sql: string, scope: RunScope) => {
    const engine = dialectOfTab(tabId);
    const variables = findVariables(sql, engine);
    if (variables.length === 0) {
      void run(sql, scope, 0, tabId);
      return;
    }
    const values = varsOfTab(tabId);
    if (missingVariables(variables, values).length > 0) {
      setVarPrompt({ tabId, sql, scope, variables, values });
      return;
    }
    void run(applyVariables(sql, values, engine), scope, 0, tabId);
  };

  /** The dialog said Run: keep the values with the tab, then run. */
  const runWithValues = (values: VarValues) => {
    const prompt = varPrompt();
    if (!prompt) return;
    setVarPrompt(null);
    setTabs((state) => updateTabVars(state, prompt.tabId, values));
    void run(
      applyVariables(prompt.sql, values, dialectOfTab(prompt.tabId)),
      prompt.scope,
      0,
      prompt.tabId,
    );
  };

  /** Open the values dialog for the SQL on screen, without waiting for a run. */
  const editVariables = () => {
    const tab = current();
    if (!tab) return;
    const sql = sqlOfTab(tab.id);
    const variables = findVariables(sql, dialectOfTab(tab.id));
    if (variables.length === 0) return;
    setVarPrompt({ tabId: tab.id, sql, scope: "document", variables, values: varsOfTab(tab.id) });
  };

  /** Whether the editor's text carries variables, for the toolbar button. */
  const hasVariables = () => {
    const tab = current();
    return !!tab && findVariables(sqlOfTab(tab.id), dialectOfTab(tab.id)).length > 0;
  };

  // --- The editor's run toolbar and its result (issue #691) -----------------
  // Where the run on screen failed: the statement as sent and the line its
  // engine blamed. The editor marks that line; the result panel links to it.
  const errorMark = createMemo<ErrorMark | null>(() => {
    const r = currentResult();
    if (r.loading || !r.error || !r.errorSql) return null;
    return { sql: r.errorSql, line: errorLine(r.error) };
  });
  // The same place as a line of the editor, for «Ir a la línea N». Null when
  // the editor no longer holds the statement. `named`: the engine named the line.
  const errorPlace = createMemo(() => {
    const mark = errorMark();
    const tab = current();
    if (!mark || !tab) return null;
    const doc = sqlOfTab(tab.id);
    const at = errorOffset(doc, mark.sql, mark.line);
    if (at === null) return null;
    return { line: doc.slice(0, at).split("\n").length, named: mark.line !== null };
  });

  // The connection selector: the tab's databases (on the focused connection,
  // which owns the working-database list), then the other open connections.
  const editorConnItems = (tab: Tab): MenuItem[] => {
    const conn = tabConn(tab);
    const items: MenuItem[] = [];
    if (conn && conn.defId === focusedDefId() && databases().length > 0) {
      items.push({ label: t("editor.connMenuDbs"), disabled: true });
      for (const db of databases()) {
        items.push({
          label: db,
          hint: db === activeDb() ? t("editor.connCurrent") : undefined,
          action: () => selectDb(db),
        });
      }
    }
    const others = openConns().filter((o) => o.defId !== conn?.defId);
    if (others.length > 0) {
      if (items.length) items.push({ separator: true });
      items.push({ label: t("editor.connMenuConns"), disabled: true });
      for (const o of others) {
        items.push({
          label: o.name,
          hint: driverSchema(o.driver)?.label ?? o.driver,
          action: () => {
            setTabs((st) => bindTabConn(st, tab.id, o.defId));
            setFocusedDefId(o.defId);
          },
        });
      }
    }
    if (items.length === 0) items.push({ label: conn ? conn.name : t("editor.noConn"), disabled: true });
    return items;
  };

  // «Más»: everything the run toolbar does not show (R-20).
  const editorMoreItems = (e: MouseEvent, tab: Tab): MenuItem[] => [
    { label: t("editor.plan"), hint: displayKeys("Mod+Shift+E", isMac()), action: explainActive },
    ...(hasVariables() ? [{ label: t("vars.button"), action: editVariables }] : []),
    { separator: true },
    {
      label: t("editor.history"),
      action: () => showTool("history", t("editor.history"), { key: "history" }),
    },
    { label: t("hist.recentTitle"), action: () => openRecentHistory(e, tab) },
    { label: t("lhist.menu"), action: () => openLocalHistory(tab.id) },
    { separator: true },
    { label: t("editor.openFile"), action: openSqlFile },
    {
      label: t("editor.saveFile"),
      action: () => void saveText(sqlFileName(tab.title), sqlOfTab(tab.id), "application/sql"),
    },
    { separator: true },
    {
      label: t("editor.saveSnippetMenu"),
      hint: displayKeys("Mod+Shift+S", isMac()),
      action: requestSaveSnippet,
    },
    {
      label: t("editor.snippets"),
      action: () => showTool("snippets", t("editor.snippets"), { key: "snippets" }),
    },
  ];

  // The editor's run (Ctrl+Enter / "Ejecutar"). When the tab still shows a table
  // preview and its SQL is unchanged, re-run through the preview path so paging
  // (offset / has-more) is preserved; anything else is a plain query.
  const runEditor = (sql: string, scope: RunScope = "statement") => {
    const t = current();
    const r = t ? results[t.id] : undefined;
    if (t && r?.preview && sql.trim() === (r.pageSql ?? "").trim()) {
      void runPreviewPage(t.id, r.preview, r.offset ?? 0);
      return;
    }
    if (!t) return;
    runWithVariables(t.id, sql, scope);
  };

  // Show the execution plan of the active query (issue #131): build the EXPLAIN
  // for the engine and run it as a normal (read-only) result in the grid. The
  // editor text is left untouched. Honest errors for empty SQL, no connection,
  // or an engine without an inline EXPLAIN.
  // Open the visual execution plan (issue #187) for a statement as a tool tab.
  // The ExplainPlan component runs the structured EXPLAIN and renders the tree;
  // it handles unsupported engines / no connection honestly on its own.
  const showExplainPlan = (rawSql: string, connDefId?: string) => {
    const sql = rawSql.trim();
    if (!sql) return;
    // Bind the plan to the originating tab's connection so it explains against
    // the right server; without one it falls back to the focused connection.
    showTool("explainPlan", t("tab.explainPlan"), {
      key: `plan:${sql}`,
      params: { sql },
      ...(connDefId ? { connDefId } : {}),
    });
  };

  // The editor's "Plan" button: visual plan for the active tab's SQL, against
  // that tab's own connection.
  const explainActive = () => {
    const tab = current();
    if (!tab) return;
    const sql = sqlOfTab(tab.id).trim();
    if (!sql) {
      setResults(tab.id, { ...emptyResult(), error: t("error.emptyQuery") });
      return;
    }
    // A query tab shows the plan in its own result pane, under «Plan» (#691);
    // anything else keeps the plan's tool tab.
    if (tab.kind === "query" && !isDataTab(tab.id)) {
      setPlanSqls(tab.id, sql);
      setResultViews(tab.id, "plan");
      return;
    }
    showExplainPlan(sql, tab.kind === "query" ? tab.connDefId : undefined);
  };

  // A data tab's extra entries in the result toolbar's Más menu: the editor
  // actions it has no bar of its own for. A function rather than a conditional
  // inline in the JSX prop: Solid compiles an inline ternary there into a memo
  // owned by the tab's <Show>, which re-ran when a menu action switched to
  // another tab and threw "Stale read from <Show>" — so every Más action that
  // opens a tool (Transferir, Sincronizar…) did nothing.
  const dataTabMoreItems = (tabId: number): MenuItem[] | undefined =>
    isDataTab(tabId)
      ? [
          { label: t("editor.plan"), action: explainActive },
          {
            label: t("editor.history"),
            action: () => showTool("history", t("editor.history"), { key: "history" }),
          },
          {
            label: t("editor.snippets"),
            action: () => showTool("snippets", t("editor.snippets"), { key: "snippets" }),
          },
        ]
      : undefined;

  // EXPLAIN an arbitrary statement (e.g. a slow query, issue #180) as a visual plan.
  const explainSql = (sql: string) => showExplainPlan(sql);

  // --- Object tree actions (issues #19, #20) -----------------------------
  // Open a table's data: a fresh tab with a SELECT, executed immediately. The
  // table is qualified with its db/schema context so the query is correct on
  // engines (or attached databases) where the bare name would be ambiguous.
  const openData = (node: TreeNode) => {
    recordRecent(node);
    syncWorkingDb(node.db);
    // Already open? Go there (issue #414). Clicking a table twice used to stack
    // a second tab with the same name. Deliberately just FOCUS: the tab may hold
    // an edit transaction with uncommitted changes, or SQL the user has since
    // changed, and re-running it or rewriting the text would be a worse bug than
    // the duplicate it fixes. F5 is how you refresh.
    const key = objectTabKey({
      connDefId: focusedDefId() ?? undefined,
      db: node.db,
      schema: node.schema,
      name: node.label,
      kind: "data",
    });
    const already = findObjectTab(tabs(), key);
    if (already) {
      setTabs((s) => ({ ...s, activeId: already.id }));
      return;
    }
    // A paged "open table" preview (issue #134): a qualified SELECT for relational
    // engines (Informix uses db:owner.table + SKIP/FIRST), or db.<collection>.find()
    // for MongoDB. Paging regenerates this with a server-side offset — see
    // runPreviewPage / objectPreviewQuery.
    const preview = {
      parts: { db: node.db, schema: node.schema, name: node.label },
      engine: activeDialect(),
    };
    const sql = objectPreviewQuery(preview.parts, preview.engine, pageSize());
    let newId = 0;
    setTabs((s) => {
      // The tab is named after the object it opens, not "Consulta N".
      const added = addTab(s, node.label, focusedDefId() ?? undefined, false);
      newId = added.activeId;
      // The key goes on AFTER the SQL: updateTabSql is also what paging and the
      // filter panel call, so the identity must not be something writing the SQL
      // could clear.
      return setObjectKey(updateTabSql(added, newId, sql), newId, key);
    });
    void (async () => {
      await runPreviewPage(newId, preview, 0);
      const conn = active();
      if (!conn) return;
      // Fetch the table's primary key so the grid knows if it can be edited.
      try {
        const desc = await schemaDescribe(conn.connId, node.label, node.db, node.schema);
        // Feed this table's columns into the autocomplete cache (lazy schema).
        const names = describeColumnNames(desc);
        rememberColumns(conn, node.label, names);
        // And into the filter panel, which needs the same describe: the names to
        // offer, and the declared types to quote each value the way its column
        // expects (issue #347).
        setDataCols(newId, { columns: names, types: describeColumnTypes(desc) });
        const source: EditSource = {
          table: node.label,
          db: node.db,
          schema: node.schema,
          pk: describePkColumns(desc),
        };
        if (results[newId]) {
          setResults(newId, "source", source);
        }
      } catch {
        /* describe failed: the tab stays read-only (no source). */
      }
    })();
  };

  // --- Data editing (issues #26/#27/#28/#29) -----------------------------
  const errMsg = (e: unknown) => errorText(e);

  const patchEdit = (id: number, patch: Partial<EditSessionState>) =>
    setEdits(id, (e) => ({ ...(e ?? emptyEdit()), ...patch }));

  const mutatePending = (id: number, fn: (p: PendingChanges) => PendingChanges) =>
    setEdits(id, (e) => {
      const s = e ?? emptyEdit();
      return { ...s, pending: fn(s.pending) };
    });

  // Grid change hooks (record into the pending set of the active tab). `value`
  // is `string | null` because a SQL NULL is not an empty string (issue #398):
  // the whole chain below — PendingChanges, row.update/row.insert, the drivers'
  // sb_literal — already tells them apart, so the UI must too.
  const onEditCell = (rowIndex: number, column: string, value: string | null) => {
    const t = current();
    if (t) mutatePending(t.id, (p) => setCell(p, rowIndex, column, value));
  };
  const onRevertCell = (rowIndex: number, column: string) => {
    const t = current();
    if (t) mutatePending(t.id, (p) => revertCell(p, rowIndex, column));
  };
  const onRevertRow = (rowIndex: number) => {
    const t = current();
    if (t) mutatePending(t.id, (p) => revertRow(p, rowIndex));
  };
  const onToggleDelete = (rowIndex: number) => {
    const t = current();
    if (t) mutatePending(t.id, (p) => toggleDelete(p, rowIndex));
  };
  const onToggleDeleteRows = (rows: number[]) => {
    const t = current();
    if (t) mutatePending(t.id, (p) => toggleDeleteRows(p, rows));
  };
  const onInsertCell = (insertIndex: number, column: string, value: string | null) => {
    const t = current();
    if (t) mutatePending(t.id, (p) => setInsertCell(p, insertIndex, column, value));
  };
  const onRemoveInsert = (insertIndex: number) => {
    const t = current();
    if (t) mutatePending(t.id, (p) => removeInsert(p, insertIndex));
  };
  const onAddInsert = () => {
    const t = current();
    if (t) mutatePending(t.id, (p) => addInsert(p));
  };

  // Foreign-key pickers (issue: "¿qué datos puedo usar en esta llave foránea?").
  // On entering edit mode, read the table's REAL foreign keys from the engine's
  // catalog (utils/foreignKeys — the same source the ER diagram uses, no name
  // guessing) and fetch a bounded list of each referenced table's rows. The
  // pickers then suggest those values in the grid and the row detail. Entirely
  // best-effort and out of band: an engine without FK metadata, a failing catalog
  // query or a missing referenced table just means no picker, never a broken edit.
  const loadFkLookups = async (tabId: number, conn: ActiveConnection) => {
    const src = results[tabId]?.source;
    // Already loaded for the result currently in the tab (it is cleared whenever
    // the tab runs something else), so re-entering edit mode costs no queries.
    if (!src || Object.keys(fkLookups[tabId] ?? {}).length > 0) return;
    const engine = conn.driver;
    // Scope the catalog to THIS table: a whole-database FK listing is capped by
    // query.run's row limit, so in a schema with thousands of keys the table we
    // are editing can fall past the cut and silently get no picker.
    const plan = foreignKeysFor(engine, src.db, { table: src.table, direction: "from" });
    if (!plan.supported || !plan.bulkSql) return;
    try {
      const res = await runQuery(conn.connId, plan.bulkSql, FK_CATALOG_LIMIT);
      const fks = parseForeignKeys(res.columns, res.rows);
      const refs = fkColumnsOf(fks, src.table);
      for (const [column, ref] of Object.entries(refs)) {
        try {
          const rows = await runQuery(
            conn.connId,
            fkLookupSql(ref, engine, { db: src.db, schema: src.schema }),
            FK_LOOKUP_LIMIT, // explicit: never lean on the core's default cap
          );
          const lookup = buildLookup(ref, rows);
          if (!lookup) continue; // empty table, or the key column isn't in it
          setFkLookups(tabId, (m) => ({ ...(m ?? {}), [column]: lookup }));
        } catch {
          /* that referenced table can't be listed: no picker for this column. */
        }
      }
    } catch {
      /* no FK metadata: every column stays a plain free-text input. */
    }
  };

  // --- Related data (issue #310) -----------------------------------------
  // --- The data tab's filter panel (issue #347) --------------------------
  // A tab opened from the tree browses a table through this instead of through
  // the editor, and what it writes becomes the WHERE/ORDER BY of the paged
  // preview above. Per tab, because two tables open at once filter separately.
  const [filters, setFilters] = createStore<Record<number, FilterState>>({});
  const [dataCols, setDataCols] = createStore<
    Record<number, { columns: string[]; types: ColumnTypes }>
  >({});

  /** A tab that shows a table's rows rather than a query the user wrote. Mongo
      is excluded: its preview is find({}), not a SELECT, so the panel would be
      offering something it cannot build. */
  // What the status bar's facts belong to (issue #693).
  const [editorCursor, setEditorCursor] = createSignal<{ line: number; col: number } | null>(null);
  const statusKind = (): StatusTabKind => {
    const tab = current();
    if (!tab) return "none";
    if (tab.kind === "tool") return "tool";
    return isDataTab(tab.id) ? "data" : "query";
  };
  const isDataTab = (id: number): boolean => {
    const preview = results[id]?.preview;
    return !!preview && engineFamily(preview.engine) !== "mongodb";
  };

  // --- Local history of the editor tabs (issue #674) ----------------------
  // Versions of each query tab's text, taken on run, every AUTO_SNAPSHOT_MS
  // while it changes, on close and on restore. A data tab is left out: its SQL
  // is the generated page query, not something the user wrote.
  const localRetention = (): Retention => ({
    maxVersions: settings().localHistoryVersions,
    maxDays: settings().localHistoryDays,
  });
  const [localHist, setLocalHist] = createSignal<TabHistory[]>(loadLocalHistory());
  // Said once, not on every snapshot: a tab too big to keep is warned about
  // until it records again, a failing store until a write succeeds.
  const [localWarn, setLocalWarn] = createSignal<string | null>(null);

  // --- Notification history (issue #693) ---------------------------------
  // Every toast that matters is also written to the history behind the bell,
  // so a message that left before it was read is still there. Logged from the
  // toast signals themselves: one place, whoever raised the toast.
  const [noteLog, setNoteLog] = createSignal<NoteLog>(loadNotes(resolveStore(), Date.now()));
  const [notesOpen, setNotesOpen] = createSignal(false);
  createEffect(on(noteLog, (l) => saveNotes(resolveStore(), l), { defer: true }));
  const notify = (level: NoteLevel, text: string) =>
    setNoteLog((l) => ({ ...l, notes: pushNote(l.notes, { at: Date.now(), level, text }) }));
  const toggleNotes = () => {
    if (!notesOpen()) setNoteLog((l) => ({ ...l, seenAt: Date.now() }));
    setNotesOpen((o) => !o);
  };
  const logToast = <T,>(sig: () => T | null, note: (v: T) => [NoteLevel, string] | null) =>
    createEffect(
      on(sig, (v) => {
        const n = v === null ? null : note(v);
        if (n) notify(n[0], n[1]);
      }),
    );
  logToast(snipToast, (v) => ["info", v.text]);
  // Progress updates are not news; the outcome is.
  logToast(exportStatus, (v) => (v.rows === undefined ? [v.error ? "error" : "ok", v.text] : null));
  logToast(localWarn, (v) => ["warn", v]);
  logToast(runToast, (v) => [v.error ? "error" : "ok", v.text]);
  logToast(cacheNotice, (v) => ["warn", v]);
  logToast(notice, (v) => ["info", v]);
  logToast(connError, (v) => ["error", v]);
  const tooBigWarned = new Set<number>();
  let saveFailWarned = false;
  const commitLocal = (list: TabHistory[]) => {
    setLocalHist(list);
    if (saveLocalHistory(list)) {
      saveFailWarned = false;
    } else if (!saveFailWarned) {
      saveFailWarned = true;
      setLocalWarn(t("lhist.saveFailed"));
    }
  };
  const recordLocal = (tab: QueryTab, reason: VersionReason) => {
    const { list, outcome } = recordVersion(
      localHist(),
      tab,
      reason,
      Date.now(),
      localRetention(),
    );
    if (outcome === "tooBig") {
      if (!tooBigWarned.has(tab.id)) {
        tooBigWarned.add(tab.id);
        setLocalWarn(
          t("lhist.tooBig", {
            title: tab.title,
            n: tab.sql.length.toLocaleString(),
            max: MAX_VERSION_CHARS.toLocaleString(),
          }),
        );
      }
    } else if (outcome === "recorded") {
      tooBigWarned.delete(tab.id);
      commitLocal(list);
    }
  };
  const editorTabs = (): QueryTab[] =>
    tabs().tabs.filter((x): x is QueryTab => x.kind === "query" && !isDataTab(x.id));
  // Retention applies when it changes, and once at start (age limits).
  createEffect(() => {
    const retention = localRetention();
    commitLocal(pruneHistory(untrack(localHist), retention, Date.now()));
  });
  const autoTimer = setInterval(() => {
    for (const tab of editorTabs()) recordLocal(tab, "auto");
  }, AUTO_SNAPSHOT_MS);
  onCleanup(() => clearInterval(autoTimer));
  // A tab that disappears (closed one by one, with "close the others", on
  // disconnect) gets its last text recorded. Watched here rather than in each
  // close path so no path can be missed.
  let openEditorTabs = new Map<number, QueryTab>();
  createEffect(() => {
    tabs(); // track the tab list itself
    const now = new Map(untrack(editorTabs).map((x) => [x.id, x] as const));
    for (const [id, tab] of openEditorTabs) if (!now.has(id)) recordLocal(tab, "close");
    openEditorTabs = now;
  });
  const openLocalHistory = (tabId: number) =>
    showTool("localHistory", t("lhist.tabTitle"), { key: "localHistory", params: { tabId } });
  // Restoring keeps what the tab held first, so the restore can be undone.
  const restoreLocal = (tabId: number, sql: string) => {
    const tab = tabs().tabs.find((x): x is QueryTab => x.kind === "query" && x.id === tabId);
    if (!tab) return;
    recordLocal(tab, "auto");
    recordLocal({ ...tab, sql }, "restore");
    setTabs((st) => updateTabSql(st, tabId, sql));
  };
  const localSqlOf = (tabId: number): string | undefined => {
    const tab = tabs().tabs.find((x) => x.id === tabId);
    return tab?.kind === "query" ? tab.sql : undefined;
  };
  const filterOf = (id: number): FilterState => filters[id] ?? emptyFilter();
  const colsOf = (id: number) => dataCols[id] ?? { columns: [], types: {} };
  const filterDirty = (id: number): boolean => {
    const engine = results[id]?.preview?.engine ?? "";
    return filterIsDirty(engine, filterOf(id), colsOf(id).types);
  };

  /** Ensure the tab has a filter entry before writing into a path of it. */
  const withFilter = (id: number, fn: (state: FilterState) => FilterState) => {
    setFilters(id, fn(filterOf(id)));
  };

  /**
   * A header click on a data tab sorts at the server: it writes the ORDER BY
   * into the panel and re-runs the page (issue #347). Clicking a header always
   * looked like it sorted the table; over a truncated result it reordered
   * whichever rows had been fetched, which is a different answer entirely.
   */
  const sortDataColumn = (id: number, column: string) => {
    const preview = results[id]?.preview;
    if (!preview) return;
    withFilter(id, (f) =>
      applyFilter(
        preview.engine,
        { ...f, order: cycleSortColumn(f.order, column) },
        colsOf(id).types,
      ),
    );
    void runPreviewPage(id, preview, 0);
  };

  const applyDataFilter = (id: number) => {
    const preview = results[id]?.preview;
    if (!preview) return;
    withFilter(id, (f) => applyFilter(preview.engine, f, colsOf(id).types));
    void runPreviewPage(id, preview, 0);
  };

  const clearDataFilter = (id: number) => {
    const preview = results[id]?.preview;
    withFilter(id, (f) => ({ ...emptyFilter(), collapsed: f.collapsed }));
    if (preview) void runPreviewPage(id, preview, 0);
  };

  // The INBOUND foreign keys of the focused result's table: which tables depend
  // on it. Loaded once per tab so the grid can mark the referenced columns and
  // the cell menu can offer the modal without a round trip per right-click.
  const [inbound, setInbound] = createStore<
    Record<number, { rels: ForeignKeyRelation[]; truncated: boolean; reason: string | null }>
  >({});

  const loadInboundFks = async (tabId: number, conn: ActiveConnection) => {
    const src = results[tabId]?.source;
    if (!src || inbound[tabId]) return;
    const plan = foreignKeysFor(conn.driver, src.db, { table: src.table, direction: "to" });
    if (!plan.supported || !plan.bulkSql) {
      setInbound(tabId, { rels: [], truncated: false, reason: plan.reason });
      return;
    }
    try {
      const res = await runQuery(conn.connId, plan.bulkSql, FK_CATALOG_LIMIT);
      setInbound(tabId, {
        rels: groupForeignKeys(parseForeignKeys(res.columns, res.rows)),
        truncated: res.truncated,
        reason: null,
      });
    } catch (err) {
      // No marks and no action, rather than a wrong list — but say why, or a
      // failed catalog query reads as "this table has no relations" (#552).
      setInbound(tabId, {
        rels: [],
        truncated: false,
        reason: t("related.catalogFailed", { detail: errorText(err) }),
      });
    }
  };

  // The OUTBOUND foreign keys of the same table: which row each of its own key
  // columns points AT. Same catalog, opposite direction — the lookup half of
  // "related data" (issue #364), which until now existed only while editing a
  // cell, as a value picker.
  const [outbound, setOutbound] = createStore<
    Record<number, { rels: ForeignKeyRelation[] }>
  >({});

  const loadOutboundFks = async (tabId: number, conn: ActiveConnection) => {
    const src = results[tabId]?.source;
    if (!src || outbound[tabId]) return;
    const plan = foreignKeysFor(conn.driver, src.db, { table: src.table, direction: "from" });
    if (!plan.supported || !plan.bulkSql) {
      setOutbound(tabId, { rels: [] });
      return;
    }
    try {
      const res = await runQuery(conn.connId, plan.bulkSql, FK_CATALOG_LIMIT);
      setOutbound(tabId, { rels: groupForeignKeys(parseForeignKeys(res.columns, res.rows)) });
    } catch {
      setOutbound(tabId, { rels: [] });
    }
  };

  /** This table's own foreign keys, read from the other end: one relation per
      key, pointing at the row the cell references. */
  const parentRelations = (tabId: number): ForeignKeyRelation[] =>
    (outbound[tabId]?.rels ?? []).map(invertRelation);

  // Load them as soon as a result knows which table it came from.
  createEffect(() => {
    const tab = current();
    const conn = tabConn(tab);
    if (!tab || !conn || !results[tab.id]?.source?.table) return;
    if (!inbound[tab.id]) void loadInboundFks(tab.id, conn);
    if (!outbound[tab.id]) void loadOutboundFks(tab.id, conn);
  });

  /**
   * The sentence the cell menu shows in place of the related-data action, or
   * null when the action is available. Every branch names a different cause, so
   * "it stopped appearing" becomes something a user can read and act on.
   */
  const relatedBlockedReason = (column: string): string | null => {
    const tab = current();
    const state = relatedAvailability({
      hasSourceTable: !!(tab && results[tab.id]?.source?.table),
      inbound: tab ? inbound[tab.id] : undefined,
      parentColumns: tab
        ? parentRelations(tab.id).flatMap((r) => r.columns.map((c) => c.to))
        : [],
      column,
    });
    switch (state.kind) {
      case "ok":
        return null;
      case "noTable":
        return t("related.needsTable");
      case "checking":
        return t("related.checking");
      case "unsupported":
        return state.reason;
      case "noReferences":
        return t("related.noReferences");
      case "otherColumn":
        return t("related.otherColumn", { columns: state.columns.join(", ") });
    }
  };

  /** Columns of the focused result that lead somewhere: referenced by another
      table (their dependents) or foreign keys themselves (their parent row).
      Both get the cell affordance, because from the user's side it is the same
      question — "what else is attached to this value?". */
  // Where this table's own foreign keys point, by column (issue #690): the
  // grid header shows "integer → clientes.id".
  const foreignKeyTargets = createMemo(() => {
    const tab = current();
    const out: Record<string, string> = {};
    for (const rel of tab ? (outbound[tab.id]?.rels ?? []) : []) {
      for (const c of rel.columns) out[c.from] ??= `${rel.toTable}.${c.to}`;
    }
    return out;
  });

  const referencedColumns = createMemo(() => {
    const tab = current();
    if (!tab) return [];
    const children = inbound[tab.id]?.rels ?? [];
    const parents = parentRelations(tab.id);
    return [
      ...new Set([...children, ...parents].flatMap((r) => r.columns.map((c) => c.to))),
    ];
  });

  const emptyRelated = () => ({
    open: false,
    table: "",
    column: "",
    value: "",
    queries: [] as RelatedQuery[],
    counts: {} as Record<number, number | null>,
    selected: 0,
    sql: null as string | null,
    result: null as ResultSet | null,
    loading: false,
    error: null as string | null,
    truncated: false,
    unsupported: null as string | null,
    keyColumns: [] as string[],
    // The connection and scope the modal was opened from, pinned at open time:
    // it now outlives the tab it came from (issue #464), so it cannot go on
    // reading them off whatever tab happens to be active.
    connId: "",
    driver: "",
    db: undefined as string | undefined,
    schema: undefined as string | undefined,
  });
  const [related, setRelated] = createStore(emptyRelated());

  const closeRelated = () => setRelated(emptyRelated());

  /** Open the modal for the cell at (rowIndex, colIndex) of the focused result. */
  const openRelated = (rowIndex: number, colIndex: number) => {
    const tab = current();
    const conn = tabConn(tab);
    const res = currentResult().result;
    const src = tab ? results[tab.id]?.source : null;
    if (!tab || !conn || !res || !src) return;
    const column = res.columns[colIndex]?.name;
    const row = res.rows[rowIndex];
    if (!column || !row) return;
    const state = inbound[tab.id];
    // The row this cell points at first (one row, the answer to "which one is
    // it?"), then the rows that point at this one.
    const parents = relatedQueries(
      relationsForColumn(parentRelations(tab.id), column),
      res.columns,
      row,
      conn.driver,
    ).map((q) => ({ ...q, parent: true }));
    const children = relatedQueries(
      relationsForColumn(state?.rels ?? [], column),
      res.columns,
      row,
      conn.driver,
    );
    const queries = [...parents, ...children];
    setRelated({
      ...emptyRelated(),
      open: true,
      table: src.table,
      column,
      value: row[colIndex] ?? "NULL",
      queries,
      truncated: state?.truncated ?? false,
      unsupported: queries.length === 0 ? (state?.reason ?? null) : null,
      connId: conn.connId,
      driver: conn.driver,
      db: src.db,
      schema: src.schema,
    });
    if (queries.length > 0) {
      void runRelated(0);
      void countRelated(conn, src, queries);
    }
  };

  /** Run the selected relationship's SELECT into the modal's grid. */
  const runRelated = async (index: number) => {
    const query = related.queries[index];
    if (!related.connId || !query) return;
    const scope = { db: related.db, schema: related.schema };
    const sql = relatedSelect(query, related.driver, scope);
    setRelated({
      selected: index,
      sql,
      result: null,
      error: null,
      loading: sql !== null,
      keyColumns: [],
    });
    if (!sql) return;
    try {
      setRelated("result", await runQuery(related.connId, sql, RELATED_LIMIT));
      setRelated("loading", false);
    } catch (err) {
      setRelated({ loading: false, error: errMsg(err) });
      return;
    }
    // Which column identifies a row of the DEPENDENT table. Out of band and
    // best-effort: the rows are already on screen, and a table whose key cannot
    // be described simply goes unmarked rather than holding up the result.
    const dependent = query.relation.fromTable;
    try {
      const desc = await schemaDescribe(related.connId, dependent, scope.db, scope.schema);
      if (related.queries[related.selected]?.relation.fromTable === dependent) {
        setRelated("keyColumns", describePkColumns(desc));
      }
    } catch {
      /* no catalog access: no mark, rather than a wrong one */
    }
  };

  /**
   * Count each relationship's dependent rows. Sequential on purpose: a single
   * COUNT per relationship is the point, but firing them all at once would pile
   * up on engines that serialize a connection (Informix).
   */
  const countRelated = async (
    conn: ActiveConnection,
    src: { db?: string; schema?: string },
    queries: RelatedQuery[],
  ) => {
    for (let i = 0; i < queries.length; i++) {
      const sql = relatedCount(queries[i], conn.driver, { db: src.db, schema: src.schema });
      if (!sql) {
        setRelated("counts", i, null); // cannot be filtered: unknown, not zero
        continue;
      }
      try {
        const res = await runQuery(conn.connId, sql, 1);
        const n = Number(res.rows[0]?.[0] ?? NaN);
        setRelated("counts", i, Number.isFinite(n) ? n : null);
      } catch {
        setRelated("counts", i, null);
      }
      if (!related.open) return; // the user closed it; stop querying
    }
  };

  /**
   * Carry the modal's query out into a NEW tab and run it there — new because
   * the SQL editor only reloads its document when the active tab changes.
   *
   * The modal stays open (issue #464): the whole point of the list on the left
   * is to walk several relationships, and closing on the first one made that a
   * round trip through the cell menu each time.
   */
  const relatedToTab = () => {
    const sql = related.sql;
    const table = related.queries[related.selected]?.relation.fromTable;
    if (!sql || !table) return;
    let newId = 0;
    setTabs((s) => {
      const added = addTab(s, table, focusedDefId() ?? undefined, false);
      newId = added.activeId;
      return updateTabSql(added, newId, sql);
    });
    void run(sql);
  };

  // A data-search hit (issue #671): the table's matches in a fresh query tab on
  // the search's own connection, run straight away like the related-data jump.
  const openSearchMatches = (sql: string, table: string, connDefId?: string) => {
    let newId = 0;
    setTabs((s) => {
      const added = addTab(s, table, connDefId ?? focusedDefId() ?? undefined, false);
      newId = added.activeId;
      return updateTabSql(added, newId, sql);
    });
    void run(sql);
  };

  const beginEdit = async () => {
    const t = current();
    const conn = tabConn(t);
    if (!t || !conn || !currentEditable()) return;
    const blocked = txEditBlocked(conn);
    if (blocked) {
      patchEdit(t.id, { error: blocked });
      return;
    }
    patchEdit(t.id, { busy: true, error: null });
    try {
      await txBeginIfSupported(conn.connId);
      patchEdit(t.id, { editing: true, pending: emptyPending(), busy: false });
      // Fill the pickers while the user starts typing; they appear as they land.
      void loadFkLookups(t.id, conn);
      void loadUniqueIndexes(t.id, conn);
    } catch (err) {
      patchEdit(t.id, { busy: false, error: errMsg(err) });
    }
  };

  // Refresh what the tab is SHOWING. A table preview reloads its current page
  // through the preview path so the descriptor + server-side offset survive
  // (re-running the paged SQL as a plain query would double-apply the baked
  // OFFSET and lose paging); anything else re-runs the SQL that produced the
  // page. Never the editor's text: it may have been changed since the query ran,
  // and refreshing after a row edit would then execute a statement the user
  // never asked to run (issue #314).
  const reloadCurrent = (id: number) => {
    const r = results[id];
    const action = refreshAction(r);
    if (!action) return;
    if (action.kind === "preview") {
      void runPreviewPage(id, r.preview!, action.offset);
      return;
    }
    void run(action.sql, r?.ranScope ?? "document", action.offset, id);
  };

  /**
   * Why the toolbar's refresh cannot run right now, translated, or null (#448).
   * The policy itself is pure and tested (refreshBlock); this only names it.
   */
  const refreshBlockedReason = (id: number): string | null => {
    const block = refreshBlock(results[id], {
      editing: edits[id]?.editing ?? false,
      loading: results[id]?.loading ?? false,
    });
    return block === null ? null : t(`objbar.refreshBlocked.${block}`);
  };

  const discardEdit = async () => {
    const t = current();
    const conn = tabConn(t);
    if (!t || !conn) return;
    patchEdit(t.id, { busy: true });
    try {
      await txRollback(conn.connId);
    } catch {
      /* best-effort rollback */
    }
    setEdits(t.id, emptyEdit());
    reloadCurrent(t.id);
  };

  // Confirmar: gather the generated SQL for every pending change (preview only)
  // and show it for confirmation before anything is executed (issue #29).
  const confirmEdit = async () => {
    const tab = current();
    const conn = tabConn(tab);
    const res = currentResult();
    if (!tab || !conn || !res.result || !res.source) return;
    // Saving needs the connection (R-05): the changes wait, kept, until it is back.
    if (conn.lost) return;
    // A new row already known to collide would only fail inside the
    // transaction (#517); every road to saving — the bar, the toolbar, Ctrl+S —
    // passes through here, so this is the one place that blocks it.
    const conflicts = currentConflicts().size;
    if (conflicts > 0) {
      patchEdit(tab.id, { error: t("pending.blockedConfirm", { n: conflicts }) });
      return;
    }
    const plan = buildPlan(res.source, res.result.columns, res.result.rows,
                           currentEdit().pending);
    if (plan.length === 0) {
      patchEdit(tab.id, { error: t("edit.noChanges") });
      return;
    }
    const target = { table: res.source.table, db: res.source.db, schema: res.source.schema };
    patchEdit(tab.id, { busy: true, error: null });
    try {
      const sqls: string[] = [];
      for (const item of plan) {
        const r = await runPlanItem(conn.connId, target, item, true);
        sqls.push(r.sql);
      }
      patchEdit(tab.id, { busy: false, preview: sqls });
    } catch (err) {
      patchEdit(tab.id, { busy: false, error: errMsg(err) });
    }
  };

  // Rows staged for deletion are named before anything runs (audit P1, rule 7):
  // each by its key, with the tables whose foreign keys point at this one.
  const [confirmDeleteRows, setConfirmDeleteRows] = createSignal(false);
  const deleteRowsText = () => {
    const tab = current();
    const res = currentResult();
    const src = res.source;
    const rs = res.result;
    const dels = currentEdit().pending.deletes;
    if (!tab || !src || !rs || dels.length === 0) return null;
    const pkAt = src.pk.map((c) => rs.columns.findIndex((col) => col.name === c));
    const rows = dels.map((r) =>
      src.pk.length > 0
        ? src.pk.map((c, k) => `${c} ${rs.rows[r]?.[pkAt[k]] ?? "NULL"}`).join(" · ")
        : `#${r + 1}`,
    );
    const deps = (inbound[tab.id]?.rels ?? []).map(
      (rel) => `${rel.fromTable}.${rel.columns.map((c) => c.from).join(", ")}`,
    );
    return deleteRowsConfirm(src.table, rows, deps);
  };

  // Aplicar: execute the plan for real, then commit and reload. A failure rolls
  // the transaction back and opens a new one (utils/editApply.ts): the old
  // "leave it open to fix and retry" kept the items that had already run, so a
  // retry ran them twice — an insert that had gone through collided with itself.
  const applyEdit = async () => {
    const tab = current();
    const conn = tabConn(tab);
    const res = currentResult();
    if (!tab || !conn || !res.result || !res.source) return;
    const plan = buildPlan(res.source, res.result.columns, res.result.rows,
                           currentEdit().pending);
    const target = { table: res.source.table, db: res.source.db, schema: res.source.schema };
    patchEdit(tab.id, { busy: true, error: null, failedInsert: null });
    // On a protected connection the SQL just previewed is what is confirmed.
    let outcome: Awaited<ReturnType<typeof applyPlan>>;
    try {
      outcome = await withWriteConsent(conn.connId, currentEdit().preview ?? [], () =>
        applyPlan(plan, {
          run: (item) => runPlanItem(conn.connId, target, item, false),
          commit: () => txCommitIfOpen(conn.connId),
          rollback: () => txRollbackIfOpen(conn.connId),
          begin: async () => {
            await txBeginIfSupported(conn.connId);
          },
        }),
      );
    } catch (err) {
      patchEdit(tab.id, { busy: false, error: errMsg(err) });
      return;
    }
    if (outcome.ok) {
      setEdits(tab.id, emptyEdit());
      reloadCurrent(tab.id);
      return;
    }
    // No transaction (MongoDB): the changes before the failing one are already
    // in the database and cannot be rolled back. Keeping them in the session
    // would apply them again on a retry, so the session ends and the grid shows
    // what is really stored.
    const applied = !hasTransactions(conn.connId) && outcome.failedIndex !== null ? outcome.failedIndex : 0;
    if (applied > 0) {
      setEdits(tab.id, {
        ...emptyEdit(),
        error: t("edit.partialNoTx", { n: applied, reason: errMsg(outcome.error) }),
      });
      reloadCurrent(tab.id);
      return;
    }
    const failed = outcome.failedIndex === null ? null : plan[outcome.failedIndex];
    patchEdit(tab.id, {
      busy: false,
      preview: null,
      error: t("ssync.applyError", { reason: errMsg(outcome.error) }),
      failedInsert: failed?.kind === "insert" ? (failed.insertIndex ?? null) : null,
      // No transaction could be opened again, so the session cannot go on. The
      // pending set stays in state; editing again starts from a fresh one.
      ...(outcome.reopened ? {} : { editing: false }),
    });
  };

  const cancelPreview = () => {
    const tab = current();
    if (tab) patchEdit(tab.id, { preview: null });
  };

  const openImport = (initialText?: string) => {
    const src = currentResult().source;
    const q = currentQuery();
    if (src && active()) {
      showTool("import", t("tab.import", { name: src.table }), {
        key: `import:${src.table}`,
        params: {
          target: { table: src.table, db: src.db, schema: src.schema },
          initialText,
        },
        sourceId: q?.id,
      });
    }
  };

  // Open the test-data generator for the current table tab (issue #147).
  const openGen = () => {
    const src = currentResult().source;
    const q = currentQuery();
    if (src && active()) {
      showTool("generator", t("tab.generate", { name: src.table }), {
        key: `gen:${src.table}`,
        params: { target: { table: src.table, db: src.db, schema: src.schema } },
        sourceId: q?.id,
      });
    }
  };

  // Wizards launched from the result toolbar act on the current result; snapshot
  // what they need into the tool tab's params at open time.
  const openSchemaSync = () =>
    showTool("schemaSync", t("tab.schemaSync"), {
      key: "schemaSync",
      params: { sourceDb: currentResult().source?.db, sourceSchema: currentResult().source?.schema },
    });
  const openDataSync = () => {
    const res = currentResult();
    if (!res.result || !res.source) return;
    showTool("dataDiff", t("tab.dataSync"), {
      key: "dataDiff",
      params: {
        sourceDefId: tabConn(current())?.defId,
        source: { table: res.source.table, db: res.source.db, schema: res.source.schema },
        pk: res.source.pk,
      },
    });
  };
  // Rows the user marked in the grid (issue #382), by index into the current
  // result's rows. The grid publishes them; the copy / transfer actions below
  // narrow the result to exactly those rows and reuse the existing paths.
  const [markedRows, setMarkedRows] = createSignal<number[]>([]);
  // The cells the grid's selection covers (issues #670, #690), summarized in
  // the status bar. One cell is not summarized: it is already on screen.
  const [selectedCells, setSelectedCells] = createSignal<{ columns: number[]; rows: number[] } | null>(null);
  const cellSummary = createMemo(() => {
    const cells = selectedCells();
    const res = currentResult().result;
    if (!cells || !res || cells.columns.length * cells.rows.length < 2) return null;
    // What the grid shows: a pending edit, else the value the core sent.
    const edits = currentEdit().pending.edits;
    const columns = cells.columns.flatMap((ci) => {
      const col = res.columns[ci];
      if (!col) return [];
      const values = cells.rows.map((r) => {
        const e = edits[r];
        return e && col.name in e ? e[col.name] : (res.rows[r]?.[ci] ?? null);
      });
      return [{ values, type: col.type }];
    });
    return columns.length > 0 ? summarizeRange(columns) : null;
  });
  // Columns as rows (issue #670), held for the result it was turned on over: a
  // new run, another page or another tab shows the plain grid again, and so
  // does editing — the transposed view is read-only.
  const [transposed, setTransposed] = createSignal<{
    source: ResultSet;
    rows: number[];
    offset: number;
  } | null>(null);
  const transposedOn = createMemo(() => {
    const tr = transposed();
    return tr && tr.source === currentResult().result && !currentEdit().editing ? tr : null;
  });
  const transposedView = createMemo(() => {
    const tr = transposedOn();
    if (!tr) return null;
    return transposeResult(tr.source, tr.rows, {
      column: t("transpose.column"),
      type: t("transpose.type"),
      row: (r) => t("transpose.row", { n: tr.offset + r + 1 }),
    });
  });
  const toggleTranspose = () => {
    const res = currentResult().result;
    if (transposedOn() || !res) {
      setTransposed(null);
      return;
    }
    // The marked rows, else the selected cell's row, else (none) the page.
    const rows = markedRows().length > 0 ? markedRows() : (selectedCells()?.rows ?? []);
    // The plain grid unmounts without publishing an empty selection.
    setMarkedRows([]);
    setSelectedCells(null);
    setTransposed({ source: res, rows, offset: currentResult().offset ?? 0 });
  };
  // --- Pinned results and comparing them (issue #669) --------------------
  // A pin is the page that was on screen, copied aside per tab so the next run
  // does not replace it; it is never re-run. Bounded: past MAX_PINS per tab the
  // button is disabled and says why, rather than dropping an older pin.
  const MAX_PINS = 5;
  const [pins, setPins] = createStore<Record<number, PinnedResult[]>>({});
  let pinSeq = 0;
  // A closed tab's pins go with it: they are copies nothing else can reach.
  createEffect(() => {
    const open = new Set(tabs().tabs.map((tb) => tb.id));
    for (const id of Object.keys(pins).map(Number)) {
      if (!open.has(id) && pins[id]) setPins(id, undefined!);
    }
  });
  const tabPins = (): PinnedResult[] => {
    const tb = current();
    return (tb && pins[tb.id]) || [];
  };
  /** A side of a comparison: a pin's id, or the tab's live result. */
  type Side = number | "current";
  // What the pane shows instead of the live result. Each is held for the live
  // result it was opened over, like the transposed view: a new run, a page
  // turn, another tab or editing show the live result again.
  const [pinShown, setPinShown] = createSignal<{
    tabId: number;
    pin: number;
    live: ResultSet | null;
  } | null>(null);
  const [comparing, setComparing] = createSignal<{
    tabId: number;
    base: Side;
    other: Side;
    key: string[];
    live: ResultSet | null;
  } | null>(null);
  const holds = (v: { tabId: number; live: ResultSet | null } | null) =>
    !!v && v.tabId === current()?.id && v.live === currentResult().result && !currentEdit().editing;
  const shownPin = createMemo(() => {
    const v = pinShown();
    return holds(v) ? (tabPins().find((p) => p.id === v!.pin) ?? null) : null;
  });
  const sideOf = (s: Side) => {
    if (s === "current") {
      const r = currentResult();
      return r.result ? { result: r.result, pk: r.source?.pk ?? [], label: t("pin.current") } : null;
    }
    const p = tabPins().find((x) => x.id === s);
    return p ? { result: p.result, pk: p.pk, label: pinLabel(p) } : null;
  };
  const comparison = createMemo(() => {
    const c = comparing();
    if (!holds(c)) return null;
    const base = sideOf(c!.base);
    const other = sideOf(c!.other);
    if (!base || !other) return null;
    const cmp = compareResults(
      base.result,
      other.result,
      c!.key.length > 0 ? { by: "key", columns: c!.key } : { by: "position" },
    );
    const view = comparisonView(cmp, base.result, other.result, t("compare.status"));
    return { cmp, view, base, other, key: c!.key };
  });
  const pinBlocked = (): string | null => {
    const r = currentResult();
    if (!r.result || r.loading) return t("pin.nothing");
    if (tabPins().length >= MAX_PINS) return t("pin.full", { n: MAX_PINS });
    return null;
  };
  const pinCurrent = () => {
    const tb = current();
    const r = currentResult();
    if (!tb || !r.result || pinBlocked()) return;
    const pin: PinnedResult = {
      id: ++pinSeq,
      ranAt: r.ranAt ?? Date.now(),
      sql: r.sets?.[r.activeSet ?? 0]?.sql ?? r.pageSql ?? "",
      // A copy, not the store's object: nothing done to the live result later
      // may reach into a pin.
      result: structuredClone(unwrap(r.result)),
      offset: r.offset ?? 0,
      pk: [...(r.source?.pk ?? [])],
    };
    setPins(tb.id, (l) => [...(l ?? []), pin]);
  };
  // The alternative grids publish no marks or selection: clear what the live
  // grid left, as the transposed view does.
  const leaveLiveGrid = () => {
    setMarkedRows([]);
    setSelectedCells(null);
    setDetailIndex(null);
  };
  const showPin = (id: number | null) => {
    const tb = current();
    setComparing(null);
    if (id === null || !tb) return setPinShown(null);
    leaveLiveGrid();
    setPinShown({ tabId: tb.id, pin: id, live: currentResult().result });
  };
  const unpin = (id: number) => {
    const tb = current();
    if (tb) setPins(tb.id, (l) => (l ?? []).filter((p) => p.id !== id));
  };
  /** Compare `base` (the one chosen) → `other` (the one on screen). */
  const startCompare = (base: Side, other: Side) => {
    const tb = current();
    const b = sideOf(base);
    const o = sideOf(other);
    if (!tb || !b || !o) return;
    // By the table's primary key when a side has one and both project it;
    // otherwise by position.
    const pk = o.pk.length > 0 ? o.pk : b.pk;
    const has = (rs: ResultSet) => pk.every((k) => rs.columns.some((c) => c.name === k));
    leaveLiveGrid();
    setComparing({
      tabId: tb.id,
      base,
      other,
      key: pk.length > 0 && has(b.result) && has(o.result) ? [...pk] : [],
      live: currentResult().result,
    });
  };
  const openCompareMenu = (e: MouseEvent, shown: Side) => {
    const choices: Side[] = [
      ...(shown !== "current" && (currentResult().result?.columns.length ?? 0) > 0
        ? (["current"] as const)
        : []),
      ...tabPins()
        .map((p) => p.id)
        .filter((id) => id !== shown),
    ];
    const items: MenuItem[] =
      choices.length > 0
        ? choices.map((s) => ({ label: sideOf(s)!.label, action: () => startCompare(s, shown) }))
        : [{ label: t("pin.compareNone"), disabled: true }];
    openContextMenu(e, items);
  };
  /** How a comparison's cell is marked: changed cells, and added / removed rows. */
  const diffCellClass = (v: ComparisonView, r: number, ci: number) => {
    const s = v.status[r];
    if (v.changed[r]?.has(ci)) return "diff-changed";
    if (ci === 0 || s === "added" || s === "removed") return `diff-${s}`;
    return undefined;
  };

  // How the grid is currently drawing its columns (issue #446), as original
  // indices in display order. Copying from the grid follows what the user sees;
  // generating SQL (inserts, transfer) keeps the table's own order, which is
  // semantic rather than visual.
  const [columnOrder, setColumnOrder] = createSignal<number[]>([]);
  // --- Copying and duplicating rows (#517) -------------------------------
  // The exact copy kept beside the clipboard text: a later paste in this app
  // uses it to keep the NULLs and tabs the text form cannot carry.
  const [rowClipboard, setRowClipboard] = createSignal<RowClipboard | null>(null);
  // Bumped to clear the grid's marks from the row bar.
  const [clearMarksTick, setClearMarksTick] = createSignal(0);
  const rowSourceOf = (): RowSource | null => {
    const src = currentResult().source;
    const defId = tabConn(current())?.defId;
    return src && defId
      ? { connDefId: defId, db: src.db, schema: src.schema, table: src.table }
      : null;
  };
  const copyRowsFromGrid = (rows: number[], withHeader = false) => {
    const res = currentResult().result;
    if (!res || rows.length === 0) return;
    const clip = copyRows(res, rows, columnOrder(), rowSourceOf(), withHeader);
    setRowClipboard(clip);
    copyText(clip.text);
  };
  const copyRowsAsInserts = (rows: number[]) => {
    const res = currentResult().result;
    if (res && rows.length > 0) {
      copyText(toInserts(pickRows(res, rows), currentResult().source?.table ?? "exported"));
    }
  };
  /** Why this grid cannot take new rows, or null. */
  const addRowsBlocked = (): string | null =>
    currentEditable() ? null : readOnlyReason("result.duplicateReadOnly");
  // The last rows added as a batch, so its bar can switch the key mode and the
  // empty cells, or hand the paste to the wizard. Bound to its tab.
  const [lastPaste, setLastPaste] = createSignal<{
    tabId: number;
    batch: number;
    /** The pasted text, when the wizard could take it instead. */
    text: string | null;
    ignored: string[];
  } | null>(null);
  const currentPaste = () => {
    const lp = lastPaste();
    return lp && lp.tabId === current()?.id ? lp : null;
  };

  // New pending rows in this tab's edit session, which is opened first when
  // needed. Nothing reaches the database until the session is saved.
  const addRowsAsInserts = async (
    rows: Record<string, string | null>[],
    pkMode: PkMode,
    info: { text: string | null; fromText: boolean; ignored: string[] },
  ) => {
    const tab = current();
    if (!tab || rows.length === 0 || !currentEditable()) return;
    if (!currentEdit().editing) await beginEdit();
    // beginEdit reports its own failure; without a session there is nowhere to add.
    if (!edits[tab.id]?.editing) return;
    mutatePending(tab.id, (p) => addInserts(p, rows, pkMode, info.fromText ? true : undefined));
    const pending = edits[tab.id].pending;
    const batch = insertBatchOf(pending, pending.inserts.length - 1);
    if (batch !== null) {
      setLastPaste({ tabId: tab.id, batch, text: info.text, ignored: info.ignored });
    }
  };
  const duplicateRows = (rows: number[]) => {
    const res = currentResult().result;
    if (res) {
      void addRowsAsInserts(rowsAsInserts(res, rows), "generate", {
        text: null,
        fromText: false,
        ignored: [],
      });
    }
  };
  /** What pasting `text` over the current grid would do, or null off a table. */
  const pastePlanFor = (text: string): PastePlan | null => {
    const source = rowSourceOf();
    const res = currentResult().result;
    if (!source || !res) return null;
    const columns = applyOrder(columnOrder(), res.columns).map((c) => c.name);
    return planPaste(text, rowClipboard(), { columns, source }, { emptyAsNull: true });
  };
  const runPastePlan = (plan: PastePlan, text: string) => {
    if (plan.kind === "inserts") {
      void addRowsAsInserts(plan.rows, plan.pkMode, {
        text,
        fromText: plan.fromText,
        ignored: plan.ignoredColumns,
      });
    } else if (plan.kind === "wizard") {
      openImport(text);
    }
  };
  // The row bar's Pegar: the app's own copy, placed by column name.
  const pasteRowClipboard = () => {
    const clip = rowClipboard();
    const plan = clip ? pastePlanFor(clip.text) : null;
    if (clip && plan) runPastePlan(plan, clip.text);
  };
  const togglePastePk = () => {
    const lp = currentPaste();
    const tab = current();
    if (!lp || !tab) return;
    const mode = currentEdit().pending.pkModes?.[lp.batch];
    mutatePending(tab.id, (p) => setPkMode(p, lp.batch, mode === "generate" ? "keep" : "generate"));
  };
  const togglePasteEmptyAsNull = () => {
    const lp = currentPaste();
    const tab = current();
    if (!lp || !tab) return;
    const on = currentEdit().pending.emptyAsNull?.[lp.batch];
    mutatePending(tab.id, (p) => setBatchEmptyAsNull(p, lp.batch, !on));
  };
  // Hand the last paste to the wizard after all, taking its rows back out.
  const importLastPaste = () => {
    const lp = currentPaste();
    const tab = current();
    if (!lp?.text || !tab) return;
    mutatePending(tab.id, (p) => removeBatch(p, lp.batch));
    setLastPaste(null);
    openImport(lp.text);
  };

  // Unique indexes of the table being edited, by tab (#517), to warn about a
  // new row's duplicate values before saving. Loaded like the FK pickers: in
  // the background on entering edit mode, and a failure just means no warning.
  const [uniqueSets, setUniqueSets] = createSignal<Record<number, string[][]>>({});
  const dropUniqueSets = (tabId: number) =>
    setUniqueSets((m) => {
      if (!(tabId in m)) return m;
      const next = { ...m };
      delete next[tabId];
      return next;
    });
  const loadUniqueIndexes = async (tabId: number, conn: ActiveConnection) => {
    const src = results[tabId]?.source;
    if (!src || tabId in uniqueSets()) return;
    const list = indexListFor(conn.driver, src.table, src.db, src.schema);
    if (!list.supported || !list.sql) return;
    try {
      const res = await runQuery(conn.connId, list.sql, UNIQUE_CATALOG_LIMIT);
      const sets = uniqueSetsFrom(conn.driver, res.columns.map((c) => c.name), res.rows, src.pk);
      setUniqueSets((m) => ({ ...m, [tabId]: sets }));
    } catch {
      /* no index catalog: a duplicate is reported by the database on save */
    }
  };
  const currentConflicts = createMemo(() => {
    const tab = current();
    const res = currentResult();
    const pending = currentEdit().pending;
    if (!tab || !res.result || !res.source || pending.inserts.length === 0) {
      return new Map<number, string[]>();
    }
    return findConflicts(
      pending.inserts,
      { columns: res.result.columns.map((c) => c.name), rows: res.result.rows },
      { pk: res.source.pk, uniqueSets: uniqueSets()[tab.id] ?? [] },
      (i) => pkModeOf(pending, i),
    );
  });
  const openTransfer = (rows?: number[]) => {
    const res = currentResult();
    if (!res.result || !res.source) return;
    showTool("transfer", t("tab.transfer"), {
      key: "transfer",
      params: {
        sourceResult: rows?.length ? pickRows(res.result, rows) : res.result,
        sourceTable: res.source.table,
        // Marked rows copy just those; otherwise the whole table is offered.
        whole: rows?.length || !tabConn(current())?.defId
          ? undefined
          : { defId: tabConn(current())!.defId, db: res.source.db, schema: res.source.schema },
      },
    });
  };
  // Chart the current result (issue #149): snapshot it into the tool tab.
  const openChart = () => {
    const res = currentResult().result;
    if (!res || res.columns.length === 0) return;
    showTool("chart", t("tab.chart"), { key: "chart", params: { result: res } });
  };

  // --- Export (issue #30) ------------------------------------------------
  // Save the result to disk. pickSaveTarget prefers a native "Guardar como"
  // dialog (File System Access API in the webview) and falls back to a browser
  // download where unavailable. Client-side by design; see the M8 decision.
  /** How far the export has got, 0..100, for a status that knows its total. */
  const exportPercent = (s: { rows?: number; total?: number }): number =>
    Math.max(0, Math.min(100, Math.round(((s.rows ?? 0) / (s.total || 1)) * 100)));

  // The SQL that reads the WHOLE result behind the page on screen (issue #479),
  // or null when there is none to re-read: a script's statement is not pageable,
  // and neither is a result nobody can re-run. A table preview drops its row cap
  // (limit 0) but keeps the filter the panel applied — exporting a filtered
  // table must export the filtered rows.
  const exportSql = (tabId: number, r: TabResult): string | null => {
    if (r.sets) return null;
    if (r.preview) {
      return objectPreviewQuery(
        r.preview.parts,
        r.preview.engine,
        0,
        0,
        filters[tabId]?.applied ?? undefined,
      );
    }
    // Re-reading an UPDATE … RETURNING would write again.
    return rerunnable(r.pageSql) ? r.pageSql : null;
  };

  /**
   * Ask, in the background, how many rows the export will end up with, so the
   * progress bar can show a real percentage (issue #479).
   *
   * Only a table can answer cheaply: one aggregate over the same object and
   * filter. An arbitrary query has no total short of running it a second time,
   * and a percentage that costs more than the wait it explains is a bad trade —
   * those exports get a bar that moves without claiming to know how far along
   * it is. Failures are silent for the same reason: the bar simply stays honest.
   */
  const countForBar = (
    conn: ActiveConnection,
    r: TabResult,
    tabId: number,
    got: (n: number) => void,
  ) => {
    if (!r.preview) return;
    const sql = objectCountQuery(
      r.preview.parts,
      r.preview.engine,
      filters[tabId]?.applied ?? undefined,
    );
    if (!sql) return;
    void runQuery(conn.connId, sql, 1)
      .then((count) => {
        const n = Number(count.rows[0]?.[0]);
        if (Number.isFinite(n) && n > 0) {
          got(n);
          setExportStatus((cur) => (cur ? { ...cur, total: n } : cur));
        }
      })
      .catch(() => {
        /* no total: the bar moves without a percentage, which is honest */
      });
  };

  // Save the result as a file. Every row of it, not the page the grid happens to
  // have loaded (issue #479): the rows are re-read page by page over the core's
  // cursor and joined here. Only a result nobody can re-read (a script's
  // statement) exports what is on screen, and that one has no more rows to give.
  //
  // "Guardar como" is asked FIRST and the file written afterwards. The dialog
  // needs the user's click still to be recent, and reading a million rows takes
  // far longer than that — asking afterwards threw, and the button looked dead.
  //
  // The toolbar and the context menu first open the export dialog (audit R-36):
  // format, which rows (the whole result by default, the loaded page, or the
  // marked rows) and CSV's options; the toast then carries a Cancel.
  const [exportAsk, setExportAsk] = createSignal<AnyExportFormat | null>(null);
  let exportCtl: AbortController | null = null;
  const doExport = (format: AnyExportFormat) => {
    const res = currentResult().result;
    if (res && res.columns.length > 0) setExportAsk(format);
  };
  const runExport = async (choice: ExportChoice<AnyExportFormat>) => {
    setExportAsk(null);
    const format = choice.format;
    const tab = current();
    const r = currentResult();
    const res = r.result;
    if (!tab || !res || res.columns.length === 0) return;
    const src = r.source;
    const base = src?.table ?? tab.title ?? "export";
    const table = src?.table ?? "exported";
    const conn = tabConn(tab);
    const sql = choice.scope === "all" ? exportSql(tab.id, r) : null;
    const binary = format === "xlsx";
    const file = fileNameFor(base, binary ? "xlsx" : format);
    const target = await pickSaveTarget(file, binary ? XLSX_MIME : mimeFor(format));
    if (!target) return;  // dialog dismissed
    const ctl = new AbortController();
    exportCtl?.abort();
    exportCtl = ctl;
    const cancelled = () => {
      setExportStatus({ text: t("export.cancelled") });
      setResults(tab.id, { cursor: false });
    };
    let total: number | undefined;
    const working = (text: string, rows?: number) =>
      setExportStatus({ text, hint: t("export.hint", { file }), rows, total });

    // What the grid already holds: the pages fetched so far, in order. Those rows
    // are read; nobody has to read them again. When the last of them was not
    // truncated they are the ENTIRE result and the export touches the database
    // not at all; otherwise the cursor sitting behind them carries the rest of
    // the same execution, which is how the export skips re-running the query —
    // on a heavy one, that second execution was the whole wait.
    const fetched = contiguousPages(r.pages);
    const held = fetched?.flatMap((page) => page.rows);
    const holdsAll = fetched !== null && !fetched[fetched.length - 1].truncated;
    let full = choice.scope === "marked" ? pickRows(res, markedRows()) : res;
    if (conn && sql && (res.truncated || (fetched?.length ?? 0) > 1)) {
      const progress = (rows: number) =>
        working(t("export.progress", { n: String(rows) }), rows);
      progress(held?.length ?? res.rows.length);
      try {
        if (held !== undefined && holdsAll) {
          full = { ...res, rows: held, truncated: false, cursor: false };
        } else if (held !== undefined && r.cursor) {
          // A table can also say how many rows it has for the price of one
          // aggregate, which is what turns the bar into a real percentage. Not
          // awaited: the count queues behind the pages on this connection, so the
          // bar starts moving at once and gains its scale a moment later.
          countForBar(conn, r, tab.id, (n) => (total = n));
          try {
            const rest = await drainCursor(conn.connId, EXPORT_PAGE, held.length, progress, ctl.signal);
            full = { ...res, rows: [...held, ...rest], truncated: false, cursor: false };
          } catch (err) {
            if (ctl.signal.aborted) throw err;
            // The cursor went away mid-read (another tab paged this connection).
            // Read it again from the start rather than write half a file.
            full = await drainQuery(conn.connId, sql, EXPORT_PAGE, progress, ctl.signal);
          }
          setResults(tab.id, { cursor: false });
        } else {
          countForBar(conn, r, tab.id, (n) => (total = n));
          full = await drainQuery(conn.connId, sql, EXPORT_PAGE, progress, ctl.signal);
          setResults(tab.id, { cursor: false });
        }
      } catch (err) {
        if (ctl.signal.aborted) return cancelled();
        setExportStatus({ text: t("export.failed", { reason: errorText(err) }), error: true });
        setResults(tab.id, { cursor: false });
        return;
      }
    }
    // Excel's own ceiling, said out loud rather than written into a file it
    // cannot open (issue #479).
    if (binary && full.rows.length > XLSX_MAX_ROWS) {
      setExportStatus({
        text: t("export.tooManyForXlsx", {
          n: String(full.rows.length),
          max: String(XLSX_MAX_ROWS),
        }),
        error: true,
      });
      return;
    }

    // Writing is where the size actually bites: the whole file as ONE string is
    // past the engine's maximum string length, and the export used to die there
    // with "Invalid string length". So it goes out a chunk of rows at a time,
    // which also gives the bar something true to show — rows written, out of
    // rows there are — and hands the browser a frame often enough to paint it.
    total = full.rows.length;
    working(t("export.writing", { n: String(full.rows.length), file }), 0);
    try {
      const writer = await target.open();
      if (binary) {
        await writer.write(
          new Blob([new Uint8Array(buildXlsx(full, table))], { type: XLSX_MIME }),
        );
      } else {
        let written = 0;
        let sinceFrame = 0;
        for (const chunk of exportChunks(full, format, table, EXPORT_CHUNK_ROWS, choice.csv)) {
          if (ctl.signal.aborted) {
            await writer.abort();
            return cancelled();
          }
          await writer.write(chunk);
          written = Math.min(full.rows.length, written + EXPORT_CHUNK_ROWS);
          working(t("export.writing", { n: String(full.rows.length), file }), written);
          // Not every chunk: a frame per chunk would cost more than the writing.
          if (++sinceFrame >= 20) {
            sinceFrame = 0;
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }
      }
      await writer.close();
    } catch (err) {
      setExportStatus({ text: t("export.failed", { reason: errorText(err) }), error: true });
      return;
    }
    // Said, not merely stopped: the toast disappearing is not the difference
    // between "finished" and "gave up", and the file only becomes readable now.
    // It clears itself after a while, but only if nothing newer took its place.
    const done = { text: t("export.done", { n: String(full.rows.length), file }) };
    setExportStatus(done);
    setTimeout(() => setExportStatus((cur) => (cur === done ? null : cur)), 8000);
  };

  // Right-click on a result cell. Built here because the workspace owns the
  // result + the exporters; the grid just forwards the click position and
  // indices. Grouped as the M14 prototype draws it (audit A-14): the cell first
  // (copy, copy as ▸, NULL, detail), then where the value leads (related data,
  // filter by it ▸), then the row actions, then the export ▸ — four groups
  // instead of one flat list of twenty rows.
  const onCellContext = (e: MouseEvent, rowIndex: number, colIndex: number) => {
    const res = currentResult().result;
    if (!res) return;
    const row = res.rows[rowIndex];
    const items: MenuItem[] = [];
    if (row) {
      const column = res.columns[colIndex]?.name ?? "";
      const cell = row[colIndex];
      // Row actions take the marked rows, or the row under the pointer when none
      // is marked. One marked row counts too (#517); these used to need two.
      // Copying follows the grid's column order (#446); the INSERT and transfer
      // keep the table's own order, which is part of the statement.
      const marked = markedRows();
      const targets = marked.length > 0 ? marked : [rowIndex];
      const n = targets.length;

      // ── The cell ──
      items.push({
        label: t("result.copyCell"),
        hint: displayKeys("Mod+C", isMac()),
        action: () => copyText(cell ?? ""),
      });
      const copyAs: MenuItem[] = [
        {
          label: n === 1 ? t("result.copyRow") : t("result.copyRowsN", { n }),
          action: () => copyRowsFromGrid(targets),
        },
        // With the column names as the first line, for a spreadsheet: the marked
        // rows (or the one under the pointer), or every row the grid has loaded.
        {
          label: n === 1 ? t("result.copyRowHeader") : t("result.copyRowsNHeader", { n }),
          action: () => copyRowsFromGrid(targets, true),
        },
      ];
      if (res.rows.length > n) {
        copyAs.push({
          label: t("result.copyAllHeader", { n: res.rows.length }),
          action: () => copyRowsFromGrid(res.rows.map((_, i) => i), true),
        });
      }
      copyAs.push(
        { separator: true },
        {
          label: n === 1 ? t("result.copyRowInsert") : t("result.copyRowsInserts", { n }),
          action: () => copyRowsAsInserts(targets),
        },
        {
          label: t("result.copyRowJson"),
          action: () =>
            copyText(
              rowToJson(applyOrder(columnOrder(), res.columns), applyOrder(columnOrder(), row)),
            ),
        },
      );
      items.push({ label: t("result.copyAs"), submenu: copyAs });
      // Writing a NULL (issue #398). Clearing the box gives "", which is a
      // different value, so this is the only way to say NULL from the grid. The
      // entry is always here and carries its own reason when it cannot run —
      // the same rule as the related-data entry below (#344). Whether the
      // COLUMN accepts a NULL is not knowable from a ResultColumn (name + type,
      // nothing else), so a NOT NULL is rejected by the engine, with its error.
      // Out of an edit session it opens one first (R-14), as the grid's keys do.
      const nullBlocked = () =>
        !currentEditable() ? readOnlyReason("result.setNullReadOnly") : null;
      items.push({
        get label() {
          return nullBlocked() ?? t("result.setNull");
        },
        get disabled() {
          return nullBlocked() !== null;
        },
        hint: displayKeys("Mod+Shift+N", isMac()),
        action: () => void inEdit(() => onEditCell(rowIndex, column, null)),
      });
      // Taking a change back without discarding the others (A-04).
      const rowEdits = () => currentEdit().pending.edits[rowIndex];
      if (currentEdit().editing && rowEdits() && column in rowEdits()!) {
        items.push({ label: t("result.revertCell"), action: () => onRevertCell(rowIndex, column) });
      }
      if (currentEdit().editing && rowChange(currentEdit().pending, rowIndex) !== null) {
        items.push({ label: t("result.revertRow"), action: () => onRevertRow(rowIndex) });
      }
      items.push({ label: t("result.rowDetail"), action: () => setDetailIndex(rowIndex) });
      items.push({ separator: true });

      // ── Where the value leads ──
      // The entry is ALWAYS here, disabled with the reason when it cannot run.
      // It used to be added only over a referenced column and simply vanish
      // otherwise, which left "I don't know when this appears — it stopped
      // showing up" as the honest description of the feature (issue #344): four
      // separate conditions gate it and silence gave no way to tell them apart.
      // Getters, not values computed here: the catalog answer can land while the
      // menu is already open, and a string captured at open time left the entry
      // stuck on "buscando relaciones…" until the menu was closed and reopened.
      // ContextMenu reads both inside JSX, so a getter re-renders the entry.
      items.push({
        get label() {
          return (
            relatedBlockedReason(column) ??
            t("related.menu", { column, value: row[colIndex] ?? "NULL" })
          );
        },
        get disabled() {
          return relatedBlockedReason(column) !== null;
        },
        hint: displayKeys("Mod+B", isMac()),
        action: () => openRelated(rowIndex, colIndex),
      });
      // Filter the table by this cell's value (issue #593): each entry adds one
      // condition to the tab's filter panel and applies it at the server. Only
      // a table/view tab has that panel; anywhere else the one entry says so.
      const tabId = current()?.id;
      if (tabId !== undefined && isDataTab(tabId)) {
        const value = row[colIndex];
        const shown = value !== null && value.length > 30 ? `${value.slice(0, 30)}…` : value ?? "";
        const filterBy: MenuItem[] = cellFilterOps(value).map((op) => ({
          label: t("filter.byCell", {
            cond: `${column} ${t(`filter.op.${op}`)} ${shown}`.trim(),
          }),
          action: () => {
            withFilter(tabId, (f) => addCellCondition(f, column, op, value));
            applyDataFilter(tabId);
          },
        }));
        if (!filterIsEmpty(filterOf(tabId).applied)) {
          filterBy.push(
            { separator: true },
            { label: t("filter.byCellClear"), action: () => clearDataFilter(tabId) },
          );
        }
        items.push({ label: t("filter.byCellMenu"), submenu: filterBy });
      } else {
        items.push({ label: t("filter.byCellNeedsTable"), disabled: true });
      }
      items.push({ separator: true });

      // ── The row ──
      items.push({
        get label() {
          return (
            addRowsBlocked() ??
            (n === 1 ? t("result.duplicateRow") : t("result.duplicateRowsN", { n }))
          );
        },
        get disabled() {
          return addRowsBlocked() !== null;
        },
        hint: displayKeys("Mod+D", isMac()),
        action: () => duplicateRows(targets),
      });
      items.push({
        label: n === 1 ? t("result.transferRow") : t("result.transferRowsN", { n }),
        action: () => openTransfer(targets),
        disabled: !currentResult().source,
      });
      // Deleting the rows (#644): staged into the pending changes, so nothing
      // runs before the SQL preview. Always listed, with its reason when it
      // cannot run — the same rule as "Set NULL" above.
      const deleteBlocked = () =>
        !currentEditable() ? readOnlyReason("result.deleteRowsReadOnly") : null;
      const allDeleted = () => targets.every((r) => currentEdit().pending.deletes.includes(r));
      items.push({
        get label() {
          return (
            deleteBlocked() ??
            (allDeleted()
              ? t("grid.undoDelete")
              : n === 1
                ? t("grid.deleteRow")
                : t("result.deleteRowsN", { n }))
          );
        },
        get disabled() {
          return deleteBlocked() !== null;
        },
        get danger() {
          return !allDeleted();
        },
        hint: displayKeys("Delete", isMac()),
        action: () => void inEdit(() => onToggleDeleteRows(targets)),
      });
      items.push({ separator: true });
    }
    // ── The whole result ──
    items.push({
      label: t("result.exportMenu"),
      submenu: EXPORT_FORMATS.map((f) => ({
        label: t("result.exportFmt", { fmt: f.label }),
        action: () => void doExport(f.fmt),
      })),
    });
    openContextMenu(e, items);
  };

  // Right-click on a tab.
  const tabMenu = (e: MouseEvent, id: number) => {
    openContextMenu(e, [
      { label: t("common.close"), action: () => setTabs((s) => closeTab(s, id)) },
      {
        label: t("tabmenu.closeOthers"),
        action: () => setTabs((s) => closeOtherTabs(s, id)),
        disabled: tabs().tabs.length < 2,
      },
      {
        label: t("tabmenu.closeRight"),
        action: () => setTabs((s) => closeTabsToRight(s, id)),
        disabled: tabs().tabs.at(-1)?.id === id,
      },
      { label: t("tabmenu.closeAll"), action: () => setTabs((s) => ({ ...s, tabs: [], activeId: 0 })) },
      { separator: true },
      {
        label: t("tabmenu.copyName"),
        action: () => void copyText(tabs().tabs.find((x) => x.id === id)?.title ?? ""),
      },
      ...(tabs().tabs.some((x) => x.id === id && x.kind === "query" && !isDataTab(id))
        ? [{ label: t("lhist.menu"), action: () => openLocalHistory(id) }]
        : []),
      { separator: true },
      { label: t("toolbar.newQuery.title"), action: newTab },
    ]);
  };

  // Open a table's structure (columns + DDL) as a tool tab.
  const openStructure = (node: TreeNode, section?: "structure" | "definition") => {
    if (active()) {
      recordRecent(node);
      syncWorkingDb(node.db);
      showTool("structure", t("tab.structure", { name: node.label }), {
        key: `struct:${node.db ?? ""}.${node.schema ?? ""}.${node.label}`,
        params: { node, section },
      });
    }
  };

  // Datos · Estructura · Índices · DDL (issue #688): the same switch on every
  // tab of a table, each view opening (or focusing) its own tab.
  const showObjectView = (node: TreeNode, view: ObjectView) => {
    if (view === "data") openData(node);
    else if (view === "indexes") openIndexes(node);
    else openStructure(node, view === "ddl" ? "definition" : "structure");
  };
  /** The tree node a data tab browses: the tree's own when it is loaded. */
  const dataTabNode = (tabId: number): TreeNode | null => {
    const p = results[tabId]?.preview?.parts;
    if (!p) return null;
    const scope = p.schema ?? p.db;
    return (
      objectNodeFor(focusedObjects(), scope ? `${scope}.${p.name}` : p.name) ?? {
        key: `obj:${p.db ?? ""}.${p.schema ?? ""}.${p.name}`,
        label: p.name,
        kind: "table",
        db: p.db,
        schema: p.schema,
      }
    );
  };
  /** Runs `fn` inside the tab's edit session, opening it first: there is no
      Editar button (#688), so a new row, a NULL or a deletion starts one (R-14). */
  const inEdit = async (fn: () => void) => {
    const tab = current();
    if (!tab) return;
    if (!currentEdit().editing) await beginEdit();
    if (edits[tab.id]?.editing) fn();
  };
  const addRowInPlace = () => inEdit(onAddInsert);

  // Go to definition from the editor (issue #663): a table or view opens its
  // structure (columns + DDL) when the tree has loaded it; a routine opens its
  // definition in a new tab, as the tree does. Either way, a miss is said.
  const goToObject = async (target: ObjectTarget) => {
    const say = (text: string) => {
      clearTimeout(runToastTimer);
      setRunToast({ text, error: true });
      runToastTimer = setTimeout(() => setRunToast(null), 4000);
    };
    if (target.kind === "table") {
      const node = objectNodeFor(focusedObjects(), target.name);
      if (node) openStructure(node);
      else say(t("editor.nav.notFound", { name: target.name }));
      return;
    }
    const conn = active();
    if (!conn) return;
    // A call does not say whether it is a function or a procedure, and MySQL
    // asks for one or the other.
    for (const type of ["FUNCTION", "PROCEDURE"] as const) {
      const query = routineDefinitionFor(conn.driver, { name: target.name, type, schema: target.schema });
      if (!query) {
        say(t("editor.nav.unsupported"));
        return;
      }
      try {
        const res = await runQuery(conn.connId, query.sql);
        const text = readDefinitionText(res.columns.map((c) => c.name), res.rows, query.column, query.concatRows);
        if (text) {
          openSqlInNewTab(runnableRoutineDdl(conn.driver, text, target.name), target.name, {
            schema: target.schema,
            name: target.name,
            kind: "def:routine",
          });
          return;
        }
      } catch {
        // Not this kind of routine; try the other, then say it was not found.
      }
    }
    say(t("editor.nav.routineNotFound", { name: target.name }));
  };

  // Open the table designer for a db/schema container as a tool tab (create).
  const openTableDesigner = (container?: string) =>
    showTool("tableDesigner", t("toolbar.newTable.title"), { key: "tableDesigner", params: { container } });

  // Open the index / constraint manager for a table (alter-scoped tool tab).
  const openIndexes = (node: TreeNode) =>
    showTool("indexes", t("tab.indexes", { name: node.label }), {
      key: `indexes:${node.db ?? ""}.${node.schema ?? ""}.${node.label}`,
      params: { table: node.label, db: node.db, schema: node.schema },
    });

  // Open the table designer on an existing table (alter mode).
  const openAlterTable = (node: TreeNode) =>
    showTool("tableDesigner", t("tab.alter", { name: node.label }), {
      key: `alter:${node.db ?? ""}.${node.schema ?? ""}.${node.label}`,
      params: {
        table: node.label,
        db: node.db,
        schema: node.schema,
        container: node.schema ?? node.db,
      },
    });

  // Sidebar drag-to-resize: track the pointer on the document until release.
  const startResize = (e: MouseEvent) => {
    e.preventDefault();
    // Measured from the column's own left edge: the rail sits before it.
    const left = sidebarEl?.getBoundingClientRect().left ?? 0;
    const onMove = (ev: MouseEvent) =>
      setSidebarWidth(clampSidebarWidth(ev.clientX - left));
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      savePaneSize("sidebar", sidebarWidth());
    };
    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // The editor/result divider (issue #423), the sidebar resizer turned on its
  // side. The percentage is measured against the panes box rather than the
  // window because the tab bar and toolbars above it are not part of the split.
  const startEditorResize = (e: MouseEvent) => {
    e.preventDefault();
    const rect = panesEl?.getBoundingClientRect();
    if (!rect || rect.height === 0) return;
    const onMove = (ev: MouseEvent) =>
      setEditorPct(clampEditorPct(((ev.clientY - rect.top) / rect.height) * 100));
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      savePaneSize("editorPct", editorPct());
    };
    document.body.style.cursor = "row-resize";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // --- Command palette command list (issue #174) -------------------------
  // Built from the same handlers each origin uses, so a palette hit behaves
  // exactly like clicking the tool/object/snippet/history/action directly.
  const paletteCommands = createMemo<Command[]>(() => {
    const out: Command[] = [];
    const connected = !!active();

    // Actions (always available).
    out.push({ id: "act:new", category: "action", label: t("toolbar.newQuery.title"), run: () => setTabs((s) => addTab(s, newQueryTitle(), focusedDefId() ?? undefined)) });
    if (connected)
      out.push({ id: "act:reconnect", category: "action", label: t("conn.reconnect"), run: reconnect });
    // Named after the connection it closes: with several open, the palette and
    // Archivo › Desconectar act on the focused one (R-05).
    if (connected)
      out.push({ id: "act:disconnect", category: "action", label: t("conn.disconnectOf", { name: active()?.name ?? "" }), run: () => void disconnect() });
    // The ribbon used to own these two; without it the palette is where they
    // live (issue #386). New table needs a connection, the object list a
    // working database, exactly as the ribbon's disabled states said.
    if (connected)
      out.push({ id: "act:newTable", category: "action", label: t("toolbar.newTable.title"), run: () => openTableDesigner() });
    if (connected && activeDb())
      out.push({ id: "act:objects", category: "action", label: t("toolbar.objects.title"), run: openObjectList });
    out.push({ id: "act:settings", category: "action", label: t("common.settings"), run: () => showTool("settings", t("common.settings"), { key: "settings" }) });
    out.push({ id: "act:help", category: "action", label: t("status.shortcuts"), run: () => showTool("help", t("status.shortcuts"), { key: "help" }) });

    // Tools (need a connection to be useful — except the saved connections,
    // which belong to no connection at all and are how you open the first one).
    // A tool the engine cannot run is left out (audit A-18): the tools menu
    // lists it disabled with the reason; here it would only be a dead end.
    for (const tool of TOOL_CATALOG)
      if ((connected || tool.tool === "connections") && !toolUnsupported(tool, active()?.driver))
        out.push({ id: `tool:${tool.tool}`, category: "tool", label: t(tool.label), run: () => showTool(tool.tool, t(tool.tabTitle), { key: tool.key }) });

    // Objects loaded in the tree.
    for (const node of focusedObjects()) {
      const scope = [node.db, node.schema].filter((p): p is string => !!p).join(".");
      out.push({
        id: `obj:${node.key}`,
        category: "object",
        label: node.label,
        hint: scope || (node.kind === "view" ? t("tab.viewHint") : t("tab.tableHint")),
        run: () => openData(node),
      });
    }

    // Snippets. The body travels as the preview so the palette can show it, and
    // the alternates run it or drop it at the cursor (issues #320, #338).
    for (const s of snippets())
      out.push({
        id: `snip:${s.id}`,
        category: "snippet",
        label: s.name,
        preview: s.body,
        // Enter opens it in its own tab: the tab you were in keeps its text, and
        // reopening the same snippet returns to the tab it already has.
        run: () => openSnippet(s),
        runAlt: (alt) => (alt === "shift" ? runFromHistory(s.body) : insertSnippet(s)),
      });

    // Recent history (cap so the palette stays snappy; fuzzy filters the rest).
    for (const [i, h] of history().slice(0, 30).entries())
      out.push({ id: `hist:${i}`, category: "history", label: h.sql, hint: h.connName || undefined, run: () => runFromHistory(h.sql) });

    return out;
  });

  // What the palette shows depends on how it was opened: Mod+P scopes it to the
  // connection's objects (a go-to-table/view jump), Mod+K shows everything.
  const visiblePaletteCommands = createMemo<Command[]>(() => {
    const mode = paletteMode();
    if (mode === "all") return paletteCommands();
    const only = mode === "objects" ? "object" : "snippet";
    return paletteCommands().filter((c) => c.category === only);
  });

  // --- Native menu bar (issue #686) ----------------------------------------
  // The shell draws it from the model sent here — rebuilt whenever the language,
  // the connection, the tab or the setting changes; [] takes it away. A click
  // comes back as an item id and runs the same thing the palette or the key
  // would: the palette's own command when it is one, else the shortcut handler.
  // Run and format are the editor's keys, reached here through their ticks.
  const runMenuAction = (id: string) => {
    const cmd = paletteCommands().find((c) => c.id === id);
    if (cmd) {
      cmd.run();
      return;
    }
    if (id === "run-query") requestRun();
    else if (id === "run-script") requestRun("document");
    else if (id === "explain") explainActive();
    else if (id === "format-sql") setFormatTick((n) => n + 1);
    else runShortcut(id as ActionId);
  };
  // The one model for the native bar and the title bar's own menu (#688).
  const menuModel = createMemo(() =>
    buildMenuModel(t, {
      connected: !!active(),
      hasDb: !!activeDb(),
      hasTab: !!current(),
      isMac: isMac(),
      engine: active()?.driver,
    }),
  );
  createEffect(() => {
    if (!hasShellMenu()) return;
    setShellMenu(settings().nativeMenu ? menuModel() : []);
  });
  onMount(() => {
    if (typeof window === "undefined") return;
    onCleanup(onShellMenu(window, runMenuAction));
  });

  return (
    <div class="app">
      <TitleBar
        os={detectOs(typeof navigator !== "undefined" ? navigator.platform || navigator.userAgent : "")}
        custom={settings().customTitleBar}
        showMenu={settings().nativeMenu}
        menus={menuModel()}
        onMenuAction={runMenuAction}
        backdrop={themeId() === "nativo"}
        paletteKeys={paletteKeys()}
        onPalette={() => {
          setPaletteMode("all");
          setPaletteOpen(true);
        }}
        unread={unreadCount(noteLog())}
        notesOpen={notesOpen()}
        onNotifications={toggleNotes}
      />
      <div class="main">
        <Rail
          side={side()}
          onPick={(panel) => setSide((s) => railClick(s, panel))}
          connected={!!active()}
          onConnections={openConnectionsTab}
          onSettings={() => showTool("settings", t("common.settings"), { key: "settings" })}
        />
        <Show when={notesOpen()}>
          <Notifications
            notes={noteLog().notes}
            onClear={() => setNoteLog((l) => ({ ...l, notes: [] }))}
            onClose={() => setNotesOpen(false)}
          />
        </Show>
        {/* The side column stays mounted when folded or switched: the trees
            keep their expansion, filter and loaded objects (#444, #689). */}
        <aside
          class="sidebar"
          ref={sidebarEl}
          hidden={side().collapsed}
          aria-label={t(`rail.${side().panel}Title`)}
          style={{ width: `${sidebarWidth()}px` }}
        >
          <Show when={side().panel === "history"}>
            <HistoryPanel
              docked
              onNewQuery={() => runShortcut("new-tab")}
              entries={history()}
              slowThresholdMs={settings().slowThresholdMs}
              engine={active()?.driver}
              onRun={runFromHistory}
              onInsert={insertFromHistory}
              onOpen={(sql) => openSqlInNewTab(sql)}
              onClear={clearHistory}
              onClose={() => setSide((s) => ({ ...s, panel: "explorer" }))}
            />
          </Show>
          <Show when={side().panel === "snippets"}>
            <SnippetsPanel
              docked
              entries={snippets()}
              onOpen={openSnippet}
              onInsert={insertSnippet}
              onRename={renameSnip}
              onSetAbbr={setSnipAbbr}
              onDuplicate={duplicateSnip}
              onRemove={deleteSnip}
              onExport={exportSnippets}
              onImport={importSnippets}
              onClose={() => setSide((s) => ({ ...s, panel: "explorer" }))}
            />
          </Show>
          <Show when={side().panel === "search" && active()}>
            {(conn) => (
              <DataSearchPanel
                connId={conn().connId}
                engine={activeDialect()}
                db={activeDb()}
                onOpen={(sql, table) => openSearchMatches(sql, table, conn().defId)}
              />
            )}
          </Show>
          <div class="side-explorer" hidden={side().panel !== "explorer"}>
          <ConnectionBar
            connections={connections()}
            openIds={openConns().map((o) => o.defId)}
            connectingId={connectingId()}
            onPick={onConnect}
            onNew={onNewConnection}
            /* Creating, editing, importing and exporting live in their own tab
               (#525); the search only links to it. */
            onImport={openConnectionsTab}
            onManage={openConnectionsTab}
          />
          {/* A connection being opened (TreeLoading): its name, the time it
              is taking and the rows to come. No Cancelar: the core cannot
              abandon a conn.open in flight (honest capabilities). */}
          <Show
            when={
              connectingId() !== null && !openConns().some((o) => o.defId === connectingId())
                ? connections().find((c) => c.id === connectingId())
                : undefined
            }
          >
            {(c) => (
              <div class="conn-section" style={{ "--conn-accent": c().color ?? "var(--accent)" }}>
                <div class="objtree-connecting" role="status">
                  <span>{t("tree.connecting", { name: c().name })}</span>
                  <span class="objtree-connecting-time">
                    {formatElapsed(clock() - connectingSince())}
                  </span>
                </div>
                <TreeSkeleton label={t("tree.connecting", { name: c().name })} />
              </div>
            )}
          </Show>
          {/* One collapsible section per open connection (issue #444): the
              same table can be looked up in prod and dev without swapping the
              explorer. The sections split the height with flex; each tree keeps
              its own virtualized scroller. */}
          <Show
            when={openConns().length > 0}
          >
            <ul class="sidebar-tree" aria-label={t("connbar.listLabel")}>
              <For each={openConns()}>
                {(conn) => {
                  const focused = () => conn.defId === focusedDefId();
                  const collapsed = () => collapsedSections().has(conn.defId);
                  const saved = () => connections().find((c) => c.id === conn.defId);
                  const sub = () => {
                    const label = driverSchema(conn.driver)?.label ?? conn.driver;
                    const target = saved() ? connectionTarget(saved()!) : "";
                    return target ? `${label} · ${target}` : label;
                  };
                  return (
                    <li
                      class="conn-section"
                      classList={{ "is-collapsed": collapsed(), "is-focused": focused() }}
                      style={{ "--conn-accent": conn.color ?? "var(--accent)" }}
                    >
                      <ObjectTree
                        connId={conn.connId}
                        rowHeight={treeRowHeight(settings().zoom, settings().density)}
                        engine={conn.driver}
                        title={conn.name}
                        accent={conn.color}
                        conn={{
                          driver: conn.driver,
                          sub: sub(),
                          focused: focused(),
                          lost: conn.lost,
                          reconnecting: conn.reconnecting,
                          reconnected: conn.reconnected,
                          txStatements: txOpenCount(conn) ?? undefined,
                          safeMode: saved()?.safeMode,
                          busy: connectingId() !== null,
                        }}
                        onFocusConn={() => setFocusedDefId(conn.defId)}
                        onReconnect={() => inConn(conn.defId, reconnect)()}
                        collapsed={collapsed()}
                        onToggleCollapse={() =>
                          setCollapsedSections((s) => toggleSection(s, conn.defId))
                        }
                        onDisconnect={() => void disconnect(conn.defId)}
                        onOpenData={inConn(conn.defId, openData)}
                        onOpenStructure={inConn(conn.defId, openStructure)}
                        onOpenSql={inConn(conn.defId, openSqlInNewTab)}
                        cache={metaCache.conn(conn.defId)}
                        reloadKey={treeReload()}
                        softReloadKey={treeSoftReload()}
                        onRefresh={inConn(conn.defId, refreshAll)}
                        onOpenTools={inConn(conn.defId, openToolsMenu)}
                        onObjectsLoaded={(nodes) =>
                          setLoadedObjects((m) => setConnObjects(m, conn.defId, nodes))
                        }
                        onSelectDatabase={inConn(conn.defId, syncWorkingDb)}
                        activeDb={focused() ? (activeDb() ?? undefined) : undefined}
                        connDatabase={connections().find((c) => c.id === conn.defId)?.params.database}
                        onImport={inConn(conn.defId, (node: TreeNode) =>
                          showTool("import", t("tab.import", { name: node.label }), {
                            key: `import:${node.label}`,
                            params: {
                              target: { table: node.label, db: node.db, schema: node.schema },
                            },
                          }),
                        )}
                        onCreateTable={inConn(conn.defId, (node: TreeNode) =>
                          openTableDesigner(node.schema ?? node.db),
                        )}
                        onAlterTable={inConn(conn.defId, openAlterTable)}
                        onManageIndexes={inConn(conn.defId, openIndexes)}
                        onColumns={(table, names) => rememberColumns(conn, table, names)}
                        onRowCounts={(counts) =>
                          setRowCountsByConn((m) => ({ ...m, [conn.defId]: { ...m[conn.defId], ...counts } }))
                        }
                        onExport={inConn(conn.defId, exportTable)}
                        onGenerate={inConn(conn.defId, (node: TreeNode) =>
                          showTool("generator", t("tab.generate", { name: node.label }), {
                            key: `gen:${node.label}`,
                            params: { target: { table: node.label, db: node.db, schema: node.schema } },
                          }),
                        )}
                        connMenu={(db) => connMenuItems(conn, db)}
                      />
                    </li>
                  );
                }}
              </For>
            </ul>
          </Show>
          </div>
        </aside>

        <div
          class="resizer"
          role="separator"
          aria-orientation="vertical"
          hidden={side().collapsed}
          title={t("panes.sidebarTitle")}
          onMouseDown={startResize}
          onDblClick={() => {
            setSidebarWidth(SIDEBAR_DEFAULT);
            savePaneSize("sidebar", SIDEBAR_DEFAULT);
          }}
        />

        <section class="workspace">
          {/* A protected connection (issue #666) keeps the strip even without a
              colour, and stripes it: the "careful" cue the colour alone gave —
              amber or neutral then, never the error red (R-06). */}
          <Show when={stripeColor(tabConn(current())?.color, tabSafeMode(current()))}>
            {(stripe) => (
            <div
              class="workspace-accent"
              classList={{ "is-protected": !!tabSafeMode(current()) }}
              style={{ background: stripe() }}
              title={
                tabSafeMode(current())
                  ? t(tabSafeMode(current()) === "readOnly" ? "safe.badgeReadOnly" : "safe.badgeConfirm")
                  : t("tab.connTitle")
              }
            />
            )}
          </Show>
          {/* Desktop document tabs (issue #688). The Ctrl+K palette keeps a door
              at the strip's end; tools live in the Herramientas menu and the
              palette, so the ⋯ tool strip is gone. */}
          <DocTabs
            tabs={tabs().tabs.map((tab) => ({
              id: tab.id,
              title: tab.title,
              icon: tabIcon(tab, isDataTab(tab.id)),
              color: tabColor(tab),
              conn: openConns().length > 1 ? tabConn(tab)?.name : undefined,
              safe: safeModeOf(tabConn(tab)?.defId),
              running: !!results[tab.id]?.loading,
              dirty: isUnsaved(tab),
              tool: tab.kind === "tool",
            }))}
            activeId={tabs().activeId}
            onSelect={selectTab}
            onClose={removeTab}
            onKeyDown={onTabKeyDown}
            onContextMenu={tabMenu}
            onNew={newTab}
          />

          {/* The connection is gone (R-05): said inside the document, where
              the work it blocks is, with the one action that fixes it. */}
          <Show when={tabConn(current())?.lost ? tabConn(current()) : null}>
            {(c) => (
              <div class="conn-lost-band" role="alert">
                <Icon name="disconnect" size={14} />
                <span class="conn-lost-title">{t("conn.lostBand", { name: c().name })}</span>
                <button
                  class="btn"
                  disabled={c().reconnecting || connectingId() !== null}
                  onClick={() => inConn(c().defId, reconnect)()}
                >
                  {t("conn.reconnect")}
                </button>
                <span>{t("conn.lostKept")}</span>
                <span class="conn-lost-retry" aria-live="off">
                  {c().reconnecting
                    ? t("conn.reconnecting")
                    : c().retryAt !== undefined
                      ? t("conn.retryIn", { n: secondsLeft(c().retryAt!, clock()) })
                      : ""}
                </span>
              </div>
            )}
          </Show>

          <div class="workspace-main">
          <Show when={currentQuery()}>
            {(tab) => (
              <div class="panes" ref={panesEl}>
                <div
                  class={`editor-pane ${isDataTab(tab().id) ? "data-pane" : ""}`}
                  /* A data tab sizes itself around its filter panel (#347); only
                     the editor tabs take the dragged share. */
                  style={
                    isDataTab(tab().id) ? undefined : { height: `${editorPct()}%` }
                  }
                >
                  <Show when={isDataTab(tab().id)}>
                    {/* A table opened from the tree is browsed, not written: the
                        editor gives way to the filter and sort that narrow the
                        whole table rather than the page on screen (#347). */}
                    <DataFilterBar
                      state={filterOf(tab().id)}
                      columns={colsOf(tab().id).columns}
                      dirty={filterDirty(tab().id)}
                      loaded={currentResult().result?.rows.length}
                      onChange={(i, patch) =>
                        setFilters(tab().id, "conditions", i, patch)
                      }
                      onAdd={() =>
                        withFilter(tab().id, (f) => ({
                          ...f,
                          conditions: [...f.conditions, emptyCondition()],
                        }))
                      }
                      onRemove={(i) =>
                        withFilter(tab().id, (f) => ({
                          ...f,
                          conditions: f.conditions.filter((_, n) => n !== i),
                        }))
                      }
                      onSort={(i, patch) => setFilters(tab().id, "order", i, patch)}
                      onAddSort={() =>
                        withFilter(tab().id, (f) => ({
                          ...f,
                          order: [
                            ...f.order,
                            { column: colsOf(tab().id).columns[0] ?? "", dir: "ASC" as const },
                          ],
                        }))
                      }
                      onRemoveSort={(i) =>
                        withFilter(tab().id, (f) => ({
                          ...f,
                          order: f.order.filter((_, n) => n !== i),
                        }))
                      }
                      onApply={() => applyDataFilter(tab().id)}
                      onClear={() => clearDataFilter(tab().id)}
                      /* Through withFilter, not a bare path write: the fold is
                         now the first thing a tab's filter is asked to do, and
                         writing `filters[id].collapsed` before anything has
                         created `filters[id]` throws. */
                      onToggleCollapsed={() =>
                        withFilter(tab().id, (f) => ({ ...f, collapsed: !f.collapsed }))
                      }
                      onOpenSql={() => openSqlInNewTab(sqlOfTab(tab().id), tab().title)}
                      addRef={(add) => (addFilterCondition = add)}
                      addSortRef={(add) => (addFilterSort = add)}
                    />
                  </Show>
                  {/* The run toolbar (issue #691) sits ABOVE the editor: the
                      connection first, then what the run will execute. Naming a
                      snippet happens in it too, so the query stays on screen
                      (issue #320). A data tab has none (issue #386). */}
                  <Show when={!isDataTab(tab().id)}>
                  <EditorToolbar
                    conn={
                      tabConn(tab())
                        ? {
                            name: tabConn(tab())!.name,
                            color: tabConn(tab())!.color,
                            db: tabConn(tab())!.defId === focusedDefId() ? activeDb() : null,
                          }
                        : null
                    }
                    connItems={() => editorConnItems(tab())}
                    info={runInfo()}
                    running={!!results[tab().id]?.loading}
                    stopBlocked={
                      tabConn(tab())?.features?.cancel === false ? t("grid.cancelUnsupported") : undefined
                    }
                    isMac={isMac()}
                    onRun={requestRun}
                    onStop={cancelActive}
                    onFormat={() => setFormatTick((n) => n + 1)}
                    moreItems={(e) => editorMoreItems(e, tab())}
                    tx={
                      tabConn(tab()) ? (
                        <TxControls
                          session={{ ...txOf(tabConn(tab())), open: txOpenCount(tabConn(tab())) !== null }}
                          unsupportedReason={txUnsupported(tabConn(tab()))}
                          busy={txBusy()}
                          onToggle={() => toggleTxMode(tabConn(tab()))}
                          onCommit={() => void endTabTx("commit")}
                          onRollback={() => void endTabTx("rollback")}
                        />
                      ) : undefined
                    }
                  >
                    <Show when={naming()}>
                      {(pending) => (
                        <span class="snip-save">
                          <span class="snip-save-label">{t("snip.nameLabel")}</span>
                          <input
                            class="snip-save-input"
                            type="text"
                            ref={autoFocus}
                            aria-label={t("snip.nameAria")}
                            placeholder={t("snip.namePlaceholder")}
                            value={pending().name}
                            onInput={(e) =>
                              setNaming((n) => (n ? { ...n, name: e.currentTarget.value } : n))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitNaming();
                              }
                              if (e.key === "Escape") {
                                e.preventDefault();
                                setNaming(null);
                              }
                            }}
                          />
                          <span class="snip-save-scope">
                            {t(`snip.scope.${pending().scope}`)} · {t("snip.nameHint")}
                          </span>
                        </span>
                      )}
                    </Show>
                  </EditorToolbar>
                  <SqlEditor
                    activeId={tab().id}
                    onCursor={setEditorCursor}
                    sqlFor={sqlOfTab}
                    onChange={onEditorChange}
                    onRun={runEditor}
                    onExplain={explainActive}
                    dialect={activeDialect()}
                    formatTick={formatTick()}
                    searchTick={findTick()}
                    runRequest={runRequest()}
                    saveTick={saveTick()}
                    onSaveRequest={beginNaming}
                    onRunInfo={setRunInfo}
                    errorMark={errorMark()}
                    revealErrorTick={revealErrorTick()}
                    insertRequest={snippetInsert()}
                    schema={sqlSchema()}
                    defaultTable={sqlDefaultTable()}
                    foreignKeys={sqlForeignKeys()}
                    missingTables={missingTables()}
                    diagnostics={settings().editorDiagnostics}
                    onGoToObject={(target) => void goToObject(target)}
                    templates={editorTemplates()}
                    onLocalHistory={() => openLocalHistory(tab().id)}
                  />
                  </Show>
                </div>
                <Show when={!isDataTab(tab().id)}>
                  <div
                    class="h-resizer"
                    role="separator"
                    aria-orientation="horizontal"
                    title={t("panes.dividerTitle")}
                    onMouseDown={startEditorResize}
                    onDblClick={() => {
                      setEditorPct(EDITOR_PCT_DEFAULT);
                      savePaneSize("editorPct", EDITOR_PCT_DEFAULT);
                    }}
                  />
                </Show>
                <div
                  class="result-pane"
                  classList={{ "is-alt-view": !isDataTab(tab().id) && resultView(tab().id) !== "result" }}
                >
                  {/* What the run did or is doing (issue #691, R-01): the clock
                      while it runs, the summary or the failed line after. */}
                  <Show when={!isDataTab(tab().id)}>
                    <RunStatus
                      loading={currentResult().loading}
                      startedAt={currentResult().startedAt}
                      progress={currentResult().progress}
                      result={currentResult().result}
                      error={currentResult().error}
                      elapsedMs={currentResult().elapsedMs}
                      errorLine={errorPlace()?.named ? errorPlace()!.line : null}
                      onCancel={cancelActive}
                      cancelBlocked={
                        tabConn(tab())?.features?.cancel === false ? t("grid.cancelUnsupported") : undefined
                      }
                      onReveal={errorPlace() ? () => setRevealErrorTick((n) => n + 1) : undefined}
                      tx={currentResult().ranTx}
                      onHistory={
                        currentResult().ranSql
                          ? () =>
                              showTool("history", t("editor.history"), {
                                key: "history",
                                params: { query: currentResult().ranSql },
                              })
                          : undefined
                      }
                    />
                  </Show>
                  {/* One tab per statement when a script ran (issue #450).
                      Above the toolbar: the tab chooses which result Refrescar,
                      Graficar and Exportar act on. */}
                  {/* Plus «Mensajes» and «Plan» on a query tab (#691). */}
                  <Show when={!isDataTab(tab().id) || (currentResult().sets?.length ?? 0) > 1}>
                    <ResultTabs
                      sets={currentResult().sets ?? []}
                      active={currentResult().activeSet ?? 0}
                      onSelect={(i) => selectSet(tab().id, i)}
                      view={isDataTab(tab().id) ? undefined : resultView(tab().id)}
                      onView={isDataTab(tab().id) ? undefined : (v) => setResultViews(tab().id, v)}
                    />
                  </Show>
                  <Show when={!isDataTab(tab().id) && resultView(tab().id) === "messages"}>
                    <ResultMessages messages={runLogs[tab().id] ?? []} />
                  </Show>
                  <Show when={!isDataTab(tab().id) && resultView(tab().id) === "plan"}>
                    <Show
                      when={planSqls[tab().id]}
                      fallback={<p class="grid-empty result-alt">{t("plan.empty")}</p>}
                    >
                      {(sql) => (
                        <ExplainPlan
                          connId={tabConn(tab())?.connId ?? ""}
                          engine={activeDialect()}
                          sql={sql()}
                          docked
                        />
                      )}
                    </Show>
                  </Show>
                  <Show when={tabPins().length > 0}>
                    <PinStrip
                      pins={tabPins()}
                      shown={shownPin()?.id ?? null}
                      onSelect={showPin}
                      onClose={unpin}
                    />
                  </Show>
                  <Show when={comparison()}>
                    {(c) => (
                      <CompareBar
                        cmp={c().cmp}
                        baseLabel={c().base.label}
                        otherLabel={c().other.label}
                        keyColumns={c().key}
                        onKey={(key) => setComparing((v) => (v ? { ...v, key } : v))}
                        onClose={() => setComparing(null)}
                      />
                    )}
                  </Show>
                  <Show when={!comparison() && shownPin()}>
                    {(p) => (
                      <PinNote
                        pin={p()}
                        onCompare={(e) => openCompareMenu(e, p().id)}
                        onClose={() => unpin(p().id)}
                      />
                    )}
                  </Show>
                  <Show
                    when={
                      !comparison() &&
                      !shownPin() &&
                      (currentResult().source ||
                        (currentResult().result?.columns.length ?? 0) > 0)
                    }
                  >
                    <ObjectToolbar
                      isTable={!!currentResult().source}
                      hasColumns={
                        (currentResult().result?.columns.length ?? 0) > 0
                      }
                      editing={currentEdit().editing}
                      editable={currentEditable()}
                      readOnlyReason={currentReadOnlyReason()}
                      readOnly={currentReadOnly()}
                      busy={currentEdit().busy}
                      error={currentEdit().error}
                      changeCount={changeCount(currentEdit().pending)}
                      hasChanges={hasChanges(currentEdit().pending)}
                      exportFormats={EXPORT_FORMATS}
                      onRefresh={() => reloadCurrent(tab().id)}
                      refreshBlocked={refreshBlockedReason(tab().id)}
                      onAddRow={() => void addRowInPlace()}
                      onImport={() => openImport()}
                      onGenerate={openGen}
                      onSchemaSync={openSchemaSync}
                      onDataSync={openDataSync}
                      onTransfer={openTransfer}
                      onConfirm={confirmEdit}
                      saveBlocked={tabConn(current())?.lost ? t("conn.saveNeedsConn") : undefined}
                      onDiscard={discardEdit}
                      onChart={openChart}
                      transposed={!!transposedOn()}
                      onTranspose={toggleTranspose}
                      onPin={pinCurrent}
                      pinBlocked={pinBlocked()}
                      onCompare={(e) => openCompareMenu(e, "current")}
                      onExport={(fmt) => void doExport(fmt as AnyExportFormat)}
                      searchOpen={gridSearch()}
                      onSearch={() => setGridSearch((v) => !v)}
                      editHint={t("objbar.editHint")}
                      filterOpen={isDataTab(tab().id) && !filterOf(tab().id).collapsed}
                      onFilter={
                        isDataTab(tab().id)
                          ? () => withFilter(tab().id, (f) => ({ ...f, collapsed: !f.collapsed }))
                          : undefined
                      }
                      onView={
                        isDataTab(tab().id)
                          ? (view) => {
                              const node = dataTabNode(tab().id);
                              const defId = tab().connDefId;
                              if (!node) return;
                              if (defId) inConn(defId, showObjectView)(node, view);
                              else showObjectView(node, view);
                            }
                          : undefined
                      }
                      /* A data tab has no editor bar to hold these (issue #386). */
                      moreItems={dataTabMoreItems(tab().id)}
                    />
                  </Show>
                  <Show when={currentEdit().preview}>
                    {(sqls) => (
                      <div class="edit-preview">
                        <div class="edit-preview-head">
                          <strong>{t("result.confirmChanges")}</strong>
                          <span>
                            {t("result.willRun", { n: sqls().length })}
                          </span>
                        </div>
                        <pre class="ddl-text preview-sql">{sqls().join(";\n")}</pre>
                        <div class="panel-foot">
                          <span class="dlg-actions">
                            {orderActions(currentOs(), [
                              <button
                                class={deleteRowsText() ? "btn btn-danger" : "btn-primary"}
                                disabled={currentEdit().busy}
                                onClick={() =>
                                  deleteRowsText() ? setConfirmDeleteRows(true) : void applyEdit()
                                }
                              >
                                {deleteRowsText()
                                  ? countText("result.applyDeleting", currentEdit().pending.deletes.length)
                                  : t("result.applyConfirm")}
                              </button>,
                              <button class="btn" disabled={currentEdit().busy} onClick={cancelPreview}>
                                {t("common.cancel")}
                              </button>,
                            ])}
                          </span>
                        </div>
                        <Show when={confirmDeleteRows() && deleteRowsText()}>
                          {(c) => (
                            <ConfirmDialog
                              title={c().title}
                              message={c().message}
                              confirmLabel={c().confirm}
                              sql={sqls().join(";\n")}
                              onConfirm={() => {
                                setConfirmDeleteRows(false);
                                void applyEdit();
                              }}
                              onCancel={() => setConfirmDeleteRows(false)}
                            />
                          )}
                        </Show>
                      </div>
                    )}
                  </Show>
                  <div class="result-body">
                    <div class="result-grid-wrap">
                      {/* A comparison, else a pinned result (issue #669): both
                          read-only, in the same virtualized grid. */}
                      <Show when={comparison()}>
                        {(c) => (
                          <ResultGrid
                            result={c().view.result}
                            loading={false}
                            error={null}
                            rowHeight={rowHeightFor(settings().gridStyle, settings().density, gridScale(settings()))}
                            gridStyle={settings().gridStyle}
                            keyColumns={c().key}
                            cellType={(r, ci) => (c().view.changed[r]?.has(ci) ? "text" : undefined)}
                            cellClass={(r, ci) => diffCellClass(c().view, r, ci)}
                          />
                        )}
                      </Show>
                      <Show when={!comparison() && shownPin()}>
                        {(p) => (
                          <ResultGrid
                            result={p().result}
                            loading={false}
                            error={null}
                            rowHeight={rowHeightFor(settings().gridStyle, settings().density, gridScale(settings()))}
                            gridStyle={settings().gridStyle}
                            keyColumns={p().pk}
                          />
                        )}
                      </Show>
                      <Show when={!comparison() && !shownPin()}>
                      <Show
                        when={transposedView()}
                        fallback={
                          <ResultGrid
                            result={currentResult().result}
                            loading={currentResult().loading}
                            error={currentResult().error}
                            errorExtra={
                              <ErrorHints
                                code={engineErrorCode(currentResult().error)}
                                hint={didYouMean(
                                  currentResult().error,
                                  currentResult().errorSql ?? "",
                                  editorSchema(sqlSchema()),
                                  activeDialect(),
                                )}
                              />
                            }
                            rowHeight={rowHeightFor(settings().gridStyle, settings().density, gridScale(settings()))}
                            gridStyle={settings().gridStyle}
                            emptyState={
                              <EmptyState
                                recentTables={recentTables()}
                                history={history()}
                                snippets={snippets()}
                                isMac={isMac()}
                                shortcuts={shortcuts()}
                                onOpenTable={openData}
                                onRunHistory={(sql) => (readsOnly(sql) ? runFromHistory(sql) : openSqlInNewTab(sql))}
                                onInsertSnippet={insertSnippet}
                                onPickSnippet={() => runShortcut("snippet-palette")}
                                onHistory={() => showTool("history", t("editor.history"), { key: "history" })}
                                onAllShortcuts={() => runShortcut("toggle-help")}
                              />
                            }
                            onCellContext={onCellContext}
                            onMarkedRowsChange={setMarkedRows}
                            onSelectedCellsChange={setSelectedCells}
                            onColumnOrderChange={setColumnOrder}
                            onCopyRows={copyRowsFromGrid}
                            onRowDetail={setDetailIndex}
                            onDuplicateRows={currentEditable() ? duplicateRows : undefined}
                            clearMarksTick={clearMarksTick()}
                            referencedColumns={referencedColumns()}
                            foreignKeys={foreignKeyTargets()}
                            onRelated={openRelated}
                            onSortColumn={
                              isDataTab(tab().id)
                                ? (column) => sortDataColumn(tab().id, column)
                                : undefined
                            }
                            sortedColumn={
                              isDataTab(tab().id) ? (filterOf(tab().id).order[0] ?? null) : null
                            }
                            onCancel={isDataTab(tab().id) ? cancelActive : undefined}
                            cancelDisabledReason={
                              tabConn(tab())?.features?.cancel === false
                                ? t("grid.cancelUnsupported")
                                : undefined
                            }
                            onRequestEdit={
                              currentEditable() && !currentEdit().editing ? beginEdit : undefined
                            }
                            fk={currentFk()}
                            showOldValues={settings().showOldValues}
                            searchOpen={gridSearch()}
                            onSearchOpenChange={setGridSearch}
                            edit={
                              currentEditable()
                                ? {
                                    active: currentEdit().editing,
                                    pending: currentEdit().pending,
                                    onEditCell,
                                    onRevertCell,
                                    onToggleDelete,
                                    onToggleDeleteRows,
                                    onInsertCell,
                                    onRemoveInsert,
                                    pkColumns: currentResult().source?.pk ?? [],
                                    pkModeOf: (i) => pkModeOf(currentEdit().pending, i),
                                    conflicts: currentConflicts(),
                                    failedInsert: currentEdit().failedInsert,
                                  }
                                : undefined
                            }
                          />
                        }
                      >
                        {(tv) => (
                          // Read-only and without the row actions: its rows are
                          // the source's COLUMNS, so a row index here means
                          // nothing to copy, edit or the context menu.
                          <>
                            <ResultGrid
                              result={tv().result}
                              loading={currentResult().loading}
                              error={null}
                              rowHeight={rowHeightFor(settings().gridStyle, settings().density, gridScale(settings()))}
                              gridStyle={settings().gridStyle}
                              cellType={(r, c) => (c >= 2 ? tv().types[r] : undefined)}
                            />
                            <Show when={tv().capped}>
                              <div class="grid-truncated">
                                {t("transpose.capped", { n: TRANSPOSE_MAX_ROWS })}
                              </div>
                            </Show>
                          </>
                        )}
                      </Show>
                      </Show>
                      {/* While pending rows exist the bar gives way: they get their
                          own bar with the save flow (#517, phase C). */}
                      <Show
                        when={markedRows().length > 0 && currentEdit().pending.inserts.length === 0}
                      >
                        <RowActionBar
                          count={markedRows().length}
                          pasteCount={rowClipboard()?.rows.length ?? 0}
                          addBlocked={addRowsBlocked()}
                          onCopy={() => copyRowsFromGrid(markedRows())}
                          onCopyInsert={() => copyRowsAsInserts(markedRows())}
                          onDuplicate={() => duplicateRows(markedRows())}
                          onPaste={pasteRowClipboard}
                          onClear={() => setClearMarksTick((n) => n + 1)}
                        />
                      </Show>
                      <Show
                        when={
                          currentEdit().editing &&
                          currentEdit().pending.inserts.length > 0 &&
                          !currentEdit().preview
                        }
                      >
                        <PendingRowsBar
                          count={currentEdit().pending.inserts.length}
                          conflicts={currentConflicts().size}
                          pkMode={
                            currentPaste()
                              ? (currentEdit().pending.pkModes?.[currentPaste()!.batch] ?? null)
                              : null
                          }
                          emptyAsNull={
                            currentPaste()
                              ? (currentEdit().pending.emptyAsNull?.[currentPaste()!.batch] ?? null)
                              : null
                          }
                          ignoredColumns={currentPaste()?.ignored ?? []}
                          busy={currentEdit().busy}
                          canImport={!!currentPaste()?.text}
                          onTogglePk={togglePastePk}
                          onToggleEmptyAsNull={togglePasteEmptyAsNull}
                          onReview={() => void confirmEdit()}
                          onDiscard={() => void discardEdit()}
                          onImport={importLastPaste}
                        />
                      </Show>
                    </div>
                    <Show when={detailData()}>
                      {(d) => (
                        <RowDetail
                          columns={d().res.columns}
                          row={d().res.rows[d().idx]}
                          rowIndex={d().idx}
                          total={d().res.rows.length}
                          editing={currentEdit().editing}
                          editable={currentEditable()}
                          deleted={currentEdit().pending.deletes.includes(d().idx)}
                          edits={currentEdit().pending.edits[d().idx]}
                          fk={currentFk()}
                          onEditCell={(col, val) => onEditCell(d().idx, col, val)}
                          onToggleDelete={() => onToggleDelete(d().idx)}
                          onBeginEdit={beginEdit}
                          onPrev={() =>
                            setDetailIndex((i) => stepRowIndex(i ?? 0, -1, d().res.rows.length))
                          }
                          onNext={() =>
                            setDetailIndex((i) => stepRowIndex(i ?? 0, 1, d().res.rows.length))
                          }
                          onClose={() => setDetailIndex(null)}
                          onCopy={() => copyRowsFromGrid([d().idx])}
                          referencedBy={(inbound[tab().id]?.rels ?? []).map((r) => ({
                            label: `${r.fromTable}.${r.columns.map((c) => c.from).join(", ")}`,
                            column: r.columns[0]?.to ?? "",
                          }))}
                          onReferenced={(column) => {
                            const ci = d().res.columns.findIndex(
                              (c) => c.name.toLowerCase() === column.toLowerCase(),
                            );
                            if (ci >= 0) openRelated(d().idx, ci);
                          }}
                        />
                      )}
                    </Show>
                  </div>
                  {/* The pager lives under the rows (#688); a paged query's
                      moved here from the status bar (#693), without the
                      first/last jumps a table's offset query gives. */}
                  <Show
                    when={
                      (isDataTab(tab().id) || !!currentResult().pageSql) &&
                      !comparison() &&
                      !shownPin() &&
                      (currentResult().result?.columns.length ?? 0) > 0
                    }
                  >
                    <Pager
                      view={dataPager(tab().id)}
                      total={dataTotal(tab().id)}
                      counting={counting() === tab().id}
                      onCount={dataCountSql(tab().id) ? () => void countDataTotal(tab().id) : undefined}
                      paused={currentEdit().editing}
                      onFirst={isDataTab(tab().id) ? () => goToDataOffset(tab().id, 0) : undefined}
                      onPrev={() => pageBy(-1)}
                      onNext={() => pageBy(1)}
                      pageSize={isDataTab(tab().id) ? (currentResult().pageSize ?? pageSize()) : undefined}
                      onPageSize={isDataTab(tab().id) ? (n) => changePageSize(tab().id, n) : undefined}
                      onLast={
                        isDataTab(tab().id)
                          ? () => {
                              const last = dataPager(tab().id).lastOffset;
                              if (last !== null) goToDataOffset(tab().id, last);
                            }
                          : undefined
                      }
                    />
                  </Show>
                </div>
              </div>
            )}
          </Show>

          <Show when={currentTool()}>
            {(tt) => (
              // Keyed on the tab id so switching between two tabs of the SAME
              // tool rebuilds the panel instead of feeding new props to the old
              // instance (issue #457). Every tool here loads what it shows in
              // onMount, which then never ran again: opening a second view's
              // definition showed the FIRST view's, under the second one's tab
              // name. Nothing is lost by remounting — a tool panel is already
              // rebuilt whenever the user visits a query tab and comes back.
              //
              // The tab's `rev` is part of the key for the same reason (issue
              // #498): reopening the SAME tab with a new snapshot — another
              // result to chart, another connection to edit — has to rebuild the
              // panel, or onMount never sees the new params.
              <Show when={`${tt().id}:${tt().rev ?? 0}`} keyed>
              <Switch>
                <Match when={tt().tool === "objectList"}>
                  <ObjectListView
                    connId={toolConn()?.connId ?? ""}
                    engine={activeDialect()}
                    db={(tt().params as { db: string }).db}
                    onOpenData={(name, type) =>
                      openData({
                        key: `db:${(tt().params as { db: string }).db}/obj:${name}`,
                        label: name,
                        kind: type === "view" ? "view" : "table",
                        db: (tt().params as { db: string }).db,
                      })
                    }
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "monitor"}>
                  <ServerMonitor
                    connId={toolConn()?.connId ?? ""}
                    connName={toolConn()?.name ?? ""}
                    engine={activeDialect()}
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "users"}>
                  <UserManager
                    connId={toolConn()?.connId ?? ""}
                    engine={activeDialect()}
                    db={activeDb() ?? undefined}
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "generator"}>
                  <DataGenerator
                    connId={toolConn()?.connId ?? ""}
                    target={(tt().params as { target: EditTarget }).target}
                    engine={activeDialect()}
                    onClose={() => closeTool(tt().id)}
                    onGenerated={() => {
                      const s = tt().sourceId;
                      if (s !== undefined) reloadCurrent(s);
                    }}
                  />
                </Match>
                <Match when={tt().tool === "import"}>
                  <ImportWizard
                    connId={toolConn()?.connId ?? ""}
                    target={(tt().params as { target: EditTarget }).target}
                    initialText={(tt().params as { initialText?: string }).initialText}
                    onClose={() => closeTool(tt().id)}
                    onImported={() => {
                      const s = tt().sourceId;
                      if (s !== undefined) reloadCurrent(s);
                    }}
                  />
                </Match>
                <Match when={tt().tool === "tableDesigner"}>
                  <TableDesigner
                    connId={toolConn()?.connId ?? ""}
                    engine={activeDialect()}
                    table={(tt().params as { table?: string }).table}
                    container={(tt().params as { container?: string }).container}
                    db={(tt().params as { db?: string }).db}
                    schema={(tt().params as { schema?: string }).schema}
                    onClose={() => closeTool(tt().id)}
                    onApplied={reloadTree}
                  />
                </Match>
                <Match when={tt().tool === "indexes"}>
                  <IndexManager
                    connId={toolConn()?.connId ?? ""}
                    engine={activeDialect()}
                    table={(tt().params as { table: string }).table}
                    db={(tt().params as { db?: string }).db}
                    schema={(tt().params as { schema?: string }).schema}
                    onClose={() => closeTool(tt().id)}
                    onChanged={reloadTree}
                    onView={(view) => {
                      const p = tt().params as { table: string; db?: string; schema?: string };
                      const node: TreeNode = {
                        key: `obj:${p.db ?? ""}.${p.schema ?? ""}.${p.table}`,
                        label: p.table,
                        kind: "table",
                        db: p.db,
                        schema: p.schema,
                      };
                      if (tt().connDefId) inConn(tt().connDefId!, showObjectView)(node, view);
                      else showObjectView(node, view);
                    }}
                  />
                </Match>
                <Match when={tt().tool === "structure"}>
                  <StructureView
                    connId={toolConn()?.connId ?? ""}
                    table={(tt().params as { node: TreeNode }).node.label}
                    db={(tt().params as { node: TreeNode }).node.db}
                    schema={(tt().params as { node: TreeNode }).node.schema}
                    kind={(tt().params as { node: TreeNode }).node.kind}
                    engine={activeDialect()}
                    onClose={() => closeTool(tt().id)}
                    onApplied={reloadTree}
                    initialSection={(tt().params as { section?: "structure" | "definition" }).section}
                    onView={(view) => {
                      const node = (tt().params as { node: TreeNode }).node;
                      if (tt().connDefId) inConn(tt().connDefId!, showObjectView)(node, view);
                      else showObjectView(node, view);
                    }}
                  />
                </Match>
                <Match when={tt().tool === "schemaSync"}>
                  <SchemaSyncWizard
                    sourceConnId={toolConn()?.connId ?? ""}
                    sourceEngine={toolConn()?.driver ?? activeDialect()}
                    sourceDb={(tt().params as { sourceDb?: string }).sourceDb}
                    sourceSchema={(tt().params as { sourceSchema?: string }).sourceSchema}
                    connections={connections()}
                    onOpenSql={(sql, defId) => openSqlInNewTab(sql, undefined, undefined, defId)}
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "dataDiff"}>
                  <DataDiffWizard
                    sourceDefId={(tt().params as { sourceDefId?: string }).sourceDefId}
                    source={(tt().params as { source: EditTarget }).source}
                    pk={(tt().params as { pk: string[] }).pk}
                    connections={connections()}
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "transfer"}>
                  <TransferWizard
                    sourceResult={(tt().params as { sourceResult: ResultSet }).sourceResult}
                    sourceTable={(tt().params as { sourceTable: string }).sourceTable}
                    whole={(tt().params as { whole?: { defId: string; db?: string; schema?: string } }).whole}
                    connections={connections()}
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "backup"}>
                  <BackupPanel
                    connId={toolConn()?.connId ?? ""}
                    connName={toolConn()?.name ?? ""}
                    engine={activeDialect()}
                    db={activeDb()}
                    onCatalogChanged={refreshTreeInPlace}
                  />
                </Match>
                <Match when={tt().tool === "dataSearch"}>
                  <DataSearchPanel
                    connId={toolConn()?.connId ?? ""}
                    engine={activeDialect()}
                    db={activeDb()}
                    onOpen={(sql, table) => openSearchMatches(sql, table, tt().connDefId)}
                  />
                </Match>
                <Match when={tt().tool === "connections"}>
                  <div class="conn-tab">
                    <ConnectionManager
                      connections={connections()}
                      activeConnId={activeDefId()}
                      openIds={openConns().map((o) => o.defId)}
                      onEdit={onEditConnection}
                      onDelete={onDeleteConnection}
                      onNew={onNewConnection}
                      onExport={exportConns}
                      onImport={importConns}
                      onMoveToGroup={moveConnToGroup}
                      onConnect={(c) => void onConnect(c)}
                      onDuplicate={(c) =>
                        openConnForm({
                          ...c,
                          params: { ...c.params },
                          id: nextConnectionId(connections()),
                          name: t("conn.copyName", { name: c.name }),
                        })
                      }
                      usage={connUsage()}
                    />
                  </div>
                </Match>
                <Match when={tt().tool === "history"}>
                  <HistoryPanel
                    initialQuery={(tt().params as { query?: string } | undefined)?.query}
                    entries={history()}
                    slowThresholdMs={settings().slowThresholdMs}
                    engine={active()?.driver}
                    onRun={runFromHistory}
                    onInsert={insertFromHistory}
                    onOpen={(sql) => openSqlInNewTab(sql)}
                    onClear={clearHistory}
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "localHistory"}>
                  <LocalHistoryPanel
                    docs={localHist()}
                    tabId={(tt().params as { tabId: number }).tabId}
                    currentSql={localSqlOf}
                    onRestore={restoreLocal}
                    onOpenCopy={(title, sql) => openSqlInNewTab(sql, title || undefined)}
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "snippets"}>
                  <SnippetsPanel
                    entries={snippets()}
                    onOpen={openSnippet}
                    onInsert={insertSnippet}
                    onRename={renameSnip}
                    onSetAbbr={setSnipAbbr}
                    onDuplicate={duplicateSnip}
                    onRemove={deleteSnip}
                    onExport={exportSnippets}
                    onImport={importSnippets}
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "connectionForm"}>
                  <ConnectionForm
                    initial={(tt().params as { draft: Connection }).draft}
                    onSave={onSaveConnection}
                    onSaveAndConnect={onSaveAndConnectConnection}
                    onCancel={() => closeTool(tt().id)}
                    onTest={(c) => testConnection(c.driver, buildDsn(c))}
                    onListDatabases={(c) =>
                      listDatabases(c.driver, dsnForDatabaseList(c))
                    }
                    groups={connectionGroups(connections())}
                  />
                </Match>
                <Match when={tt().tool === "chart"}>
                  <ChartView
                    result={(tt().params as { result: ResultSet }).result}
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "notebook"}>
                  <Notebook
                    connId={toolConn()?.connId ?? ""}
                    notebookId={(tt().params as { notebookId?: string } | undefined)?.notebookId}
                    engine={activeDialect()}
                    onChart={(result) =>
                      showTool("chart", t("tab.chart"), { key: "chart", params: { result } })
                    }
                    onCatalogChanged={refreshTreeInPlace}
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "erDiagram"}>
                  <ErDiagram
                    connId={toolConn()?.connId ?? ""}
                    engine={activeDialect()}
                    db={activeDb() ?? undefined}
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "queryBuilder"}>
                  <QueryBuilder
                    connId={toolConn()?.connId ?? ""}
                    engine={activeDialect()}
                    db={activeDb() ?? undefined}
                    onRun={(sql) => {
                      closeTool(tt().id);
                      runFromHistory(sql);
                    }}
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "routines"}>
                  <RoutineExplorer
                    connId={toolConn()?.connId ?? ""}
                    engine={activeDialect()}
                    db={activeDb() ?? undefined}
                    onOpenSql={(sql) => {
                      closeTool(tt().id);
                      openSqlInNewTab(sql);
                    }}
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "triggers"}>
                  <TriggersExplorer
                    connId={toolConn()?.connId ?? ""}
                    engine={activeDialect()}
                    db={activeDb() ?? undefined}
                    onOpenSql={(sql) => {
                      closeTool(tt().id);
                      openSqlInNewTab(sql);
                    }}
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "explainPlan"}>
                  <ExplainPlan
                    connId={toolConn()?.connId ?? ""}
                    engine={activeDialect()}
                    sql={(tt().params as { sql: string }).sql}
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "slowQueries"}>
                  <SlowQueries
                    connId={toolConn()?.connId ?? ""}
                    engine={activeDialect()}
                    onOpenSql={(sql) => {
                      closeTool(tt().id);
                      openSqlInNewTab(sql);
                    }}
                    onExplain={(sql) => {
                      closeTool(tt().id);
                      explainSql(sql);
                    }}
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "settings"}>
                  <SettingsPanel
                    theme={theme()}
                    onSetTheme={applyThemePref}
                    themeId={themeId()}
                    themes={allThemes()}
                    onSetThemeId={setThemeChoice}
                    onImportTheme={importTheme}
                    onRemoveTheme={removeTheme}
                    resolvedMode={resolved()}
                    historyLimit={historyLimit()}
                    onSetHistoryLimit={changeHistoryLimit}
                    settings={settings()}
                    onSetSettings={patchSettings}
                    cellColors={cellColors()}
                    onSetCellColor={setCellColor}
                    onResetCellColors={resetCellColors}
                    shortcuts={shortcuts()}
                    shortcutOverrides={shortcutOverrides()}
                    onSetShortcutOverrides={setShortcutOverrides}
                    isMac={isMac()}
                    onImportConfig={importConfig}
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "help"}>
                  <ShortcutsHelp isMac={isMac()} shortcuts={shortcuts()} onClose={() => closeTool(tt().id)} />
                </Match>
              </Switch>
              </Show>
            )}
          </Show>

          {/* Nothing open (issue #694): with no connection, the welcome — how
              to start, the recent connections, a few shortcuts; with one, a
              home for it — a new query, an object, a recent table. */}
          <Show when={!current()}>
            <Show
              when={active()}
              fallback={
                <Welcome
                  recent={recentConnections(connections(), connUsage())}
                  connectingId={connectingId()}
                  isMac={isMac()}
                  shortcuts={shortcuts()}
                  onConnect={(c) => void onConnect(c)}
                  onNew={onNewConnection}
                  onOpenFile={openSqlFile}
                  onImport={pickConnectionsFile}
                  onShowAll={openConnectionsTab}
                  onShortcuts={() => runShortcut("toggle-help")}
                />
              }
            >
              {(conn) => (
                <ConnectedHome
                  name={conn().name}
                  engine={driverSchema(conn().driver)?.label ?? conn().driver}
                  color={conn().color}
                  db={activeDb()}
                  recentTables={recentTables()}
                  isMac={isMac()}
                  shortcuts={shortcuts()}
                  onNewQuery={() => runShortcut("new-tab")}
                  onFindObject={() => runShortcut("object-palette")}
                  onOpenTable={openData}
                  rowCounts={rowCountsOf(conn().defId)}
                  onObjectList={activeDb() ? openObjectList : undefined}
                  onEr={() => openCatalogTool("erDiagram")}
                  onDataSearch={() => openCatalogTool("dataSearch")}
                  onNewTable={() => openTableDesigner()}
                  onTools={openToolsMenu}
                />
              )}
            </Show>
          </Show>
          </div>
        </section>
      </div>

      <Show when={snipToast()}>
        {(toast) => (
          <div class="app-toast" role="status">
            <span class="app-toast-text">{toast().text}</span>
            <button class="app-toast-action" onClick={undoSaveSnippet}>
              {t("snip.undo")}
            </button>
            <button
              class="app-toast-close"
              title={t("panel.close")}
              aria-label={t("panel.close")}
              onClick={() => setSnipToast(null)}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        )}
      </Show>

      <Show when={deletingConn()}>
        {(c) => (
          <ConfirmDialog
            title={t("conn.deleteOpenTitle", { name: c().name })}
            message={t("conn.deleteOpenMessage", { name: c().name })}
            confirmLabel={t("conn.deleteOpenConfirm")}
            onConfirm={() => {
              const conn = c();
              setDeletingConn(null);
              void deleteConnection(conn);
            }}
            onCancel={() => setDeletingConn(null)}
          />
        )}
      </Show>

      <Show when={varPrompt()}>
        {(prompt) => (
          <VariablesDialog
            variables={prompt().variables}
            values={prompt().values}
            onRun={runWithValues}
            onCancel={() => setVarPrompt(null)}
          />
        )}
      </Show>

      <Show when={exportAsk()}>
        {(fmt) => {
          const tab = current();
          const r = currentResult();
          return (
            <ExportDialog
              formats={EXPORT_FORMATS}
              initialFormat={fmt()}
              loaded={r.result?.rows.length ?? 0}
              marked={markedRows().length}
              canReadAll={!!tab && !!tabConn(tab) && exportSql(tab.id, r) !== null}
              more={!!r.result?.truncated}
              onExport={(choice) => void runExport(choice)}
              onCancel={() => setExportAsk(null)}
            />
          );
        }}
      </Show>

      <Show when={exportStatus()}>
        {(status) => (
          <div
            class={`app-toast${status().error ? " app-toast-error" : ""}`}
            role={status().error ? "alert" : "status"}
          >
            <span class="app-toast-text">
              {status().text}
              {/* Determinate only when the total is honestly known; otherwise
                  the bar just moves, which during the write is the only thing
                  on screen that still can — that stretch blocks the main thread
                  and the animation runs on the compositor. */}
              <Show when={status().rows !== undefined}>
                <span
                  class={`app-toast-bar${status().total ? "" : " indeterminate"}`}
                  role="progressbar"
                  aria-valuenow={status().total ? exportPercent(status()) : undefined}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <span
                    class="app-toast-bar-fill"
                    style={
                      status().total ? { width: `${exportPercent(status())}%` } : undefined
                    }
                  />
                </span>
              </Show>
              <Show when={status().hint}>
                <span class="app-toast-hint">{status().hint}</span>
              </Show>
            </span>
            <Show when={status().rows !== undefined}>
              <button type="button" class="btn" onClick={() => exportCtl?.abort()}>
                {t("common.cancel")}
              </button>
            </Show>
            <button
              class="app-toast-close"
              title={t("panel.close")}
              aria-label={t("panel.close")}
              onClick={() => setExportStatus(null)}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        )}
      </Show>

      <Show when={localWarn()}>
        {(text) => (
          <div class="app-toast app-toast-error" role="alert">
            <span class="app-toast-text">{text()}</span>
            <button
              class="app-toast-close"
              title={t("panel.close")}
              aria-label={t("panel.close")}
              onClick={() => setLocalWarn(null)}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        )}
      </Show>

      <Show when={runToast()}>
        {(toast) => (
          <div
            class={`app-toast app-toast-run${toast().error ? " app-toast-error" : ""}`}
            role="status"
          >
            <span class="app-toast-text">{toast().text}</span>
            <button
              class="app-toast-close"
              title={t("panel.close")}
              aria-label={t("panel.close")}
              onClick={() => setRunToast(null)}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        )}
      </Show>

      <Show when={notice()}>
        {(text) => (
          <div class="app-toast" role="status">
            <span class="app-toast-text">{text()}</span>
            <button
              class="app-toast-close"
              title={t("panel.close")}
              aria-label={t("panel.close")}
              onClick={() => setNotice(null)}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        )}
      </Show>

      <Show when={cacheNotice()}>
        {(text) => (
          <div class="app-toast" role="status">
            <span class="app-toast-text">{text()}</span>
            <button
              class="app-toast-close"
              title={t("panel.close")}
              aria-label={t("panel.close")}
              onClick={() => setCacheNotice(null)}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        )}
      </Show>

      <Show when={connError()}>
        <div class="app-toast app-toast-error" role="alert">
          <span class="app-toast-text">{connError()}</span>
          {/* Saying the connection is gone without offering the one action that
              fixes it is half a message (issue #407). Only when there is one to
              reconnect: the same banner also reports a failed OPEN, where the
              user is already in the connection dialog. */}
          <Show when={active()?.lost}>
            <button class="app-toast-action" onClick={reconnect}>
              {t("conn.reconnect")}
            </button>
          </Show>
          <button
            class="app-toast-close"
            title={t("panel.close")}
            aria-label={t("panel.close")}
            onClick={() => setConnError(null)}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      </Show>

      <Show when={txPrompt()}>
        {(conn) => (
          <ConfirmDialog
            title={t("tx.closeTitle")}
            message={t("tx.closeMessage", { name: conn().name, n: txOf(conn()).statements })}
            confirmLabel={t("tx.rollback")}
            altLabel={t("tx.commit")}
            busy={txBusy()}
            error={txPromptError()}
            onConfirm={() => void settleTxPrompt("rollback")}
            onAlt={() => void settleTxPrompt("commit")}
            onCancel={closeTxPrompt}
          />
        )}
      </Show>

      <StatusBar
        connection={
          tabConn(current())
            ? {
                name: tabConn(current())!.name,
                engine: driverSchema(tabConn(current())!.driver)?.label ?? tabConn(current())!.driver,
                color: tabConn(current())!.color,
                db: tabConn(current())!.defId === focusedDefId() ? activeDb() : null,
                lost: tabConn(current())!.lost,
              }
            : null
        }
        safeMode={tabSafeMode(current())}
        txStatements={txOpenCount(tabConn(current()))}
        onTxAction={
          current()?.kind === "query"
            ? (e) =>
                openContextMenu(e, [
                  { label: t("tx.commit"), action: () => void endTabTx("commit") },
                  { label: t("tx.rollback"), danger: true, action: () => void endTabTx("rollback") },
                ])
            : undefined
        }
        kind={statusKind()}
        rowCount={currentResult().result?.rows.length ?? null}
        markedCount={markedRows().length}
        summary={cellSummary()}
        truncated={currentResult().result?.truncated ?? false}
        elapsedMs={currentResult().elapsedMs}
        ranAt={currentResult().ranAt}
        ranScope={currentResult().ranScope ?? null}
        object={sourceLabel(currentResult().source)}
        columnCount={currentResult().result?.columns.length ?? null}
        cursor={editorCursor()}
        zoom={settings().zoom}
        onResetZoom={() => patchSettings({ zoom: 100 })}
      />

      <CommandPalette
        open={paletteOpen()}
        commands={visiblePaletteCommands()}
        placeholder={
          paletteMode() === "objects"
            ? t("cmdk.objectsPlaceholder")
            : paletteMode() === "snippets"
              ? t("snip.palettePlaceholder")
              : undefined
        }
        footer={paletteMode() === "snippets" ? t("snip.paletteFooter") : undefined}
        emptySetLabel={
          paletteMode() === "snippets" ? t("snip.paletteEmptySet") : undefined
        }
        onClose={() => setPaletteOpen(false)}
      />

      <UpdateModal
        update={update()}
        currentVersion={APP_VERSION}
        onClose={() => setUpdate(null)}
        onSkip={(v) => {
          saveSkippedVersion(v);
          setUpdate(null);
        }}
        onDownload={(url) => {
          openExternal(url);
          setUpdate(null);
        }}
        onInstall={canInstall() ? installUpdate : undefined}
      />

      <Show when={related.open}>
        <RelatedData
          table={related.table}
          column={related.column}
          value={related.value}
          queries={related.queries}
          counts={related.counts}
          selected={related.selected}
          onSelect={(i) => void runRelated(i)}
          sql={related.sql}
          keyColumns={related.keyColumns}
          result={related.result}
          loading={related.loading}
          error={related.error}
          truncated={related.truncated}
          unsupported={related.unsupported}
          onOpenTab={relatedToTab}
          onClose={closeRelated}
        />
      </Show>

      <Show when={pendingRestore()}>
        {(saved) => (
          <RestorePrompt
            tabCount={saved().tabs.length}
            connections={restoreConnIds(saved())
              .map((id) => connections().find((c) => c.id === id)?.name)
              .filter((n): n is string => !!n)}
            onResume={() => void resumeSession()}
            onDiscard={() => setPendingRestore(null)}
            onLater={() => {
              setRestoreDeferred(true);
              setPendingRestore(null);
            }}
          />
        )}
      </Show>

      <Show when={writeConfirm()}>
        {(w) => (
          <ConfirmDialog
            title={t("safe.confirmTitle", { name: w().guard.name })}
            message={t("safe.confirmMessage", { name: w().guard.name, n: w().writes.length })}
            sql={confirmListing(w().writes)}
            confirmLabel={t("safe.confirmRun")}
            /* What loses data on a protected connection asks for its name typed
               (audit A-25, R-15): a second click is too easy a yes. */
            typeToConfirm={typedNameFor(writeConfirm())}
            onConfirm={() => answerWriteConfirm(true)}
            onCancel={() => answerWriteConfirm(false)}
          />
        )}
      </Show>

      <ContextMenu />
    </div>
  );
}
