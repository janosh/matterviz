<script lang="ts">
  import * as helpers from '$lib/bands/helpers'
  import type {
    BandStructureType,
    BaseBandStructure,
    LineKwargs,
    PathMode,
  } from '$lib/bands/types'
  import { plot_colors } from '$lib/colors'
  import ScatterPlot from '$lib/plot/ScatterPlot.svelte'
  import type { AxisConfig, DataSeries } from '$lib/plot/types'
  import type { ComponentProps } from 'svelte'

  let {
    band_structs,
    line_kwargs = {},
    path_mode = `strict` as PathMode,
    band_type = undefined,
    show_legend = true,
    x_axis = {},
    y_axis = {},
    ...rest
  }: ComponentProps<typeof ScatterPlot> & {
    band_structs: BaseBandStructure | Record<string, BaseBandStructure>
    x_axis?: AxisConfig
    y_axis?: AxisConfig
    line_kwargs?: LineKwargs
    path_mode?: PathMode
    band_type?: BandStructureType
    show_legend?: boolean
  } = $props()

  // Helper function to get line styling for a band
  function get_line_style(
    color: string,
    is_acoustic: boolean,
    mode_type: string,
    frequencies: number[],
    band_idx: number,
  ): { stroke: string; stroke_width: number } {
    let stroke = color
    let stroke_width = is_acoustic ? 1.5 : 1

    if (typeof line_kwargs === `function`) {
      const custom = line_kwargs(frequencies, band_idx)
      return {
        stroke: (custom.stroke as string) ?? stroke,
        stroke_width: (custom.stroke_width as number) ?? stroke_width,
      }
    }

    if (typeof line_kwargs === `object` && line_kwargs !== null) {
      const lk = line_kwargs as Record<string, unknown>

      // Check for mode-specific styling
      if (`acoustic` in lk || `optical` in lk) {
        const mode_kwargs = lk[mode_type] as Record<string, unknown> | undefined
        if (mode_kwargs) {
          stroke = (mode_kwargs.stroke as string) ?? stroke
          stroke_width = (mode_kwargs.stroke_width as number) ?? stroke_width
        }
      } else {
        // Global styling for all bands
        stroke = (lk.stroke as string) ?? stroke
        stroke_width = (lk.stroke_width as number) ?? stroke_width
      }
    }

    return { stroke, stroke_width }
  }

  // Normalize input to dict format
  let band_structs_dict = $derived.by(() => {
    if (!band_structs) return {}

    const is_single_struct = `qpoints` in band_structs && `branches` in band_structs

    if (is_single_struct) {
      const normalized = helpers.normalize_band_structure(band_structs)
      return normalized ? { default: normalized } : {}
    }

    // Normalize each structure in the dict
    const result: Record<string, BaseBandStructure> = {}
    for (
      const [key, bs] of Object.entries(
        band_structs as Record<string, BaseBandStructure>,
      )
    ) {
      const normalized = helpers.normalize_band_structure(bs)
      if (normalized) result[key] = normalized
    }
    return result
  })

  let detected_band_type = $derived.by((): BandStructureType => band_type ?? `phonon`)

  // Determine which segments to plot based on path_mode
  let segments_to_plot = $derived.by(() => {
    const all_segments: Record<string, Array<[string, BaseBandStructure]>> = {}

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
  let x_positions = $derived.by(() => {
    const positions: Record<string, [number, number]> = {}
    let current_x = 0

    // Preserve physical path order using the first available structure
    const canonical = Object.values(band_structs_dict)[0]
    const ordered_segments = helpers.get_ordered_segments(canonical, segments_to_plot)

    for (const segment_key of ordered_segments) {
      if (!segments_to_plot.has(segment_key)) continue
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
          const segment_len = bs.distance[matching_branch.end_index] -
            bs.distance[matching_branch.start_index]
          positions[segment_key] = [current_x, current_x + segment_len]
          current_x += segment_len
          break
        }
      }
    }

    return positions
  })

  // Convert band structures to scatter plot series
  let series_data = $derived.by((): DataSeries[] => {
    if (Object.keys(band_structs_dict).length === 0 || segments_to_plot.size === 0) {
      return []
    }

    const all_series: DataSeries[] = []

    for (const [bs_idx, [label, bs]] of Object.entries(band_structs_dict).entries()) {
      const color = plot_colors[bs_idx % plot_colors.length]
      const structure_label = label || `Structure ${bs_idx + 1}`

      for (const branch of bs.branches) {
        const start_idx = branch.start_index
        const end_idx = branch.end_index + 1
        const start_label = bs.qpoints[start_idx]?.label ?? undefined
        const end_label = bs.qpoints[end_idx - 1]?.label ?? undefined
        const segment_key = helpers.get_segment_key(start_label, end_label)

        if (!segments_to_plot.has(segment_key)) continue

        const [x_start, x_end] = x_positions[segment_key] || [0, 1]

        // Scale distances for this segment
        const segment_distances = bs.distance.slice(start_idx, end_idx)
        const dist_min = segment_distances[0]
        const dist_range = segment_distances[segment_distances.length - 1] - dist_min
        const scaled_distances = dist_range === 0
          ? segment_distances.map(() => (x_start + x_end) / 2)
          : segment_distances.map(
            (d) => x_start + ((d - dist_min) / dist_range) * (x_end - x_start),
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
          })
        }
      }
    }

    return all_series
  })

  // Get x-axis tick positions with custom labels for symmetry points
  let x_axis_ticks = $derived.by((): Record<number, string> => {
    const tick_labels: Record<number, string> = {}

    const sorted_positions = Object.entries(x_positions).sort(
      ([, [a]], [, [b]]) => a - b,
    )

    for (const [segment_key, [x_start, x_end]] of sorted_positions) {
      const [start_label, end_label] = segment_key.split(`_`)

      // Add start label if not already present
      if (!(x_start in tick_labels)) {
        const pretty_start = start_label !== `null`
          ? helpers.pretty_sym_point(start_label)
          : ``
        if (pretty_start) tick_labels[x_start] = pretty_start
      }

      // Add end label
      const pretty_end = end_label !== `null`
        ? helpers.pretty_sym_point(end_label)
        : ``
      if (pretty_end) tick_labels[x_end] = pretty_end
    }

    return tick_labels
  })

  let x_range = $derived.by((): [number, number] => {
    const all_x = Object.values(x_positions).flat()
    return [Math.min(...all_x), Math.max(...all_x)]
  })
