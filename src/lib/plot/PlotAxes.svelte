<script lang="ts">
  import { format_value } from '$lib/labels'
  import AxisLabel from './AxisLabel.svelte'
  import type { Sides } from './layout'
  import type { AxisConfig } from './types'

  // Reusable axis layer: x/y baselines, tick labels, and optional rotated axis labels.
  // Grid lines are a separate concern (see PlotGrid) so reference lines can layer between them.
  let {
    x_ticks,
    y_ticks,
    x_scale,
    y_scale,
    pad,
    width,
    height,
    x_axis = {},
    y_axis = {},
  }: {
    x_ticks: number[]
    y_ticks: number[]
    x_scale: (value: number) => number
    y_scale: (value: number) => number
    pad: Required<Sides>
    width: number
    height: number
    x_axis?: AxisConfig
    y_axis?: AxisConfig
  } = $props()

  let plot_width = $derived(width - pad.l - pad.r)
  let plot_height = $derived(height - pad.t - pad.b)
</script>

<g class="plot-axes">
  <line x1={pad.l} x2={width - pad.r} y1={height - pad.b} y2={height - pad.b} />
  <line x1={pad.l} x2={pad.l} y1={pad.t} y2={height - pad.b} />
  {#each x_ticks as tick}
    {@const x = x_scale(tick)}
    <text x={x} y={height - pad.b + 18} text-anchor="middle">
      {format_value(tick, x_axis.format ?? `.2~g`)}
    </text>
  {/each}
  {#each y_ticks as tick}
    {@const y = y_scale(tick)}
    <text x={pad.l - 8} y={y + 4} text-anchor="end">
      {format_value(tick, y_axis.format ?? `.2~g`)}
    </text>
  {/each}
  {#if x_axis.label}
    <AxisLabel x={pad.l + plot_width / 2} y={height - 12} label={x_axis.label} axis_type="x" />
  {/if}
  {#if y_axis.label}
    <AxisLabel x={22} y={pad.t + plot_height / 2} label={y_axis.label} rotate axis_type="y" />
  {/if}
</g>

<style>
  .plot-axes line {
    stroke: var(--plot-axis-color, currentColor);
    stroke-width: var(--plot-axis-width, 1);
  }
  .plot-axes text {
    fill: currentColor;
    font-size: var(--plot-tick-font-size, 11px);
  }
  .plot-axes :global(.axis-label) {
    color: currentColor;
    font-size: 13px;
    font-weight: 600;
    height: 100%;
    line-height: 24px;
    text-align: center;
    white-space: nowrap;
    width: 100%;
  }
</style>
