<script lang="ts">
  import type {
    AnyStructure,
    AxisConfig,
    BarSeries,
    BarTooltipProps,
    Orientation,
  } from '$lib'
  import { plot_colors } from '$lib/colors'
  import { decompress_file, handle_url_drop } from '$lib/io'
  import { format_value } from '$lib/labels'
  import { BarPlot } from '$lib/plot'
  import { parse_any_structure } from '$lib/structure/parse'
  import type { ComponentProps } from 'svelte'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'
  import {
    calc_coordination_numbers,
    type CoordinationData,
    type CoordinationStrategy,
  } from './calc-coordination'
  import type { SplitMode } from './index'

  interface StructureEntry {
    label: string
    structure: AnyStructure
    color?: string
    data?: CoordinationData
  }
  let {
    structures,
    strategy = `nearest_neighbor`,
    split_mode = `by_element`,
    mode = $bindable(`grouped`),
    orientation = `vertical` as Orientation,
    x_axis = $bindable({ label: `Coordination Number`, format: `d` }),
    y_axis = $bindable({ label: `Count`, format: `d` }),
    allow_file_drop = true,
    on_file_drop,
    loading = $bindable(false),
    error_msg = $bindable(undefined),
    ...rest
  }: ComponentProps<typeof BarPlot> & {
    structures:
      | AnyStructure
      | Record<string, AnyStructure | { structure: AnyStructure; color?: string }>
      | StructureEntry[]
    strategy?: CoordinationStrategy
    split_mode?: SplitMode
    x_axis?: AxisConfig
    y_axis?: AxisConfig
    allow_file_drop?: boolean
    on_file_drop?: (content: string | ArrayBuffer, filename: string) => void
    loading?: boolean
    error_msg?: string
  } = $props()

  let dragover = $state(false)
  let dropped_entries = $state<StructureEntry[]>([])

  // Normalize input to consistent array of { label, structure, color }
  const structure_entries = $derived.by<StructureEntry[]>(() => {
    if (!structures) return []

    const base_entries = Array.isArray(structures)
      ? (structures as StructureEntry[])
      : (`sites` in structures
        ? [{ label: `Structure`, structure: structures as AnyStructure }]
        : Object.entries(
          structures as Record<
            string,
            AnyStructure | { structure: AnyStructure; color?: string }
          >,
        ).map(([label, value]) =>
          `structure` in value
            ? { label, ...value }
            : { label, structure: value as AnyStructure }
        ))

    // Merge user-provided structures with dropped structures
    return [...base_entries, ...dropped_entries]
  })

  // Compute coordination data for each structure
  const entries_with_data = $derived(structure_entries.map((entry) => ({
    ...entry,
    data: calc_coordination_numbers(entry.structure, strategy),
  })))

  // Compute appropriate ranges
  const ranges = $derived.by(() => {
    // CN axis should always start at 0 and show at least [0,4]
    let max_cn = 4 // minimum max value
    for (const entry of entries_with_data) {
      for (const [cn] of entry.data.cn_histogram) max_cn = Math.max(max_cn, cn)
    }
    const cn_range: [number, number] = [-0.5, max_cn + 0.5]

    return { count: [0, null] as [number, null], cn: cn_range } // Count axis should always start at 0
  })

  // Derive integer CN ticks for axis labels
  const cn_ticks = $derived.by(() => {
    const all_cns = new SvelteSet<number>()
    // Always include minimum CN values 0-4
    for (let idx = 0; idx <= 4; idx++) all_cns.add(idx)
    // Add actual CN values from data
    for (const entry of entries_with_data) {
      for (const [cn] of entry.data.cn_histogram) all_cns.add(cn)
    }
    return Array.from(all_cns).sort((cn1, cn2) => cn1 - cn2)
  })

  // Build BarPlot series based on split_mode
  const bar_series = $derived.by<BarSeries[]>(() => {
    if (split_mode === `by_element`) {
      // One series per element across all structures
      const element_series_map = new SvelteMap<string, Map<number, number>>()

      // Collect all unique CNs across all elements
      const all_cns = new SvelteSet<number>()

      for (const entry of entries_with_data) {
        for (const [element, cn_histogram] of entry.data.cn_histogram_by_element) {
          if (!element_series_map.has(element)) {
            element_series_map.set(element, new SvelteMap())
          }
          const element_map = element_series_map.get(element)!

          for (const [cn, count] of cn_histogram) {
            all_cns.add(cn)
            element_map.set(cn, (element_map.get(cn) ?? 0) + count)
          }
        }
      }

      // Sort CNs for consistent x-axis
      const sorted_cns = Array.from(all_cns).sort((a, b) => a - b)

      // Convert map to array and ensure all series have same x-values
      return Array.from(element_series_map.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([element, cn_map], idx) => {
          return {
            x: sorted_cns,
            y: sorted_cns.map((cn) => cn_map.get(cn) ?? 0),
            label: element,
            color: plot_colors[idx % plot_colors.length],
            bar_width: 0.8,
            visible: true,
            metadata: { element },
          }
        })
    } else if (split_mode === `by_structure`) {
      // One series per structure
      // First collect all unique CNs
      const all_cns = new SvelteSet<number>()
      for (const entry of entries_with_data) {
        for (const [cn] of entry.data.cn_histogram) {
          all_cns.add(cn)
        }
      }
      const sorted_cns = Array.from(all_cns).sort((a, b) => a - b)

      return entries_with_data.map((entry, idx) => {
        return {
          x: sorted_cns,
          y: sorted_cns.map((cn) => entry.data.cn_histogram.get(cn) ?? 0),
          label: entry.label,
          color: entry.color ?? plot_colors[idx % plot_colors.length],
          bar_width: 0.8,
          visible: true,
          metadata: { structure_label: entry.label },
        }
      })
    } else {
      // split_mode === 'none': combine all into single series
      const combined_histogram = new SvelteMap<number, number>()

      for (const entry of entries_with_data) {
        for (const [cn, count] of entry.data.cn_histogram) {
          combined_histogram.set(cn, (combined_histogram.get(cn) ?? 0) + count)
        }
      }

      const x_vals = Array.from(combined_histogram.keys()).sort((a, b) => a - b)
      const y_vals = x_vals.map((cn) => combined_histogram.get(cn)!)

      return [
        {
          x: x_vals,
          y: y_vals,
          label: `All Sites`,
          color: plot_colors[0],
          bar_width: 0.8,
          visible: true,
          metadata: {},
        },
      ]
    }
  })

  async function handle_file_drop(event: DragEvent) {
    event.preventDefault()
    dragover = false
    if (!allow_file_drop) return
    loading = true
    error_msg = undefined

    const compute_and_add = (content: string | ArrayBuffer, filename: string) => {
      try {
        const text_content = content instanceof ArrayBuffer
          ? new TextDecoder().decode(content)
          : content
        const parsed_structure = parse_any_structure(text_content, filename)
        if (parsed_structure && `lattice` in parsed_structure) {
          const label = filename || `Dropped structure`
          // Prepend latest dropped structure for visibility
          dropped_entries = [
            { label, structure: parsed_structure },
            ...dropped_entries,
          ]
        } else if (parsed_structure && !(`lattice` in parsed_structure)) {
          error_msg = `Structure has no lattice; cannot compute coordination`
        } else {
          error_msg = `Failed to parse structure from ${filename}`
        }
      } catch (exc) {
        error_msg = `Failed to process structure: ${
          exc instanceof Error ? exc.message : String(exc)
        }`
      }
    }

    try {
      // Handle URL-based drops
      const handled = await handle_url_drop(event, on_file_drop || compute_and_add)
        .catch(
          () => false,
        )
      if (handled) return

      // Handle file system drops
      const file = event.dataTransfer?.files?.[0]
      if (file) {
        try {
          const { content, filename } = await decompress_file(file)
          if (content) (on_file_drop || compute_and_add)(content, filename)
        } catch (exc) {
          error_msg = `Failed to load file ${file.name}: ${
            exc instanceof Error ? exc.message : String(exc)
          }`
        }
      }
    } finally {
      loading = false
    }
  }
