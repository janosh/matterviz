<script lang="ts">
  import type { DecorationSolution } from '$lib/plot/core/decorations'
  import {
    get_reference_annotation_placement,
    type IndexedRefLine,
    type ReferenceLineRanges,
    type ReferenceLineScales,
  } from '$lib/plot/core/reference-line'
  import type { RefLineEvent } from '$lib/plot/core/types'
  import ReferenceLine from './ReferenceLine.svelte'

  let {
    lines,
    ranges,
    scales,
    clip_path_id,
    decoration_solution,
    hovered_line_idx = $bindable<number | null>(null),
    on_click,
    on_hover,
  }: {
    lines: readonly IndexedRefLine[]
    ranges: ReferenceLineRanges
    scales: ReferenceLineScales
    clip_path_id: string
    decoration_solution: DecorationSolution
    hovered_line_idx?: number | null
    on_click?: (event: RefLineEvent) => void
    on_hover?: (event: RefLineEvent | null) => void
  } = $props()
</script>

{#each lines as line (line.id ?? line.idx)}
  {@const x_range = line.x_axis === `x2` ? (ranges.x2 ?? ranges.x) : ranges.x}
  {@const y_range = line.y_axis === `y2` ? (ranges.y2 ?? ranges.y) : ranges.y}
  <ReferenceLine
    ref_line={line}
    line_idx={line.idx}
    x_min={x_range[0]}
    x_max={x_range[1]}
    y_min={y_range[0]}
    y_max={y_range[1]}
    x_scale={scales.x}
    x2_scale={scales.x2}
    y_scale={scales.y}
    y2_scale={scales.y2}
    {clip_path_id}
    {hovered_line_idx}
    annotation_placement={get_reference_annotation_placement(decoration_solution, line.idx)}
    on_click={(event) => {
      line.on_click?.(event)
      on_click?.(event)
    }}
    on_hover={(event) => {
      hovered_line_idx = event?.line_idx ?? null
      line.on_hover?.(event)
      on_hover?.(event)
    }}
  />
{/each}
