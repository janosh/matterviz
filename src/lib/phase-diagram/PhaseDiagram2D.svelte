<script lang="ts">
  import type {
    AnyStructure,
    CompositionType,
    ElementSymbol,
    UserContentProps,
  } from '$lib'
  import { Icon, is_unary_entry, PD_DEFAULTS, toggle_fullscreen } from '$lib'
  import type { D3InterpolateName } from '$lib/colors'
  import { ClickFeedback, DragOverlay } from '$lib/feedback'
  import type {
    AxisConfig,
    ScatterHandlerEvent,
    ScatterHandlerProps,
  } from '$lib/plot'
  import { ScatterPlot } from '$lib/plot'
  import { SvelteMap } from 'svelte/reactivity'
  import * as helpers from './helpers'
  import type { BasePhaseDiagramProps } from './index'
  import { default_controls, default_pd_config, PD_STYLE } from './index'
  import PhaseDiagramControls from './PhaseDiagramControls.svelte'
  import PhaseDiagramInfoPane from './PhaseDiagramInfoPane.svelte'
  import PhaseEntryTooltip from './PhaseEntryTooltip.svelte'
  import StructurePopup from './StructurePopup.svelte'
  import * as thermo from './thermodynamics'
  import type { HoverData3D, PhaseData, PhaseDiagramEntry } from './types'

  // Binary phase diagram rendered as energy vs composition (x in [0, 1])
  let {
    entries,
    controls = {},
    config = {},
    on_point_click,
    on_point_hover,
    fullscreen = $bindable(false),
    enable_fullscreen = true,
    enable_info_pane = true,
    wrapper = $bindable(),
    label_threshold = 50,
    show_stable = $bindable(true),
    show_unstable = $bindable(true),
    color_mode = $bindable(`energy`),
    color_scale = $bindable(`interpolateViridis`),
    info_pane_open = $bindable(false),
    legend_pane_open = $bindable(false),
    max_hull_dist_show_phases = $bindable(0.1),
    max_hull_dist_show_labels = $bindable(0.1),
    show_stable_labels = $bindable(true),
    show_unstable_labels = $bindable(false),
    on_file_drop,
    enable_structure_preview = true,
    energy_source_mode = $bindable(`precomputed`),
    phase_stats = $bindable(null),
    display = $bindable({ x_grid: false, y_grid: false }),
    x_axis = {},
    y_axis = {},
    selected_entry = $bindable(null),
    ...rest
  }: BasePhaseDiagramProps & {
    x_axis?: AxisConfig
    y_axis?: AxisConfig
    selected_entry?: PhaseDiagramEntry | null
  } = $props()

  const merged_controls = $derived({ ...default_controls, ...controls })
  const merged_config = $derived({
    ...default_pd_config,
    point_size: 6, // Binary diagrams use slightly smaller points
    ...config,
    colors: { ...default_pd_config.colors, ...(config.colors || {}) },
    margin: { t: 40, r: 40, b: 60, l: 60, ...(config.margin || {}) },
  })

  let { // Compute energy mode information
    has_precomputed_e_form,
    has_precomputed_hull,
    can_compute_e_form,
    can_compute_hull,
    energy_mode,
    unary_refs,
  } = $derived(
    helpers.compute_energy_mode_info(
      entries,
      thermo.find_lowest_energy_unary_refs,
      energy_source_mode,
    ),
  )

  const effective_entries = $derived(
    helpers.get_effective_entries(
      entries,
      energy_mode,
      unary_refs,
      thermo.compute_e_form_per_atom,
    ),
  )

  // Process data and element set
  const pd_data = $derived(thermo.process_pd_entries(effective_entries))

  const elements = $derived.by(() => {
    if (pd_data.elements.length > 2) {
      console.error(
        `PhaseDiagram2D: Dataset contains ${pd_data.elements.length} elements, but binary diagrams require exactly 2. Found: [${
          pd_data.elements.join(`, `)
        }]`,
      )
      return []
    }
    return pd_data.elements
  })

  // Coordinate computation ----------------------------------------------------
  function compute_binary_coordinates(
    raw_entries: PhaseData[],
    elems: ElementSymbol[],
  ): PhaseDiagramEntry[] {
    if (elems.length !== 2) return []
    const [el1, el2] = elems
    const coords: PhaseDiagramEntry[] = []
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
    const el_a: PhaseDiagramEntry | undefined = coords.find((e) =>
      e.is_element && e.x === 0
    )
    const el_b: PhaseDiagramEntry | undefined = coords.find((e) =>
      e.is_element && e.x === 1
    )
    if (!el_a) {
      coords.push({
        composition: { [el1]: 1 } as CompositionType,
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
        composition: { [el2]: 1 } as CompositionType,
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
    const entries_by_x = new SvelteMap<number, PhaseDiagramEntry[]>()
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
        (!is_stable && show_unstable && above <= max_hull_dist_show_phases)
      return { ...e, e_above_hull: above, is_stable, visible }
    })

    return enriched.filter((
      e,
    ) => (e.is_stable || (e.e_above_hull ?? 0) <= max_hull_dist_show_phases))
  })

  const stable_entries = $derived(
    plot_entries.filter((entry: PhaseDiagramEntry) =>
      entry.is_stable || entry.e_above_hull === 0
    ),
  )
  const unstable_entries = $derived(
    plot_entries.filter((entry: PhaseDiagramEntry) =>
      (entry.e_above_hull ?? 0) > 0 && !entry.is_stable
    ),
  )

  let reset_counter = $state(0)

  // Drag and drop state (to match 3D/4D components)
  let drag_over = $state(false)

  // Copy feedback state
  let copy_feedback = $state({ visible: false, position: { x: 0, y: 0 } })

  // Structure popup state
  let structure_popup = $state<{
    open: boolean
    structure: AnyStructure | null
    entry: PhaseDiagramEntry | null
    place_right: boolean
  }>({
    open: false,
    structure: null,
    entry: null,
    place_right: true,
  })

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

  const max_hull_dist_in_data = $derived(
    helpers.calc_max_hull_dist_in_data(effective_entries),
  )

  // Phase diagram statistics - compute internally and expose via bindable prop
  $effect(() => {
    phase_stats = thermo.get_phase_diagram_stats(effective_entries, elements, 3)
  })

  function extract_structure_from_entry(
    entry: PhaseDiagramEntry,
  ): AnyStructure | null {
    if (!entry.entry_id) return null
    const orig_entry = entries.find((ent) => ent.entry_id === entry.entry_id)
    return orig_entry?.structure as AnyStructure || null
  }

  function reset_all() {
    fullscreen = PD_DEFAULTS.binary.fullscreen
    info_pane_open = PD_DEFAULTS.binary.info_pane_open
    legend_pane_open = PD_DEFAULTS.binary.legend_pane_open
    color_mode = PD_DEFAULTS.binary.color_mode
    color_scale = PD_DEFAULTS.binary.color_scale as D3InterpolateName
    show_stable = PD_DEFAULTS.binary.show_stable
    show_unstable = PD_DEFAULTS.binary.show_unstable
    show_stable_labels = PD_DEFAULTS.binary.show_stable_labels
    show_unstable_labels = PD_DEFAULTS.binary.show_unstable_labels
    max_hull_dist_show_phases = PD_DEFAULTS.binary.max_hull_dist_show_phases
    max_hull_dist_show_labels = PD_DEFAULTS.binary.max_hull_dist_show_labels
    reset_counter += 1
  }
  // Custom hover tooltip state used with ScatterPlot events
  let hover_data = $state<HoverData3D<PhaseDiagramEntry> | null>(null)

  const handle_keydown = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement).tagName.match(/INPUT|TEXTAREA/)) return
    const actions: Record<string, () => void> = {
      b: () => color_mode = color_mode === `stability` ? `energy` : `stability`,
      s: () => show_stable = !show_stable,
      u: () => show_unstable = !show_unstable,
      l: () => show_stable_labels = !show_stable_labels,
    }
    actions[event.key.toLowerCase()]?.()
  }

  async function handle_file_drop(event: DragEvent): Promise<void> {
    drag_over = false
    const data = await helpers.parse_pd_entries_from_drop(event)
    if (data) on_file_drop?.(data)
  }

  async function copy_entry_data(
    entry: PhaseDiagramEntry,
    position: { x: number; y: number },
  ) {
    await helpers.copy_entry_to_clipboard(entry, position, (visible, pos) => {
      copy_feedback.visible = visible
      copy_feedback.position = pos
    })
  }

  function close_structure_popup() {
    structure_popup = { open: false, structure: null, entry: null, place_right: true }
    selected_entry = null
  }

  // Track last clicked entry for double-click detection
  let last_clicked_entry: PhaseDiagramEntry | null = null
  let last_click_time = 0

  function handle_point_click_internal(data: ScatterHandlerEvent) {
    const entry = data.metadata as unknown as PhaseDiagramEntry
    if (!entry) return

    const now = Date.now()
    const is_double_click = last_clicked_entry === entry &&
      now - last_click_time < 300

    if (is_double_click) {
      // Double-click: copy to clipboard
      copy_entry_data(entry, {
        x: data.event.clientX,
        y: data.event.clientY,
      })
      last_clicked_entry = null
      last_click_time = 0
    } else {
      // Single click: show structure preview
      last_clicked_entry = entry
      last_click_time = now

      on_point_click?.(entry)
      if (enable_structure_preview) {
        const structure = extract_structure_from_entry(entry)
        if (structure) {
          const viewport_width = globalThis.innerWidth
          const click_x = data.event.clientX
          const space_on_right = viewport_width - click_x
          const space_on_left = click_x
          const place_right = space_on_right >= space_on_left

          structure_popup = { open: true, structure, entry, place_right }
          selected_entry = entry
          data.event.stopPropagation()
        }
      }
    }
  }

  // Fullscreen handling
  $effect(() => {
    helpers.setup_fullscreen_effect(fullscreen, wrapper)
    helpers.set_fullscreen_bg(wrapper, fullscreen, `--pd-2d-bg-fullscreen`)
  })

  let style = $derived(
    `--pd-stable-color:${merged_config.colors?.stable || `#0072B2`};
    --pd-unstable-color:${merged_config.colors?.unstable || `#E69F00`};
    --pd-edge-color:${merged_config.colors?.edge || `var(--text-color, #212121)`};
     --pd-text-color:${
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
{#snippet tooltip(point: ScatterHandlerProps)}
  {@const entry = point.metadata as unknown as PhaseData}
  {#if entry}
    <PhaseEntryTooltip {entry} all_entries={entries} />
  {/if}
{/snippet}

{#snippet user_content(
  { x_scale_fn, pad, height, y_scale_fn, y_range, width }: UserContentProps,
)}
  {@const [x0, x1, y0] = [x_scale_fn(0), x_scale_fn(1), y_scale_fn(y_range[0])]}
  {@const stroke = {
    stroke: `var(--scatter-grid-stroke, gray)`,
    'stroke-width': `var(--scatter-grid-width, 0.4)`,
    'stroke-dasharray': `var(--scatter-grid-dash, 4)`,
  }}
  <line y1={pad.t} y2={height - pad.b} x1={x0} x2={x0} {...stroke} />
  <line y1={pad.t} y2={height - pad.b} {x1} x2={x1} {...stroke} />
  <line x1={pad.l} x2={width - pad.r} y1={y0} y2={y0} {...stroke} />
{/snippet}

{#key reset_counter}
  <ScatterPlot
    {...rest}
    class="phase-diagram-2d {rest.class ?? ``} {drag_over ? `dragover` : ``}"
    style={`${style}; ${rest.style ?? ``}`}
    bind:wrapper
    role="application"
    tabindex={-1}
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
    series={scatter_series}
    bind:display
    x_axis={{
      label: elements.length === 2 ? `x in ${elements[0]}₁₋ₓ ${elements[1]}ₓ` : `x`,
      range: x_domain,
      ticks: 4,
      ...x_axis,
    }}
    y_axis={{
      label: `E<sub>form</sub> (eV/atom)`,
      range: y_domain,
      ticks: 4,
      label_shift: { y: 15 },
      ...y_axis,
    }}
    legend={null}
    color_bar={{
      title: `E<sub>above hull</sub> (eV/atom)`,
      bar_style: `width: 220px; height: 16px;`,
    }}
    {tooltip}
    {user_content}
    on_point_click={handle_point_click_internal}
    on_point_hover={(data: ScatterHandlerEvent | null) => {
      if (!data) {
        hover_data = null
        on_point_hover?.(null)
        return
      }
      const entry = data.metadata as unknown as PhaseDiagramEntry
      hover_data = entry
        ? {
          entry,
          position: {
            x: data.event.clientX,
            y: data.event.clientY,
          },
        }
        : null
      on_point_hover?.(hover_data)
    }}
    padding={{ t: 30, b: 60, l: 60, r: 30 }}
  >
    <h3 style="position: absolute; left: 1em; top: 1ex; margin: 0">
      {phase_stats?.chemical_system}
    </h3>

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
            {max_hull_dist_show_phases}
            {max_hull_dist_show_labels}
            {label_threshold}
            toggle_props={{ class: `info-btn` }}
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
          bind:max_hull_dist_show_phases
          bind:max_hull_dist_show_labels
          {max_hull_dist_in_data}
          {stable_entries}
          {unstable_entries}
          {merged_controls}
          toggle_props={{ class: `legend-controls-btn` }}
          bind:energy_source_mode
          {has_precomputed_e_form}
          {can_compute_e_form}
          {has_precomputed_hull}
          {can_compute_hull}
        />
      </section>
    {/if}

    <ClickFeedback
      bind:visible={copy_feedback.visible}
      position={copy_feedback.position}
    />
    <DragOverlay visible={drag_over} />

    {#if structure_popup.open && structure_popup.structure}
      <StructurePopup
        structure={structure_popup.structure}
        place_right={structure_popup.place_right}
        stats={{
          id: structure_popup.entry?.entry_id,
          e_above_hull: structure_popup.entry?.e_above_hull,
          e_form: structure_popup.entry?.e_form_per_atom,
        }}
        onclose={close_structure_popup}
      />
    {/if}
  </ScatterPlot>
{/key}

<style>
  :global(.phase-diagram-2d:fullscreen) {
    background: var(--pd-2d-bg-fullscreen, var(--pd-2d-bg, var(--pd-bg))) !important;
  }
  :global(.phase-diagram-2d.dragover) {
    border: 2px dashed var(--accent-color, #1976d2) !important;
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
    display: flex;
    font-size: clamp(1em, 2cqmin, 2.5em);
  }
  .control-buttons button:hover {
    background: var(--pane-btn-bg-hover, rgba(255, 255, 255, 0.2));
  }
</style>
