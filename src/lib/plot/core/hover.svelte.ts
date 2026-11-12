// Shared hover state of chart components.

import { create_focus_exit } from '#lib/plot/core/interactions.js'
import { TooltipPin } from '#lib/tooltip/pin.svelte.js'
import { untrack } from 'svelte'

// A data swap or a hidden series fires no pointer event, so a hover whose item is gone would
// linger (and the host's on_*_hover never hear null). Runs `clear` once `is_stale` turns truthy.
// Creates an $effect, so it must be called during component init.
export function clear_stale_hover(is_stale: () => unknown, clear: () => void): void {
  $effect.pre(() => {
    if (is_stale()) untrack(clear)
  })
}

// Hover and pinned-tooltip state of a chart whose marks are DOM nodes (bars, bins, boxes). A
// mark is named by indices only, so the tooltip follows new data and closes once its mark is
// gone or hidden; `info` resolves a mark to what the tooltip shows, null when it isn't drawn.
// A click pins the hovered mark's tooltip while `pinnable` (see TooltipPin). Creates
// $effects, so call it during component init.
export function create_mark_hover<Mark extends Named & object, Info, Named = Mark>(opts: {
  // Names the mark: a fresher snapshot of the same one is no new hover and stays pinned
  key: (mark: Named) => unknown
  pinnable: (mark: Mark) => boolean
  info: (mark: Mark) => Info | null
  // Tells the host the hover ended; `mark` is the one left, null when none was hovered
  on_clear: (mark: Mark | null) => void
  // The chart's SVG: focus leaving it is the keyboard's mouseleave
  root: () => Element | null | undefined
}) {
  let mark = $state.raw<Mark | null>(null)
  const pin = new TooltipPin<Mark, Named>({ key: opts.key, enabled: opts.pinnable })
  const shown = $derived(pin.shown(mark))
  const info = $derived(shown && opts.info(shown))
  const clear = (): void => {
    const left = mark
    mark = null
    opts.on_clear(left)
  }
  clear_stale_hover(() => mark && !opts.info(mark), clear)
  clear_stale_hover(() => pin.value && !info, pin.unpin)
  return {
    pin,
    // What the tooltip shows: the pinned mark's info, else the hovered one's
    get info() {
      return info
    },
    // Pointer moves within one mark keep its object, so its lit styles and tooltip don't re-run
    set: (next: Mark): void => {
      const prev = mark
      const same =
        prev &&
        Object.entries(next).every(([field, value]) => value === Reflect.get(prev, field))
      if (!same) mark = next
    },
    clear,
    clear_on_focus_exit: create_focus_exit(opts.root, clear),
    // Whether `named` wears its hover look
    lit: (named: Named): boolean => pin.lit(named, mark),
    // A click on the hovered mark, or on empty space when none is
    toggle_pin: (): void => pin.toggle(mark),
  }
}
