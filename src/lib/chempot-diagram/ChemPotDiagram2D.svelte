<script lang="ts">
  import type { PhaseData } from '$lib/convex-hull/types'
  import Icon from '$lib/Icon.svelte'
  import { toggle_fullscreen } from '$lib/layout'
  import DraggablePane from '$lib/overlays/DraggablePane.svelte'
  import { scaleLinear } from 'd3-scale'
  import { onDestroy } from 'svelte'
  import {
    apply_element_padding,
    compute_chempot_diagram,
    orthonormal_2d,
    pad_domain_points,
  } from './compute'
  import { CHEMPOT_DEFAULTS } from './types'
  import type { AxisRangeData, ChemPotDiagramConfig, ChemPotHoverInfo } from './types'

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

  const margin = { top: 40, right: 40, bottom: 60, left: 70 }

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

  let wrapper = $state<HTMLDivElement>()
  let svg_ref = $state<SVGSVGElement>()
  let fullscreen = $state(false)
  let controls_open = $state(false)
  let export_pane_open = $state(false)
  let copy_status = $state(false)
  let copy_timeout_id: ReturnType<typeof setTimeout> | null = null
  let container_width = $state(0)
  let container_height = $state(0)
  const base_aspect_ratio = $derived(height > 0 && width > 0 ? height / width : 1)
  const render_width = $derived(container_width > 0 ? container_width : width)
  const render_height = $derived(
    fullscreen
      ? (container_height > 0 ? container_height : height)
      : Math.round(render_width * base_aspect_ratio),
  )

  // Compute diagram data reactively
  const diagram_data = $derived.by(() => {
    if (entries.length < 2) return null
    try {
      return compute_chempot_diagram(entries, effective_config)
    } catch (err) {
      console.error(`ChemPotDiagram2D:`, err)
      return null
    }
  })

  // Elements come directly from computed diagram (already filtered by config.elements)
  const plot_elements = $derived(diagram_data?.elements.slice(0, 2) ?? [])

  // Domains are already in the correct coordinate system
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

  // Compute scales from domain extents
  const extents = $derived.by(() => {
    const all_pts = Object.values(draw_domains).flat()
    if (all_pts.length === 0) return { x: [-5, 1] as const, y: [-5, 1] as const }
    const xs = all_pts.map((pt) => pt[0])
    const ys = all_pts.map((pt) => pt[1])
    return {
      x: [Math.min(...xs), Math.max(...xs)] as const,
      y: [Math.min(...ys), Math.max(...ys)] as const,
    }
  })

  const plot_width = $derived(render_width - margin.left - margin.right)
  const plot_height = $derived(render_height - margin.top - margin.bottom)

  const x_scale = $derived(
    scaleLinear().domain(extents.x).range([0, plot_width]).nice(),
  )
  const y_scale = $derived(
    scaleLinear().domain(extents.y).range([plot_height, 0]).nice(),
  )

  // Axis label text
  function axis_label(element: string): string {
    if (formal_chempots) return `\u0394\u03BC(${element}) (eV)`
    return `\u03BC(${element}) (eV)`
  }

  // Compute annotations: label + position for each domain
  const annotations = $derived.by(() => {
    const result: { formula: string; x: number; y: number }[] = []
    if (!label_stable) return result

    for (const [formula, pts] of Object.entries(draw_domains)) {
      if (pts.length === 0) continue
      const center_x = pts.reduce((s, p) => s + p[0], 0) / pts.length
      const center_y = pts.reduce((s, p) => s + p[1], 0) / pts.length

      // Offset label by orthonormal vector if we have a line segment
      let offset_x = 0
      let offset_y = 0
      if (pts.length >= 2) {
        const [nx, ny] = orthonormal_2d(pts)
        offset_x = nx * 0.25
        offset_y = ny * 0.25
      }

      result.push({
        formula,
        x: x_scale(center_x + offset_x),
        y: y_scale(center_y + offset_y),
      })
    }
    return result
  })

  // Hovered domain for tooltip
  let hovered_formula = $state<string | null>(null)

  function build_axis_ranges(points_2d: number[][]): AxisRangeData[] {
    const axis_ranges: AxisRangeData[] = []
    for (let axis_idx = 0; axis_idx < plot_elements.length; axis_idx++) {
      const axis_vals = points_2d.map((point) => point[axis_idx])
      axis_ranges.push({
        element: plot_elements[axis_idx] ?? `\u03BC${axis_idx}`,
        min_val: Math.min(...axis_vals),
        max_val: Math.max(...axis_vals),
      })
    }
    return axis_ranges
  }

  function pointer_with_offset(
    raw_event: MouseEvent,
  ): { x: number; y: number } | null {
    const bounds = wrapper?.getBoundingClientRect()
    if (!bounds) return null
    return {
      x: raw_event.clientX - bounds.left + 12,
      y: raw_event.clientY - bounds.top + 12,
    }
  }

  function set_hover_info(
    formula: string,
    points_2d: number[][],
    event: MouseEvent,
  ): void {
    const pointer = pointer_with_offset(event)
    hover_info = {
      formula,
      view: `2d`,
      n_points: points_2d.length,
      axis_ranges: build_axis_ranges(points_2d),
      pointer: pointer ?? undefined,
    }
  }

  function reset_controls(): void {
    formal_chempots_override = null
    label_stable_override = null
    element_padding_override = null
    default_min_limit_override = null
  }

  function download_blob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob)
    const link = document.createElement(`a`)
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }

  function get_svg_markup(): string | null {
    if (!svg_ref) return null
    const serializer = new XMLSerializer()
    let markup = serializer.serializeToString(svg_ref)
    if (!markup.includes(`xmlns="http://www.w3.org/2000/svg"`)) {
      markup = markup.replace(`<svg`, `<svg xmlns="http://www.w3.org/2000/svg"`)
    }
    return markup
  }

  function export_svg_file(): void {
    const markup = get_svg_markup()
    if (!markup) return
    download_blob(
      new Blob([markup], { type: `image/svg+xml;charset=utf-8` }),
      `chempot-diagram.svg`,
    )
  }

  async function export_png_file(): Promise<void> {
    const markup = get_svg_markup()
    if (!markup) return
    const svg_blob = new Blob([markup], { type: `image/svg+xml;charset=utf-8` })
    const svg_url = URL.createObjectURL(svg_blob)
    try {
      const image = new Image()
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error(`Failed to load SVG for PNG export`))
        image.src = svg_url
      })
      const canvas = document.createElement(`canvas`)
      canvas.width = Math.round(render_width * 2)
      canvas.height = Math.round(render_height * 2)
      const context = canvas.getContext(`2d`)
      if (!context) return
      context.fillStyle =
        getComputedStyle(wrapper ?? document.body).backgroundColor || `white`
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => {
        if (!blob) return
        download_blob(blob, `chempot-diagram.png`)
      }, `image/png`)
    } finally {
      URL.revokeObjectURL(svg_url)
    }
  }

  function export_json_file(): void {
    const payload = {
      elements: diagram_data?.elements ?? [],
      domains: draw_domains,
      lims: diagram_data?.lims ?? [],
    }
    download_blob(
      new Blob([JSON.stringify(payload, null, 2)], { type: `application/json` }),
      `chempot-diagram.json`,
    )
  }

  async function copy_json(): Promise<void> {
    const payload = {
      elements: diagram_data?.elements ?? [],
      domains: draw_domains,
      lims: diagram_data?.lims ?? [],
    }
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
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

<svelte:document
  onfullscreenchange={() => {
    fullscreen = document.fullscreenElement === wrapper
  }}
/>

<div
  bind:this={wrapper}
  bind:clientWidth={container_width}
  bind:clientHeight={container_height}
  class="chempot-diagram-2d"
  class:fullscreen
  style:width={fullscreen ? `100vw` : `100%`}
  style:height={fullscreen ? `100vh` : `${render_height}px`}
>
  <section class="control-buttons">
    <DraggablePane
      bind:show={export_pane_open}
      open_icon="Cross"
      closed_icon="Export"
      pane_props={{ class: `chempot-export-pane` }}
      toggle_props={{
        class: `chempot-export-toggle`,
        title: `Export chemical potential diagram`,
      }}
    >
      <h4>Export Image</h4>
      <label>
        SVG
        <button type="button" onclick={export_svg_file} aria-label="Download SVG">
          ⬇
        </button>
      </label>
      <label>
        PNG
        <button type="button" onclick={export_png_file} aria-label="Download PNG">
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

    <DraggablePane
      bind:show={controls_open}
      open_icon="Cross"
      closed_icon="Settings"
      pane_props={{ class: `chempot-controls-pane` }}
      toggle_props={{ class: `chempot-controls-toggle`, title: `Chemical potential controls` }}
    >
      <h4>ChemPot Controls</h4>
      <label>
        <span>Formal chempots:</span>
        <input
          type="checkbox"
          checked={formal_chempots}
          onchange={(event) => {
            const target = event.currentTarget as HTMLInputElement
            formal_chempots_override = target.checked
          }}
        />
      </label>
      <label>
        <span>Label stable phases:</span>
        <input
          type="checkbox"
          checked={label_stable}
          onchange={(event) => {
            const target = event.currentTarget as HTMLInputElement
            label_stable_override = target.checked
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
          onchange={(event) => {
            const target = event.currentTarget as HTMLInputElement
            element_padding_override = Number(target.value)
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
          onchange={(event) => {
            const target = event.currentTarget as HTMLInputElement
            default_min_limit_override = Number(target.value)
          }}
        />
      </label>
      <button type="button" onclick={reset_controls}>Reset to config defaults</button>
    </DraggablePane>

    <button
      type="button"
      onclick={() => toggle_fullscreen(wrapper)}
      title="{fullscreen ? `Exit` : `Enter`} fullscreen"
      class="fullscreen-btn"
    >
      <Icon icon="{fullscreen ? `Exit` : ``}Fullscreen" />
    </button>
  </section>

  {#if !diagram_data}
    <div class="error-state" role="alert" aria-live="polite">
      <p>Cannot compute chemical potential diagram.</p>
      <p>Need at least 2 elements with elemental reference entries.</p>
    </div>
  {:else}
    <svg bind:this={svg_ref} width={render_width} height={render_height}>
      <g transform="translate({margin.left},{margin.top})">
        <!-- X axis -->
        <g transform="translate(0,{plot_height})">
          <line x1={0} y1={0} x2={plot_width} y2={0} stroke="currentColor" />
          {#each x_scale.ticks(6) as tick (tick)}
            <g transform="translate({x_scale(tick)},0)">
              <line y1={0} y2={6} stroke="currentColor" />
              <text y={20} text-anchor="middle" class="tick-label">{tick}</text>
            </g>
          {/each}
          <text
            x={plot_width / 2}
            y={45}
            text-anchor="middle"
            class="axis-label"
          >
            {axis_label(plot_elements[0])}
          </text>
        </g>

        <!-- Y axis -->
        <g>
          <line x1={0} y1={0} x2={0} y2={plot_height} stroke="currentColor" />
          {#each y_scale.ticks(6) as tick (tick)}
            <g transform="translate(0,{y_scale(tick)})">
              <line x1={-6} x2={0} stroke="currentColor" />
              <text x={-10} dy="0.32em" text-anchor="end" class="tick-label">{tick}</text>
            </g>
          {/each}
          <text
            transform="rotate(-90)"
            x={-plot_height / 2}
            y={-50}
            text-anchor="middle"
            class="axis-label"
          >
            {axis_label(plot_elements[1])}
          </text>
        </g>

        <!-- Domain lines -->
        {#each Object.entries(draw_domains) as [formula, pts] (formula)}
          {@const line_points = pts.map((pt) => `${x_scale(pt[0])},${y_scale(pt[1])}`)
          .join(` `)}
          <g
            class="domain-line"
            class:hovered={hovered_formula === formula}
            role="graphics-symbol"
            onmouseenter={(evt) => {
              hovered_formula = formula
              set_hover_info(formula, pts, evt)
            }}
            onmousemove={(evt) => {
              set_hover_info(formula, pts, evt)
            }}
            onmouseleave={() => {
              hovered_formula = null
              if (hover_info?.formula === formula) hover_info = null
            }}
          >
            <polyline
              points={line_points}
              fill="none"
              stroke="black"
              stroke-width={3}
            />
            <!-- Invisible wider hit area for hover -->
            <polyline
              points={line_points}
              fill="none"
              stroke="transparent"
              stroke-width={12}
            />
            {#each pts as pt, pt_idx (pt_idx)}
              <circle
                cx={x_scale(pt[0])}
                cy={y_scale(pt[1])}
                r={3}
                fill="black"
              />
            {/each}
          </g>
        {/each}

        <!-- Labels -->
        {#if label_stable}
          {#each annotations as { formula, x, y } (formula)}
            <text
              {x}
              {y}
              text-anchor="middle"
              class="domain-label"
            >
              {formula}
            </text>
          {/each}
        {/if}
      </g>
    </svg>
  {/if}
  {#if render_local_tooltip && show_tooltip && hover_info?.view === `2d`}
    <aside
      class="tooltip"
      style:left={`${hover_info.pointer?.x ?? 12}px`}
      style:top={`${hover_info.pointer?.y ?? 12}px`}
    >
      <strong>{hover_info.formula}</strong>
    </aside>
  {/if}
</div>

<style>
  .chempot-diagram-2d {
    position: relative;
    font-family: inherit;
  }
  .control-buttons {
    position: absolute;
    top: 1ex;
    right: 1ex;
    display: flex;
    gap: 8px;
    z-index: 20;
  }
  .control-buttons > :global(button),
  .control-buttons > :global(.pane-toggle) {
    background: transparent;
    border: none;
    padding: 4px;
    cursor: pointer;
    border-radius: 3px;
    color: var(--text-color, currentColor);
    transition: background-color 0.2s;
    display: flex;
    font-size: clamp(0.85em, 2cqmin, 1.3em);
  }
  .control-buttons > :global(button:hover),
  .control-buttons > :global(.pane-toggle:hover) {
    background-color: color-mix(in srgb, currentColor 8%, transparent);
  }
  .chempot-diagram-2d :global(.draggable-pane label) {
    display: flex;
    align-items: center;
    gap: 6pt;
    margin: 4pt 0;
    font-size: 0.95em;
  }
  .chempot-diagram-2d :global(.draggable-pane label > span) {
    min-width: 10em;
  }
  .chempot-diagram-2d :global(.draggable-pane input[type='number']) {
    width: 6em;
  }
  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-color, #666);
  }
  .tick-label {
    font-size: 11px;
    fill: var(--text-color, currentColor);
  }
  .axis-label {
    font-size: 14px;
    fill: var(--text-color, currentColor);
  }
  .domain-label {
    font-size: 12px;
    fill: var(--text-color, currentColor);
    opacity: 0.7;
    pointer-events: none;
  }
  .domain-line.hovered polyline:first-child {
    stroke: var(--accent-color, #1976d2);
    stroke-width: 4;
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
