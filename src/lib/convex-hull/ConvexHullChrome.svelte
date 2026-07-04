<script lang="ts">
  import type { ShowControlsState } from '$lib/controls'
  // Shared ConvexHull3D/4D chrome: control-buttons toolbar (reset, info pane, fullscreen,
  // legend controls) plus the hover tooltip, copy feedback, drag overlay and structure
  // popup driven by the shared canvas-interactions scaffold
  import { ClickFeedback, DragOverlay } from '$lib/feedback'
  import Icon from '$lib/Icon.svelte'
  import { FullscreenButton, type FullscreenToggleProp } from '$lib/layout'
  import { PlotTooltip } from '$lib/plot'
  import type { ComponentProps, Snippet } from 'svelte'
  import type { create_canvas_interactions } from './canvas-interactions.svelte'
  import ConvexHullControls from './ConvexHullControls.svelte'
  import ConvexHullInfoPane from './ConvexHullInfoPane.svelte'
  import ConvexHullTooltip from './ConvexHullTooltip.svelte'
  import type { create_hull_data_pipeline } from './hull-state.svelte'
  import type { ConvexHullTooltipProp } from './index'
  import { CONVEX_HULL_STYLE } from './index'
  import StructurePopup from './StructurePopup.svelte'
  import type { ConvexHullEntry, HighlightStyle, HullFaceColorMode } from './types'
  import { MAGNETIC_ORDERING_CATEGORY } from './types'

  type ControlsProps = ComponentProps<typeof ConvexHullControls>

  let {
    interactions, // canvas-interactions scaffold: hover/drag/popup/copy-feedback state
    hull_data, // hull-state pipeline: energy-mode flags, polymorph stats, thresholds
    controls_config,
    reset_all,
    reset_title,
    enable_info_pane = true,
    phase_stats,
    label_threshold,
    fullscreen = false,
    fullscreen_toggle = true,
    wrapper = undefined,
    camera,
    merged_controls,
    stable_entries,
    unstable_entries,
    get_point_color,
    merged_highlight_style,
    is_highlighted,
    tooltip = undefined,
    selected_entry,
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
  }: Pick<
    ControlsProps,
    | `camera`
    | `merged_controls`
    | `stable_entries`
    | `unstable_entries`
    | `color_mode`
    | `color_scale`
    | `show_stable`
    | `show_unstable`
    | `entry_category`
    | `hidden_categories`
    | `show_stable_labels`
    | `show_unstable_labels`
    | `max_hull_dist_show_phases`
    | `max_hull_dist_show_labels`
    | `energy_source_mode`
    | `controls_open`
    | `show_hull_faces`
    | `hull_face_color`
    | `hull_face_opacity`
    | `hull_face_color_mode`
  > &
    Pick<ComponentProps<typeof ConvexHullInfoPane>, `phase_stats` | `label_threshold`> & {
      interactions: ReturnType<typeof create_canvas_interactions>
      hull_data: ReturnType<typeof create_hull_data_pipeline<ConvexHullEntry>>
      controls_config: ShowControlsState
      reset_all: () => void
      reset_title: string
      enable_info_pane?: boolean
      fullscreen?: boolean
      fullscreen_toggle?: FullscreenToggleProp
      wrapper?: HTMLDivElement
      get_point_color: (entry: ConvexHullEntry) => string
      merged_highlight_style: HighlightStyle
      is_highlighted: (entry: ConvexHullEntry) => boolean
      tooltip?: ConvexHullTooltipProp<ConvexHullEntry>
      selected_entry: ConvexHullEntry | null
      info_pane_open?: boolean
    } = $props()
</script>

