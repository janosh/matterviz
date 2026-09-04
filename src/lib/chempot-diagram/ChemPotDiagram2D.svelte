<script lang="ts">
  import { get_electro_neg_formula } from '$lib/composition/format'
  import { is_editable_event_target } from 'svelte-widgets/utils'
  import TemperatureSlider from '$lib/convex-hull/TemperatureSlider.svelte'
  import type { PhaseData } from '$lib/convex-hull/types'
  import Spinner from '$lib/feedback/Spinner.svelte'
  import type { ExportSection } from '$lib/io'
  import ExportPane from '$lib/io/ExportPane.svelte'
  import { export_svg_as_png, export_svg_as_svg } from '$lib/io/export'
  import { SettingsSection } from '$lib/layout'
  import { ScatterPlot } from '$lib/plot'
  import type { DataSeries, UserContentProps } from '$lib/plot/core/types'
  import ChemPotControls from './ChemPotControls.svelte'
  import ChemPotLegend from './ChemPotLegend.svelte'
  import ChemPotTooltip from './ChemPotTooltip.svelte'
  import { container_pointer, create_chempot_state } from './controls-state.svelte'
  import {
    apply_element_padding,
    build_axis_ranges,
    orthonormal_2d,
    pad_domain_points,
  } from './compute'
  import { export_json_file, get_json_string } from './export'
  import type { ChemPotDiagramConfig, ChemPotHoverInfo } from './types'

  let {
    entries = [],
    config = {},
    width = 800,
    height = 600,
    // Auto-corrected to a valid available temperature when needed.
    temperature = $bindable<number | undefined>(undefined),
    hover_info = $bindable<ChemPotHoverInfo | null>(null),
  }: {
    entries: PhaseData[]
    config?: ChemPotDiagramConfig
    width?: number
    height?: number
    temperature?: number
    hover_info?: ChemPotHoverInfo | null
  } = $props()
  // Plot wrapper element (export and pointer hit-testing), bound from the ScatterPlot
  let wrapper = $state<HTMLDivElement>()
  let export_pane_open = $state(false)
  let container_width = $state(0)
  const base_aspect_ratio = $derived(height > 0 && width > 0 ? height / width : 1)
  const render_width = $derived(container_width > 0 ? container_width : width)
  const render_height = $derived(Math.round(render_width * base_aspect_ratio))

  const chempot = create_chempot_state({
    entries: () => entries,
    config: () => config,
    temperature: { get: () => temperature, set: (value) => (temperature = value) },
    min_elements: 2,
    formulas: () => Object.keys(draw_domains),
    label: `ChemPotDiagram2D`,
  })
  const {
    formal_chempots,
    label_stable,
    element_padding,
    default_min_limit,
    color_mode,
    color_scale,
    reverse_color_scale,
    diagram_data,
    domain_colors,
    color_range,
  } = $derived(chempot)

  const plot_elements = $derived((diagram_data?.elements ?? config.elements ?? []).slice(0, 2))

  const draw_domains = $derived.by((): Record<string, number[][]> => {
    if (!diagram_data || plot_elements.length < 2) return {}
    const indices = [0, 1]
    if (element_padding <= 0) {
      return Object.fromEntries(
        Object.entries(diagram_data.domains).filter(([, pts]) => pts.length > 0),
      )
    }
    const new_lims = apply_element_padding(
      diagram_data.domains,
      indices,
      element_padding,
      default_min_limit,
    )
    const result: Record<string, number[][]> = {}
    for (const [formula, pts] of Object.entries(diagram_data.domains)) {
      const padded = pad_domain_points(
        pts,
        indices,
        new_lims,
        default_min_limit,
        element_padding,
      )
      if (padded.length > 0) result[formula] = padded
    }
    return result
  })
  const domain_entries = $derived(Object.entries(draw_domains))

  // === Convert domains to ScatterPlot DataSeries ===
  const series = $derived<DataSeries[]>(
    domain_entries.map(([formula, pts]) => ({
      id: formula,
      label: formula,
      x: pts.map((pt) => pt[0]),
      y: pts.map((pt) => pt[1]),
      markers: `line+points` as const,
      line_style: { stroke: domain_colors.get(formula) ?? `black`, stroke_width: 3 },
      point_style: { fill: domain_colors.get(formula) ?? `black`, radius: 3 },
    })),
  )

  // Axis label text
  function axis_label(element: string): string {
    const prefix = formal_chempots ? `Δ` : ``
    return `${prefix}μ<sub>${element}</sub> (eV)`
  }

  let x_axis = $state({ label: ``, label_shift: { y: -45 } })
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
      const center_x = pts.reduce((sum, point) => sum + point[0], 0) / pts.length
      const center_y = pts.reduce((sum, point) => sum + point[1], 0) / pts.length
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
  let locked_hover_formula = $state<string | null>(null)

  function set_hover_info(formula: string, pts: number[][], event: MouseEvent): void {
    hover_info = {
      formula,
      view: `2d`,
      n_points: pts.length,
      axis_ranges: build_axis_ranges(pts, plot_elements),
      pointer: container_pointer(event, wrapper),
    }
  }

  function clear_hover_lock(): void {
    locked_hover_formula = null
    hover_info = null
  }

  function handle_hover(
    data: { point: { series_idx: number }; event: MouseEvent } | null,
  ): void {
    if (!data) {
      if (!locked_hover_formula) hover_info = null
      return
    }
    const entry = domain_entries[data.point.series_idx]
    if (!entry) return
    const [formula, pts] = entry
    if (locked_hover_formula && locked_hover_formula !== formula) return
    set_hover_info(formula, pts, data.event)
  }

  function handle_click(data: { point: { series_idx: number }; event: MouseEvent }): void {
    const entry = domain_entries[data.point.series_idx]
    if (!entry) return
    const [formula, pts] = entry
    if (locked_hover_formula === formula) {
      clear_hover_lock()
      return
    }
    locked_hover_formula = formula
    set_hover_info(formula, pts, data.event)
  }

  // === Export ===
  const get_svg_element = (): SVGSVGElement | null =>
    wrapper?.querySelector<SVGSVGElement>(`svg`) ?? null

  const export_basename = $derived(`chempot-${plot_elements.join(`-`)}`)
  const json_payload = $derived({
    elements: diagram_data?.elements ?? [],
    domains: draw_domains,
    lims: diagram_data?.lims ?? [],
  })

  const export_sections = $derived<ExportSection[]>([
    {
      title: `Export Image`,
      items: [
        {
          label: `SVG`,
          on_download: () => {
            const svg = get_svg_element()
            if (svg) export_svg_as_svg(svg, `${export_basename}.svg`)
          },
        },
        {
          label: `PNG`,
          on_download: () => {
            const svg = get_svg_element()
            if (svg) export_svg_as_png(svg, `${export_basename}.png`)
          },
        },
      ],
    },
    {
      title: `Export Data`,
      items: [
        {
          label: `JSON`,
          on_download: () => export_json_file(json_payload, export_basename),
          copy_text: () => get_json_string(json_payload),
        },
      ],
    },
  ])
