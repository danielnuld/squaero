import { For } from "solid-js";
import { TOOL_CATALOG, type ToolMenuItem } from "../utils/toolCatalog";
import {
  IconObjects,
  IconQuery,
  IconTable,
  type IconComponent,
} from "./icons";
import { t } from "../utils/i18n";

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

/**
 * One ribbon button: a vector icon over a small label.
 *
 * Monochrome by design. Eleven coloured tiles meant every button shouted, which
 * left the accent saying nothing; now the accent is free to carry STATE — hover,
 * focus, the disabled dimming — and `.att-ic` inherits its colour so the icon
 * follows. That inheritance is the part emoji could never do: they paint
 * themselves and ignored the colour this component used to pass them.
 *
 * The icon is decorative: the visible label is the button's accessible name.
 */
function Btn(props: {
  label: string;
  title: string;
  Icon: IconComponent;
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
      <span class="att-ic" aria-hidden="true">
        <props.Icon />
      </span>
      <span class="att-lb">{props.label}</span>
    </button>
  );
}

export function AppToolbar(props: ToolbarProps) {
  return (
    <div class="apptoolbar" role="toolbar" aria-label={t("toolbar.actions")}>
      <div class="att-group">
        <Btn
          label={t("toolbar.newQuery.label")}
          title={t("toolbar.newQuery.title")}
          Icon={IconQuery}
          disabled={!props.active}
          onClick={props.onNewQuery}
        />
        <Btn
          label={t("toolbar.newTable.label")}
          title={t("toolbar.newTable.title")}
          Icon={IconTable}
          disabled={!props.active}
          onClick={props.onNewTable}
        />
        <Btn
          label={t("toolbar.objects.label")}
          title={t("toolbar.objects.title")}
          Icon={IconObjects}
          disabled={!props.active || !props.hasDb}
          onClick={props.onObjectList}
        />
      </div>
      <div class="att-group">
        <For each={TOOL_CATALOG}>
          {(item) => (
            <Btn
              label={t(item.label)}
              title={t(item.title)}
              Icon={item.Icon}
              disabled={!props.active}
              onClick={() => props.onOpenTool(item)}
            />
          )}
        </For>
      </div>
    </div>
  );
}
