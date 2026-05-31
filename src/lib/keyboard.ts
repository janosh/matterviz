// Shared helpers for wiring viewer keyboard shortcuts consistently across
// components (Structure, Trajectory, ...). A handler returns `true` when it
// handled the event, so the browser default is suppressed in exactly one place
// instead of scattered `preventDefault()` calls.

export type KeydownHandler = (event: KeyboardEvent) => boolean

// Wrap a handler for an element-level `onkeydown` binding: run it and suppress
// the browser default (page scroll, find, ...) when it reports it handled the key.
export const handle_and_prevent =
  (handle: KeydownHandler) =>
  (event: KeyboardEvent): void => {
    if (handle(event)) event.preventDefault()
  }

// Wrap a handler for a `<svelte:window onkeydown>` binding: forward keydowns to a
// viewer only while it's hovered and focus is on <body>. This lets shortcuts work
// without first clicking the viewer, while keeping multiple viewers on one page
// from all responding and never hijacking keys from a focused input/pane.
// Suppresses the browser default when the handler reports it handled the key.
export const forward_window_keydown = (is_hovered: () => boolean, handle: KeydownHandler) => {
  const run = handle_and_prevent(handle)
  return (event: KeyboardEvent): void => {
    const active = document.activeElement
    if (is_hovered() && (!active || active === document.body)) run(event)
  }
}
