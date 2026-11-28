<script lang="ts">
  import { annular_sector_path } from '#lib/plot/sunburst/render'
  import { hover_tooltip } from '#lib/tooltip/hover.svelte'
  import PatternDefs from '#lib/plot/core/components/PatternDefs.svelte'
  import type { CompositionChartProps } from './chart'
  import { composition_segments, fit_font_scale, segment_suffix, segment_title } from './chart'
  import SegmentLabel from './SegmentLabel.svelte'
  import SegmentTooltip from './SegmentTooltip.svelte'

  // label placement tiers by slice angle (degrees)
  const THIN_SLICE = 20 // label outside the pie
  const MEDIUM_SLICE = 90 // label near the outer edge
  const FULL_SCALE_ANGLE = 120 // slices at least this wide get the max font scale

  let {
    composition,
    size = 200,
    stroke_width = 0.5,
    inner_radius = 0,
    show_labels = true,
    show_percentages = false,
    show_amounts = true,
    color_scheme = `Vesta`,
    patterns = {},
    svg_node = $bindable(null),
    ...rest
  }: CompositionChartProps & {
    stroke_width?: number
    inner_radius?: number
  } = $props()

  const uid = $props.id()
  const pattern_uid = `pie-${uid}`

  let label_opts = $derived({ show_amounts, show_percentages })
  let center = $derived(size / 2)

  // Angles are radians clockwise from 12 o'clock, as annular_sector_path draws them
  const polar = (radius: number, angle: number): [number, number] => [
    center + radius * Math.sin(angle),
    center - radius * Math.cos(angle),
  ]

  // Thin slices label outside the rim. Each label's box (estimated like fit_font_scale, cap
  // height ~ font size) is pushed out until its nearest edge clears the rim by OUTSIDE_GAP,
  // neighbors are spread along the rim until they no longer overlap, and the pie shrinks just
  // enough that labels near 12 and 6 o'clock stay inside the square viewBox (content above or
  // below the chart, like a formula heading, is otherwise overdrawn).
  const OUTSIDE_SCALE = 1.1
  const OUTSIDE_FONT = 16 * OUTSIDE_SCALE // px, label box height and per-character width basis
  const OUTSIDE_GAP = 3
  type OutsideLabel = { idx: number; angle: number; width: number }
  // half the label's extent along the radius and along the rim at its angle
  const radial_half = ({ angle, width }: OutsideLabel) =>
    (Math.abs(Math.cos(angle)) * OUTSIDE_FONT + Math.abs(Math.sin(angle)) * width) / 2
  const tangent_half = ({ angle, width }: OutsideLabel) =>
    (Math.abs(Math.cos(angle)) * width + Math.abs(Math.sin(angle)) * OUTSIDE_FONT) / 2
  const label_distance = (label: OutsideLabel, radius: number) =>
    radius + OUTSIDE_GAP + radial_half(label)

  // Each run of touching labels is packed clockwise, every label pushed off its predecessor,
  // then shifted back so it stays centered on the slices it names. A run that shift moves into
  // the run before merges with it and is repacked (pool adjacent violators). Labels are
  // neighbors around the circle, so the pass starts after the widest empty arc, unwrapping
  // angles past 2π.
  function spread_labels(in_order: OutsideLabel[], radius: number): OutsideLabel[] {
    const gaps = in_order.map(
      (label, idx) =>
        (in_order[(idx + 1) % in_order.length].angle - label.angle + 2 * Math.PI) %
        (2 * Math.PI),
    )
    const first = (gaps.indexOf(Math.max(...gaps)) + 1) % in_order.length
    const labels = [...in_order.slice(first), ...in_order.slice(0, first)].map((label, idx) =>
      idx >= in_order.length - first ? { ...label, angle: label.angle + 2 * Math.PI } : label,
    )
    const placed = labels.map((label) => ({ ...label }))
    const min_angle = (prev: OutsideLabel, label: OutsideLabel) =>
      prev.angle +
      (tangent_half(prev) + tangent_half(label) + 2) / label_distance(label, radius)
    // repack labels start..end-1 from their slice angles, then center the run on them
    const pack_run = (start: number, end: number) => {
      let drift = 0
      for (let idx = start; idx < end; idx++) {
        const label = placed[idx]
        label.angle = labels[idx].angle
        if (idx > start) label.angle = Math.max(label.angle, min_angle(placed[idx - 1], label))
        drift += (label.angle - labels[idx].angle) / (end - start)
      }
      for (let idx = start; idx < end; idx++) placed[idx].angle -= drift
    }
    const run_starts: number[] = []
    for (let idx = 0; idx < placed.length; idx++) {
      run_starts.push(idx)
      // merge the newest run into its predecessor while it starts too close to it
      let start = idx
      while (start > 0 && placed[start].angle < min_angle(placed[start - 1], placed[start])) {
        run_starts.pop()
        start = run_starts[run_starts.length - 1]
        pack_run(start, idx + 1)
      }
    }
    return placed
  }

  // largest radius keeping every label's top (or bottom) edge inside the viewBox
  const fit_radius = (labels: OutsideLabel[], max_radius: number) =>
    labels.reduce((radius, label) => {
      const cos = Math.abs(Math.cos(label.angle))
      if (cos < 1e-6) return radius
      const limit = (center - OUTSIDE_FONT / 2) / cos - OUTSIDE_GAP - radial_half(label)
      return Math.min(radius, limit)
    }, max_radius)

  let layout = $derived.by(() => {
    let angle = 0
    const raw = composition_segments(composition, color_scheme, patterns, pattern_uid).map(
      (segment) => {
        const [start, end] = [angle, angle + segment.fraction * 2 * Math.PI]
        angle = end
        const label = segment.species + segment_suffix(segment, label_opts)
        return { segment, start, end, label }
      },
    )
    const max_radius = size / 2 - stroke_width
    // hidden labels take no room, their thin slices fall through to the in-slice layout
    const outside: OutsideLabel[] = []
    for (const [idx, { segment, start, end, label }] of raw.entries()) {
      if (!show_labels || segment.fraction * 360 >= THIN_SLICE) continue
      outside.push({ idx, angle: (start + end) / 2, width: label.length * 0.6 * OUTSIDE_FONT })
    }
    // spread and fit depend on each other: iterate to a fixed point (a few rounds suffice),
    // ending on a fit to the final spread so no label edge leaves the viewBox
    let outer_radius = max_radius
    let placed = outside
    for (let round = 0; round < 8 && outside.length; round++) {
      placed = spread_labels(outside, outer_radius)
      const fitted = Math.max(fit_radius(placed, outer_radius), max_radius / 2)
      const converged = outer_radius - fitted < 0.1 // px
      outer_radius = fitted
      if (converged) break
    }
    return { raw, outside: placed, outer_radius }
  })
  let outer_radius = $derived(layout.outer_radius)
  let ring_inner = $derived(Math.min(inner_radius, outer_radius - 10))

  let segments = $derived(
    layout.raw.map(({ segment, start, end, label }, idx) => {
      // centered on the origin, the <path> translates it to the chart center
      const path = annular_sector_path(start, end, Math.max(0, ring_inner), outer_radius)
      if (segment.fraction === 1) {
        const font_scale = fit_font_scale(2.6, label.length, outer_radius * 2)
        return { ...segment, path, label_x: center, label_y: center, font_scale }
      }
      const outside = layout.outside.find((placed) => placed.idx === idx)
      if (outside) {
        const [label_x, label_y] = polar(label_distance(outside, outer_radius), outside.angle)
        const text_color = `var(--text-color, #333)`
        return { ...segment, path, label_x, label_y, font_scale: OUTSIDE_SCALE, text_color }
      }
      const span = segment.fraction * 360 // degrees
      const label_radius =
        span < MEDIUM_SLICE
          ? ring_inner + (outer_radius - ring_inner) * 0.7
          : (outer_radius + ring_inner) / 2
      const [label_x, label_y] = polar(label_radius, (start + end) / 2)
      // font grows with slice angle, then shrinks to fit radial/arc space at the label radius
      const base_scale = 1.4 + Math.min(span / FULL_SCALE_ANGLE, 1) * 0.6
      const available = Math.min(outer_radius - ring_inner, (end - start) * label_radius * 0.8)
      return {
        ...segment,
        path,
        label_x,
        label_y,
        font_scale: fit_font_scale(base_scale, label.length, available),
      }
    }),
  )
