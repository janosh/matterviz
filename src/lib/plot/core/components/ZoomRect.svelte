<script lang="ts">
  import type { Point2D } from '#lib/math.js'

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
  <rect
    class="zoom-rect"
    class:select={mode === `select`}
    x={Math.min(start.x, current.x)}
    y={Math.min(start.y, current.y)}
    width={Math.abs(start.x - current.x)}
    height={Math.abs(start.y - current.y)}
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
