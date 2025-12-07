<script lang="ts">
  import { DraggablePane, format_num } from '$lib'
  import type { D3InterpolateName } from '$lib/colors'
  import { ColorScaleSelect } from '$lib/plot'
  import type { ComponentProps } from 'svelte'
  import { tooltip } from 'svelte-multiselect'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { ConvexHullControlsType, ConvexHullEntry } from './types'

  interface CameraState {
    elevation?: number // Elevation angle in degrees (for ternary)
    azimuth?: number // Azimuth angle in degrees (for ternary)
    rotation_x?: number // X rotation in radians (for quaternary)
    rotation_y?: number // Y rotation in radians (for quaternary)
    zoom: number
    center_x: number
    center_y: number
  }
  let {
    color_mode = $bindable(`stability`),
    color_scale = $bindable(`interpolateViridis`),
    show_stable = $bindable(true),
    show_unstable = $bindable(true),
    show_stable_labels = $bindable(true),
    show_unstable_labels = $bindable(false),
    show_hull_faces = undefined,
    on_hull_faces_change,
    hull_face_color = `#0072B2`,
    on_hull_face_color_change,
    hull_face_opacity = $bindable(0.03),
    on_hull_face_opacity_change,
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
    show_stable_labels?: boolean
    show_unstable_labels?: boolean
    // 3D specific controls
    show_hull_faces?: boolean
    on_hull_faces_change?: (value: boolean) => void
    hull_face_color?: string
    on_hull_face_color_change?: (value: string) => void
    hull_face_opacity?: number
    on_hull_face_opacity_change?: (value: number) => void
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
    toggle_props?: ComponentProps<typeof DraggablePane>[`toggle_props`]
    pane_props?: ComponentProps<typeof DraggablePane>[`pane_props`]
  } = $props()
</script>

