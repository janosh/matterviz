import type { ComponentProps } from 'svelte'
import type { IconData } from 'svelte-widgets'
import { create_clipboard_feedback as widget_clipboard_feedback } from 'svelte-widgets/clipboard'
import type ViewerPaneComponent from './ViewerPane.svelte'

export { default as ControlPane } from './ControlPane.svelte'
export { default as DragControlTab } from './DragControlTab.svelte'
export { default as GlassChip } from './GlassChip.svelte'
export { default as ViewerPane } from './ViewerPane.svelte'

// Attribute types of the toggle button and pane div for components forwarding these props.
export type PaneToggleProps = ComponentProps<typeof ViewerPaneComponent>[`toggle_props`]
export type PaneProps = ComponentProps<typeof ViewerPaneComponent>[`pane_props`]
export type ViewerPaneOptions = Omit<
  ComponentProps<typeof ViewerPaneComponent>,
  `children` | `open` | `pane_name` | `class_prefix` | `closed_icon`
>

// Borderless mdi:information-variant stays legible on narrow pane toggles.
export const info_pane_icon: IconData = {
  viewBox: `0 0 24 24`,
  d: `M13.5,4A1.5,1.5 0 0,0 12,5.5A1.5,1.5 0 0,0 13.5,7A1.5,1.5 0 0,0 15,5.5A1.5,1.5 0 0,0 13.5,4M13.14,8.77C11.95,8.87 8.7,11.46 8.7,11.46C8.5,11.61 8.56,11.6 8.72,11.88C8.88,12.15 8.86,12.17 9.05,12.04C9.25,11.91 9.58,11.7 10.13,11.36C12.25,10 10.47,13.14 9.56,18.43C9.2,21.05 11.56,19.7 12.17,19.3C12.77,18.91 14.38,17.8 14.54,17.69C14.76,17.54 14.6,17.42 14.43,17.17C14.31,17 14.19,17.12 14.19,17.12C13.54,17.55 12.35,18.45 12.19,17.88C12,17.31 13.22,13.4 13.89,10.71C14,10.07 14.3,8.67 13.14,8.77Z`,
}

// Info panes stay usable when clipboard access is denied, so log rather than reject.
export const create_clipboard_feedback = (
  duration = 1000,
  on_error = (error: unknown) => console.error(`Failed to copy to clipboard:`, error),
) => widget_clipboard_feedback(duration, on_error)
