<script lang="ts">
  import type { CartesianFrame } from '#lib/plot/core/cartesian-frame.svelte.js'
  import type { FacetAxis } from '#lib/plot/core/facets.js'
  import { get_scale_type_name, is_time_scale } from '#lib/plot/core/types.js'
  import { plot_area_line } from '#lib/plot/core/layout.js'

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
    const { axes, scales } = frame
    const ranges = frame.ranges.current
    const lines: ReturnType<typeof plot_area_line>[] = []
    for (const axis of [`x`, `x2`, `y`, `y2`] as const) {
      const [lower, upper] = ranges[axis]
      const scale_type = axes[axis].scale_type
      if (
        !display[`${axis}_zero_line`] ||
        (axis === `x2` && !frame.has_x2) ||
        (axis === `y2` && !frame.has_y2) ||
        get_scale_type_name(scale_type) === `log` ||
        is_time_scale(scale_type) ||
        Math.min(lower, upper) > 0 ||
        Math.max(lower, upper) < 0
      )
        continue
      const zero = scales[axis](0)
      if (!Number.isFinite(zero)) continue
      lines.push(plot_area_line(zero, axis === `y` || axis === `y2`, frame))
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