<DraggablePane
  bind:show={controls_open}
  pane_props={{
    ...pane_props,
    class: `convex-hull-controls-pane ${pane_props?.class ?? ``}`,
    style:
      `--pane-min-height: 280px; --pane-max-height: max(350px, calc(100cqh - 40px)); ${
        pane_props?.style ?? ``
      }`,
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
  <h4 style="margin: 0">{merged_controls.title || `Phase Diagram Controls`}</h4>

  <!-- Energy source selection (only if both options are available) -->
  {#if has_precomputed_e_form && has_precomputed_hull && can_compute_e_form &&
      can_compute_hull}
    <div class="control-row">
      <span class="control-label">Energy source</span>
      <button
        class="toggle-btn {energy_source_mode === `precomputed` ? `active` : ``}"
        onclick={() => energy_source_mode = `precomputed`}
        {@attach tooltip({
          content: `Use precomputed formation energies (E<sub>form</sub>)`,
        })}
      >
        Precomputed
      </button>
      <button
        class="toggle-btn {energy_source_mode === `on-the-fly` ? `active` : ``}"
        onclick={() => energy_source_mode = `on-the-fly`}
        {@attach tooltip({
          content:
            `Compute formation energies and hull distances on the fly. Note: Missing pure-element reference entries default to E<sub>form</sub> = 0 eV/atom if not provided explicitly.`,
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
      onclick={() => color_mode = `stability`}
      {@attach tooltip({ content: `Color points by stable/unstable` })}
    >
      Stability
    </button>
    <button
      class="toggle-btn {color_mode === `energy` ? `active` : ``}"
      onclick={() => color_mode = `energy`}
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
      <span style="white-space: nowrap; font-size: 0.85em">eV/atom</span>
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
          onclick={() => show_stable = !show_stable}
          onkeydown={(evt) =>
          [`Enter`, ` `].includes(evt.key) && (show_stable = !show_stable)}
          role="button"
          tabindex="0"
          {@attach tooltip({ content: `Toggle visibility of stable points` })}
        >
          <div class="marker stable"></div>
          <span>Stable{
              merged_controls.show_counts ? ` (${stable_entries.length})` : ``
            }</span>
        </div>
        <div
          class="legend-item clickable {show_unstable ? `active` : `inactive`}"
          onclick={() => show_unstable = !show_unstable}
          onkeydown={(evt) =>
          [`Enter`, ` `].includes(evt.key) && (show_unstable = !show_unstable)}
          role="button"
          tabindex="0"
          {@attach tooltip({ content: `Toggle visibility of above-hull points` })}
        >
          <div class="marker unstable"></div>
          <span>Above hull{
              merged_controls.show_counts
              ? ` (${
                unstable_entries.filter((e) => e.visible).length
              }/${unstable_entries.length})`
              : ``
            }</span>
        </div>
      </div>
    </div>
  {:else}
    <!-- Color scale selector -->
    <div style="display: grid; gap: 8px; grid-template-columns: auto 1fr">
      <span {@attach tooltip({ content: `Choose energy colormap` })}>Color scale</span>
      <ColorScaleSelect
        bind:value={color_scale}
        selected={[color_scale]}
        placeholder="Select color scale"
        {@attach tooltip({ content: `Set interpolator for energy colors` })}
      />
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
            oninput={(
              evt,
            ) => (show_stable_labels = (evt.target as HTMLInputElement).checked)}
          />
          <span>Stable</span>
        </label>
        <label {@attach tooltip({ content: `Show labels for unstable points` })}>
          <input
            type="checkbox"
            checked={show_unstable_labels}
            oninput={(
              evt,
            ) => (show_unstable_labels =
              (evt.target as HTMLInputElement).checked)}
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
          <span style="white-space: nowrap; font-size: 0.85em">{
              max_hull_dist_show_labels.toFixed(2)
            } eV/atom</span>
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
          oninput={(e) => on_hull_faces_change?.((e.target as HTMLInputElement).checked)}
        />
        <span>Show</span>
      </label>
      <div style="display: flex; gap: 6px; align-items: center; flex: 1">
        <input
          type="color"
          value={hull_face_color}
          oninput={(e) => on_hull_face_color_change?.((e.target as HTMLInputElement).value)}
          {@attach tooltip({ content: `Set hull face color` })}
          style="width: 40px; height: 28px"
        />
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
        <span style="font-size: 0.75em; min-width: 2em; text-align: right">{
          format_num(hull_face_opacity, `.1%`)
        }</span>
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
            content:
              `Elevation angle (0° = look down z-axis, 90° = side view, 180° = look up z-axis)`,
          })}
        >
          <span>Elev</span>
          <input
            type="number"
            value={camera.elevation.toFixed(0)}
            step="5"
            oninput={(e) =>
            camera.elevation = parseFloat(
              (e.target as HTMLInputElement).value,
            )}
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
            oninput={(e) =>
            camera.azimuth = parseFloat(
              (e.target as HTMLInputElement).value,
            )}
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
            oninput={(e) =>
            camera.rotation_x = parseFloat(
              (e.target as HTMLInputElement).value,
            )}
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
            oninput={(e) =>
            camera.rotation_y = parseFloat(
              (e.target as HTMLInputElement).value,
            )}
            style="width: 3em"
          />
        </label>
      {/if}
    </div>
  {/if}
</DraggablePane>

<style>
  .control-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }
  /* Remove bottom margin from last element to prevent blank scrollable space */
  :global(.convex-hull-controls-pane > :last-child) {
    margin-bottom: 0;
  }
  .control-label {
    font-weight: 500;
    min-width: 80px;
  }
  .color-mode-toggle {
    display: flex;
    gap: 4px;
    flex: 1;
  }
  button {
    flex: 1;
    border: 1px solid var(--border-color, rgba(0, 0, 0, 0.2));
  }
  .toggle-btn.active, .toggle-btn:hover.active {
    background: var(--accent-color, #1976d2);
    color: white;
    border-color: var(--accent-color, #1976d2);
  }
  .legend-items-container {
    display: flex;
    gap: 12px;
    flex: 1;
  }
  .legend-item {
    display: flex;
    align-items: center;
    border-radius: var(--pd-border-radius, var(--border-radius, 3pt));
    cursor: pointer;
    white-space: nowrap;
  }
  .legend-item:hover {
    background: var(--btn-bg-hover, rgba(0, 0, 0, 0.05));
  }
  .legend-item.inactive {
    opacity: 0.5;
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
  }
  .threshold-input {
    border: 1px solid var(--border-color, rgba(0, 0, 0, 0.2));
  }
</style>
