<script lang="ts">
  import { array_extent, convex_hull_2d, type Vec2 } from '#lib/math.js'
  import { untrack } from 'svelte'
  import { is_editable_event_target } from 'svelte-widgets/utils'
  import TemperatureSlider from '#lib/convex-hull/TemperatureSlider.svelte'
  import EmptyState from 'svelte-widgets/EmptyState.svelte'
  import Spinner from 'svelte-widgets/Spinner.svelte'
  import { json_source } from '#lib/io/export.js'
  import { SettingsSection } from '#lib/layout/index.js'
  import { ScatterPlot } from '#lib/plot/index.js'
  import type { AxisConfig, DataSeries, UserContentProps } from '#lib/plot/core/types.js'
  import ChemPotControls from './ChemPotControls.svelte'
  import ChemPotLegend from './ChemPotLegend.svelte'
  import ChemPotSlices, { slice_label } from './ChemPotSlices.svelte'
  import ChemPotTooltip from './ChemPotTooltip.svelte'
  import { TooltipPin } from '#lib/tooltip/pin.svelte.js'
  import {
    container_pointer,
    create_chempot_state,
    domain_formula_text,
    highlight_key_of,
    sticky_range,
  } from './controls-state.svelte'
  import { build_axis_ranges, orthonormal_2d, pad_domains, padded_floors } from './compute'
  import type { ChemPotDiagramProps } from './types'

  let {
    entries = [],
    config = {},
    width = 800,
    height = 600,
    temperature = $bindable(),
    hover_info = $bindable(null),
    highlighted_formula = null,
    tooltip,
  }: ChemPotDiagramProps = $props()
  // Plot wrapper element (pointer hit-testing), bound from the ScatterPlot
  let wrapper = $state<HTMLDivElement>()
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
    diagram_data,
    domain_colors,
    color_bar,
  } = $derived(chempot)

  const plot_elements = $derived((diagram_data?.elements ?? config.elements ?? []).slice(0, 2))

  // Projected from a larger system, a domain is a polygon with unordered vertices: draw its
  // closed convex outline (binary domains and collinear vertices collapse to one segment)
  const outline = (pts: number[][]): number[][] => {
    const hull = convex_hull_2d(pts as Vec2[], 1e-9)
    return hull.length >= 3 ? [...hull, hull[0]] : hull
  }
  // While slicing, the unsliced shadow projection bounds every section: its padded floor and
  // extent fix the floor and the axis ranges, so a sweep moves the domains but not the view
  const pad = (domains: Record<string, number[][]>) =>
    pad_domains(domains, [0, 1], element_padding, default_min_limit, frame_floors)
  const frame_floors = $derived(
    chempot.frame_data &&
      padded_floors(chempot.frame_data.domains, [0, 1], element_padding, default_min_limit),
  )
  const frame_ranges = $derived.by(() => {
    if (!chempot.frame_data) return [undefined, undefined]
    const points = Object.values(pad(chempot.frame_data.domains)).flat()
    return [0, 1].map((axis) => array_extent(points.map((point) => point[axis])))
  })
  // frame ranges follow the slice setup, a range the user typed in meanwhile stays
  let applied_ranges: (Vec2 | undefined)[] = [undefined, undefined]
  $effect(() => {
    const next = frame_ranges
    untrack(() => {
      const [x_range, y_range] = [x_axis, y_axis].map((axis, idx) =>
        sticky_range(axis.range, applied_ranges[idx], next[idx]),
      )
      applied_ranges = next
      x_axis = { ...x_axis, range: x_range }
      y_axis = { ...y_axis, range: y_range }
    })
  })
  const draw_domains = $derived.by((): Record<string, number[][]> => {
    if (!diagram_data || plot_elements.length < 2) return {}
    const padded = pad(diagram_data.domains)
    return Object.fromEntries(
      Object.entries(padded)
        .filter(([, pts]) => pts.length > 0)
        .map(([formula, pts]) => [formula, outline(pts)]),
    )
  })
  const domain_entries = $derived(Object.entries(draw_domains))

  const highlight_key = $derived(highlight_key_of(hover_info?.formula, highlighted_formula))

  // === Convert domains to ScatterPlot DataSeries ===
  const series = $derived<DataSeries[]>(
    domain_entries.map(([formula, pts]) => {
      const highlighted = formula === highlight_key
      const color = domain_colors.get(formula) ?? `black`
      return {
        id: formula,
        label: formula,
        x: pts.map((point) => point[0]),
        y: pts.map((point) => point[1]),
        markers: `line+points` as const,
        // a spline would bow polygon outlines
        line_style: {
          stroke: color,
          stroke_width: highlighted ? 6 : 3,
          curve: `linear` as const,
        },
        point_style: { fill: color, radius: highlighted ? 5 : 3 },
      }
    }),
  )

  const axis_label = (element: string): string =>
    `${formal_chempots ? `Δ` : ``}μ<sub>${element}</sub> (eV)`

  let x_axis = $state<AxisConfig>({ label: `` })
  let y_axis = $state<AxisConfig>({ label: `` })

  $effect(() => {
    const next_x_label = axis_label(plot_elements[0] ?? ``)
    const next_y_label = axis_label(plot_elements[1] ?? ``)
    if (x_axis.label !== next_x_label) x_axis = { ...x_axis, label: next_x_label }
    if (y_axis.label !== next_y_label) y_axis = { ...y_axis, label: next_y_label }
  })

  // === Domain label annotations (in data coordinates) ===
  const annotations = $derived.by(() => {
    if (!label_stable) return []
    // coincident vertices can hull to an empty outline; a lone point gets no offset
    return domain_entries
      .filter(([, pts]) => pts.length > 0)
      .map(([formula, pts]) => {
        const [normal_x, normal_y] = pts.length >= 2 ? orthonormal_2d(pts) : [0, 0]
        return {
          formula,
          data_x: pts.reduce((sum, point) => sum + point[0], 0) / pts.length + normal_x * 0.25,
          data_y: pts.reduce((sum, point) => sum + point[1], 0) / pts.length + normal_y * 0.25,
        }
      })
  })

  // === Hover info for external consumers ===
  const pin = new TooltipPin<string>({ on_unpin: () => (hover_info = null) })
  const tooltip_pointer = pin.anchored(() => hover_info?.pointer)

  function set_hover_info(formula: string, pts: number[][], event: MouseEvent): void {
    hover_info = {
      formula,
      view: `2d`,
      n_points: pts.length,
      axis_ranges: build_axis_ranges(pts, plot_elements),
      pointer: container_pointer(event, wrapper),
    }
  }

  // A pinned tooltip re-reads its domain after recomputes, unpinning once the domain is gone
  $effect(() => {
    const domains = draw_domains
    untrack(() => {
      if (!pin.value) return
      const pts = domains[pin.value]
      if (!pts) pin.unpin()
      else if (hover_info) {
        hover_info = {
          ...hover_info,
          n_points: pts.length,
          axis_ranges: build_axis_ranges(pts, plot_elements),
        }
      }
    })
  })

  function handle_hover(
    data: { point: { series_idx: number }; event: MouseEvent } | null,
  ): void {
    if (!data) {
      if (!pin.value) hover_info = null
      return
    }
    const entry = domain_entries[data.point.series_idx]
    if (!entry || !pin.allows(entry[0])) return
    set_hover_info(...entry, data.event)
  }

  function handle_click(data: { point: { series_idx: number }; event: MouseEvent }): void {
    const entry = domain_entries[data.point.series_idx]
    if (!entry) return
    pin.toggle(entry[0])
    if (pin.value) set_hover_info(...entry, data.event)
  }

  // === Export ===
  // The plot's own export pane, with the computed domains added as JSON
  const export_basename = $derived(`chempot-${plot_elements.join(`-`)}`)
  const export_sources = {
    json: json_source(() => ({
      elements: diagram_data?.elements ?? [],
      domains: draw_domains,
      lims: diagram_data?.lims ?? [],
    })),
  }
