<script lang="ts">
  import type { PaneProps, PaneToggleProps } from '$lib/overlays'
  import type { D3InterpolateName } from '$lib/colors'
  import { format_num } from '$lib/labels'
  import DraggablePane from '$lib/overlays/DraggablePane.svelte'
  import { sanitize_html } from '$lib/sanitize'
  import { ColorScaleSelect } from '$lib/plot'
  import type { ComponentProps } from 'svelte'
  import { tooltip } from 'svelte-multiselect/attachments'
  import type { HTMLAttributes } from 'svelte/elements'
  import { get_entry_category, marker_path_data } from './helpers'
  import type {
    ConvexHullControlsType,
    ConvexHullEntry,
    EntryCategoryConfig,
    HullFaceColorMode,
  } from './types'
  import { HULL_FACE_COLOR_MODES, MAGNETIC_ORDERING_CATEGORY } from './types'

  interface CameraState {
    elevation?: number // Elevation angle in degrees (for ternary)
    azimuth?: number // Azimuth angle in degrees (for ternary)
    rotation_x?: number // X rotation in radians (for quaternary)
    rotation_y?: number // Y rotation in radians (for quaternary)
    zoom: number
    center_x: number
    center_y: number
  }

  // Face color mode display labels and tooltips
  const FACE_COLOR_MODES: Record<HullFaceColorMode, { label: string; tip: string }> = {
    uniform: { label: `Uniform`, tip: `Single uniform color for all faces` },
    formation_energy: {
      label: `Energy`,
      tip: `Color by average formation energy of face vertices`,
    },
    dominant_element: {
      label: `Element`,
      tip: `Color by element with highest concentration at face centroid`,
    },
    facet_index: { label: `Index`, tip: `Distinct categorical color per facet` },
  }

  let {
    color_mode = $bindable(`stability`),
    color_scale = $bindable(`interpolateViridis`),
    show_stable = $bindable(true),
    show_unstable = $bindable(true),
    entry_category = MAGNETIC_ORDERING_CATEGORY,
    hidden_categories = $bindable([]),
    show_stable_labels = $bindable(true),
    show_unstable_labels = $bindable(false),
    show_hull_faces = undefined,
    on_hull_faces_change,
    hull_face_color = `#0072B2`,
    on_hull_face_color_change,
    hull_face_opacity = $bindable(0.03),
    on_hull_face_opacity_change,
    hull_face_color_mode = `uniform` as HullFaceColorMode,
    on_hull_face_color_mode_change,
    max_hull_dist_show_phases = $bindable(0),
    max_hull_dist_show_labels = $bindable(0.1),
    max_hull_dist_in_data = 0.5,
    energy_source_mode = $bindable(`precomputed`),
    has_precomputed_hull = false,
    can_compute_hull = false,
    has_precomputed_e_form = false,
    can_compute_e_form = false,
    stable_entries,
    unstable_entries,
    camera,
    merged_controls,
    controls_open = $bindable(false),
    toggle_props = {},
    pane_props = {},
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, `onclose`> & {
    // Display controls
    color_mode?: `stability` | `energy`
    color_scale?: D3InterpolateName
    show_stable?: boolean
    show_unstable?: boolean
    // Categorical classification rendered as filter toggles (null disables the row)
    entry_category?: EntryCategoryConfig | null
    hidden_categories?: string[]
    show_stable_labels?: boolean
    show_unstable_labels?: boolean
    // 3D specific controls
    show_hull_faces?: boolean
    on_hull_faces_change?: (value: boolean) => void
    hull_face_color?: string
    on_hull_face_color_change?: (value: string) => void
    hull_face_opacity?: number
    on_hull_face_opacity_change?: (value: number) => void
    hull_face_color_mode?: HullFaceColorMode
    on_hull_face_color_mode_change?: (value: HullFaceColorMode) => void
    energy_source_mode?: `precomputed` | `on-the-fly` // whether to read formation and above hull distance from entries or compute them on the fly
    has_precomputed_hull?: boolean
    can_compute_hull?: boolean
    has_precomputed_e_form?: boolean
    can_compute_e_form?: boolean
    // Thresholds
    max_hull_dist_show_phases?: number
    max_hull_dist_show_labels?: number
    max_hull_dist_in_data?: number
    // Data for visualization
    stable_entries: ConvexHullEntry[]
    unstable_entries: ConvexHullEntry[]
    // Camera state (optional - only used for 3D/4D diagrams)
    camera?: CameraState
    // Legend configuration
    merged_controls: ConvexHullControlsType
    // Pane state
    controls_open?: boolean
    toggle_props?: PaneToggleProps
    pane_props?: PaneProps
  } = $props()

  // Focus the multiselect input next to the "Color scale" label
  function focus_multiselect(evt: Event & { currentTarget: HTMLElement }): void {
    evt.currentTarget.nextElementSibling?.querySelector<HTMLInputElement>(`input`)?.focus()
  }

  // Category filters: only show category values present in the (threshold-filtered) data
  const category_counts = $derived.by(() => {
    const counts: Record<string, number> = {}
    for (const entry of [...stable_entries, ...unstable_entries]) {
      const value = get_entry_category(entry, entry_category)
      if (value) counts[value] = (counts[value] ?? 0) + 1
    }
    return counts
  })
  const category_values_in_data = $derived(
    Object.keys(entry_category?.markers ?? {}).filter(
      (value) => (category_counts[value] ?? 0) > 0,
    ),
  )
  const toggle_category = (value: string) => {
    hidden_categories = hidden_categories.includes(value)
      ? hidden_categories.filter((hidden) => hidden !== value)
      : [...hidden_categories, value]
  }
  const SWATCH_RADIUS = 4.4 // marker swatch radius, sized to fit the 12x12 viewBox
  // Keyboard activation for legend toggles (preventDefault stops Space scrolling the page)
  const legend_keydown = (action: () => void) => (evt: KeyboardEvent) => {
    if (![`Enter`, ` `].includes(evt.key)) return
    evt.preventDefault()
    action()
  }
</script>

<DraggablePane
  bind:show={controls_open}
  pane_props={{
    ...pane_props,
    class: `convex-hull-controls-pane ${pane_props?.class ?? ``}`,
    style: `${pane_props?.style ?? ``}`,
  }}
  toggle_props={{
    title: controls_open ? `` : `Convex hull controls`,
    class: `convex-hull-controls-toggle`,
    ...toggle_props,
  }}
  closed_icon="Settings"
  open_icon="Cross"
  {...rest}
>
  <h4>
    {@html sanitize_html(merged_controls.title || `Convex Hull Controls`)}
  </h4>

  <!-- Energy source selection (only if both options are available) -->
  {#if has_precomputed_e_form && has_precomputed_hull && can_compute_e_form && can_compute_hull}
    <div class="control-row">
      <span class="control-label">Energy source</span>
      <button
        class="toggle-btn {energy_source_mode === `precomputed` ? `active` : ``}"
        onclick={() => (energy_source_mode = `precomputed`)}
        {@attach tooltip({
          allow_html: true,
          content: `Use precomputed formation energies (E<sub>form</sub>)`,
        })}
      >
        Precomputed
      </button>
      <button
        class="toggle-btn {energy_source_mode === `on-the-fly` ? `active` : ``}"
        onclick={() => (energy_source_mode = `on-the-fly`)}
        {@attach tooltip({
          allow_html: true,
          content: `Compute formation energies and hull distances on the fly. Note: Missing pure-element reference entries default to E<sub>form</sub> = 0 eV/atom if not provided explicitly.`,
        })}
      >
        On the fly
      </button>
    </div>
  {/if}

  <!-- Color mode toggle -->
  <div class="control-row">
    <span class="control-label">Color mode</span>
    <button
      class="toggle-btn {color_mode === `stability` ? `active` : ``}"
      onclick={() => (color_mode = `stability`)}
      {@attach tooltip({ content: `Color points by stable/unstable` })}
    >
      Stability
    </button>
    <button
      class="toggle-btn {color_mode === `energy` ? `active` : ``}"
      onclick={() => (color_mode = `energy`)}
      {@attach tooltip({ content: `Color points by energy above hull` })}
    >
      Energy
    </button>
  </div>

  <!-- Energy threshold slider - shown in both color modes -->
  <div
    class="control-row"
    {@attach tooltip({ content: `Max eV/atom above hull to display unstable points` })}
  >
    <span class="control-label">Points threshold</span>
    <label style="display: flex; align-items: center; gap: 4px; flex: 1">
      <input
        type="number"
        min="0"
        max={max_hull_dist_in_data}
        step="0.01"
        bind:value={max_hull_dist_show_phases}
        class="threshold-input"
      />
      <span style="white-space: nowrap">eV/atom</span>
      <input
        type="range"
        min="0"
        max={max_hull_dist_in_data}
        step="0.01"
        bind:value={max_hull_dist_show_phases}
        class="threshold-slider"
      />
    </label>
  </div>

  {#if color_mode === `stability`}
    <div class="control-row">
      <span class="control-label">Points</span>
      <div class="legend-items-container">
        <div
          class="legend-item clickable {show_stable ? `active` : `inactive`}"
          onclick={() => (show_stable = !show_stable)}
          onkeydown={legend_keydown(() => (show_stable = !show_stable))}
          role="button"
          tabindex="0"
          aria-pressed={show_stable}
          {@attach tooltip({ content: `Toggle visibility of stable points` })}
        >
          <div class="marker stable"></div>
          <span>Stable{merged_controls.show_counts ? ` (${stable_entries.length})` : ``}</span>
        </div>
        <div
          class="legend-item clickable {show_unstable ? `active` : `inactive`}"
          onclick={() => (show_unstable = !show_unstable)}
          onkeydown={legend_keydown(() => (show_unstable = !show_unstable))}
          role="button"
          tabindex="0"
          aria-pressed={show_unstable}
          {@attach tooltip({ content: `Toggle visibility of above-hull points` })}
        >
          <div class="marker unstable"></div>
          <span
            >Above hull{merged_controls.show_counts
              ? ` (${show_unstable ? unstable_entries.length : 0}/${unstable_entries.length})`
              : ``}</span
          >
        </div>
      </div>
    </div>
  {:else}
    <!-- Color scale selector -->
    <div class="color-scale-row">
      <span
        {@attach tooltip({ content: `Choose energy colormap` })}
        onclick={focus_multiselect}
        onkeydown={(evt) => {
          if (evt.key === `Enter` || evt.key === ` `) focus_multiselect(evt)
        }}
        role="button"
        tabindex="0"
        style="cursor: pointer">Color scale</span
      >
      <ColorScaleSelect
        bind:value={color_scale}
        selected={[color_scale]}
        placeholder="Select color scale"
        {@attach tooltip({ content: `Set interpolator for energy colors` })}
      />
    </div>
  {/if}

  <!-- Category filters (only when entries carry recognized category data,
    e.g. magnetic orderings with the default MAGNETIC_ORDERING_CATEGORY) -->
  {#if entry_category && category_values_in_data.length > 0}
    <div class="control-row">
      <span class="control-label">{entry_category.label}</span>
      <div class="legend-items-container category-filters">
        {#each category_values_in_data as value (value)}
          {@const hidden = hidden_categories.includes(value)}
          {@const count = category_counts[value] ?? 0}
          {@const long_name = entry_category.labels?.[value]}
          <div
            class="legend-item clickable {hidden ? `inactive` : `active`}"
            onclick={() => toggle_category(value)}
            onkeydown={legend_keydown(() => toggle_category(value))}
            role="button"
            tabindex="0"
            aria-pressed={!hidden}
            {@attach tooltip({
              content: `Toggle visibility of ${
                long_name ? `${long_name.toLowerCase()} (${value})` : value
              } entries`,
            })}
          >
            <svg viewBox="-6 -6 12 12" width="12" height="12" aria-hidden="true">
              <path d={marker_path_data(SWATCH_RADIUS, entry_category.markers[value]) ?? ``} />
            </svg>
            <span
              >{value}{merged_controls.show_counts
                ? ` (${hidden ? `0/${count}` : count})`
                : ``}</span
            >
          </div>
        {/each}
      </div>
    </div>
  {/if}

  {#if merged_controls.show_label_controls}
    <div class="control-row">
      <span class="control-label">Labels</span>
      <div style="display: flex; gap: 12px; flex: 1">
        <label {@attach tooltip({ content: `Show labels for stable points` })}>
          <input
            type="checkbox"
            checked={show_stable_labels}
            oninput={(evt) => (show_stable_labels = evt.currentTarget.checked)}
          />
          <span>Stable</span>
        </label>
        <label {@attach tooltip({ content: `Show labels for unstable points` })}>
          <input
            type="checkbox"
            checked={show_unstable_labels}
            oninput={(evt) => (show_unstable_labels = evt.currentTarget.checked)}
          />
          <span>Unstable</span>
        </label>
      </div>
    </div>

    {#if show_unstable_labels}
      <div
        class="control-row"
        {@attach tooltip({ content: `Max eV/atom for labeling unstable points` })}
      >
        <span class="control-label">Label threshold</span>
        <label style="display: flex; align-items: center; gap: 4px; flex: 1">
          <span style="white-space: nowrap"
            >{max_hull_dist_show_labels.toFixed(2)}
            eV/atom</span
          >
          <input
            type="range"
            min="0"
            max={max_hull_dist_in_data}
            step="0.01"
            bind:value={max_hull_dist_show_labels}
            class="threshold-slider"
          />
        </label>
      </div>
    {/if}
  {/if}

  <!-- Hull faces toggle (for 3D ternary and 4D quaternary diagrams) -->
  {#if show_hull_faces !== undefined}
    <div class="control-row">
      <span class="control-label">Hull Faces</span>
      <label {@attach tooltip({ content: `Toggle convex hull faces` })}>
        <input
          type="checkbox"
          checked={show_hull_faces}
          oninput={(event) => on_hull_faces_change?.(event.currentTarget.checked)}
        />
        <span>Show</span>
      </label>
      <div style="display: flex; gap: 6px; align-items: center; flex: 1">
        {#if hull_face_color_mode === `uniform`}
          <input
            type="color"
            value={hull_face_color}
            oninput={(event) => on_hull_face_color_change?.(event.currentTarget.value)}
            {@attach tooltip({ content: `Set hull face color` })}
            style="width: 40px; height: 20px"
          />
        {/if}
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          aria-label="Hull face opacity"
          bind:value={hull_face_opacity}
          oninput={() => on_hull_face_opacity_change?.(hull_face_opacity)}
          {@attach tooltip({ content: `Hull face opacity (0 = transparent, 1 = opaque)` })}
          class="threshold-slider"
          style="flex: 1; min-width: 80px"
        />
        <span style="font-size: 0.9em; min-width: 2em; text-align: right"
          >{format_num(hull_face_opacity, `.1%`)}</span
        >
      </div>
    </div>

    <!-- Face color mode selector -->
    <div class="control-row">
      <span class="control-label">Face color</span>
      <div class="face-color-mode-buttons">
        {#each HULL_FACE_COLOR_MODES as mode (mode)}
          <button
            class="toggle-btn face-mode-btn {hull_face_color_mode === mode ? `active` : ``}"
            onclick={() => on_hull_face_color_mode_change?.(mode)}
            {@attach tooltip({ content: FACE_COLOR_MODES[mode].tip })}
          >
            {FACE_COLOR_MODES[mode].label}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  {#if camera}
    <div class="camera-controls">
      <span class="control-label">Camera</span>
      {#if camera.elevation !== undefined && camera.azimuth !== undefined}
        <!-- Ternary camera controls (elevation/azimuth) -->
        <label
          class="angle-input"
          {@attach tooltip({
            content: `Elevation angle (0° = look down z-axis, 90° = side view, 180° = look up z-axis)`,
          })}
        >
          <span>Elev</span>
          <input
            type="number"
            value={camera.elevation.toFixed(0)}
            step="5"
            oninput={(event) => {
              camera.elevation = parseFloat(event.currentTarget.value)
            }}
            style="width: 3em"
          />
          <span>°</span>
        </label>
        <label
          class="angle-input"
          {@attach tooltip({ content: `Azimuth rotation around z-axis` })}
        >
          <span>Azim</span>
          <input
            type="number"
            value={camera.azimuth.toFixed(0)}
            step="15"
            oninput={(event) => {
              camera.azimuth = parseFloat(event.currentTarget.value)
            }}
            style="width: 3em"
          />
          <span>°</span>
        </label>
      {:else}
        <!-- Quaternary camera controls (rotation_x/rotation_y) -->
        <label
          class="angle-input"
          {@attach tooltip({ content: `Vertical tilt (up/down rotation)` })}
        >
          <span>φ</span>
          <input
            type="number"
            value={(camera.rotation_x ?? 0).toFixed(2)}
            step="0.1"
            min={-Math.PI / 3}
            max={Math.PI / 3}
            oninput={(event) => {
              camera.rotation_x = parseFloat(event.currentTarget.value)
            }}
            style="width: 3em"
          />
        </label>
        <label
          class="angle-input"
          {@attach tooltip({ content: `Horizontal rotation (left/right)` })}
        >
          <span>θ</span>
          <input
            type="number"
            value={(camera.rotation_y ?? 0).toFixed(2)}
            step="0.1"
            oninput={(event) => {
              camera.rotation_y = parseFloat(event.currentTarget.value)
            }}
            style="width: 3em"
          />
        </label>
      {/if}
    </div>
  {/if}
</DraggablePane>

<style>
  :global(.convex-hull-controls-pane) {
    --pane-max-height: max(350px, calc(100cqh - 40px));
    --pane-padding: 1ex;
    --pane-gap: 0;
    font-size: 0.85em;
    pointer-events: auto;
  }
  .control-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
  }
  .control-label {
    font-weight: 500;
    min-width: 80px;
  }
  button {
    border: 1px solid var(--border-color, rgba(0, 0, 0, 0.2));
  }
  .toggle-btn.active,
  .toggle-btn:hover.active {
    background: light-dark(rgba(25, 118, 210, 0.15), rgba(100, 180, 255, 0.2));
  }
  .legend-items-container {
    display: flex;
    gap: 12px;
    flex: 1;
  }
  .legend-item {
    display: flex;
    align-items: center;
    border-radius: var(--hull-border-radius, var(--border-radius, 3pt));
    cursor: pointer;
    white-space: nowrap;
  }
  .legend-item:hover {
    background: var(--btn-bg-hover, rgba(0, 0, 0, 0.05));
  }
  .legend-item.inactive {
    opacity: 0.5;
  }
  .category-filters {
    flex-wrap: wrap;
    gap: 8px;
  }
  .legend-item svg {
    margin-right: 4px;
    flex-shrink: 0;
    fill: currentColor;
  }
  .marker {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    margin-right: 8px;
    aspect-ratio: 1;
  }
  .marker.stable {
    background: var(--stable-color, #0072b2);
  }
  .marker.unstable {
    background: var(--unstable-color, #e69f00);
  }
  .camera-controls {
    display: flex;
    gap: 12px;
    flex: 1;
    margin-top: 12px;
  }
  .threshold-input {
    border: 1px solid var(--border-color, rgba(0, 0, 0, 0.2));
  }
  .face-color-mode-buttons {
    display: flex;
    gap: 4px;
    flex: 1;
    flex-wrap: wrap;
  }
  .face-mode-btn {
    min-width: auto;
    flex: 0 1 auto;
  }
  .color-scale-row {
    display: grid;
    gap: 8px;
    grid-template-columns: auto 1fr;
    align-items: center;
    margin-top: 12px;
  }
  .color-scale-row :global(.multiselect) {
    --sms-min-height: 24px;
  }
</style>
