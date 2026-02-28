<script lang="ts">
  import { get_scale_type_name, type ScaleType, type Sides } from '$lib/plot'

  let {
    display,
    x_scale_fn,
    y_scale_fn,
    y2_scale_fn,
    x_range,
    y_range,
    y2_range,
    x_scale_type,
    y_scale_type,
    y2_scale_type,
    x_is_time = false,
    has_y2 = false,
    width,
    height,
    pad,
  }: {
    display: { x_zero_line?: boolean; y_zero_line?: boolean }
    x_scale_fn: (val: number) => number
    y_scale_fn: (val: number) => number
    y2_scale_fn?: (val: number) => number
    x_range: [number, number]
    y_range: [number, number]
    y2_range?: [number, number]
    x_scale_type?: ScaleType
    y_scale_type?: ScaleType
    y2_scale_type?: ScaleType
    x_is_time?: boolean
    has_y2?: boolean
    width: number
    height: number
    pad: Required<Sides>
  } = $props()
</script>

{#if display.x_zero_line &&
    get_scale_type_name(x_scale_type) !== `log` &&
    !x_is_time && x_range[0] <= 0 && x_range[1] >= 0}
  {@const zero_x = x_scale_fn(0)}
  {#if isFinite(zero_x)}
    <line class="zero-line" x1={zero_x} x2={zero_x} y1={pad.t} y2={height - pad.b} />
  {/if}
{/if}

{#if display.y_zero_line &&
    get_scale_type_name(y_scale_type) !== `log` &&
    y_range[0] <= 0 && y_range[1] >= 0}
  {@const zero_y = y_scale_fn(0)}
  {#if isFinite(zero_y)}
    <line class="zero-line" x1={pad.l} x2={width - pad.r} y1={zero_y} y2={zero_y} />
  {/if}
{/if}

{#if display.y_zero_line && has_y2 && y2_scale_fn && y2_range &&
    get_scale_type_name(y2_scale_type) !== `log` &&
    y2_range[0] <= 0 && y2_range[1] >= 0}
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
