// Solver-placed colorbar shared by ScatterPlot and BinnedScatterPlot: measured footprint
// (with room for tick labels until the element renders), the DecorationItem fed to the
// frame's solver, the solved placement and its tweened follow-up. Creates $effects via
// create_placed_tween, so it must be called during component init. Render it with
// ColorBarDecoration.svelte.

import type { Point2D } from '#lib/math.js'
import type ColorBar from '#lib/plot/core/components/ColorBar.svelte'
import type { DecorationItem, DecorationSolution } from '#lib/plot/core/decorations/index.js'
import {
  decoration_data_attrs,
  decoration_placement_revision,
  get_decoration_placement,
} from '#lib/plot/core/decorations/index.js'
import type { Rect } from '#lib/plot/core/layout.js'
import { element_position_for_footprint, full_footprint_or } from '#lib/plot/core/layout.js'
import { create_placed_tween } from '#lib/plot/core/placed-tween.svelte.js'
import { COLOR_BAR_DEFAULTS } from '#lib/plot/core/types.js'
import type { ComponentProps } from 'svelte'
import type { TweenOptions } from 'svelte/motion'

// The `color_bar` prop of every solver-placed colorbar. A non-empty `wrapper_style` pins the
// bar: it replaces the solver's position on the wrapper (pin with `left`/`right`/`top`/...),
// the solver stops placing it and only routes the other decorations around it.
export type ColorBarDecorationProps = ComponentProps<typeof ColorBar> & {
  tween?: TweenOptions<Point2D>
  responsive?: boolean // Reposition whenever the solved placement moves (default: false)
  axis_clearance?: number // Min distance kept from plot edges/axes (default: 8)
}

export type ColorbarDecoration = ReturnType<typeof create_colorbar_decoration>

export function create_colorbar_decoration(opts: {
  id: string
  // False hides the colorbar and withdraws it from the solver
  enabled: () => boolean
  // The caller's raw `color_bar` prop (not one rebuilt per data change, so data updates
  // don't re-trigger layout reads)
  config: () => ColorBarDecorationProps | null | undefined
  dims: () => { width: number; height: number }
  decoration_solution: () => DecorationSolution
}) {
  let element = $state<HTMLDivElement | undefined>()
  let size_revision = $state(0)
  // ColorBar's orientation prop defaults to horizontal, so treat unset as horizontal too
  const horizontal = $derived((opts.config()?.orientation ?? `horizontal`) === `horizontal`)
  const pinned = $derived(Boolean(opts.config()?.wrapper_style))
  // Measured footprint, else an estimate (with room for tick labels) until it renders
  const footprint = $derived.by(() => {
    void size_revision
    return full_footprint_or(
      element,
      horizontal
        ? COLOR_BAR_DEFAULTS.horizontal_footprint
        : COLOR_BAR_DEFAULTS.vertical_footprint,
    )
  })
  const items = $derived<DecorationItem[]>(
    opts.enabled() && !pinned
      ? [
          {
            id: opts.id,
            kind: `colorbar`,
            footprint,
            horizontal,
            clearance: opts.config()?.axis_clearance ?? COLOR_BAR_DEFAULTS.axis_clearance,
          },
        ]
      : [],
  )
  // A pinned bar stays outside solver ownership, but its measured rectangle remains an
  // exclusion for the automatic items (the frame does the same for a pinned legend)
  const pinned_rects = $derived.by((): Rect[] => {
    if (!element || !pinned) return []
    const { offset_x, offset_y } = footprint
    return [
      { x: element.offsetLeft + offset_x, y: element.offsetTop + offset_y, ...footprint },
    ]
  })
  const placement = $derived(get_decoration_placement(opts.decoration_solution(), opts.id))
  const tween = create_placed_tween({
    placement: () => element_position_for_footprint(placement, footprint),
    dims: opts.dims,
    responsive: () => opts.config()?.responsive ?? false,
    element: () => element,
    tween: () => opts.config()?.tween,
    on_element_resize: () => (size_revision += 1),
    placement_revision: () => decoration_placement_revision(placement),
  })

  return {
    get element() {
      return element
    },
    set element(next: HTMLDivElement | undefined) {
      element = next
    },
    get footprint() {
      return footprint
    },
    get items() {
      return items
    },
    get pinned_rects() {
      return pinned_rects
    },
    get placement() {
      return placement
    },
    // Bumps when the rendered colorbar changes size; sibling decorations key off it
    get size_revision() {
      return size_revision
    },
    get data_attrs() {
      return decoration_data_attrs(placement)
    },
    tween,
  }
}
