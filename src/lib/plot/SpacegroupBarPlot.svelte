<script lang="ts">
  import { type BarSeries, type BarTooltipProps, format_num } from '$lib'
  import { BarPlot } from '$lib/plot'
  import { format_value } from '$lib/plot/formatting'
  import type { CrystalSystem } from '$lib/symmetry'
  import {
    CRYSTAL_SYSTEM_COLORS,
    CRYSTAL_SYSTEM_RANGES,
    CRYSTAL_SYSTEMS,
    normalize_spacegroup,
    spacegroup_to_crystal_system,
  } from '$lib/symmetry'
  import type { ComponentProps } from 'svelte'
  import { SvelteMap } from 'svelte/reactivity'

  let {
    data,
    show_counts = true,
    show_empty_bins = false,
    orientation = `vertical`,
    x_axis = {},
    y_axis = {},
    ...rest
  }: ComponentProps<typeof BarPlot> & {
    data: (number | string)[]
    show_counts?: boolean
    show_empty_bins?: boolean
  } = $props()

  // Normalize input data to space group numbers
  const normalized_data = $derived.by(() => {
    return data
      .map((sg) => normalize_spacegroup(sg))
      .filter((sg): sg is number => sg !== null)
  })

  // Compute histogram of space group numbers
  const histogram = $derived.by(() => {
    const hist = new SvelteMap<number, number>()

    // Count occurrences
    for (const sg of normalized_data) {
      hist.set(sg, (hist.get(sg) ?? 0) + 1)
    }

    // Optionally add empty bins
    if (show_empty_bins) {
      for (let sg = 1; sg <= 230; sg++) {
        if (!hist.has(sg)) hist.set(sg, 0)
      }
    }

    return hist
  })

  // Group counts by crystal system
  const crystal_system_stats = $derived.by(() => {
    const stats = new SvelteMap<
      CrystalSystem,
      { count: number; spacegroups: number[] }
    >()

    for (const system of CRYSTAL_SYSTEMS) {
      stats.set(system, { count: 0, spacegroups: [] })
    }

    for (const [sg, count] of histogram) {
      const system = spacegroup_to_crystal_system(sg)
      if (system) {
        const stat = stats.get(system)!
        stat.count += count
        stat.spacegroups.push(sg)
      }
    }

    return stats
  })

  // Create sorted list of space groups for x-axis
  const sorted_spacegroups = $derived(
    Array.from(histogram.keys()).sort((a, b) => a - b),
  )

  // Smart tick selection: thin out ticks for dense data
  const x_axis_ticks = $derived.by(() => {
    const non_zero_count = sorted_spacegroups.filter((sg) =>
      (histogram.get(sg) ?? 0) > 0
    ).length

    // If data is dense (>40 space groups with data), show only multiples of 5
    if (non_zero_count > 40) {
      return sorted_spacegroups.filter((sg) => sg % 5 === 0)
    }

    // Otherwise show all ticks
    return sorted_spacegroups
  })

  // Build BarSeries - one series per crystal system for proper coloring
  const bar_series = $derived.by<BarSeries[]>(() => {
    const series_by_system = new SvelteMap<
      CrystalSystem,
      { x: number[]; y: number[] }
    >()

    // Initialize series for each crystal system
    for (const system of CRYSTAL_SYSTEMS) {
      series_by_system.set(system, { x: [], y: [] })
    }

    // Group data by crystal system
    for (const sg of sorted_spacegroups) {
      const system = spacegroup_to_crystal_system(sg)
      if (system) {
        const series = series_by_system.get(system)!
        series.x.push(sg)
        series.y.push(histogram.get(sg) ?? 0)
      }
    }

    // Convert to BarSeries array
    return Array.from(series_by_system.entries())
      .filter(([_, data]) => data.x.length > 0) // Only include systems with data
      .map(([system, data]) => ({
        x: data.x,
        y: data.y,
        color: CRYSTAL_SYSTEM_COLORS[system],
        label: system,
        bar_width: 0.9,
        visible: true,
      }))
  })

  // Calculate x-axis range - span from first to last crystal system with data
  const x_range = $derived.by<[number, number]>(() => {
    if (sorted_spacegroups.length === 0) return [0.5, 230.5]

    // Find the first and last crystal system that contains data
    const min_sg = sorted_spacegroups[0]
    const max_sg = sorted_spacegroups[sorted_spacegroups.length - 1]

    // Extend to the full ranges of those crystal systems
    let range_min = min_sg
    let range_max = max_sg

    for (const system of CRYSTAL_SYSTEMS) {
      const [system_min, system_max] = CRYSTAL_SYSTEM_RANGES[system]
      // If this system contains our min data point, extend to system start
      if (min_sg >= system_min && min_sg <= system_max) {
        range_min = system_min
      }
      // If this system contains our max data point, extend to system end
      if (max_sg >= system_min && max_sg <= system_max) {
        range_max = system_max
      }
    }

    return [range_min - 0.5, range_max + 0.5]
  })

  // Calculate crystal system region boundaries using full theoretical ranges
  const crystal_system_regions = $derived.by(() => {
    const regions: Array<{
      system: CrystalSystem
      sg_start: number
      sg_end: number
      count: number
      color: string
    }> = []

    const [range_min, range_max] = x_range

    for (const system of CRYSTAL_SYSTEMS) {
      const stats = crystal_system_stats.get(system)
      const [sg_min, sg_max] = CRYSTAL_SYSTEM_RANGES[system]

      // Only show crystal systems that fall within the visible range
      if (sg_max < range_min || sg_min > range_max) continue

      regions.push({
        system,
        sg_start: sg_min,
        sg_end: sg_max,
        count: stats?.count ?? 0,
        color: CRYSTAL_SYSTEM_COLORS[system],
      })
    }

    return regions
  })

  const total_count = $derived(normalized_data.length)

  // Build axis configurations based on orientation
  const x_axis_config = $derived(
    orientation === `horizontal` ? { ...x_axis, label: x_axis.label ?? `Counts` } : {
      ...x_axis,
      label: x_axis.label ?? `International Spacegroup Number`,
      range: x_range,
      ticks: x_axis_ticks,
      tick_rotation: x_axis.tick_rotation ?? 90, // Rotate ticks 90° to avoid overlap
      label_shift: { x: 0, y: 20, ...x_axis.label_shift }, // Move label down for rotated ticks
    },
  )

  const y_axis_config = $derived(
    orientation === `horizontal`
      ? {
        ...y_axis,
        label: y_axis.label ?? `International Spacegroup Number`,
        range: x_range,
        ticks: x_axis_ticks,
        tick_rotation: y_axis.tick_rotation ?? 0,
      }
      : { ...y_axis, label: y_axis.label ?? `Counts` },
  )
