import { forward_window_keydown } from 'svelte-widgets/attachments'
import { on } from 'svelte/events'
import { is_editable_event_target, is_modifier_chord } from 'svelte-widgets/utils'

// One registry of the keyboard shortcuts viewers handle. The `?` overlay (ShortcutsHelp) lists
// the entries of every viewer under the pointer, and buttons with a shortcut take their
// aria-keyshortcuts and title hint from here, so the list and the hints cannot drift apart.

export type Shortcut = {
  keys: string // aria-keyshortcuts value: space-separated alternatives of `+`-joined chords
  label?: string // shown instead of the formatted keys (a key range like 0-9)
  description: string
  // viewer: every viewer with a ShortcutsHelp button, camera: 3D viewers, sequence: playback
  scopes: readonly string[]
}

// oxfmt-ignore
export const SHORTCUTS = {
  help: { keys: `?`, description: `Show keyboard shortcuts`, scopes: [`viewer`] },
  fullscreen: { keys: `F`, description: `Toggle fullscreen`, scopes: [`viewer`] },
  close: { keys: `Escape`, description: `Close the open pane, menu or mode, unpin or clear the tooltip`, scopes: [`viewer`] },
  reset_camera: { keys: `R`, description: `Reset camera`, scopes: [`camera`] },
  hover_walk: { keys: `ArrowLeft ArrowRight ArrowUp ArrowDown Home End Enter`, label: `Arrows / Home / End / Enter`, description: `Step the tooltip through the scene (viewer focused), Enter clicks`, scopes: [`camera`, `ternary-phase-diagram`] },
  play: { keys: `Space`, description: `Play / pause`, scopes: [`sequence`] },
  previous: { keys: `ArrowLeft`, description: `Previous frame`, scopes: [`sequence`] },
  next: { keys: `ArrowRight`, description: `Next frame`, scopes: [`sequence`] },
  first: { keys: `Home Control+ArrowLeft`, description: `First frame`, scopes: [`sequence`] },
  last: { keys: `End Control+ArrowRight`, description: `Last frame`, scopes: [`sequence`] },
  step_10: { keys: `J L`, description: `Back / forward 10 frames`, scopes: [`sequence`] },
  step_25: { keys: `PageUp PageDown`, description: `Back / forward 25 frames`, scopes: [`sequence`] },
  speed: { keys: `- +`, description: `Slower / faster playback`, scopes: [`sequence`] },
  jump: { keys: `0 1 2 3 4 5 6 7 8 9`, label: `0-9`, description: `Jump to 0-90% of the sequence`, scopes: [`sequence`] },
  view_mode: { keys: `V Shift+V`, description: `Next / previous view mode`, scopes: [`trajectory`] },
  info_pane: { keys: `I`, description: `Toggle info pane`, scopes: [`structure`, `brillouin`] },
  multi_view: { keys: `G`, description: `Toggle multi-view`, scopes: [`structure`] },
  add_mode: { keys: `A`, description: `Add atoms (atom editing) / add bonds (bond editing)`, scopes: [`structure-edit`] },
  delete_bond_mode: { keys: `D`, description: `Delete bonds`, scopes: [`structure-edit`] },
  change_element: { keys: `E`, description: `Change element of selected atoms`, scopes: [`structure-edit`] },
  delete_atoms: { keys: `Delete Backspace`, description: `Delete selected atoms`, scopes: [`structure-edit`] },
  duplicate: { keys: `Control+D Meta+D`, description: `Duplicate selected atoms`, scopes: [`structure-edit`] },
  undo: { keys: `Control+Z Meta+Z`, description: `Undo`, scopes: [`structure-edit`] },
  redo: { keys: `Control+Y Meta+Y Control+Shift+Z Meta+Shift+Z`, description: `Redo`, scopes: [`structure-edit`] },
  color_mode: { keys: `C`, description: `Cycle color mode`, scopes: [`chempot-3d`] },
  hull_color_mode: { keys: `B`, description: `Toggle stability / energy coloring`, scopes: [`convex-hull`] },
  hull_stable: { keys: `S`, description: `Toggle stable phases`, scopes: [`convex-hull`] },
  hull_unstable: { keys: `U`, description: `Toggle unstable phases`, scopes: [`convex-hull`] },
  hull_labels: { keys: `L`, description: `Toggle stable labels`, scopes: [`convex-hull`] },
  hull_select: { keys: `Enter`, description: `Select hovered entry`, scopes: [`convex-hull`] },
  hull_faces: { keys: `H`, description: `Toggle hull faces`, scopes: [`convex-hull-3d`] },
  hull_reset: { keys: `R`, description: `Reset view and settings`, scopes: [`convex-hull-2d`] },
  hull_top_view: { keys: `T`, description: `Top-down view`, scopes: [`convex-hull-ternary`] },
  export_pane: { keys: `E`, description: `Toggle export pane`, scopes: [`binary-phase-diagram`] },
  temperature_step: { keys: `ArrowLeft ArrowRight`, description: `Lower / raise temperature`, scopes: [`ternary-phase-diagram`] },
  temperature_jump: { keys: `Shift+ArrowLeft Shift+ArrowRight`, description: `Previous / next phase transition`, scopes: [`ternary-phase-diagram`] },
  temperature_play: { keys: `Space`, description: `Play / pause temperature sweep`, scopes: [`ternary-phase-diagram`] },
} as const satisfies Record<string, Shortcut>

