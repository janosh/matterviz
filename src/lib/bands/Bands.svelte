<script lang="ts">
  import * as helpers from '$lib/bands/helpers'
  import type {
    BandStructureType,
    BaseBandStructure,
    LineKwargs,
    PathMode,
  } from '$lib/bands/types'
  import { PLOT_COLORS } from '$lib/colors'
  import ScatterPlot from '$lib/plot/ScatterPlot.svelte'
  import type { AxisConfig, DataSeries } from '$lib/plot/types'
  import type { ComponentProps } from 'svelte'
  import { SvelteMap } from 'svelte/reactivity'

  let {
    band_structs,
    line_kwargs = {},
    path_mode = `strict`,
    band_type = undefined,
    show_legend = true,
    x_axis = {},
    y_axis = {},
    x_positions = $bindable(),
    reference_frequency = null,
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
  } = $props()

  // Helper function to get line styling for a band
  function get_line_style(
    color: string,
    is_acoustic: boolean,
    mode_type: `acoustic` | `optical`,
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
      const mode_kwargs = (line_kwargs as Record<string, unknown>)[mode_type] as
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

  // Normalize input to dict format
  // Supports both matterviz format (qpoints + branches) and pymatgen format (qpoints + bands arrays)
  let band_structs_dict = $derived.by(() => {
    if (!band_structs) return {}

    // Detect single band structure
    // - matterviz format: has qpoints + branches arrays
    // - pymatgen format: has qpoints + bands arrays (no branches)
    const is_matterviz_single = `qpoints` in band_structs &&
      `branches` in band_structs
    const is_pymatgen_single = `qpoints` in band_structs && `bands` in band_structs &&
      Array.isArray(band_structs.qpoints) && Array.isArray(band_structs.bands) &&
      band_structs.qpoints.length > 0 && !(`branches` in band_structs)
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

  let detected_band_type = $derived(band_type ?? `phonon`)

  // Determine which segments to plot based on path_mode
  let segments_to_plot = $derived.by(() => {
    const all_segments: Record<string, [string, BaseBandStructure][]> = {}

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
  $effect(() => {
    const positions: Record<string, [number, number]> = {}
    let current_x = 0

    // Preserve physical path order using the first available structure
    const canonical = Object.values(band_structs_dict)[0]
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
        const dist_min = segment_distances[0]
        const dist_range = segment_distances[segment_distances.length - 1] - dist_min
        const scaled_distances = dist_range === 0
          ? segment_distances.map(() => (x_start + x_end) / 2)
          : segment_distances.map(
            (dist) => x_start + ((dist - dist_min) / dist_range) * (x_end - x_start),
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
            metadata: { band_idx },
          })
        }
      }
    }

    return all_series
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
    return [flat[0] ?? 0, flat.at(-1) ?? 1] as [number, number]
  })
  let final_y_axis = $derived({
    label: detected_band_type === `phonon` ? `Frequency (THz)` : `Energy (eV)`,
    format: `.2f`,
    label_shift: { y: 15 },
    ...y_axis,
  })
  let display = $state({ x_grid: false, y_grid: true, y_zero_line: true })
</script>

<ScatterPlot
  series={series_data}
  x_axis={{
    label: `Wave Vector`,
    ticks: Object.keys(x_axis_ticks).length > 0 ? x_axis_ticks : undefined,
    format: ``,
    range: x_range,
    ...x_axis,
  }}
  y_axis={final_y_axis}
  bind:display
  legend={show_legend && Object.keys(band_structs_dict).length > 1 ? {} : null}
  hover_config={{ threshold_px: 50 }}
  {...rest}
>
  {#snippet tooltip({ x, y_formatted, label, metadata })}
    {@const y_label_full = final_y_axis.label ?? ``}
    {@const [, y_label, y_unit] = y_label_full.match(/^(.+?)\s*\(([^)]+)\)$/) ??
      [, y_label_full, ``]}
    {@const segment = Object.entries(x_positions ?? {}).find(([, [start, end]]) =>
      x >= start && x <= end
    )}
    {@const path = segment?.[0].split(`_`).map((lbl) =>
      lbl !== `null` ? helpers.pretty_sym_point(lbl) : ``
    ).filter(Boolean).join(` → `) || null}
    {@const band_idx = metadata?.band_idx}
    {@const num_structs = Object.keys(band_structs_dict).length}
    {#if num_structs > 1 && label}<strong>{label}</strong><br />{/if}
    {y_label || `Value`}: {y_formatted}{y_unit ? ` ${y_unit}` : ``}<br />
    {#if path}Path: {path}<br />{/if}
    {#if typeof band_idx === `number`}Band: {band_idx + 1}{/if}
  {/snippet}

  {#snippet user_content({ height, x_scale_fn, y_scale_fn, pad })}
    {#each Object.keys(x_axis_ticks).map(Number) as x_pos (x_pos)}
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
    {#if reference_frequency !== null}
      {@const y_pos = y_scale_fn(reference_frequency)}
      {@const x_end = x_scale_fn(Object.values(x_positions ?? {}).flat().at(-1) ?? 1)}
      <line
        x1={pad.l}
        x2={x_end}
        y1={y_pos}
        y2={y_pos}
        stroke="var(--bands-reference-line-color, light-dark(#d48860, #c47850))"
        stroke-width="var(--bands-reference-line-width, 1)"
        stroke-dasharray="var(--bands-reference-line-dash, 4,3)"
        opacity="var(--bands-reference-line-opacity, 0.5)"
      />
    {/if}
  {/snippet}
</ScatterPlot>