</script>

{#snippet tooltip(info: BarTooltipProps)}
  {@const cn = info.x}
  {@const count = info.y}
  {@const element = info.metadata?.element as string | undefined}
  {@const structure_label = info.metadata?.structure_label as string | undefined}
  {#if element}
    {element} —
  {/if}
  {#if structure_label}
    {structure_label} —
  {/if}
  CN: {format_value(cn, `.0f`)}
  <br />
  Sites: {format_value(count, `.0f`)}
{/snippet}

<BarPlot
  {...rest}
  series={bar_series}
  bind:orientation
  bind:mode
  x_axis={{
    label_shift: { y: 20 },
    range: orientation === `horizontal` ? ranges.count : ranges.cn,
    ticks: orientation === `horizontal` ? undefined : cn_ticks,
    ...(orientation === `horizontal` ? y_axis : x_axis),
  }}
  y_axis={{
    label_shift: { x: 2 },
    range: orientation === `horizontal` ? ranges.cn : ranges.count,
    ticks: orientation === `horizontal` ? cn_ticks : undefined,
    ...orientation === `horizontal` ? x_axis : y_axis,
  }}
  display={{
    x_zero_line: orientation === `horizontal`,
    y_zero_line: orientation === `vertical`,
  }}
  {tooltip}
  ondrop={handle_file_drop}
  ondragover={(event) => {
    event.preventDefault()
    if (!allow_file_drop) return
    dragover = true
  }}
  ondragleave={(event) => {
    event.preventDefault()
    dragover = false
  }}
  class={(rest.class ?? ``) + (dragover ? ` dragover` : ``)}
/>