</script>

{#snippet domain_labels(props: UserContentProps)}
  {#each annotations as { formula, data_x, data_y } (formula)}
    <text
      x={props.x_scale_fn(data_x)}
      y={props.y_scale_fn(data_y)}
      text-anchor="middle"
      class="domain-label"
    >
      {get_electro_neg_formula(formula, {
        plain_text: true,
        delim: ``,
        amount_format: `.3~s`,
      })}
    </text>
  {/each}
{/snippet}

{#snippet export_toggle()}
  <ExportPane
    bind:export_pane_open
    sections={export_sections}
    pane_props={{ class: `chempot-export-pane` }}
    toggle_props={{
      class: `chempot-export-toggle`,
      title: `Export chemical potential diagram`,
      style: `position: absolute; top: var(--ctrl-btn-top, 5pt); right: 36px; z-index: 10`,
    }}
  />
{/snippet}

{#snippet chempot_controls(_props: unknown)}
  <SettingsSection title="ChemPot" current_values={chempot.values} on_reset={chempot.reset}>
    <ChemPotControls values={chempot} set={chempot.set} />
  </SettingsSection>
{/snippet}

{#if chempot.computing}
  <Spinner
    text="Computing chemical potential domains..."
    style="width: 100%; justify-content: center; min-height: 200px; margin: 0; --spinner-size: 1.2em"
  />
{:else if !diagram_data}
  <div class="error-state" role="alert" aria-live="polite">
    <p>Cannot compute chemical potential diagram.</p>
    <p>{chempot.error ?? `Need at least 2 elements with elemental reference entries.`}</p>
  </div>
{:else}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="chempot-diagram-2d"
    bind:clientWidth={container_width}
    role="application"
    tabindex="0"
    onkeydown={(event) => {
      // Escape inside a pane input belongs to that input, as in the 3D sibling
      if (is_editable_event_target(event.target)) return
      if (event.key === `Escape`) clear_hover_lock()
    }}
    onpointerdown={(event) => {
      const target = event.target
      if (!locked_hover_formula) return
      const is_background_click =
        target === wrapper ||
        (target instanceof SVGElement && target.closest(`g[data-series-id]`) === null)
      if (is_background_click) {
        clear_hover_lock()
      }
    }}
  >
    {@render export_toggle()}
    <ScatterPlot
      bind:wrapper
      {series}
      bind:x_axis
      bind:y_axis
      legend={null}
      show_controls
      controls_extra={chempot_controls}
      user_content={domain_labels}
      on_point_hover={handle_hover}
      on_point_click={handle_click}
      style="--scatter-width: 100%; --scatter-height: {render_height}px; --fullscreen-btn-offset: 68px"
    />
    <ChemPotLegend
      {color_mode}
      {color_scale}
      {reverse_color_scale}
      {color_range}
      formulas={Object.keys(draw_domains)}
      style="bottom: 60px; left: 50px"
    />
    {#if chempot.show_tooltip && hover_info?.view === `2d`}
      <ChemPotTooltip
        {hover_info}
        pinned={locked_hover_formula === hover_info.formula}
        detail_level={chempot.tooltip_detail_level}
        constrain_to={{ width: render_width, height: render_height }}
      />
    {/if}
    {#if chempot.has_temp_data && temperature !== undefined}
      <TemperatureSlider
        class="chempot-temp-slider"
        available_temperatures={chempot.available_temperatures}
        interpolate_temperature={config.interpolate_temperature}
        bind:temperature
      />
    {/if}
  </div>
{/if}

<style>
  .chempot-diagram-2d {
    position: relative;
    container-type: inline-size;
    width: 100%;
  }
  .chempot-diagram-2d > :global(.pane-toggle) {
    opacity: 0;
    transition:
      opacity 0.2s,
      background-color 0.2s;
  }
  .chempot-diagram-2d:hover > :global(.pane-toggle),
  .chempot-diagram-2d > :global(.pane-toggle:focus-visible),
  .chempot-diagram-2d > :global(.pane-toggle[aria-expanded='true']) {
    opacity: 1;
  }
  .chempot-diagram-2d :global(.chempot-temp-slider) {
    top: var(--chempot-temp-slider-top, calc(1ex + 108px));
    right: 4px;
    z-index: 11;
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
</style>
