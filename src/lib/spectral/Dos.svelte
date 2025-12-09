<script lang="ts">
  import { PLOT_COLORS } from '$lib/colors'
  import ScatterPlot from '$lib/plot/ScatterPlot.svelte'
  import type { AxisConfig, DataSeries } from '$lib/plot/types'
  import type { ComponentProps } from 'svelte'
  import {
    apply_gaussian_smearing,
    convert_frequencies,
    extract_efermi,
    negative_fraction,
    normalize_densities,
    normalize_dos,
  } from './helpers'
  import type { DosData, DosInput, FrequencyUnit, NormalizationMode } from './types'

  let {
    doses,
    stack = false,
    sigma = 0,
    units = `THz`,
    normalize = null,
    orientation = `vertical`,
    show_legend = true,
    x_axis = {},
    y_axis = {},
    hovered_frequency = $bindable(null),
    reference_frequency = null,
    fermi_level = undefined,
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
  } = $props()

  const is_horizontal = $derived(orientation === `horizontal`)

  // Normalize input to dict format - converts any DosInput format to DosData
  let doses_dict = $derived.by((): Record<string, DosData> => {
    if (!doses) return {}

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

  // Convert DOS data to scatter plot series
  // Performance: Only recalculates when doses_dict, units, sigma, or normalize changes
  let series_data = $derived.by((): DataSeries[] => {
    if (Object.keys(doses_dict).length === 0) return [] // Early return for empty data

    const all_series: DataSeries[] = []
    const dos_entries = Object.entries(doses_dict)
    let cumulative_densities: number[] | null = null

    for (let dos_idx = 0; dos_idx < dos_entries.length; dos_idx++) {
      const [label, dos] = dos_entries[dos_idx]
      const color = PLOT_COLORS[dos_idx % PLOT_COLORS.length]

      // Get frequencies or energies using discriminated union type narrowing
      let x_values = dos.type === `phonon` ? dos.frequencies : dos.energies

      // Convert units if needed
      if (dos.type === `phonon` && units !== `THz`) {
        x_values = convert_frequencies(x_values, units)
      }

      // Apply Gaussian smearing if requested (expensive for large datasets)
      let densities = sigma > 0
        ? apply_gaussian_smearing(x_values, dos.densities, sigma)
        : [...dos.densities]

      // Normalize densities
      densities = normalize_densities(densities, x_values, normalize)

      // For stacked plots, accumulate densities
      if (stack && cumulative_densities) {
        if (cumulative_densities.length !== densities.length) {
          console.warn(
            `DOS stacking: length mismatch (cumulative=${cumulative_densities.length}, current=${densities.length})`,
          )
        }
        densities = densities.map((d, idx) => d + (cumulative_densities?.[idx] ?? 0))
      }

      // Store cumulative for next iteration if stacking
      if (stack) cumulative_densities = densities

      // Determine x and y based on orientation
      const series: DataSeries = {
        x: is_horizontal ? densities : x_values,
        y: is_horizontal ? x_values : densities,
        markers: `line`,
        label: label || `DOS ${dos_idx + 1}`,
        line_style: { stroke: color, stroke_width: 1.5 },
        point_style: { fill: stack ? color : undefined },
      }
      all_series.push(series)
    }
    return all_series
  })

  // Clamp phonon freq axis to 0 if negative contribution < 0.5% (noise threshold)
  let all_freqs = $derived(
    Object.values(doses_dict).flatMap((dos) =>
      dos.type === `phonon` ? dos.frequencies : dos.energies
    ),
  )
  let clamp_to_zero = $derived(
    is_phonon &&
      all_freqs.length > 0 &&
      Math.min(...all_freqs) < 0 &&
      negative_fraction(all_freqs) < 0.005,
  )

  let x_range = $derived.by((): [number, number] | undefined => {
    if (!series_data.length) return undefined
    const all_x = series_data.flatMap((srs) => srs.x)
    const min_x = Math.min(...all_x), max_x = Math.max(...all_x)
    const padding = (max_x - min_x) * 0.02 // Calculate padding from original range
    if (is_horizontal || clamp_to_zero) return [0, max_x + padding]
    return [min_x < 0 ? min_x - padding : min_x, max_x + padding]
  })

  let y_range = $derived.by((): [number, number] | undefined => {
    if (!series_data.length) return undefined
    const all_y = series_data.flatMap((srs) => srs.y)
    const min_y = Math.min(...all_y), max_y = Math.max(...all_y)
    const padding = (max_y - min_y) * 0.02 // Calculate padding from original range
    if (!is_horizontal || clamp_to_zero) return [0, max_y + padding]
    return [min_y < 0 ? min_y - padding : min_y, max_y + padding]
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
</script>

<ScatterPlot
  series={series_data}
  x_axis={final_x_axis}
  y_axis={final_y_axis}
  bind:display
  legend={show_legend ? {} : null}
  hover_config={{ threshold_px: 50 }}
  on_point_hover={(event) => {
    hovered_frequency = is_horizontal
      ? (event?.point?.y ?? null)
      : (event?.point?.x ?? null)
  }}
  {...rest}
>
  {#snippet tooltip({ x_formatted, y_formatted, label })}
    {@const x_label_full = final_x_axis.label ?? ``}
    {@const y_label_full = final_y_axis.label ?? ``}
    {@const x_match = x_label_full.match(/^(.+?)\s*\(([^)]+)\)$/)}
    {@const y_match = y_label_full.match(/^(.+?)\s*\(([^)]+)\)$/)}
    {@const freq_label = is_phonon ? `Frequency` : `Energy`}
    {@const freq_unit = is_phonon ? units : `eV`}
    {@const num_doses = Object.keys(doses_dict).length}
    {#if num_doses > 1 && label}<strong>{label}</strong><br />{/if}
    {#if is_horizontal}
      {y_match?.[1] || freq_label}: {y_formatted}{
        y_match?.[2] || freq_unit ? ` ${y_match?.[2] || freq_unit}` : ``
      }<br />
      {x_match?.[1] || `Density`}: {x_formatted}
    {:else}
      {y_match?.[1] || `Density`}: {y_formatted}<br />
      {x_match?.[1] || freq_label}: {x_formatted}{
        x_match?.[2] || freq_unit ? ` ${x_match?.[2] || freq_unit}` : ``
      }
    {/if}
  {/snippet}

  {#snippet user_content({ width, height, y_scale_fn, x_scale_fn, pad })}
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