</script>

<svg
  viewBox="0 0 {size} {size}"
  style:max-width="{size}px"
  {...rest}
  class={[`pie-chart`, rest.class]}
  bind:this={svg_node}
>
  <defs><PatternDefs patterns={segments.map((seg) => seg.pattern)} /></defs>
  {#each segments as segment (segment.species)}
    {#snippet segment_tooltip()}
      <SegmentTooltip {segment} />
    {/snippet}
    <path
      d={segment.path}
      transform="translate({center} {center})"
      fill={segment.pattern?.url ?? segment.color}
      stroke="white"
      role="img"
      aria-label={segment_title(segment)}
      {@attach hover_tooltip(segment_tooltip, () => segment.color)}
      stroke-width={segments.length === 1 ? 0 : stroke_width}
      class="pie-segment"
    />
  {/each}

  {#if show_labels}
    {#each segments as segment (segment.species)}
      <SegmentLabel
        x={segment.label_x}
        y={segment.label_y}
        {segment}
        font_scale={segment.font_scale}
        {label_opts}
      />
    {/each}
  {/if}
</svg>

<style>
  svg {
    /* thin slices' labels stay inside the viewBox vertically but may pass its sides */
    overflow: visible;
    outline: none; /* no browser focus ring around the chart (Composition makes it focusable) */
  }
  .pie-segment {
    transition: all 0.2s ease;
  }
  .pie-segment:is(:hover, [data-pinned]) {
    filter: brightness(1.1);
  }
</style>
