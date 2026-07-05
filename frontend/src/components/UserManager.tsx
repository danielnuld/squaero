import { For, Show, createMemo, createSignal, onMount } from "solid-js";
import { createStore } from "solid-js/store";
import { runQuery, type ResultSet } from "../utils/query";
import { errorText } from "../utils/errors";
import {
  userAdminFor,
  showGrantsSql,
  buildGrantSql,
  buildRevokeSql,
  buildCreateUserSql,
  buildDropUserSql,
  unsupportedReason,
  MYSQL_PRIVILEGES,
  type GrantOptions,
} from "../utils/userAdmin";
import { Panel } from "./Panel";
import { ConfirmDialog } from "./ConfirmDialog";

interface UserRow {
  name: string;
  host: string;
}

// User / privilege management (issue #140): list the server's users, view a
// selected user's grants, and grant/revoke privileges from a form with a live SQL
// preview — all via query.run using the per-engine SQL in utils/userAdmin.ts.
// MySQL/MariaDB are supported; other engines show an honest message.
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

  const usersFromResult = (res: ResultSet): UserRow[] => {
    const ni = res.columns.findIndex((c) => c.name === support.userNameCol);
    const hi = res.columns.findIndex((c) => c.name === support.userHostCol);
    return res.rows
      .map((r) => ({ name: ni >= 0 ? (r[ni] ?? "") : "", host: hi >= 0 ? (r[hi] ?? "") : "" }))
      .filter((u) => u.name);
  };

  const loadUsers = async () => {
    if (!support.supported || !support.listUsersSql) return;
    setLoading(true);
    setError(null);
    try {
      setUsers(usersFromResult(await runQuery(props.connId, support.listUsersSql)));
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
      const created = { name: newName().trim(), host: (newHost().trim() || "%") };
      setNewName("");
      setNewPass("");
      await loadUsers();
      await selectUser(created); // focus the just-created user
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
    <Panel title="Usuarios y permisos" wide class="user-mgr" onClose={props.onClose}>
      <div class="sm-head">
        <h2>Usuarios y permisos</h2>
        <div class="sm-actions">
          <Show when={support.supported}>
            <span class="sm-count">{users().length} usuario(s)</span>
            <button class="edit-btn" disabled={loading()} onClick={loadUsers}>
              {loading() ? "Actualizando…" : "⟳ Refrescar"}
            </button>
          </Show>
          <button class="edit-btn" onClick={props.onClose}>
            Cerrar
          </button>
        </div>
      </div>

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
            <div class="import-subtitle">Nuevo usuario</div>
            <div class="um-new-user">
              <input
                type="text"
                value={newName()}
                onInput={(e) => setNewName(e.currentTarget.value)}
                placeholder="Nombre de usuario"
                aria-label="Nombre de usuario"
              />
              <input
                type="text"
                value={newHost()}
                onInput={(e) => setNewHost(e.currentTarget.value)}
                placeholder="Host (%  |  localhost)"
                aria-label="Host del nuevo usuario"
              />
              <input
                type="password"
                value={newPass()}
                onInput={(e) => setNewPass(e.currentTarget.value)}
                placeholder="Contraseña (opcional)"
                aria-label="Contraseña del nuevo usuario"
              />
              <button
                class="primary"
                disabled={busy() || !createUserPreview()}
                onClick={createUser}
              >
                Crear usuario
              </button>
              <Show when={createUserDisplay()}>
                <pre class="ddl-text um-preview">{createUserDisplay()};</pre>
              </Show>
            </div>

            <div class="import-subtitle">Usuarios</div>
            <ul class="um-user-list">
              <For each={users()}>
                {(u) => (
                  <li
                    class={`um-user ${
                      selected()?.name === u.name && selected()?.host === u.host ? "active" : ""
                    }`}
                    onClick={() => selectUser(u)}
                  >
                    <span class="um-user-name">{u.name}</span>
                    <span class="um-user-host">@{u.host}</span>
                    <button
                      class="um-drop"
                      title={`Eliminar ${u.name}@${u.host}`}
                      aria-label={`Eliminar ${u.name}@${u.host}`}
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
              fallback={<p class="grid-empty">Selecciona un usuario para ver sus permisos.</p>}
            >
              <div class="import-subtitle">
                Permisos de {selected()!.name}@{selected()!.host}
              </div>
              <Show
                when={grants().length > 0}
                fallback={<p class="grid-empty">Sin permisos o no legibles.</p>}
              >
                <pre class="ddl-text">{grants().join(";\n")}</pre>
              </Show>

              <div class="import-subtitle" style={{ "margin-top": "0.8rem" }}>
                Otorgar / revocar
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
                  <span>Host</span>
                  <input
                    type="text"
                    value={hostInput()}
                    onInput={(e) => setHostInput(e.currentTarget.value)}
                    placeholder="%  |  localhost  |  10.0.0.5"
                  />
                </label>
                <label class="field um-scope">
                  <span>Ámbito (ON …)</span>
                  <input
                    type="text"
                    value={scope()}
                    onInput={(e) => setScope(e.currentTarget.value)}
                    placeholder="*.*  |  mibd.*  |  mibd.tabla"
                  />
                </label>
              </div>

              <pre class="ddl-text um-preview">
                {grantPreview()
                  ? `${grantPreview()};\n${revokePreview()};`
                  : "Elige privilegios y ámbito para ver el SQL."}
              </pre>

              <div class="modal-actions">
                <button
                  class="primary"
                  disabled={busy() || !grantPreview()}
                  onClick={() => apply(grantPreview()!)}
                >
                  Otorgar
                </button>
                <button
                  class="danger"
                  disabled={busy() || !revokePreview()}
                  onClick={() => apply(revokePreview()!)}
                >
                  Revocar
                </button>
              </div>
            </Show>
          </div>
        </div>
      </Show>

      <Show when={pendingDrop()}>
        {(p) => (
          <ConfirmDialog
            title="Eliminar usuario"
            message={`Se eliminará ${p().user.name}@${p().user.host}. Esta acción no se puede deshacer.`}
            sql={p().sql}
            confirmLabel="Eliminar usuario"
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
