<script lang="ts">
  import { type BarSeries, type BarTooltipProps, format_num } from '$lib'
  import { format_value } from '$lib/labels'
  import { BarPlot } from '$lib/plot'
  import type { CrystalSystem } from '$lib/symmetry'
  import {
    CRYSTAL_SYSTEM_COLORS,
    CRYSTAL_SYSTEM_RANGES,
    CRYSTAL_SYSTEMS,
  } from '$lib/symmetry'
  import {
    normalize_spacegroup,
    SPACEGROUP_NUM_TO_SYMBOL,
    spacegroup_to_crystal_system,
  } from '$lib/symmetry/spacegroups'
  import type { ComponentProps } from 'svelte'
  import { SvelteMap } from 'svelte/reactivity'

  const MAX_SPACEGROUP = 230

  let {
    data,
    show_counts = true,
    orientation = `vertical`,
    x_axis = {},
    y_axis = {},
    ...rest
  }: ComponentProps<typeof BarPlot> & {
    data: (number | string)[]
    show_counts?: boolean
  } = $props()

  // Normalize input data to space group numbers
  const normalized_data = $derived(
    data.map((sg) => normalize_spacegroup(sg)).filter((sg): sg is number =>
      sg !== null
    ),
  )

  // Compute histogram of space group numbers
  const histogram = $derived.by(() => {
    const hist = new SvelteMap<number, number>()

    // Count occurrences
    for (const sg of normalized_data) {
      hist.set(sg, (hist.get(sg) ?? 0) + 1)
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
    const non_zero_count = sorted_spacegroups.filter(
      (sg) => (histogram.get(sg) ?? 0) > 0,
    ).length

    // If data is dense (>40 space groups with data), show only multiples of 5
    return non_zero_count > 40
      ? sorted_spacegroups.filter((sg) => sg % 5 === 0)
      : sorted_spacegroups
  })

  // Build BarSeries - one series per crystal system for proper coloring
  const bar_series = $derived.by<BarSeries[]>(() => {
    const series_by_system = new SvelteMap<
      CrystalSystem,
      { x: number[]; y: number[] }
    >()

    // Group data by crystal system
    for (const sg of sorted_spacegroups) {
      const system = spacegroup_to_crystal_system(sg)
      if (system) {
        let series = series_by_system.get(system)
        if (!series) {
          series = { x: [], y: [] }
          series_by_system.set(system, series)
        }
        series.x.push(sg)
        series.y.push(histogram.get(sg) ?? 0)
      }
    }

    // Convert to BarSeries array, maintaining order of crystal systems
    const result: BarSeries[] = []
    for (const system of CRYSTAL_SYSTEMS) {
      const data = series_by_system.get(system)
      if (data) {
        const { x, y } = data
        const color = CRYSTAL_SYSTEM_COLORS[system]
        result.push({ x, y, color, label: system, bar_width: 0.9, visible: true })
      }
    }
    return result
  })

  // Always show full space group range (1-230)
  const x_range: [number, number] = [0.5, MAX_SPACEGROUP + 0.5]

  // Calculate crystal system region boundaries using full theoretical ranges
  const crystal_system_regions = $derived.by(() => {
    const [range_min, range_max] = x_range

    return CRYSTAL_SYSTEMS.map((system) => {
      const [sg_start, sg_end] = CRYSTAL_SYSTEM_RANGES[system]
      const stats = crystal_system_stats.get(system)
      const count = stats?.count ?? 0
      const color = CRYSTAL_SYSTEM_COLORS[system]
      return { system, sg_start, sg_end, count, color }
    }).filter(
      (region) => region.sg_end >= range_min && region.sg_start <= range_max, // Only visible systems
    )
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
  {@const { x: sg, y: count } = info}
  {@const system = spacegroup_to_crystal_system(sg)}
  Space Group: {format_value(sg, `.0f`)} ({SPACEGROUP_NUM_TO_SYMBOL[sg]})<br />
  {#if system}
    Crystal System: {system}<br />
  {/if}
  Count: {format_value(count, `.0f`)}
{/snippet}

{#snippet user_content({ width, height, x_scale_fn, y_scale_fn, pad }: {
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
        <!-- Crystal system label (rotated 90 degrees) at top edge -->
        <text
          x={x_center}
          y={pad.t + 15}
          text-anchor="start"
          font-size="14"
          fill="var(--text-color, black)"
          opacity="0.6"
          transform="rotate(90, {x_center}, {pad.t + 15})"
        >
          {region.system}
        </text>
        <!-- Count annotation at top -->
        {#if show_counts && total_count > 0}
          {@const y_offset = region.system === `triclinic` ? -20 : -5}
          <text
            x={x_center}
            y={pad.t + y_offset}
            text-anchor="middle"
            font-size="12"
            fill="var(--text-color, black)"
          >
            {format_num(region.count, `,~`)} ({
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
        <!-- Crystal system label (horizontal) at left edge -->
        <text
          x={width - pad.r - 8}
          y={y_center}
          text-anchor="end"
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
            {format_num(region.count, `,~`)} ({
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
