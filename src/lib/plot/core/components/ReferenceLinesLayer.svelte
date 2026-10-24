<script lang="ts">
  import type { CartesianFrame } from '#lib/plot/core/cartesian-frame.svelte.js'
  import {
    get_reference_annotation_placement,
    resolve_ref_line_axes,
  } from '#lib/plot/core/reference-line.js'
  import type { LayerZIndex } from '#lib/plot/core/types.js'
  import ReferenceLine from './ReferenceLine.svelte'

  // The frame's reference lines at one z level. Charts render one instance per level
  // between their own layers; hover state and the click/hover handlers live on the frame so
  // the instances agree. Each line resolves its axes through resolve_ref_line_axes, exactly
  // like the annotation solver.
  let { frame, z: coord_z }: { frame: CartesianFrame; z: LayerZIndex } = $props()

  const lines = $derived(
    frame.ref_lines.filter((line) => (line.z_index ?? `below-lines`) === coord_z),
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
    on_click={frame.on_ref_line_click}
    on_hover={(event) => {
      frame.hovered_ref_line_idx = event?.line_idx ?? null
      frame.on_ref_line_hover?.(event)
    }}
  />
{/each}
