// Squaero's own icon set (#683).
//
// Inline SVG instead of a dependency or an icon font: Squaero ships as a single
// self-contained index.html embedded in the binary, and inline SVG carries only
// what is used and inherits its colour through `currentColor`, which an emoji or
// a text glyph cannot do — they paint themselves, or depend on the font.
//
// The art is the M14 set (docs/design/m14/prototype/icons.md): 24×24 grid, 1.75
// stroke, round caps and joins, no fill. Schema, column, foreign key and
// disconnect come from the redesign bodies (Explorer); procedure is the play
// mark the Routines body uses; event, generate and undo were drawn to match.
// Some shapes derive from Lucide (ISC) — attribution in THIRD-PARTY.md.

import type { JSX } from "solid-js";
import { objectBadge } from "../utils/objectIcons";

/** Each icon's art: the children of a 24×24 frame. */
export const ICONS = {
  // Object types
  database: () => (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>
  ),
  schema: () => (
    <>
      <path d="M4 4h16v16H4z" />
      <path d="M4 9h16M9 9v11" />
    </>
  ),
  table: () => (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18" />
      <path d="M9 10v10" />
    </>
  ),
  view: () => (
    <>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  function: () => (
    <>
      <path d="M9 20c2 0 2.5-1.5 3-4l2-10c.5-2.5 1-4 3-4" />
      <path d="M7 10h9" />
    </>
  ),
  procedure: () => <path d="M7 4v16l13-8z" />,
  trigger: () => <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  event: () => (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 3v4M16 3v4" />
      <path d="M12 13v3l2 1" />
    </>
  ),
  column: () => <rect x="8" y="3" width="8" height="18" rx="1" />,
  key: () => (
    <>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="m10.7 12.3 9.3-9.3" />
      <path d="m16 7 3 3" />
    </>
  ),
  fk: () => (
    <>
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </>
  ),
  folder: () => (
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  ),
  query: () => (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="m9 13-2 2 2 2" />
      <path d="m13 13 2 2-2 2" />
    </>
  ),

  // Actions
  play: () => <path d="M7 4v16l13-8z" />,
  stop: () => <rect x="6" y="6" width="12" height="12" rx="1" />,
  search: () => (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  plus: () => <path d="M12 5v14M5 12h14" />,
  minus: () => <path d="M5 12h14" />,
  close: () => <path d="M18 6 6 18M6 6l12 12" />,
  "chevron-down": () => <path d="m6 9 6 6 6-6" />,
  "chevron-right": () => <path d="m9 6 6 6-6 6" />,
  "chevron-left": () => <path d="m15 6-6 6 6 6" />,
  "arrow-up": () => (
    <>
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </>
  ),
  "arrow-down": () => (
    <>
      <path d="M12 5v14" />
      <path d="m19 12-7 7-7-7" />
    </>
  ),
  "arrow-right": () => (
    <>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </>
  ),
  more: () => (
    <>
      <circle cx="5" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="19" cy="12" r="1.2" />
    </>
  ),
  refresh: () => (
    <>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 4v5h-5" />
    </>
  ),
  edit: () => (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>
  ),
  filter: () => <path d="M3 5h18l-7 8v6l-4 2v-8z" />,
  sort: () => (
    <>
      <path d="M7 4v16" />
      <path d="m3 8 4-4 4 4" />
      <path d="M17 20V4" />
      <path d="m13 16 4 4 4-4" />
    </>
  ),
  import: () => (
    <>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </>
  ),
  export: () => (
    <>
      <path d="M12 15V3" />
      <path d="m7 8 5-5 5 5" />
      <path d="M5 21h14" />
    </>
  ),
  sync: () => (
    <>
      <path d="M4 12a8 8 0 0 1 14-5.3L20 9" />
      <path d="M20 4v5h-5" />
      <path d="M20 12a8 8 0 0 1-14 5.3L4 15" />
      <path d="M4 20v-5h5" />
    </>
  ),
  transfer: () => (
    <>
      <path d="M4 8h14l-4-4" />
      <path d="M20 16H6l4 4" />
    </>
  ),
  generate: () => (
    <>
      <path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
      <path d="M19 16v4M17 18h4" />
    </>
  ),
  pin: () => (
    <>
      <path d="M12 17v5" />
      <path d="M9 3h6l-1 6 4 4H6l4-4z" />
    </>
  ),
  chart: () => (
    <>
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-7" />
      <path d="M22 20H2" />
    </>
  ),
  transpose: () => (
    <>
      <path d="M4 4h7v7H4z" />
      <path d="M13 13h7v7h-7z" />
      <path d="M15 4h5v5" />
      <path d="M9 20H4v-5" />
    </>
  ),
  compare: () => (
    <>
      <path d="M8 3v18" />
      <path d="M16 3v18" />
      <path d="M3 8h5" />
      <path d="M16 16h5" />
    </>
  ),
  trash: () => (
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
    </>
  ),
  undo: () => (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
    </>
  ),
  copy: () => (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  format: () => (
    <>
      <path d="M4 6h16" />
      <path d="M4 12h10" />
      <path d="M4 18h14" />
    </>
  ),
  save: () => (
    <>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <path d="M17 21v-8H7v8" />
      <path d="M7 3v5h8" />
    </>
  ),
  open: () => (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1" />
      <path d="M3 7v10a2 2 0 0 0 2 2h13l3-8H6l-3 8" />
    </>
  ),
  disconnect: () => (
    <>
      <path d="M12 3 4 13h16z" />
      <path d="M4 18h16" />
    </>
  ),

  // Tools
  history: () => (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  bookmark: () => <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />,
  er: () => (
    <>
      <rect x="3" y="3" width="7" height="6" rx="1" />
      <rect x="14" y="15" width="7" height="6" rx="1" />
      <path d="M6.5 9v3a2 2 0 0 0 2 2h7a2 2 0 0 1 2 2v-1" />
    </>
  ),
  monitor: () => <path d="M3 12h4l3-8 4 16 3-8h4" />,
  tools: () => (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  plug: () => (
    <>
      <path d="M9 2v6M15 2v6" />
      <path d="M6 8h12v4a6 6 0 0 1-12 0z" />
      <path d="M12 18v4" />
    </>
  ),
  settings: () => (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  users: () => (
    <>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21v-1a6 6 0 0 1 12 0v1" />
      <path d="M16 4a4 4 0 0 1 0 8" />
      <path d="M22 21v-1a6 6 0 0 0-4-5.6" />
    </>
  ),
  notebook: () => (
    <>
      <rect x="5" y="2" width="15" height="20" rx="2" />
      <path d="M9 2v20" />
      <path d="M2 7h4M2 12h4M2 17h4" />
    </>
  ),
  builder: () => (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </>
  ),
  plan: () => (
    <>
      <rect x="9" y="2" width="6" height="5" rx="1" />
      <rect x="3" y="17" width="6" height="5" rx="1" />
      <rect x="15" y="17" width="6" height="5" rx="1" />
      <path d="M12 7v5" />
      <path d="M6 17v-3h12v3" />
    </>
  ),
  backup: () => (
    <>
      <rect x="2" y="4" width="20" height="5" rx="1" />
      <path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9" />
      <path d="M10 13h4" />
    </>
  ),
  clock: () => (
    <>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2 2" />
      <path d="M10 2h4" />
    </>
  ),

  // States
  bell: () => (
    <>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
    </>
  ),
  help: () => (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </>
  ),
  lock: () => (
    <>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  check: () => <path d="M20 6 9 17l-5-5" />,
  warning: () => (
    <>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
  info: () => (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </>
  ),
} satisfies Record<string, () => JSX.Element>;

export type IconName = keyof typeof ICONS;

export interface IconProps {
  /** Width and height in px (default 16). CSS on the element still wins. */
  size?: number;
  /**
   * Accessible name. Omit it when the icon sits beside a visible label or inside
   * a control that already has one: the icon is then aria-hidden, since saying
   * it again is only noise. With a label it becomes role="img".
   */
  label?: string;
  class?: string;
  style?: JSX.CSSProperties;
}

/** One icon of the set, drawn in `currentColor`. */
export function Icon(props: IconProps & { name: IconName }): JSX.Element {
  return (
    <svg
      class={props.class ? `icon ${props.class}` : "icon"}
      style={props.style}
      data-icon={props.name}
      width={props.size ?? 16}
      height={props.size ?? 16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      role={props.label ? "img" : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : "true"}
    >
      {ICONS[props.name]()}
    </svg>
  );
}

/**
 * The icon of a database object kind (table, view, procedure…), coloured with its
 * `--obj-*` token through the `.objtree-badge.kind-*` classes. Unknown kinds get a
 * neutral mark rather than crashing the render.
 */
export function ObjectIcon(props: IconProps & { kind: string }): JSX.Element {
  const badge = () => objectBadge(props.kind);
  return (
    <Icon
      {...props}
      name={badge().icon}
      class={`objtree-badge ${badge().className}${props.class ? ` ${props.class}` : ""}`}
    />
  );
}

/** An icon bound to one name, for places that take a component (menus, tools). */
export type IconComponent = (props?: IconProps) => JSX.Element;

const bind =
  (name: IconName): IconComponent =>
  (props = {}) => <Icon {...props} name={name} />;

export const IconSearch = bind("search");
export const IconRefresh = bind("refresh");
export const IconRelated = bind("arrow-right");
export const IconMonitor = bind("monitor");
export const IconSlow = bind("clock");
export const IconUsers = bind("users");
export const IconEr = bind("er");
export const IconBuilder = bind("builder");
export const IconRoutines = bind("function");
export const IconTriggers = bind("trigger");
export const IconNotebook = bind("notebook");
export const IconSnippets = bind("bookmark");
export const IconBackup = bind("backup");
export const IconPlug = bind("plug");
export const IconKey = bind("key");
export const IconTools = bind("tools");
