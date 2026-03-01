<script lang="ts">
  import type { XyObj } from '$lib/plot'

  let { start, current }: { start: XyObj | null; current: XyObj | null } = $props()
</script>

{#if start && current && isFinite(start.x) && isFinite(start.y) &&
    isFinite(current.x) && isFinite(current.y)}
  {@const x = Math.min(start.x, current.x)}
  {@const y = Math.min(start.y, current.y)}
  {@const rect_width = Math.abs(start.x - current.x)}
  {@const rect_height = Math.abs(start.y - current.y)}
  <rect class="zoom-rect" {x} {y} width={rect_width} height={rect_height} />
{/if}

<style>
  .zoom-rect {
    fill: var(--plot-zoom-rect-fill, rgba(100, 100, 255, 0.2));
    stroke: var(--plot-zoom-rect-stroke, rgba(100, 100, 255, 0.8));
    stroke-width: var(--plot-zoom-rect-stroke-width, 1);
    pointer-events: none;
  }
</style>
