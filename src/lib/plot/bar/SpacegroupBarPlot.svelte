<script lang="ts">
  import { format_num, format_value } from '$lib/labels'
  import type { Vec2 } from '$lib/math'
  import type { BarHandlerProps, BarSeries, TickConfig } from '$lib/plot'
  import { BarPlot } from '$lib/plot'
  import { DEFAULT_PLOT_PADDING } from '$lib/plot/core/layout'
  import { observe_size } from '$lib/plot/core/utils'
  import type { CrystalSystem } from '$lib/symmetry'
  import * as symmetry from '$lib/symmetry'
  import * as spg from '$lib/symmetry/spacegroups'
  import type { ComponentProps } from 'svelte'
  import { SvelteMap } from 'svelte/reactivity'

  // Merge tick config with default rotation, preserving user overrides
  const with_rotation = (tick: TickConfig | undefined, default_rot: number): TickConfig => ({
    ...tick,
    label: { ...tick?.label, rotation: tick?.label?.rotation ?? default_rot },
  })

  const MAX_SPACEGROUP = 230
  const TICK_LABEL_HEIGHT_PX = 14 // 12px rotated tick label plus breathing room
  const COUNT_LABEL_CHAR_PX = 6.4 // mean glyph advance of the 12px count annotation
  const COUNT_LABEL_ROW_PX = 14
  const COUNT_LABEL_MAX_ROWS = 3
  let {
    data,
    show_counts = true,
    show_legend = false,
    orientation = `vertical`,
    x_axis = {},
    y_axis = {},
    padding = {},
    ...rest
  }: ComponentProps<typeof BarPlot> & {
    data: (number | string)[]
    show_counts?: boolean
  } = $props()

  // Normalize input data to space group numbers
  const normalized_data = $derived(
    data.map(spg.normalize_spacegroup).filter((sg): sg is number => sg !== null),
  )

  // Histogram of space group number counts
  const histogram = $derived.by(() => {
    const hist = new SvelteMap<number, number>()
    for (const sg of normalized_data) hist.set(sg, (hist.get(sg) ?? 0) + 1)
    return hist
  })

  // Total counts per crystal system
  const crystal_system_counts = $derived.by(() => {
    const counts = new SvelteMap<CrystalSystem, number>()
    for (const [sg, count] of histogram) {
      const system = spg.spacegroup_to_crystal_sys(sg)
      if (system) counts.set(system, (counts.get(system) ?? 0) + count)
    }
    return counts
  })

  // Create sorted list of space groups for x-axis
  const sorted_spacegroups = $derived(Array.from(histogram.keys()).toSorted((a, b) => a - b))

  // Always show full space group range (1-230)
  const x_range: Vec2 = [0.5, MAX_SPACEGROUP + 0.5]

  // Rendered width of the plot, observed on the root element. Tick thinning and count
  // annotation rows depend on pixel spacing, which the data alone can't tell us.
  let plot_width = $state(0)
  const observe_width = observe_size(({ width }) => (plot_width = width))
  // Approximate data-space width of one px along the spacegroup axis, from the default
  // frame padding; the real scale only enters in user_content. Worst case the estimate
  // is off by a few px per label, which the collision gap absorbs.
  const sg_per_px = $derived(
    MAX_SPACEGROUP /
      Math.max(
        plot_width -
          (padding.l ?? DEFAULT_PLOT_PADDING.l) -
          (padding.r ?? DEFAULT_PLOT_PADDING.r),
        1,
      ),
  )

  // Smart tick selection: thin out ticks for dense data
  const x_axis_ticks = $derived.by(() => {
    const non_zero_count = sorted_spacegroups.filter(
      (sg) => (histogram.get(sg) ?? 0) > 0,
    ).length

    // If data is dense (>40 space groups with data), show only multiples of 5
    const candidates =
      non_zero_count > 40
        ? sorted_spacegroups.filter((sg) => sg % 5 === 0)
        : sorted_spacegroups
    // Vertical ticks are rotated 90°, so each label needs ~one line height along the
    // axis. Greedily drop ticks that would land on the previous kept label. (Horizontal
    // puts spacegroups on the y axis, whose length we don't observe.)
    const min_gap =
      orientation === `vertical` && plot_width ? TICK_LABEL_HEIGHT_PX * sg_per_px : 0
    let last_kept = -Infinity
    return candidates.filter((sg) => {
      if (sg - last_kept < min_gap) return false
      last_kept = sg
      return true
    })
  })

  // Build BarSeries - one series per crystal system for proper coloring
  const bar_series = $derived.by<BarSeries[]>(() => {
    const series_by_system = new SvelteMap<CrystalSystem, { x: number[]; y: number[] }>()

    // Group data by crystal system
    for (const sg of sorted_spacegroups) {
      const system = spg.spacegroup_to_crystal_sys(sg)
      if (!system) continue
      let series = series_by_system.get(system)
      if (!series) series_by_system.set(system, (series = { x: [], y: [] }))
      series.x.push(sg)
      series.y.push(histogram.get(sg) ?? 0)
    }

    // Convert to BarSeries array, maintaining order of crystal systems
    return symmetry.CRYSTAL_SYSTEMS.flatMap((system) => {
      const system_data = series_by_system.get(system)
      if (!system_data) return []
      const color = symmetry.CRYSTAL_SYSTEM_COLORS[system]
      return { ...system_data, color, label: system, bar_width: 0.9, visible: true }
    })
  })

  // Calculate crystal system region boundaries using full theoretical ranges
  const crystal_system_regions = $derived.by(() => {
    const [range_min, range_max] = x_range

    return symmetry.CRYSTAL_SYSTEMS.map((system) => {
      const [sg_start, sg_end] = symmetry.CRYSTAL_SYSTEM_RANGES[system]
      const count = crystal_system_counts.get(system) ?? 0
      const color = symmetry.CRYSTAL_SYSTEM_COLORS[system]
      return { system, sg_start, sg_end, count, color }
    }).filter(
      (region) => region.sg_end >= range_min && region.sg_start <= range_max, // Only visible systems
    )
  })

  const total_count = $derived(normalized_data.length)
  const count_label = (count: number) =>
    `${format_num(count, `,~`)} (${format_num(count / total_count, `.1~%`)})`

  // Count annotations sit above their crystal-system band. Narrow bands (triclinic is
  // 2 of 230 spacegroups) and narrow plots make neighbouring labels overlap, so each
  // label is bumped to the first of a few stacked rows where it doesn't collide with
  // the labels already placed. Returns system -> row, omitting labels that fit nowhere.
  const count_label_rows = $derived.by(() => {
    const rows = new SvelteMap<CrystalSystem, number>()
    if (orientation !== `vertical`) return rows
    const row_right_edges: number[] = Array(COUNT_LABEL_MAX_ROWS).fill(-Infinity)
    for (const region of crystal_system_regions) {
      const label = count_label(region.count)
      const half_width = (label.length * COUNT_LABEL_CHAR_PX) / 2
      const center = (region.sg_start + region.sg_end) / 2 / sg_per_px
      const row = row_right_edges.findIndex((right) => center - half_width > right)
      if (row === -1) continue
      row_right_edges[row] = center + half_width
      rows.set(region.system, row)
    }
    return rows
  })
  const extra_count_rows = $derived(Math.max(0, ...count_label_rows.values()))

  // Build axis configurations based on orientation
  const x_axis_config = $derived(
    orientation === `horizontal`
      ? { ...x_axis, label: x_axis.label ?? `Counts` }
      : {
          ...x_axis,
          label: x_axis.label ?? `International Spacegroup Number`,
          range: x_range,
          ticks: x_axis_ticks,
          tick: with_rotation(x_axis.tick, 90), // Rotate ticks 90° to avoid overlap
        },
  )

  const y_axis_config = $derived(
    orientation === `horizontal`
      ? {
          ...y_axis,
          label: y_axis.label ?? `International Spacegroup Number`,
          range: x_range,
          ticks: x_axis_ticks,
          tick: with_rotation(y_axis.tick, 0),
        }
      : { ...y_axis, label: y_axis.label ?? `Counts` },
  )