export type ShortcutId = keyof typeof SHORTCUTS
export type ShortcutScope = (typeof SHORTCUTS)[ShortcutId]['scopes'][number]

const KEY_LABELS: Record<string, string> = {
  ArrowLeft: `←`,
  ArrowRight: `→`,
  Control: `Ctrl`,
  Meta: `⌘`,
  Escape: `Esc`,
  PageUp: `PgUp`,
  PageDown: `PgDn`,
  Delete: `Del`,
}

// Human-readable keys of a shortcut: `Home Control+ArrowLeft` -> `Home / Ctrl+←`
export const format_shortcut_keys = ({ keys, label }: Shortcut): string =>
  label ??
  keys
    .split(` `)
    .map((chord) => chord.replaceAll(/\w{2,}/g, (key) => KEY_LABELS[key] ?? key))
    .join(` / `)

// `Reset camera (R)`: a button's title naming its shortcut
export const shortcut_title = (id: ShortcutId, label?: string): string => {
  const shortcut: Shortcut = SHORTCUTS[id]
  return `${label ?? shortcut.description} (${format_shortcut_keys(shortcut)})`
}

// aria-keyshortcuts plus title hint, spread onto the button that does what the key does
export const shortcut_attrs = (id: ShortcutId, label?: string) => ({
  'aria-keyshortcuts': SHORTCUTS[id].keys,
  title: shortcut_title(id, label),
})

// Registry entries of the given scopes, in registry order
export const shortcuts_for = (scopes: Iterable<ShortcutScope>): Shortcut[] => {
  const wanted = new Set<string>(scopes)
  return Object.values(SHORTCUTS).filter((shortcut: Shortcut) =>
    shortcut.scopes.some((scope) => wanted.has(scope)),
  )
}

type KeydownHandler = (event: KeyboardEvent) => boolean

// Keydowns of one viewer, from focus inside it or the page's while the pointer is over it, so
// only that viewer reacts. `handle` returning true prevents the default and keeps an enclosing
// viewer from acting on the key (the root runs before the window pass, which then skips the
// prevented key). `hover_handle` narrows what the pointer alone may trigger.
export const viewer_keydown =
  (handle: KeydownHandler, hover_handle: KeydownHandler = handle) =>
  (node: HTMLElement) => {
    // `on`, not addEventListener: descendants' delegated onkeydown handlers run first, so
    // one that handles (prevents) or stops a key keeps it from the viewer
    const off = on(node, `keydown`, (event) => {
      if (!event.defaultPrevented && !event.isComposing && handle(event))
        event.preventDefault()
    })
    const detach = forward_window_keydown({ handle: hover_handle })(node)
    return () => {
      off()
      detach?.()
    }
  }

// Plain-key shortcuts of one viewer (see viewer_keydown). Chords stay the browser's (Cmd/Ctrl+R
// reloads), typing and autorepeat are ignored. Keys are matched lowercased for letters and by
// `event.key` otherwise (`Escape`, `?`). An action returning false had nothing to do, which
// leaves the key to the host.
export const viewer_keys = (bindings: () => Partial<Record<string, () => unknown>>) =>
  viewer_keydown((event) => {
    if (event.repeat || is_modifier_chord(event) || is_editable_event_target(event.target))
      return false
    const action = bindings()[event.key.length === 1 ? event.key.toLowerCase() : event.key]
    return action !== undefined && action() !== false
  })
