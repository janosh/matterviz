// Solver-placed colorbar shared by ScatterPlot and BinnedScatterPlot: measured footprint
// (with room for tick labels until the element renders), the DecorationItem fed to the
// frame's solver, the solved placement and its tweened follow-up. Creates $effects via
// create_placed_tween, so it must be called during component init. Render it with
// ColorBarDecoration.svelte.

import type { Point2D } from '$lib/math'
import type { DecorationItem, DecorationSolution } from '$lib/plot/core/decorations'
import {
  decoration_data_attrs,
  decoration_placement_revision,
  get_decoration_placement,
} from '$lib/plot/core/decorations'
import { element_position_for_footprint, full_footprint_or } from '$lib/plot/core/layout'
import { create_placed_tween } from '$lib/plot/core/placed-tween.svelte'
import { COLOR_BAR_DEFAULTS } from '$lib/plot/core/types'
import type { TweenOptions } from 'svelte/motion'

export type ColorbarDecoration = ReturnType<typeof create_colorbar_decoration>

export function create_colorbar_decoration(opts: {
  id: string
  // False hides the colorbar and withdraws it from the solver
  enabled: () => boolean
  horizontal: () => boolean
  // Min distance kept from plot edges/axes (default COLOR_BAR_DEFAULTS.axis_clearance)
  clearance?: () => number | undefined
  dims: () => { width: number; height: number }
  decoration_solution: () => DecorationSolution
  // Reposition whenever the solved placement moves (default: stay put after first placement)
  responsive?: () => boolean
  tween?: () => TweenOptions<Point2D> | undefined
}) {
  let element = $state<HTMLDivElement | undefined>()
  let size_revision = $state(0)
  // Measured footprint, else an estimate (with room for tick labels) until it renders
  const footprint = $derived.by(() => {
    void size_revision
    return full_footprint_or(
      element,
      opts.horizontal()
        ? COLOR_BAR_DEFAULTS.horizontal_footprint
        : COLOR_BAR_DEFAULTS.vertical_footprint,
    )
  })
  const items = $derived<DecorationItem[]>(
    opts.enabled()
      ? [
          {
            id: opts.id,
            kind: `colorbar`,
            footprint,
            horizontal: opts.horizontal(),
            clearance: opts.clearance?.() ?? COLOR_BAR_DEFAULTS.axis_clearance,
          },
        ]
      : [],
  )
  const placement = $derived(get_decoration_placement(opts.decoration_solution(), opts.id))
  const tween = create_placed_tween({
    placement: () => element_position_for_footprint(placement, footprint),
    dims: opts.dims,
    responsive: () => opts.responsive?.() ?? false,
    element: () => element,
    tween: opts.tween,
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
