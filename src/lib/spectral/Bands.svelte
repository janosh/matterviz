<script lang="ts">
  import { PLOT_COLORS } from '$lib/colors'
  import type { Vec2 } from '$lib/math'
  import ScatterPlot from '$lib/plot/ScatterPlot.svelte'
  import type { AxisConfig, DataSeries } from '$lib/plot/types'
  import * as helpers from '$lib/spectral/helpers'
  import type {
    BandStructureType,
    BaseBandStructure,
    LineKwargs,
    PathMode,
    RibbonConfig,
  } from '$lib/spectral/types'
  import type { ComponentProps } from 'svelte'
  import { SvelteMap } from 'svelte/reactivity'

  let {
    band_structs,
    line_kwargs = {},
    path_mode = `strict`,
    band_type = undefined,
    show_legend = true,
    x_axis = {},
    y_axis = {},
    x_positions = $bindable(),
    reference_frequency = null,
    ribbon_config = {},
    fermi_level = undefined,
    ...rest
  }: ComponentProps<typeof ScatterPlot> & {
    band_structs: BaseBandStructure | Record<string, BaseBandStructure>
    x_axis?: AxisConfig
    y_axis?: AxisConfig
    line_kwargs?: LineKwargs
    path_mode?: PathMode
    band_type?: BandStructureType
    show_legend?: boolean
    x_positions?: Record<string, [number, number]>
    reference_frequency?: number | null
    ribbon_config?: RibbonConfig | Record<string, RibbonConfig>
    fermi_level?: number // Fermi level for electronic bands (auto-detected if not provided)
  } = $props()

  // Helper function to get line styling for a band
  function get_line_style(
    color: string,
    is_acoustic: boolean,
    mode_type: `acoustic` | `optical`,
    frequencies: number[],
    band_idx: number,
  ): { stroke: string; stroke_width: number } {
    const defaults = { stroke: color, stroke_width: is_acoustic ? 1.5 : 1 }

    if (typeof line_kwargs === `function`) {
      const custom = line_kwargs(frequencies, band_idx)
      return {
        stroke: (custom.stroke as string) ?? defaults.stroke,
        stroke_width: (custom.stroke_width as number) ?? defaults.stroke_width,
      }
    }

    if (typeof line_kwargs === `object` && line_kwargs !== null) {
      const mode_kwargs = (line_kwargs as Record<string, unknown>)[mode_type] as
        | Record<string, unknown>
        | undefined
      const source = (mode_kwargs ?? line_kwargs) as Record<string, unknown>
      return {
        stroke: (source.stroke as string) ?? defaults.stroke,
        stroke_width: (source.stroke_width as number) ?? defaults.stroke_width,
      }
    }

    return defaults
  }

  // Ribbon data structure for rendering
  interface RibbonData {
    x_values: number[]
    y_values: number[]
    width_values: number[]
    color: string
    opacity: number
    max_width: number
    scale: number
    band_idx: number
    structure_label: string
    segment_key: string
  }

  // Normalize input to dict format
  // Supports multiple formats:
  // - matterviz format: qpoints + branches arrays
  // - pymatgen phonon: qpoints + bands (or frequencies_cm) arrays
  // - pymatgen electronic: kpoints + bands arrays
  let band_structs_dict = $derived.by(() => {
    if (!band_structs) return {}

    // Detect single band structure by checking for characteristic fields
    // - pymatgen format: has @class or @module markers (may also have branches)
    // - matterviz format: has qpoints + branches (no pymatgen markers)
    const has_qpoints = `qpoints` in band_structs &&
      Array.isArray(band_structs.qpoints) &&
      band_structs.qpoints.length > 0
    const has_kpoints = `kpoints` in band_structs &&
      Array.isArray(band_structs.kpoints) &&
      band_structs.kpoints.length > 0
    const has_bands = `bands` in band_structs
    const has_frequencies_cm = `frequencies_cm` in band_structs &&
      Array.isArray(band_structs.frequencies_cm)
    const has_branches = `branches` in band_structs
    // Pymatgen structures have explicit class/module markers
    const is_pymatgen = `@class` in band_structs || `@module` in band_structs

    // Pymatgen single: has markers and point/band data (may have branches too)
    const is_pymatgen_single = is_pymatgen &&
      (has_qpoints || has_kpoints) &&
      (has_bands || has_frequencies_cm)
    // Matterviz single: has qpoints + branches but NO pymatgen markers
    const is_matterviz_single = !is_pymatgen && has_qpoints && has_branches
    const is_single = is_matterviz_single || is_pymatgen_single

    const result: Record<string, BaseBandStructure> = {}

    if (is_single) {
      const normalized = helpers.normalize_band_structure(band_structs)
      if (normalized) result.default = normalized
    } else {
      for (const [key, bs] of Object.entries(band_structs)) {
        const normalized = helpers.normalize_band_structure(bs)
        if (normalized) result[key] = normalized
      }
    }
    return result
  })

  // Auto-detect band type if not explicitly set
  let detected_band_type = $derived.by((): BandStructureType => {
    if (band_type) return band_type
    if (!band_structs) return `phonon`

    // Single structure has marker fields; dict of structures has label keys
    const is_single = `@class` in band_structs || `@module` in band_structs ||
      `kpoints` in band_structs || `qpoints` in band_structs
    const source = (is_single ? band_structs : Object.values(band_structs)[0]) as
      | Record<string, unknown>
      | undefined
    if (!source) return `phonon`

    // Electronic: has kpoints, BandStructure* class (not Phonon*), or electronic_structure module
    const class_name = String(source[`@class`] ?? ``)
    if (
      (`kpoints` in source && Array.isArray(source.kpoints) &&
        source.kpoints.length > 0) ||
      (class_name.startsWith(`BandStructure`) && !class_name.startsWith(`Phonon`)) ||
      String(source[`@module`] ?? ``).includes(`electronic_structure`)
    ) return `electronic`

    return `phonon`
  })

  // Auto-detect Fermi level from electronic band structure data if not explicitly provided
  let effective_fermi_level = $derived.by((): number | undefined => {
    if (fermi_level !== undefined) return fermi_level
    if (detected_band_type !== `electronic`) return undefined

    // Check raw input for efermi field
    const source = `efermi` in (band_structs as object)
      ? band_structs
      : Object.values(band_structs)[0]
    const efermi = (source as Record<string, unknown>)?.efermi
    return typeof efermi === `number` ? efermi : undefined
  })

  // Determine which segments to plot based on path_mode
  let segments_to_plot = $derived.by(() => {
    const all_segments: Record<string, [string, BaseBandStructure][]> = {}

    // Collect all segments from all structures
    for (const [label, bs] of Object.entries(band_structs_dict)) {
      for (const branch of bs.branches) {
        const start_label = bs.qpoints[branch.start_index]?.label ?? undefined
        const end_label = bs.qpoints[branch.end_index]?.label ?? undefined
        const segment_key = helpers.get_segment_key(start_label, end_label)

        all_segments[segment_key] ??= []
        all_segments[segment_key].push([label, bs])
      }
    }

    const num_structs = Object.keys(band_structs_dict).length
    const is_intersection = path_mode === `strict` || path_mode === `intersection`

    if (is_intersection) {
      // Only segments present in all structures
      const common_segments = Object.keys(all_segments).filter(
        (seg) => all_segments[seg].length === num_structs,
      )

      // Warn in strict mode if not all segments are common
      if (
        path_mode === `strict` &&
        common_segments.length !== Object.keys(all_segments).length
      ) {
        console.warn(
          `Band structures have different q-point paths. Use path_mode="union" or "intersection".`,
        )
      }

      return new Set(common_segments)
    }

    // union - all segments
    return new Set(Object.keys(all_segments))
  })

  // Map segments to x-axis positions
  $effect(() => {
    const positions: Record<string, [number, number]> = {}
    let current_x = 0

    // Preserve physical path order using the first available structure
    const canonical = Object.values(band_structs_dict)[0]
    const ordered_segments = helpers.get_ordered_segments(canonical, segments_to_plot)

    for (let seg_idx = 0; seg_idx < ordered_segments.length; seg_idx++) {
      const segment_key = ordered_segments[seg_idx]
      if (positions[segment_key]) continue

      const [start_label, end_label] = segment_key.split(`_`)

      // Find the first band structure that has this segment
      for (const bs of Object.values(band_structs_dict)) {
        const matching_branch = bs.branches.find((branch) => {
          const branch_start = bs.qpoints[branch.start_index]?.label || `null`
          const branch_end = bs.qpoints[branch.end_index]?.label || `null`
          return branch_start === start_label && branch_end === end_label
        })

        if (matching_branch) {
          // Check if this is a discontinuity: consecutive indices mean no path between points
          const is_discontinuity =
            matching_branch.end_index - matching_branch.start_index === 1

          if (is_discontinuity) {
            // Place at same x position as current, no advancement
            positions[segment_key] = [current_x, current_x]
          } else {
            const segment_len = bs.distance[matching_branch.end_index] -
              bs.distance[matching_branch.start_index]
            positions[segment_key] = [current_x, current_x + segment_len]
            current_x += segment_len
          }
          break
        }
      }
    }

    x_positions = positions
  })

  // Convert band structures to scatter plot series
  let series_data = $derived.by((): DataSeries[] => {
    if (Object.keys(band_structs_dict).length === 0 || segments_to_plot.size === 0) {
      return []
    }

    const all_series: DataSeries[] = []

    for (const [bs_idx, [label, bs]] of Object.entries(band_structs_dict).entries()) {
      const color = PLOT_COLORS[bs_idx % PLOT_COLORS.length]
      const structure_label = label || `Structure ${bs_idx + 1}`

      for (const branch of bs.branches) {
        const start_idx = branch.start_index
        const end_idx = branch.end_index + 1
        const start_label = bs.qpoints[start_idx]?.label ?? undefined
        const end_label = bs.qpoints[end_idx - 1]?.label ?? undefined
        const segment_key = helpers.get_segment_key(start_label, end_label)

        if (!segments_to_plot.has(segment_key)) continue

        // Skip discontinuous segments (consecutive labeled points)
        const is_discontinuity = branch.end_index - branch.start_index === 1
        if (is_discontinuity) continue

        const [x_start, x_end] = x_positions?.[segment_key] || [0, 1]

        // Scale distances for this segment
        const segment_distances = bs.distance.slice(start_idx, end_idx)
        const scaled_distances = helpers.scale_segment_distances(
          segment_distances,
          x_start,
          x_end,
        )

        // Create series for each band
        for (let band_idx = 0; band_idx < bs.nb_bands; band_idx++) {
          const frequencies = bs.bands[band_idx].slice(start_idx, end_idx)
          const is_acoustic = detected_band_type === `phonon` &&
            band_idx < helpers.N_ACOUSTIC_MODES
          const mode_type = is_acoustic ? `acoustic` : `optical`

          const line_style = get_line_style(
            color,
            is_acoustic,
            mode_type,
            frequencies,
            band_idx,
          )

          all_series.push({
            x: scaled_distances,
            y: frequencies,
            markers: `line`,
            label: structure_label,
            line_style,
            metadata: { band_idx },
          })
        }
      }
    }

    return all_series
  })

  // Compute ribbon data for bands with width information
  let ribbon_data = $derived.by((): RibbonData[] => {
    if (Object.keys(band_structs_dict).length === 0 || segments_to_plot.size === 0) {
      return []
    }

    const all_ribbons: RibbonData[] = []

    for (const [bs_idx, [label, bs]] of Object.entries(band_structs_dict).entries()) {
      // Skip if this band structure has no width data
      if (!bs.band_widths || bs.band_widths.length === 0) continue

      const color = PLOT_COLORS[bs_idx % PLOT_COLORS.length]
      const structure_label = label || `Structure ${bs_idx + 1}`
      const config = helpers.get_ribbon_config(ribbon_config, label)

      for (const branch of bs.branches) {
        const start_idx = branch.start_index
        const end_idx = branch.end_index + 1
        const start_label = bs.qpoints[start_idx]?.label ?? undefined
        const end_label = bs.qpoints[end_idx - 1]?.label ?? undefined
        const segment_key = helpers.get_segment_key(start_label, end_label)

        if (!segments_to_plot.has(segment_key)) continue

        // Skip discontinuous segments
        const is_discontinuity = branch.end_index - branch.start_index === 1
        if (is_discontinuity) continue

        const [x_start, x_end] = x_positions?.[segment_key] || [0, 1]

        // Scale distances for this segment
        const segment_distances = bs.distance.slice(start_idx, end_idx)
        const scaled_distances = helpers.scale_segment_distances(
          segment_distances,
          x_start,
          x_end,
        )

        // Create ribbon data for each band that has width data
        for (let band_idx = 0; band_idx < bs.nb_bands; band_idx++) {
          const band_widths = bs.band_widths[band_idx]
          if (!band_widths) continue

          const width_values = band_widths.slice(start_idx, end_idx)
          // Skip if all widths are zero or missing
          if (width_values.every((wv) => !wv || wv <= 0)) continue

          const y_values = bs.bands[band_idx].slice(start_idx, end_idx)

          all_ribbons.push({
            x_values: scaled_distances,
            y_values,
            width_values,
            color: config.color ?? color,
            opacity: config.opacity ?? 0.3,
            max_width: config.max_width ?? 6,
            scale: config.scale ?? 1,
            band_idx,
            structure_label,
            segment_key,
          })
        }
      }
    }

    return all_ribbons
  })

  // Get x-axis tick positions with custom labels for symmetry points
  let x_axis_ticks = $derived.by(() => {
    const tick_map = new SvelteMap<number, string[]>()

    Object.entries(x_positions ?? {})
      .sort(([, [a]], [, [b]]) => a - b)
      .forEach(([segment_key, [x_start, x_end]]) => {
        const [start_lbl, end_lbl] = segment_key.split(`_`)
        const pretty_start = start_lbl !== `null`
          ? helpers.pretty_sym_point(start_lbl)
          : ``
        const pretty_end = end_lbl !== `null` ? helpers.pretty_sym_point(end_lbl) : ``

        // Check if this is a discontinuity (zero-length segment)
        const is_discontinuity = Math.abs(x_end - x_start) < 1e-6

        if (is_discontinuity && pretty_start && pretty_end) {
          // Combine labels at discontinuity points
          if (!tick_map.has(x_start)) tick_map.set(x_start, [])
          const labels = tick_map.get(x_start)!
          if (!labels.includes(pretty_start)) labels.push(pretty_start)
          if (!labels.includes(pretty_end)) labels.push(pretty_end)
        } else {
          // Normal segment with distinct start/end
          if (pretty_start) {
            if (!tick_map.has(x_start)) tick_map.set(x_start, [])
            const labels = tick_map.get(x_start)!
            if (!labels.includes(pretty_start)) labels.push(pretty_start)
          }
          if (pretty_end) {
            if (!tick_map.has(x_end)) tick_map.set(x_end, [])
            const labels = tick_map.get(x_end)!
            if (!labels.includes(pretty_end)) labels.push(pretty_end)
          }
        }
      })

    // Merge labels at same position with pipe separator
    return Object.fromEntries(
      Array.from(tick_map.entries()).map(([pos, labels]) => [
        pos,
        labels.join(` | `),
      ]),
    )
  })

  let x_range = $derived.by(() => {
    const flat = Object.values(x_positions ?? {}).flat()
    return [flat[0] ?? 0, flat.at(-1) ?? 1] as Vec2
  })

  // Calculate y-range, enforcing 0 minimum for phonon bands without imaginary modes
  let y_range = $derived.by((): Vec2 | undefined => {
    const all_freqs = Object.values(band_structs_dict).flatMap((bs) =>
      bs.bands.flat()
    )
    const finite = all_freqs.filter(Number.isFinite)
    if (!finite.length) return undefined
    let min_val = Math.min(...finite), max_val = Math.max(...finite)
    if (
      // clamp phonon min to 0 if negatives are noise
      detected_band_type === `phonon` && min_val < 0 &&
      helpers.negative_fraction(finite) < helpers.IMAGINARY_MODE_NOISE_THRESHOLD
    ) {
      min_val = 0
    }
    const padding = (max_val - min_val) * 0.02
    return [min_val === 0 ? 0 : min_val - padding, max_val + padding]
  })

  let final_y_axis = $derived({
    label: detected_band_type === `phonon` ? `Frequency (THz)` : `Energy (eV)`,
    format: `.2f`,
    label_shift: { y: 15 },
    range: y_range,
    ...y_axis,
  })
  let display = $state({ x_grid: false, y_grid: true, y_zero_line: true })