</script>

{#snippet domain_labels(props: UserContentProps)}
  {#each annotations as { formula, data_x, data_y } (formula)}
    <text
      x={props.x_scale_fn(data_x)}
      y={props.y_scale_fn(data_y)}
      text-anchor="middle"
      class="domain-label"
    >
      {domain_formula_text(formula)}
    </text>
  {/each}
{/snippet}

{#snippet chempot_controls(_props: unknown)}
  <SettingsSection
    title="ChemPot"
    changed_keys={chempot.changed_keys}
    labels={{ reset_section: (title) => `Clear ${title.toLowerCase()} overrides` }}
    on_reset={chempot.reset}
  >
    <ChemPotControls values={chempot} set={chempot.set} />
    {#if chempot.slice_elements.length > 0}
      <ChemPotSlices
        elements={chempot.slice_elements}
        slices={chempot.slices}
        ranges={chempot.slice_ranges}
        curves={chempot.slice_curves}
        set_slice={chempot.set_slice}
        measure_label="Length (eV)"
        {formal_chempots}
        colors={(formula) => domain_colors.get(formula)}
      />
    {/if}
  </SettingsSection>
{/snippet}

<!-- recomputes keep the previous plot, settings and temperature slider mounted -->
{#if chempot.computing && !diagram_data}
  <Spinner
    text="Computing chemical potential domains..."
    style="width: 100%; justify-content: center; min-height: 200px; margin: 0; --spinner-size: 1.2em"
  />
{:else if !diagram_data}
  <EmptyState>
    <p>Cannot compute chemical potential diagram.</p>
    <p>{chempot.error ?? `Need at least 2 elements with elemental reference entries.`}</p>
    <!-- the setting that caused the error stays editable -->
    {@render chempot_controls(null)}
  </EmptyState>
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
      if (event.key === `Escape`) pin.unpin()
    }}
    onpointerdown={({ target }) => {
      const is_background =
        target === wrapper ||
        (target instanceof SVGElement && target.closest(`g[data-series-id]`) === null)
      if (is_background) pin.unpin()
    }}
  >
    <ScatterPlot
      bind:wrapper
      {series}
      bind:x_axis
      bind:y_axis
      legend={null}
      show_controls
      export_filename={export_basename}
      {export_sources}
      controls_extra={chempot_controls}
      user_content={domain_labels}
      // hover drives the ChemPot tooltip below; the plot's own point tooltip would double it
      on_point_hover={handle_hover}
      on_point_click={handle_click}
      tooltip={false}
      style="--scatter-width: 100%; --scatter-height: {render_height}px"
    />
    <ChemPotLegend
      {color_mode}
      {color_bar}
      formulas={Object.keys(draw_domains)}
      style="bottom: 60px; left: 50px"
    />
    {@render slice_label(chempot.slices, formal_chempots)}
    {#if tooltip !== false && hover_info?.view === `2d`}
      <ChemPotTooltip
        {hover_info}
        pointer={tooltip_pointer.current}
        pinned={pin.value === hover_info.formula}
        {tooltip}
        bg_color={domain_colors.get(hover_info.formula)}
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
  .chempot-diagram-2d :global(.chempot-temp-slider) {
    /* overlays the scene: in flow it pushes the fixed-height viewer's canvas out of its box */
    position: absolute;
    top: var(--chempot-temp-slider-top, calc(1ex + 108px));
    right: 4px;
    z-index: 11;
  }
  .domain-label {
    font-size: 12px;
    fill: var(--text-color, currentColor);
    opacity: 0.7;
    pointer-events: none;
  }
</style>
