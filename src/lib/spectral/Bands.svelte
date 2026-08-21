<script lang="ts">
  import { PLOT_COLORS } from '$lib/colors'
  import EmptyState from '$lib/EmptyState.svelte'
  import { format_num } from '$lib/labels'
  import { sanitize_html } from '$lib/sanitize'
  import { is_plain_object } from '$lib/utils'
  import { SettingsSection } from '$lib/layout'
  import type { Vec2 } from '$lib/math'
  import ScatterPlot from '$lib/plot/scatter/ScatterPlot.svelte'
  import { sync_axis_range } from '$lib/plot/core/shared-axes'
  import type { AxisConfig, DataSeries, FillRegion } from '$lib/plot/core/types'
  import * as helpers from '$lib/spectral/helpers'
  import type {
    BandsSpinMode,
    BandStructureType,
    BaseBandStructure,
    Branch,
    FrequencyUnit,
    LineKwargs,
    PathMode,
    RibbonConfig,
  } from '$lib/spectral/types'
  import type { ComponentProps } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    band_structs,
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
    ...rest
  }: ComponentProps<typeof ScatterPlot> & {
    band_structs: BaseBandStructure | Record<string, BaseBandStructure>
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
    id?: string
    'data-testid'?: string
  } = $props()

  type LineStyle = { stroke: string; stroke_width: number }

  function get_line_style(
    color: string,
    is_acoustic: boolean,
    frequencies: number[],
    band_idx: number,
  ): LineStyle {
    let custom: Record<string, unknown> = {}
    if (typeof line_kwargs === `function`) custom = line_kwargs(frequencies, band_idx)
    else if (is_plain_object(line_kwargs)) {
      const mode_kwargs = line_kwargs[is_acoustic ? `acoustic` : `optical`]
      custom = is_plain_object(mode_kwargs) ? mode_kwargs : line_kwargs
    }
    const style = {
      stroke: (custom.stroke as string) ?? color,
      stroke_width: (custom.stroke_width as number) ?? (is_acoustic ? 1.5 : 1),
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

  // Normalized structures in plot order, each with its per-branch segment keys (aligned with
  // bs.branches). A single structure is recognised by its marker fields (matterviz: qpoints +
  // branches; pymatgen: @class/@module with qpoints/kpoints + bands).
  let structures = $derived.by(() => {
    if (!band_structs) return []
    const raw = band_structs as Record<string, unknown>
    const has_points = [raw.qpoints, raw.kpoints].some(
      (points) => Array.isArray(points) && points.length > 0,
    )
    const is_pymatgen = `@class` in raw || `@module` in raw
    const is_single =
      (!is_pymatgen && has_points && `branches` in raw) ||
      (is_pymatgen && has_points && (`bands` in raw || Array.isArray(raw.frequencies_cm)))
    const entries: [string, unknown][] = is_single ? [[`default`, raw]] : Object.entries(raw)
    return entries.flatMap(([label, input]) => {
      const bs = helpers.normalize_band_structure(input)
      return bs ? [{ label, bs, keys: helpers.branch_segment_keys(bs) }] : []
    })
  })
  let num_structures = $derived(structures.length)

  // Auto-detect band type if not explicitly set
  let detected_band_type = $derived.by((): BandStructureType => {
    if (band_type) return band_type
    if (!band_structs) return `phonon`

    // Single structure has marker fields; dict of structures has label keys
    const is_single = [`@class`, `@module`, `kpoints`, `qpoints`].some(
      (key) => key in band_structs,
    )
    const source = (is_single ? band_structs : Object.values(band_structs)[0]) as
      | Record<string, unknown>
      | undefined
    if (!source) return `phonon`

    // Electronic: has kpoints, BandStructure* class (not Phonon*), or electronic_structure module
    const py_class_name = String(source[`@class`] ?? ``)
    if (
      (Array.isArray(source.kpoints) && source.kpoints.length > 0) ||
      (py_class_name.startsWith(`BandStructure`) && !py_class_name.startsWith(`Phonon`)) ||
      String(source[`@module`] ?? ``).includes(`electronic_structure`)
    )
      return `electronic`

    return `phonon`
  })

  // Auto-detect Fermi level from electronic band structure data if not explicitly provided
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

  const convert_band_values = (values: number[]): number[] =>
    detected_band_type === `phonon` ? helpers.convert_frequencies(values, units) : values

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
      const color = PLOT_COLORS[bs_idx % PLOT_COLORS.length]
      const structure_label = label || `Structure ${bs_idx + 1}`
      const gamma_indices =
        detected_band_type === `phonon` ? helpers.find_gamma_indices(bs) : []
      const ribbon = bs.band_widths?.length
        ? helpers.get_ribbon_config(ribbon_config, label)
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
          const style_up = get_line_style(color, is_acoustic === true, y_up, band_idx)
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

  // Symmetry-point tick labels keyed by x position; labels meeting at one x (discontinuities)
  // are joined with a pipe
  let x_axis_ticks = $derived.by(() => {
    const labels_at: Record<number, string[]> = {}
    const add_label = (pos: number, label: string | null | undefined) => {
      if (!label) return
      const pretty = helpers.pretty_sym_point(label)
      const labels = (labels_at[pos] ??= [])
      if (!labels.includes(pretty)) labels.push(pretty)
    }
    for (const [segment_key, [x_start, x_end]] of Object.entries(internal_x_positions)) {
      const [bs, branch] = all_segments[segment_key][0]
      add_label(x_start, bs.qpoints[branch.start_index]?.label)
      add_label(x_end, bs.qpoints[branch.end_index]?.label)
    }
    return Object.fromEntries(
      Object.entries(labels_at).map(([pos, labels]) => [pos, labels.join(` | `)]),
    )
  })

  let x_range = $derived.by((): Vec2 => {
    const flat = Object.values(internal_x_positions).flat()
    return [flat[0] ?? 0, flat.at(-1) ?? 1]
  })

  // Calculate y-range, enforcing 0 minimum for phonon bands without imaginary modes
  let y_range = $derived.by((): Vec2 | undefined => {
    const all_values = structures.flatMap(({ bs }) => [
      ...bs.bands.flat(),
      ...(bs.spin_down_bands?.flat() ?? []),
    ])
    const finite = convert_band_values(all_values).filter(Number.isFinite)
    if (finite.length === 0) return undefined
    let min_val = Infinity
    let max_val = -Infinity
    for (const val of finite) {
      if (val < min_val) min_val = val
      if (val > max_val) max_val = val
    }
    if (
      // clamp phonon min to 0 if negatives are noise
      detected_band_type === `phonon` &&
      min_val < 0 &&
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
    const next = sync_axis_range(y_axis, internal_y_axis.range)
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
        ? `No valid band structure data to display.`
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
      ...x_axis,
    }}
    bind:y_axis={internal_y_axis}
    bind:display
    {show_legend}
    legend={num_structures > 1 ? {} : null}
    hover_config={{ threshold_px: 50 }}
    {selected_point}
    {...rest}
    bind:show_controls
    bind:controls_open
  >
    {#snippet tooltip({ x, y, y_formatted, label, metadata })}
      {@const y_label_full = internal_y_axis.label ?? ``}
      {@const [, y_label, y_unit] = y_label_full.match(/^(.+?)\s*\(([^)]+)\)$/) ?? [
        ,
        y_label_full,
        ``,
      ]}
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

      {#if detected_band_type === `phonon`}
        <SettingsSection
          title="Units"
          current_values={{ units }}
          on_reset={() => (units = `THz`)}
        >
          <div class="pane-row">
            <label for="bands-units">Frequency:</label>
            <select id="bands-units" bind:value={units}>
              {#each helpers.FREQUENCY_UNITS as unit (unit)}
                <option value={unit}>{unit}</option>
              {/each}
            </select>
          </div>
        </SettingsSection>
      {/if}

      {#if detected_band_type === `electronic`}
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
        <text
          x={bands_x_end + 4}
          y={gap_mid_y}
          dy="0.35em"
          font-size="10"
          fill="var(--text-color)"
        >
          E<tspan dy="2" font-size="8">g:</tspan>
          <tspan dy="-2">{Number(gap_data.gap.toPrecision(4))} eV</tspan>
        </text>
      {/if}
    {/snippet}
  </ScatterPlot>
{:else}
  <EmptyState
    {id}
    data-testid={data_testid}
    {...empty_state_attrs}
    message={empty_state_msg}
  />
{/if}

<style>
  .pane-row {
    display: flex;
    align-items: center;
    gap: 0.5em;
    margin: 0.3em 0;
    font-size: 0.9em;
    label {
      min-width: 4.5em;
      flex-shrink: 0;
    }
    select {
      flex: 1;
      min-width: 0;
    }
  }
  .pane-checkbox {
    gap: 0.4em;
    label {
      min-width: 0;
    }
  }
</style>