<!-- Control buttons (top-right corner) -->
{#if controls_config.mode !== `never`}
  <section class="control-buttons {controls_config.class}">
    {#if controls_config.visible(`reset`)}
      <button type="button" onclick={reset_all} title={reset_title} class="reset-camera-btn">
        <Icon icon="Reset" />
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

    {#if fullscreen_toggle && controls_config.visible(`fullscreen`)}
      <FullscreenButton {fullscreen} toggle={fullscreen_toggle} {wrapper} />
    {/if}

    <!-- Legend controls pane -->
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
        {show_hull_faces}
        on_hull_faces_change={(value: boolean) => (show_hull_faces = value)}
        {hull_face_color}
        on_hull_face_color_change={(value: string) => (hull_face_color = value)}
        {hull_face_opacity}
        on_hull_face_opacity_change={(value: number) => (hull_face_opacity = value)}
        {hull_face_color_mode}
        on_hull_face_color_mode_change={(value: HullFaceColorMode) =>
          (hull_face_color_mode = value)}
        bind:energy_source_mode
        has_precomputed_e_form={hull_data.has_precomputed_e_form}
        can_compute_e_form={hull_data.can_compute_e_form}
        has_precomputed_hull={hull_data.has_precomputed_hull}
        can_compute_hull={hull_data.can_compute_hull}
      />
    {/if}
  </section>
{/if}

<!-- Hover tooltip -->
{#if interactions.hover_data}
  {@const { entry, position } = interactions.hover_data}
  {@const entry_highlight = is_highlighted(entry) ? merged_highlight_style : undefined}
  {@const tooltip_style = `z-index: ${CONVEX_HULL_STYLE.z_index.tooltip}; backdrop-filter: blur(4px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);`}
  <PlotTooltip
    x={position.x}
    y={position.y}
    offset={{ x: 10, y: -10 }}
    bg_color={get_point_color(entry)}
    fixed
    style={tooltip_style}
  >
    <ConvexHullTooltip
      {entry}
      polymorph_stats_map={hull_data.polymorph_stats_map}
      highlight_style={entry_highlight}
      {entry_category}
      {tooltip}
    />
  </PlotTooltip>
{/if}

<!-- Copy-to-clipboard feedback (double-click on point) -->
<ClickFeedback
  bind:visible={interactions.copy_feedback.visible}
  position={interactions.copy_feedback.position}
/>

<!-- z-index 1: above auto-stacked siblings after the chrome (3D gizmo, gas controls), below z-2 sliders -->
<DragOverlay
  visible={interactions.drag_over}
  message="Drop JSON file to load phase diagram data"
  style="z-index: 1"
/>

{#if interactions.modal_open && interactions.selected_structure}
  <StructurePopup
    structure={interactions.selected_structure}
    place_right={interactions.modal_place_right}
    stats={{
      id: selected_entry?.entry_id,
      e_above_hull: selected_entry?.e_above_hull,
      e_form: selected_entry?.e_form_per_atom,
    }}
    onclose={interactions.close_structure_popup}
  />
{/if}

<style>
  .control-buttons {
    position: absolute;
    top: 1ex;
    right: 1ex;
    display: flex;
    gap: 8px;
    transition: opacity 0.2s ease-in-out;
  }
  .control-buttons.hover-visible {
    opacity: 0;
    pointer-events: none;
  }
  :global(.convex-hull-3d:hover) > .control-buttons.hover-visible,
  :global(.convex-hull-3d:focus-within) > .control-buttons.hover-visible,
  :global(.convex-hull-4d:hover) > .control-buttons.hover-visible,
  :global(.convex-hull-4d:focus-within) > .control-buttons.hover-visible {
    opacity: 1;
    pointer-events: auto;
  }
  .control-buttons.always-visible {
    opacity: 1;
    pointer-events: auto;
  }
  .control-buttons :global(.draggable-pane) {
    z-index: 1001 !important;
  }
  .control-buttons :global(button) {
    background: transparent;
    border: none;
    padding: 4px;
    cursor: pointer;
    border-radius: 3px;
    color: var(--text-color, currentColor);
    transition: background-color 0.2s;
    display: flex;
    font-size: var(--ctrl-btn-icon-size, clamp(0.7rem, 2cqmin, 0.85rem));
  }
  .control-buttons :global(button):hover {
    background-color: color-mix(in srgb, currentColor 8%, transparent);
  }
</style>
