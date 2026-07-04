import { For, Show, createSignal } from "solid-js";
import { Panel } from "./Panel";
import type { Snippet } from "../utils/snippets";

// Favorites / snippets panel (issue #129): save the current query as a named
// favorite, insert a stored snippet at the editor cursor, rename/delete, and
// export/import the whole set. Persistence + editor insertion are lifted to the
// workspace; this stays presentational. Opened from the editor bar.
export function SnippetsPanel(props: {
  entries: Snippet[];
  /** Current editor text, offered as the body of a new favorite. */
  currentSql: string;
  onSave: (name: string, body: string) => void;
  onInsert: (body: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onClose: () => void;
}) {
  const [newName, setNewName] = createSignal("");
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [draft, setDraft] = createSignal("");
  let fileInput!: HTMLInputElement;

  const canSave = () => newName().trim() !== "" && props.currentSql.trim() !== "";

  const save = () => {
    if (!canSave()) return;
    props.onSave(newName().trim(), props.currentSql);
    setNewName("");
  };

  const startRename = (s: Snippet) => {
    setEditingId(s.id);
    setDraft(s.name);
  };
  const commitRename = () => {
    const id = editingId();
    if (id && draft().trim()) props.onRename(id, draft().trim());
    setEditingId(null);
  };

  const insert = (body: string) => {
    props.onInsert(body);
    props.onClose();
  };

  const onFile = (e: Event) => {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (file) props.onImport(file);
    (e.currentTarget as HTMLInputElement).value = ""; // allow re-importing the same file
  };

  return (
    <Panel title="Favoritos y snippets" class="snippets" onClose={props.onClose}>
      <h2>Favoritos y snippets</h2>

      <div class="snippet-save">
        <input
          class="snippet-name"
          type="text"
          placeholder="Nombre del favorito…"
          aria-label="Nombre del favorito"
          value={newName()}
          onInput={(e) => setNewName(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
        <button
          class="primary"
          onClick={save}
          disabled={!canSave()}
          title="Guardar la consulta actual como favorito"
        >
          Guardar consulta actual
        </button>
      </div>

      <Show
        when={props.entries.length > 0}
        fallback={<p class="snippet-empty">No hay favoritos ni snippets guardados.</p>}
      >
        <ul class="snippet-list">
          <For each={props.entries}>
            {(s) => (
              <li class="snippet-item">
                <div class="snippet-head">
                  <Show
                    when={editingId() === s.id}
                    fallback={<span class="snippet-name-label">{s.name}</span>}
                  >
                    <input
                      class="snippet-rename"
                      value={draft()}
                      aria-label="Nuevo nombre"
                      autofocus
                      onInput={(e) => setDraft(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      onBlur={commitRename}
                    />
                  </Show>
                  <span class="snippet-actions">
                    <button class="link" onClick={() => insert(s.body)} title="Insertar en el cursor">
                      Insertar
                    </button>
                    <button class="link" onClick={() => startRename(s)} title="Renombrar">
                      Renombrar
                    </button>
                    <button class="link danger" onClick={() => props.onRemove(s.id)} title="Borrar">
                      Borrar
                    </button>
                  </span>
                </div>
                <pre class="snippet-body">{s.body}</pre>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <div class="modal-actions">
        <button onClick={() => fileInput.click()} title="Importar un set (JSON)">
          Importar
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          style="display:none"
          onChange={onFile}
        />
        <button onClick={props.onExport} disabled={props.entries.length === 0} title="Exportar el set (JSON)">
          Exportar
        </button>
        <span class="modal-actions-spacer" />
        <button class="primary" onClick={props.onClose}>
          Cerrar
        </button>
      </div>
    </Panel>
  );
}
