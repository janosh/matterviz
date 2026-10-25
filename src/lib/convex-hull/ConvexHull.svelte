<script lang="ts">
  import type { AxisConfig } from '#lib/plot/index.js'
  import { get_convex_hull_defaults } from '#lib/settings.js'
  import { untrack } from 'svelte'
  import { normalize_show_controls } from '#lib/controls.js'
  import { SHORTCUTS, shortcut_attrs } from '#lib/shortcuts.js'
  import type { create_canvas_interactions } from './canvas-interactions.svelte'
  import { create_hull_selection } from './canvas-interactions.svelte'
  import ClickFeedback from 'svelte-widgets/ClickFeedback.svelte'
  import DragOverlay from 'svelte-widgets/DragOverlay.svelte'
  import Icon from 'svelte-widgets/Icon.svelte'
  import { Reset } from 'svelte-widgets/icons'
  import { ViewerChrome } from '#lib/layout/index.js'
  import ExportPane from '#lib/io/ExportPane.svelte'
  import { json_source, svg_sources, type ExportSources } from '#lib/io/export.js'
  import {
    csv_source,
    export_filename as chart_filename,
  } from '#lib/plot/core/utils/chart-export.js'
  import { PlotTooltip } from '#lib/plot/index.js'
  import { sanitize_html } from '#lib/sanitize.js'
  import { join_hover_link } from '#lib/tooltip/index.js'
  import { first_duplicate } from '#lib/utils.js'
  import ConvexHullControls from './ConvexHullControls.svelte'
  import ConvexHullInfoPane from './ConvexHullInfoPane.svelte'
  import ConvexHullTooltip from './ConvexHullTooltip.svelte'
  import GasPressureControls from './GasPressureControls.svelte'
  import StructurePopup from './StructurePopup.svelte'
  import TemperatureSlider from './TemperatureSlider.svelte'
  import type { HullFaceColorMode } from './types'
  import { DEFAULT_GAS_TEMP, MAGNETIC_ORDERING_CATEGORY } from './types'
  import { default_controls } from './index'
  import type { HullModel } from './model'
  import ConvexHull2D from './ConvexHull2D.svelte'
  import ConvexHullCanvas from './ConvexHullCanvas.svelte'
  import type { BaseConvexHullProps, Hull3DProps } from './index'
  import MissingConvexHullData from './MissingConvexHullData.svelte'
  import { create_hull_data_pipeline } from './hull-state.svelte'
  import { build_hull_overlay, current_entry, HULL_STABILITY_TOL } from './helpers'

  // One public viewer infers dimensionality; renderers only handle their plot geometry.
  type ConvexHullProps = BaseConvexHullProps &
    Hull3DProps & {
      x_axis?: AxisConfig
      y_axis?: AxisConfig
    }

  let {
    entries: entries_prop,
    components,
    label_threshold = 50,
    interpolate_temperature = true,
    max_interpolation_gap = 500,
    gas_config,
    entry_category = MAGNETIC_ORDERING_CATEGORY,
    // bindable props not part of rest because Svelte 5 doesn't support spreading bindable props.
    fullscreen = $bindable(false),
    wrapper = $bindable(),
    show_stable = $bindable(true),
    show_unstable = $bindable(true),
    hidden_categories = $bindable([]),
    show_hull_faces = $bindable(true),
    hull_face_opacity: hull_face_opacity_prop = $bindable(undefined as number | undefined),
    color_mode = $bindable(`energy`),
    color_scale = $bindable(`interpolateViridis`),
    info_pane_open = $bindable(false),
    controls_open = $bindable(false),
    max_hull_dist_show_phases: max_hull_dist_show_phases_prop = $bindable(
      undefined as number | undefined,
    ),
    max_hull_dist_show_labels = $bindable(0.1),
    // undefined = not passed: large datasets then start with labels hidden (label_threshold)
    show_stable_labels = $bindable(undefined as boolean | undefined),
    show_unstable_labels = $bindable(undefined as boolean | undefined),
    energy_source_mode = $bindable(`precomputed`),
    display = $bindable({ x_grid: false, y_grid: false }),
    highlighted_entries = $bindable([]),
    link_hover,
    selected_entry = $bindable(null),
    temperature = $bindable(),
    gas_pressures = $bindable({}),
    controls = {},
    show_controls,
    on_point_click,
    on_point_hover,
    fullscreen_toggle = true,
    enable_info_pane = true,
    allow_file_drop = true,
    on_file_load,
    enable_click_selection = true,
    enable_structure_preview = true,
    hull_face_color_mode: hull_face_color_mode_prop,
    annotations,
    tooltip,
    children,
    export_formats,
    export_filename,
    on_export,
    ...rest
  }: ConvexHullProps = $props()

  const entries = $derived(entries_prop ?? [])
  // entry_id keys selection, highlighting and structure previews: a repeat resolves to the first
  $effect(() => {
    const repeat = first_duplicate(entries.map(({ entry_id }) => entry_id).filter(Boolean))
    if (repeat) console.warn(`ConvexHull: duplicate entry_id "${repeat}"`)
  })

  // Passed values are the caller's choice: data-dependent defaults only fill unset ones
  const { max_hull_dist_explicit, labels_explicit } = untrack(() => ({
    max_hull_dist_explicit: max_hull_dist_show_phases_prop !== undefined,
    labels_explicit: show_stable_labels !== undefined || show_unstable_labels !== undefined,
  }))
  untrack(() => {
    show_stable_labels ??= true
    show_unstable_labels ??= false
  })

  // Shared reactive data pipeline (temperature → gas → energies → coordinates → hull)
  const hull_data = create_hull_data_pipeline({
    entries: () => entries,
    components: () => components,
    temperature: () => temperature,
    interpolate_temperature: () => interpolate_temperature,
    max_interpolation_gap: () => max_interpolation_gap,
    gas_config: () => gas_config,
    gas_pressures: () => gas_pressures,
    energy_source_mode: () => energy_source_mode,
    max_hull_dist_show_phases: () => max_hull_dist_show_phases,
    show_stable: () => show_stable,
    show_unstable: () => show_unstable,
    entry_category: () => entry_category,
    hidden_categories: () => hidden_categories,
    label_threshold: () => label_threshold,
    set_temperature: (next_temp) => (temperature = next_temp),
    set_max_hull_dist_show_phases: (value) => {
      if (!max_hull_dist_explicit) max_hull_dist_show_phases = value
    },
    hide_labels: () => {
      if (labels_explicit) return
      show_stable_labels = false
      show_unstable_labels = false
    },
  })
  export const get_model = (): HullModel | undefined =>
    hull_data.error ? undefined : hull_data.model
  const element_count = $derived(hull_data.elements.length)

  const hull_defaults = $derived(get_convex_hull_defaults(hull_data.dim))
  let hull_face_opacity = $derived(
    hull_face_opacity_prop ??
      (`hull_face_opacity` in hull_defaults ? hull_defaults.hull_face_opacity : 1),
  )
  let max_hull_dist_show_phases = $derived(
    max_hull_dist_show_phases_prop ?? hull_defaults.max_hull_dist_show_phases,
  )
  $effect(() => {
    if (element_count < 2 || element_count > 4) return
    if (hull_face_opacity_prop !== hull_face_opacity)
      hull_face_opacity_prop = hull_face_opacity
    if (max_hull_dist_show_phases_prop !== max_hull_dist_show_phases) {
      max_hull_dist_show_phases_prop = max_hull_dist_show_phases
    }
  })

  $effect(() => {
    if (!entries.length || hull_data.error) selected_entry = null
  })

  const dim = $derived(hull_data.dim)
  const merged_controls = $derived({ ...default_controls, ...controls })
  const controls_config = $derived(normalize_show_controls(show_controls))
  let hull_face_color = $derived(
    `hull_face_color` in hull_defaults ? hull_defaults.hull_face_color : ``,
  )
  let hull_face_color_mode = $derived(
    hull_face_color_mode_prop ??
      (`hull_face_color_mode` in hull_defaults
        ? hull_defaults.hull_face_color_mode
        : `uniform`),
  )
  let renderer = $state<ReturnType<typeof ConvexHullCanvas>>()
  let title_height = $state(0)
  const selection = create_hull_selection({
    entries: () => entries,
    plot_entries: () => hull_data.plot_entries,
    selected_entry: () => selected_entry,
    set_selected_entry: (entry) => (selected_entry = entry),
    enable_click_selection: () => enable_click_selection,
    enable_structure_preview: () => enable_structure_preview,
    allow_file_drop: () => allow_file_drop,
    on_point_click: () => on_point_click,
    on_point_hover: () => on_point_hover,
    on_file_load: () => on_file_load,
    entry_category: () => entry_category,
    wrapper: () => wrapper,
    actions: () => ({
      b: () => (color_mode = color_mode === `stability` ? `energy` : `stability`),
      s: () => (show_stable = !show_stable),
      u: () => (show_unstable = !show_unstable),
      l: () => (show_stable_labels = !show_stable_labels),
      r: () => reset_all(),
      ...(dim === 2 ? {} : { h: () => (show_hull_faces = !show_hull_faces) }),
      ...renderer?.get_actions(),
    }),
  })
  // Match renderer remounts: keep the bound selection but dismiss transient overlays.
  const renderer_key = $derived(entries.length && !hull_data.error ? dim : 0)
  $effect(() => {
    void renderer_key
    untrack(selection.reset)
  })
  // Linked-view overlay: products of the hovered (else selected) above-hull entry, annotations
  const decomposition_focus = $derived(
    [
      selection.hover_data?.entry,
      selected_entry && current_entry(selected_entry, hull_data.plot_entries),
    ].find((entry) => entry && (entry.e_above_hull ?? 0) > HULL_STABILITY_TOL) ?? null,
  )
  const overlay = $derived(
    decomposition_focus || annotations
      ? build_hull_overlay(hull_data.model, decomposition_focus, annotations)
      : undefined,
  )
  // Hovered entries link by entry_id; one hovered in another view highlights here
  const entry_link = join_hover_link(() => link_hover, `string`)
  $effect(() => entry_link.publish(selection.hover_data?.entry.entry_id ?? null))
  const shown_highlights = $derived(
    entry_link.linked === null
      ? highlighted_entries
      : [...highlighted_entries, entry_link.linked],
  )
  const { config, highlight_style, gizmo, x_axis, y_axis, ...dom_attrs } = $derived(rest)
  const plot_props = $derived({
    ...dom_attrs,
    hull_data,
    selection,
    chrome: chrome_content,
    config,
    color_mode,
    highlighted_entries: shown_highlights,
    highlight_style,
    selected_entry,
    overlay,
    children,
  })
  // === Export ===
  // The plotted entries (one row each, element amounts as columns) as CSV/JSON; the figure as
  // SVG/PNG of the 2D plot, or a PNG of the 3D/4D canvas redrawn at export resolution
  const entry_records = () =>
    [...hull_data.stable_entries, ...hull_data.unstable_entries].map((entry) => ({
      entry_id: entry.entry_id ?? null,
      formula: entry.reduced_formula ?? entry.name ?? null,
      composition: entry.composition,
      energy_per_atom: entry.energy_per_atom ?? null,
      e_form_per_atom: entry.e_form_per_atom ?? null,
      e_above_hull: entry.e_above_hull ?? null,
      is_stable: entry.is_stable ?? null,
    }))
  const export_sources = $derived<ExportSources>({
    ...(dim === 2
      ? svg_sources(() => wrapper?.querySelector<SVGSVGElement>(`:scope > svg`))
      : {
          png: (png_dpi) => {
            if (!renderer) throw new Error(`Convex hull canvas has not rendered yet`)
            return renderer.to_png_blob(png_dpi)
          },
        }),
    csv: csv_source(() => {
      const { elements } = hull_data
      const values = [`energy_per_atom`, `e_form_per_atom`, `e_above_hull`] as const
      return {
        header: [`entry_id`, `formula`, ...elements, ...values, `is_stable`],
        rows: entry_records().map((rec) => [
          rec.entry_id,
          rec.formula,
          ...elements.map((el) => (rec.composition as Record<string, number>)[el] ?? 0),
          ...values.map((key) => rec[key]),
          rec.is_stable == null ? null : String(rec.is_stable),
        ]),
      }
    }),
    json: json_source(entry_records),
  })

  function reset_all(reset_camera?: () => void) {
    const defaults = hull_defaults
    fullscreen = defaults.fullscreen
    info_pane_open = defaults.info_pane_open
    controls_open = defaults.legend_pane_open
    color_mode = defaults.color_mode
    color_scale = defaults.color_scale
    show_stable = defaults.show_stable
    show_unstable = defaults.show_unstable
    hidden_categories = []
    show_stable_labels = defaults.show_stable_labels
    show_unstable_labels = defaults.show_unstable_labels
    max_hull_dist_show_labels = defaults.max_hull_dist_show_labels
    // Auto-computed threshold based on entry count instead of the static default
    max_hull_dist_show_phases = hull_data.auto_default_threshold
    if (`show_hull_faces` in defaults) {
      show_hull_faces = defaults.show_hull_faces
      hull_face_color = defaults.hull_face_color
      hull_face_opacity = defaults.hull_face_opacity
      hull_face_color_mode = defaults.hull_face_color_mode as HullFaceColorMode
    }
    reset_camera?.()
  }