</script>

<ScatterPlot
  series={series_data}
  x_axis={{
    label: `Wave Vector`,
    ticks: Object.keys(x_axis_ticks).length > 0 ? x_axis_ticks : undefined,
    format: ``,
    range: x_range, // Explicitly set range to disable padding
    ...x_axis,
  }}
  y_axis={{
    label: detected_band_type === `phonon` ? `Frequency (THz)` : `Energy (eV)`,
    format: `.2f`,
    ...y_axis,
  }}
  display={{
    x_grid: false,
    y_grid: true,
    y_zero_line: true,
    markers: `line`,
  }}
  legend={show_legend && Object.keys(band_structs_dict).length > 1 ? {} : null}
  {...rest}
>
  {#snippet user_content({ height, x_scale_fn, pad })}
    <!-- Vertical lines at high-symmetry points -->
    {@const tick_positions = Object.keys(x_axis_ticks).map(Number).sort((a, b) => a - b)}
    {#each tick_positions as x_pos (x_pos)}
      <line
        x1={x_scale_fn(x_pos)}
        x2={x_scale_fn(x_pos)}
        y1={pad.t}
        y2={height - pad.b}
        stroke="var(--bands-symmetry-line-color, light-dark(black, white))"
        stroke-width="var(--bands-symmetry-line-width, 1)"
        opacity="var(--bands-symmetry-line-opacity, 0.5)"
      />
    {/each}
  {/snippet}
</ScatterPlot>
