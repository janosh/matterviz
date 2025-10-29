<script lang="ts">
  import { plot_colors } from '$lib/colors'
  import ScatterPlot from '$lib/plot/ScatterPlot.svelte'
  import type { AxisConfig, DataSeries } from '$lib/plot/types'
  import type { ComponentProps } from 'svelte'
  import {
    apply_gaussian_smearing,
    convert_frequencies,
    normalize_densities,
    normalize_dos,
  } from './helpers'
  import type { DosData, FrequencyUnit, NormalizationMode } from './types'

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
    ...rest
  }: ComponentProps<typeof ScatterPlot> & {
    doses: DosData | Record<string, DosData>
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
  } = $props()

  const is_horizontal = $derived(orientation === `horizontal`)

  // Normalize input to dict format
  let doses_dict = $derived.by(() => {
    if (!doses) return {}

    if (`densities` in doses && (`frequencies` in doses || `energies` in doses)) {
      // Single DOS
      const normalized = normalize_dos(doses)
      return normalized ? { '': normalized } : {}
    }

    // Already a dict - normalize each DOS
    const result: Record<string, DosData> = {}
    for (const [key, dos] of Object.entries(doses as Record<string, DosData>)) {
      const normalized = normalize_dos(dos)
      if (normalized) result[key] = normalized
    }
    return result
  })

  // Determine if this is phonon or electronic DOS using discriminated union
  let is_phonon = $derived(Object.values(doses_dict)[0]?.type === `phonon`)

  // Convert DOS data to scatter plot series
  // Performance: Only recalculates when doses_dict, units, sigma, or normalize changes
  let series_data = $derived.by((): DataSeries[] => {
    if (Object.keys(doses_dict).length === 0) return [] // Early return for empty data

    const all_series: DataSeries[] = []
    const dos_entries = Object.entries(doses_dict)
    let cumulative_densities: number[] | null = null

    for (let dos_idx = 0; dos_idx < dos_entries.length; dos_idx++) {
      const [label, dos] = dos_entries[dos_idx]
      const color = plot_colors[dos_idx % plot_colors.length]

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

  // Calculate axis ranges
  let x_range = $derived.by(() => {
    if (!series_data.length) return undefined
    const all_x = series_data.flatMap((s) => s.x)
    return [Math.min(...all_x), Math.max(...all_x)] as [number, number]
  })
  let y_range = $derived.by(() => {
    if (!series_data.length) return undefined
    const all_y = series_data.flatMap((s) => s.y)
    return [0, Math.max(...all_y)] as [number, number]
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
  on_point_hover={({ point }) => {
    // Extract frequency value from the hovered point
    hovered_frequency = is_horizontal ? (point?.y ?? null) : (point?.x ?? null)
  }}
  {...rest}
>
  {#snippet tooltip({ x_formatted, y_formatted, label })}
    {@const x_label_full = final_x_axis.label ?? ``}
    {@const y_label_full = final_y_axis.label ?? ``}
    {@const x_match = x_label_full.match(/^(.+?)\s*\(([^)]+)\)$/)}
    {@const y_match = y_label_full.match(/^(.+?)\s*\(([^)]+)\)$/)}
    {@const x_label_text = x_match?.[1] ||
      (x_label_full.includes(`Energy`) ? `Energy` : `Frequency`)}
    {@const x_unit = x_match?.[2] || ``}
    {@const y_label_text = y_match?.[1] || `Density`}
    {@const y_unit = y_match?.[2] || ``}
    {@const num_doses = Object.keys(doses_dict).length}
    {#if num_doses > 1 && label}<strong>{label}</strong><br />{/if}
    {#if is_horizontal}
      {y_label_text}: {y_formatted}{y_unit ? ` ${y_unit}` : ``}<br />
      {x_label_text}: {x_formatted}
    {:else}
      {y_label_text}: {y_formatted}<br />
      {x_label_text}: {x_formatted}{x_unit ? ` ${x_unit}` : ``}
    {/if}
  {/snippet}

  {#snippet user_content({ width, height, y_scale_fn, x_scale_fn, pad })}
    {#if reference_frequency !== null}
      {@const pos = is_horizontal
      ? y_scale_fn(reference_frequency)
      : x_scale_fn(reference_frequency)}
      {@const [x1, x2, y1, y2] = is_horizontal
      ? [pad.l, width - pad.r, pos, pos]
      : [pos, pos, pad.t, height - pad.b]}
      {@const styles = {
      stroke: `var(--dos-reference-line-color, light-dark(#d48860, #c47850))`,
      'stroke-width': `var(--dos-reference-line-width, 1)`,
      'stroke-dasharray': `var(--dos-reference-line-dash, 4,3)`,
      opacity: `var(--dos-reference-line-opacity, 0.5)`,
    }}
      <line {x1} {x2} {y1} {y2} {...styles} />
    {/if}
  {/snippet}
</ScatterPlot>
