<script lang="ts">
  import type { CartesianFrame } from '$lib/plot/core/cartesian-frame.svelte'
  import type { FacetAxis } from '$lib/plot/core/facets'
  import { get_scale_type_name, is_time_scale } from '$lib/plot/core/types'

  let {
    frame,
    display,
  }: {
    frame: CartesianFrame
    display: Partial<Record<`${FacetAxis}_zero_line`, boolean>>
  } = $props()

  // One full-height (x axes) or full-width (y axes) line per enabled axis whose range spans
  // zero. A log axis has no zero to draw, and a time axis's zero is the epoch rather than an
  // origin worth marking.
  const zero_lines = $derived.by(() => {
    const { axes, scales, pad, width, height } = frame
    const ranges = frame.ranges.current
    const lines: { x1: number; x2: number; y1: number; y2: number }[] = []
    for (const axis of [`x`, `x2`, `y`, `y2`] as const) {
      const [lo, hi] = ranges[axis]
      const scale_type = axes[axis].scale_type
      if (
        !display[`${axis}_zero_line`] ||
        (axis === `x2` && !frame.has_x2) ||
        (axis === `y2` && !frame.has_y2) ||
        get_scale_type_name(scale_type) === `log` ||
        is_time_scale(scale_type) ||
        Math.min(lo, hi) > 0 ||
        Math.max(lo, hi) < 0
      )
        continue
      const zero = scales[axis](0)
      if (!Number.isFinite(zero)) continue
      lines.push(
        axis === `x` || axis === `x2`
          ? { x1: zero, x2: zero, y1: pad.t, y2: height - pad.b }
          : { x1: pad.l, x2: width - pad.r, y1: zero, y2: zero },
      )
    }
    return lines
  })
</script>

{#each zero_lines as line, line_idx (line_idx)}
  <line class="zero-line" {...line} />
{/each}

<style>
  .zero-line {
    stroke: var(--plot-zero-line-color, light-dark(black, white));
    stroke-width: var(--plot-zero-line-width, 1);
    opacity: var(--plot-zero-line-opacity, 0.3);
  }
</style>
