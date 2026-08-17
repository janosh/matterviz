<script lang="ts">
  import { PLOT_COLORS } from '$lib/colors'
  import { get_electro_neg_formula } from '$lib/composition'
  import { StatusMessage } from '$lib/feedback'
  import { drag_over_handlers, type FileLoadCallback } from '$lib/io'
  import type { DataSeries } from '$lib/plot'
  import { ScatterPlot } from '$lib/plot'
  import { create_structure_drop_handler } from '$lib/plot/core/structure-input'
  import type { Crystal, Pbc } from '$lib/structure'
  import { is_crystal } from '$lib/structure/validation'
  import type { ComponentProps, Snippet } from 'svelte'
  import BaselineLine from './BaselineLine.svelte'
  import { calculate_all_pair_rdfs, calculate_rdf, label_structures } from './index'
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
    dragover = $bindable(false),
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
    on_file_drop?: FileLoadCallback
    loading?: boolean
    error_msg?: string
    children?: Snippet<[{ drag_dropped: Crystal[] }]>
    drag_dropped?: Crystal[]
    dragover?: boolean
    // Redundant for TS (the intersection below already supplies them) but load-bearing for
    // the Dash wrapper generator, which reads this literal and drops anything not in it
    x_axis?: ComponentProps<typeof ScatterPlot>[`x_axis`]
    y_axis?: ComponentProps<typeof ScatterPlot>[`y_axis`]
    show_controls?: ComponentProps<typeof ScatterPlot>[`show_controls`]
    controls_open?: ComponentProps<typeof ScatterPlot>[`controls_open`]
    controls_toggle_props?: ComponentProps<typeof ScatterPlot>[`controls_toggle_props`]
    controls_pane_props?: ComponentProps<typeof ScatterPlot>[`controls_pane_props`]
  } & ComponentProps<typeof ScatterPlot> = $props()

  const handle_drop = create_structure_drop_handler({
    allow: () => allow_file_drop,
    on_file_drop: () => on_file_drop,
    // an RDF needs a cell to normalise against, so a lattice-less molecule is rejected here
    // rather than in the shared handler, which only insists on sites
    on_entry: ({ structure }) => {
      if (is_crystal(structure)) drag_dropped = [...drag_dropped, structure]
      else error_msg = `Crystal has no lattice or sites; cannot compute RDF`
    },
    on_error: (msg) => {
      error_msg = msg
    },
    set_loading: (val) => {
      loading = val
      if (val) [error_msg, dragover] = [undefined, false]
    },
  })

  const set_dragover = (over: boolean) => (dragover = over)
  const drop_zone = {
    ondrop: handle_drop,
    ...drag_over_handlers({ allow: () => allow_file_drop, set_dragover }),
  }

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

  const max_r = $derived(Math.max(...entries.flatMap((entry) => entry.pattern.r), 0))
  const max_g = $derived(Math.max(1.2, ...entries.flatMap((entry) => entry.pattern.g_r)))
  const series = $derived<DataSeries[]>(
    entries.map((entry, idx) => ({
      x: entry.pattern.r,
      y: entry.pattern.g_r,
      label: entry.label,
      legend_group: entry.legend_group,
      visible: mode === `element_pairs` ? idx < 3 : true,
      markers: `line` as const,
      line_style: {
        stroke: entry.color ?? PLOT_COLORS[idx % PLOT_COLORS.length],
        stroke_width: 2,
      },
    })),
  )
</script>

<StatusMessage bind:message={error_msg} type="error" dismissible />

{#if allow_file_drop && drag_dropped.length > 0}
  <div class="dropped-info">
    {drag_dropped.length} structure{drag_dropped.length > 1 ? `s` : ``} loaded
    <button onclick={() => (drag_dropped = [])}>Clear</button>
  </div>
{/if}

{#if series.length === 0}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class={[`empty-drop`, dragover && `dragover`]} {...drop_zone}>
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
    x_axis={{ label: `r (Å)`, range: [0, max_r], ...x_axis }}
    y_axis={{ label: `g(r)`, range: [0, max_g * 1.05], ...y_axis }}
    styles={{ show_lines: true, show_points: false }}
    class={[rest.class, dragover && `dragover`]}
    style={rest.style ?? `height: 400px;`}
    {...drop_zone}
  >
    {#snippet user_content({ width, y_scale_fn, pad })}
      {#if show_reference_line}
        <BaselineLine {width} {pad} y_value={y_scale_fn(1)} label="g(r) = 1" />
      {/if}
    {/snippet}

    {@render children?.({ drag_dropped })}
  </ScatterPlot>
{/if}

<style>
  :global(.dragover) {
    outline: 2px dashed #4e79a7;
    outline-offset: 4px;
  }
  .empty-drop {
    outline: 2px dashed #ccc;
    border-radius: var(--border-radius, 3pt);
    text-align: center;
  }
  .dropped-info {
    padding: 0.5em;
    margin-bottom: 0.5em;
    background: #f0f0f0;
    border-radius: 4px;
  }
  button {
    margin-left: 1em;
    padding: 0.25em 0.75em;
    background: #e0e0e0;
    border: 1px solid #ccc;
    border-radius: 3px;
    cursor: pointer;
  }
  button:hover {
    background: #d0d0d0;
  }
</style>
