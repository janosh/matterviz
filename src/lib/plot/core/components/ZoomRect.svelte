<script lang="ts">
  import type { Point2D } from '$lib/math'

  let {
    start,
    current,
    mode = `zoom`,
  }: {
    start: Point2D | null
    current: Point2D | null
    // Alt+drag selects rather than zooms; a different tint is the only cue the user gets
    mode?: `zoom` | `select`
  } = $props()
</script>

{#if start && current && isFinite(start.x) && isFinite(start.y) && isFinite(current.x) && isFinite(current.y)}
  {@const x = Math.min(start.x, current.x)}
  {@const y = Math.min(start.y, current.y)}
  {@const rect_width = Math.abs(start.x - current.x)}
  {@const rect_height = Math.abs(start.y - current.y)}
  <rect
    class="zoom-rect"
    class:select={mode === `select`}
    {x}
    {y}
    width={rect_width}
    height={rect_height}
  />
{/if}

<style>
  .zoom-rect {
    fill: var(--plot-zoom-rect-fill, rgba(100, 100, 255, 0.2));
    stroke: var(--plot-zoom-rect-stroke, rgba(100, 100, 255, 0.8));
    stroke-width: var(--plot-zoom-rect-stroke-width, 1);
    pointer-events: none;
  }
  .zoom-rect.select {
    fill: var(--plot-select-rect-fill, rgba(120, 200, 120, 0.2));
    stroke: var(--plot-select-rect-stroke, rgba(60, 160, 60, 0.9));
    stroke-dasharray: var(--plot-select-rect-dash, 4 3);
  }
</style>
