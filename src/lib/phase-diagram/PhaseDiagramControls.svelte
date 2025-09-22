<script lang="ts">
  import { DraggablePane } from '$lib'
  import type { D3InterpolateName } from '$lib/colors'
  import { ColorBar, ColorScaleSelect } from '$lib/plot'
  import type { ComponentProps } from 'svelte'
  import { tooltip } from 'svelte-multiselect'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { PDLegendConfig, PlotEntry3D } from './types'

  interface CameraState {
    rotation_x: number
    rotation_y: number
    zoom: number
    center_x: number
    center_y: number
  }

  interface Props extends Omit<HTMLAttributes<HTMLDivElement>, `onclose`> {
    // Display controls
    color_mode?: `stability` | `energy`
    color_scale?: D3InterpolateName
    show_stable?: boolean
    show_unstable?: boolean
    show_stable_labels?: boolean
    show_unstable_labels?: boolean
    show_elemental_polymorphs?: boolean
    // Thresholds
    energy_threshold?: number
    label_energy_threshold?: number
    max_energy_threshold?: number
    // Data for visualization
    plot_entries: PlotEntry3D[]
    stable_entries: PlotEntry3D[]
    unstable_entries: PlotEntry3D[]
    total_unstable_count: number
    // Camera state
    camera: CameraState
    // Legend configuration
    merged_legend: PDLegendConfig
    // Pane state
    controls_open?: boolean
    toggle_props?: ComponentProps<typeof DraggablePane>[`toggle_props`]
    pane_props?: ComponentProps<typeof DraggablePane>[`pane_props`]
  }
  let {
    color_mode = $bindable(`stability`),
    color_scale = $bindable(`interpolateViridis`),
    show_stable = $bindable(true),
    show_unstable = $bindable(true),
    show_stable_labels = $bindable(true),
    show_unstable_labels = $bindable(false),
    show_elemental_polymorphs = $bindable(false),
    energy_threshold = $bindable(0),
    label_energy_threshold = $bindable(0.1),
    max_energy_threshold = 0.5,
    plot_entries,
    stable_entries,
    unstable_entries,
    total_unstable_count,
    camera,
    merged_legend,
    controls_open = $bindable(false),
    toggle_props = $bindable({}),
    pane_props = $bindable({}),
    ...rest
  }: Props = $props()
</script>

<DraggablePane
  bind:show={controls_open}
  pane_props={{
    ...pane_props,
    class: `phase-diagram-controls-pane ${pane_props?.class ?? ``}`,
  }}
  toggle_props={{
    title: `${controls_open ? `Close` : `Open`} phase diagram controls`,
    class: `phase-diagram-controls-toggle`,
    ...toggle_props,
  }}
  closed_icon="Settings"
  open_icon="Cross"
  {...rest}
