<script lang="ts">
  import { plot_color } from '$lib/colors'
  import EmptyState from '$lib/EmptyState.svelte'
  import { format_num } from '$lib/labels'
  import { SettingsSection } from '$lib/layout'
  import type { Vec2 } from '$lib/math'
  import ScatterPlot from '$lib/plot/scatter/ScatterPlot.svelte'
  import { accumulate_extent, empty_extent } from '$lib/plot/core/scales'
  import type { AxisConfig, DataSeries } from '$lib/plot/core/types'
  import { extent } from 'd3-array'
  import type { ComponentProps } from 'svelte'
  import { tooltip as attach_tooltip } from 'svelte-widgets/attachments'
  import {
    apply_gaussian_smearing,
    calculate_sigma_step,
    closed_edge_path,
    dos_entries,
    extract_efermi,
    extract_pdos,
    format_dos_tooltip,
    IMAGINARY_MODE_NOISE_THRESHOLD,
    negative_fraction,
    NORMALIZATION_MODES,
    normalize_densities,
    normalize_dos,
    SPIN_MODES,
    validate_sigma_range,
  } from './helpers'
  import {
    convert_frequencies,
    frequency_unit_label,
    parse_frequency_unit,
  } from './frequency-units'
  import FrequencyUnitSelect from './FrequencyUnitSelect.svelte'
  import type {
    DosData,
    DosInput,
    FrequencyUnit,
    NormalizationMode,
    PdosType,
    SpinMode,
    StackedAreaData,
  } from './types'

  let {
    doses,
    stack = false,
    sigma = $bindable(0),
    units = $bindable(`THz`),
    normalize = $bindable(null),
    orientation = `vertical`,
    show_legend,
    x_axis = {},
    y_axis = {},
    view = $bindable(),
    hovered_frequency = $bindable(null),
    reference_frequency = null,
    fermi_level = undefined,
    spin_mode = $bindable(`mirror`),
    pdos_type = null,
    pdos_filter = undefined,
    // Controls configuration
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    show_normalize_control = false,
    show_units_control = false,
    sigma_range = undefined,
    // the padding the plot settled on; BandsAndDos/BrillouinBandsDos align both panels to it
    resolved_padding = $bindable(),
    ...rest
  }: ComponentProps<typeof ScatterPlot> & {
    doses: DosInput | Record<string, DosInput>
    x_axis?: AxisConfig
    y_axis?: AxisConfig
    stack?: boolean
    sigma?: number
    units?: FrequencyUnit
    normalize?: NormalizationMode
    orientation?: `vertical` | `horizontal`
    show_legend?: boolean
    hovered_frequency?: number | null
    reference_frequency?: number | null
    fermi_level?: number // Fermi level for electronic DOS (auto-detected if not provided)
    spin_mode?: SpinMode // How to display spin-polarized DOS: mirror (default), overlay, up_only, down_only, or null (auto)
    pdos_type?: PdosType | null // Extract projected DOS: 'atom' for atom-resolved, 'orbital' for orbital-resolved (s, p, d)
    pdos_filter?: string[] // Filter projected DOS to specific keys (e.g., ["Fe", "O"] for atoms or ["s", "p", "d"] for orbitals)
    // Controls configuration
    show_controls?: boolean // Show the controls pane
    show_normalize_control?: boolean // Show normalization selector
    show_units_control?: boolean // Show units selector (phonon DOS only)
    sigma_range?: Vec2 // Min/max range for sigma slider (auto-detected if not provided)
  } = $props()

  const is_horizontal = $derived(orientation === `horizontal`)
  // Accept the spellings found in the wild (`cm-1`, `cm⁻¹`) at the prop boundary; every read
  // below uses the canonical unit so no $derived throws on an alias
  let unit = $derived(parse_frequency_unit(units) ?? units)

  // Normalized DOS by label (`` for a single DOS). With pdos_type set, the projected DOS of
  // the input (a single CompleteDos) or of the first dict entry replace the totals.
  let doses_dict = $derived.by((): Record<string, DosData> => {
    const entries = dos_entries(doses)
    if (pdos_type) {
      const first_entry = entries[0]?.[1]
      for (const candidate of first_entry === doses ? [doses] : [doses, first_entry]) {
        const pdos = extract_pdos(candidate, pdos_type, pdos_filter)
        if (pdos) return pdos
      }
      // PDOS extraction was requested but failed - warn and revert to normal processing
      console.warn(
        `PDOS extraction requested (pdos_type="${pdos_type}") but no projected DOS data found. ` +
          `Falling back to total DOS. Ensure input has atom_dos (for atom) or spd_dos (for orbital) data.`,
      )
    }
    const result: Record<string, DosData> = {}
    for (const [key, dos] of entries) {
      const normalized = normalize_dos(dos)
      if (normalized) result[key] = normalized
    }
    return result
  })

  let is_phonon = $derived(Object.values(doses_dict)[0]?.type === `phonon`)

  let effective_fermi_level = $derived(
    fermi_level ?? (is_phonon ? undefined : extract_efermi(doses)),
  )

  let has_spin_polarized = $derived(
    Object.values(doses_dict).some(
      (dos) => dos.type === `electronic` && dos.spin_down_densities?.length,
    ),
  )

  // A null spin_mode auto-detects: mirror when spin data exists
  let effective_spin_mode = $derived<SpinMode>(
    spin_mode ?? (has_spin_polarized ? `mirror` : null),
  )

  let { series_data, stacked_areas } = $derived.by(
    (): { series_data: DataSeries[]; stacked_areas: StackedAreaData[] } => {
      const all_series: DataSeries[] = []
      const areas: StackedAreaData[] = []
      // Separate cumulative trackers so spin-down never stacks on top of spin-up
      let cumulative_spin_up: number[] | null = null
      let cumulative_spin_down: number[] | null = null

      for (const [dos_idx, [label, dos]] of Object.entries(doses_dict).entries()) {
        const color = plot_color(dos_idx)
        const x_values =
          dos.type === `phonon` && unit !== `THz`
            ? convert_frequencies(dos.frequencies, unit)
            : dos.type === `phonon`
              ? dos.frequencies
              : dos.energies
        const has_spin_down =
          dos.type === `electronic` && dos.spin_down_densities?.length === dos.densities.length
        const series_label = label || `DOS ${dos_idx + 1}`

        // Smear and normalize one spin channel, then (when `cumulative` is given) stack it on
        // the previous DOS and record the area fill between the two
        const channel = (
          raw: number[],
          cumulative: number[] | null | false,
          fill_color: string,
          warn_label: string,
        ): number[] => {
          let densities = sigma > 0 ? apply_gaussian_smearing(x_values, raw, sigma) : [...raw]
          densities = normalize_densities(densities, x_values, normalize)
          if (cumulative === false) return densities
          if (cumulative?.length === densities.length) {
            densities = densities.map((density, idx) => density + (cumulative[idx] ?? 0))
          } else if (cumulative) {
            console.warn(`DOS stacking${warn_label}: length mismatch for "${label}"`)
          }
          areas.push({
            x_values: [...x_values],
            upper_densities: [...densities],
            lower_densities: cumulative ? [...cumulative] : x_values.map(() => 0),
            color: fill_color,
          })
          return densities
        }
        const push_series = (
          densities: number[],
          suffix: string,
          stroke: string,
          dash?: string,
        ) =>
          all_series.push({
            x: is_horizontal ? densities : x_values,
            y: is_horizontal ? x_values : densities,
            markers: `line`,
            label: `${series_label}${suffix}`,
            line_style: { stroke, stroke_width: 1.5, line_dash: dash },
            point_style: { fill: stack ? stroke : undefined },
          })

        if (effective_spin_mode !== `down_only`) {
          const densities = channel(
            dos.densities,
            stack ? cumulative_spin_up : false,
            color,
            ``,
          )
          if (stack) cumulative_spin_up = densities
          push_series(densities, has_spin_down && effective_spin_mode ? ` (↑)` : ``, color)
        }
        if (
          has_spin_down &&
          effective_spin_mode !== `up_only` &&
          effective_spin_mode !== null &&
          dos.type === `electronic` &&
          dos.spin_down_densities
        ) {
          const overlay = effective_spin_mode === `overlay`
          // Overlay gets its own shade and dash; mirror negates the densities instead
          const down_color = overlay ? plot_color(dos_idx * 2 + 1) : color
          let densities = channel(
            dos.spin_down_densities,
            stack && overlay ? cumulative_spin_down : false,
            down_color,
            ` (spin-down)`,
          )
          if (stack && overlay) cumulative_spin_down = densities
          if (effective_spin_mode === `mirror`)
            densities = densities.map((density) => -density)
          push_series(densities, ` (↓)`, down_color, overlay ? `4,2` : undefined)
        }
      }
      return { series_data: all_series, stacked_areas: areas }
    },
  )

  let all_freqs = $derived(
    // for clamping phonon noise
    Object.values(doses_dict).flatMap((dos) =>
      dos.type === `phonon` ? dos.frequencies : dos.energies,
    ),
  )
  let clamp_to_zero = $derived(
    is_phonon &&
      all_freqs.length > 0 &&
      (extent(all_freqs)[0] ?? 0) < 0 &&
      negative_fraction(all_freqs) < IMAGINARY_MODE_NOISE_THRESHOLD,
  )

  let has_mirrored_spin = $derived(effective_spin_mode === `mirror` && has_spin_polarized)

  // Density axis starts at 0 (unless mirror mode needs negative values); frequency axis
  // clamps to 0 only when negative phonon frequencies are numerical noise.
  // Prefer d3 extent over Math.min/max(...arr) — large DOS grids can blow the call stack.
  // Folds over each series' own array instead of concatenating them: this re-runs on every
  // sigma-slider tick and legend toggle over grids of up to 1e7 points.
  const compute_range = (axis: `x` | `y`, is_density_axis: boolean): Vec2 | undefined => {
    let acc = empty_extent()
    for (const srs of series_data) acc = accumulate_extent(acc, srs[axis])
    if (acc.min === undefined || acc.max === undefined) return undefined
    if (is_density_axis && has_mirrored_spin) return [acc.min, acc.max]
    if (is_density_axis || clamp_to_zero) return [0, acc.max]
    return [acc.min, acc.max]
  }
  let x_range = $derived(compute_range(`x`, is_horizontal))
  let y_range = $derived(compute_range(`y`, !is_horizontal))

  let value_label = $derived(
    is_phonon ? `Frequency (${frequency_unit_label(unit)})` : `Energy (eV)`,
  )

  const internal_x_axis = $derived<AxisConfig>({
    label: is_horizontal ? `Density of States` : value_label,
    format: `.2f`,
    range: x_range,
    // Keep label standoff identical to Bands' x-axis so the side-by-side
    // "Density of States" and "Wave Vector" labels align (ScatterPlot default y: -40)
    ...(is_horizontal && { ticks: 4 }),
    ...x_axis,
  })
  const internal_y_axis = $derived<AxisConfig>({
    label: is_horizontal ? value_label : `Density of States`,
    format: `.2f`,
    range: y_range,
    ...y_axis,
  })

  let display = $state({
    x_grid: true,
    y_grid: true,
    x_zero_line: true,
    y_zero_line: true,
  })

  let has_valid_data = $derived(series_data.length > 0)

  // Auto-detect sigma range based on frequency/energy range
  let effective_sigma_range = $derived.by((): Vec2 => {
    if (sigma_range) return sigma_range
    if (all_freqs.length === 0) return [0, 1]
    const [min_freq, max_freq] = extent(all_freqs) as [number, number]
    // Reasonable sigma range: 0 to ~5% of total range
    const max_sigma = Math.max(0.1, (max_freq - min_freq) * 0.05)
    return [0, max_sigma]
  })

  let safe_sigma_range = $derived(validate_sigma_range(effective_sigma_range))
  let sigma_step = $derived(calculate_sigma_step(effective_sigma_range))

  function build_stacked_area_path(
    area: StackedAreaData,
    x_scale_fn: (val: number) => number,
    y_scale_fn: (val: number) => number,
    horizontal: boolean,
  ): string {
    const pts = area.x_values.length
    if (pts < 2) return ``

    const upper_coords: string[] = []
    const lower_coords: string[] = []

    for (let idx = 0; idx < pts; idx++) {
      const freq = area.x_values[idx]
      const upper_dens = area.upper_densities[idx]
      const lower_dens = area.lower_densities[idx]
      // For vertical orientation: x = freq, y = density
      // For horizontal orientation: x = density, y = freq
      const [upper_x, upper_y] = horizontal
        ? [x_scale_fn(upper_dens), y_scale_fn(freq)]
        : [x_scale_fn(freq), y_scale_fn(upper_dens)]
      const [lower_x, lower_y] = horizontal
        ? [x_scale_fn(lower_dens), y_scale_fn(freq)]
        : [x_scale_fn(freq), y_scale_fn(lower_dens)]
      upper_coords.push(`${upper_x.toFixed(2)},${upper_y.toFixed(2)}`)
      lower_coords.push(`${lower_x.toFixed(2)},${lower_y.toFixed(2)}`)
    }
    return closed_edge_path(upper_coords, lower_coords)
  }
