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

  // Helpers to update display properties - avoids verbose inline handlers
  const update_display = (key: keyof DisplayConfig3D) => (event: Event) => {
    const parsed = parseFloat((event.target as HTMLInputElement).value)
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

  // Helper for axis label updates
  const update_axis_label =
    <T extends { label?: string }>(axis: T, setter: (val: T) => void) =>
    (event: Event) => {
      setter({ ...axis, label: (event.target as HTMLInputElement).value })
    }
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

  <!-- X Axis Range -->
  <SettingsSection
    title="X Axis"
    current_values={{ range: x_axis.range }}
    on_reset={() => (x_axis = { ...x_axis, range: [null, null] })}
  >
    <div class="pane-row">
      <label for="{uid}-x-label">Label:</label>
      <input
        id="{uid}-x-label"
        type="text"
        value={x_axis.label}
        oninput={update_axis_label(x_axis, (val) => (x_axis = val))}
        placeholder="X"
      />
    </div>
    <div class="pane-row">
      <label for="{uid}-x-range-min">Range:</label>
      <input
        id="{uid}-x-range-min"
        type="number"
        step="any"
        value={x_axis.range?.[0] ?? auto_x_range[0]}
        oninput={(event) => {
          const val = parseFloat((event.target as HTMLInputElement).value)
          if (Number.isNaN(val)) return
          x_axis = {
            ...x_axis,
            range: [val, x_axis.range?.[1] ?? auto_x_range[1]],
          }
        }}
      />
      <span>to</span>
      <input
        id="{uid}-x-range-max"
        type="number"
        step="any"
        value={x_axis.range?.[1] ?? auto_x_range[1]}
        oninput={(event) => {
          const val = parseFloat((event.target as HTMLInputElement).value)
          if (Number.isNaN(val)) return
          x_axis = {
            ...x_axis,
            range: [x_axis.range?.[0] ?? auto_x_range[0], val],
          }
        }}
      />
    </div>
  </SettingsSection>

  <!-- Y Axis Range -->
  <SettingsSection
    title="Y Axis"
    current_values={{ range: y_axis.range }}
    on_reset={() => (y_axis = { ...y_axis, range: [null, null] })}
  >
    <div class="pane-row">
      <label for="{uid}-y-label">Label:</label>
      <input
        id="{uid}-y-label"
        type="text"
        value={y_axis.label}
        oninput={update_axis_label(y_axis, (val) => (y_axis = val))}
        placeholder="Y"
      />
    </div>
    <div class="pane-row">
      <label for="{uid}-y-range-min">Range:</label>
      <input
        id="{uid}-y-range-min"
        type="number"
        step="any"
        value={y_axis.range?.[0] ?? auto_y_range[0]}
        oninput={(event) => {
          const val = parseFloat((event.target as HTMLInputElement).value)
          if (Number.isNaN(val)) return
          y_axis = {
            ...y_axis,
            range: [val, y_axis.range?.[1] ?? auto_y_range[1]],
          }
        }}
      />
      <span>to</span>
      <input
        id="{uid}-y-range-max"
        type="number"
        step="any"
        value={y_axis.range?.[1] ?? auto_y_range[1]}
        oninput={(event) => {
          const val = parseFloat((event.target as HTMLInputElement).value)
          if (Number.isNaN(val)) return
          y_axis = {
            ...y_axis,
            range: [y_axis.range?.[0] ?? auto_y_range[0], val],
          }
        }}
      />
    </div>
  </SettingsSection>

  <!-- Z Axis Range -->
  <SettingsSection
    title="Z Axis"
    current_values={{ range: z_axis.range }}
    on_reset={() => (z_axis = { ...z_axis, range: [null, null] })}
  >
    <div class="pane-row">
      <label for="{uid}-z-label">Label:</label>
      <input
        id="{uid}-z-label"
        type="text"
        value={z_axis.label}
        oninput={update_axis_label(z_axis, (val) => (z_axis = val))}
        placeholder="Z"
      />
    </div>
    <div class="pane-row">
      <label for="{uid}-z-range-min">Range:</label>
      <input
        id="{uid}-z-range-min"
        type="number"
        step="any"
        value={z_axis.range?.[0] ?? auto_z_range[0]}
        oninput={(event) => {
          const val = parseFloat((event.target as HTMLInputElement).value)
          if (Number.isNaN(val)) return
          z_axis = {
            ...z_axis,
            range: [val, z_axis.range?.[1] ?? auto_z_range[1]],
          }
        }}
      />
      <span>to</span>
      <input
        id="{uid}-z-range-max"
        type="number"
        step="any"
        value={z_axis.range?.[1] ?? auto_z_range[1]}
        oninput={(event) => {
          const val = parseFloat((event.target as HTMLInputElement).value)
          if (Number.isNaN(val)) return
          z_axis = {
            ...z_axis,
            range: [z_axis.range?.[0] ?? auto_z_range[0], val],
          }
        }}
      />
    </div>
  </SettingsSection>

  <!-- Series Info -->
  {#if series.length > 0}
    <SettingsSection title="Data" current_values={{ series_count: series.length }}>
      <div class="pane-row">
        <span>Series: {series.length}</span>
      </div>
      <div class="pane-row">
        <span>
          Points: {series.reduce((sum, srs) => sum + srs.x.length, 0).toLocaleString()}
        </span>
      </div>
    </SettingsSection>
  {/if}

  <!-- Surfaces Info -->
  {#if surfaces.length > 0}
    <SettingsSection title="Surfaces" current_values={{ surface_count: surfaces.length }}>
      <div class="pane-row">
        <span>Surfaces: {surfaces.length}</span>
      </div>
    </SettingsSection>
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
  .pane-row input[type='text'] {
    flex: 1;
    min-width: 0;
  }
  .pane-row input[type='range'] {
    flex: 1;
    min-width: 4em;
  }
  .pane-row select {
    flex: 1;
    min-width: 0;
  }
  .pane-row span {
    flex-shrink: 0;
  }
</style>