>
  <h4 style="margin: 0">{merged_legend.title || `Phase Diagram Controls`}</h4>

  <!-- Color mode toggle -->
  <div class="control-row">
    <span class="control-label">Color mode</span>
    <div class="color-mode-toggle">
      <button
        class="toggle-btn {color_mode === `stability` ? `active` : ``}"
        onclick={() => color_mode = `stability`}
      >
        Stability
      </button>
      <button
        class="toggle-btn {color_mode === `energy` ? `active` : ``}"
        onclick={() => color_mode = `energy`}
      >
        Energy
      </button>
    </div>
  </div>

  <!-- Energy threshold slider - shown in both modes -->
  <div class="control-row">
    <span class="control-label">Points threshold</span>
    <label style="display: flex; align-items: center; gap: 4px; flex: 1">
      <input
        type="number"
        min="0"
        max={max_energy_threshold}
        step="0.01"
        bind:value={energy_threshold}
        class="threshold-input"
        title="Maximum energy above hull for displayed entries"
      />
      <span style="white-space: nowrap; font-size: 0.85em">eV/atom</span>
      <input
        type="range"
        min="0"
        max={max_energy_threshold}
        step="0.01"
        bind:value={energy_threshold}
        class="threshold-slider"
        title="Maximum energy above hull for displayed entries"
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
        >
          <div class="marker stable"></div>
          <span>Stable{
              merged_legend.show_counts ? ` (${stable_entries.length})` : ``
            }</span>
        </div>
        <div
          class="legend-item clickable {show_unstable ? `active` : `inactive`}"
          onclick={() => show_unstable = !show_unstable}
          onkeydown={(evt) =>
          [`Enter`, ` `].includes(evt.key) && (show_unstable = !show_unstable)}
          role="button"
          tabindex="0"
        >
          <div class="marker unstable"></div>
          <span>Above hull{
              merged_legend.show_counts
              ? ` (${
                unstable_entries.filter((e) => e.visible).length
              }/${total_unstable_count})`
              : ``
            }</span>
        </div>
      </div>
    </div>
  {:else}
    {@const hull_distances = plot_entries.map((entry) => entry.e_above_hull ?? 0)}
    {@const cbar_min = hull_distances.length ? Math.min(...hull_distances) : 0}
    {@const cbar_max = hull_distances.length ? Math.max(...hull_distances) : 0.1}
    <div class="colorbar-container">
      <ColorBar
        title="Energy Above Hull (eV/atom)"
        range={[cbar_min, Math.max(cbar_max, cbar_min + 0.1)]}
        {color_scale}
        orientation="horizontal"
        tick_labels={5}
        wrapper_style="margin: 8px 0;"
      />
    </div>

    <!-- Color scale selector -->
    <div class="control-row" style="margin: 1em 0 0">
      Color scale
      <ColorScaleSelect
        bind:value={color_scale}
        placeholder="Select color scale"
      />
    </div>
  {/if}

  {#if merged_legend.show_label_controls}
    <div class="control-row">
      <span class="control-label">Labels</span>
      <div class="label-toggles">
        <label class="label-toggle">
          <input
            type="checkbox"
            bind:checked={show_stable_labels}
          />
          <span>Stable</span>
        </label>
        <label class="label-toggle">
          <input
            type="checkbox"
            bind:checked={show_unstable_labels}
          />
          <span>Unstable</span>
        </label>
      </div>
    </div>

    {#if show_unstable_labels}
      <div class="control-row">
        <span class="control-label">Label threshold</span>
        <label style="display: flex; align-items: center; gap: 4px; flex: 1">
          <span style="white-space: nowrap; font-size: 0.85em">{
              label_energy_threshold.toFixed(2)
            } eV/atom</span>
          <input
            type="range"
            min="0"
            max={max_energy_threshold}
            step="0.01"
            bind:value={label_energy_threshold}
            class="threshold-slider"
          />
        </label>
      </div>
    {/if}
  {/if}

  <!-- Elemental polymorphs toggle -->
  <div class="control-row">
    <span class="control-label">Elements</span>
    <label class="label-toggle">
      <input
        type="checkbox"
        bind:checked={show_elemental_polymorphs}
        title="Show all elemental polymorphs (not just corner references)"
      />
      <span>Show polymorphs</span>
    </label>
  </div>

  <!-- Camera controls -->
  <div class="control-row">
    <span class="control-label">Camera</span>
    <div class="camera-controls">
      <label
        class="angle-input"
        {@attach tooltip({ content: `Vertical tilt (up/down rotation)` })}
      >
        <span>φ</span>
        <input
          type="number"
          value={camera.rotation_x.toFixed(2)}
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
          value={camera.rotation_y.toFixed(2)}
          step="0.1"
          oninput={(e) =>
          camera.rotation_y = parseFloat(
            (e.target as HTMLInputElement).value,
          )}
          style="width: 3em"
        />
      </label>
    </div>
  </div>
</DraggablePane>

<style>
  .control-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
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
  .toggle-btn {
    flex: 1;
    padding: 6px 12px;
    background: var(--btn-bg, rgba(0, 0, 0, 0.1));
    color: var(--text-color-muted, #666);
    border: 1px solid var(--border-color, rgba(0, 0, 0, 0.2));
    border-radius: 4px;
    cursor: pointer;
    text-align: center;
    transition: all 0.2s;
  }
  .toggle-btn.active {
    background: var(--accent-color, #1976d2);
    color: white;
    border-color: var(--accent-color, #1976d2);
  }
  .toggle-btn:hover:not(.active) {
    background: var(--btn-bg-hover, rgba(0, 0, 0, 0.15));
  }
  .legend-items-container {
    display: flex;
    flex-direction: row;
    gap: 12px;
    flex: 1;
  }
  .legend-item {
    display: flex;
    align-items: center;
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s;
    flex: 1;
  }
  .legend-item:hover {
    background: var(--btn-bg-hover, rgba(0, 0, 0, 0.05));
  }
  .legend-item.inactive {
    opacity: 0.5;
  }
  .marker {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    margin-right: 8px;
  }
  .marker.stable {
    background: #0072b2;
  }
  .marker.unstable {
    background: #e69f00;
  }
  .label-toggles {
    display: flex;
    gap: 12px;
    flex: 1;
  }
  .label-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .camera-controls {
    display: flex;
    gap: 12px;
    flex: 1;
  }
  .threshold-slider {
    flex: 1;
    accent-color: var(--accent-color, #1976d2);
  }
  .threshold-input {
    width: 4em;
    text-align: center;
    border: 1px solid var(--border-color, rgba(0, 0, 0, 0.2));
    border-radius: 3px;
    padding: 4px;
    font-size: 0.85em;
  }
</style>
