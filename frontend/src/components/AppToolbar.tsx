import { For } from "solid-js";
import { TOOL_CATALOG, type ToolMenuItem } from "../utils/toolCatalog";

// Top action ribbon (UI design proposal, phase 2). A full-width bar of large
// icon+label buttons grouped by family — the most recognizable chrome of a
// desktop database tool. It creates no new behaviour: every button reuses a
// handler the app already exposes (new query tab, table designer, the tool
// catalog). Object/tool actions are disabled until a connection is active.

interface ToolbarProps {
  /** True when there is an active connection (enables object + tool actions). */
  active: boolean;
  /** True when a working database is selected (enables the object list). */
  hasDb: boolean;
  onNewQuery: () => void;
  onNewTable: () => void;
  onObjectList: () => void;
  onOpenTool: (item: ToolMenuItem) => void;
}

/** One ribbon button: a coloured icon tile over a small label. `ink` is the
    glyph colour drawn on the tile so it stays legible on its background. */
function Btn(props: {
  label: string;
  title: string;
  glyph: string;
  color: string;
  ink: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      class="att-btn"
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <span
        class="att-ic"
        style={{ background: props.color, color: props.ink }}
        aria-hidden="true"
      >
        {props.glyph}
      </span>
      <span class="att-lb">{props.label}</span>
    </button>
  );
}

export function AppToolbar(props: ToolbarProps) {
  return (
    <div class="apptoolbar" role="toolbar" aria-label="Acciones">
      <div class="att-group">
        <Btn
          label="Consulta"
          title="Nueva consulta"
          glyph="›_"
          color="var(--accent)"
          ink="var(--accent-fg)"
          disabled={!props.active}
          onClick={props.onNewQuery}
        />
        <Btn
          label="Tabla"
          title="Nueva tabla"
          glyph="▦"
          color="var(--obj-table)"
          ink="var(--obj-ink)"
          disabled={!props.active}
          onClick={props.onNewTable}
        />
        <Btn
          label="Objetos"
          title="Lista de objetos de la base activa"
          glyph="☰"
          color="var(--obj-view)"
          ink="var(--obj-ink)"
          disabled={!props.active || !props.hasDb}
          onClick={props.onObjectList}
        />
      </div>
      <div class="att-group">
        <For each={TOOL_CATALOG}>
          {(t) => (
            <Btn
              label={t.label}
              title={t.title}
              glyph={t.icon}
              color="var(--bg-elev2)"
              ink="var(--text)"
              disabled={!props.active}
              onClick={() => props.onOpenTool(t)}
            />
          )}
        </For>
      </div>
    </div>
  );
}
