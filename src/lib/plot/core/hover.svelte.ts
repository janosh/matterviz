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
// gone or hidden (`info` returns null). Creates $effects, so call it during component init.
export function create_mark_hover<Mark extends Named, Info, Named = Mark>(opts: {
  key: (mark: Named) => unknown // names the mark (see TooltipPin)
  pinnable: (mark: Mark) => boolean // whether a click pins its tooltip
  info: (mark: Mark) => Info | null // what the tooltip shows
  on_clear: (left: Mark | null) => void // the hover ended; null when no mark was hovered
  root: () => Element | null | undefined // the chart's SVG: focus leaving it ends the hover
}) {
  let mark = $state.raw<Mark | null>(null)
  const pin = new TooltipPin<Mark, Named>({ key: opts.key, enabled: opts.pinnable })
  const info = $derived.by(() => {
    const shown = pin.shown(mark)
    return shown && opts.info(shown)
  })
  const clear = (): void => {
    const left = mark
    mark = null
    opts.on_clear(left)
  }
  clear_stale_hover(() => mark && !opts.info(mark), clear)
  clear_stale_hover(() => pin.value && !info, pin.unpin)
  return {
    pin,
    get info() {
      return info
    },
    // Pointer moves within one mark keep its object, so its lit styles and tooltip don't re-run
    set: (next: Mark): void => {
      if (JSON.stringify(next) !== JSON.stringify(mark)) mark = next
    },
    clear,
    clear_on_focus_exit: create_focus_exit(opts.root, clear),
    lit: (named: Named): boolean => pin.lit(named, mark),
    toggle_pin: (): void => pin.toggle(mark),
  }
}
