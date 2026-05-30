<script lang="ts">
  import type { Sides } from './layout'

  // Reusable grid: draws horizontal/vertical lines at tick positions across the plot area.
  let { x_ticks, y_ticks, x_scale, y_scale, pad, width, height }: {
    x_ticks: number[]
    y_ticks: number[]
    x_scale: (value: number) => number
    y_scale: (value: number) => number
    pad: Required<Sides>
    width: number
    height: number
  } = $props()
</script>

<g class="plot-grid">
  {#each x_ticks as tick}
    {@const x = x_scale(tick)}
    <line x1={x} x2={x} y1={pad.t} y2={height - pad.b} />
  {/each}
  {#each y_ticks as tick}
    {@const y = y_scale(tick)}
    <line x1={pad.l} x2={width - pad.r} y1={y} y2={y} />
  {/each}
</g>

<style>
  .plot-grid line {
    stroke: var(--plot-grid-color, color-mix(in srgb, currentColor 18%, transparent));
    stroke-width: var(--plot-grid-width, 1);
  }
</style>
