<script lang="ts">
  import type { AxisConfig } from '$lib/plot'
  import { get_convex_hull_defaults } from '$lib/settings'
  import { untrack } from 'svelte'
  import { normalize_show_controls } from '$lib/controls'
  import {
    create_hull_selection,
    type create_canvas_interactions,
  } from './canvas-interactions.svelte'
  import type { D3InterpolateName } from '$lib/colors'
  import { ClickFeedback, DragOverlay, Icon } from 'svelte-widgets'
  import { Reset } from 'svelte-widgets/icons'
  import { ViewerChrome } from '$lib/layout'
  import { PlotTooltip } from '$lib/plot'
  import { sanitize_html } from '$lib/sanitize'
  import ConvexHullControls from './ConvexHullControls.svelte'
  import ConvexHullInfoPane from './ConvexHullInfoPane.svelte'
  import ConvexHullTooltip from './ConvexHullTooltip.svelte'
  import GasPressureControls from './GasPressureControls.svelte'
  import StructurePopup from './StructurePopup.svelte'
  import TemperatureSlider from './TemperatureSlider.svelte'
  import {
    DEFAULT_GAS_TEMP,
    MAGNETIC_ORDERING_CATEGORY,
    type HullFaceColorMode,
  } from './types'
  import { default_controls } from './index'
  import type { HullModel } from './model'
  import ConvexHull2D from './ConvexHull2D.svelte'
  import ConvexHullCanvas from './ConvexHullCanvas.svelte'
  import type { BaseConvexHullProps, Hull3DProps } from './index'
  import MissingConvexHullData from './MissingConvexHullData.svelte'
  import { create_hull_data_pipeline } from './hull-state.svelte'

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
    show_stable_labels = $bindable(true),
    show_unstable_labels = $bindable(false),
    energy_source_mode = $bindable(`precomputed`),
    display = $bindable({ x_grid: false, y_grid: false }),
    highlighted_entries = $bindable([]),
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
    on_file_drop,
    enable_click_selection = true,
    enable_structure_preview = true,
    hull_face_color_mode: hull_face_color_mode_prop,
    tooltip,
    children,
    ...rest
  }: ConvexHullProps = $props()

  const entries = $derived(entries_prop ?? [])

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
    set_max_hull_dist_show_phases: (value) => (max_hull_dist_show_phases = value),
    hide_labels: () => {
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
    on_file_drop: () => on_file_drop,
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
  const { config, highlight_style, gizmo, x_axis, y_axis, ...dom_attrs } = $derived(rest)
  const plot_props = $derived({
    ...dom_attrs,
    hull_data,
    selection,
    chrome: chrome_content,
    config,
    color_mode,
    highlighted_entries,
    highlight_style,
    selected_entry,
    children,
  })
  function reset_all(reset_camera?: () => void) {
    const defaults = hull_defaults
    fullscreen = defaults.fullscreen
    info_pane_open = defaults.info_pane_open
    controls_open = defaults.legend_pane_open
    color_mode = defaults.color_mode
    color_scale = defaults.color_scale as D3InterpolateName
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
        title="Reset view and settings"
        class="reset-camera-btn"
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

  {#if context && selection.hover_data}
    {@const { entry, position } = selection.hover_data}
    <!-- one above the control buttons so a tooltip near the top-right corner covers them -->
    <PlotTooltip
      x={position.x}
      y={position.y}
      offset={{ x: 10, y: -10 }}
      bg_color={context.get_point_color(entry)}
      fixed
      style="z-index: calc(var(--z-index-overlay-controls, 100000000) + 1); backdrop-filter: blur(4px); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3)"
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

  {#if selection.modal_open && selection.selected_structure}
    <StructurePopup
      structure={selection.selected_structure}
      place_right={selection.modal_place_right}
      stats={{
        id: selected_entry?.entry_id,
        e_above_hull: selected_entry?.e_above_hull,
        e_form: selected_entry?.e_form_per_atom,
      }}
      on_close={selection.close_structure_popup}
    />
  {/if}

  {#if (hull_data.has_temp_data && temperature !== undefined) || gas_controls_config}
    <div class="right-controls">
      {#if hull_data.has_temp_data && temperature !== undefined}
        <TemperatureSlider
          available_temperatures={hull_data.available_temperatures}
          interpolate_temperature={hull_data.interpolate_temperature}
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
  :global(.convex-hull-toolbar > button > svg) {
    --viewer-buttons-icon-size: 1.43em;
    font-size: var(--ctrl-btn-icon-size, clamp(0.7rem, 2cqmin, 0.85rem));
  }
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
