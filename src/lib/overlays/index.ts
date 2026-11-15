import type { ComponentProps } from 'svelte'
import type ViewerPaneComponent from './ViewerPane.svelte'

export { default as ControlPane } from './ControlPane.svelte'
export { default as DragControlTab } from './DragControlTab.svelte'
export { default as FloatingPopup } from './FloatingPopup.svelte'
export { default as ToolbarMenu } from './ToolbarMenu.svelte'
export { default as ViewerPane } from './ViewerPane.svelte'

// Attribute types of the toggle button and pane div for components forwarding these props.
export type PaneToggleProps = ComponentProps<typeof ViewerPaneComponent>[`toggle_props`]
export type PaneProps = ComponentProps<typeof ViewerPaneComponent>[`pane_props`]
export type ViewerPaneOptions = Omit<
  ComponentProps<typeof ViewerPaneComponent>,
  `children` | `open` | `pane_name` | `class_prefix` | `closed_icon`
>

// Label/value rows grouped into titled cards, as rendered by InfoPaneCards
export type InfoPaneRow = {
  label: string
  value: string | number | readonly (string | number)[] // one cell per column of a table card
  key?: string
  tooltip?: string
}
export type InfoPaneCard = {
  title: string
  subtitle?: string
  key?: string // defaults to title; required when titles repeat
  rows: InfoPaneRow[]
  // Set, the rows form a table: their labels, then one cell per column
  columns?: readonly { label: string; tooltip?: string }[]
}
