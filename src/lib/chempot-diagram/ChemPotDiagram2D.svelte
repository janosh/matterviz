<script lang="ts">
  import type { PhaseData } from '$lib/convex-hull/types'
  import { export_svg_as_png, export_svg_as_svg } from '$lib/io/export'
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

  let x_axis = $derived({ label: axis_label(plot_elements[0] ?? ``) })
  let y_axis = $derived({ label: axis_label(plot_elements[1] ?? ``) })

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
          x: data.event.clientX - bounds.left + 12,
          y: data.event.clientY - bounds.top + 12,
        }
        : undefined,
    }
  }

  // === Export ===
  let scatter_wrapper = $state<HTMLDivElement>()
  let copy_status = $state(false)
  let copy_timeout_id: ReturnType<typeof setTimeout> | null = null

  function get_svg_element(): SVGElement | null {
    return scatter_wrapper?.querySelector(`svg`) ?? null
  }

  function get_json_string(): string {
    return JSON.stringify(
      {
        elements: diagram_data?.elements ?? [],
        domains: draw_domains,
        lims: diagram_data?.lims ?? [],
      },
      null,
      2,
    )
  }

  function export_json_file(): void {
    const url = URL.createObjectURL(
      new Blob([get_json_string()], { type: `application/json` }),
    )
    const link = document.createElement(`a`)
    link.href = url
    link.download = `chempot-diagram.json`
    link.click()
    URL.revokeObjectURL(url)
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
      {formula}
    </text>
  {/each}
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

{#snippet export_buttons()}
  <button
    type="button"
    onclick={() => export_svg_as_svg(get_svg_element(), `chempot-diagram.svg`)}
    title="Export SVG"
  >
    SVG
  </button>
  <button
    type="button"
    onclick={() => export_svg_as_png(get_svg_element(), `chempot-diagram.png`)}
    title="Export PNG"
  >
    PNG
  </button>
  <button type="button" onclick={export_json_file} title="Export JSON">JSON</button>
  <button type="button" onclick={copy_json} title="Copy JSON">
    {copy_status ? `Copied` : `Copy`}
  </button>
{/snippet}

{#if !diagram_data}
  <div class="error-state" role="alert" aria-live="polite">
    <p>Cannot compute chemical potential diagram.</p>
    <p>Need at least 2 elements with elemental reference entries.</p>
  </div>
{:else}
  <ScatterPlot
    bind:wrapper={scatter_wrapper}
    {series}
    bind:x_axis
    bind:y_axis
    legend={null}
    controls={{ show: true }}
    controls_extra={chempot_controls}
    user_content={domain_labels}
    header_controls={export_buttons}
    on_point_hover={handle_hover}
    style="--scatter-width: {width}px; --scatter-height: {height}px"
  />
  {#if render_local_tooltip && show_tooltip && hover_info?.view === `2d`}
    <aside
      class="tooltip"
      style:left={`${hover_info.pointer?.x ?? 12}px`}
      style:top={`${hover_info.pointer?.y ?? 12}px`}
    >
      <strong>{hover_info.formula}</strong>
    </aside>
  {/if}
{/if}

<style>
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