</script>

{#snippet tooltip(info: BarTooltipProps)}
  {@const sg = info.x}
  {@const count = info.y}
  {@const system = spacegroup_to_crystal_system(sg)}
  Space Group: {format_value(sg, `.0f`)}
  <br />
  {#if system}
    Crystal System: {system}
    <br />
  {/if}
  Count: {format_value(count, `.0f`)}
{/snippet}

{#snippet user_content({
  width,
  height,
  x_scale_fn,
  y_scale_fn,
  pad,
}: {
  width: number
  height: number
  x_scale_fn: (x: number) => number
  y_scale_fn: (y: number) => number
  pad: { t: number; b: number; l: number; r: number }
})}
  <g class="crystal-system-overlays">
    {#each crystal_system_regions as region (region.system)}
      {#if orientation === `vertical`}
        {@const x_start = x_scale_fn(region.sg_start - 0.5)}
        {@const x_end = x_scale_fn(region.sg_end + 0.5)}
        {@const x_center = (x_start + x_end) / 2}
        {@const rect_width = x_end - x_start}

        <!-- Background colored rectangle (vertical mode) -->
        <rect
          x={x_start}
          y={pad.t}
          width={rect_width}
          height={height - pad.t - pad.b}
          fill={region.color}
          opacity="0.15"
          stroke={region.color}
          stroke-width="1"
          stroke-opacity="0.3"
        />

        <!-- Crystal system label (rotated 90 degrees) -->
        <text
          x={x_center}
          y={pad.t + (height - pad.t - pad.b) / 2}
          text-anchor="middle"
          font-size="14"
          fill="var(--text-color, black)"
          opacity="0.6"
          transform="rotate(90, {x_center}, {pad.t + (height - pad.t - pad.b) / 2})"
        >
          {region.system}
        </text>

        <!-- Count annotation at top -->
        {#if show_counts && total_count > 0}
          <text
            x={x_center}
            y={pad.t - 5}
            text-anchor="middle"
            font-size="12"
            fill="var(--text-color, black)"
          >
            {format_num(region.count, `~`)} ({
              format_num(region.count / total_count, `.1~%`)
            })
          </text>
        {/if}
      {:else}
        {@const y_start = y_scale_fn(region.sg_end + 0.5)}
        {@const y_end = y_scale_fn(region.sg_start - 0.5)}
        {@const y_center = (y_start + y_end) / 2}
        {@const rect_height = y_end - y_start}

        <!-- Background colored rectangle (horizontal mode) -->
        <rect
          x={pad.l}
          y={y_start}
          width={width - pad.l - pad.r}
          height={rect_height}
          fill={region.color}
          opacity="0.15"
          stroke={region.color}
          stroke-width="1"
          stroke-opacity="0.3"
        />

        <!-- Crystal system label (horizontal) -->
        <text
          x={pad.l + (width - pad.l - pad.r) / 2}
          y={y_center}
          text-anchor="middle"
          dominant-baseline="central"
          font-size="14"
          fill="var(--text-color, black)"
          opacity="0.6"
        >
          {region.system}
        </text>

        <!-- Count annotation at right -->
        {#if show_counts && total_count > 0}
          <text
            x={width - pad.r + 5}
            y={y_center}
            text-anchor="start"
            dominant-baseline="central"
            font-size="12"
            fill="var(--text-color, black)"
          >
            {format_num(region.count, `~`)} ({
              format_num(region.count / total_count, `.1~%`)
            })
          </text>
        {/if}
      {/if}
    {/each}
  </g>
{/snippet}

<BarPlot
  {...rest}
  series={bar_series}
  {orientation}
  mode="overlay"
  x_axis={x_axis_config}
  y_axis={y_axis_config}
  show_legend={false}
  show_controls={false}
  {tooltip}
  {user_content}
/>
