import type { ComponentProps } from 'svelte'
import type DraggablePane from './DraggablePane.svelte'

export { default as ContextMenu } from './ContextMenu.svelte'
export { default as DraggablePane } from './DraggablePane.svelte'
export { default as DragControlTab } from './DragControlTab.svelte'

// Attribute types of DraggablePane's toggle button / pane div, for components forwarding
// toggle_props/pane_props
export type PaneToggleProps = ComponentProps<typeof DraggablePane>[`toggle_props`]
export type PaneProps = ComponentProps<typeof DraggablePane>[`pane_props`]
