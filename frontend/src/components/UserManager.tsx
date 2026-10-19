import { connGuard, withConfirmedWrites } from "../utils/transport";
import { For, Show, createEffect, createMemo, createSignal, onMount } from "solid-js";
import { createStore } from "solid-js/store";
import { runQuery } from "../utils/query";
import { errorText } from "../utils/errors";
import {
  userAdminFor,
  showGrantsSql,
  buildGrantSql,
  buildRevokeSql,
  buildCreateUserSql,
  buildDropUserSql,
  unsupportedReason,
  parseUserRows,
  searchUsers,
  grantScope,
  privilegesFor,
  parseGrant,
  buildSetPasswordSql,
  buildLockUserSql,
  type GrantLevel,
  type GrantOptions,
  type GrantTarget,
  type UserRow,
} from "../utils/userAdmin";
import { parseTreeRows, schemaDescribe, schemaTree } from "../utils/schema";
import { describeColumnNames } from "../utils/edit";
import { copyText } from "../utils/rowCopy";
import { openContextMenu } from "../utils/contextMenu";
import { Dialog } from "./Dialog";
import { Segmented } from "./Segmented";
import { EmptyNote } from "./EmptyNote";
import { Panel } from "./Panel";
import { ConfirmDialog } from "./ConfirmDialog";
import { t } from "../utils/i18n";
import { countText, dropConfirm, revokeConfirm, type ConfirmText } from "../utils/confirmText";
import { clampSidebarWidth, USERS_W_DEFAULT, USERS_W_MAX, USERS_W_MIN } from "../utils/layout";
import { paneSize, savePaneSize } from "../utils/paneSizes";
import { Dropdown } from "./Dropdown";

