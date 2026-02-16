<script lang="ts">
  import { get_hill_formula } from '$lib/composition/format'
  import type { PhaseData } from '$lib/convex-hull/types'
  import { export_svg_as_png, export_svg_as_svg } from '$lib/io/export'
  import { download } from '$lib/io/fetch'
  import DraggablePane from '$lib/overlays/DraggablePane.svelte'
  import { ScatterPlot } from '$lib/plot'
  import type { DataSeries, UserContentProps } from '$lib/plot/types'
  import { onDestroy } from 'svelte'
  import {
    apply_element_padding,
    build_axis_ranges,
    compute_chempot_diagram,
    orthonormal_2d,
    pad_domain_points,
  } from './compute'
  import { CHEMPOT_DEFAULTS } from './types'
  import type { ChemPotDiagramConfig, ChemPotHoverInfo } from './types'

  let {
    entries = [],
    config = {},
    width = $bindable(800),
    height = $bindable(600),
    hover_info = $bindable<ChemPotHoverInfo | null>(null),
    render_local_tooltip = true,
  }: {
    entries: PhaseData[]
    config?: ChemPotDiagramConfig
    width?: number
    height?: number
    hover_info?: ChemPotHoverInfo | null
    render_local_tooltip?: boolean
  } = $props()
  let container_width = $state(0)
  const base_aspect_ratio = $derived(height > 0 && width > 0 ? height / width : 1)
  const render_width = $derived(container_width > 0 ? container_width : width)
  const render_height = $derived(Math.round(render_width * base_aspect_ratio))

  // === Control overrides ===
  let formal_chempots_override = $state<boolean | null>(null)
  let label_stable_override = $state<boolean | null>(null)
  let element_padding_override = $state<number | null>(null)
  let default_min_limit_override = $state<number | null>(null)
  const formal_chempots = $derived(
    formal_chempots_override ??
      (config.formal_chempots ?? CHEMPOT_DEFAULTS.formal_chempots),
  )
  const label_stable = $derived(
    label_stable_override ?? (config.label_stable ?? CHEMPOT_DEFAULTS.label_stable),
  )
  const element_padding = $derived(
    element_padding_override ??
      (config.element_padding ?? CHEMPOT_DEFAULTS.element_padding),
  )
  const default_min_limit = $derived(
    default_min_limit_override ??
      (config.default_min_limit ?? CHEMPOT_DEFAULTS.default_min_limit),
  )
  const show_tooltip = $derived(config.show_tooltip ?? CHEMPOT_DEFAULTS.show_tooltip)
  const effective_config = $derived({
    ...config,
    formal_chempots,
    label_stable,
    element_padding,
    default_min_limit,
  })

  function reset_controls(): void {
    formal_chempots_override = null
    label_stable_override = null
    element_padding_override = null
    default_min_limit_override = null
  }

  // === Diagram computation ===
  const diagram_data = $derived.by(() => {
    if (entries.length < 2) return null
    try {
      return compute_chempot_diagram(entries, effective_config)
    } catch (err) {
      console.error(`ChemPotDiagram2D:`, err)
      return null
    }
  })

  const plot_elements = $derived(diagram_data?.elements.slice(0, 2) ?? [])

  const draw_domains = $derived.by(() => {
    if (!diagram_data || plot_elements.length < 2) return {}
    const indices = [0, 1]
    const new_lims = element_padding > 0
      ? apply_element_padding(
        diagram_data.domains,
        indices,
        element_padding,
        default_min_limit,
      )
      : null
    const result: Record<string, number[][]> = {}
    for (const [formula, pts] of Object.entries(diagram_data.domains)) {
      const padded = new_lims
        ? pad_domain_points(
          pts,
          indices,
          new_lims,
          default_min_limit,
          element_padding,
        )
        : pts
      if (padded.length > 0) result[formula] = padded
    }
    return result
  })

  // === Convert domains to ScatterPlot DataSeries ===
  const series = $derived<DataSeries[]>(
    Object.entries(draw_domains).map(([formula, pts]) => ({
      id: formula,
      label: formula,
      x: pts.map((pt) => pt[0]),
      y: pts.map((pt) => pt[1]),
      markers: `line+points` as const,
      line_style: { stroke: `black`, stroke_width: 3 },
      point_style: { fill: `black`, radius: 3 },
    })),
  )

  // Axis label text
  function axis_label(element: string): string {
    if (formal_chempots) return `\u0394\u03BC(${element}) (eV)`
    return `\u03BC(${element}) (eV)`
  }

  let x_axis = $state({ label: `` })
  let y_axis = $state({ label: `` })

  $effect(() => {
    const next_x_label = axis_label(plot_elements[0] ?? ``)
    const next_y_label = axis_label(plot_elements[1] ?? ``)
    if (x_axis.label !== next_x_label) x_axis = { ...x_axis, label: next_x_label }
    if (y_axis.label !== next_y_label) y_axis = { ...y_axis, label: next_y_label }
  })

  // === Domain label annotations (in data coordinates) ===
  const annotations = $derived.by(() => {
    if (!label_stable) return []
    const result: { formula: string; data_x: number; data_y: number }[] = []
    for (const [formula, pts] of Object.entries(draw_domains)) {
      if (pts.length === 0) continue
      const center_x = pts.reduce((s, p) => s + p[0], 0) / pts.length
      const center_y = pts.reduce((s, p) => s + p[1], 0) / pts.length
      let offset_x = 0
      let offset_y = 0
      if (pts.length >= 2) {
        const [nx, ny] = orthonormal_2d(pts)
        offset_x = nx * 0.25
        offset_y = ny * 0.25
      }
      result.push({
        formula,
        data_x: center_x + offset_x,
        data_y: center_y + offset_y,
      })
    }
    return result
  })

  // === Hover info for external consumers ===
  function handle_hover(
    data: { point: { series_idx: number }; event: MouseEvent } | null,
  ): void {
    if (!data) {
      hover_info = null
      return
    }
    const domain_entries = Object.entries(draw_domains)
    const entry = domain_entries[data.point.series_idx]
    if (!entry) return
    const [formula, pts] = entry
    const bounds = scatter_wrapper?.getBoundingClientRect()
    hover_info = {
      formula,
      view: `2d`,
      n_points: pts.length,
      axis_ranges: build_axis_ranges(pts, plot_elements),
      pointer: bounds
        ? {
          x: data.event.clientX - bounds.left + 4,
          y: data.event.clientY - bounds.top + 4,
        }
        : undefined,
    }
  }

  // === Export ===
  let scatter_wrapper = $state<HTMLDivElement>()
  let export_pane_open = $state(false)
  let copy_status = $state(false)
  let copy_timeout_id: ReturnType<typeof setTimeout> | null = null

  function get_svg_element(): SVGSVGElement | null {
    return scatter_wrapper?.querySelector<SVGSVGElement>(`svg`) ?? null
  }

  const export_json_data = $derived({
    elements: diagram_data?.elements ?? [],
    domains: draw_domains,
    lims: diagram_data?.lims ?? [],
  })

  function get_json_string(): string {
    return JSON.stringify(export_json_data, null, 2)
  }

  function export_json_file(): void {
    download(get_json_string(), `chempot-diagram-2d.json`, `application/json`)
  }

  async function copy_json(): Promise<void> {
    await navigator.clipboard.writeText(get_json_string())
    copy_status = true
    if (copy_timeout_id !== null) clearTimeout(copy_timeout_id)
    copy_timeout_id = setTimeout(() => {
      copy_status = false
      copy_timeout_id = null
    }, 1000)
  }

  onDestroy(() => {
    if (copy_timeout_id !== null) clearTimeout(copy_timeout_id)
  })
