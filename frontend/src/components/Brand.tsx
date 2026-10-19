import type { JSX } from "solid-js";

// Inline brand marks (issues #191, #679). Canonical source of the artwork is
// /assets/brand/*.svg + assets/brand/BRAND.md — mirrored here so the UI can
// render them INLINE (not via <img>), which lets them follow the active theme:
// the ring (and the wordmark text) use var(--text), the prompt and the tail
// use var(--accent).

// At 32px and below the strokes are thickened so the mark stays legible at 16.
export function markStrokes(size: number): { ring: number; prompt: number } {
  return size <= 32 ? { ring: 18, prompt: 14 } : { ring: 14, prompt: 10 };
}

// The Q ring + `›` prompt in the 128×128 brand geometry.
function MarkShapes(props: { ring: number; prompt: number }): JSX.Element {
  return (
    <g fill="none" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="58" cy="58" r="36" stroke="var(--text)" stroke-width={props.ring} />
      <path d="M84 84 L106 106" stroke="var(--accent)" stroke-width={props.ring} />
      <path d="M50 44 L64 58 L50 72" stroke="var(--accent)" stroke-width={props.prompt} />
    </g>
  );
}

// The isotipo. `size` is the square side in px. Decorative (aria-hidden) by
// default; pass `label` when it stands alone for the app's name.
export function BrandMark(props: { size?: number; label?: string }): JSX.Element {
  const s = () => props.size ?? 32;
  return (
    <svg
      width={s()}
      height={s()}
      viewBox="0 0 128 128"
      role={props.label ? "img" : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : "true"}
    >
      <MarkShapes {...markStrokes(s())} />
    </svg>
  );
}

// Isotipo + "Squaero" wordmark (Geist 600). `height` is the height in px;
// width scales.
export function BrandWordmark(props: { height?: number; title?: string }): JSX.Element {
  const h = () => props.height ?? 40;
  const w = () => Math.round((h() * 354) / 128);
  return (
    <svg
      width={w()}
      height={h()}
      viewBox="0 0 354 128"
      role="img"
      aria-label={props.title ?? "Squaero"}
    >
      <g transform="translate(-5 9) scale(0.86)">
        <MarkShapes {...markStrokes(h() * 0.86)} />
      </g>
      <text
        x="114"
        y="86"
        font-family="'Geist','Segoe UI',system-ui,-apple-system,sans-serif"
        font-size="62"
        font-weight="600"
        letter-spacing="-2.8"
        fill="var(--text)"
      >
        Squaero
      </text>
    </svg>
  );
}
