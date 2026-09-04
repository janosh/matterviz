<script lang="ts">
  // Everything ConvexHull2D/3D/4D lay over their plot: title, loading spinner, control
  // toolbar (reset, info pane, fullscreen, controls pane), hover tooltip, copy feedback,
  // drag overlay, structure popup and the temperature/gas-pressure controls. Reset of the
  // shared view settings lives here too since they are all bound through this component.
  import type { D3InterpolateName } from '$lib/colors'
  import type { ShowControlsState } from '$lib/controls'
  import { ClickFeedback, DragOverlay, Spinner } from '$lib/feedback'
  import { ViewerChrome } from '$lib/layout'
  import { PlotTooltip } from '$lib/plot'
  import { sanitize_html } from '$lib/sanitize'
  import { DEFAULTS } from '$lib/settings'
  import type { ComponentProps } from 'svelte'
  import { Icon } from 'svelte-widgets'
  import { Reset } from 'svelte-widgets/icons'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { HullSelection } from './canvas-interactions.svelte'
  import ConvexHullControls from './ConvexHullControls.svelte'
  import ConvexHullInfoPane from './ConvexHullInfoPane.svelte'
  import ConvexHullTooltip from './ConvexHullTooltip.svelte'
  import GasPressureControls from './GasPressureControls.svelte'
  import type { create_hull_data_pipeline } from './hull-state.svelte'
  import type { ConvexHullTooltipProp } from './index'
  import StructurePopup from './StructurePopup.svelte'
  import TemperatureSlider from './TemperatureSlider.svelte'
  import type { ConvexHullEntry, GasSpecies, HighlightStyle, HullFaceColorMode } from './types'
  import { DEFAULT_GAS_TEMP, MAGNETIC_ORDERING_CATEGORY } from './types'

  type ControlsProps = ComponentProps<typeof ConvexHullControls>

  let {
    kind,
    selection,
    hull_data,
    controls_config,
    loading = false,
    show_tooltip = true,
    on_reset,
    enable_info_pane = true,
    phase_stats,
    label_threshold,
    fullscreen = $bindable(false),
    fullscreen_toggle = true,
    on_fullscreen_change,
    wrapper,
    camera,
    merged_controls,
    stable_entries,
    unstable_entries,
    get_point_color,
    merged_highlight_style,
    is_highlighted,
    tooltip,
    selected_entry,
    temperature = $bindable(),
    gas_pressures = $bindable({}),
    show_hull_faces = $bindable(),
    hull_face_color = $bindable(),
    hull_face_opacity = $bindable(),
    hull_face_color_mode = $bindable(),
    info_pane_open = $bindable(false),
    controls_open = $bindable(false),
    color_mode = $bindable(`stability`),
    color_scale = $bindable(`interpolateViridis`),
    show_stable = $bindable(true),
    show_unstable = $bindable(true),
    entry_category = MAGNETIC_ORDERING_CATEGORY,
    hidden_categories = $bindable([]),
    show_stable_labels = $bindable(true),
    show_unstable_labels = $bindable(false),
    max_hull_dist_show_phases = $bindable(0),
    max_hull_dist_show_labels = $bindable(0.1),
    energy_source_mode = $bindable(`precomputed`),
  }: Omit<
    // Every ConvexHullControls prop is forwarded except the ones this component supplies itself
    ControlsProps,
    | keyof HTMLAttributes<HTMLDivElement>
    | `toggle_props`
    | `pane_props`
    | `max_hull_dist_in_data`
    | `energy_info`
  > &
    Pick<ComponentProps<typeof ConvexHullInfoPane>, `phase_stats` | `label_threshold`> & {
      kind: `binary` | `ternary` | `quaternary` // DEFAULTS.convex_hull section for reset
      selection: HullSelection
      hull_data: ReturnType<typeof create_hull_data_pipeline>
      controls_config: ShowControlsState
      loading?: boolean
      show_tooltip?: boolean // off when the host plot renders its own tooltip (2D)
      on_reset?: () => void // host-specific reset (camera, face colour) after the shared one
      enable_info_pane?: boolean
      fullscreen?: boolean
      fullscreen_toggle?: boolean
      on_fullscreen_change?: (fullscreen: boolean) => void
      wrapper?: HTMLDivElement // the host's root, sent fullscreen by the toggle
      get_point_color: (entry: ConvexHullEntry) => string
      merged_highlight_style: HighlightStyle
      is_highlighted: (entry: ConvexHullEntry) => boolean
      tooltip?: ConvexHullTooltipProp<ConvexHullEntry>
      selected_entry: ConvexHullEntry | null
      temperature?: number
      gas_pressures?: Partial<Record<GasSpecies, number>>
      info_pane_open?: boolean
    } = $props()

  const title = $derived(merged_controls.title || phase_stats?.chemical_system || ``)
  // Gas pressure controls only make sense when the system contains gas-derived elements
  const gas_config = $derived(
    hull_data.gas_analysis.has_gas_dependent_elements
      ? hull_data.merged_gas_config
      : undefined,
  )

  export function reset_all() {
    const defaults = DEFAULTS.convex_hull[kind]
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
    on_reset?.()
  }
</script>

<h3 class="hull-title">{@html sanitize_html(title)}</h3>

{#if loading}
  <Spinner
    text="Loading data..."
    style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center"
  />
{/if}

<!-- Control buttons (top-right corner) -->
<ViewerChrome
  {controls_config}
  bind:fullscreen
  {fullscreen_toggle}
  {wrapper}
  fullscreen_bg_css_var="--hull-bg-fullscreen"
  {on_fullscreen_change}
  style="--viewer-buttons-gap: 0"
>
  {#if controls_config.visible(`reset`)}
    <button
      type="button"
      onclick={reset_all}
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
      {camera}
      {merged_controls}
      toggle_props={{ class: `legend-controls-btn` }}
      bind:show_hull_faces
      bind:hull_face_color
      bind:hull_face_opacity
      bind:hull_face_color_mode
      bind:energy_source_mode
      energy_info={hull_data.energy_info}
    />
  {/if}
</ViewerChrome>

{#if show_tooltip && selection.hover_data}
  {@const { entry, position } = selection.hover_data}
  <!-- one above the control buttons so a tooltip near the top-right corner covers them -->
  <PlotTooltip
    x={position.x}
    y={position.y}
    offset={{ x: 10, y: -10 }}
    bg_color={get_point_color(entry)}
    fixed
    style="z-index: calc(var(--z-index-overlay-controls, 100000000) + 1); backdrop-filter: blur(4px); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3)"
  >
    <ConvexHullTooltip
      {entry}
      polymorph_stats_map={hull_data.polymorph_stats_map}
      highlight_style={is_highlighted(entry) ? merged_highlight_style : undefined}
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

{#if (hull_data.has_temp_data && temperature !== undefined) || gas_config}
  <div class="right-controls">
    {#if hull_data.has_temp_data && temperature !== undefined}
      <TemperatureSlider
        available_temperatures={hull_data.available_temperatures}
        interpolate_temperature={hull_data.interpolate_temperature}
        bind:temperature
      />
    {/if}
    {#if gas_config}
      <GasPressureControls
        config={gas_config}
        bind:pressures={gas_pressures}
        temperature={temperature ?? DEFAULT_GAS_TEMP}
      />
    {/if}
  </div>
{/if}

<style>
  .hull-title {
    position: absolute;
    left: 1em;
    top: 1ex;
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
