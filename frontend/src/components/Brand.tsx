import type { JSX } from "solid-js";

// Inline brand marks (issue #191). Canonical source of the artwork is
// /assets/brand/*.svg + assets/brand/BRAND.md — these are hand-mirrored so the
// UI can render them INLINE (not via <img>), which lets them inherit the theme:
// the isotipo strokes use the brand accent (var(--accent)); the wordmark text
// uses currentColor, so both track light/dark automatically.

// The Q ring + query-prompt isotipo. `size` is the square side in px.
export function BrandMark(props: { size?: number; title?: string }): JSX.Element {
  const s = () => props.size ?? 32;
  return (
    <svg
      width={s()}
      height={s()}
      viewBox="0 0 128 128"
      role="img"
      aria-label={props.title ?? "Quaero"}
      fill="none"
    >
      <g stroke="var(--accent)" stroke-width="15" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="58" cy="56" r="38" />
        <path d="M85 83 L104 102" />
      </g>
      <g stroke="var(--accent)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M46 42 L60 56 L46 70" />
        <path d="M72 44 L72 68" />
      </g>
    </svg>
  );
}

// Isotipo + "Quaero" wordmark. `height` is the height in px; width scales.
export function BrandWordmark(props: { height?: number; title?: string }): JSX.Element {
  const h = () => props.height ?? 40;
  const w = () => Math.round((h() * 372) / 128);
  return (
    <svg
      width={w()}
      height={h()}
      viewBox="0 0 372 128"
      role="img"
      aria-label={props.title ?? "Quaero"}
      fill="none"
    >
      <g transform="translate(4,8) scale(0.86)">
        <g stroke="var(--accent)" stroke-width="15" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="58" cy="56" r="38" />
          <path d="M85 83 L104 102" />
        </g>
        <g stroke="var(--accent)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M46 42 L60 56 L46 70" />
          <path d="M72 44 L72 68" />
        </g>
      </g>
      <text
        x="120"
        y="83"
        font-family="'Space Grotesk','Segoe UI',system-ui,-apple-system,sans-serif"
        font-size="62"
        font-weight="600"
        letter-spacing="-1.5"
        fill="currentColor"
      >
        Quaero
      </text>
    </svg>
  );
}