</script>

{#snippet chrome_content(context: ReturnType<typeof create_canvas_interactions> | null)}
  {@const { phase_stats, stable_entries, unstable_entries } = hull_data}
  {@const title = merged_controls.title || phase_stats?.chemical_system || ``}
  {@const gas_controls_config = hull_data.gas_analysis.has_gas_dependent_elements
    ? hull_data.merged_gas_config
    : undefined}
  <h3 class="hull-title" bind:clientHeight={title_height}>{@html sanitize_html(title)}</h3>

  <!-- Control buttons (top-right corner) -->
  <ViewerChrome
    {controls_config}
    bind:fullscreen
    {fullscreen_toggle}
    {wrapper}
    fullscreen_bg_css_var="--hull-bg-fullscreen"
    on_fullscreen_change={context?.recenter_camera}
    class="convex-hull-toolbar"
    style="--viewer-buttons-gap: 0"
  >
    {#if controls_config.visible(`reset`)}
      <button
        type="button"
        onclick={() => reset_all(context?.reset_camera)}
        {...dim === 2
          ? shortcut_attrs(`hull_reset`)
          : { title: SHORTCUTS.hull_reset.description }}
      >
        <Icon icon={Reset} />
      </button>
    {/if}

    {#if enable_info_pane && phase_stats && controls_config.visible(`info-pane`)}
      <ConvexHullInfoPane
        bind:pane_open={info_pane_open}
        {phase_stats}
        {stable_entries}
        {unstable_entries}
        {show_stable}
        {show_unstable}
        {entry_category}
        {hidden_categories}
        {max_hull_dist_show_phases}
        {max_hull_dist_show_labels}
        {label_threshold}
        toggle_props={{ class: `info-btn` }}
        shortcut_scopes={[
          `viewer`,
          `convex-hull`,
          ...(dim === 2
            ? [`convex-hull-2d` as const]
            : [`convex-hull-3d` as const, `camera` as const]),
          ...(dim === 3 ? [`convex-hull-ternary` as const] : []),
        ]}
      />
    {/if}

    {#if export_formats?.length !== 0 && controls_config.visible(`export-pane`)}
      <ExportPane
        filename={export_filename ?? chart_filename(title || `convex-hull`)}
        sources={export_sources}
        {export_formats}
        {on_export}
        toggle_props={{ class: `hull-export-toggle`, title: `Export convex hull` }}
      />
    {/if}

    {#if controls_config.visible(`controls`)}
      <ConvexHullControls
        bind:controls_open
        bind:color_mode
        bind:color_scale
        bind:show_stable
        bind:show_unstable
        {entry_category}
        bind:hidden_categories
        bind:show_stable_labels
        bind:show_unstable_labels
        bind:max_hull_dist_show_phases
        bind:max_hull_dist_show_labels
        max_hull_dist_in_data={hull_data.max_hull_dist_in_data}
        {stable_entries}
        {unstable_entries}
        bind:camera={
          () => context?.camera,
          (value) => {
            if (context && value) context.camera = value
          }
        }
        {merged_controls}
        toggle_props={{ class: `legend-controls-btn` }}
        bind:show_hull_faces={
          () => (dim === 2 ? undefined : show_hull_faces),
          (value) => {
            if (value !== undefined) show_hull_faces = value
          }
        }
        bind:hull_face_color
        bind:hull_face_opacity
        bind:hull_face_color_mode
        bind:energy_source_mode
        energy_info={hull_data.energy_info}
      />
    {/if}
  </ViewerChrome>

  {#if context && selection.hover_data && tooltip !== false}
    {@const { entry, position } = selection.hover_data}
    <!-- one above the control buttons so a tooltip near the top-right corner covers them -->
    <PlotTooltip
      x={position.x}
      y={position.y}
      offset={{ x: 10, y: -10 }}
      bg_color={context.get_point_color(entry)}
      fixed
      style="z-index: calc(var(--z-index-overlay-controls, 100000000) + 1)"
    >
      <ConvexHullTooltip
        {entry}
        polymorph_stats_map={hull_data.polymorph_stats_map}
        highlight_style={context.is_highlighted(entry) ? context.highlight_style : undefined}
        {entry_category}
        {tooltip}
      />
    </PlotTooltip>
  {/if}

  <!-- Copy-to-clipboard feedback (double-click on point) -->
  <ClickFeedback
    visible={selection.copy_feedback.visible}
    position={selection.copy_feedback.position}
  />

  <!-- z-index 1: above auto-stacked siblings after the chrome (3D gizmo, gas controls), below z-2 sliders -->
  <DragOverlay
    visible={selection.dragover}
    message="Drop JSON file to load phase diagram data"
    style="z-index: 1"
  />

  <!-- One popup for pinned and previewed entries, so pinning a preview doesn't remount it -->
  {@const pinned = selection.modal_open ? selection.selected_structure : null}
  {@const popup = pinned ? { structure: pinned, entry: selected_entry } : selection.preview}
  {#if popup}
    <StructurePopup
      structure={popup.structure}
      place_right={selection.modal_place_right}
      stats={{
        id: popup.entry?.entry_id,
        e_above_hull: popup.entry?.e_above_hull,
        e_form: popup.entry?.e_form_per_atom,
      }}
      on_close={pinned ? selection.close_structure_popup : selection.clear_preview}
      show_drag_handle={Boolean(pinned)}
      style={pinned ? undefined : `pointer-events: none`}
    />
  {/if}

  {#if (hull_data.has_temp_data && temperature !== undefined) || gas_controls_config}
    <div class="right-controls">
      {#if hull_data.has_temp_data && temperature !== undefined}
        <TemperatureSlider
          available_temperatures={hull_data.available_temperatures}
          {interpolate_temperature}
          bind:temperature
        />
      {/if}
      {#if gas_controls_config}
        <GasPressureControls
          config={gas_controls_config}
          bind:pressures={gas_pressures}
          temperature={temperature ?? DEFAULT_GAS_TEMP}
        />
      {/if}
    </div>
  {/if}
{/snippet}

<!-- keyed so a dimension switch remounts the renderer with its new geometry -->
{#if entries.length && !hull_data.error}
  {#key dim}
    {#if dim === 2}
      <ConvexHull2D
        {...plot_props}
        {entry_category}
        {color_scale}
        {tooltip}
        {title_height}
        {x_axis}
        {y_axis}
        bind:fullscreen
        bind:wrapper
        bind:display
      />
    {:else}
      <ConvexHullCanvas
        {...plot_props}
        bind:this={renderer}
        bind:wrapper
        {dim}
        {merged_controls}
        {controls_config}
        {gizmo}
        {show_hull_faces}
        {hull_face_color}
        {hull_face_opacity}
        {hull_face_color_mode}
        {color_scale}
        {max_hull_dist_show_labels}
        {show_stable_labels}
        {show_unstable_labels}
      />
    {/if}
  {/key}
{:else}
  <MissingConvexHullData
    {...dom_attrs}
    error={hull_data.error}
    style="{rest.style ?? ``}; height: var(--hull-height, 500px)"
  />
{/if}

<style>
  .hull-title {
    position: absolute;
    left: 1em;
    top: var(--hull-title-top, 1ex);
    margin: 0;
    font-weight: 500;
  }
  .right-controls {
    position: absolute;
    top: calc(1ex + 50px);
    right: 1ex;
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
  }
</style>
