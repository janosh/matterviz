<script lang="ts">
  import { BrillouinZonePopup } from '$lib/brillouin'
  import type { BZPopupPoint } from '$lib/brillouin'
  import { plot_color } from '$lib/colors'
  import EmptyState from '$lib/EmptyState.svelte'
  import { format_num } from '$lib/labels'
  import { sanitize_html } from '$lib/sanitize'
  import { to_error } from '$lib/utils'
  import { SettingsSection } from '$lib/layout'
  import { clamp, reciprocal_lattice } from '$lib/math'
  import type { Vec2, Vec3 } from '$lib/math'
  import ScatterPlot from '$lib/plot/scatter/ScatterPlot.svelte'
  import { sync_axis_range } from '$lib/plot/core/shared-axes'
  import type {
    AxisConfig,
    DataSeries,
    FillRegion,
    UserContentProps,
  } from '$lib/plot/core/types'
  import * as helpers from '$lib/spectral/helpers'
  import {
    convert_frequencies,
    frequency_unit_label,
    parse_frequency_unit,
  } from '$lib/spectral/frequency-units'
  import FrequencyUnitSelect from './FrequencyUnitSelect.svelte'
  import type {
    BandLineStyle,
    BandsSpinMode,
    BandStructureType,
    BaseBandStructure,
    Branch,
    FrequencyUnit,
    LineKwargs,
    PathMode,
    QPoint,
    RibbonConfig,
  } from '$lib/spectral/types'
  import type { Crystal } from '$lib/structure'
  import type { ComponentProps } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    band_structs,
    structure = undefined,
    bz_popup_props = {},
    line_kwargs = {},
    path_mode = `strict`,
    band_type = undefined,
    show_legend,
    x_axis = {},
    y_axis = $bindable({}),
    x_positions = $bindable(),
    reference_frequency = null,
    highlighted_qpoint_index = null,
    highlighted_band_index = null,
    ribbon_config = {},
    fermi_level = undefined,
    units = $bindable(`THz`),
    band_spin_mode = $bindable(`overlay`),
    highlight_regions = [],
    shade_imaginary_modes = true,
    show_gap_annotation = true,
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    id = undefined,
    'data-testid': data_testid = undefined,
    point_hit_padding = 3,
    // the padding the plot settled on; BandsAndDos/BrillouinBandsDos align both panels to it
    resolved_padding = $bindable(),
    children: user_children,
    ...rest
  }: ComponentProps<typeof ScatterPlot> & {
    band_structs: BaseBandStructure | Record<string, BaseBandStructure>
    // Symmetry-point tick labels become buttons that pop up a small Brillouin zone marking the
    // clicked point whenever a reciprocal lattice is known: from the band data itself (pymatgen
    // and phonopy inputs carry one) or, overriding it, from this crystal's lattice
    structure?: Crystal
    bz_popup_props?: Partial<ComponentProps<typeof BrillouinZonePopup>>
    x_axis?: AxisConfig
    y_axis?: AxisConfig
    line_kwargs?: LineKwargs
    path_mode?: PathMode
    band_type?: BandStructureType
    show_legend?: boolean
    // Plot x-range of every plotted path segment, keyed by segment key (read-only output)
    x_positions?: Record<string, Vec2>
    reference_frequency?: number | null
    // Q-point index to highlight with a vertical line (synced from BZ k-path hover)
    highlighted_qpoint_index?: number | null
    // Band index to emphasize together with the selected q-point marker
    highlighted_band_index?: number | null
    ribbon_config?: RibbonConfig
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
    id?: string
    'data-testid'?: string
  } = $props()

  const is_per_mode_style = (
    kwargs: LineKwargs,
  ): kwargs is { acoustic?: BandLineStyle; optical?: BandLineStyle } =>
    `acoustic` in kwargs || `optical` in kwargs
  function get_line_style(
    color: string,
    is_acoustic: boolean,
    band_idx: number,
  ): Required<BandLineStyle> {
    const custom: BandLineStyle = is_per_mode_style(line_kwargs)
      ? (line_kwargs[is_acoustic ? `acoustic` : `optical`] ?? {})
      : line_kwargs
    const style = {
      stroke: custom.stroke ?? color,
      stroke_width: custom.stroke_width ?? (is_acoustic ? 1.5 : 1),
    }
    if (highlighted_band_index === null) return style
    const selected = highlighted_band_index === band_idx
    return {
      stroke: selected
        ? `var(--bands-selected-color, light-dark(#185adb, #75a7ff))`
        : `var(--bands-muted-color, light-dark(#b9c2d0, #48566c))`,
      stroke_width: selected
        ? Math.max(3, style.stroke_width * 2)
        : Math.min(1, style.stroke_width),
    }
  }

  interface RibbonData {
    x_values: number[]
    y_values: number[]
    width_values: number[]
    color: string
    opacity: number
    max_width: number
    scale: number
    key: string
  }

  // One structure (empty label) or a dict of them keyed by label
  let raw_structures = $derived(helpers.band_struct_entries(band_structs))

  // Normalized structures in plot order, each with its per-branch segment keys (aligned with
  // bs.branches). Entries whose normalization throws (pymatgen shape missing its reciprocal
  // lattice) are collected as parse errors so the empty state can name the defect instead
  // of a generic message.
  let { structures, parse_errors } = $derived.by(() => {
    const parsed: { label: string; bs: BaseBandStructure; keys: string[] }[] = []
    const errors: string[] = []
    for (const [label, input] of raw_structures) {
      try {
        const bs = helpers.normalize_band_structure(input)
        if (bs) parsed.push({ label, bs, keys: helpers.branch_segment_keys(bs) })
      } catch (error) {
        errors.push(`${label ? `${label}: ` : ``}${to_error(error).message}`)
      }
    }
    return { structures: parsed, parse_errors: errors }
  })
  let num_structures = $derived(structures.length)

  // Same raw-input markers compute_frequency_range reads, so the plot and a shared bands+DOS
  // range agree on which bands are electronic
  let detected_band_type = $derived.by((): BandStructureType => {
    if (band_type) return band_type
    return helpers.is_electronic_band_struct(raw_structures[0]?.[1]) ? `electronic` : `phonon`
  })

  let effective_fermi_level = $derived(
    fermi_level ??
      (detected_band_type === `electronic` ? helpers.extract_efermi(band_structs) : undefined),
  )

  let effective_spin_mode = $derived.by((): BandsSpinMode => {
    if (detected_band_type !== `electronic`) return null
    return band_spin_mode === `up_only` || band_spin_mode === `down_only`
      ? band_spin_mode
      : `overlay`
  })

  // Accept the spellings found in the wild (`cm-1`, `cm⁻¹`) at the prop boundary; every read
  // below uses the canonical unit so no $derived throws on an alias
  let unit = $derived(parse_frequency_unit(units) ?? units)
  const convert_band_values = (values: number[]): number[] =>
    detected_band_type === `phonon` ? convert_frequencies(values, unit) : values

  // Collect all path segments across structures once (shared by strict checks and plotting)
  let all_segments = $derived.by(() => {
    const collected: Record<string, [BaseBandStructure, Branch][]> = {}
    for (const { bs, keys } of structures) {
      for (const [branch_idx, branch] of bs.branches.entries()) {
        ;(collected[keys[branch_idx]] ??= []).push([bs, branch])
      }
    }
    return collected
  })
  let all_segment_keys = $derived(Object.keys(all_segments))
  let common_segment_keys = $derived(
    all_segment_keys.filter((key) => all_segments[key].length === num_structures),
  )
  let strict_path_error = $derived(
    path_mode === `strict` && common_segment_keys.length !== all_segment_keys.length
      ? `Band structures have different q-point paths. Switch to path_mode="union" or "intersection" to compare non-identical paths.`
      : null,
  )
  let segments_to_plot = $derived(
    new Set(path_mode === `union` ? all_segment_keys : common_segment_keys),
  )

  // Map segments to x-axis positions, in the physical path order of the first structure
  // (segments only other structures have, in union mode, follow). Discontinuities sit at the
  // current x without advancing the path.
  let internal_x_positions = $derived.by((): Record<string, Vec2> => {
    const canonical_keys = structures[0]?.keys ?? []
    const ordered = [
      ...canonical_keys.filter((key) => segments_to_plot.has(key)),
      ...[...segments_to_plot].filter((key) => !canonical_keys.includes(key)),
    ]
    const positions: Record<string, Vec2> = {}
    let current_x = 0
    for (const key of ordered) {
      const [bs, branch] = all_segments[key][0]
      const segment_len = helpers.is_discontinuity_branch(branch)
        ? 0
        : bs.distance[branch.end_index] - bs.distance[branch.start_index]
      positions[key] = [current_x, current_x + segment_len]
      current_x += segment_len
    }
    return positions
  })
  // Push the read-only output to the bindable prop; everything below reads the derived
  $effect(() => {
    x_positions = internal_x_positions
  })

  // Band-line series, fat-band ribbons and the max |slope| (for the tooltip's dispersion
  // label) in one pass over the plotted branch segments
  let { series_data, ribbon_data, max_abs_slope } = $derived.by(() => {
    const all_series: DataSeries[] = []
    const all_ribbons: RibbonData[] = []
    let max_slope = 0
    const markers = rest.on_point_click ? `line+points` : `line`

    for (const [bs_idx, { label, bs, keys }] of structures.entries()) {
      const color = plot_color(bs_idx)
      const structure_label = label || `Structure ${bs_idx + 1}`
      const gamma_indices =
        detected_band_type === `phonon` ? helpers.find_gamma_indices(bs) : []
      const ribbon = bs.band_widths?.length
        ? { opacity: 0.3, max_width: 6, scale: 1, ...ribbon_config }
        : null

      for (const [branch_idx, branch] of bs.branches.entries()) {
        const segment_key = keys[branch_idx]
        if (helpers.is_discontinuity_branch(branch) || !segments_to_plot.has(segment_key)) {
          continue
        }
        const start_idx = branch.start_index
        const end_idx = branch.end_index + 1 // exclusive
        const [x_start, x_end] = internal_x_positions[segment_key] ?? [0, 1]
        const x_vals = helpers.scale_segment_distances(
          bs.distance.slice(start_idx, end_idx),
          x_start,
          x_end,
        )

        for (let band_idx = 0; band_idx < bs.nb_bands; band_idx++) {
          const y_up = convert_band_values(bs.bands[band_idx].slice(start_idx, end_idx))
          const is_acoustic = helpers.classify_acoustic(bs, band_idx, gamma_indices)
          const style_up = get_line_style(color, is_acoustic === true, band_idx)
          const spin_down_band = bs.spin_down_bands?.[band_idx]
          const y_down =
            detected_band_type === `electronic` &&
            spin_down_band &&
            spin_down_band.length >= end_idx
              ? convert_band_values(spin_down_band.slice(start_idx, end_idx))
              : null

          // Spin channels to draw: [values, spin, label, line style]
          const channels: [number[], `up` | `down`, string, DataSeries[`line_style`]][] = []
          if (effective_spin_mode !== `down_only`) {
            const label_up = y_down ? `${structure_label} (↑)` : structure_label
            channels.push([y_up, `up`, label_up, style_up])
          }
          if (y_down && effective_spin_mode !== `up_only`) {
            const style_down = {
              ...style_up,
              line_dash: `4,2`,
              stroke_width: Math.max(1, style_up.stroke_width - 0.1),
            }
            channels.push([y_down, `down`, `${structure_label} (↓)`, style_down])
          }
          for (const [y_vals, spin, series_label, line_style] of channels) {
            const metadata = helpers.build_point_metadata({
              x_vals,
              y_vals,
              band_idx,
              spin,
              is_acoustic,
              bs,
              start_idx,
            })
            for (const { slope } of metadata) {
              if (slope !== null && Number.isFinite(slope)) {
                max_slope = Math.max(max_slope, Math.abs(slope))
              }
            }
            all_series.push({
              x: x_vals,
              y: y_vals,
              markers,
              label: series_label,
              line_style,
              metadata,
            })
          }

          const width_values = bs.band_widths?.[band_idx]?.slice(start_idx, end_idx)
          if (ribbon && width_values?.some((width) => width > 0)) {
            all_ribbons.push({
              x_values: x_vals,
              y_values: y_up,
              width_values,
              ...ribbon,
              color: ribbon.color ?? color,
              key: `${structure_label}-${segment_key}-${band_idx}`,
            })
          }
        }
      }
    }
    return { series_data: all_series, ribbon_data: all_ribbons, max_abs_slope: max_slope || 1 }
  })

  // Labeled symmetry points keyed by x position (several meet at one x at a discontinuity),
  // from the first structure plotting each segment
  let sym_points_at_x = $derived.by(() => {
    const points_at: Record<number, { label: string; frac_coords: Vec3 }[]> = {}
    const add_point = (pos: number, qpoint: QPoint | undefined) => {
      if (!qpoint?.label) return
      const label = helpers.pretty_sym_point(qpoint.label)
      points_at[pos] ??= []
      if (!points_at[pos].some((point) => point.label === label)) {
        points_at[pos].push({ label, frac_coords: qpoint.frac_coords })
      }
    }
    for (const [segment_key, [x_start, x_end]] of Object.entries(internal_x_positions)) {
      const [bs, branch] = all_segments[segment_key][0]
      add_point(x_start, bs.qpoints[branch.start_index])
      add_point(x_end, bs.qpoints[branch.end_index])
    }
    return points_at
  })
  // Tick labels; labels meeting at one x are joined with a pipe. Non-breaking spaces keep a
  // discontinuity label (`K | U`) on one line; the axis wraps long tick labels at ordinary
  // spaces when they crowd each other on narrow plots
  let x_axis_ticks = $derived(
    Object.fromEntries(
      Object.entries(sym_points_at_x).map(([pos, points]) => [
        pos,
        points.map(({ label }) => label).join(`\u00A0|\u00A0`),
      ]),
    ),
  )

  // === Brillouin zone popup for a clicked symmetry point ===
  // A passed structure wins; else the reciprocal lattice the band data itself carries
  let k_lattice = $derived(
    structure?.lattice?.matrix
      ? reciprocal_lattice(structure.lattice.matrix, { two_pi: true })
      : (structures[0]?.bs.recip_lattice ?? null),
  )
  // The first structure's k-path (Cartesian), drawn in the popup for context
  let k_path_points = $derived(
    k_lattice && structures[0]
      ? helpers.extract_k_path_points(structures[0].bs, k_lattice)
      : [],
  )
  let k_path_labels = $derived(
    structures[0] ? helpers.k_path_labels(structures[0].bs, k_path_points) : [],
  )
  // x of the clicked symmetry-point tick; the popup is anchored to it through the live x
  // scale, so it follows zoom, resize and fullscreen
  let bz_popup_x = $state<number | null>(null)
  const in_range = (value: number, [lo, hi]: Vec2) =>
    value >= Math.min(lo, hi) && value <= Math.max(lo, hi)
  let bz_popup_points = $derived.by((): BZPopupPoint[] => {
    if (bz_popup_x === null || !k_lattice) return []
    return (sym_points_at_x[bz_popup_x] ?? []).map((point) => ({
      ...point,
      position: helpers.frac_k_to_cartesian(point.frac_coords, k_lattice),
    }))
  })

  let x_range = $derived.by((): Vec2 => {
    const flat = Object.values(internal_x_positions).flat()
    return [flat[0] ?? 0, flat.at(-1) ?? 1]
  })

  // Range in the data's own unit; unit conversion is a positive scale factor, which commutes
  // with extent, the noise clamp and the proportional padding, so a units change converts the
  // two endpoints instead of re-flattening every band
  let raw_y_range = $derived.by((): Vec2 | undefined =>
    helpers.padded_frequency_range(
      structures.flatMap(({ bs }) => [
        ...bs.bands.flat(),
        ...(bs.spin_down_bands?.flat() ?? []),
      ]),
      detected_band_type === `phonon`,
    ),
  )
  let y_range = $derived(raw_y_range && (convert_band_values(raw_y_range) as Vec2))

  // Internal y_axis that ScatterPlot binds to - syncs zoom changes back to parent
  let internal_y_axis = $derived({
    label:
      detected_band_type === `phonon`
        ? `Frequency (${frequency_unit_label(unit)})`
        : `Energy (eV)`,
    format: `.2f`,
    label_shift: { y: 15 },
    range: y_range,
    ...y_axis,
  })

  $effect(() => {
    const next = sync_axis_range(y_axis, internal_y_axis.range, y_range)
    if (next !== y_axis) y_axis = next
  })

  let fill_regions = $derived.by((): FillRegion[] => {
    const regions: FillRegion[] = (highlight_regions ?? [])
      .filter((region) => Number.isFinite(region.y_min) && Number.isFinite(region.y_max))
      .map((region) => ({
        lower: Math.min(region.y_min, region.y_max),
        upper: Math.max(region.y_min, region.y_max),
        fill:
          region.color ?? `var(--bands-highlight-region-color, light-dark(#f6e8c3, #4d3f20))`,
        fill_opacity: region.opacity ?? 0.2,
        label: region.label,
        show_in_legend: Boolean(region.label),
        z_index: `below-lines` as const,
      }))
    if (
      detected_band_type === `phonon` &&
      shade_imaginary_modes &&
      y_range &&
      y_range[0] < 0
    ) {
      regions.unshift({
        lower: y_range[0],
        upper: 0,
        fill: `var(--bands-imaginary-region-color, light-dark(#f8d7da, #5a1a1f))`,
        fill_opacity: 0.2,
        label: `Imaginary modes`,
        show_in_legend: false,
        z_index: `below-lines`,
      })
    }
    return regions
  })

  // Reuse ScatterPlot's selected-point ring instead of maintaining a second marker style path.
  let selected_point = $derived.by(() => {
    if (highlighted_band_index === null || highlighted_qpoint_index === null) return null
    for (const [series_idx, series] of series_data.entries()) {
      if (!Array.isArray(series.metadata)) continue
      const point_idx = series.metadata.findIndex(
        (metadata) =>
          metadata.band_idx === highlighted_band_index &&
          metadata.qpoint_idx === highlighted_qpoint_index,
      )
      if (point_idx !== -1) return { series_idx, point_idx }
    }
    return null
  })

  let electronic_gap_annotation = $derived.by(() => {
    if (
      !show_gap_annotation ||
      detected_band_type !== `electronic` ||
      effective_fermi_level === undefined
    )
      return null
    let vbm = -Infinity
    let cbm = Infinity
    for (const series_item of series_data) {
      for (const energy of series_item.y) {
        if (!Number.isFinite(energy)) continue
        if (energy <= effective_fermi_level) vbm = Math.max(vbm, energy)
        else cbm = Math.min(cbm, energy)
      }
    }
    const gap = cbm - vbm
    return Number.isFinite(gap) && gap > 0 ? { vbm, cbm, gap } : null
  })

  let empty_state_msg = $derived(
    strict_path_error ??
      (num_structures === 0
        ? (parse_errors[0] ?? `No valid band structure data to display.`)
        : `No plottable band segments were found in the provided data.`),
  )
  // Only the generic DOM attributes make sense on the EmptyState div
  let empty_state_attrs = $derived(
    Object.fromEntries(
      Object.entries(rest).filter(
        ([key]) => [`class`, `style`, `role`].includes(key) || key.startsWith(`aria-`),
      ),
    ) as HTMLAttributes<HTMLDivElement>,
  )

  // X-position of the externally hovered q-point (from BZ k-path), for the highlight line
  let highlight_x = $derived.by(() => {
    const bs = structures[0]?.bs
    if (highlighted_qpoint_index == null || !bs) return null
    return helpers.qpoint_x_position(bs, highlighted_qpoint_index, internal_x_positions)
  })

  let display = $state({ x_grid: false, y_grid: true, y_zero_line: true })