</script>

{#snippet domain_labels(props: UserContentProps)}
  {#each annotations as { formula, data_x, data_y } (formula)}
    <text
      x={props.x_scale_fn(data_x)}
      y={props.y_scale_fn(data_y)}
      text-anchor="middle"
      class="domain-label"
    >
      {get_hill_formula(formula, true, ``)}
    </text>
  {/each}
{/snippet}

{#snippet export_toggle()}
  <DraggablePane
    bind:show={export_pane_open}
    open_icon="Cross"
    closed_icon="Export"
    pane_props={{ class: `chempot-export-pane` }}
    toggle_props={{
      class: `chempot-export-toggle`,
      title: `Export chemical potential diagram`,
      style:
        `position: absolute; top: var(--ctrl-btn-top, 5pt); right: 36px; z-index: 10`,
    }}
  >
    <h4>Export Image</h4>
    <label>
      SVG
      <button
        type="button"
        onclick={() => {
          const svg = get_svg_element()
          if (svg) export_svg_as_svg(svg, `chempot-diagram-2d.svg`)
        }}
        aria-label="Download SVG"
      >
        ⬇
      </button>
    </label>
    <label>
      PNG
      <button
        type="button"
        onclick={() => {
          const svg = get_svg_element()
          if (svg) export_svg_as_png(svg, `chempot-diagram-2d.png`)
        }}
        aria-label="Download PNG"
      >
        ⬇
      </button>
    </label>
    <h4>Export Data</h4>
    <label>
      JSON
      <button type="button" onclick={export_json_file} aria-label="Download JSON">
        ⬇
      </button>
      <button
        type="button"
        onclick={copy_json}
        aria-label="Copy JSON to clipboard"
      >
        {copy_status ? `✅` : `📋`}
      </button>
    </label>
  </DraggablePane>
{/snippet}

{#snippet chempot_controls()}
  <h4>ChemPot</h4>
  <label>
    <span>Formal chempots:</span>
    <input
      type="checkbox"
      checked={formal_chempots}
      onchange={() => {
        formal_chempots_override = !formal_chempots
      }}
    />
  </label>
  <label>
    <span>Label stable:</span>
    <input
      type="checkbox"
      checked={label_stable}
      onchange={() => {
        label_stable_override = !label_stable
      }}
    />
  </label>
  <label>
    <span>Element padding (eV):</span>
    <input
      type="number"
      min="0"
      step="0.1"
      value={element_padding}
      oninput={(event) => {
        element_padding_override = Number(event.currentTarget.value)
      }}
    />
  </label>
  <label>
    <span>Default min limit (eV):</span>
    <input
      type="number"
      max="0"
      step="1"
      value={default_min_limit}
      oninput={(event) => {
        default_min_limit_override = Number(event.currentTarget.value)
      }}
    />
  </label>
  <button type="button" onclick={reset_controls}>Reset defaults</button>
{/snippet}

{#if !diagram_data}
  <div class="error-state" role="alert" aria-live="polite">
    <p>Cannot compute chemical potential diagram.</p>
    <p>Need at least 2 elements with elemental reference entries.</p>
  </div>
{:else}
  <div class="chempot-diagram-2d" bind:clientWidth={container_width}>
    {@render export_toggle()}
    <ScatterPlot
      bind:wrapper={scatter_wrapper}
      {series}
      bind:x_axis
      bind:y_axis
      legend={null}
      controls={{ show: true }}
      controls_extra={chempot_controls}
      user_content={domain_labels}
      on_point_hover={handle_hover}
      style="--scatter-width: 100%; --scatter-height: {render_height}px; --fullscreen-btn-offset: 68px"
    />
    {#if render_local_tooltip && show_tooltip && hover_info?.view === `2d`}
      <aside
        class="tooltip"
        style:left="{hover_info.pointer?.x ?? 4}px"
        style:top="{hover_info.pointer?.y ?? 4}px"
      >
        <strong>{@html get_hill_formula(hover_info.formula, false, ``)}</strong>
      </aside>
    {/if}
  </div>
{/if}

<style>
  .chempot-diagram-2d {
    position: relative;
    width: 100%;
  }
  .chempot-diagram-2d > :global(.pane-toggle) {
    opacity: 0;
    transition: opacity 0.2s, background-color 0.2s;
  }
  .chempot-diagram-2d:hover > :global(.pane-toggle),
  .chempot-diagram-2d > :global(.pane-toggle:focus-visible),
  .chempot-diagram-2d > :global(.pane-toggle[aria-expanded='true']) {
    opacity: 1;
  }
  .chempot-diagram-2d :global(.draggable-pane label) {
    display: flex;
    align-items: center;
    gap: 6pt;
    margin: 4pt 0;
    font-size: 0.95em;
  }
  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-color, #666);
  }
  .domain-label {
    font-size: 12px;
    fill: var(--text-color, currentColor);
    opacity: 0.7;
    pointer-events: none;
  }
  .tooltip {
    position: absolute;
    background: var(--tooltip-bg, rgba(0, 0, 0, 0.85));
    color: var(--tooltip-text, white);
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
    pointer-events: none;
    white-space: nowrap;
    z-index: 10;
  }
</style>