// P6 depth (prototype UsersGrants): the grants read as scope → privilege chips
// (the raw GRANT lines one click away), a grant can be limited to columns, the
// scope is a segmented choice, «Nuevo usuario» is a dialog, and «Más» changes
// the password, locks or unlocks the account and copies its GRANT lines.
// User / privilege management (issue #140): list the server's users, view a
// selected user's grants, and grant/revoke privileges from a form with a live SQL
// preview — all via query.run using the per-engine SQL in utils/userAdmin.ts.
// MySQL/MariaDB are supported; other engines show an honest message.
// Issue #360 adds the search box, the SUPER/GRANT markers and the two quick
// filters; all of that is pure filtering over the already-loaded list.
export function UserManager(props: {
  connId: string;
  engine: string;
  /** The connection's active database: the default target of a grant. */
  db?: string;
  onClose: () => void;
}) {
  const support = userAdminFor(props.engine);
  const [users, setUsers] = createSignal<UserRow[]>([]);
  const [selected, setSelected] = createSignal<UserRow | null>(null);
  const [grants, setGrants] = createSignal<string[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  // Width of the user list, dragged and remembered (issue #491): a fixed column
  // cut every long name, and `nombre@host` is long by construction.
  const [listWidth, setListWidth] = createSignal(
    clampSidebarWidth(paneSize("usersList", USERS_W_DEFAULT), USERS_W_MIN, USERS_W_MAX),
  );
  let bodyEl: HTMLDivElement | undefined;
  const startListResize = (e: MouseEvent) => {
    e.preventDefault();
    const left = bodyEl?.getBoundingClientRect().left ?? 0;
    const onMove = (ev: MouseEvent) =>
      setListWidth(clampSidebarWidth(ev.clientX - left, USERS_W_MIN, USERS_W_MAX));
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      savePaneSize("usersList", listWidth());
    };
    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };
  const [pendingDrop, setPendingDrop] = createSignal<{ user: UserRow; sql: string } | null>(null);
  // Revoking asks first (audit P1): who loses which privileges, where.
  const [pendingRevoke, setPendingRevoke] = createSignal<{ sql: string; text: ConfirmText } | null>(null);

  // Search + quick filters (issue #360). Everything filters the loaded list in
  // memory — no re-query, so typing stays instant on a server with many accounts.
  const [query, setQuery] = createSignal("");
  const [onlySuper, setOnlySuper] = createSignal(false);
  const [hideSystem, setHideSystem] = createSignal(false);
  const shown = createMemo(() =>
    searchUsers(users(), {
      query: query(),
      onlySuper: onlySuper(),
      hideSystem: hideSystem(),
    }),
  );
  const filtering = createMemo(() => shown().length !== users().length);

  // Grant/revoke form.
  const [privs, setPrivs] = createStore<Record<string, boolean>>({});
  // What the grant applies to (issue #657). It starts on the active database,
  // never on *.*: server-wide has to be picked on purpose.
  const [level, setLevel] = createSignal<GrantLevel>("database");
  const [scopeDb, setScopeDb] = createSignal(props.db ?? "");
  const [scopeTable, setScopeTable] = createSignal("");
  const [scopeCols, setScopeCols] = createSignal<string[]>([]);
  const [tableCols, setTableCols] = createSignal<string[]>([]);
  const [showRaw, setShowRaw] = createSignal(false);
  const [newOpen, setNewOpen] = createSignal(false);
  const [pwOpen, setPwOpen] = createSignal(false);
  const [pw, setPw] = createSignal("");
  const readable = createMemo(() => grants().map((g) => ({ raw: g, parsed: parseGrant(g) })));
  const [customScope, setCustomScope] = createSignal("");
  const [databases, setDatabases] = createSignal<string[]>([]);
  const [tables, setTables] = createSignal<string[]>([]);
  const target = (): GrantTarget => {
    switch (level()) {
      case "server":
        return { level: "server" };
      case "table":
        return { level: "table", db: scopeDb(), table: scopeTable() };
      case "column":
        return { level: "column", db: scopeDb(), table: scopeTable(), columns: scopeCols() };
      case "custom":
        return { level: "custom", text: customScope() };
      default:
        return { level: "database", db: scopeDb() };
    }
  };
  const offered = createMemo(() => privilegesFor(level()));
  // Editable host: seeded from the selected user but changeable, so GRANT/REVOKE
  // can target a specific host (user@host).
  const [hostInput, setHostInput] = createSignal("%");

  // New-user form.
  const [newName, setNewName] = createSignal("");
  const [newHost, setNewHost] = createSignal("%");
  const [newPass, setNewPass] = createSignal("");

  const loadUsers = async () => {
    if (!support.supported || !support.listUsersSql) return;
    setLoading(true);
    setError(null);
    try {
      setUsers(parseUserRows(await runQuery(props.connId, support.listUsersSql), support));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  const selectUser = async (u: UserRow) => {
    setSelected(u);
    setHostInput(u.host || "%");
    setGrants([]);
    const sql = showGrantsSql(props.engine, u.name, u.host);
    if (!sql) return;
    try {
      const res = await runQuery(props.connId, sql);
      // SHOW GRANTS returns one text column, one grant statement per row.
      setGrants(res.rows.map((r) => r[0] ?? "").filter((g) => g));
    } catch (err) {
      setError(errorText(err));
    }
  };

  const loadDatabases = async () => {
    try {
      setDatabases(parseTreeRows(await schemaTree(props.connId), "database").map((r) => r.name));
    } catch (err) {
      setError(errorText(err));
    }
  };

  // The table list is only needed at table level, and follows the database.
  createEffect(() => {
    const db = scopeDb();
    setScopeTable("");
    setTables([]);
    if ((level() !== "table" && level() !== "column") || !db) return;
    schemaTree(props.connId, db)
      .then((res) => {
        if (scopeDb() === db) setTables(parseTreeRows(res, "schema").map((r) => r.name));
      })
      .catch((err) => setError(errorText(err)));
  });

  // The column list follows the table, at column level only.
  createEffect(() => {
    const table = scopeTable();
    const db = scopeDb();
    setScopeCols([]);
    setTableCols([]);
    if (level() !== "column" || !table) return;
    schemaDescribe(props.connId, table, db || undefined)
      .then((res) => {
        if (scopeTable() === table) setTableCols(describeColumnNames(res));
      })
      .catch((err) => setError(errorText(err)));
  });

  const grantOpts = (): GrantOptions => ({
    // Only what the level offers: a box ticked before switching to table level
    // (EXECUTE) is not sent there.
    privileges: Object.entries(privs)
      .filter(([p, on]) => on && offered().includes(p))
      .map(([p]) => p),
    scope: grantScope(target()) ?? "",
    user: selected()?.name ?? "",
    host: hostInput(),
    columns: level() === "column" ? scopeCols() : undefined,
  });

  const grantPreview = createMemo(() => buildGrantSql(props.engine, grantOpts()));
  const revokePreview = createMemo(() => buildRevokeSql(props.engine, grantOpts()));

  const apply = async (sql: string) => {
    setBusy(true);
    setError(null);
    try {
      await runQuery(props.connId, sql);
      const u = selected();
      if (u) await selectUser(u); // refresh grants
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const createUserPreview = createMemo(() =>
    buildCreateUserSql(props.engine, {
      user: newName(),
      host: newHost(),
      password: newPass(),
    }),
  );

  // Preview shown to the user masks the password so it isn't exposed on screen
  // (screen-share / shoulder-surfing); the real statement is only built at run time.
  const createUserDisplay = createMemo(() =>
    buildCreateUserSql(props.engine, {
      user: newName(),
      host: newHost(),
      password: newPass() ? "••••••" : "",
    }),
  );

  const createUser = async () => {
    const sql = createUserPreview();
    if (!sql) return;
    setBusy(true);
    setError(null);
    try {
      await runQuery(props.connId, sql);
      const name = newName().trim();
      const host = newHost().trim() || "%";
      setNewName("");
      setNewPass("");
      setNewOpen(false);
      await loadUsers();
      // Focus the just-created user, taking its row from the reloaded list so
      // its privilege flags are the server's, not assumed.
      const created = users().find((u) => u.name === name && u.host === host);
      await selectUser(created ?? { name, host, superuser: false, grantOption: false });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  // Ask before dropping a user via the shared themed dialog (issue #177),
  // showing the exact SQL — no native confirm().
  const requestDropUser = (u: UserRow) => {
    const sql = buildDropUserSql(props.engine, u.name, u.host);
    if (!sql) return;
    setError(null);
    setPendingDrop({ user: u, sql });
  };

  const typedDrop = () => connGuard(props.connId)?.mode === "confirm";
  const confirmDropUser = async () => {
    const p = pendingDrop();
    if (!p) return;
    setBusy(true);
    setError(null);
    try {
      // On a protected connection the dialog itself took the typed name: the
      // guard is not asked a second time.
      if (typedDrop()) await withConfirmedWrites(props.connId, () => runQuery(props.connId, p.sql));
      else await runQuery(props.connId, p.sql);
      if (selected()?.name === p.user.name && selected()?.host === p.user.host) setSelected(null);
      setPendingDrop(null); // close only on success; on error keep the dialog open
      await loadUsers();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const runOnSelected = async (sql: string | null, done?: () => void) => {
    if (!sql) return;
    setBusy(true);
    setError(null);
    try {
      await runQuery(props.connId, sql);
      done?.();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const openPassword = () => {
    setPw("");
    setError(null);
    setPwOpen(true);
  };

  const moreMenu = (e: MouseEvent) => {
    const u = selected();
    if (!u) return;
    openContextMenu(e, [
      { label: t("users.more.password"), action: openPassword },
      { label: t("users.more.lock"), action: () => void runOnSelected(buildLockUserSql(props.engine, u.name, u.host, true)) },
      { label: t("users.more.unlock"), action: () => void runOnSelected(buildLockUserSql(props.engine, u.name, u.host, false)) },
      { separator: true },
      {
        label: t("users.more.copyGrants"),
        disabled: grants().length === 0,
        action: () => copyText(grants().map((g) => g + ";").join("\n")),
      },
    ]);
  };

  onMount(() => {
    void loadUsers();
    if (support.supported) void loadDatabases();
  });

  return (
    <Panel
      title={t("tool.users.label")}
      wide
      class="user-mgr"
      onClose={props.onClose}
      actions={
        <Show when={support.supported}>
          <button
            type="button"
            class="edit-btn"
            onClick={() => {
              setError(null);
              setNewOpen(true);
            }}
          >
            {t("users.newUserBtn")}
          </button>
          <button
            type="button"
            class="edit-btn edit-btn-menu"
            aria-haspopup="menu"
            disabled={!selected() || busy()}
            title={selected() ? t("users.moreTitle") : t("users.selectHint")}
            onClick={moreMenu}
          >
            {t("users.more")}
          </button>
        </Show>
      }
      status={
        <Show when={support.supported}>
          {filtering()
            ? t("users.countFiltered", { n: shown().length, m: users().length })
            : countText("users.count", users().length)}
        </Show>
      }
      onRefresh={support.supported ? loadUsers : undefined}
      refreshing={loading()}
    >
      <Show when={error()}>
        <div class="grid-error" role="alert">
          {error()}
        </div>
      </Show>

      <Show
        when={support.supported}
        fallback={<EmptyNote title={t("users.unsupportedTitle")} text={unsupportedReason(props.engine)} />}
      >
        <div
          class="um-body"
          ref={bodyEl}
          style={{ "grid-template-columns": `${listWidth()}px 5px 1fr` }}
        >
          <div class="um-users">
            <Show when={newOpen()}>
            <Dialog
              title={t("users.newUser")}
              size="sm"
              onCancel={() => setNewOpen(false)}
              busy={busy()}
              error={error()}
              primary={{ label: t("users.create"), disabled: !createUserPreview(), onClick: () => void createUser() }}
            >
            <div class="um-new-user">
              <input
                type="text"
                value={newName()}
                onInput={(e) => setNewName(e.currentTarget.value)}
                placeholder={t("users.name")}
                aria-label={t("users.name")}
              />
              <input
                type="text"
                value={newHost()}
                onInput={(e) => setNewHost(e.currentTarget.value)}
                placeholder={t("users.hostPlaceholder")}
                aria-label={t("users.hostAria")}
              />
              <input
                type="password"
                value={newPass()}
                onInput={(e) => setNewPass(e.currentTarget.value)}
                placeholder={t("users.passPlaceholder")}
                aria-label={t("users.passAria")}
              />
              <Show when={createUserDisplay()}>
                <pre class="ddl-text um-preview">{createUserDisplay()};</pre>
              </Show>
            </div>
            </Dialog>
            </Show>

            <div class="import-subtitle">{t("users.users")}</div>
            <input
              class="um-search"
              type="search"
              value={query()}
              placeholder={t("users.searchPlaceholder")}
              aria-label={t("users.searchAria")}
              onInput={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQuery("");
                // Enter opens the only thing the search is pointing at.
                if (e.key === "Enter" && shown().length > 0) void selectUser(shown()[0]);
              }}
            />
            <div class="um-filters">
              <button
                class={`um-filter ${onlySuper() ? "on" : ""}`}
                aria-pressed={onlySuper()}
                onClick={() => setOnlySuper(!onlySuper())}
              >
                {t("users.onlySuper")}
              </button>
              <button
                class={`um-filter ${hideSystem() ? "on" : ""}`}
                aria-pressed={hideSystem()}
                onClick={() => setHideSystem(!hideSystem())}
              >
                {t("users.hideSystem")}
              </button>
            </div>
            <Show when={users().length > 0 && shown().length === 0}>
              <p class="grid-empty">{t("users.noMatches")}</p>
            </Show>
            <ul class="um-user-list">
              <For each={shown()}>
                {(u) => (
                  <li
                    class={`um-user ${
                      selected()?.name === u.name && selected()?.host === u.host ? "active" : ""
                    }`}
                    onClick={() => selectUser(u)}
                  >
                    <span class="um-user-name">{u.name}</span>
                    <span class="um-user-host">@{u.host}</span>
                    <span class="um-chips">
                      <Show when={u.superuser}>
                        <span class="um-chip" title={t("users.superTitle")}>SUPER</span>
                      </Show>
                      <Show when={u.grantOption}>
                        <span class="um-chip grant" title={t("users.grantTitle")}>GRANT</span>
                      </Show>
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </div>

          <div
            class="resizer"
            role="separator"
            aria-orientation="vertical"
            onMouseDown={startListResize}
          />

          <div class="um-detail">
            <Show
              when={selected()}
              fallback={<p class="grid-empty">{t("users.selectHint")}</p>}
            >
              <div class="um-detail-head">
                <span class="import-subtitle">
                  {t("users.permsOf", { who: `${selected()!.name}@${selected()!.host}` })}
                </span>
                <span class="panel-bar-spacer" />
                {/* The one place a user is dropped from: the account being looked at,
                    behind the confirmation (typed name on a protected connection). */}
                <button
                  type="button"
                  class="btn danger-text um-drop"
                  disabled={busy()}
                  title={t("users.dropTitle", { who: `${selected()!.name}@${selected()!.host}` })}
                  onClick={() => requestDropUser(selected()!)}
                >
                  {t("users.dropUser")}
                </button>
              </div>
              <Show
                when={grants().length > 0}
                fallback={<p class="grid-empty">{t("users.noPerms")}</p>}
              >
                <button
                  type="button"
                  class="edit-btn um-raw-toggle"
                  aria-pressed={showRaw()}
                  onClick={() => setShowRaw(!showRaw())}
                >
                  {t("users.showGrantSql")}
                </button>
                <Show
                  when={!showRaw()}
                  fallback={<pre class="ddl-text">{grants().map((g) => g + ";").join("\n")}</pre>}
                >
                  <ul class="um-grants">
                    <For each={readable()}>
                      {(g) => (
                        <Show
                          when={g.parsed}
                          fallback={
                            <li class="um-grant">
                              <code>{g.raw}</code>
                            </li>
                          }
                        >
                          {(p) => (
                            <li class="um-grant">
                              <span class="um-grant-scope">
                                {p().level === "role"
                                  ? t("users.scopeRoles")
                                  : p().level === "server"
                                    ? t("users.scopeAll", { scope: p().scope! })
                                    : p().scope}
                              </span>
                              <span class="um-grant-privs">
                                <For each={p().privileges}>
                                  {(pr) => (
                                    <span
                                      class="chip um-priv-chip"
                                      title={pr.name === "USAGE" ? t("users.usageTitle") : undefined}
                                    >
                                      {pr.columns.length > 0 ? pr.name + " (" + pr.columns.join(", ") + ")" : pr.name}
                                    </span>
                                  )}
                                </For>
                                <Show when={p().grantOption}>
                                  <span class="chip um-priv-chip" title={t("users.grantTitle")}>
                                    GRANT OPTION
                                  </span>
                                </Show>
                              </span>
                            </li>
                          )}
                        </Show>
                      )}
                    </For>
                  </ul>
                </Show>
              </Show>

              <div class="import-subtitle" style={{ "margin-top": "0.8rem" }}>
                {t("users.grantRevoke")}
              </div>
              <div class="um-privs">
                <For each={offered()}>
                  {(p) => (
                    <label class="um-priv">
                      <input
                        type="checkbox"
                        checked={privs[p] ?? false}
                        onChange={(e) => setPrivs(p, e.currentTarget.checked)}
                      />{" "}
                      {p}
                    </label>
                  )}
                </For>
              </div>
              <div class="um-form-row">
                <label class="field">
                  <span>{t("users.hostLabel")}</span>
                  <input
                    type="text"
                    value={hostInput()}
                    onInput={(e) => setHostInput(e.currentTarget.value)}
                    placeholder="%  |  localhost  |  10.0.0.5"
                  />
                </label>
                <div class="field">
                  <span>{t("users.scope")}</span>
                  <Segmented
                    label={t("users.scope")}
                    value={level()}
                    options={[
                      { value: "server" as GrantLevel, label: t("users.scopeServer") },
                      { value: "database" as GrantLevel, label: t("users.scopeDatabase") },
                      { value: "table" as GrantLevel, label: t("users.scopeTable") },
                      { value: "column" as GrantLevel, label: t("users.scopeColumn") },
                      { value: "custom" as GrantLevel, label: t("users.scopeCustom") },
                    ]}
                    onChange={setLevel}
                  />
                </div>
                <Show when={level() === "database" || level() === "table" || level() === "column"}>
                  <label class="field um-scope">
                    <span>{t("users.database")}</span>
                    <Dropdown
                      value={scopeDb()}
                      options={[{ value: "", label: "—" }, ...databases().map((d) => ({ value: d, label: d }))]}
                      onChange={(v) => setScopeDb(v)}
                    />
                  </label>
                </Show>
                <Show when={level() === "table" || level() === "column"}>
                  <label class="field um-scope">
                    <span>{t("users.table")}</span>
                    <Dropdown
                      value={scopeTable()}
                      options={[{ value: "", label: "—" }, ...tables().map((n) => ({ value: n, label: n }))]}
                      onChange={(v) => setScopeTable(v)}
                      disabled={!scopeDb()}
                    />
                  </label>
                </Show>
                <Show when={level() === "custom"}>
                  <label class="field um-scope">
                    <span>ON</span>
                    <input
                      type="text"
                      value={customScope()}
                      onInput={(e) => setCustomScope(e.currentTarget.value)}
                      placeholder={t("users.scopePlaceholder")}
                    />
                  </label>
                </Show>
              </div>

              <Show when={level() === "column" && scopeTable()}>
                <fieldset class="um-cols">
                  <legend>{t("users.columns")}</legend>
                  <Show when={tableCols().length > 0} fallback={<span class="help">{t("users.columnsLoading")}</span>}>
                    <For each={tableCols()}>
                      {(c) => (
                        <label class="um-priv">
                          <input
                            type="checkbox"
                            checked={scopeCols().includes(c)}
                            onChange={(e) => {
                              const on = e.currentTarget.checked;
                              setScopeCols((cur) => (on ? [...cur, c] : cur.filter((x) => x !== c)));
                            }}
                          />{" "}
                          {c}
                        </label>
                      )}
                    </For>
                  </Show>
                </fieldset>
              </Show>

              <Show when={level() === "server"}>
                <p class="related-warn um-scope">{t("users.serverWide")}</p>
              </Show>

              <pre class="ddl-text um-preview">
                {grantPreview()
                  ? `${grantPreview()};\n${revokePreview()};`
                  : t("users.pickHint")}
              </pre>

              <div class="panel-foot">
                <button
                  class="btn-primary"
                  disabled={busy() || !grantPreview()}
                  onClick={() => apply(grantPreview()!)}
                >
                  {t("users.grant")}
                </button>
                <button
                  class="btn danger-text"
                  disabled={busy() || !revokePreview()}
                  onClick={() => {
                    const o = grantOpts();
                    setPendingRevoke({
                      sql: revokePreview()!,
                      text: revokeConfirm(`${o.user}@${o.host}`, o.privileges, o.scope),
                    });
                  }}
                >
                  {t("users.revoke")}
                </button>
              </div>
            </Show>
          </div>
        </div>
      </Show>

      <Show when={pwOpen() && selected()}>
        {(u) => (
          <Dialog
            title={t("users.pwTitle", { who: u().name + "@" + u().host })}
            size="sm"
            onCancel={() => setPwOpen(false)}
            busy={busy()}
            error={error()}
            primary={{
              label: t("users.pwApply"),
              disabled: pw().length === 0,
              onClick: () =>
                void runOnSelected(buildSetPasswordSql(props.engine, u().name, u().host, pw()), () => {
                  setPw("");
                  setPwOpen(false);
                }),
            }}
          >
            <label class="field">
              <span>{t("users.pwNew")}</span>
              <input
                type="password"
                value={pw()}
                autocomplete="new-password"
                onInput={(e) => setPw(e.currentTarget.value)}
              />
            </label>
          </Dialog>
        )}
      </Show>
      <Show when={pendingRevoke()}>
        {(p) => (
          <ConfirmDialog
            title={p().text.title}
            message={p().text.message}
            sql={p().sql}
            confirmLabel={p().text.confirm}
            busy={busy()}
            onConfirm={() => {
              const sql = p().sql;
              setPendingRevoke(null);
              void apply(sql);
            }}
            onCancel={() => setPendingRevoke(null)}
          />
        )}
      </Show>
      <Show when={pendingDrop()}>
        {(p) => (
          <ConfirmDialog
            title={dropConfirm("user", `${p().user.name}@${p().user.host}`).title}
            message={dropConfirm("user", "").message}
            sql={p().sql}
            typeToConfirm={typedDrop() ? p().user.name : undefined}
            confirmLabel={dropConfirm("user", "").confirm}
            busy={busy()}
            error={error()}
            onConfirm={() => void confirmDropUser()}
            onCancel={() => setPendingDrop(null)}
          />
        )}
      </Show>
    </Panel>
  );
}
