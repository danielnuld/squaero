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
  type GrantLevel,
  type GrantOptions,
  type GrantTarget,
  type UserRow,
} from "../utils/userAdmin";
import { parseTreeRows, schemaTree } from "../utils/schema";
import { Panel } from "./Panel";
import { ConfirmDialog } from "./ConfirmDialog";
import { t } from "../utils/i18n";
import { Icon } from "./icons";
import { clampSidebarWidth, USERS_W_DEFAULT, USERS_W_MAX, USERS_W_MIN } from "../utils/layout";
import { paneSize, savePaneSize } from "../utils/paneSizes";
import { Dropdown } from "./Dropdown";

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
  const [customScope, setCustomScope] = createSignal("");
  const [databases, setDatabases] = createSignal<string[]>([]);
  const [tables, setTables] = createSignal<string[]>([]);
  const target = (): GrantTarget => {
    switch (level()) {
      case "server":
        return { level: "server" };
      case "table":
        return { level: "table", db: scopeDb(), table: scopeTable() };
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
    if (level() !== "table" || !db) return;
    schemaTree(props.connId, db)
      .then((res) => {
        if (scopeDb() === db) setTables(parseTreeRows(res, "schema").map((r) => r.name));
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

  const confirmDropUser = async () => {
    const p = pendingDrop();
    if (!p) return;
    setBusy(true);
    setError(null);
    try {
      await runQuery(props.connId, p.sql);
      if (selected()?.name === p.user.name && selected()?.host === p.user.host) setSelected(null);
      setPendingDrop(null); // close only on success; on error keep the dialog open
      await loadUsers();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
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
      status={
        <Show when={support.supported}>
          {filtering()
            ? t("users.countFiltered", { n: shown().length, m: users().length })
            : t("users.count", { n: users().length })}
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
        fallback={<p class="grid-empty">{unsupportedReason(props.engine)}</p>}
      >
        <div
          class="um-body"
          ref={bodyEl}
          style={{ "grid-template-columns": `${listWidth()}px 5px 1fr` }}
        >
          <div class="um-users">
            <div class="import-subtitle">{t("users.newUser")}</div>
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
              <button
                class="primary"
                disabled={busy() || !createUserPreview()}
                onClick={createUser}
              >
                {t("users.create")}
              </button>
              <Show when={createUserDisplay()}>
                <pre class="ddl-text um-preview">{createUserDisplay()};</pre>
              </Show>
            </div>

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
                    <button
                      class="grid-action danger um-drop"
                      title={t("users.dropTitle", { who: `${u.name}@${u.host}` })}
                      aria-label={t("users.dropTitle", { who: `${u.name}@${u.host}` })}
                      disabled={busy()}
                      onClick={(e) => {
                        e.stopPropagation();
                        requestDropUser(u);
                      }}
                    >
                      <Icon name="trash" size={14} />
                    </button>
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
              <div class="import-subtitle">
                {t("users.permsOf", { who: `${selected()!.name}@${selected()!.host}` })}
              </div>
              <Show
                when={grants().length > 0}
                fallback={<p class="grid-empty">{t("users.noPerms")}</p>}
              >
                <pre class="ddl-text">{grants().join(";\n")}</pre>
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
                <label class="field">
                  <span>{t("users.scope")}</span>
                  <Dropdown
                    value={level()}
                    options={[{ value: "database", label: t("users.scopeDatabase") }, { value: "table", label: t("users.scopeTable") }, { value: "server", label: t("users.scopeServer") }, { value: "custom", label: t("users.scopeCustom") }]}
                    onChange={(v) => setLevel(v as GrantLevel)}
                  />
                </label>
                <Show when={level() === "database" || level() === "table"}>
                  <label class="field um-scope">
                    <span>{t("users.database")}</span>
                    <Dropdown
                      value={scopeDb()}
                      options={[{ value: "", label: "—" }, ...databases().map((d) => ({ value: d, label: d }))]}
                      onChange={(v) => setScopeDb(v)}
                    />
                  </label>
                </Show>
                <Show when={level() === "table"}>
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

              <Show when={level() === "server"}>
                <p class="related-warn um-scope">{t("users.serverWide")}</p>
              </Show>

              <pre class="ddl-text um-preview">
                {grantPreview()
                  ? `${grantPreview()};\n${revokePreview()};`
                  : t("users.pickHint")}
              </pre>

              <div class="modal-actions">
                <button
                  class="primary"
                  disabled={busy() || !grantPreview()}
                  onClick={() => apply(grantPreview()!)}
                >
                  {t("users.grant")}
                </button>
                <button
                  class="danger"
                  disabled={busy() || !revokePreview()}
                  onClick={() => apply(revokePreview()!)}
                >
                  {t("users.revoke")}
                </button>
              </div>
            </Show>
          </div>
        </div>
      </Show>

      <Show when={pendingDrop()}>
        {(p) => (
          <ConfirmDialog
            title={t("users.dropDialogTitle")}
            message={t("users.dropMessage", { who: `${p().user.name}@${p().user.host}` })}
            sql={p().sql}
            confirmLabel={t("users.dropDialogTitle")}
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
