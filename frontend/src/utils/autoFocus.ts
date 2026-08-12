// Focus an input the moment it appears.
//
// The `autofocus` attribute only applies while the document is being parsed, so
// on an element Solid inserts later — a panel opening, a rename field replacing
// a label — it does nothing at all. That is not cosmetic: the naming field the
// editor opens on Ctrl+Shift+S looked focused and was not, so a user following
// the hint it displays ("Enter para guardar") typed the snippet's name into the
// query and pressed Enter into a newline.
//
// Used as `ref={autoFocus}`. The focus is deferred one microtask because at ref
// time the element is not in the document yet, and focusing a detached node is a
// silent no-op — which is the same failure wearing a different hat.

export function autoFocus(el: HTMLElement): void {
  queueMicrotask(() => el.focus());
}
