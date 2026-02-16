<script lang="ts">
  // NOTE: Axis config objects must be reassigned (not mutated) to trigger $bindable reactivity.
  // Pattern: `x_axis = { ...x_axis, prop: value }` instead of `x_axis.prop = value`
  import { SettingsSection } from '$lib/layout'
  import DraggablePane from '$lib/overlays/DraggablePane.svelte'
  import type {
    AxisConfig3D,
    CameraProjection3D,
    DataSeries3D,
    DisplayConfig3D,
    Surface3DConfig,
  } from '$lib/plot/types'
  import type { ComponentProps, Snippet } from 'svelte'

  // Unique ID prefix to avoid conflicts when multiple instances on same page
  const uid = crypto.randomUUID().slice(0, 8)

  let {
    x_axis = $bindable({}),
    y_axis = $bindable({}),
    z_axis = $bindable({}),
    display = $bindable({}),
    camera_projection = $bindable(`perspective`),
    auto_rotate = $bindable(0),
    series = [],
    surfaces = [],
    toggle_props,
    pane_props,
    children,
  }: {
    x_axis?: AxisConfig3D
    y_axis?: AxisConfig3D
    z_axis?: AxisConfig3D
    display?: DisplayConfig3D
    camera_projection?: CameraProjection3D
    auto_rotate?: number
    series?: DataSeries3D[]
    surfaces?: Surface3DConfig[]
    toggle_props?: ComponentProps<typeof DraggablePane>[`toggle_props`]
    pane_props?: ComponentProps<typeof DraggablePane>[`pane_props`]
    children?: Snippet
  } = $props()

  // Calculate auto ranges for reset
  function calc_auto_range(values: number[]): [number, number] {
    if (values.length === 0) return [0, 1]
    let [min_val, max_val] = [values[0], values[0]]
    for (const v of values) {
      if (v < min_val) min_val = v
      else if (v > max_val) max_val = v
    }
    const padding = (max_val - min_val) * 0.05 || 0.5
    return [min_val - padding, max_val + padding]
  }

  // flatMap already creates new array, no need to spread
  let all_x_values = $derived(series.flatMap((srs) => srs.x))
  let all_y_values = $derived(series.flatMap((srs) => srs.y))
  let all_z_values = $derived(series.flatMap((srs) => srs.z))

  let auto_x_range = $derived(calc_auto_range(all_x_values))
  let auto_y_range = $derived(calc_auto_range(all_y_values))
  let auto_z_range = $derived(calc_auto_range(all_z_values))

  // Helper to extract input value from event - DRYs up event handler casts
  const get_input_value = (event: Event) => (event.target as HTMLInputElement).value

  // Helpers to update display properties - avoids verbose inline handlers
  const update_display = (key: keyof DisplayConfig3D) => (event: Event) => {
    const parsed = parseFloat(get_input_value(event))
    // Guard against NaN when input is cleared - preserve existing value
    if (!Number.isNaN(parsed)) display = { ...display, [key]: parsed }
  }
  const toggle_display = (key: keyof DisplayConfig3D) => () => {
    display = { ...display, [key]: !display[key] }
  }
  const toggle_projection = (plane: `xy` | `xz` | `yz`) => () => {
    display = {
      ...display,
      projections: { ...display.projections, [plane]: !display.projections?.[plane] },
    }
  }

  // Round to 4 decimal places for display
  const round4 = (val: number) => Math.round(val * 1e4) / 1e4

  // Helper for axis label updates
  const update_axis_label =
    <T extends { label?: string }>(axis: T, setter: (val: T) => void) =>
    (event: Event) => {
      setter({ ...axis, label: get_input_value(event) })
    }

  type AxisEntry = {
    name: string
    axis: AxisConfig3D
    auto_range: [number, number]
    set: (val: AxisConfig3D) => void
  }
  const axes = $derived<AxisEntry[]>([
    {
      name: `X`,
      axis: x_axis,
      auto_range: auto_x_range,
      set: (val) => (x_axis = val),
    },
    {
      name: `Y`,
      axis: y_axis,
      auto_range: auto_y_range,
      set: (val) => (y_axis = val),
    },
    {
      name: `Z`,
      axis: z_axis,
      auto_range: auto_z_range,
      set: (val) => (z_axis = val),
    },
  ])