</script>

{#if has_valid_data}
  <ScatterPlot
    series={series_data}
    x_axis={internal_x_axis}
    y_axis={internal_y_axis}
    bind:view
    bind:display
    bind:resolved_padding
    {show_legend}
    hover_config={{ threshold_px: 50 }}
    on_point_hover={(event) => {
      hovered_frequency = is_horizontal ? (event?.point?.y ?? null) : (event?.point?.x ?? null)
    }}
    {...rest}
    bind:show_controls
    bind:controls_open
  >
    {#snippet tooltip({ x_formatted, y_formatted, label })}
      {@const tooltip_data = format_dos_tooltip({
        x_formatted,
        y_formatted,
        label: label ?? null,
        is_horizontal,
        is_phonon,
        units: unit,
        x_axis_label: internal_x_axis.label ?? ``,
        y_axis_label: internal_y_axis.label ?? ``,
        num_series: Object.keys(doses_dict).length,
      })}
      {#if tooltip_data.title}<strong>{tooltip_data.title}</strong><br />{/if}
      {#each tooltip_data.lines as line, line_idx (line_idx)}
        {line}{#if line_idx < tooltip_data.lines.length - 1}<br />{/if}
      {/each}
    {/snippet}

    {#snippet controls_extra()}
      {#if has_spin_polarized}
        <SettingsSection
          title="Spin Display"
          current_values={{ spin_mode }}
          on_reset={() => (spin_mode = `mirror`)}
        >
          <div class="dos-spin-modes">
            {#each SPIN_MODES as mode (mode.value)}
              <button
                type="button"
                class={['spin-mode-btn', { active: spin_mode === mode.value }]}
                onclick={() => (spin_mode = mode.value)}
                aria-label={mode.title}
                aria-pressed={spin_mode === mode.value}
                {@attach attach_tooltip({ content: mode.title })}
              >
                {mode.label}
              </button>
            {/each}
          </div>
        </SettingsSection>
      {/if}

      <SettingsSection
        title="Smearing"
        current_values={{ sigma }}
        on_reset={() => (sigma = 0)}
        layout="flow"
      >
        <label title="Gaussian smearing width (σ)">
          <span>σ</span>
          <span class="sigma-value">{format_num(sigma)}</span>
          <input
            id="dos-sigma"
            type="range"
            min={safe_sigma_range[0]}
            max={safe_sigma_range[1]}
            step={sigma_step}
            bind:value={sigma}
          />
        </label>
      </SettingsSection>

      {#if show_normalize_control || (show_units_control && is_phonon)}
        <SettingsSection
          title="DOS"
          class="ctrl-line"
          current_values={{
            ...(show_normalize_control ? { normalize } : {}),
            ...(show_units_control && is_phonon ? { units: unit } : {}),
          }}
          on_reset={() => {
            if (show_normalize_control) normalize = null
            if (show_units_control && is_phonon) units = `THz`
          }}
          layout="flow"
        >
          {#if show_normalize_control}
            <label>
              <span>Normalize</span>
              <select id="dos-normalize" bind:value={normalize}>
                {#each NORMALIZATION_MODES as mode (mode.value)}
                  <option value={mode.value}>{mode.label}</option>
                {/each}
              </select>
            </label>
          {/if}
          {#if show_units_control && is_phonon}
            <FrequencyUnitSelect id="dos-units" bind:units />
          {/if}
        </SettingsSection>
      {/if}
    {/snippet}

    {#snippet user_content({ width, height, y_scale_fn, x_scale_fn, pad })}
      <!-- Stacked area fills (rendered first so they appear behind lines) -->
      {#if stack && stacked_areas.length > 0}
        {#each stacked_areas as area, area_idx (area_idx)}
          <path
            d={build_stacked_area_path(area, x_scale_fn, y_scale_fn, is_horizontal)}
            fill={area.color}
            fill-opacity="var(--dos-stacked-area-opacity, 0.3)"
            stroke="none"
          />
        {/each}
      {/if}

      <!-- Fermi level line for electronic DOS -->
      {@const fermi_pos =
        effective_fermi_level !== undefined
          ? is_horizontal
            ? y_scale_fn(effective_fermi_level)
            : x_scale_fn(effective_fermi_level)
          : NaN}
      {#if Number.isFinite(fermi_pos)}
        {@const [x1, x2, y1, y2] = is_horizontal
          ? [pad.l, width - pad.r, fermi_pos, fermi_pos]
          : [fermi_pos, fermi_pos, pad.t, height - pad.b]}
        <line
          class="fermi-level-line"
          {x1}
          {x2}
          {y1}
          {y2}
          stroke="var(--dos-fermi-line-color, light-dark(#e74c3c, #ff6b6b))"
          stroke-width="var(--dos-fermi-line-width, 1.5)"
          stroke-dasharray="var(--dos-fermi-line-dash, 6,3)"
          opacity="var(--dos-fermi-line-opacity, 0.8)"
        />
        <!-- Fermi level label. Horizontal: in the right margin only when the caller padded
        for it, else inside the plot edge. Vertical: centred above the plot. -->
        {@const label_fits_right = pad.r >= 20}
        <text
          class="fermi-level-label"
          x={is_horizontal ? width - pad.r + (label_fits_right ? 4 : -4) : fermi_pos}
          y={is_horizontal ? fermi_pos : pad.t - 4}
          dy={is_horizontal ? `0.35em` : undefined}
          text-anchor={is_horizontal ? (label_fits_right ? `start` : `end`) : `middle`}
          font-size="10"
          fill="var(--dos-fermi-line-color, light-dark(#e74c3c, #ff6b6b))"
          opacity="0.9"
        >
          E<tspan dy="2" font-size="8">F</tspan>
        </text>
      {/if}

      <!-- Reference frequency line -->
      {@const ref_pos =
        reference_frequency !== null
          ? is_horizontal
            ? y_scale_fn(reference_frequency)
            : x_scale_fn(reference_frequency)
          : NaN}
      {#if Number.isFinite(ref_pos)}
        {@const [x1, x2, y1, y2] = is_horizontal
          ? [pad.l, width - pad.r, ref_pos, ref_pos]
          : [ref_pos, ref_pos, pad.t, height - pad.b]}
        <line
          {x1}
          {x2}
          {y1}
          {y2}
          stroke="var(--dos-reference-line-color, light-dark(#d48860, #c47850))"
          stroke-width="var(--dos-reference-line-width, 1)"
          stroke-dasharray="var(--dos-reference-line-dash, 4,3)"
          opacity="var(--dos-reference-line-opacity, 0.5)"
        />
      {/if}
    {/snippet}
  </ScatterPlot>
{:else}
  <EmptyState message="No valid DOS data to display" />
{/if}

<style>
  .dos-spin-modes {
    display: flex;
    gap: 2px;
    flex-wrap: wrap;
  }
  .spin-mode-btn {
    padding: 4px 8px;
    border: 1px solid var(--border-color, light-dark(#d1d5db, #4b5563));
    background: var(--btn-bg, light-dark(#f3f4f6, #374151));
    border-radius: var(--border-radius, 3pt);
    cursor: pointer;
    font-size: 1em;
    transition: all 0.15s ease;
    min-width: 2em;
  }
  .spin-mode-btn:hover {
    background: var(--btn-bg-hover, light-dark(#e5e7eb, #4b5563));
  }
  .spin-mode-btn.active {
    background: var(--btn-bg-active, light-dark(#dbeafe, #1e40af));
    border-color: var(--btn-border-active, light-dark(#3b82f6, #60a5fa));
    color: var(--btn-color-active, light-dark(#1d4ed8, #93c5fd));
  }
  .sigma-value {
    font-family: var(--font-mono, monospace);
    font-size: 0.9em;
    text-align: right;
  }
</style>
