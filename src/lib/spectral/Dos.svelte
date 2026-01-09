<script lang="ts">
  import { PLOT_COLORS } from '$lib/colors'
  import EmptyState from '$lib/EmptyState.svelte'
  import { SettingsSection } from '$lib/layout'
  import ScatterPlot from '$lib/plot/ScatterPlot.svelte'
  import type { AxisConfig, DataSeries } from '$lib/plot/types'
  import type { ComponentProps } from 'svelte'
  import { tooltip as attach_tooltip } from 'svelte-multiselect/attachments'
  import {
    apply_gaussian_smearing,
    calculate_sigma_step,
    convert_frequencies,
    extract_efermi,
    extract_pdos,
    format_dos_tooltip,
    format_sigma,
    FREQUENCY_UNITS,
    IMAGINARY_MODE_NOISE_THRESHOLD,
    negative_fraction,
    NORMALIZATION_MODES,
    normalize_densities,
    normalize_dos,
    SPIN_MODES,
    validate_sigma_range,
  } from './helpers'
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
    show_legend = true,
    x_axis = {},
    y_axis = {},
    hovered_frequency = $bindable(null),
    reference_frequency = null,
    fermi_level = undefined,
    spin_mode = $bindable(`mirror`),
    pdos_type = null,
    pdos_filter = undefined,
    // Controls configuration
    show_controls = true,
    show_sigma_control = true,
    show_normalize_control = false,
    show_units_control = false,
    sigma_range = undefined,
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
    show_sigma_control?: boolean // Show sigma/smearing control
    show_normalize_control?: boolean // Show normalization selector
    show_units_control?: boolean // Show units selector (phonon DOS only)
    sigma_range?: [number, number] // Min/max range for sigma slider (auto-detected if not provided)
  } = $props()

  const is_horizontal = $derived(orientation === `horizontal`)

  // Normalize input to dict format - converts any DosInput format to DosData
  // If pdos_type is set, extract projected DOS from the input instead
  let doses_dict = $derived.by((): Record<string, DosData> => {
    if (!doses) return {}

    // If pdos_type is set, try to extract projected DOS
    if (pdos_type) {
      // Try extracting from the doses object directly (single CompleteDos)
      const pdos = extract_pdos(doses, pdos_type, pdos_filter)
      if (pdos) return pdos

      // Try extracting from first entry if doses is a dict
      if (typeof doses === `object` && !(`densities` in doses)) {
        const first_dos = Object.values(doses)[0]
        const pdos_from_first = extract_pdos(first_dos, pdos_type, pdos_filter)
        if (pdos_from_first) return pdos_from_first
      }
      // PDOS extraction was requested but failed - warn and revert to normal processing
      console.warn(
        `PDOS extraction requested (pdos_type="${pdos_type}") but no projected DOS data found. ` +
          `Falling back to total DOS. Ensure input has atom_dos (for atom) or spd_dos (for orbital) data.`,
      )
    }

    if (`densities` in doses && (`frequencies` in doses || `energies` in doses)) {
      // Single DOS
      const normalized = normalize_dos(doses)
      return normalized ? { '': normalized } : {}
    }

    // Already a dict - normalize each DOS
    const result: Record<string, DosData> = {}
    for (const [key, dos] of Object.entries(doses as Record<string, DosInput>)) {
      const normalized = normalize_dos(dos)
      if (normalized) result[key] = normalized
    }
    return result
  })

  // Determine if this is phonon or electronic DOS using discriminated union
  let is_phonon = $derived(Object.values(doses_dict)[0]?.type === `phonon`)

  // Auto-detect Fermi level from electronic DOS data if not explicitly provided
  let effective_fermi_level = $derived.by((): number | undefined => {
    if (fermi_level !== undefined) return fermi_level
    if (is_phonon) return undefined
    return extract_efermi(doses)
  })

  // Check if any DOS in the dict has spin-polarized data
  let has_spin_polarized = $derived(
    Object.values(doses_dict).some(
      (dos) => dos.type === `electronic` && dos.spin_down_densities?.length,
    ),
  )

  // Effective spin mode: null means auto-detect (mirror if spin data exists)
  let effective_spin_mode = $derived.by((): SpinMode => {
    if (spin_mode !== null) return spin_mode
    return has_spin_polarized ? `mirror` : null
  })

  // Convert DOS data to scatter plot series and stacked area data
  // Performance: Only recalculates when doses_dict, units, sigma, normalize, or spin_mode changes
  let { series_data, stacked_areas } = $derived.by(
    (): { series_data: DataSeries[]; stacked_areas: StackedAreaData[] } => {
      if (Object.keys(doses_dict).length === 0) {
        return { series_data: [], stacked_areas: [] }
      }

      const all_series: DataSeries[] = []
      const areas: StackedAreaData[] = []
      const dos_entries = Object.entries(doses_dict)
      // Separate cumulative trackers for spin-up and spin-down in overlay mode
      // This prevents spin-down from incorrectly stacking on top of spin-up
      let cumulative_spin_up: number[] | null = null
      let cumulative_spin_down: number[] | null = null

      for (let dos_idx = 0; dos_idx < dos_entries.length; dos_idx++) {
        const [label, dos] = dos_entries[dos_idx]
        const color = PLOT_COLORS[dos_idx % PLOT_COLORS.length]

        // Get frequencies or energies using discriminated union type narrowing
        let x_values = dos.type === `phonon` ? dos.frequencies : dos.energies

        // Convert units if needed
        if (dos.type === `phonon` && units !== `THz`) {
          x_values = convert_frequencies(x_values, units)
        }

        // Check for spin-down data (only for electronic DOS)
        const has_spin_down = dos.type === `electronic` &&
          dos.spin_down_densities?.length === dos.densities.length
        const should_show_spin_up = effective_spin_mode !== `down_only`
        const should_show_spin_down = has_spin_down &&
          effective_spin_mode !== `up_only` && effective_spin_mode !== null

        // Process spin-up (or total) densities
        if (should_show_spin_up) {
          let densities_up = sigma > 0
            ? apply_gaussian_smearing(x_values, dos.densities, sigma)
            : [...dos.densities]

          densities_up = normalize_densities(densities_up, x_values, normalize)

          // Store previous cumulative for area fill baseline
          const prev_cumulative = cumulative_spin_up ? [...cumulative_spin_up] : null

          // For stacked plots, accumulate densities (only if array lengths match)
          if (stack && cumulative_spin_up?.length === densities_up.length) {
            densities_up = densities_up.map((d, idx) => d + cumulative_spin_up![idx])
          } else if (stack && cumulative_spin_up) {
            console.warn(`DOS stacking: length mismatch for "${label}"`)
          }

          // Store stacked area data for rendering
          if (stack) {
            areas.push({
              x_values: [...x_values],
              upper_densities: [...densities_up],
              lower_densities: prev_cumulative ?? x_values.map(() => 0),
              color,
            })
            cumulative_spin_up = densities_up
          }

          const spin_label = has_spin_down && effective_spin_mode
            ? `${label || `DOS ${dos_idx + 1}`} (↑)`
            : (label || `DOS ${dos_idx + 1}`)

          const series_up: DataSeries = {
            x: is_horizontal ? densities_up : x_values,
            y: is_horizontal ? x_values : densities_up,
            markers: `line`,
            label: spin_label,
            line_style: { stroke: color, stroke_width: 1.5 },
            point_style: { fill: stack ? color : undefined },
          }
          all_series.push(series_up)
        }

        // Process spin-down densities if available
        if (
          should_show_spin_down && dos.type === `electronic` &&
          dos.spin_down_densities
        ) {
          let densities_down = sigma > 0
            ? apply_gaussian_smearing(x_values, dos.spin_down_densities, sigma)
            : [...dos.spin_down_densities]

          densities_down = normalize_densities(densities_down, x_values, normalize)

          // For mirror mode, negate the densities
          if (effective_spin_mode === `mirror`) {
            densities_down = densities_down.map((d) => -d)
          }

          // For stacked plots with overlay mode, use separate spin-down cumulative
          // This prevents spin-down from stacking on top of spin-up within the same DOS
          if (stack && effective_spin_mode === `overlay`) {
            const prev_spin_down = cumulative_spin_down
              ? [...cumulative_spin_down]
              : null
            if (cumulative_spin_down?.length === densities_down.length) {
              densities_down = densities_down.map((d, idx) =>
                d + cumulative_spin_down![idx]
              )
            } else if (cumulative_spin_down) {
              console.warn(`DOS stacking (spin-down): length mismatch for "${label}"`)
            }

            // Store stacked area for spin-down
            areas.push({
              x_values: [...x_values],
              upper_densities: [...densities_down],
              lower_densities: prev_spin_down ?? x_values.map(() => 0),
              color: PLOT_COLORS[(dos_idx * 2 + 1) % PLOT_COLORS.length],
            })
            cumulative_spin_down = densities_down
          }

          // Use a slightly different shade for spin-down in overlay mode
          const spin_down_color = effective_spin_mode === `overlay`
            ? PLOT_COLORS[(dos_idx * 2 + 1) % PLOT_COLORS.length]
            : color

          const series_down: DataSeries = {
            x: is_horizontal ? densities_down : x_values,
            y: is_horizontal ? x_values : densities_down,
            markers: `line`,
            label: `${label || `DOS ${dos_idx + 1}`} (↓)`,
            line_style: {
              stroke: spin_down_color,
              stroke_width: 1.5,
              line_dash: effective_spin_mode === `overlay` ? `4,2` : undefined,
            },
            point_style: { fill: stack ? spin_down_color : undefined },
          }
          all_series.push(series_down)
        }
      }
      return { series_data: all_series, stacked_areas: areas }
    },
  )

  let all_freqs = $derived( // for clamping phonon noise
    Object.values(doses_dict).flatMap((dos) =>
      dos.type === `phonon` ? dos.frequencies : dos.energies
    ),
  )
  let clamp_to_zero = $derived(
    is_phonon &&
      all_freqs.length > 0 &&
      Math.min(...all_freqs) < 0 &&
      negative_fraction(all_freqs) < IMAGINARY_MODE_NOISE_THRESHOLD,
  )

  // Check if we have mirrored spin-down data (negative densities)
  let has_mirrored_spin = $derived(
    effective_spin_mode === `mirror` && has_spin_polarized,
  )

  let x_range = $derived.by((): [number, number] | undefined => {
    if (!series_data.length) return undefined
    const all_x = series_data.flatMap((srs) => srs.x)
    const min_x = Math.min(...all_x), max_x = Math.max(...all_x)
    // For horizontal orientation with mirror mode, allow negative values (mirrored densities)
    if (is_horizontal && has_mirrored_spin) return [min_x, max_x]
    if (is_horizontal || clamp_to_zero) return [0, max_x]
    return [min_x, max_x]
  })

  let y_range = $derived.by((): [number, number] | undefined => {
    if (!series_data.length) return undefined
    const all_y = series_data.flatMap((srs) => srs.y)
    const min_y = Math.min(...all_y), max_y = Math.max(...all_y)
    // For vertical orientation with mirror mode, allow negative values (mirrored densities)
    if (!is_horizontal && has_mirrored_spin) return [min_y, max_y]
    if (!is_horizontal || clamp_to_zero) return [0, max_y]
    return [min_y, max_y]
  })

  // Get axis labels based on orientation
  let x_label = $derived(
    is_horizontal
      ? `Density of States`
      : is_phonon
      ? `Frequency (${units})`
      : `Energy (eV)`,
  )
  let y_label = $derived(
    is_horizontal
      ? (is_phonon ? `Frequency (${units})` : `Energy (eV)`)
      : `Density of States`,
  )

  // Compute final axis configurations with default labels
  let final_x_axis = $derived({
    label: x_label,
    format: `.2f`,
    range: x_range,
    label_shift: { x: 0, y: -48 }, // Increase standoff from tick labels
    ...(is_horizontal && { ticks: 4 }),
    ...x_axis,
  })
  let final_y_axis = $derived({
    label: y_label,
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

  // Determine if we have valid data to display
  let has_valid_data = $derived(series_data.length > 0)

  // Auto-detect sigma range based on frequency/energy range
  let effective_sigma_range = $derived.by((): [number, number] => {
    if (sigma_range) return sigma_range
    if (!all_freqs.length) return [0, 1]
    const freq_range = Math.max(...all_freqs) - Math.min(...all_freqs)
    // Reasonable sigma range: 0 to ~5% of total range
    const max_sigma = Math.max(0.1, freq_range * 0.05)
    return [0, max_sigma]
  })

  // Computed values for sigma slider
  let safe_sigma_range = $derived(validate_sigma_range(effective_sigma_range))
  let sigma_step = $derived(calculate_sigma_step(effective_sigma_range))

  // Build SVG path for stacked area fill between upper and lower density curves
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
    // Trace upper edge forward, lower edge backward, close path
    return `M${upper_coords[0]} ${
      upper_coords.slice(1).map((coord) => `L${coord}`).join(` `)
    } ${lower_coords.toReversed().map((coord) => `L${coord}`).join(` `)} Z`
  }
</script>

{#if has_valid_data}
  <ScatterPlot
    series={series_data}
    x_axis={final_x_axis}
    y_axis={final_y_axis}
    bind:display
    legend={show_legend ? {} : null}
    hover_config={{ threshold_px: 50 }}
    controls={{ show: show_controls }}
    on_point_hover={(event) => {
      hovered_frequency = is_horizontal
        ? (event?.point?.y ?? null)
        : (event?.point?.x ?? null)
    }}
    {...{ range_padding: 0, ...rest }}
  >
    {#snippet tooltip({ x_formatted, y_formatted, label })}
      {@const tooltip_data = format_dos_tooltip(
      x_formatted,
      y_formatted,
      label ?? null,
      is_horizontal,
      is_phonon,
      units,
      final_x_axis.label ?? ``,
      final_y_axis.label ?? ``,
      Object.keys(doses_dict).length,
    )}
      {#if tooltip_data.title}<strong>{tooltip_data.title}</strong><br />{/if}
      {#each tooltip_data.lines as line, line_idx (line_idx)}
        {line}{#if line_idx < tooltip_data.lines.length - 1}<br />{/if}
      {/each}
    {/snippet}

    {#snippet controls_extra()}
      <!-- Spin Mode (for spin-polarized electronic DOS) -->
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
                class="spin-mode-btn"
                class:active={spin_mode === mode.value}
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

      <!-- Smearing (Sigma) -->
      {#if show_sigma_control}
        <SettingsSection
          title="Smearing"
          current_values={{ sigma }}
          on_reset={() => (sigma = 0)}
        >
          <div class="pane-row">
            <label for="dos-sigma" title="Gaussian smearing width (σ)">σ:</label>
            <input
              id="dos-sigma"
              type="range"
              min={safe_sigma_range[0]}
              max={safe_sigma_range[1]}
              step={sigma_step}
              bind:value={sigma}
            />
            <span class="sigma-value">{format_sigma(sigma)}</span>
          </div>
        </SettingsSection>
      {/if}

      <!-- Normalization -->
      {#if show_normalize_control}
        <SettingsSection
          title="Normalization"
          current_values={{ normalize }}
          on_reset={() => (normalize = null)}
        >
          <div class="pane-row">
            <label for="dos-normalize">Mode:</label>
            <select id="dos-normalize" bind:value={normalize}>
              {#each NORMALIZATION_MODES as mode (mode.value)}
                <option value={mode.value}>{mode.label}</option>
              {/each}
            </select>
          </div>
        </SettingsSection>
      {/if}

      <!-- Frequency Units (phonon DOS only) -->
      {#if show_units_control && is_phonon}
        <SettingsSection
          title="Units"
          current_values={{ units }}
          on_reset={() => (units = `THz`)}
        >
          <div class="pane-row">
            <label for="dos-units">Frequency:</label>
            <select id="dos-units" bind:value={units}>
              {#each FREQUENCY_UNITS as unit (unit)}
                <option value={unit}>{unit}</option>
              {/each}
            </select>
          </div>
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
      {#if effective_fermi_level !== undefined}
        {@const pos = is_horizontal
      ? y_scale_fn(effective_fermi_level)
      : x_scale_fn(effective_fermi_level)}
        {@const [x1, x2, y1, y2] = is_horizontal
      ? [pad.l, width - pad.r, pos, pos]
      : [pos, pos, pad.t, height - pad.b]}
        <line
          {x1}
          {x2}
          {y1}
          {y2}
          stroke="var(--dos-fermi-line-color, light-dark(#e74c3c, #ff6b6b))"
          stroke-width="var(--dos-fermi-line-width, 1.5)"
          stroke-dasharray="var(--dos-fermi-line-dash, 6,3)"
          opacity="var(--dos-fermi-line-opacity, 0.8)"
        />
        <!-- Fermi level label -->
        {#if is_horizontal}
          <text
            x={width - pad.r + 4}
            y={pos}
            dy="0.35em"
            font-size="10"
            fill="var(--dos-fermi-line-color, light-dark(#e74c3c, #ff6b6b))"
            opacity="0.9"
          >
            E<tspan dy="2" font-size="8">F</tspan>
          </text>
        {:else}
          <text
            x={pos}
            y={pad.t - 4}
            text-anchor="middle"
            font-size="10"
            fill="var(--dos-fermi-line-color, light-dark(#e74c3c, #ff6b6b))"
            opacity="0.9"
          >
            E<tspan dy="2" font-size="8">F</tspan>
          </text>
        {/if}
      {/if}

      <!-- Reference frequency line -->
      {#if reference_frequency !== null}
        {@const pos = is_horizontal
      ? y_scale_fn(reference_frequency)
      : x_scale_fn(reference_frequency)}
        {@const [x1, x2, y1, y2] = is_horizontal
      ? [pad.l, width - pad.r, pos, pos]
      : [pos, pos, pad.t, height - pad.b]}
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
  /* Control row layout */
  .pane-row {
    display: flex;
    align-items: center;
    gap: 0.5em;
    margin: 0.3em 0;
    font-size: 0.9em;
  }
  .pane-row label {
    min-width: 4em;
    flex-shrink: 0;
  }
  .pane-row input[type='range'] {
    flex: 1;
    min-width: 4em;
  }
  .pane-row select {
    flex: 1;
    min-width: 0;
  }
  /* Spin mode button group */
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
  /* Sigma value display */
  .sigma-value {
    font-family: var(--font-mono, monospace);
    font-size: 0.9em;
    min-width: 3.5em;
    text-align: right;
  }
</style>
