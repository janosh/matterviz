<script lang="ts">
  // Renders a zone-axis electron diffraction pattern as spots on a plane.
  //
  // This does NOT use ScatterPlot: a diffraction pattern is only meaningful when the two
  // reciprocal-space axes are drawn at the same scale, and ScatterPlot has no fixed-aspect or
  // equal-axis-scaling option (AxisConfig exposes range but nothing that couples the two
  // axes). Rather than ship a pattern that shears with the container, the geometry is laid out
  // here from one shared px-per-(1/Å) factor.
  import { format_num } from '$lib/labels'
  import type { HTMLAttributes } from 'svelte/elements'
  import { format_hkl, type HklFormat, type SaedPatternData } from './index'
  import { laue_zone_label, saed_pattern_radius } from './saed'

  let {
    pattern,
    hkl_format = `compact`,
    annotate_spots = 12,
    max_spots = 2000,
    spot_radius_range = [1.5, 9],
    show_scale_bar = true,
    margin = 28,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    pattern: SaedPatternData
    hkl_format?: HklFormat
    // Number of strongest spots to label with their Miller indices
    annotate_spots?: number
    // Cap on drawn spots: each costs a <circle> plus a <title> and a dense pattern reaches
    // five figures. Spots arrive strongest-first, so the dropped tail is invisible anyway.
    max_spots?: number
    // [min, max] drawn spot radius in px, mapped from sqrt(intensity)
    spot_radius_range?: [number, number]
    show_scale_bar?: boolean
    margin?: number
  } = $props()

  let width = $state(0)
  let height = $state(0)

  const drawn_spots = $derived(pattern.spots.slice(0, Math.max(0, max_spots)))
  // Over every spot, not just the drawn ones, so the cap cannot rescale the view
  const pattern_radius = $derived(saed_pattern_radius(pattern))
  // One scale for both axes — this is what keeps the pattern undistorted
  const px_per_inv_angstrom = $derived(
    pattern_radius > 0 && width > 0 && height > 0
      ? Math.max(0, Math.min(width, height) / 2 - margin) / pattern_radius
      : 0,
  )
  const center = $derived({ x: width / 2, y: height / 2 })

  const [min_radius, max_radius] = $derived(spot_radius_range)
  const placed_spots = $derived.by(() => {
    if (px_per_inv_angstrom === 0) return []
    // spots are sorted strongest-first, so the first N are the ones worth labelling
    const label_cutoff = Math.max(0, Math.floor(annotate_spots))
    return drawn_spots.map((spot, spot_idx) => {
      // sqrt maps intensity to disc area, so a spot's ink is proportional to |F|²
      const weight = Math.sqrt(Math.max(0, spot.intensity) / 100)
      return {
        spot,
        cx: center.x + spot.position_2d[0] * px_per_inv_angstrom,
        // SVG y grows downward; flip so the pattern reads as a right-handed view down the beam
        cy: center.y - spot.position_2d[1] * px_per_inv_angstrom,
        radius: min_radius + (max_radius - min_radius) * weight,
        opacity: 0.35 + 0.65 * weight,
        label: spot_idx < label_cutoff ? format_hkl(spot.hkl, hkl_format) : ``,
      }
    })
  })

  // Round the scale bar to a readable 1/Å value covering roughly a quarter of the view
  const scale_bar = $derived.by(() => {
    if (px_per_inv_angstrom === 0) return null
    const target = pattern_radius / 2
    const magnitude = 10 ** Math.floor(Math.log10(target))
    const steps = [1, 2, 5, 10].map((step) => step * magnitude)
    const value = steps.findLast((candidate) => candidate <= target) ?? magnitude
    return { value, px: value * px_per_inv_angstrom }
  })

  const zone_text = $derived(`[${pattern.zone_axis.join(` `)}]`)
</script>

<div class="saed-pattern" bind:clientWidth={width} bind:clientHeight={height} {...rest}>
  <svg {width} {height} role="img" aria-label="Electron diffraction pattern down {zone_text}">
    <!-- Direct beam (000), drawn as a ring so it is not mistaken for a reflection -->
    <circle class="direct-beam" cx={center.x} cy={center.y} r={max_radius * 0.9} />
    {#each placed_spots as { spot, cx, cy, radius, opacity, label } (spot.hkl.join(`,`))}
      <circle
        {cx}
        {cy}
        r={radius}
        {opacity}
        class="spot"
        class:higher-zone={spot.laue_zone > 0}
      >
        <title
          >{format_hkl(spot.hkl, `full`)} · {laue_zone_label(spot.laue_zone)}
          d = {format_num(spot.d_spacing, `.4~`)} Å I = {format_num(spot.intensity, `.3~`)}
          s_g = {format_num(spot.excitation_error, `.3~`)} 1/Å</title
        >
      </circle>
      {#if label}
        <text class="hkl-label" x={cx + radius + 3} y={cy - radius - 2}>{label}</text>
      {/if}
    {/each}
    {#if show_scale_bar && scale_bar}
      <g class="scale-bar" transform="translate({margin / 2}, {height - margin / 2})">
        <line x1="0" y1="0" x2={scale_bar.px} y2="0" />
        <text x={scale_bar.px / 2} y="-5">{format_num(scale_bar.value, `.3~`)} 1/Å</text>
      </g>
    {/if}
    <text class="zone-label" x={margin / 2} y={margin / 2 + 6}>
      {zone_text} · λ = {format_num(pattern.wavelength, `.4~`)} Å · {drawn_spots.length ===
      pattern.spots.length
        ? pattern.spots.length
        : `${drawn_spots.length} of ${pattern.spots.length}`} spots
    </text>
  </svg>
  {#if pattern.spots.length === 0}
    <p class="empty">No reflections satisfy the excitation condition down {zone_text}.</p>
  {/if}
</div>

<style>
  .saed-pattern {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 300px;
    background: light-dark(#fbfbfd, #101015);
    border-radius: 6px;
  }
  svg {
    display: block;
    overflow: visible;
  }
  .spot {
    fill: light-dark(#1c2b4a, #d8e4ff);
  }
  .spot.higher-zone {
    fill: var(--accent-color, #4e79a7);
  }
  .direct-beam {
    fill: none;
    stroke: var(--text-color-muted, #888);
    stroke-width: 1.5;
    stroke-dasharray: 2 2;
  }
  .hkl-label {
    font-size: 10px;
    fill: var(--text-color-muted, #888);
    pointer-events: none;
  }
  .zone-label {
    font-size: 12px;
    fill: var(--text-color-muted, #888);
  }
  .scale-bar line {
    stroke: var(--text-color-muted, #888);
    stroke-width: 2;
  }
  .scale-bar text {
    font-size: 10px;
    fill: var(--text-color-muted, #888);
    text-anchor: middle;
  }
  .empty {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: var(--text-color-muted, #888);
  }
</style>
