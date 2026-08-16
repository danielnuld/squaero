// Toolbar icon set.
//
// Twelve inline SVGs instead of a dependency, because Quaero ships as a single
// self-contained index.html embedded in the binary: there is no CDN to fetch from,
// and an icon font would be all-or-nothing — thousands of glyphs paid for to use
// twelve. Inline SVG only carries what is used, and inherits its colour through
// `currentColor`, which is what makes the toolbar's monochrome treatment possible.
// The emoji it replaces could not do that: they paint themselves and ignored the
// colour the toolbar handed them.
//
// The art follows Lucide (ISC): 24×24 grid, 2px stroke, round caps and joins. Each
// component names the upstream icon it corresponds to, so any of them can be
// verified against — or replaced wholesale from — lucide.dev. They were transcribed
// by hand rather than vendored by a build step; treat the upstream file as the
// authority if one ever looks off.
//
// Attribution lives in THIRD-PARTY.md, as ISC requires.

import type { JSX } from "solid-js";

/**
 * Shared frame. No width/height: the caller sizes it in CSS, so one icon can be
 * 17px in the ribbon and 24px in a comparison without touching the art.
 *
 * aria-hidden because every icon here sits inside a control that already has a
 * visible text label — the button's accessible name comes from that label, and an
 * icon announcing itself again would just be noise.
 */
function Svg(props: { children: JSX.Element }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {props.children}
    </svg>
  );
}

/** A toolbar icon: takes no props, sized and coloured by its container. */
export type IconComponent = () => JSX.Element;

/** lucide/terminal — a new query. */
export const IconQuery: IconComponent = () => (
  <Svg>
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </Svg>
);

/** lucide/rotate-cw — reload what a panel is showing. */
export const IconRefresh: IconComponent = () => (
  <Svg>
    <path d="M21 12a9 9 0 1 1-3.5-7.1" />
    <path d="M21 3v6h-6" />
  </Svg>
);

/** lucide/arrow-right — jump from a cell to the rows related to it. */
export const IconRelated: IconComponent = () => (
  <Svg>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </Svg>
);

/** lucide/table — a new table. */
export const IconTable: IconComponent = () => (
  <Svg>
    <path d="M12 3v18" />
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18" />
    <path d="M3 15h18" />
  </Svg>
);

/** lucide/list — the object list. */
export const IconObjects: IconComponent = () => (
  <Svg>
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </Svg>
);

/** lucide/monitor — the server monitor. */
export const IconMonitor: IconComponent = () => (
  <Svg>
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </Svg>
);

/** lucide/timer — the slowest queries. */
export const IconSlow: IconComponent = () => (
  <Svg>
    <line x1="10" y1="2" x2="14" y2="2" />
    <line x1="12" y1="14" x2="15" y2="11" />
    <circle cx="12" cy="14" r="8" />
  </Svg>
);

/** lucide/users — users and permissions. */
export const IconUsers: IconComponent = () => (
  <Svg>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </Svg>
);

/** lucide/network — the entity-relationship diagram. */
export const IconEr: IconComponent = () => (
  <Svg>
    <rect x="16" y="16" width="6" height="6" rx="1" />
    <rect x="2" y="16" width="6" height="6" rx="1" />
    <rect x="9" y="2" width="6" height="6" rx="1" />
    <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" />
    <path d="M12 12V8" />
  </Svg>
);

/** lucide/layout-dashboard — the visual query builder. Assembled panels, and
    clearly not the table icon, which a plain grid would have echoed. */
export const IconBuilder: IconComponent = () => (
  <Svg>
    <rect x="3" y="3" width="7" height="9" rx="1" />
    <rect x="14" y="3" width="7" height="5" rx="1" />
    <rect x="14" y="12" width="7" height="9" rx="1" />
    <rect x="3" y="16" width="7" height="5" rx="1" />
  </Svg>
);

/** lucide/braces — stored procedures and functions. */
export const IconRoutines: IconComponent = () => (
  <Svg>
    <path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1" />
    <path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1" />
  </Svg>
);

/** lucide/zap — triggers and scheduled events. */
export const IconTriggers: IconComponent = () => (
  <Svg>
    <path d="M4 14h7l-2 8 11-12h-7l2-8z" />
  </Svg>
);

/** lucide/notebook — the SQL notebook. */
export const IconNotebook: IconComponent = () => (
  <Svg>
    <path d="M2 6h4" />
    <path d="M2 10h4" />
    <path d="M2 14h4" />
    <path d="M2 18h4" />
    <rect x="4" y="2" width="16" height="20" rx="2" />
    <path d="M16 2v20" />
  </Svg>
);

/** lucide/bookmark — saved snippets. The interface calls them favourites, and a
    bookmark is what you put on something you already have. */
export const IconSnippets: IconComponent = () => (
  <Svg>
    <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </Svg>
);
