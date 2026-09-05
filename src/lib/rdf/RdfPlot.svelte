<script lang="ts">
  import { plot_color } from '$lib/colors'
  import { get_electro_neg_formula } from '$lib/composition'
  import { StatusMessage } from 'svelte-widgets'
  import type { FileLoadCallback } from '$lib/io'
  import { as_text, file_drop_zone } from '$lib/io'
  import { plural } from '$lib/labels'
  import { array_max } from '$lib/math'
  import type { DataSeries, RefLine } from '$lib/plot'
  import { ScatterPlot } from '$lib/plot'
  import type { Crystal, Pbc } from '$lib/structure'
  import { parse_structure_file } from '$lib/structure/parse'
  import { is_crystal } from '$lib/structure/validation'
  import { to_error } from '$lib/utils'
  import type { ComponentProps, Snippet } from 'svelte'
  import {
    calculate_all_pair_rdfs,
    calculate_rdf,
    label_structures,
    rdf_baseline,
  } from './index'
  import type { RdfEntry } from './index'

  let {
    patterns,
    structures,
    mode = `element_pairs`,
    show_reference_line = true,
    x_axis = {},
    y_axis = {},
    cutoff = 15,
    n_bins = 75,
    pbc,
    allow_file_drop = true,
    on_file_drop,
    loading = $bindable(false),
    error_msg = $bindable(),
    children,
    drag_dropped = $bindable([]),
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    ...rest
  }: {
    patterns?: RdfEntry | RdfEntry[]
    structures?: Crystal | Crystal[] | Record<string, Crystal>
    mode?: `element_pairs` | `full`
    show_reference_line?: boolean
    cutoff?: number
    n_bins?: number
    pbc?: Pbc
    allow_file_drop?: boolean
    // Replaces the built-in "parse as a crystal and plot it" handling of dropped files
    on_file_drop?: FileLoadCallback
    loading?: boolean
    error_msg?: string
    children?: Snippet<[{ drag_dropped: Crystal[] }]>
    drag_dropped?: Crystal[]
  } & ComponentProps<typeof ScatterPlot> = $props()

  const drop_zone = file_drop_zone({
    allow: () => allow_file_drop,
    on_drop: (content, filename, metadata) => {
      if (on_file_drop) return on_file_drop(content, filename, metadata)
      try {
        const structure = parse_structure_file(as_text(content), filename)
        // an RDF needs a cell to normalise against, so a lattice-less molecule is rejected
        if (is_crystal(structure)) drag_dropped = [...drag_dropped, structure]
        else error_msg = `${filename} has no lattice or sites; cannot compute an RDF`
      } catch (exc) {
        error_msg = `Failed to process structure: ${to_error(exc).message}`
      }
    },
    on_error: (msg) => (error_msg = msg),
    set_loading: (val) => {
      loading = val
      if (val) error_msg = undefined
    },
  })

  const entries = $derived.by(() => {
    // Normalize structures prop (single, array, or dict) plus dropped files to labeled list
    const struct_list = [
      ...label_structures(structures),
      ...drag_dropped.map((struct, idx) => ({ struct, label: `Dropped ${idx + 1}` })),
    ].map(({ struct, label }) => {
      const formula = get_electro_neg_formula(struct)
      return { struct, label: formula && label ? `${formula}: ${label}` : formula || label }
    })

    const computed = struct_list.flatMap(({ struct, label }): RdfEntry[] => {
      const options = { cutoff, n_bins, pbc }
      if (mode === `full`) return [{ label, pattern: calculate_rdf(struct, options) }]
      return calculate_all_pair_rdfs(struct, options).map((pair) => ({
        label: pair.element_pair?.join(`-`) ?? label,
        legend_group: label, // Group by structure name for multi-structure plots
        pattern: pair,
      }))
    })
    // Explicitly supplied patterns come first, in the order they were given
    return [...(patterns ? [patterns].flat() : []), ...computed]
  })

  // array_max per curve, not Math.max(...all): a fine RDF grid over many pairs blows the
  // argument limit, and flattening every curve into one array to reduce it is wasted copies
  const max_r = $derived(
    entries.reduce((max, { pattern }) => Math.max(max, array_max(pattern.r)), 0),
  )
  const max_g = $derived(
    entries.reduce((max, { pattern }) => Math.max(max, array_max(pattern.g_r)), 1.2),
  )
  const series = $derived<DataSeries[]>(
    entries.map((entry, idx) => ({
      x: entry.pattern.r,
      y: entry.pattern.g_r,
      label: entry.label,
      legend_group: entry.legend_group,
      visible: mode === `element_pairs` ? idx < 3 : true,
      markers: `line` as const,
      line_style: {
        stroke: entry.color ?? plot_color(idx),
        stroke_width: 2,
      },
    })),
  )
  const ref_lines = $derived<RefLine[]>([
    ...(show_reference_line ? [rdf_baseline(`g_r`)] : []),
    ...(rest.ref_lines ?? []),
  ])
</script>

<StatusMessage bind:message={error_msg} type="error" dismissible />

{#if allow_file_drop && drag_dropped.length > 0}
  <div class="dropped-info">
    {plural(drag_dropped.length, `structure`)} loaded
    <button onclick={() => (drag_dropped = [])}>Clear</button>
  </div>
{/if}

{#if series.length === 0}
  <div class="empty-drop" {@attach drop_zone}>
    <StatusMessage
      message={allow_file_drop
        ? `Drag and drop structure files here to visualize RDFs`
        : `No RDF data to display`}
      style="border: none"
    />
  </div>
{:else}
  <ScatterPlot
    {...rest}
    bind:show_controls
    bind:controls_open
    {series}
    {ref_lines}
    x_axis={{ label: `r (Å)`, range: [0, max_r], ...x_axis }}
    y_axis={{ label: `g(r)`, range: [0, max_g * 1.05], ...y_axis }}
    styles={{ show_lines: true, show_points: false }}
    style={rest.style ?? `height: 400px;`}
    {@attach drop_zone}
  >
    {@render children?.({ drag_dropped })}
  </ScatterPlot>
{/if}

<style>
  :global(.dragover) {
    outline: 2px dashed var(--accent-color, #4e79a7);
    outline-offset: 4px;
  }
  .empty-drop {
    outline: 2px dashed var(--border-color, #ccc);
    border-radius: var(--border-radius, 3pt);
    text-align: center;
  }
  .dropped-info {
    padding: 0.5em;
    margin-bottom: 0.5em;
    background: var(--surface-bg, rgba(128, 128, 128, 0.1));
    border-radius: 4px;
    button {
      margin-left: 1em;
      padding: 0.25em 0.75em;
      background: var(--btn-bg, rgba(128, 128, 128, 0.2));
      border: 1px solid var(--border-color, #ccc);
      border-radius: 3px;
      cursor: pointer;
      &:hover {
        background: var(--btn-bg-hover, rgba(128, 128, 128, 0.3));
      }
    }
  }
</style>
