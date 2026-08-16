import { For, Show, createMemo, createSignal, onMount } from "solid-js";
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
  MYSQL_PRIVILEGES,
  type GrantOptions,
  type UserRow,
} from "../utils/userAdmin";
import { Panel } from "./Panel";
import { ConfirmDialog } from "./ConfirmDialog";
import { t } from "../utils/i18n";

// User / privilege management (issue #140): list the server's users, view a
// selected user's grants, and grant/revoke privileges from a form with a live SQL
// preview — all via query.run using the per-engine SQL in utils/userAdmin.ts.
// MySQL/MariaDB are supported; other engines show an honest message.
// Issue #360 adds the search box, the SUPER/GRANT markers and the two quick
// filters; all of that is pure filtering over the already-loaded list.
export function UserManager(props: {
  connId: string;
  engine: string;
  onClose: () => void;
}) {
  const support = userAdminFor(props.engine);
  const [users, setUsers] = createSignal<UserRow[]>([]);
  const [selected, setSelected] = createSignal<UserRow | null>(null);
  const [grants, setGrants] = createSignal<string[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
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
  const [scope, setScope] = createSignal("*.*");
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

  const grantOpts = (): GrantOptions => ({
    privileges: Object.entries(privs).filter(([, on]) => on).map(([p]) => p),
    scope: scope(),
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

  onMount(loadUsers);

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
        <div class="um-body">
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
                      🗑
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </div>

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
                <For each={MYSQL_PRIVILEGES}>
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
                <label class="field um-scope">
                  <span>{t("users.scope")}</span>
                  <input
                    type="text"
                    value={scope()}
                    onInput={(e) => setScope(e.currentTarget.value)}
                    placeholder={t("users.scopePlaceholder")}
                  />
                </label>
              </div>

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
