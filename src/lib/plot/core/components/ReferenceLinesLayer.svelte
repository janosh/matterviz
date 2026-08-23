<script lang="ts">
  import type { CartesianFrame } from '$lib/plot/core/cartesian-frame.svelte'
  import { range_bounds } from '$lib/plot/core/interactions'
  import { get_reference_annotation_placement } from '$lib/plot/core/reference-line'
  import type { LayerZIndex, RefLineEvent } from '$lib/plot/core/types'
  import ReferenceLine from './ReferenceLine.svelte'

  // The frame's reference lines at one z level. Charts render one instance per level
  // between their own layers; hover state lives on the frame so the instances agree.
  // Axis bounds go through range_bounds so an inverted range (e.g. [1, 0]) keeps its lines;
  // x2/y2 fall back to the primary axis while the chart has no secondary data (the frame
  // omits them from ref_line_axes), matching the annotation solver.
  let {
    frame,
    z = `below-lines`,
    on_click,
    on_hover,
  }: {
    frame: CartesianFrame
    z?: LayerZIndex
    on_click?: (event: RefLineEvent) => void
    on_hover?: (event: RefLineEvent | null) => void
  } = $props()

  const lines = $derived(
    frame.ref_lines.filter((line) => (line.z_index ?? `below-lines`) === z),
  )
</script>

{#each lines as line (line.idx)}
  {@const { ranges, scales } = frame.ref_line_axes}
  {@const [x_min, x_max] = range_bounds(
    line.x_axis === `x2` ? (ranges.x2 ?? ranges.x) : ranges.x,
  )}
  {@const [y_min, y_max] = range_bounds(
    line.y_axis === `y2` ? (ranges.y2 ?? ranges.y) : ranges.y,
  )}
  <ReferenceLine
    ref_line={line}
    line_idx={line.idx}
    {x_min}
    {x_max}
    {y_min}
    {y_max}
    x_scale={scales.x}
    x2_scale={scales.x2}
    y_scale={scales.y}
    y2_scale={scales.y2}
    clip_path_id={frame.clip_path_id}
    hovered_line_idx={frame.hovered_ref_line_idx}
    annotation_placement={get_reference_annotation_placement(
      frame.decoration_solution,
      line.idx,
    )}
    {on_click}
    on_hover={(event) => {
      frame.hovered_ref_line_idx = event?.line_idx ?? null
      on_hover?.(event)
    }}
  />
{/each}
