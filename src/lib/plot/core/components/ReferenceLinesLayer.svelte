<script lang="ts">
  import type { CartesianFrame } from '$lib/plot/core/cartesian-frame.svelte'
  import {
    get_reference_annotation_placement,
    resolve_ref_line_axes,
  } from '$lib/plot/core/reference-line'
  import type { LayerZIndex, RefLineEvent } from '$lib/plot/core/types'
  import ReferenceLine from './ReferenceLine.svelte'

  // The frame's reference lines at one z level. Charts render one instance per level
  // between their own layers; hover state lives on the frame so the instances agree. Each
  // line resolves its axes through resolve_ref_line_axes, exactly like the annotation solver.
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
  <ReferenceLine
    ref_line={line}
    line_idx={line.idx}
    axes={resolve_ref_line_axes(line, frame.ref_line_axes)}
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