</script>

<DraggablePane
  {toggle_props}
  pane_props={{
    title: `3D Plot Settings`,
    ...pane_props,
    style: `max-height: 80cqh; overflow-y: auto; ${pane_props?.style ?? ``}`,
  }}
>
  <!-- Camera Controls -->
  <SettingsSection
    title="Camera"
    current_values={{ projection: camera_projection, auto_rotate }}
    on_reset={() => {
      camera_projection = `perspective`
      auto_rotate = 0
    }}
  >
    <div class="pane-row">
      <label for="{uid}-camera-projection">Projection:</label>
      <select id="{uid}-camera-projection" bind:value={camera_projection}>
        <option value="perspective">Perspective</option>
        <option value="orthographic">Orthographic</option>
      </select>
    </div>
    <div class="pane-row">
      <label for="{uid}-auto-rotate">Auto Rotate:</label>
      <input
        id="{uid}-auto-rotate"
        type="range"
        min="0"
        max="5"
        step="0.1"
        bind:value={auto_rotate}
      />
      <input type="number" min="0" max="5" step="0.1" bind:value={auto_rotate} />
    </div>
  </SettingsSection>

  <!-- Display Controls -->
  <SettingsSection
    title="Display"
    current_values={{
      show_axes: display.show_axes,
      show_grid: display.show_grid,
      show_axis_labels: display.show_axis_labels,
      show_bounding_box: display.show_bounding_box,
    }}
    on_reset={() => {
      display = {
        ...display,
        show_axes: true,
        show_grid: true,
        show_axis_labels: true,
        show_bounding_box: false,
      }
    }}
    style="display: flex; flex-wrap: wrap; gap: 1ex"
  >
    <label>
      <input
        type="checkbox"
        checked={display.show_axes}
        onchange={toggle_display(`show_axes`)}
      /> Axes
    </label>
    <label>
      <input
        type="checkbox"
        checked={display.show_grid}
        onchange={toggle_display(`show_grid`)}
      /> Grid
    </label>
    <label>
      <input
        type="checkbox"
        checked={display.show_axis_labels}
        onchange={toggle_display(`show_axis_labels`)}
      /> Labels
    </label>
    <label>
      <input
        type="checkbox"
        checked={display.show_bounding_box}
        onchange={toggle_display(`show_bounding_box`)}
      /> Bounds
    </label>
  </SettingsSection>

  <!-- Projections -->
  <SettingsSection
    title="Projections"
    current_values={{
      xy: display.projections?.xy,
      xz: display.projections?.xz,
      yz: display.projections?.yz,
      opacity: display.projection_opacity,
      scale: display.projection_scale,
    }}
    on_reset={() => {
      display = {
        ...display,
        projections: { xy: false, xz: false, yz: false },
        projection_opacity: 0.3,
        projection_scale: 0.5,
      }
    }}
  >
    <div style="display: flex; flex-wrap: wrap; gap: 1ex">
      <label>
        <input
          type="checkbox"
          checked={display.projections?.xy}
          onchange={toggle_projection(`xy`)}
        /> XY
      </label>
      <label>
        <input
          type="checkbox"
          checked={display.projections?.xz}
          onchange={toggle_projection(`xz`)}
        /> XZ
      </label>
      <label>
        <input
          type="checkbox"
          checked={display.projections?.yz}
          onchange={toggle_projection(`yz`)}
        /> YZ
      </label>
    </div>
    <div class="pane-row">
      <label for="{uid}-proj-opacity">Opacity:</label>
      <input
        id="{uid}-proj-opacity"
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={display.projection_opacity ?? 0.3}
        oninput={update_display(`projection_opacity`)}
      />
      <input
        type="number"
        min="0"
        max="1"
        step="0.05"
        value={display.projection_opacity ?? 0.3}
        oninput={update_display(`projection_opacity`)}
        style="width: 3.5em"
      />
    </div>
    <div class="pane-row">
      <label for="{uid}-proj-scale">Size:</label>
      <input
        id="{uid}-proj-scale"
        type="range"
        min="0.1"
        max="1"
        step="0.05"
        value={display.projection_scale ?? 0.5}
        oninput={update_display(`projection_scale`)}
      />
      <input
        type="number"
        min="0.1"
        max="1"
        step="0.05"
        value={display.projection_scale ?? 0.5}
        oninput={update_display(`projection_scale`)}
        style="width: 3.5em"
      />
    </div>
  </SettingsSection>

  <!-- Axes (merged X/Y/Z) -->
  <SettingsSection
    title="Axes"
    current_values={{
      x_range: x_axis.range,
      y_range: y_axis.range,
      z_range: z_axis.range,
    }}
    on_reset={() => {
      x_axis = { ...x_axis, range: [null, null] }
      y_axis = { ...y_axis, range: [null, null] }
      z_axis = { ...z_axis, range: [null, null] }
    }}
  >
    {#each axes as { name, axis, auto_range, set } (name)}
      <div class="axis-row">
        <span class="axis-name">{name}</span>
        <input
          type="text"
          value={axis.label}
          oninput={update_axis_label(axis, set)}
          placeholder="{name} label"
          aria-label="{name} label"
          class="axis-label-input"
        />
        <input
          type="number"
          step="any"
          value={round4(axis.range?.[0] ?? auto_range[0])}
          oninput={(event) => {
            const val = parseFloat((event.target as HTMLInputElement).value)
            if (Number.isNaN(val)) return
            set({ ...axis, range: [val, axis.range?.[1] ?? auto_range[1]] })
          }}
          aria-label="{name} min"
          class="axis-range-input"
        />
        <span class="axis-to">–</span>
        <input
          type="number"
          step="any"
          value={round4(axis.range?.[1] ?? auto_range[1])}
          oninput={(event) => {
            const val = parseFloat((event.target as HTMLInputElement).value)
            if (Number.isNaN(val)) return
            set({ ...axis, range: [axis.range?.[0] ?? auto_range[0], val] })
          }}
          aria-label="{name} max"
          class="axis-range-input"
        />
      </div>
    {/each}
  </SettingsSection>

  <!-- Data summary -->
  {#if series.length > 0 || surfaces.length > 0}
    <div class="data-summary">
      {#if series.length > 0}
        <span>Series: {series.length} · Points: {
            series.reduce((sum, srs) => sum + srs.x.length, 0).toLocaleString()
          }</span>
      {/if}
      {#if surfaces.length > 0}
        <span>Surfaces: {surfaces.length}</span>
      {/if}
    </div>
  {/if}

  <!-- User-provided children -->
  {@render children?.()}
</DraggablePane>

<style>
  .pane-row {
    display: flex;
    align-items: center;
    gap: 0.5em;
    margin: 0.3em 0;
    font-size: 0.9em;
  }
  .pane-row label {
    min-width: 4em;
    flex-shrink: 0;
  }
  .pane-row input[type='number'] {
    width: 5em;
  }
  .pane-row input[type='range'] {
    flex: 1;
    min-width: 4em;
  }
  .pane-row select {
    flex: 1;
    min-width: 0;
  }
  .axis-row {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 2px 0;
    font-size: 0.9em;
  }
  .axis-row input {
    box-sizing: border-box;
    height: 1.4em;
    padding: 0 3px;
    font-size: inherit;
    line-height: 1;
  }
  .axis-name {
    font-weight: 600;
    width: 1.2em;
    flex-shrink: 0;
  }
  .axis-label-input {
    width: 6em;
    min-width: 0;
    flex-shrink: 1;
  }
  .axis-range-input {
    width: 7em;
    flex: 1;
    min-width: 5em;
  }
  .axis-to {
    flex-shrink: 0;
    opacity: 0.5;
  }
  .data-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 1ex;
    font-size: 0.85em;
    opacity: 0.7;
    margin-top: 4px;
  }
</style>
