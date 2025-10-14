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
  import type { BaseDos, FrequencyUnit, NormalizationMode, PhononDos } from './types'

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
    ...rest
  }: ComponentProps<typeof ScatterPlot> & {
    doses: BaseDos | Record<string, BaseDos>
    x_axis?: AxisConfig
    y_axis?: AxisConfig
    stack?: boolean
    sigma?: number
    units?: FrequencyUnit
    normalize?: NormalizationMode
    orientation?: `vertical` | `horizontal`
    show_legend?: boolean
  } = $props()

  // Normalize input to dict format
  let doses_dict = $derived.by(() => {
    if (!doses) return {}

    if (`densities` in doses && (`frequencies` in doses || `energies` in doses)) {
      // Single DOS
      const normalized = normalize_dos(doses)
      return normalized ? { '': normalized } : {}
    }

    // Already a dict - normalize each DOS
    const result: Record<string, BaseDos> = {}
    for (const [key, dos] of Object.entries(doses as Record<string, BaseDos>)) {
      const normalized = normalize_dos(dos)
      if (normalized) result[key] = normalized
    }
    return result
  })

  // Determine if this is phonon or electronic DOS
  let is_phonon = $derived.by(() => {
    const first_dos = Object.values(doses_dict)[0]
    return first_dos && `frequencies` in first_dos
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
      const color = plot_colors[dos_idx % plot_colors.length]

      // Get frequencies or energies with proper type safety
      let x_values: number[]
      if (is_phonon) {
        x_values = (dos as PhononDos).frequencies
      } else {
        if (!dos.energies || dos.energies.length === 0) {
          console.warn(`Electronic DOS missing energies for '${label}', skipping`)
          continue
        }
        x_values = dos.energies
      }

      // Convert units if needed
      if (is_phonon && units !== `THz`) {
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
        densities = densities.map((d, idx) => d + cumulative_densities![idx])
      }

      // Store cumulative for next iteration if stacking
      if (stack) {
        cumulative_densities = densities
      }

      // Determine x and y based on orientation
      const series: DataSeries = orientation === `horizontal`
        ? {
          x: densities,
          y: x_values,
          markers: `line`,
          label: label || `DOS ${dos_idx + 1}`,
          line_style: {
            stroke: color,
            stroke_width: 1.5,
          },
          point_style: {
            fill: stack ? color : undefined,
          },
        }
        : {
          x: x_values,
          y: densities,
          markers: `line`,
          label: label || `DOS ${dos_idx + 1}`,
          line_style: {
            stroke: color,
            stroke_width: 1.5,
          },
          point_style: {
            fill: stack ? color : undefined,
          },
        }

      all_series.push(series)
    }

    return all_series
  })

  // Calculate axis ranges
  let x_range = $derived.by((): [number, number] | undefined => {
    if (!series_data.length) return undefined
    const all_x = series_data.flatMap((s) => s.x)
    return [Math.min(...all_x), Math.max(...all_x)]
  })

  let y_range = $derived.by((): [number, number] | undefined => {
    if (!series_data.length) return undefined
    const all_y = series_data.flatMap((s) => s.y)
    return [Math.min(...all_y), Math.max(...all_y)]
  })

  // Get axis labels based on orientation
  let x_label = $derived(
    orientation === `horizontal`
      ? `Density of States`
      : is_phonon
      ? `Frequency (${units})`
      : `Energy (eV)`,
  )
  let y_label = $derived(
    orientation === `horizontal`
      ? is_phonon ? `Frequency (${units})` : `Energy (eV)`
      : `Density of States`,
  )
</script>

<ScatterPlot
  series={series_data}
  x_axis={{ label: x_label, format: `.2f`, range: x_range, ...x_axis }}
  y_axis={{ label: y_label, format: `.2f`, range: y_range, ...y_axis }}
  display={{ x_grid: true, y_grid: true, x_zero_line: true, markers: `line` }}
  legend={show_legend ? {} : null}
  {...rest}
/>
