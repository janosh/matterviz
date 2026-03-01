<script lang="ts">
  import { PLOT_COLORS } from '$lib/colors'
  import EmptyState from '$lib/EmptyState.svelte'
  import { format_num } from '$lib/labels'
  import { SettingsSection } from '$lib/layout'
  import type { Vec2 } from '$lib/math'
  import ScatterPlot from '$lib/plot/ScatterPlot.svelte'
  import type { AxisConfig, DataSeries, FillRegion } from '$lib/plot/types'
  import * as helpers from '$lib/spectral/helpers'
  import type {
    BandsSpinMode,
    BandStructureType,
    BaseBandStructure,
    FrequencyUnit,
    LineKwargs,
    PathMode,
    RibbonConfig,
  } from '$lib/spectral/types'
  import type { ComponentProps } from 'svelte'
  import { SvelteMap } from 'svelte/reactivity'

  type Dom_attr_value = string | number | boolean

  let {
    band_structs,
    line_kwargs = {},
    path_mode = `strict`,
    band_type = undefined,
    show_legend = true,
    x_axis = {},
    y_axis = $bindable({}),
    x_positions = $bindable(),
    reference_frequency = null,
    ribbon_config = {},
    fermi_level = undefined,
    units = $bindable(`THz`),
    band_spin_mode = $bindable(`overlay`),
    highlight_regions = [],
    shade_imaginary_modes = true,
    show_gap_annotation = true,
    show_controls = true,
    show_path_mode_control = true,
    show_units_control = true,
    show_spin_control = true,
    show_annotation_controls = true,
    id = undefined,
    class: class_name = undefined,
    style = undefined,
    'data-testid': data_testid = undefined,
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
    units?: FrequencyUnit // Phonon frequency display units (electronic always eV)
    band_spin_mode?: BandsSpinMode // Electronic spin display: overlay (default), up_only, down_only
    highlight_regions?: {
      y_min: number
      y_max: number
      color?: string
      opacity?: number
      label?: string
    }[]
    shade_imaginary_modes?: boolean // Shade y<0 region for phonon plots with imaginary modes
    show_gap_annotation?: boolean // Annotate electronic VBM/CBM and gap when available
    show_controls?: boolean
    show_path_mode_control?: boolean
    show_units_control?: boolean
    show_spin_control?: boolean
    show_annotation_controls?: boolean
    id?: string
    class?: string
    style?: string
    'data-testid'?: string
  } = $props()

  const is_dom_attr_value = (attr_value: unknown): attr_value is Dom_attr_value =>
    typeof attr_value === `string` ||
    typeof attr_value === `number` ||
    typeof attr_value === `boolean`

  // Helper function to get line styling for a band
  function get_line_style(
    color: string,
    is_acoustic: boolean,
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
      const mode_key = is_acoustic ? `acoustic` : `optical`
      const mode_kwargs = (line_kwargs as Record<string, unknown>)[mode_key] as
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
    const py_class_name = String(source[`@class`] ?? ``)
    if (
      (`kpoints` in source && Array.isArray(source.kpoints) &&
        source.kpoints.length > 0) ||
      (py_class_name.startsWith(`BandStructure`) &&
        !py_class_name.startsWith(`Phonon`)) ||
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

  let effective_spin_mode = $derived.by((): BandsSpinMode => {
    if (detected_band_type !== `electronic`) return null
    return (band_spin_mode === `up_only` || band_spin_mode === `down_only`)
      ? band_spin_mode
      : `overlay`
  })

  const convert_band_values = (values: number[]): number[] => {
    if (detected_band_type !== `phonon`) return values
    if (units === `THz`) return values
    return helpers.convert_frequencies(values, units)
  }

  // Collect all path segments across structures once (shared by strict checks and plotting)
  let all_segments = $derived.by(() => {
    const all_segments: Record<string, [string, BaseBandStructure][]> = {}
    for (const [label, bs] of Object.entries(band_structs_dict)) {
      for (const branch of bs.branches) {
        const start_label = bs.qpoints[branch.start_index]?.label ?? undefined
        const end_label = bs.qpoints[branch.end_index]?.label ?? undefined
        const segment_key = helpers.get_segment_key(start_label, end_label)
        all_segments[segment_key] ??= []
        all_segments[segment_key].push([label, bs])
      }
    }
    return all_segments
  })

  let num_structures = $derived(Object.keys(band_structs_dict).length)
  let all_segment_keys = $derived(Object.keys(all_segments))
  let common_segment_keys = $derived.by(() =>
    all_segment_keys.filter(
      (segment_key) => all_segments[segment_key].length === num_structures,
    )
  )
  let empty_state_attrs = $derived.by(() => {
    const attrs: Record<string, Dom_attr_value> = {}
    for (const [attr_name, attr_value] of Object.entries(rest)) {
      if (
        (attr_name === `role` || attr_name.startsWith(`aria-`)) &&
        is_dom_attr_value(attr_value)
      ) {
        attrs[attr_name] = attr_value
      }
    }
    return attrs
  })

  // Compute path mismatch details for strict mode handling
  let strict_path_error = $derived.by((): string | null => {
    if (path_mode !== `strict`) return null
    return common_segment_keys.length === all_segment_keys.length
      ? null
      : `Band structures have different q-point paths. Switch to path_mode="union" or "intersection" to compare non-identical paths.`
  })

  // Determine which segments to plot based on path_mode
  let segments_to_plot = $derived.by(() => {
    if (path_mode === `union`) return new Set(all_segment_keys)
    return new Set(common_segment_keys)
  })

  // Map segments to x-axis positions
  $effect(() => {
    if (Object.keys(band_structs_dict).length === 0 || segments_to_plot.size === 0) {
      x_positions = {}
      return
    }
    const positions: Record<string, [number, number]> = {}
    let current_x = 0

    // Preserve physical path order using the first available structure
    const canonical = Object.values(band_structs_dict)[0]
    if (!canonical) {
      x_positions = {}
      return
    }
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
      const gamma_indices = detected_band_type === `phonon`
        ? helpers.find_gamma_indices(bs)
        : []

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

        // Create series for each band (and spin channel for electronic structures)
        for (let band_idx = 0; band_idx < bs.nb_bands; band_idx++) {
          const frequencies = convert_band_values(
            bs.bands[band_idx].slice(start_idx, end_idx),
          )
          const is_acoustic = helpers.classify_acoustic(bs, band_idx, gamma_indices)
          const acoustic = is_acoustic === true

          const line_style_up = get_line_style(
            color,
            acoustic,
            frequencies,
            band_idx,
          )

          const spin_down_band = bs.spin_down_bands?.[band_idx]
          const has_spin_down_channel = detected_band_type === `electronic` &&
            Array.isArray(spin_down_band) &&
            spin_down_band.length >= end_idx

          if (effective_spin_mode !== `down_only`) {
            all_series.push({
              x: scaled_distances,
              y: frequencies,
              markers: `line`,
              label: has_spin_down_channel
                ? `${structure_label} (↑)`
                : structure_label,
              line_style: line_style_up,
              metadata: helpers.build_point_metadata(
                scaled_distances,
                frequencies,
                band_idx,
                `up`,
                is_acoustic,
                bs,
                start_idx,
              ),
            })
          }

          if (has_spin_down_channel && effective_spin_mode !== `up_only`) {
            const spin_down_frequencies = convert_band_values(
              spin_down_band.slice(start_idx, end_idx),
            )
            all_series.push({
              x: scaled_distances,
              y: spin_down_frequencies,
              markers: `line`,
              label: `${structure_label} (↓)`,
              line_style: {
                ...line_style_up,
                line_dash: `4,2`,
                stroke_width: Math.max(1, line_style_up.stroke_width - 0.1),
              },
              metadata: helpers.build_point_metadata(
                scaled_distances,
                spin_down_frequencies,
                band_idx,
                `down`,
                is_acoustic,
                bs,
                start_idx,
              ),
            })
          }
        }
      }
    }

    return all_series
  })

  // Max absolute slope across all bands, used to normalize dispersion labels
  let max_abs_slope = $derived.by(() => {
    let max_slope = 0
    for (const series of series_data) {
      if (!Array.isArray(series.metadata)) continue
      for (const { slope } of series.metadata as { slope?: number }[]) {
        if (typeof slope === `number` && Number.isFinite(slope)) {
          max_slope = Math.max(max_slope, Math.abs(slope))
        }
      }
    }
    return max_slope || 1
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

          const y_values = convert_band_values(
            bs.bands[band_idx].slice(start_idx, end_idx),
          )

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
    const all_freqs = Object.values(band_structs_dict).flatMap((bs) => [
      ...bs.bands.flat(),
      ...(bs.spin_down_bands?.flat() ?? []),
    ])
    // Keep electronic y-range independent of phonon unit conversion options.
    const display_values = detected_band_type === `phonon`
      ? convert_band_values(all_freqs)
      : all_freqs
    if (!display_values.length) return undefined
    const finite = display_values.filter(Number.isFinite)
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

  // Internal y_axis that ScatterPlot binds to - syncs zoom changes back to parent
  let internal_y_axis = $derived({
    label: detected_band_type === `phonon` ? `Frequency (${units})` : `Energy (eV)`,
    format: `.2f`,
    label_shift: { y: 15 },
    range: y_range,
    ...y_axis,
  })

  // Sync zoom changes from ScatterPlot back to parent via bindable y_axis
  // Also clears parent range when internal range becomes invalid (auto-range reset)
  $effect(() => {
    const range = internal_y_axis.range
    if (helpers.is_valid_range(range)) {
      if (y_axis.range?.[0] !== range[0] || y_axis.range?.[1] !== range[1]) {
        y_axis = { ...y_axis, range }
      }
      return
    }
    // Range became invalid - clear parent's range to propagate reset
    if (`range` in y_axis) {
      const { range: _omit, ...rest } = y_axis
      y_axis = rest
    }
  })

  let has_series = $derived(series_data.length > 0)
  let is_strict_path_error = $derived(path_mode === `strict` && !!strict_path_error)

  let imaginary_mode_region = $derived.by((): FillRegion[] => {
    if (
      detected_band_type !== `phonon` ||
      !shade_imaginary_modes ||
      !y_range ||
      y_range[0] >= 0
    ) return []
    return [{
      lower: y_range[0],
      upper: 0,
      fill: `var(--bands-imaginary-region-color, light-dark(#f8d7da, #5a1a1f))`,
      fill_opacity: 0.2,
      label: `Imaginary modes`,
      show_in_legend: false,
      z_index: `below-lines`,
    }]
  })

  let custom_highlight_regions = $derived.by((): FillRegion[] =>
    (highlight_regions ?? [])
      .filter((region) =>
        Number.isFinite(region.y_min) && Number.isFinite(region.y_max)
      )
      .map((region) => ({
        lower: Math.min(region.y_min, region.y_max),
        upper: Math.max(region.y_min, region.y_max),
        fill: region.color ??
          `var(--bands-highlight-region-color, light-dark(#f6e8c3, #4d3f20))`,
        fill_opacity: region.opacity ?? 0.2,
        label: region.label,
        show_in_legend: Boolean(region.label),
        z_index: `below-lines` as const,
      }))
  )

  let fill_regions = $derived([
    ...imaginary_mode_region,
    ...custom_highlight_regions,
  ])

  let electronic_gap_annotation = $derived.by(() => {
    if (
      !show_gap_annotation ||
      detected_band_type !== `electronic` ||
      effective_fermi_level === undefined
    ) return null
    const all_energies = series_data.flatMap((series_item) =>
      series_item.y.filter(Number.isFinite)
    )
    const occupied = all_energies.filter((energy) => energy <= effective_fermi_level)
    const unoccupied = all_energies.filter((energy) => energy > effective_fermi_level)
    if (!occupied.length || !unoccupied.length) return null
    const vbm = Math.max(...occupied)
    const cbm = Math.min(...unoccupied)
    const gap = cbm - vbm
    if (!(gap > 0)) return null
    return { vbm, cbm, gap }
  })

  let empty_state_message = $derived.by(() => {
    if (is_strict_path_error) {
      return strict_path_error ?? `Path mismatch in strict mode.`
    }
    if (!band_structs || Object.keys(band_structs_dict).length === 0) {
      return `No valid band structure data to display.`
    }
    if (!has_series) {
      return `No plottable band segments were found in the provided data.`
    }
    return `No valid band structure data to display.`
  })

  let display = $state({ x_grid: false, y_grid: true, y_zero_line: true })
</script>
{#if has_series && !is_strict_path_error}
  <ScatterPlot
    {id}
    class={class_name}
    {style}
    data-testid={data_testid}
    series={series_data}
    {fill_regions}
    x_axis={{
      label: `Wave Vector`,
      ticks: Object.keys(x_axis_ticks).length > 0 ? x_axis_ticks : undefined,
      format: ``,
      range: x_range,
      ...x_axis,
    }}
    bind:y_axis={internal_y_axis}
    bind:display
    legend={show_legend && Object.keys(band_structs_dict).length > 1 ? {} : null}
    hover_config={{ threshold_px: 50 }}
    controls={{ show: show_controls }}
    {...rest}
  >
    {#snippet tooltip({ x, y, y_formatted, label, metadata })}
      {@const y_label_full = internal_y_axis.label ?? ``}
      {@const [, y_label, y_unit] = y_label_full.match(/^(.+?)\s*\(([^)]+)\)$/) ??
      [, y_label_full, ``]}
      {@const segment = Object.entries(x_positions ?? {}).find(([, [start, end]]) =>
      x >= start && x <= end
    )}
      {@const path = segment?.[0].split(`_`).map((lbl) =>
      lbl !== `null` ? helpers.pretty_sym_point(lbl) : ``
    ).filter(Boolean).join(` → `) || null}
      {@const band_idx = metadata?.band_idx}
      {@const spin = metadata?.spin}
      {@const is_acoustic = metadata?.is_acoustic}
      {@const nb_bands = metadata?.nb_bands}
      {@const frac_coords = metadata?.frac_coords}
      {@const qpoint_label = metadata?.qpoint_label}
      {@const band_width = metadata?.band_width}
      {@const slope = metadata?.slope}
      {@const num_structs = Object.keys(band_structs_dict).length}
      {#if num_structs > 1 && label}<strong>{label}</strong><br />{/if}
      {y_label || `Value`}: {y_formatted}{y_unit ? ` ${y_unit}` : ``}<br />
      {#if path}Path: {path}<br />{/if}
      {#if typeof band_idx === `number`}
        Band: {band_idx + 1}{#if typeof nb_bands === `number`}&thinsp;/&thinsp;{
            nb_bands
          }{/if}
        {#if typeof is_acoustic === `boolean`}
          ({is_acoustic ? `acoustic` : `optical`})
        {:else if detected_band_type === `electronic` && effective_fermi_level !== undefined}
          ({y <= effective_fermi_level ? `valence` : `conduction`})
        {/if}
        {#if spin === `up` || spin === `down`}
          {spin === `up` ? `↑` : `↓`}
        {/if}
      {/if}
      {#if typeof qpoint_label === `string` && qpoint_label}
        <br />At: {helpers.pretty_sym_point(qpoint_label)}
      {/if}
      {#if Array.isArray(frac_coords)}
        <br />q: [{
          frac_coords.map((coord: number) => format_num(coord, `.3f`)).join(`, `)
        }]
      {/if}
      {#if typeof band_width === `number` && band_width > 0}
        <br />Projection: {format_num(band_width, `.3~g`)}
      {/if}
      {#if typeof slope === `number` && Number.isFinite(slope)}
        {@const rel = Math.abs(slope) / max_abs_slope}
        <br />Dispersion: {rel < 0.15 ? `flat` : rel < 0.5 ? `moderate` : `steep`}
      {/if}
    {/snippet}

    {#snippet controls_extra()}
      {#if show_path_mode_control}
        <SettingsSection
          title="Path Mode"
          current_values={{ path_mode }}
          on_reset={() => (path_mode = `strict`)}
        >
          <div class="pane-row">
            <label for="bands-path-mode">Mode:</label>
            <select id="bands-path-mode" bind:value={path_mode}>
              <option value="strict">strict</option>
              <option value="intersection">intersection</option>
              <option value="union">union</option>
            </select>
          </div>
        </SettingsSection>
      {/if}

      {#if show_units_control && detected_band_type === `phonon`}
        <SettingsSection
          title="Units"
          current_values={{ units }}
          on_reset={() => (units = `THz`)}
        >
          <div class="pane-row">
            <label for="bands-units">Frequency:</label>
            <select id="bands-units" bind:value={units}>
              <option value="THz">THz</option>
              <option value="eV">eV</option>
              <option value="meV">meV</option>
              <option value="cm-1">cm-1</option>
              <option value="Ha">Ha</option>
            </select>
          </div>
        </SettingsSection>
      {/if}

      {#if show_spin_control && detected_band_type === `electronic`}
        <SettingsSection
          title="Spin Display"
          current_values={{ band_spin_mode }}
          on_reset={() => (band_spin_mode = `overlay`)}
        >
          <div class="pane-row">
            <label for="bands-spin-mode">Mode:</label>
            <select id="bands-spin-mode" bind:value={band_spin_mode}>
              <option value="overlay">overlay</option>
              <option value="up_only">up only</option>
              <option value="down_only">down only</option>
            </select>
          </div>
        </SettingsSection>
      {/if}

      {#if show_annotation_controls && detected_band_type === `electronic`}
        <SettingsSection
          title="Annotations"
          current_values={{ show_gap_annotation }}
          on_reset={() => (show_gap_annotation = true)}
        >
          <div class="pane-row pane-checkbox">
            <input
              id="bands-gap-annotation"
              type="checkbox"
              bind:checked={show_gap_annotation}
            />
            <label for="bands-gap-annotation">Show band gap annotation</label>
          </div>
        </SettingsSection>
      {/if}
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
      {@const gap_data_for_ef = electronic_gap_annotation}
      {@const gap_mid_y_ef = gap_data_for_ef
      ? (y_scale_fn(gap_data_for_ef.vbm) + y_scale_fn(gap_data_for_ef.cbm)) / 2
      : NaN}
      {@const ef_needs_offset = Number.isFinite(gap_mid_y_ef) &&
      Number.isFinite(fermi_y) && Math.abs(fermi_y - gap_mid_y_ef) < 16}
      {@const ef_label_y = ef_needs_offset
      ? gap_mid_y_ef + (fermi_y >= gap_mid_y_ef ? 16 : -16)
      : fermi_y}
      {#if Number.isFinite(fermi_y) && Number.isFinite(bands_x_end)}
        <line
          class="fermi-level-line"
          x1={pad.l}
          x2={bands_x_end}
          y1={fermi_y}
          y2={fermi_y}
          stroke="var(--bands-fermi-line-color, light-dark(#e74c3c, #ff6b6b))"
          stroke-width="var(--bands-fermi-line-width, 1.5)"
          stroke-dasharray="var(--bands-fermi-line-dash, 6,3)"
          opacity="var(--bands-fermi-line-opacity, 0.8)"
        />
        {#if ef_needs_offset}
          <line
            x1={bands_x_end}
            y1={fermi_y}
            x2={bands_x_end + 3}
            y2={ef_label_y}
            stroke="var(--bands-fermi-line-color, light-dark(#e74c3c, #ff6b6b))"
            stroke-width="0.7"
            opacity="0.5"
          />
        {/if}
        <text
          class="fermi-level-label"
          x={bands_x_end + 4}
          y={ef_label_y}
          dy="0.35em"
          font-size="10"
          fill="var(--bands-fermi-line-color, light-dark(#e74c3c, #ff6b6b))"
          opacity="0.9"
        >
          E<tspan dy="2" font-size="8">F</tspan>
        </text>
      {/if}

      <!-- Reference frequency horizontal line -->
      {@const ref_freq = reference_frequency !== null && reference_frequency !== undefined
      ? convert_band_values([reference_frequency])[0]
      : NaN}
      {@const ref_y = Number.isFinite(ref_freq) ? y_scale_fn(ref_freq) : NaN}
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

      <!-- Electronic band edge and gap annotation -->
      {@const gap_data = electronic_gap_annotation}
      {@const vbm_y = gap_data ? y_scale_fn(gap_data.vbm) : NaN}
      {@const cbm_y = gap_data ? y_scale_fn(gap_data.cbm) : NaN}
      {#if gap_data && Number.isFinite(vbm_y) && Number.isFinite(cbm_y) &&
      Number.isFinite(bands_x_end)}
        {@const gap_mid_y = (vbm_y + cbm_y) / 2}
        <line
          x1={pad.l}
          x2={bands_x_end}
          y1={vbm_y}
          y2={vbm_y}
          stroke="var(--bands-gap-vbm-color, light-dark(#1f77b4, #7db7ff))"
          stroke-width="var(--bands-gap-line-width, 1)"
          stroke-dasharray="var(--bands-gap-line-dash, 2,2)"
          opacity="0.7"
        />
        <line
          x1={pad.l}
          x2={bands_x_end}
          y1={cbm_y}
          y2={cbm_y}
          stroke="var(--bands-gap-cbm-color, light-dark(#2ca02c, #7ddc7d))"
          stroke-width="var(--bands-gap-line-width, 1)"
          stroke-dasharray="var(--bands-gap-line-dash, 2,2)"
          opacity="0.7"
        />
        <!-- Small ticks at VBM and CBM on the right edge to show E_g range -->
        <line
          x1={bands_x_end}
          x2={bands_x_end + 3}
          y1={vbm_y}
          y2={vbm_y}
          stroke="var(--text-color)"
          stroke-width="1"
          opacity="0.5"
        />
        <line
          x1={bands_x_end}
          x2={bands_x_end + 3}
          y1={cbm_y}
          y2={cbm_y}
          stroke="var(--text-color)"
          stroke-width="1"
          opacity="0.5"
        />
        <text
          x={bands_x_end + 4}
          y={gap_mid_y}
          dy="0.35em"
          font-size="10"
          fill="var(--text-color)"
        >
          E<tspan dy="2" font-size="8">g</tspan>
          <tspan dy="-2">: {Number(gap_data.gap.toPrecision(4))} eV</tspan>
        </text>
      {/if}
    {/snippet}
  </ScatterPlot>
{:else}
  <EmptyState
    {id}
    class={class_name}
    {style}
    data-testid={data_testid}
    {...empty_state_attrs}
    message={empty_state_message}
  />
{/if}

<style>
  .pane-row {
    display: flex;
    align-items: center;
    gap: 0.5em;
    margin: 0.3em 0;
    font-size: 0.9em;
  }
  .pane-row label {
    min-width: 4.5em;
    flex-shrink: 0;
  }
  .pane-row select {
    flex: 1;
    min-width: 0;
  }
  .pane-checkbox {
    gap: 0.4em;
  }
  .pane-checkbox label {
    min-width: 0;
  }
</style>