</script>

{#snippet tooltip(info: BarHandlerProps)}
  {@const { x: sg, y: count } = info}
  {@const system = spg.spacegroup_to_crystal_sys(sg)}
  Space Group: {format_value(sg, `.0f`)} ({spg.SPACEGROUP_NUM_TO_SYMBOL[sg]})<br />
  {#if system}
    Crystal System: {system}<br />
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
  <g class="crystal-system-overlays" pointer-events="none">
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
        <!-- Count annotation at top, stacked into rows where neighbours would overlap -->
        {#if show_counts && total_count > 0 && count_label_rows.has(region.system)}
          {@const label = count_label(region.count)}
          {@const half_width = (label.length * COUNT_LABEL_CHAR_PX) / 2}
          <text
            x={Math.min(Math.max(x_center, half_width), width - half_width)}
            y={pad.t - 5 - COUNT_LABEL_ROW_PX * (count_label_rows.get(region.system) ?? 0)}
            text-anchor="middle"
            font-size="12"
            fill="var(--text-color, black)"
          >
            {label}
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
            {count_label(region.count)}
          </text>
        {/if}
      {/if}
    {/each}
  </g>
{/snippet}

<BarPlot
  {@attach observe_width}
  {...rest}
  series={bar_series}
  {orientation}
  mode="overlay"
  padding={{
    ...padding,
    // room above the plot area for the stacked count annotations (rows are only computed for
    // vertical plots): the caller's top padding is a floor, never a cap, or the rows it was
    // computed for would overlap the bars
    t: Math.max(
      padding.t ?? 0,
      DEFAULT_PLOT_PADDING.t + (show_counts ? COUNT_LABEL_ROW_PX * extra_count_rows : 0),
    ),
  }}
  x_axis={x_axis_config}
  y_axis={y_axis_config}
  {show_legend}
  show_controls={false}
  {tooltip}
  {user_content}
/>
