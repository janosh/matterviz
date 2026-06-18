import type { ComponentProps } from 'svelte'
import { SvelteSet } from 'svelte/reactivity'
import type DraggablePane from './DraggablePane.svelte'

export { default as ContextMenu } from './ContextMenu.svelte'
export { default as DraggablePane } from './DraggablePane.svelte'
export { default as DragControlTab } from './DragControlTab.svelte'

// Attribute types of DraggablePane's toggle button / pane div, for components forwarding
// toggle_props/pane_props
export type PaneToggleProps = ComponentProps<typeof DraggablePane>[`toggle_props`]
export type PaneProps = ComponentProps<typeof DraggablePane>[`pane_props`]

// Reactive clipboard-copy feedback shared by info panes. `copy(text, key)` writes
// `text` to the clipboard and flags `key` as recently-copied in the returned reactive
// `copied` set for `duration` ms, so UIs can show a transient "copied" checkmark.
export function create_clipboard_feedback(duration = 1000): {
  copied: SvelteSet<string>
  copy: (text: string, key: string) => Promise<void>
} {
  const copied = new SvelteSet<string>()
  const copy = async (text: string, key: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      copied.add(key)
      setTimeout(() => copied.delete(key), duration)
    } catch (error) {
      console.error(`Failed to copy to clipboard:`, error)
    }
  }
  return { copied, copy }
}
