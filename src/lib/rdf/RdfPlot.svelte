<script lang="ts">
  import type { ScatterPlotOptions, DataSeries, RefLine } from '#lib/plot/index.js'
  import { plot_color } from '#lib/colors/index.js'
  import { get_electro_neg_formula } from '#lib/composition/index.js'
  import StatusMessage from 'svelte-widgets/StatusMessage.svelte'
  import type { FileLoadCallback } from '#lib/io/index.js'
  import { as_text, file_drop_zone } from '#lib/io/index.js'
  import { plural } from '#lib/labels.js'
  import { array_max } from '#lib/math.js'
  import { ScatterPlot } from '#lib/plot/index.js'
  import type { StructureSiteHighlight } from '#lib/plot/core/structure-input.js'
  import type { Crystal, Pbc } from '#lib/structure/index.js'
  import { parse_structure_file } from '#lib/structure/parse.js'
  import { is_crystal } from '#lib/structure/validation.js'
  import { element_site_indices } from '#lib/trajectory/linked-sites.js'
  import { to_error } from '#lib/utils.js'
  import type { Snippet } from 'svelte'
  import { series_hover_props } from '#lib/plot/core/interactions.js'
  import {
    calculate_all_pair_rdfs,
    calculate_rdf,
    label_structures,
    rdf_baseline,
    rdf_bin_sites,
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
    loading_message = `Reading dropped file…`,
    error_msg = $bindable(),
    children,
    drag_dropped = $bindable([]),
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    on_bin_hover,
    on_sites_hover,
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
    // Empty-state text while `loading`
    loading_message?: string
    error_msg?: string
    children?: Snippet<[{ drag_dropped: Crystal[] }]>
    drag_dropped?: Crystal[]
    // Hovered curve and r-grid bin (null for its legend entry); null once the pointer leaves
    on_bin_hover?: (hover: { entry: RdfEntry; bin_idx: number | null } | null) => void
    // Atoms behind the hovered curve of a structure computed here (not `patterns`): for an r
    // bin, the centres (site_indices) and partners (neighbor_indices) of its pairs, found on
    // hover so RDFs never store pair lists; for a legend entry, every atom of its element pair
    on_sites_hover?: (highlights: StructureSiteHighlight[] | null) => void
  } & Omit<ScatterPlotOptions, `children`> = $props()

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

  // Each plotted entry with the structure it was computed from (none for `patterns`)
  const sourced = $derived.by((): { entry: RdfEntry; structure?: Crystal }[] => {
    // Normalize structures prop (single, array, or dict) plus dropped files to labeled list
    const struct_list = [
      ...label_structures(structures),
      ...drag_dropped.map((struct, idx) => ({ struct, label: `Dropped ${idx + 1}` })),
    ].map(({ struct: structure, label }) => {
      const formula = get_electro_neg_formula(structure)
      return { structure, label: formula && label ? `${formula}: ${label}` : formula || label }
    })

    const computed = struct_list.flatMap(({ structure, label }) => {
      const options = { cutoff, n_bins, pbc }
      if (mode === `full`)
        return [{ entry: { label, pattern: calculate_rdf(structure, options) }, structure }]
      return calculate_all_pair_rdfs(structure, options).map((pair) => ({
        entry: {
          label: pair.element_pair?.join(`-`) ?? label,
          legend_group: label, // Group by structure name for multi-structure plots
          pattern: pair,
        },
        structure,
      }))
    })
    // Explicitly supplied patterns come first, in the order they were given
    return [...(patterns ? [patterns].flat() : []).map((entry) => ({ entry })), ...computed]
  })
  const entries = $derived(sourced.map(({ entry }) => entry))

  // Sites behind a hovered curve point (an r bin) or legend entry (bin_idx null)
  const hovered_sites = (entry_idx: number, bin_idx: number | null) => {
    const { entry, structure } = sourced[entry_idx]
    if (!structure) return null
    const label = entry.legend_group ?? entry.label
    const pair = entry.pattern.element_pair
    if (bin_idx !== null) {
      const options = { cutoff, n_bins, pbc, bin_idx, element_pair: pair }
      const { site_indices, neighbor_indices } = rdf_bin_sites(structure, options)
      return [{ label, structure, site_indices, neighbor_indices }]
    }
    // the full RDF's legend entry stands for every atom, which highlights nothing useful
    return pair
      ? [{ label, structure, site_indices: element_site_indices(structure, pair) }]
      : null
  }
  // Pointer moves within one bin repeat the same hover, so only a change is reported (and,
  // for on_sites_hover, recomputed)
  let last_hover_key: string | null = null
  const report_hover = (entry_idx: number | null, bin_idx: number | null): void => {
    const key = entry_idx === null ? null : `${entry_idx}:${bin_idx}`
    if (key === last_hover_key) return
    last_hover_key = key
    on_bin_hover?.(entry_idx === null ? null : { entry: entries[entry_idx], bin_idx })
    on_sites_hover?.(entry_idx === null ? null : hovered_sites(entry_idx, bin_idx))
  }
  const hover_props = $derived<Pick<ScatterPlotOptions, `on_point_hover` | `legend`>>(
    on_bin_hover || on_sites_hover
      ? {
          ...series_hover_props((series_idx) => report_hover(series_idx, null), rest),
          on_point_hover: (event) => {
            report_hover(event?.series_idx ?? null, event?.point.point_idx ?? null)
            rest.on_point_hover?.(event)
          },
        }
      : {},
  )

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
      message={loading
        ? loading_message
        : allow_file_drop
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
    styles={{ show_lines: true, show_points: false, ...rest.styles }}
    style={rest.style ?? `height: 400px;`}
    {...hover_props}
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
