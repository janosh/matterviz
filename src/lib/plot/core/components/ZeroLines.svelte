<script lang="ts">
  import type { Vec2 } from '$lib/math'
  import type { CartesianFrame } from '$lib/plot/core/cartesian-frame.svelte'
  import { get_scale_type_name, is_time_scale } from '$lib/plot/core/types'

  let {
    frame,
    display,
  }: {
    frame: CartesianFrame
    display: {
      x_zero_line?: boolean
      x2_zero_line?: boolean
      y_zero_line?: boolean
      y2_zero_line?: boolean
    }
  } = $props()

  const axes = $derived(frame.axes)
  const scales = $derived(frame.scales)
  const ranges = $derived(frame.ranges.current)
  const pad = $derived(frame.pad)

  const spans_zero = (range: Vec2): boolean =>
    Math.min(range[0], range[1]) <= 0 && Math.max(range[0], range[1]) >= 0
  // A log axis has no zero to draw, and a time axis's zero is the epoch rather than an
  // origin worth marking.
  const draws_zero = (axis: `x` | `x2` | `y` | `y2`): boolean =>
    get_scale_type_name(axes[axis].scale_type) !== `log` &&
    !is_time_scale(axes[axis].scale_type) &&
    spans_zero(ranges[axis])
</script>

{#if display.x_zero_line && draws_zero(`x`)}
  {@const zero_x = scales.x(0)}
  {#if isFinite(zero_x)}
    <line class="zero-line" x1={zero_x} x2={zero_x} y1={pad.t} y2={frame.height - pad.b} />
  {/if}
{/if}

{#if display.x2_zero_line && frame.has_x2 && draws_zero(`x2`)}
  {@const zero_x2 = scales.x2(0)}
  {#if isFinite(zero_x2)}
    <line class="zero-line" x1={zero_x2} x2={zero_x2} y1={pad.t} y2={frame.height - pad.b} />
  {/if}
{/if}

{#if display.y_zero_line && draws_zero(`y`)}
  {@const zero_y = scales.y(0)}
  {#if isFinite(zero_y)}
    <line class="zero-line" x1={pad.l} x2={frame.width - pad.r} y1={zero_y} y2={zero_y} />
  {/if}
{/if}

{#if display.y2_zero_line && frame.has_y2 && draws_zero(`y2`)}
  {@const zero_y2 = scales.y2(0)}
  {#if isFinite(zero_y2)}
    <line class="zero-line" x1={pad.l} x2={frame.width - pad.r} y1={zero_y2} y2={zero_y2} />
  {/if}
{/if}

<style>
  .zero-line {
    stroke: var(--plot-zero-line-color, light-dark(black, white));
    stroke-width: var(--plot-zero-line-width, 1);
    opacity: var(--plot-zero-line-opacity, 0.3);
  }
</style>
