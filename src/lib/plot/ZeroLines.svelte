<script lang="ts">
  import type { Vec2 } from '$lib/math'
  import { get_scale_type_name, type ScaleType, type Sides } from '$lib/plot'

  let {
    display,
    x_scale_fn,
    x2_scale_fn,
    y_scale_fn,
    y2_scale_fn,
    x_range,
    x2_range,
    y_range,
    y2_range,
    x_scale_type,
    x2_scale_type,
    y_scale_type,
    y2_scale_type,
    x_is_time = false,
    x2_is_time = false,
    has_x2 = false,
    has_y2 = false,
    width,
    height,
    pad,
  }: {
    display: {
      x_zero_line?: boolean
      x2_zero_line?: boolean
      y_zero_line?: boolean
      y2_zero_line?: boolean
    }
    x_scale_fn: (val: number) => number
    x2_scale_fn?: (val: number) => number
    y_scale_fn: (val: number) => number
    y2_scale_fn?: (val: number) => number
    x_range: Vec2
    x2_range?: Vec2
    y_range: Vec2
    y2_range?: Vec2
    x_scale_type?: ScaleType
    x2_scale_type?: ScaleType
    y_scale_type?: ScaleType
    y2_scale_type?: ScaleType
    x_is_time?: boolean
    x2_is_time?: boolean
    has_x2?: boolean
    has_y2?: boolean
    width: number
    height: number
    pad: Required<Sides>
  } = $props()

  const spans_zero = (range: Vec2): boolean =>
    Math.min(range[0], range[1]) <= 0 && Math.max(range[0], range[1]) >= 0
</script>

{#if display.x_zero_line && get_scale_type_name(x_scale_type) !== `log` &&
    !x_is_time && spans_zero(x_range)}
  {@const zero_x = x_scale_fn(0)}
  {#if isFinite(zero_x)}
    <line class="zero-line" x1={zero_x} x2={zero_x} y1={pad.t} y2={height - pad.b} />
  {/if}
{/if}

{#if display.x2_zero_line && has_x2 && x2_scale_fn && x2_range &&
    get_scale_type_name(x2_scale_type) !== `log` && !x2_is_time && spans_zero(x2_range)}
  {@const zero_x2 = x2_scale_fn(0)}
  {#if isFinite(zero_x2)}
    <line class="zero-line" x1={zero_x2} x2={zero_x2} y1={pad.t} y2={height - pad.b} />
  {/if}
{/if}

{#if display.y_zero_line && get_scale_type_name(y_scale_type) !== `log` &&
    spans_zero(y_range)}
  {@const zero_y = y_scale_fn(0)}
  {#if isFinite(zero_y)}
    <line class="zero-line" x1={pad.l} x2={width - pad.r} y1={zero_y} y2={zero_y} />
  {/if}
{/if}

{#if display.y2_zero_line && has_y2 && y2_scale_fn && y2_range &&
    get_scale_type_name(y2_scale_type) !== `log` && spans_zero(y2_range)}
  {@const zero_y2 = y2_scale_fn(0)}
  {#if isFinite(zero_y2)}
    <line class="zero-line" x1={pad.l} x2={width - pad.r} y1={zero_y2} y2={zero_y2} />
  {/if}
{/if}

<style>
  .zero-line {
    stroke: var(--plot-zero-line-color, light-dark(black, white));
    stroke-width: var(--plot-zero-line-width, 1);
    opacity: var(--plot-zero-line-opacity, 0.3);
  }
</style>