</script>

{#if series_data.length > 0 && !strict_path_error}
  <!-- the active (clicked) tick is red like the point it highlights in the BZ popup -->
  <ScatterPlot
    {id}
    data-testid={data_testid}
    series={series_data}
    {point_hit_padding}
    {fill_regions}
    x_axis={{
      label: `Wave Vector`,
      ticks: Object.keys(x_axis_ticks).length > 0 ? x_axis_ticks : undefined,
      format: ``,
      range: x_range,
      on_tick_click: k_lattice ? (tick) => (bz_popup_x = tick) : undefined,
      active_tick: bz_popup_x,
      ...x_axis,
    }}
    bind:y_axis={internal_y_axis}
    bind:display
    {show_legend}
    legend={num_structures > 1 ? {} : null}
    hover_config={{ threshold_px: 50 }}
    {selected_point}
    {...rest}
    style="--tick-active-fill: var(--bands-active-tick-color, #ff2020); {rest.style ?? ``}"
    bind:show_controls
    bind:controls_open
    bind:resolved_padding
    children={frame_children}
  >
    {#snippet tooltip({ x, y, y_formatted, label, metadata })}
      {@const { name: y_label, unit: y_unit } = helpers.parse_axis_label(
        internal_y_axis.label ?? ``,
      )}
      {@const segment = Object.entries(internal_x_positions).find(
        ([, [start, end]]) => x >= start && x <= end,
      )}
      {@const path =
        (segment && !segment[0].startsWith(`branch:`)
          ? segment[0]
              .replace(/#\d+$/, ``)
              .split(`_`)
              .map((lbl) => (lbl !== `null` ? helpers.pretty_sym_point(lbl) : ``))
              .filter(Boolean)
              .join(` → `)
          : ``) || null}
      {@const {
        band_idx,
        spin,
        is_acoustic,
        nb_bands,
        frac_coords,
        qpoint_label,
        band_width,
        slope,
      } = (metadata ?? {}) as Partial<helpers.BandPointMeta>}
      {#if num_structures > 1 && label}<strong>{label}</strong><br />{/if}
      {@html sanitize_html(y_label || `Value`)}: {y_formatted}{y_unit ? ` ${y_unit}` : ``}<br
      />
      {#if path}Path: {path}<br />{/if}
      {#if typeof band_idx === `number`}
        Band: {band_idx + 1}{#if typeof nb_bands === `number`}&thinsp;/&thinsp;{nb_bands}{/if}
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
        <br />{detected_band_type === `electronic` ? `k` : `q`}: [{frac_coords
          .map((coord: number) => format_num(coord, `.3f`))
          .join(`, `)}]
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
      <SettingsSection
        title="Path"
        class="ctrl-line"
        current_values={{
          path_mode,
          ...(detected_band_type === `phonon` ? { units: unit } : {}),
          ...(detected_band_type === `electronic`
            ? { band_spin_mode, show_gap_annotation }
            : {}),
        }}
        on_reset={() => {
          path_mode = `strict`
          if (detected_band_type === `phonon`) units = `THz`
          if (detected_band_type === `electronic`) {
            band_spin_mode = `overlay`
            show_gap_annotation = true
          }
        }}
        layout="flow"
      >
        <label>
          <span>Mode</span>
          <select id="bands-path-mode" bind:value={path_mode}>
            <option value="strict">strict</option>
            <option value="intersection">intersection</option>
            <option value="union">union</option>
          </select>
        </label>
        {#if detected_band_type === `phonon`}
          <FrequencyUnitSelect id="bands-units" bind:units />
        {/if}
        {#if detected_band_type === `electronic`}
          <label>
            <span>Spin</span>
            <select id="bands-spin-mode" bind:value={band_spin_mode}>
              <option value="overlay">overlay</option>
              <option value="up_only">up only</option>
              <option value="down_only">down only</option>
            </select>
          </label>
          <label>
            <input
              id="bands-gap-annotation"
              type="checkbox"
              bind:checked={show_gap_annotation}
            />
            Band gap
          </label>
        {/if}
      </SettingsSection>
    {/snippet}

    {#snippet user_content({ height, width, x_scale_fn, y_scale_fn, pad })}
      <!-- Fat band ribbons (rendered behind band lines) -->
      {#each ribbon_data as ribbon (ribbon.key)}
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
      {#each Object.keys(x_axis_ticks)
        .map((tick) => x_scale_fn(Number(tick)))
        .filter(Number.isFinite) as scaled_x (scaled_x)}
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

      <!-- Hovered q-point vertical line (synced from Brillouin zone k-path hover) -->
      {#if highlight_x != null}
        {@const hover_x = x_scale_fn(highlight_x)}
        {#if Number.isFinite(hover_x)}
          <line
            x1={hover_x}
            x2={hover_x}
            y1={pad.t}
            y2={height - pad.b}
            stroke="var(--bands-hover-line-color, #ff6b35)"
            stroke-width="var(--bands-hover-line-width, 2)"
            opacity="var(--bands-hover-line-opacity, 0.85)"
            pointer-events="none"
          />
        {/if}
      {/if}

      <!-- Shared geometry for Fermi level and gap annotations -->
      {@const fermi_y =
        effective_fermi_level !== undefined ? y_scale_fn(effective_fermi_level) : NaN}
      {@const bands_x_end = x_scale_fn(x_range[1])}
      {@const gap_data = electronic_gap_annotation}
      {@const vbm_y = gap_data ? y_scale_fn(gap_data.vbm) : NaN}
      {@const cbm_y = gap_data ? y_scale_fn(gap_data.cbm) : NaN}
      {@const gap_mid_y = (vbm_y + cbm_y) / 2}
      {@const ef_needs_offset =
        Number.isFinite(gap_mid_y) && Math.abs(fermi_y - gap_mid_y) < 16}
      {@const ef_label_y = ef_needs_offset
        ? gap_mid_y + (fermi_y >= gap_mid_y ? 16 : -16)
        : fermi_y}

      <!-- Fermi level line for electronic bands -->
      <!-- E_F and gap labels sit in the right margin only when the caller padded for it,
           otherwise just inside the plot edge so the SVG does not clip them -->
      {@const ef_label_fits_right = width - bands_x_end >= 20}
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
            x2={bands_x_end + (ef_label_fits_right ? 3 : -3)}
            y2={ef_label_y}
            stroke="var(--bands-fermi-line-color, light-dark(#e74c3c, #ff6b6b))"
            stroke-width="0.7"
            opacity="0.5"
          />
        {/if}
        <text
          class="fermi-level-label"
          x={ef_label_fits_right ? bands_x_end + 4 : bands_x_end - 4}
          y={ef_label_y}
          dy="0.35em"
          text-anchor={ef_label_fits_right ? `start` : `end`}
          font-size="10"
          fill="var(--bands-fermi-line-color, light-dark(#e74c3c, #ff6b6b))"
          opacity="0.9"
        >
          E<tspan dy="2" font-size="8">F</tspan>
        </text>
      {/if}

      <!-- Reference frequency horizontal line -->
      {@const ref_freq =
        reference_frequency != null ? convert_band_values([reference_frequency])[0] : NaN}
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
      {#if gap_data && Number.isFinite(vbm_y) && Number.isFinite(cbm_y) && Number.isFinite(bands_x_end)}
        {#each [[vbm_y, `var(--bands-gap-vbm-color, light-dark(#1f77b4, #7db7ff))`], [cbm_y, `var(--bands-gap-cbm-color, light-dark(#2ca02c, #7ddc7d))`]] as [number, string][] as [edge_y, color] (edge_y)}
          <line
            x1={pad.l}
            x2={bands_x_end + 3}
            y1={edge_y}
            y2={edge_y}
            stroke={color}
            stroke-width="var(--bands-gap-line-width, 1)"
            stroke-dasharray="var(--bands-gap-line-dash, 2,2)"
            opacity="0.7"
          />
        {/each}
        {@const gap_label_fits_right = width - bands_x_end >= 70}
        <text
          x={gap_label_fits_right ? bands_x_end + 4 : bands_x_end - 4}
          y={gap_mid_y}
          dy="0.35em"
          font-size="10"
          text-anchor={gap_label_fits_right ? `start` : `end`}
          fill="var(--text-color)"
        >
          E<tspan dy="2" font-size="8">g:</tspan>
          <tspan dy="-2">{Number(gap_data.gap.toPrecision(4))} eV</tspan>
        </text>
      {/if}
    {/snippet}
  </ScatterPlot>
  {#snippet frame_children(ctx: UserContentProps)}
    {@render user_children?.(ctx)}
    <!-- hidden while zoomed away from its tick -->
    {#if k_lattice && bz_popup_x !== null && bz_popup_points.length > 0 && in_range(bz_popup_x, ctx.x_range)}
      <!-- centered above the tick on the x axis, kept inside the plot; 320 is the popup's default
      width. The bottom arrow tracks the tick even when clamping shifts the popup off-center -->
      {@const tick_x = ctx.x_scale_fn(bz_popup_x)}
      {@const half_width = (bz_popup_props.width ?? 320) / 2}
      {@const left = clamp(tick_x, half_width, ctx.width - half_width)}
      <BrillouinZonePopup
        {k_lattice}
        points={bz_popup_points}
        {k_path_points}
        {k_path_labels}
        place="manual"
        arrow_x={clamp(tick_x - left + half_width, 12, 2 * half_width - 12)}
        {...bz_popup_props}
        style="left: {left}px; top: {ctx.height -
          ctx.pad.b}px; transform: translate(-50%, calc(-100% - 8px)); {bz_popup_props.style ??
          ``}"
        on_close={() => {
          bz_popup_x = null
          bz_popup_props.on_close?.()
        }}
      />
    {/if}
  {/snippet}
{:else}
  <EmptyState
    {id}
    data-testid={data_testid}
    {...empty_state_attrs}
    message={empty_state_msg}
  />
{/if}
