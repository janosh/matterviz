// Solver-placed plot decorations (colorbars, size legends, free annotations): measured
// footprint (an estimate until the element renders), the DecorationItem fed to the frame's
// solver, the solved placement and its tweened follow-up. Creates $effects via
// create_placed_tween, so it must be called during component init.

import type { Point2D } from '#lib/math.js'
import type ColorBar from '#lib/plot/core/components/ColorBar.svelte'
import type {
  ColorbarDecorationItem,
  DecorationItem,
  DecorationSolution,
  FreeAnnotationDecorationItem,
} from '#lib/plot/core/decorations/index.js'
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

// User-facing placement options shared by every placed decoration. A non-empty
// `wrapper_style` pins it: it replaces the solver's position on the wrapper (pin with
// `left`/`right`/`top`/...), the solver stops placing it and only routes the others around it.
export type PlacementConfig = {
  wrapper_style?: string
  tween?: TweenOptions<Point2D>
  responsive?: boolean // Reposition whenever the solved placement moves (default: false)
  axis_clearance?: number // Min distance kept from plot edges/axes
}

// The `color_bar` prop of every solver-placed colorbar
export type ColorBarDecorationProps = ComponentProps<typeof ColorBar> & PlacementConfig

export type PlacedDecoration = ReturnType<typeof create_placed_decoration>

export function create_placed_decoration(opts: {
  id: string
  kind: () =>
    | Pick<ColorbarDecorationItem, `kind` | `horizontal`>
    | Pick<FreeAnnotationDecorationItem, `kind`>
  enabled: () => boolean // false hides it and withdraws it from the solver
  // The caller's raw config prop (not one rebuilt per data change, so data updates don't
  // re-trigger layout reads)
  config: () => PlacementConfig | null | undefined
  fallback_footprint: () => { width: number; height: number }
  clearance: number // default axis_clearance
  dims: () => { width: number; height: number }
  decoration_solution: () => DecorationSolution
  // Re-place when a sibling decoration this one routes around changes size
  sibling_revision?: () => number
}) {
  let element = $state<HTMLDivElement | undefined>()
  let size_revision = $state(0)
  const pinned = $derived(Boolean(opts.config()?.wrapper_style))
  // Measured footprint, else the estimate until it renders
  const footprint = $derived.by(() => {
    void size_revision
    return full_footprint_or(element, opts.fallback_footprint())
  })
  const items = $derived<DecorationItem[]>(
    opts.enabled() && !pinned
      ? [
          {
            id: opts.id,
            ...opts.kind(),
            footprint,
            clearance: opts.config()?.axis_clearance ?? opts.clearance,
          },
        ]
      : [],
  )
  // A pinned decoration stays outside solver ownership, but its measured rectangle remains
  // an exclusion for the automatic items (the frame does the same for a pinned legend)
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
    placement_revision: () =>
      `${decoration_placement_revision(placement)}:${opts.sibling_revision?.() ?? ``}`,
  })

  return {
    get element() {
      return element
    },
    set element(next: HTMLDivElement | undefined) {
      element = next
    },
    get items() {
      return items
    },
    get pinned_rects() {
      return pinned_rects
    },
    // Bumps when the rendered element changes size; sibling decorations key off it
    get size_revision() {
      return size_revision
    },
    get data_attrs() {
      return decoration_data_attrs(placement)
    },
    // Inline position: the pin when given, else the tweened solver placement
    get style() {
      return pinned
        ? opts.config()?.wrapper_style
        : `left: ${tween.coords.current.x}px; top: ${tween.coords.current.y}px`
    },
    tween,
  }
}

// Colorbar flavor: its orientation picks the solver item shape and the footprint estimate
// (with room for tick labels) until the bar renders. Render it with ColorBarDecoration.svelte.
export function create_colorbar_decoration(opts: {
  id: string
  enabled: () => boolean
  config: () => ColorBarDecorationProps | null | undefined
  dims: () => { width: number; height: number }
  decoration_solution: () => DecorationSolution
}) {
  // ColorBar's orientation prop defaults to horizontal, so treat unset as horizontal too
  const horizontal = () => (opts.config()?.orientation ?? `horizontal`) === `horizontal`
  return create_placed_decoration({
    ...opts,
    kind: () => ({ kind: `colorbar`, horizontal: horizontal() }),
    fallback_footprint: () =>
      horizontal()
        ? COLOR_BAR_DEFAULTS.horizontal_footprint
        : COLOR_BAR_DEFAULTS.vertical_footprint,
    clearance: COLOR_BAR_DEFAULTS.axis_clearance,
  })
}
