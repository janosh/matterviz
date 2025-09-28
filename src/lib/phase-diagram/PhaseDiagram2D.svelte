<script lang="ts">
  import type {
    AnyStructure,
    ElementSymbol,
    PlotPoint,
    TooltipProps,
    UserContentProps,
  } from '$lib'
  import { Icon, is_unary_entry, PD_DEFAULTS, toggle_fullscreen } from '$lib'
  import type { D3InterpolateName } from '$lib/colors'
  import { elem_symbol_to_name, get_electro_neg_formula } from '$lib/composition'
  import { format_fractional, format_num } from '$lib/labels'
  import { ScatterPlot } from '$lib/plot'
  import { SvelteMap } from 'svelte/reactivity'
  import {
    compute_max_energy_threshold,
    default_controls,
    parse_pd_entries_from_drop,
    PD_STYLE,
  } from './helpers'
  import PhaseDiagramControls from './PhaseDiagramControls.svelte'
  import PhaseDiagramInfoPane from './PhaseDiagramInfoPane.svelte'
  import StructurePopup from './StructurePopup.svelte'
  import {
    compute_e_form_per_atom,
    find_lowest_energy_unary_refs,
    get_phase_diagram_stats,
    process_pd_entries,
  } from './thermodynamics'
  import type {
    HoverData3D,
    PDControlsType,
    PhaseDiagramConfig,
    PhaseEntry,
    PlotEntry3D,
  } from './types'

  // Binary phase diagram rendered as energy vs composition (x in [0, 1])
  interface Props {
    entries: PhaseEntry[]
    controls?: Partial<PDControlsType>
    config?: Partial<PhaseDiagramConfig>
    on_point_click?: (entry: PlotEntry3D) => void
    on_point_hover?: (data: HoverData3D<PlotEntry3D> | null) => void
    fullscreen?: boolean
    enable_fullscreen?: boolean
    enable_info_pane?: boolean
    wrapper?: HTMLDivElement
    // Smart label defaults - hide labels if more than this many entries
    label_threshold?: number
    // Visibility
    show_stable?: boolean
    show_unstable?: boolean
    color_mode?: `stability` | `energy`
    color_scale?: D3InterpolateName
    info_pane_open?: boolean
    // Legend pane visibility
    legend_pane_open?: boolean
    // Energy threshold for showing unstable entries (eV/atom above hull)
    energy_threshold?: number
    // Callback for when JSON files are dropped
    on_file_drop?: (entries: PhaseEntry[]) => void
    // Enable structure preview overlay when hovering over entries with structure data
    enable_structure_preview?: boolean
    energy_source_mode?: `precomputed` | `on-the-fly`
  }
  let {
    entries,
    controls = {},
    config = {},
    on_point_click,
    on_point_hover,
    fullscreen = $bindable(false),
    enable_fullscreen = true,
    enable_info_pane = true,
    wrapper = $bindable(undefined),
    label_threshold = 50,
    show_stable = $bindable(true),
    show_unstable = $bindable(true),
    color_mode = $bindable(`energy`),
    color_scale = $bindable(`interpolateViridis`),
    info_pane_open = $bindable(false),
    legend_pane_open = $bindable(false),
    energy_threshold = $bindable(0.1),
    on_file_drop,
    enable_structure_preview = true,
    energy_source_mode = $bindable(`precomputed`),
  }: Props = $props()

  const merged_controls: PDControlsType = $derived({
    ...default_controls,
    ...controls,
  })

  const default_config: PhaseDiagramConfig = {
    margin: { top: 40, right: 40, bottom: 60, left: 60 },
    unstable_threshold: 0.2,
    show_labels: true,
    show_hull: true,
    point_size: 6,
    line_width: 2,
    font_size: 12,
    colors: {
      stable: `#0072B2`,
      unstable: `#E69F00`,
      hull_line: `var(--accent-color, #1976D2)`,
      background: `transparent`,
      text: `var(--text-color, #212121)`,
      edge: `var(--text-color, #212121)`,
      tooltip_bg: `var(--tooltip-bg, rgba(0, 0, 0, 0.85))`,
      tooltip_text: `var(--tooltip-text, white)`,
      annotation: `var(--text-color, #212121)`,
    },
  }

  const merged_config = $derived({
    ...default_config,
    ...config,
    margin: { ...default_config.margin, ...(config.margin || {}) },
  })

  // Decide which energy source to use per entry (consistent with 3D/4D)
  const has_precomputed_e_form = $derived(
    entries.length > 0 && entries.every((e) => typeof e.e_form_per_atom === `number`),
  )
  const has_precomputed_hull = $derived(
    entries.length > 0 && entries.every((e) => typeof e.e_above_hull === `number`),
  )

  const unary_refs = $derived.by(() => find_lowest_energy_unary_refs(entries))

  const can_compute_e_form = $derived.by(() => {
    const elements_in_entries = Array.from(
      new Set(entries.flatMap((e) => Object.keys(e.composition))),
    )
    return elements_in_entries.every((el) => Boolean(unary_refs[el]))
  })

  // In 2D we can compute hull distances from formation energies
  const can_compute_hull = $derived(can_compute_e_form)

  const energy_mode = $derived(
    (has_precomputed_e_form && has_precomputed_hull)
      ? energy_source_mode
      : ((can_compute_e_form && can_compute_hull) ? `on-the-fly` : `precomputed`),
  )

  const effective_entries = $derived.by(() => {
    if (energy_mode === `precomputed`) return entries
    return entries.map((entry) => {
      const e_form = compute_e_form_per_atom(entry, unary_refs)
      if (e_form == null) return entry
      return { ...entry, e_form_per_atom: e_form }
    })
  })

  // Process data and element set
  const processed_entries = $derived(effective_entries)
  const pd_data = $derived(process_pd_entries(processed_entries))

  const elements = $derived.by(() => {
    const all_elements = pd_data.elements
    if (all_elements.length > 2) {
      console.error(
        `PhaseDiagram2D: Dataset contains ${all_elements.length} elements, but binary diagrams require exactly 2. Found: [${
          all_elements.join(`, `)
        }]`,
      )
      return []
    }
    return all_elements
  })

  // Coordinate computation ----------------------------------------------------
  function compute_binary_coordinates(
    raw_entries: PhaseEntry[],
    elems: ElementSymbol[],
  ): PlotEntry3D[] {
    if (elems.length !== 2) return []
    const [el1, el2] = elems
    const coords: PlotEntry3D[] = []
    for (const entry of raw_entries) {
      // Require formation energy per atom to place along y
      const e_form = entry.e_form_per_atom
      if (typeof e_form !== `number`) continue
      const total = Object.values(entry.composition).reduce((s, v) => s + v, 0)
      if (total <= 0) continue
      const frac_b = (entry.composition[el2] || 0) / total
      const is_element = is_unary_entry(entry)
      coords.push({ ...entry, x: frac_b, y: e_form, z: 0, is_element, visible: true })
    }
    // Ensure elemental references at x=0 and x=1 with y=0 to close the hull
    const el_a: PlotEntry3D | undefined = coords.find((e) =>
      e.is_element && e.x === 0
    )
    const el_b: PlotEntry3D | undefined = coords.find((e) =>
      e.is_element && e.x === 1
    )
    if (!el_a) {
      coords.push({
        composition: { [el1]: 1 },
        energy: 0,
        x: 0,
        y: 0,
        z: 0,
        is_element: true,
        visible: true,
      })
    }
    if (!el_b) {
      coords.push({
        composition: { [el2]: 1 },
        energy: 0,
        x: 1,
        y: 0,
        z: 0,
        is_element: true,
        visible: true,
      })
    }
    return coords
  }

  // Lower hull and above-hull distances --------------------------------------
  type HullVertex = { x: number; y: number }

  function compute_lower_hull(points: HullVertex[]): HullVertex[] {
    // Andrew's monotone chain for lower hull
    const sorted = [...points].sort((p1, p2) => (p1.x - p2.x) || (p1.y - p2.y))
    const lower: HullVertex[] = []
    const cross = (o: HullVertex, a: HullVertex, b: HullVertex) =>
      (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
    for (const p of sorted) {
      while (
        lower.length >= 2 &&
        cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
      ) lower.pop()
      lower.push(p)
    }
    return lower
  }

  function interpolate_on_hull(hull: HullVertex[], x: number): number | null {
    if (hull.length < 2) return null
    if (x <= hull[0].x) return hull[0].y
    if (x >= hull[hull.length - 1].x) return hull[hull.length - 1].y
    for (let i = 0; i < hull.length - 1; i++) {
      const p1 = hull[i]
      const p2 = hull[i + 1]
      if (x >= p1.x && x <= p2.x) {
        const t = (x - p1.x) / Math.max(1e-12, p2.x - p1.x)
        return p1.y * (1 - t) + p2.y * t
      }
    }
    return null
  }

  const coords_entries = $derived.by(() => {
    if (elements.length !== 2) return []
    try {
      return compute_binary_coordinates(pd_data.entries, elements)
    } catch (error) {
      console.error(`Error computing binary coordinates:`, error)
      return []
    }
  })

  const plot_entries = $derived.by(() => {
    if (coords_entries.length === 0) return []

    // Build lower hull in (x, y=e_form)
    // Group by composition fraction (x) and track all entries at each x to
    // robustly handle polymorphs. For the hull input, use the lowest energy per x.
    const entries_by_x = new SvelteMap<number, PlotEntry3D[]>()
    for (const entry of coords_entries) {
      const existing = entries_by_x.get(entry.x) || []
      existing.push(entry)
      entries_by_x.set(entry.x, existing)
    }
    const hull_input = Array.from(entries_by_x, ([x, entries]) => {
      const min_y = Math.min(...entries.map((entry) => entry.y))
      return { x, y: min_y }
    })
    const hull_points = compute_lower_hull(hull_input)

    // Annotate entries with e_above_hull and visibility
    const enriched = coords_entries.map((e) => {
      const y_hull = interpolate_on_hull(hull_points, e.x)
      const above = y_hull == null ? 0 : Math.max(0, e.y - y_hull)
      const is_stable = above <= 1e-9
      const visible = (is_stable && show_stable) ||
        (!is_stable && show_unstable && above <= energy_threshold)
      return { ...e, e_above_hull: above, is_stable, visible }
    })

    return enriched.filter((
      e,
    ) => (e.is_stable || (e.e_above_hull ?? 0) <= energy_threshold))
  })

  const stable_entries = $derived(
    plot_entries.filter((entry: PlotEntry3D) =>
      entry.is_stable || entry.e_above_hull === 0
    ),
  )
  const unstable_entries = $derived(
    plot_entries.filter((entry: PlotEntry3D) =>
      (entry.e_above_hull ?? 0) > 0 && !entry.is_stable
    ),
  )

  // Total counts based on hull-enriched entries
  const total_unstable_count = $derived(
    plot_entries.filter((e) => (e.e_above_hull ?? 0) > 0 && !e.is_stable).length,
  )

  const camera_default = {
    zoom: PD_DEFAULTS.binary.camera_zoom,
    center_x: PD_DEFAULTS.binary.camera_center_x,
    center_y: PD_DEFAULTS.binary.camera_center_y,
  }
  let camera = $state({ ...camera_default })
  let reset_counter = $state(0)

  // Drag and drop state (to match 3D/4D components)
  let drag_over = $state(false)

  // Structure popup state
  let modal_open = $state(false)
  let selected_structure = $state<AnyStructure | null>(null)
  let selected_entry = $state<PlotEntry3D | null>(null)
  let modal_place_right = $state(true)

  // Axis mapping helpers ------------------------------------------------------
  const x_domain = $derived<[number, number]>([0, 1])
  const y_domain = $derived.by((): [number, number] => {
    const ys = plot_entries.map((entry) => entry.y)
    if (ys.length === 0) return [-1, 0]
    const min_y_data = Math.min(...ys)
    const max_y_data = Math.max(...ys)
    const span = Math.max(1e-9, max_y_data - min_y_data)
    const pad = 0.05 * span
    return [min_y_data - pad, max_y_data + pad]
  })

  // Build ScatterPlot series --------------------------------------------------
  const hull_polyline = $derived(
    compute_lower_hull(plot_entries.map((e) => ({ x: e.x, y: e.y }))).sort(
      (a, b) => a.x - b.x,
    ),
  )

  const scatter_points_series = $derived.by(() => {
    const visible_entries = plot_entries.filter((e) => e.visible)
    const xs = visible_entries.map((e) => e.x)
    const ys = visible_entries.map((e) => e.y)

    // Stability mode: explicit per-point styles; Energy mode: use color_scale
    const is_energy_mode = color_mode === `energy`
    const point_style = is_energy_mode ? undefined : visible_entries.map((e) => ({
      fill: (e.is_stable || e.e_above_hull === 0)
        ? (merged_config.colors?.stable || `#0072B2`)
        : (merged_config.colors?.unstable || `#E69F00`),
      stroke: (e.is_stable || e.e_above_hull === 0) ? `#ffffff` : `#000000`,
      radius: e.size || ((e.is_stable || e.e_above_hull === 0) ? 6 : 4),
    }))

    return {
      x: xs,
      y: ys,
      metadata: visible_entries, // keep PD entry alongside each point
      markers: `points` as const,
      ...(is_energy_mode
        ? { color_values: visible_entries.map((e) => e.e_above_hull ?? 0) }
        : { point_style }),
    }
  })

  const hull_segments_series = $derived.by(() => {
    if (!merged_config.show_hull || hull_polyline.length < 2) return []
    const segments = []
    for (let idx = 0; idx < hull_polyline.length - 1; idx++) {
      const p1 = hull_polyline[idx]
      const p2 = hull_polyline[idx + 1]
      segments.push({
        x: [p1.x, p2.x] as const,
        y: [p1.y, p2.y] as const,
        markers: `line` as const,
        line_style: {
          stroke: PD_STYLE.structure_line.color,
          stroke_width: PD_STYLE.structure_line.line_width,
          line_dash: `${PD_STYLE.structure_line.dash[0]},${
            PD_STYLE.structure_line.dash[1]
          }`,
        },
      })
    }
    return segments
  })

  const scatter_series = $derived([scatter_points_series, ...hull_segments_series])

  const max_energy_threshold = $derived(
    compute_max_energy_threshold(processed_entries),
  )

  const phase_stats = $derived.by(() =>
    get_phase_diagram_stats(processed_entries, elements, 3)
  )

  // Labels with smart defaults
  let show_stable_labels = $state(true)
  let show_unstable_labels = $state(false)
  let label_energy_threshold = $state(0.1)
  $effect(() => {
    const total_entries = processed_entries.length
    if (total_entries > label_threshold) {
      show_stable_labels = false
      show_unstable_labels = false
    } else {
      show_stable_labels = true
      show_unstable_labels = false
    }
  })

  function extract_structure_from_entry(entry: PlotEntry3D): AnyStructure | null {
    if (!entry.entry_id) return null
    const original_entry = entries.find((orig_entry) =>
      orig_entry.entry_id === entry.entry_id
    )
    return original_entry?.structure as AnyStructure || null
  }

  const reset_camera = () => Object.assign(camera, camera_default)
  function reset_all() {
    reset_camera()
    fullscreen = PD_DEFAULTS.binary.fullscreen
    info_pane_open = PD_DEFAULTS.binary.info_pane_open
    legend_pane_open = PD_DEFAULTS.binary.legend_pane_open
    color_mode = PD_DEFAULTS.binary.color_mode
    color_scale = PD_DEFAULTS.binary.color_scale as D3InterpolateName
    show_stable = PD_DEFAULTS.binary.show_stable
    show_unstable = PD_DEFAULTS.binary.show_unstable
    show_stable_labels = PD_DEFAULTS.binary.show_stable_labels
    show_unstable_labels = PD_DEFAULTS.binary.show_unstable_labels
    energy_threshold = PD_DEFAULTS.binary.energy_threshold
    label_energy_threshold = PD_DEFAULTS.binary.label_energy_threshold
    reset_counter += 1
  }
  // Custom hover tooltip state used with ScatterPlot events
  let hover_data = $state<HoverData3D<PlotEntry3D> | null>(null)

  const handle_keydown = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement).tagName.match(/INPUT|TEXTAREA/)) return
    const actions: Record<string, () => void> = {
      r: reset_camera,
      b: () => color_mode = color_mode === `stability` ? `energy` : `stability`,
      s: () => show_stable = !show_stable,
      u: () => show_unstable = !show_unstable,
      l: () => show_stable_labels = !show_stable_labels,
    }
    actions[event.key.toLowerCase()]?.()
  }

  async function handle_file_drop(event: DragEvent): Promise<void> {
    drag_over = false
    const data = await parse_pd_entries_from_drop(event)
    if (data) on_file_drop?.(data)
  }

  function calculate_modal_side() {
    if (!wrapper) return
    const rect = wrapper.getBoundingClientRect()
    const viewport_width = globalThis.innerWidth
    const space_on_right = viewport_width - rect.right
    const space_on_left = rect.left
    modal_place_right = space_on_right >= space_on_left
  }

  function close_structure_popup() {
    modal_open = false
    selected_structure = null
    selected_entry = null
  }

  // Fullscreen handling
  $effect(() => {
    if (typeof window !== `undefined`) {
      if (fullscreen && !document.fullscreenElement && wrapper) {
        wrapper.requestFullscreen().catch(console.error)
      } else if (!fullscreen && document.fullscreenElement) {
        document.exitFullscreen()
      }
    }
  })

  let style = $derived(
    `--pd-stable-color:${merged_config.colors?.stable || `#0072B2`};
    --pd-unstable-color:${merged_config.colors?.unstable || `#E69F00`};
    --pd-edge-color:${merged_config.colors?.edge || `var(--text-color, #212121)`};
     --pd-annotation-color:${
      merged_config.colors?.annotation || `var(--text-color, #212121)`
    };`,
  )
</script>

<svelte:document
  onfullscreenchange={() => {
    fullscreen = Boolean(document.fullscreenElement)
  }}
/>

<!-- Hover tooltip matching 3D/4D style (content only; container handled by ScatterPlot) -->
{#snippet tooltip(point: PlotPoint & TooltipProps)}
  {@const entry = point.metadata as unknown as PlotEntry3D}
  {@const is_element = is_unary_entry(entry)}
  {@const elem_symbol = is_element ? Object.keys(entry.composition)[0] : ``}
  <div class="tooltip-title">
    {@html get_electro_neg_formula(entry.composition)}{
      is_element
      ? ` (${elem_symbol_to_name[elem_symbol as ElementSymbol] ?? ``})`
      : ``
    }
  </div>

  <div>
    E<sub>above hull</sub>: {format_num(entry.e_above_hull ?? 0, `.3~`)} eV/atom
  </div>
  <div>
    E<sub>form</sub>: {format_num(entry.e_form_per_atom ?? 0, `.3~`)} eV/atom
  </div>
  {#if entry.entry_id}
    <div>ID: {entry.entry_id}</div>
  {/if}

  {#if !is_element}
    {@const total = Object.values(entry.composition).reduce((sum, amt) => sum + amt, 0)}
    {@const fractions = Object.entries(entry.composition)
    .filter(([, amt]) => amt > 0)
    .map(([el, amt]) => `${el}=${format_fractional(amt / total)}`)}
    {#if fractions.length > 1}
      {fractions.join(` | `)}
    {/if}
  {/if}
{/snippet}

{#snippet user_content(
  { x_scale_fn, pad, height, y_scale_fn, y_min, width }: UserContentProps,
)}
  {@const [x1, y0] = [x_scale_fn(1), y_scale_fn(y_min)]}
  {@const stroke = {
    stroke: `var(--scatter-grid-stroke, gray)`,
    'stroke-width': `var(--scatter-grid-width, 0.4)`,
    'stroke-dasharray': `var(--scatter-grid-dash, 4)`,
  }}
  <line y1={pad.t} y2={height - pad.b} {x1} x2={x1} {...stroke} />
  <line x1={pad.l} x2={width - pad.r} y1={y0} y2={y0} {...stroke} />
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="phase-diagram-2d"
  class:dragover={drag_over}
  {style}
  bind:this={wrapper}
  role="application"
  tabindex="-1"
  onkeydown={handle_keydown}
  ondrop={handle_file_drop}
  ondragover={(event) => {
    event.preventDefault()
    drag_over = true
  }}
  ondragleave={(event) => {
    event.preventDefault()
    drag_over = false
  }}
  aria-label="Binary phase diagram visualization"
>
  <h3 style="position: absolute; left: 1em; top: 1ex; margin: 0">
    {phase_stats?.chemical_system}
  </h3>
  {#key reset_counter}
    <ScatterPlot
      series={scatter_series}
      x_range={x_domain}
      y_range={y_domain}
      x_ticks={4}
      y_ticks={4}
      x_grid={false}
      y_grid={false}
      x_label={elements.length === 2 ? `x in ${elements[0]}₁₋ₓ ${elements[1]}ₓ` : `x`}
      y_label="E<sub>form</sub> (eV/atom)"
      legend={null}
      color_bar={{
        title: `E<sub>above hull</sub> (eV/atom)`,
        wrapper_style:
          `position: absolute; top: 2em; left: 50%; transform: translateX(-50%); width: 260px;`,
        bar_style: `height: 16px;`,
      }}
      {tooltip}
      {user_content}
      point_events={{
        click: ({ point }) => {
          const entry = (point?.metadata as unknown) as PlotEntry3D
          on_point_click?.(entry)
          if (enable_structure_preview && entry) {
            const structure = extract_structure_from_entry(entry)
            if (structure) {
              selected_structure = structure
              selected_entry = entry
              calculate_modal_side()
              modal_open = true
            }
          }
        },
        mouseenter: ({ point, event }) => {
          const entry = (point?.metadata as unknown) as PlotEntry3D
          hover_data = entry
            ? {
              entry,
              position: {
                x: (event as MouseEvent).clientX,
                y: (event as MouseEvent).clientY,
              },
            }
            : null
          on_point_hover?.(hover_data)
        },
        mousemove: ({ point, event }) => {
          const entry = (point?.metadata as unknown) as PlotEntry3D
          hover_data = entry
            ? {
              entry,
              position: {
                x: (event as MouseEvent).clientX,
                y: (event as MouseEvent).clientY,
              },
            }
            : null
          on_point_hover?.(hover_data)
        },
        mouseleave: () => {
          hover_data = null
          on_point_hover?.(hover_data)
        },
      }}
      padding={{ t: 30, b: 60, l: 60, r: 30 }}
    />
  {/key}

  {#if merged_controls.show}
    <section class="control-buttons">
      <button
        type="button"
        onclick={reset_all}
        title="Reset view and settings"
        class="reset-camera-btn"
      >
        <Icon icon="Reset" />
      </button>

      {#if enable_info_pane && phase_stats}
        <PhaseDiagramInfoPane
          bind:pane_open={info_pane_open}
          {phase_stats}
          {stable_entries}
          {unstable_entries}
          {energy_threshold}
          {label_energy_threshold}
          {label_threshold}
          toggle_props={{
            class: `info-btn`,
          }}
        />
      {/if}

      {#if enable_fullscreen}
        <button
          type="button"
          onclick={() => toggle_fullscreen(wrapper)}
          title="{fullscreen ? `Exit` : `Enter`} fullscreen"
          class="fullscreen-btn"
        >
          <Icon icon="{fullscreen ? `Exit` : ``}Fullscreen" />
        </button>
      {/if}

      <PhaseDiagramControls
        bind:controls_open={legend_pane_open}
        bind:color_mode
        bind:color_scale
        bind:show_stable
        bind:show_unstable
        bind:show_stable_labels
        bind:show_unstable_labels
        bind:energy_threshold
        bind:label_energy_threshold
        {max_energy_threshold}
        {stable_entries}
        {unstable_entries}
        {total_unstable_count}
        {camera}
        {merged_controls}
        toggle_props={{
          class: `legend-controls-btn`,
        }}
        bind:energy_source_mode
        {has_precomputed_e_form}
        {can_compute_e_form}
        {has_precomputed_hull}
        {can_compute_hull}
      />
    </section>
  {/if}

  <!-- Drag over overlay -->
  {#if drag_over}
    <div class="drag-overlay">
      <div class="drag-message">
        <Icon icon="Info" />
        <span>Drop JSON file to load phase diagram data</span>
      </div>
    </div>
  {/if}

  {#if modal_open && selected_structure}
    <StructurePopup
      structure={selected_structure}
      place_right={modal_place_right}
      stats={{
        id: selected_entry?.entry_id,
        e_above_hull: selected_entry?.e_above_hull,
        e_form: selected_entry?.e_form_per_atom,
      }}
      onclose={close_structure_popup}
    />
  {/if}
</div>

<style>
  .phase-diagram-2d {
    position: relative;
    width: 100%;
    height: var(--pd-height, 620px);
    background: var(--surface-bg, #f8f9fa);
    border-radius: 4px;
  }
  .phase-diagram-2d:fullscreen {
    border-radius: 0;
  }
  .phase-diagram-2d.dragover {
    border: 2px dashed var(--accent-color, #1976d2);
  }

  .control-buttons {
    position: absolute;
    top: 1ex;
    right: 1ex;
    display: flex;
    gap: 8px;
  }
  .control-buttons button {
    background: transparent;
    border: none;
    padding: 4px;
    cursor: pointer;
    border-radius: 3px;
    color: var(--text-color, currentColor);
    transition: background-color 0.2s;
  }
  .control-buttons button:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  .drag-overlay {
    position: absolute;
    inset: 0;
    background: rgba(25, 118, 210, 0.1);
    border: 2px dashed var(--accent-color, #1976d2);
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }
  .drag-message {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: var(--accent-color, #1976d2);
    font-weight: 600;
    font-size: 1.1em;
  }
</style>
