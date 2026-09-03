<script lang="ts">
  import { plot_color } from '$lib/colors'
  import { format_value } from '$lib/labels'
  import type { Vec2 } from '$lib/math'
  import type { StructurePlotProps } from '$lib/plot/bar'
  import StructureBarPlot from '$lib/plot/bar/StructureBarPlot.svelte'
  import {
    compute_structure_entries,
    to_structure_entries,
  } from '$lib/plot/core/structure-input'
  import type { StructureEntry } from '$lib/plot/core/structure-input'
  import type { BarHandlerProps, BarSeries } from '$lib/plot/core/types'
  import { calc_coordination_nums } from './calc-coordination'
  import type { CoordinationSplitMode } from './index'

  // Series identity travels as string metadata, which StructureBarPlot turns into the tooltip
  // prefix; `element` and `structure_label` are only ever set one at a time.
  // The plot boundary widens to `unknown`: BarPlot's snippet prop is invariant in its
  // metadata type, so a narrower one here fails to satisfy it.
  type CoordinationMetadata = Record<string, string>
  type PlotMetadata = Record<string, unknown>
  type CnGroup = {
    label: string
    histogram: Map<number, number>
    color?: string
    metadata: CoordinationMetadata
  }

  let {
    structures,
    strategy = `electroneg_ratio`,
    split_mode = `by_element`,
    mode = $bindable(`grouped`),
    loading = $bindable(false),
    error_msg = $bindable(),
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    ...rest
  }: StructurePlotProps & { split_mode?: CoordinationSplitMode } = $props()

  let dropped_entries = $state<StructureEntry[]>([])

  // Bonded across each structure's own pbc, the same call the 3D viewer makes, so
  // boundary-atom coordination matches it. A structure the neighbor search rejects is
  // reported through error_msg rather than crashing the plot.
  const computed = $derived(
    compute_structure_entries(
      [...to_structure_entries(structures), ...dropped_entries],
      (structure) => calc_coordination_nums(structure, { strategy }),
    ),
  )
  $effect(() => {
    error_msg = computed.error
  })

  // Every split mode reduces to a list of CN->count histograms, one per series
  const groups = $derived.by<CnGroup[]>(() => {
    const entries_with_data = computed.entries
    if (split_mode === `by_element`) {
      // One series per element, summed across all structures
      const by_element = new Map<string, Map<number, number>>()
      for (const entry of entries_with_data) {
        for (const [element, histogram] of entry.data.cn_histogram_by_element) {
          let target = by_element.get(element)
          if (!target) by_element.set(element, (target = new Map()))
          for (const [cn, count] of histogram) target.set(cn, (target.get(cn) ?? 0) + count)
        }
      }
      return Array.from(by_element.entries())
        .toSorted(([elem_a], [elem_b]) => elem_a.localeCompare(elem_b))
        .map(([element, histogram]) => ({ label: element, histogram, metadata: { element } }))
    }
    if (split_mode === `by_structure`) {
      return entries_with_data.map((entry) => ({
        label: entry.label,
        histogram: entry.data.cn_histogram,
        color: entry.color,
        metadata: { structure_label: entry.label },
      }))
    }
    // split_mode === `none`: every site of every structure in one series
    const combined = new Map<number, number>()
    for (const entry of entries_with_data) {
      for (const [cn, count] of entry.data.cn_histogram) {
        combined.set(cn, (combined.get(cn) ?? 0) + count)
      }
    }
    return [{ label: `All Sites`, histogram: combined, metadata: {} }]
  })

  // All series share one x axis spanning the union of their CNs so grouped bars line up. Every
  // split mode partitions the same sites, so this union equals the one over cn_histogram.
  const cns = $derived.by(() => {
    const seen = new Set(groups.flatMap((group) => [...group.histogram.keys()]))
    return Array.from(seen).toSorted((cn1, cn2) => cn1 - cn2)
  })
  const bar_series = $derived<BarSeries<PlotMetadata>[]>(
    groups.map(({ label, histogram, color, metadata }, idx) => ({
      x: cns,
      y: cns.map((cn) => histogram.get(cn) ?? 0),
      label,
      color: color ?? plot_color(idx),
      bar_width: 0.8,
      visible: true,
      metadata,
    })),
  )

  // Axis ticks always show the minimum CN values 0-4, plus whatever the series reach
  const cn_ticks = $derived(
    Array.from(new Set([0, 1, 2, 3, 4, ...cns])).toSorted((cn1, cn2) => cn1 - cn2),
  )
  // CN axis spans all ticks with half-bar margin; count axis always starts at 0
  const cn_axis = $derived({
    label: `Coordination Number`,
    format: `d`,
    range: [-0.5, (cn_ticks.at(-1) ?? 4) + 0.5] as Vec2,
    ticks: cn_ticks,
  })
  const count_axis = { label: `Count`, format: `d`, range: [0, null] as [number, null] }
</script>

<StructureBarPlot
  {...rest}
  bind:show_controls
  bind:controls_open
  series={bar_series}
  primary_axis={cn_axis}
  value_axis={count_axis}
  subject="coordination numbers"
  empty_subject="coordination data"
  bind:dropped_entries
  bind:mode
  bind:loading
  bind:error_msg
>
  {#snippet tooltip(info: BarHandlerProps<PlotMetadata>)}
    CN: {format_value(info.x, `.0f`)}
    <br />
    Sites: {format_value(info.y, `.0f`)}
  {/snippet}
</StructureBarPlot>
