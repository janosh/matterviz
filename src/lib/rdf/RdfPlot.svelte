<script lang="ts">
  import { StatusMessage } from '$lib'
  import { plot_colors } from '$lib/colors'
  import { get_electro_neg_formula } from '$lib/composition'
  import { decompress_file, handle_url_drop } from '$lib/io'
  import type { DataSeries } from '$lib/plot'
  import { ScatterPlot } from '$lib/plot'
  import type { Pbc, PymatgenStructure as Structure } from '$lib/structure'
  import { parse_any_structure } from '$lib/structure/parse'
  import { is_valid_structure } from '$lib/structure/validation'
  import type { ComponentProps, Snippet } from 'svelte'
  import { calculate_all_pair_rdfs, calculate_rdf, type RdfEntry } from './index'

  let {
    patterns,
    structures,
    mode = `element_pairs`,
    show_reference_line = true,
    x_axis = {},
    y_axis = {},
    cutoff = 15,
    n_bins = 75,
    pbc = [true, true, true],
    enable_drop = false,
    on_file_drop,
    loading = $bindable(false),
    error_msg = $bindable(),
    children,
    ...rest
  }: {
    patterns?: RdfEntry | RdfEntry[]
    structures?: Structure | Structure[] | Record<string, Structure>
    mode?: `element_pairs` | `full`
    show_reference_line?: boolean
    x_axis?: ComponentProps<typeof ScatterPlot>[`x_axis`]
    y_axis?: ComponentProps<typeof ScatterPlot>[`y_axis`]
    cutoff?: number
    n_bins?: number
    pbc?: Pbc
    enable_drop?: boolean
    on_file_drop?: (content: string | ArrayBuffer, filename: string) => void
    loading?: boolean
    error_msg?: string
    children?: Snippet<[{ drag_dropped: Structure[] }]>
  } & ComponentProps<typeof ScatterPlot> = $props()

  // Set default axis labels if not provided
  x_axis.label ??= `r (Å)`
  y_axis.label ??= `g(r)`

  let drag_dropped: Structure[] = $state([])
  let dragging = $state(false)

  function format_structure_label(struct: Structure, label_base: string): string {
    const formula = get_electro_neg_formula(struct)
    return formula && label_base ? `${formula}: ${label_base}` : formula || label_base
  }

  async function handle_drop(event: DragEvent) {
    event.preventDefault()
    dragging = false
    if (!enable_drop) return
    loading = true
    error_msg = undefined

    const compute_and_add = (content: string | ArrayBuffer, filename: string) => {
      try {
        const text = content instanceof ArrayBuffer
          ? new TextDecoder().decode(content)
          : content
        const parsed_struct = parse_any_structure(text, filename)
        if (is_valid_structure(parsed_struct)) {
          drag_dropped = [...drag_dropped, parsed_struct]
        } else error_msg = `Structure has no lattice or sites; cannot compute RDF`
      } catch (exc) {
        error_msg = `Failed to process structure: ${
          exc instanceof Error ? exc.message : String(exc)
        }`
      }
    }

    try {
      const handled = await handle_url_drop(event, on_file_drop || compute_and_add)
        .catch(() => false)
      if (handled) return

      const file = event.dataTransfer?.files?.[0]
      if (file) {
        const { content, filename } = await decompress_file(file)
        if (content) (on_file_drop || compute_and_add)(content, filename)
      }
    } catch (exc) {
      error_msg = `Failed to load file: ${
        exc instanceof Error ? exc.message : String(exc)
      }`
    } finally {
      loading = false
    }
  }

  const entries = $derived.by(() => {
    const result: RdfEntry[] = []

    // Add patterns
    if (patterns) {
      if (Array.isArray(patterns)) result.push(...patterns)
      else result.push(patterns)
    }

    // Add structures
    const struct_list: { struct: Structure; label: string }[] = []
    if (structures) {
      if (Array.isArray(structures)) {
        structures.forEach((struct, idx) =>
          struct_list.push({
            struct,
            label: format_structure_label(struct, `Structure ${idx + 1}`),
          })
        )
      } else if (is_valid_structure(structures)) {
        struct_list.push({
          struct: structures,
          label: format_structure_label(structures, ``),
        })
      } else {
        Object.entries(structures).forEach(([label, struct]) =>
          struct_list.push({ struct, label: format_structure_label(struct, label) })
        )
      }
    }
    drag_dropped.forEach((struct, idx) =>
      struct_list.push({
        struct,
        label: format_structure_label(struct, `Dropped ${idx + 1}`),
      })
    )

    for (const { struct, label } of struct_list) {
      if (mode === `element_pairs`) {
        const pairs = calculate_all_pair_rdfs(struct, { cutoff, n_bins, pbc })
        result.push(...pairs.map((p) => ({
          label: p.element_pair
            ? `${label} ${p.element_pair[0]}-${p.element_pair[1]}`
            : label,
          pattern: p,
        })))
      } else {
        result.push({
          label,
          pattern: calculate_rdf(struct, { cutoff, n_bins, pbc }),
        })
      }
    }
    return result
  })

  const max_r = $derived(Math.max(...entries.flatMap((e) => e.pattern.r), 0))
  const max_g = $derived(Math.max(1.2, ...entries.flatMap((e) => e.pattern.g_r)))

  const series = $derived<DataSeries[]>(
    entries.map((ent, idx) => ({
      x: ent.pattern.r,
      y: ent.pattern.g_r,
      label: ent.label,
      visible: true,
      markers: `line` as const,
      line_style: {
        stroke: ent.color ?? plot_colors[idx % plot_colors.length],
        stroke_width: 2,
      },
    })),
  )
</script>

<StatusMessage bind:message={error_msg} type="error" dismissible />

{#if enable_drop && drag_dropped.length > 0}
  <div class="dropped-info">
    {drag_dropped.length} structure{drag_dropped.length > 1 ? `s` : ``} loaded
    <button onclick={() => (drag_dropped = [])}>Clear</button>
  </div>
{/if}

{#if series.length === 0}
  <StatusMessage
    message={enable_drop
    ? `Drag and drop structure files here to visualize RDFs`
    : `No RDF data to display`}
  />
{:else}
  <ScatterPlot
    {...rest}
    {series}
    x_axis={{ ...x_axis, range: [0, max_r] }}
    y_axis={{ ...y_axis, range: [0, max_g * 1.05] }}
    styles={{ show_lines: true, show_points: false }}
    class={`${rest.class ?? ``} ${dragging ? `dragging` : ``}`}
    style={rest.style ?? `height: 400px;`}
    ondragover={enable_drop
    ? (ev) => {
      ev.preventDefault()
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = `copy`
      dragging = true
    }
    : undefined}
    ondragleave={enable_drop ? () => (dragging = false) : undefined}
    ondrop={enable_drop ? handle_drop : undefined}
  >
    {#snippet user_content({ width, y_scale_fn, pad })}
      {#if show_reference_line}
        {@const y1 = y_scale_fn(1)}
        {#if isFinite(y1)}
          <line
            x1={pad.l}
            x2={width - pad.r}
            {y1}
            y2={y1}
            stroke="gray"
            stroke-dasharray="4"
            opacity="0.5"
          />
          <text
            x={width - pad.r - 5}
            y={y1 - 5}
            text-anchor="end"
            fill="gray"
            font-size="0.8em"
          >
            g(r) = 1
          </text>
        {/if}
      {/if}
    {/snippet}

    {@render children?.({ drag_dropped })}
  </ScatterPlot>
{/if}

<style>
  :global(.dragging) {
    outline: 2px dashed #4e79a7;
    outline-offset: 4px;
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