</script>

<ScatterPlot
  series={series_data}
  x_axis={{
    label: `Wave Vector`,
    ticks: Object.keys(x_axis_ticks).length > 0 ? x_axis_ticks : undefined,
    format: ``,
    range: x_range,
    ...x_axis,
  }}
  y_axis={final_y_axis}
  bind:display
  legend={show_legend && Object.keys(band_structs_dict).length > 1 ? {} : null}
  hover_config={{ threshold_px: 50 }}
  {...rest}
>
  {#snippet tooltip({ x, y_formatted, label, metadata })}
    {@const y_label_full = final_y_axis.label ?? ``}
    {@const [, y_label, y_unit] = y_label_full.match(/^(.+?)\s*\(([^)]+)\)$/) ??
      [, y_label_full, ``]}
    {@const segment = Object.entries(x_positions ?? {}).find(([, [start, end]]) =>
      x >= start && x <= end
    )}
    {@const path = segment?.[0].split(`_`).map((lbl) =>
      lbl !== `null` ? helpers.pretty_sym_point(lbl) : ``
    ).filter(Boolean).join(` → `) || null}
    {@const band_idx = metadata?.band_idx}
    {@const num_structs = Object.keys(band_structs_dict).length}
    {#if num_structs > 1 && label}<strong>{label}</strong><br />{/if}
    {y_label || `Value`}: {y_formatted}{y_unit ? ` ${y_unit}` : ``}<br />
    {#if path}Path: {path}<br />{/if}
    {#if typeof band_idx === `number`}Band: {band_idx + 1}{/if}
  {/snippet}

  {#snippet user_content({ height, x_scale_fn, y_scale_fn, pad })}
    <!-- Fat band ribbons (rendered behind band lines) -->
    {#each ribbon_data as
      ribbon
      (`${ribbon.structure_label}-${ribbon.segment_key}-${ribbon.band_idx}`)
    }
      {@const path_d = helpers.generate_ribbon_path(
      ribbon.x_values,
      ribbon.y_values,
      ribbon.width_values,
      x_scale_fn,
      y_scale_fn,
      ribbon.max_width,
      ribbon.scale,
    )}
      {#if path_d}
        <path
          d={path_d}
          fill={ribbon.color}
          opacity={ribbon.opacity}
          stroke="none"
          class="fat-band-ribbon"
        />
      {/if}
    {/each}

    <!-- Symmetry point vertical lines (filter NaN from scale) -->
    {#each Object.keys(x_axis_ticks).map(Number).map((x) => x_scale_fn(x)).filter(
      Number.isFinite,
    ) as
      scaled_x
      (scaled_x)
    }
      <line
        x1={scaled_x}
        x2={scaled_x}
        y1={pad.t}
        y2={height - pad.b}
        stroke="var(--bands-symmetry-line-color, light-dark(black, white))"
        stroke-width="var(--bands-symmetry-line-width, 1)"
        opacity="var(--bands-symmetry-line-opacity, 0.5)"
      />
    {/each}

    <!-- Fermi level line for electronic bands -->
    {@const fermi_y = effective_fermi_level !== undefined
      ? y_scale_fn(effective_fermi_level)
      : NaN}
    {@const bands_x_end = x_scale_fn(Object.values(x_positions ?? {}).flat().at(-1) ?? 1)}
    {#if Number.isFinite(fermi_y) && Number.isFinite(bands_x_end)}
      <line
        x1={pad.l}
        x2={bands_x_end}
        y1={fermi_y}
        y2={fermi_y}
        stroke="var(--bands-fermi-line-color, light-dark(#e74c3c, #ff6b6b))"
        stroke-width="var(--bands-fermi-line-width, 1.5)"
        stroke-dasharray="var(--bands-fermi-line-dash, 6,3)"
        opacity="var(--bands-fermi-line-opacity, 0.8)"
      />
      <text
        x={bands_x_end + 4}
        y={fermi_y}
        dy="0.35em"
        font-size="10"
        fill="var(--bands-fermi-line-color, light-dark(#e74c3c, #ff6b6b))"
        opacity="0.9"
      >
        E<tspan dy="2" font-size="8">F</tspan>
      </text>
    {/if}

    <!-- Reference frequency horizontal line -->
    {@const ref_y = reference_frequency !== null ? y_scale_fn(reference_frequency) : NaN}
    {#if Number.isFinite(ref_y) && Number.isFinite(bands_x_end)}
      <line
        x1={pad.l}
        x2={bands_x_end}
        y1={ref_y}
        y2={ref_y}
        stroke="var(--bands-reference-line-color, light-dark(#d48860, #c47850))"
        stroke-width="var(--bands-reference-line-width, 1)"
        stroke-dasharray="var(--bands-reference-line-dash, 4,3)"
        opacity="var(--bands-reference-line-opacity, 0.5)"
      />
    {/if}
  {/snippet}
</ScatterPlot>
