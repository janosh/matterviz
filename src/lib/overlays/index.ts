import type { ComponentProps } from 'svelte'
import type DraggablePane from 'svelte-widgets/DraggablePane.svelte'
import { create_clipboard_feedback as widget_clipboard_feedback } from 'svelte-widgets/clipboard'

export { ActionMenu, DraggablePane } from 'svelte-widgets'
export { default as ControlPane } from './ControlPane.svelte'
export { default as DragControlTab } from './DragControlTab.svelte'
export { default as GlassChip } from './GlassChip.svelte'
export { portal } from 'svelte-widgets/attachments'

// Attribute types of DraggablePane's toggle button / pane div, for components forwarding
// toggle_props/pane_props
export type PaneToggleProps = ComponentProps<typeof DraggablePane>[`toggle_props`]
export type PaneProps = ComponentProps<typeof DraggablePane>[`pane_props`]

// Reactive clipboard-copy feedback shared by info panes. `copy(text, key)` writes `text` and
// flags `key` as recently-copied in the reactive `copied` set, so UIs can show a transient
// checkmark. The library helper rejects a failed write; every caller here is a button sitting
// in a pane that must survive a denied clipboard, so default to logging instead.
export const create_clipboard_feedback = (
  duration = 1000,
  on_error = (error: unknown) => console.error(`Failed to copy to clipboard:`, error),
) => widget_clipboard_feedback(duration, on_error)
