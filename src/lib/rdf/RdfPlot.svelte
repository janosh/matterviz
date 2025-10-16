<script lang="ts">
  import { plot_colors } from '$lib/colors'
  import { get_electro_neg_formula } from '$lib/composition'
  import type { DataSeries } from '$lib/plot'
  import { ScatterPlot } from '$lib/plot'
  import type { Pbc, PymatgenStructure as Structure } from '$lib/structure'
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
    children?: Snippet<[]>
  } & ComponentProps<typeof ScatterPlot> = $props()

  // Set default axis labels if not provided
  x_axis.label ??= `r (Å)`
  y_axis.label ??= `g(r)`

  let dropped: Structure[] = $state([])
  let dragging = $state(false)

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
          struct_list.push({ struct: struct, label: `Structure ${idx + 1}` })
        )
      } else if (`lattice` in structures && `sites` in structures) {
        struct_list.push({
          struct: structures as Structure,
          label: `${get_electro_neg_formula(structures)}: `,
        })
      } else {
        Object.entries(structures).forEach(([label, struct]) =>
          struct_list.push({ struct, label })
        )
      }
    }
    dropped.forEach((struct, idx) =>
      struct_list.push({ struct, label: `Dropped ${idx + 1}` })
    )

    for (const { struct, label } of struct_list) {
      if (mode === `element_pairs`) {
        const pairs = calculate_all_pair_rdfs(struct, { cutoff, n_bins, pbc })
        result.push(
          ...pairs.map((p) => ({
            label: p.element_pair
              ? `${label} ${p.element_pair[0]}-${p.element_pair[1]}`
              : label,
            pattern: p,
          })),
        )
      } else { // Calculate full RDF directly without element filters to properly weight all pairs
        const full_rdf = calculate_rdf(struct, { cutoff, n_bins, pbc })
        result.push({ label, pattern: full_rdf })
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

  async function handle_drop(ev: DragEvent) {
    ev.preventDefault()
    dragging = false
    const files = ev.dataTransfer?.files
    if (!files) return

    for (const file of Array.from(files)) {
      try {
        const struct = JSON.parse(await file.text()) as Structure
        if (struct.lattice && struct.sites) dropped = [...dropped, struct]
      } catch {}
    }
  }
</script>

{#if enable_drop && dropped.length > 0}
  <div
    style="padding: 0.5em; margin-bottom: 0.5em; background: #f0f0f0; border-radius: 4px"
  >
    {dropped.length} structure{dropped.length > 1 ? `s` : ``} loaded
    <button onclick={() => (dropped = [])}>Clear</button>
  </div>
{/if}

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

  {@render children?.()}
</ScatterPlot>

<style>
  :global(.dragging) {
    outline: 2px dashed #4e79a7;
    outline-offset: 4px;
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
