import type { ComponentProps } from 'svelte'
import { create_clipboard_feedback as widget_clipboard_feedback } from 'svelte-widgets/clipboard'
import type ViewerPaneComponent from './ViewerPane.svelte'

export { default as ControlPane } from './ControlPane.svelte'
export { default as DragControlTab } from './DragControlTab.svelte'
export { default as GlassChip } from './GlassChip.svelte'
export { default as ToolbarMenu } from './ToolbarMenu.svelte'
export { default as ViewerPane } from './ViewerPane.svelte'

// Attribute types of the toggle button and pane div for components forwarding these props.
export type PaneToggleProps = ComponentProps<typeof ViewerPaneComponent>[`toggle_props`]
export type PaneProps = ComponentProps<typeof ViewerPaneComponent>[`pane_props`]
export type ViewerPaneOptions = Omit<
  ComponentProps<typeof ViewerPaneComponent>,
  `children` | `open` | `pane_name` | `class_prefix` | `closed_icon`
>

export { Info as info_pane_icon } from 'svelte-widgets/icons'

// Label/value rows grouped into titled cards, as rendered by InfoPaneCards
export type InfoPaneRow = {
  label: string
  value: string | number
  key?: string
  tooltip?: string
}
export type InfoPaneCard = {
  title: string
  subtitle?: string
  key?: string // defaults to title; required when titles repeat
  rows: InfoPaneRow[]
}

// Info panes stay usable when clipboard access is denied, so log rather than reject.
export const create_clipboard_feedback = (
  duration = 1000,
  on_error = (error: unknown) => console.error(`Failed to copy to clipboard:`, error),
) => widget_clipboard_feedback(duration, on_error)
