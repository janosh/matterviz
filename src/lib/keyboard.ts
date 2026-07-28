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
