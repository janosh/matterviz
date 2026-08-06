import type { Vec2 } from '$lib/math'
import type { FacetAxis, FacetAxisRanges, FacetLayoutContext } from '$lib/plot/core/facets'
import type { Sides } from '$lib/plot/core/layout'
import { untrack } from 'svelte'

interface FacetPlotAdapterOptions<Axis extends FacetAxis> {
  axes: readonly Axis[]
  facet_layout: () => FacetLayoutContext | undefined
  intrinsic_padding: () => Sides
  intrinsic_ranges: () => FacetAxisRanges
  ranges: () => Record<Axis, Vec2>
}

// Connect one Cartesian plot's local layout/range state to FacetGrid. Reports always
// use intrinsic values; reconciled padding/ranges flow only from the grid into the plot.
export function create_facet_plot_adapter<Axis extends FacetAxis>(
  options: FacetPlotAdapterOptions<Axis>,
) {
  $effect(() => {
    const facet_layout = options.facet_layout()
    if (!facet_layout) return
    facet_layout.report_layout({
      padding: options.intrinsic_padding(),
      ranges: options.intrinsic_ranges(),
    })
  })

  return {
    padding: (intrinsic: Required<Sides>): Required<Sides> => ({
      ...intrinsic,
      ...options.facet_layout()?.padding,
    }),
    axis_visible: (axis: Axis): boolean =>
      options.facet_layout()?.axis_visibility[axis] !== false,
    apply_ranges: (): void => {
      const facet_layout = options.facet_layout()
      if (!facet_layout) return
      const ranges = untrack(options.ranges)
      for (const axis of options.axes) {
        const range = facet_layout.ranges[axis]
        const current = untrack(() => ranges[axis])
        if (range && (range[0] !== current[0] || range[1] !== current[1])) {
          ranges[axis] = [range[0], range[1]]
        }
      }
    },
    update_range: (axis: Axis, range: Vec2): boolean => {
      const facet_layout = options.facet_layout()
      options.ranges()[axis] = range
      if (!facet_layout) return false
      facet_layout.update_range(axis, range)
      return true
    },
    reset_ranges: (): boolean => {
      const facet_layout = options.facet_layout()
      if (!facet_layout) return false
      for (const axis of options.axes) facet_layout.update_range(axis, null)
      return true
    },
  }
}
