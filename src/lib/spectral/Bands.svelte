<script lang="ts">
  import { is_finite_number } from '#lib/utils.js'
  import SettingsSection from 'svelte-widgets/SettingsSection.svelte'
  import { format_num } from 'svelte-widgets/format'
  import { join_hover_link, TooltipValue } from '#lib/tooltip/index.js'
  import { band_hover_qpoint } from './band-path-link.svelte'
  import { track_settings } from '#lib/controls.js'
  import type { ScatterHandlerProps, ScatterPlotOptions } from '#lib/plot/index.js'
  import type BrillouinZonePopup from '#lib/brillouin/BrillouinZonePopup.svelte'
  import { BZ_POPUP_DEFAULT_WIDTH, type BZPopupPoint } from '#lib/brillouin/types.js'
  import { HIGHLIGHT, is_dark_mode, plot_color, resolve_backdrop } from '#lib/colors/index.js'
  import EmptyState from 'svelte-widgets/EmptyState.svelte'
  import { clamp, html_to_text, to_error } from 'svelte-widgets/utils'
  import StatusMessage from 'svelte-widgets/StatusMessage.svelte'
  import ViewerNotices from '#lib/layout/ViewerNotices.svelte'
  import { array_max, in_range, reciprocal_lattice } from '#lib/math.js'
  import { sanitize_html } from '#lib/sanitize.js'
  import type { Matrix3x3, Vec2, Vec3 } from '#lib/math.js'
  import ScatterPlot from '#lib/plot/scatter/ScatterPlot.svelte'
  import type {
    AxisConfig,
    DataSeries,
    FillRegion,
    UserContentProps,
  } from '#lib/plot/core/types.js'
  import { COLOR_BAR_DEFAULTS } from '#lib/plot/core/types.js'
  import { plot_area_line } from '#lib/plot/core/layout.js'
  import { measure_text_width } from '#lib/plot/core/tick-layout.js'
  import { DEFAULT_FONT_SPEC } from '#lib/plot/core/text-metrics.js'
  import * as helpers from '#lib/spectral/helpers.js'
  import {
    convert_frequencies,
    canonical_frequency_unit,
    spectral_value_label,
  } from '#lib/spectral/frequency-units.js'
  import FrequencyUnitSelect from './FrequencyUnitSelect.svelte'
  import {
    mode_value_markers,
    normalize_mode_values,
    thin_mode_markers,
    project_qpoints_onto_path,
  } from './mode-values'
  import type { ModeValueMarker } from './mode-values'
  import type {
    BandsSpinMode,
    BaseBandStructure,
    Branch,
    FrequencyUnit,
    LineKwargs,
    ModeValues,
    PathMode,
    QPoint,
    RibbonConfig,
  } from '#lib/spectral/types.js'
  import type { Crystal } from '#lib/structure/index.js'
  import type { ComponentProps } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  const GAP_LABEL_FONT = { ...DEFAULT_FONT_SPEC, font_size: 10 } // matches .gap-label

  let {
    band_structs,
    structure,
    bz_popup_props = {},
    line_kwargs = {},
    path_mode = `strict`,
    path_length,
    show_legend,
    x_axis = {},
    y_axis = {},
    x_positions = $bindable(),
    view = $bindable(),
    reference_frequency = null,
    hovered_frequency = $bindable(null),
    highlighted_qpoint_index = null,
    highlighted_qpoint_range = null,
    highlighted_band_index = null,
    link_hover,
    ribbon_config = {},
    fermi_level,
    units = $bindable(`THz`),
    band_spin_mode = $bindable(`overlay`),
    highlight_regions = [],
    shade_imaginary_modes = true,
    show_gap_annotation = true,
    mode_values,
    display = $bindable({ x_grid: false, y_grid: true, y_zero_line: true }),
    show_controls,
    controls_open = $bindable(false),
    // DOM id of the plot's root element.
    id: identifier,
    // Test id set on the plot's root element.
    'data-testid': data_testid,
    point_hit_padding = 3,
    // the padding the plot settled on; BandsAndDos aligns both panels to it
    resolved_padding = $bindable(),
    wrapper = $bindable(),
    children: user_children,
    ...rest
  }: Omit<ScatterPlotOptions, `controls_extra`> & {
    // Keyed by legend label (`""` for an unlabelled series); parse raw input once with
    // normalize_band_structure. hidden_series keys are JSON.stringify([key, 'up' | 'down']),
    // plus `mode-values` for the mode_values markers.
    band_structs: Record<string, BaseBandStructure>
    wrapper?: HTMLDivElement // the plot's root, as ScatterPlot binds it
    // Symmetry-point tick labels become buttons that pop up a small Brillouin zone marking the
    // clicked point whenever a reciprocal lattice is known: from the band data itself (pymatgen
    // and phonopy inputs carry one) or, overriding it, from this crystal's lattice
    structure?: Crystal
    // Size, style and `bz_props` of the Brillouin zone popup opened by clicking a symmetry-point tick, plus an `on_close` callback.
    bz_popup_props?: Pick<
      ComponentProps<typeof BrillouinZonePopup>,
      `width` | `height` | `bz_props` | `style` | `class` | `on_close`
    >
    // Band line style (color, width): one for all bands, `{ acoustic, optical }`, or a function of band index, spin and structure label.
    line_kwargs?: LineKwargs
    // How to compare band structures with different q-point paths: `strict` errors, `union` plots every segment, `intersection` only the shared ones.
    path_mode?: PathMode
    // x length the plotted path spans, its segments keeping their proportions (default: its own
    // reciprocal-space distance). A sweep fixes it, so frames whose cell (and so path length)
    // changes share one x axis instead of rescaling ticks and lines on every frame.
    path_length?: number
    // Plot x-range of every plotted path segment, keyed by segment key (read-only output)
    x_positions?: Record<string, Vec2>
    // Horizontal line in the data unit (THz or eV) whatever `units` displays, like Dos
    reference_frequency?: number | null
    // Hovered band point's frequency/energy in the data unit (THz or eV) like Dos' (read-only)
    hovered_frequency?: number | null
    // Q-point index to highlight with a vertical line (synced from BZ k-path hover)
    highlighted_qpoint_index?: number | null
    // First and last q-point index of a path stretch to shade, e.g. the hovered branch
    highlighted_qpoint_range?: Vec2 | null
    // Band index to emphasize together with the selected q-point marker
    highlighted_band_index?: number | null
    // Channel of an enclosing hover_links() the plot's hover joins by q-point index of the first
    // band structure, e.g. a BrillouinZone's whose k_path it draws: a q-point hovered there
    // marks its line and branch here, and the hovered band point's q-point there
    link_hover?: string
    // Fat-band ribbon style: `color`, `opacity` (default 0.3), `max_width` (half-width in px, default 6) and width `scale`.
    ribbon_config?: RibbonConfig
    fermi_level?: number // electronic reference, zero allowed; omitted uses the data's efermi
    units?: FrequencyUnit // Phonon frequency display units (electronic always eV)
    band_spin_mode?: BandsSpinMode // Electronic spin display: overlay (default), up_only, down_only
    // Shaded horizontal bands as `{ y_min, y_max, color?, opacity?, label? }` in plotted units, e.g. a gap. A label adds a legend entry.
    highlight_regions?: {
      y_min: number
      y_max: number
      color?: string
      opacity?: number
      label?: string
    }[]
    shade_imaginary_modes?: boolean // Shade y<0 region for phonon plots with imaginary modes
    show_gap_annotation?: boolean // Annotate electronic VBM/CBM and gap when available
    // Per-mode values (e.g. λ_qν) drawn as markers at their modes' frequencies, coloured and
    // sized by value with a colour bar titled by their label, wherever their q-points lie on
    // the first band structure's path
    mode_values?: ModeValues
  } = $props()

  // A band line's style: the caller's over the structure colour, emphasised or muted while a
  // band is highlighted. A spin-down line is dashed and a hair thinner than its spin-up twin.
  function get_line_style(color: string, ...line: helpers.BandLine): DataSeries[`line_style`] {
    const [band_idx, spin, is_acoustic] = line
    const custom = helpers.band_line_style(line_kwargs, ...line)
    let stroke = custom.color ?? color
    let width = custom.width ?? (is_acoustic ? 1.5 : 1)
    if (highlighted_band_index !== null) {
      const selected = highlighted_band_index === band_idx
      // a caller-coloured band keeps its colour while emphasised
      stroke = selected
        ? (custom.color ?? `var(--bands-selected-color, light-dark(#185adb, #75a7ff))`)
        : helpers.BANDS_CSS_COLORS.muted
      width = selected ? Math.max(3, width * 2) : Math.min(1, width)
    }
    if (spin === `up`) return { color: stroke, width }
    return { color: stroke, dash: `4,2`, width: Math.max(1, width - 0.1) }
  }

  // Material labels are stable identities; use an empty label for an unnamed dataset.
  const structures = $derived(
    Object.entries(band_structs).map(([label, band_structure]) => ({
      label,
      bs: band_structure,
      keys: helpers.branch_segment_keys(band_structure),
    })),
  )
  const num_structures = $derived(structures.length)
  const band_type = $derived(helpers.spectral_type(band_structs) ?? `phonon`)
  const effective_fermi_level = $derived(fermi_level ?? structures[0]?.bs.efermi)

  // whether any structure has a spin-down channel to select, else the Spin control is hidden
  const has_spin_down = $derived(structures.some(({ bs }) => bs.spin_down_bands?.length))
  let effective_spin_mode = $derived<BandsSpinMode>(
    band_type === `electronic`
      ? helpers.resolve_spin_mode(band_spin_mode, has_spin_down)
      : null,
  )
  // A structure without a spin-down channel holds the same bands for both spins, so a channel
  // selection never hides it (down_only dropped it, legend entry and band gap included)
  const structure_spin_mode = (band_structure: BaseBandStructure): BandsSpinMode =>
    band_structure.spin_down_bands?.length ? effective_spin_mode : null

  // Accept the spellings found in the wild (`cm-1`, `cm⁻¹`) and reject unknown units at the
  // prop boundary; every read below uses the canonical unit
  let unit = $derived(canonical_frequency_unit(units))
  // the value axis' unit: electronic bands are always eV (normalize_band_structure converts)
  const axis_unit = $derived(band_type === `phonon` ? unit : `eV`)
  const convert_band_values = (values: number[]): number[] =>
    band_type === `phonon` ? convert_frequencies(values, unit) : values
  // inverse of convert_band_values for one plotted value
  const to_data_unit = (value: number): number =>
    band_type === `phonon` ? convert_frequencies([value], `THz`, unit)[0] : value

  // Collect all path segments across structures once (shared by strict checks and plotting)
  let all_segments = $derived.by(() => {
    const collected: Record<string, [BaseBandStructure, Branch][]> = {}
    for (const { bs: band_structure, keys } of structures) {
      for (const [branch_idx, branch] of band_structure.branches.entries()) {
        ;(collected[keys[branch_idx]] ??= []).push([band_structure, branch])
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

  // Segment x ranges in the first structure's path order (union-mode segments only others have
  // follow); a jump between branches advances nothing
  let internal_x_positions = $derived.by((): Record<string, Vec2> => {
    const canonical_keys = structures[0]?.keys ?? []
    const ordered = [
      ...canonical_keys.filter((key) => segments_to_plot.has(key)),
      ...[...segments_to_plot].filter((key) => !canonical_keys.includes(key)),
    ]
    const lengths = ordered.map((key) => {
      const [{ distance }, branch] = all_segments[key][0]
      return distance[branch.end_index] - distance[branch.start_index]
    })
    const total = lengths.reduce((sum, len) => sum + len, 0)
    // Each boundary scaled whole (the path ends at exactly path_length) and rounded to 1e-12 of
    // it, so frames whose paths differ only in scale (a sweep's) share tick x and layout
    const place = (raw_x: number): number => {
      if (path_length === undefined || !(total > 0)) return raw_x
      return (Math.round((raw_x / total) * 1e12) / 1e12) * path_length
    }
    const positions: Record<string, Vec2> = {}
    let raw_x = 0
    for (const [idx, key] of ordered.entries()) {
      positions[key] = [place(raw_x), place(raw_x + lengths[idx])]
      raw_x += lengths[idx]
    }
    return positions
  })
  // Push the read-only output to the bindable prop; everything below reads the derived
  $effect(() => {
    x_positions = internal_x_positions
  })

  // One pass over the plotted branches: unstyled band series (with the line their style derives
  // from), fat-band ribbons and per series its structure's max |slope| (the tooltip's dispersion
  // label judges a band against its own structure's steepest)
  let { series_geometry, ribbon_data, slope_scales } = $derived.by(() => {
    const all_series: { series: DataSeries; color: string; line: helpers.BandLine }[] = []
    const all_ribbons = [] // half_widths in pixels
    const scales: number[] = [] // aligned with all_series
    const markers: DataSeries[`markers`] = rest.on_point_click ? `line+points` : `line`
    const { opacity = 0.3, max_width = 6, scale = 1, color: ribbon_color } = ribbon_config

    for (const [bs_idx, { label, bs: band_structure, keys }] of structures.entries()) {
      const first_series = all_series.length
      let max_slope = 0
      const color = plot_color(bs_idx)
      const structure_label = label || `Structure ${bs_idx + 1}`
      const gamma_indices =
        band_type === `phonon` ? helpers.find_gamma_indices(band_structure) : []
      const spin_mode = structure_spin_mode(band_structure)
      // one px-per-width scale per structure so ribbons compare across bands and segments. They
      // widen the spin-up line, so they go when it does
      const width_max = array_max(
        (band_structure.band_widths ?? []).flat().filter(Number.isFinite),
      )
      const show_ribbons = width_max > 0 && spin_mode !== `down_only`
      const px_per_width = show_ribbons ? (max_width * scale) / width_max : 0

      // The plotted branches in x order. Each band (and spin) is one series across them, its
      // line lifting at every branch start: the lines of separate series per branch, but one
      // component, path and hover target per band instead of one per band and branch.
      const branches = band_structure.branches
        .flatMap((branch, branch_idx) => {
          const segment_key = keys[branch_idx]
          const x_range = internal_x_positions[segment_key]
          if (!segments_to_plot.has(segment_key) || !x_range) return []
          const start_idx = branch.start_index
          const end_idx = branch.end_index + 1 // exclusive
          const x_vals = Array.from({ length: end_idx - start_idx }, (_, offset) =>
            helpers.branch_x(band_structure, branch, x_range, start_idx + offset),
          )
          return [{ segment_key, x_start: x_range[0], start_idx, end_idx, x_vals }]
        })
        .toSorted((lhs, rhs) => lhs.x_start - rhs.x_start)

      for (let band_idx = 0; band_idx < band_structure.nb_bands; band_idx++) {
        const is_acoustic = helpers.classify_acoustic(band_structure, band_idx, gamma_indices)
        const spin_down_band =
          band_type === `electronic` ? band_structure.spin_down_bands?.[band_idx] : undefined

        // Spin channels to draw, each with its energies over the whole path
        const channels: [`up` | `down`, number[]][] = []
        if (spin_mode !== `down_only`) channels.push([`up`, band_structure.bands[band_idx]])
        if (spin_down_band && spin_mode !== `up_only`) channels.push([`down`, spin_down_band])
        for (const [spin, values] of channels) {
          const arrow = spin === `up` ? `↑` : `↓`
          const series_label = spin_down_band
            ? `${structure_label} (${arrow})`
            : structure_label
          const [x, y, line_breaks]: number[][] = [[], [], []]
          const metadata: helpers.BandPointMeta[] = []
          for (const { start_idx, end_idx, x_vals } of branches) {
            if (values.length < end_idx) continue // a channel short of this branch
            const y_vals = convert_band_values(values.slice(start_idx, end_idx))
            const point_args = { x_vals, y_vals, band_idx, spin, is_acoustic, start_idx }
            const branch_metadata = helpers.build_point_metadata({
              ...point_args,
              bs: band_structure,
            })
            for (const { slope } of branch_metadata) {
              if (slope !== null && Number.isFinite(slope))
                max_slope = Math.max(max_slope, Math.abs(slope))
            }
            if (x.length > 0) line_breaks.push(x.length)
            for (let idx = 0; idx < x_vals.length; idx++) {
              x.push(x_vals[idx])
              y.push(y_vals[idx])
              metadata.push(branch_metadata[idx])
            }
          }
          if (x.length === 0) continue
          const series = { x, y, line_breaks, markers, label: series_label, metadata }
          const id = JSON.stringify([label, band_idx, spin])
          all_series.push({
            series: { id, legend_id: JSON.stringify([label, spin]), ...series },
            color,
            line: [band_idx, spin, is_acoustic === true, structure_label],
          })
        }
      }
      // fat-band ribbons stay one closed area per branch and band, branch by branch
      for (const { segment_key, start_idx, end_idx, x_vals } of branches) {
        for (let band_idx = 0; band_idx < band_structure.nb_bands; band_idx++) {
          const half_widths = (band_structure.band_widths?.[band_idx] ?? [])
            .slice(start_idx, end_idx)
            .map((width) => (Number.isFinite(width) && width > 0 ? width * px_per_width : 0))
          if (!half_widths.some((half_width) => half_width > 0)) continue
          all_ribbons.push({
            x_values: x_vals,
            y_values: convert_band_values(
              band_structure.bands[band_idx].slice(start_idx, end_idx),
            ),
            half_widths,
            color: ribbon_color ?? color,
            opacity,
            key: `${structure_label}-${segment_key}-${band_idx}`,
          })
        }
      }
      scales.push(...Array(all_series.length - first_series).fill(max_slope || 1))
    }
    return { series_geometry: all_series, ribbon_data: all_ribbons, slope_scales: scales }
  })

  // Each band series with its style. A band hover restyles only the lines it emphasises or mutes:
  // every other series keeps its object (and points), so ScatterPlot sees them unchanged
  const styled_series = new WeakMap<(typeof series_geometry)[number], DataSeries>()
  let series_data = $derived(
    series_geometry.map((entry) => {
      const line_style = get_line_style(entry.color, ...entry.line)
      const prev = styled_series.get(entry)
      if (prev && JSON.stringify(prev.line_style) === JSON.stringify(line_style)) return prev
      const series = { ...entry.series, line_style }
      styled_series.set(entry, series)
      return series
    }),
  )

  // Labeled symmetry points keyed by x position (several meet at one x at a discontinuity),
  // from the first structure plotting each segment, with their q-point index in it
  type SymPoint = {
    label: string
    frac_coords: Vec3
    qpoint_idx: number
    band_structure: BaseBandStructure
  }
  let sym_points_at_x = $derived.by(() => {
    const points_at: Record<number, SymPoint[]> = {}
    const add_point = (pos: number, band_structure: BaseBandStructure, qpoint_idx: number) => {
      const qpoint: QPoint | undefined = band_structure.qpoints[qpoint_idx]
      if (!qpoint?.label) return
      const [label, points] = [helpers.pretty_sym_point(qpoint.label), (points_at[pos] ??= [])]
      if (points.some((point) => point.label === label)) return
      points.push({ label, frac_coords: qpoint.frac_coords, qpoint_idx, band_structure })
    }
    for (const [segment_key, [x_start, x_end]] of Object.entries(internal_x_positions)) {
      const [band_structure, branch] = all_segments[segment_key][0]
      add_point(x_start, band_structure, branch.start_index)
      add_point(x_end, band_structure, branch.end_index)
    }
    return points_at
  })
  // Tick labels, joined by a pipe where several meet at one x, kept on one line (`K | U`) by
  // non-breaking spaces: the axis wraps crowded tick labels at ordinary spaces
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
  let k_path = $derived(
    k_lattice && structures[0] ? helpers.band_k_path(structures[0].bs, k_lattice) : undefined,
  )
  // x of the clicked symmetry-point tick, the popup anchored to it through the live x scale
  let bz_popup_x = $state<number | null>(null)
  // The popup's 3D zone (three.js) is imported on the first tick click, not with every band
  // plot. A failed import (offline, a stale chunk after a deploy) closes it with a notice.
  let ZonePopup = $state.raw<typeof BrillouinZonePopup>()
  let bz_popup_error = $state<string>()
  const open_bz_popup = (tick: number): void => {
    bz_popup_x = tick
    bz_popup_error = undefined
    if (ZonePopup) return
    import(`../brillouin/BrillouinZonePopup.svelte`).then(
      (module) => (ZonePopup = module.default),
      (exc: unknown) => {
        bz_popup_x = null
        bz_popup_error = `Brillouin zone view failed to load: ${to_error(exc).message}`
      },
    )
  }
  // Marked at the drawn path's own point (folded with its branch); a union-mode point only another
  // structure has is folded alone
  let bz_popup_points = $derived.by((): BZPopupPoint[] => {
    if (bz_popup_x === null || !k_lattice) return []
    const lattice = k_lattice
    return (sym_points_at_x[bz_popup_x] ?? []).map(
      ({ label, frac_coords, qpoint_idx, band_structure }) => ({
        label,
        frac_coords,
        position:
          k_path && band_structure === structures[0]?.bs
            ? k_path.points[qpoint_idx]
            : helpers.frac_k_to_cartesian(frac_coords, lattice),
      }),
    )
  })

  // === Mode values (e.g. λ_qν) on the path ===
  // Placed in the first band structure's reciprocal lattice (its q-points' frame), else the
  // structure's. Malformed values or none on the path only drop the markers, with a notice.
  type ModeOverlay = { markers: ModeValueMarker[]; error?: string }
  // Each frame's markers once (a sweep revisits frames; projecting a q mesh is costly), valid
  // for the band structure, lattice and path layout they were placed on
  const mode_overlays = new WeakMap<ModeValues, { deps: unknown[]; overlay: ModeOverlay }>()
  const place_mode_values = (
    values: ModeValues,
    band_structure: BaseBandStructure,
    lattice: Matrix3x3,
    label: string,
  ): ModeOverlay => {
    try {
      const parsed = normalize_mode_values(values)
      const projections = project_qpoints_onto_path(
        band_structure,
        lattice,
        parsed.qpoints,
        internal_x_positions,
      )
      if (parsed.qpoints.length > 0 && projections.length === 0) {
        return {
          markers: [],
          error: `None of the ${parsed.qpoints.length} q-points of ${label} lie on the band path`,
        }
      }
      return { markers: thin_mode_markers(mode_value_markers(parsed, projections), x_range) }
    } catch (exc) {
      return { markers: [], error: `Invalid ${label}: ${to_error(exc).message}` }
    }
  }
  let mode_overlay = $derived.by((): ModeOverlay => {
    const band_structure = structures[0]?.bs
    if (!mode_values || !band_structure) return { markers: [] }
    const label = html_to_text(mode_values.label) // notices are plain text
    const lattice = band_structure.recip_lattice ?? k_lattice
    if (!lattice) {
      return {
        markers: [],
        error: `${label} needs a reciprocal lattice (band data or structure) to place its q-points on the path`,
      }
    }
    const deps = [band_structure, lattice, JSON.stringify(internal_x_positions)]
    const cached = mode_overlays.get(mode_values)
    if (cached?.deps.every((dep, idx) => dep === deps[idx])) return cached.overlay
    const overlay = place_mode_values(mode_values, band_structure, lattice, label)
    mode_overlays.set(mode_values, { deps, overlay })
    return overlay
  })
  // The mode markers' colour bar, one object while its title holds (a new one per sweep frame
  // forces a re-measure). Title beside a 120px (not 220px) bar, so it fits above the bands of
  // short or narrow plots instead of going outside (as one wider than 70% of the plot does).
  const mode_bar_title = $derived(
    mode_overlay.markers.length > 0 && mode_values ? mode_values.label : null,
  )
  const mode_color_bar = $derived(
    mode_bar_title !== null && rest.color_bar !== null
      ? {
          title: mode_bar_title,
          title_side: `left` as const,
          bar_style: `width: 120px; height: ${COLOR_BAR_DEFAULTS.horizontal_bar_height}px`,
          ...rest.color_bar,
        }
      : rest.color_bar,
  )
  // resolved to a concrete colour, which the canvas renderer (past 1000 markers) needs
  const mode_marker_stroke = resolve_backdrop(() => wrapper, {
    css_var: [`--bands-mode-marker-stroke`, `--page-bg`],
    fallback: () => (is_dark_mode(wrapper) ? `#18171c` : `white`),
  })
  // band_idx names the mode for the tooltip; without a qpoint_idx no path link reads it
  let mode_series = $derived.by((): DataSeries | null => {
    const { markers } = mode_overlay
    if (!mode_values || markers.length === 0) return null
    const values = markers.map(({ value }) => value)
    const { label, qpoints, frequencies } = mode_values
    return {
      id: `mode-values`,
      label,
      x: markers.map(({ x }) => x),
      y: convert_band_values(markers.map(({ frequency }) => frequency)),
      markers: `points`,
      color_values: values,
      size_values: values,
      // a hairline in the page's own colour keeps overlapping markers apart in either theme
      point_style: {
        // its own shape, not the next in the series cycle (which moves with the band count)
        symbol_type: `Triangle`,
        stroke: mode_marker_stroke.current,
        stroke_width: 0.5,
        stroke_opacity: 1,
      },
      metadata: markers.map(({ q_idx, mode_idx, value }) => ({
        band_idx: mode_idx,
        nb_bands: frequencies[q_idx].length,
        frac_coords: qpoints[q_idx],
        mode_value: value,
      })),
    }
  })

  let x_range = $derived.by((): Vec2 => {
    const flat = Object.values(internal_x_positions).flat()
    return [flat[0] ?? 0, flat.at(-1) ?? 1]
  })
  // Pinned to the k-path: the auto range would nice() the path end (3.3 -> 3.5) and leave the
  // bands short of the frame
  const internal_x_axis = $derived<AxisConfig>({
    label: `Wave Vector`,
    ticks: Object.keys(x_axis_ticks).length > 0 ? x_axis_ticks : undefined,
    format: ``,
    range: x_range,
    on_tick_click: k_lattice ? open_bz_popup : undefined,
    active_tick: bz_popup_x,
    ...x_axis,
  })

  // Range in the data unit: a units change (a positive scale factor, which commutes with extent,
  // noise clamp and padding) converts the two endpoints instead of re-flattening every band
  let raw_y_range = $derived.by((): Vec2 | undefined => {
    const values = structures.flatMap(({ bs }) => [bs.bands, bs.spin_down_bands ?? []].flat(2))
    return helpers.padded_frequency_range(values, band_type === `phonon`)
  })
  let y_range = $derived(raw_y_range && (convert_band_values(raw_y_range) as Vec2))

  const internal_y_axis = $derived<AxisConfig>({
    label: spectral_value_label(band_type === `phonon`, axis_unit),
    format: `.2f`,
    range: y_range,
    ...y_axis,
  })

  // background shading keeps its color under the pointer: a fill region brightens on hover by
  // default, which lit the whole imaginary half-plane up
  const background = { hover_style: null, z_index: `below-lines`, fill_opacity: 0.2 } as const
  let fill_regions = $derived.by((): FillRegion[] => {
    const regions: FillRegion[] = highlight_regions
      .filter(({ y_min, y_max }) => Number.isFinite(y_min) && Number.isFinite(y_max))
      .map(({ y_min, y_max, color, opacity, label }) => ({
        ...background,
        lower: Math.min(y_min, y_max),
        upper: Math.max(y_min, y_max),
        fill: color ?? `var(--bands-highlight-region-color, light-dark(#f6e8c3, #4d3f20))`,
        fill_opacity: opacity ?? 0.2,
        label,
        show_in_legend: Boolean(label),
      }))
    if (band_type === `phonon` && shade_imaginary_modes && y_range && y_range[0] < 0) {
      regions.unshift({
        ...background,
        lower: y_range[0],
        upper: 0,
        fill: `var(--bands-imaginary-region-color, light-dark(#f8d7da, #5a1a1f))`,
        label: `Imaginary modes`,
        show_in_legend: false,
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

  // The first system's gap (it also supplies the default E_F), over the displayed spin channels.
  // Malformed occupations only drop the annotation, with a notice over the still-drawn bands.
  let gap_result = $derived.by(() => {
    const band_structure = structures[0]?.bs
    if (!show_gap_annotation || band_type !== `electronic` || !band_structure)
      return { gap: null }
    const { bands, spin_down_bands, occupations, spin_down_occupations } = band_structure
    const spin_mode = structure_spin_mode(band_structure)
    // Occupations decide filling when given, so a missing spin-down set is an error (an empty
    // one fails electronic_band_gap's shape check), never a silent fall back to E_F
    const up_filling = occupations ?? effective_fermi_level
    const down_filling = occupations ? (spin_down_occupations ?? []) : effective_fermi_level
    if (up_filling === undefined || down_filling === undefined) return { gap: null }
    const show_down = spin_down_bands && spin_mode !== null && spin_mode !== `up_only`
    const down = show_down ? { bands: spin_down_bands, filling: down_filling } : undefined
    // down_only passes an empty spin-up channel so the edges still say `down`
    const show_up = !down || spin_mode !== `down_only`
    try {
      return {
        gap: helpers.electronic_band_gap(
          show_up ? bands : [],
          show_up ? up_filling : [],
          down,
        ),
      }
    } catch (exc) {
      return { gap: null, error: `Invalid band occupations: ${to_error(exc).message}` }
    }
  })
  let empty_state_msg = $derived(
    strict_path_error ??
      (num_structures === 0
        ? `No band structure data to display.`
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

  // X-position of a q-point index on the first structure's plotted path
  const qpoint_x = (qpoint_idx: number | null): number | null => {
    const band_structure = structures[0]?.bs
    if (qpoint_idx == null || !band_structure) return null
    return helpers.qpoint_x_position(band_structure, qpoint_idx, internal_x_positions)
  }
  const qpoint_link = join_hover_link(() => link_hover, `number`)
  const linked_range = $derived.by((): Vec2 | null => {
    const [qpoint_idx, band_structure] = [qpoint_link.linked, structures[0]?.bs]
    return qpoint_idx === null || !band_structure
      ? null
      : helpers.branch_qpoint_range(band_structure, qpoint_idx)
  })
  // externally hovered q-point (from BZ k-path), for the highlight line
  let highlight_x = $derived(qpoint_x(highlighted_qpoint_index ?? qpoint_link.linked))
  // x-span of the highlighted path stretch, null unless both ends are plotted
  let highlight_x_range = $derived.by((): Vec2 | null => {
    const range = highlighted_qpoint_range ?? linked_range
    if (!range) return null
    const [x_start, x_end] = range.map(qpoint_x)
    return x_start === null || x_end === null ? null : [x_start, x_end]
  })

  // A bound view outlives the plot in the host (e.g. BandsAndDos sync state) and ScatterPlot
  // honors a view passed at mount, so drop it with the plot or a remount restores the old range
  const show_plot = $derived(series_data.length > 0 && !strict_path_error)
  $effect(() => {
    if (!show_plot) return
    return () => {
      view = undefined
    }
  })

  const path_settings = track_settings(
    () => ({
      path_mode,
      ...(band_type === `phonon`
        ? { units: unit }
        : { ...(has_spin_down && { band_spin_mode }), show_gap_annotation }),
    }),
    {
      path_mode: `strict`,
      units: `THz`,
      band_spin_mode: `overlay`,
      show_gap_annotation: true,
    },
  )
</script>

{#if show_plot}
  {#snippet bands_tooltip({
    x: coord_x,
    y: coord_y,
    y_formatted,
    label,
    metadata,
    series_idx,
  }: ScatterHandlerProps)}
    {@const segment_key = Object.entries(internal_x_positions).find(
      ([, [start, end]]) => coord_x >= start && coord_x <= end,
    )?.[0]}
    {@const path = segment_key
      ? helpers.branch_path_label(...all_segments[segment_key][0])
      : null}
    {@const {
      band_idx,
      spin,
      is_acoustic,
      nb_bands,
      frac_coords,
      qpoint_label,
      band_width,
      slope,
      mode_value,
    } = (metadata ?? {}) as Partial<helpers.BandPointMeta & { mode_value: number }>}
    {#if num_structures > 1 && label}<strong>{@html sanitize_html(label)}</strong><br />{/if}
    <TooltipValue
      label={internal_y_axis.label || spectral_value_label(band_type === `phonon`, axis_unit)}
      value={y_formatted}
      unit={internal_y_axis.unit}
    /><br />
    {#if path}Path: {path}<br />{/if}
    {#if typeof band_idx === `number`}
      Band: {band_idx + 1}{#if typeof nb_bands === `number`}&thinsp;/&thinsp;{nb_bands}{/if}
      {#if typeof is_acoustic === `boolean`}
        ({is_acoustic ? `acoustic` : `optical`})
      {:else if band_type === `electronic` && effective_fermi_level !== undefined}
        ({coord_y <= effective_fermi_level ? `valence` : `conduction`})
      {/if}
      {#if spin === `up` || spin === `down`}
        {spin === `up` ? `↑` : `↓`}
      {/if}
    {/if}
    {#if typeof qpoint_label === `string` && qpoint_label}
      <br />At: {helpers.pretty_sym_point(qpoint_label)}
    {/if}
    {#if Array.isArray(frac_coords)}
      <br />{band_type === `electronic` ? `k` : `q`}: [{frac_coords
        .map((coord: number) => format_num(coord, `.3f`))
        .join(`, `)}]
    {/if}
    {#if typeof mode_value === `number` && mode_values}
      <br /><TooltipValue label={mode_values.label} value={format_num(mode_value, `.3~g`)} />
    {/if}
    {#if typeof band_width === `number` && band_width > 0}
      <br />Projection: {format_num(band_width, `.3~g`)}
    {/if}
    {#if is_finite_number(slope)}
      {@const rel = Math.abs(slope) / (slope_scales[series_idx] ?? 1)}
      <br />Dispersion: {rel < 0.15 ? `flat` : rel < 0.5 ? `moderate` : `steep`}
    {/if}
  {/snippet}

  <!-- the active (clicked) tick is red like the point it highlights in the BZ popup -->
  <ScatterPlot
    {...rest}
    tooltip={rest.tooltip ?? bands_tooltip}
    id={identifier}
    data-testid={data_testid}
    series={mode_series ? [...series_data, mode_series] : series_data}
    color_bar={mode_color_bar}
    size_legend={rest.size_legend ?? null}
    point_tween={rest.point_tween ?? (mode_series ? { duration: 0 } : undefined)}
    marker_renderer={rest.marker_renderer ?? (mode_series ? `canvas` : `auto`)}
    {point_hit_padding}
    {fill_regions}
    bind:wrapper
    x_axis={internal_x_axis}
    y_axis={internal_y_axis}
    bind:view
    bind:display
    {show_legend}
    legend={rest.legend === undefined ? (num_structures > 1 ? {} : null) : rest.legend}
    hover_config={{ threshold_px: 50, click_threshold_px: 10, ...rest.hover_config }}
    {selected_point}
    style={`--tick-active-fill: var(--bands-active-tick-color, ${HIGHLIGHT.pin}); ${rest.style ?? ``}`}
    {show_controls}
    bind:controls_open
    bind:resolved_padding
    on_point_hover={(event) => {
      const point_y = event?.point?.y
      hovered_frequency = point_y == null ? null : to_data_unit(point_y)
      const band_structure = structures[0]?.bs
      qpoint_link.publish(
        event && band_structure
          ? band_hover_qpoint(band_structure, event, internal_x_positions)
          : null,
      )
      rest.on_point_hover?.(event)
    }}
    children={frame_children}
  >
    {#snippet controls_extra()}
      <SettingsSection
        title="Path"
        class="ctrl-line"
        changed_keys={path_settings.changed_keys}
        on_reset={() => {
          path_mode = `strict`
          if (band_type === `phonon`) units = `THz`
          else {
            if (has_spin_down) band_spin_mode = `overlay`
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
        {#if band_type === `phonon`}
          <FrequencyUnitSelect id="bands-units" bind:units />
        {:else}
          {#if has_spin_down}
            <label>
              <span>Spin</span>
              <select id="bands-spin-mode" bind:value={band_spin_mode}>
                <option value="overlay">overlay</option>
                <option value="up_only">up only</option>
                <option value="down_only">down only</option>
              </select>
            </label>
          {/if}
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

    {#snippet user_content(ctx)}
      {@const { height, width, x_scale_fn, y_scale_fn, pad } = ctx}
      <!-- Fat band ribbons (rendered behind band lines) -->
      {#each ribbon_data as ribbon (ribbon.key)}
        {@const path_d = helpers.generate_ribbon_path(
          ribbon.x_values,
          ribbon.y_values,
          ribbon.half_widths,
          x_scale_fn,
          y_scale_fn,
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
          {...plot_area_line(scaled_x, false, ctx)}
          stroke="var(--bands-symmetry-line-color, light-dark(black, white))"
          stroke-width="var(--bands-symmetry-line-width, 1)"
          opacity="var(--bands-symmetry-line-opacity, 0.5)"
        />
      {/each}

      <!-- Highlighted path stretch, e.g. the branch hovered here or in the Brillouin zone -->
      {#if highlight_x_range}
        {@const [x_start, x_end] = highlight_x_range.map(x_scale_fn)}
        <rect
          class="highlighted-segment"
          x={Math.min(x_start, x_end)}
          y={pad.t}
          width={Math.abs(x_end - x_start)}
          height={Math.max(0, height - pad.t - pad.b)}
          fill="var(--bands-segment-highlight-color, #ff9a3c)"
          opacity="var(--bands-segment-highlight-opacity, 0.1)"
          pointer-events="none"
        />
      {/if}

      <!-- Hovered q-point vertical line (synced from Brillouin zone k-path hover) -->
      {#if highlight_x != null}
        {@const hover_x = x_scale_fn(highlight_x)}
        {#if Number.isFinite(hover_x)}
          <line
            {...plot_area_line(hover_x, false, ctx)}
            class="hovered-qpoint-line"
            stroke="var(--bands-hover-line-color, #ff6b35)"
            stroke-width="var(--bands-hover-line-width, 2)"
            stroke-dasharray="var(--bands-hover-line-dash, 5,3)"
            opacity="var(--bands-hover-line-opacity, 0.85)"
            pointer-events="none"
          />
        {/if}
      {/if}

      <!-- Shared geometry for Fermi level and gap annotations -->
      {@const fermi_y =
        effective_fermi_level !== undefined ? y_scale_fn(effective_fermi_level) : NaN}
      {@const bands_x_end = x_scale_fn(x_range[1])}
      {@const gap_data = gap_result.gap}
      {@const vbm_y = gap_data ? y_scale_fn(gap_data.vbm.energy) : NaN}
      {@const cbm_y = gap_data ? y_scale_fn(gap_data.cbm.energy) : NaN}
      {@const gap_mid_y = (vbm_y + cbm_y) / 2}
      {@const ef_needs_offset =
        Number.isFinite(gap_mid_y) && Math.abs(fermi_y - gap_mid_y) < 16}
      {@const ef_label_y = ef_needs_offset
        ? gap_mid_y + (fermi_y >= gap_mid_y ? 16 : -16)
        : fermi_y}

      <!-- Fermi level line. E_F and gap labels sit in the right margin only when the caller
           padded for it, else just inside the plot edge so the SVG does not clip them -->
      {@const ef_label_fits_right = width - bands_x_end >= 20}
      {#if Number.isFinite(fermi_y) && Number.isFinite(bands_x_end)}
        <line
          class="fermi-level-line"
          {...plot_area_line(fermi_y, true, ctx)}
          x2={bands_x_end}
          stroke={helpers.BANDS_CSS_COLORS.fermi}
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
            stroke={helpers.BANDS_CSS_COLORS.fermi}
            stroke-width="0.7"
            opacity="0.5"
          />
        {/if}
        <text
          x={ef_label_fits_right ? bands_x_end + 4 : bands_x_end - 4}
          y={ef_label_y}
          dy="0.35em"
          text-anchor={ef_label_fits_right ? `start` : `end`}
          font-size="10"
          fill={helpers.BANDS_CSS_COLORS.fermi}
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
          {...plot_area_line(ref_y, true, ctx)}
          x2={bands_x_end}
          stroke={helpers.BANDS_CSS_COLORS.reference}
          stroke-width="var(--bands-reference-line-width, 1)"
          stroke-dasharray="var(--bands-reference-line-dash, 4,3)"
          opacity="var(--bands-reference-line-opacity, 0.5)"
        />
      {/if}

      <!-- Electronic band edge and gap annotation -->
      {#if gap_data && Number.isFinite(vbm_y) && Number.isFinite(cbm_y) && Number.isFinite(bands_x_end)}
        <!-- VBM and CBM on the path (unless off the plotted path), joined by the transition -->
        {@const [vbm_x, cbm_x] = [gap_data.vbm, gap_data.cbm].map(({ qpoint_idx }) => {
          const data_x = qpoint_x(qpoint_idx)
          return data_x === null ? NaN : x_scale_fn(data_x)
        })}
        {#if Number.isFinite(vbm_x) && Number.isFinite(cbm_x)}
          <line
            class="gap-transition"
            x1={vbm_x}
            y1={vbm_y}
            x2={cbm_x}
            y2={cbm_y}
            stroke="var(--bands-gap-transition-color, var(--text-color))"
            stroke-width="var(--bands-gap-transition-width, 1)"
            opacity="0.6"
            pointer-events="none"
          />
        {/if}
        {#each [[`VBM`, gap_data.vbm, vbm_y, vbm_x, `var(--bands-gap-vbm-color, light-dark(#1f77b4, #7db7ff))`], [`CBM`, gap_data.cbm, cbm_y, cbm_x, `var(--bands-gap-cbm-color, light-dark(#2ca02c, #7ddc7d))`]] as const as [name, edge, edge_y, edge_x, color] (name)}
          <line
            {...plot_area_line(edge_y, true, ctx)}
            x2={bands_x_end + 3}
            stroke={color}
            stroke-width="var(--bands-gap-line-width, 1)"
            stroke-dasharray="var(--bands-gap-line-dash, 2,2)"
            opacity="0.7"
          />
          {#if Number.isFinite(edge_x)}
            <circle
              class="band-edge {name.toLowerCase()}"
              cx={edge_x}
              cy={edge_y}
              r="4"
              fill={color}
              stroke="var(--bands-gap-marker-stroke, light-dark(white, black))"
              stroke-width="1"
            >
              <title>
                {`${name} ${format_num(edge.energy, `.4~f`)} eV, band ${edge.band_idx + 1}${edge.spin ? ` (spin ${edge.spin})` : ``}`}
              </title>
            </circle>
          {/if}
        {/each}
        {@const gap_value = Number(gap_data.gap.toPrecision(4))}
        {@const gap_kind = gap_data.is_direct ? `direct` : `indirect`}
        {@const label_px = measure_text_width(
          `Eg: ${gap_value} eV (${gap_kind})`,
          GAP_LABEL_FONT,
        )}
        {@const gap_label_fits_right = width - bands_x_end >= label_px + 4}
        {@const gap_label_x = gap_label_fits_right ? bands_x_end + 4 : bands_x_end - 4}
        <text
          class="gap-label"
          x={gap_label_x}
          y={gap_mid_y}
          dy="0.35em"
          font-size="10"
          text-anchor={gap_label_fits_right ? `start` : `end`}
          fill="var(--text-color)"
        >
          E<tspan dy="2" font-size="8">g:</tspan>
          <tspan dy="-2">{gap_value} eV</tspan>
          <tspan class="gap-kind" opacity="0.8">({gap_kind})</tspan>
        </text>
      {/if}
    {/snippet}
  </ScatterPlot>
  {#snippet frame_children(ctx: UserContentProps)}
    {@render user_children?.(ctx)}
    <ViewerNotices>
      <StatusMessage message={gap_result.error} type="warning" class="gap-error" />
      <StatusMessage message={bz_popup_error} type="warning" class="bz-popup-error" />
      <StatusMessage message={mode_overlay.error} type="warning" class="mode-values-error" />
    </ViewerNotices>
    <!-- hidden while zoomed away from its tick -->
    {#if ZonePopup && k_lattice && bz_popup_x !== null && bz_popup_points.length > 0 && in_range(bz_popup_x, ctx.x_range)}
      <!-- centered above the tick on the x axis, kept inside the plot (centered on a narrower
      plot); its bottom arrow tracks the tick when clamping shifts it off-center -->
      {@const tick_x = ctx.x_scale_fn(bz_popup_x)}
      {@const half_width = (bz_popup_props.width ?? BZ_POPUP_DEFAULT_WIDTH) / 2}
      {@const left =
        ctx.width < 2 * half_width
          ? ctx.width / 2
          : clamp(tick_x, half_width, ctx.width - half_width)}
      {@const top = ctx.height - ctx.pad.b}
      <ZonePopup
        {...bz_popup_props}
        {k_lattice}
        points={bz_popup_points}
        {k_path}
        place="manual"
        arrow_x={clamp(tick_x - left + half_width, 12, 2 * half_width - 12)}
        style="left: {left}px; top: {top}px; transform: translate(-50%, calc(-100% - 8px)); {bz_popup_props.style ??
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
    id={identifier}
    data-testid={data_testid}
    {...empty_state_attrs}
    message={empty_state_msg}
  />
{/if}
