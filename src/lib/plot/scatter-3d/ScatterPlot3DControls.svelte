<script module lang="ts">
  import type { DisplayConfig3D } from '$lib/plot/core/types'

  // Shared with ScatterPlot3D, which fills these in before handing `display` to the scene
  export const DISPLAY_DEFAULTS_3D = {
    show_axes: true,
    show_grid: true,
    show_axis_labels: true,
    show_bounding_box: false,
    projections: { xy: false, xz: false, yz: false },
    projection_opacity: 0.3,
    projection_scale: 0.5,
  } satisfies DisplayConfig3D
</script>

<script lang="ts">
  import { ControlPane, type PaneProps, type PaneToggleProps } from '$lib/overlays'
  // NOTE: Axis config objects must be reassigned (not mutated) to trigger $bindable reactivity.
  // Pattern: `x_axis = { ...x_axis, prop: value }` instead of `x_axis.prop = value`
  import { NumberRangeInput, SettingsSection } from '$lib/layout'
  import type { Vec2 } from '$lib/math'
  import type {
    AxisConfig3D,
    CameraProjection3D,
    DataSeries3D,
    Surface3DConfig,
  } from '$lib/plot/core/types'
  import { calc_auto_range } from '$lib/plot/core/utils'
  import type { Snippet } from 'svelte'

  const defaults = {
    camera_projection: `perspective` as CameraProjection3D,
    auto_rotate: 0,
    ...DISPLAY_DEFAULTS_3D,
  }

  let {
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    x_axis = $bindable({}),
    y_axis = $bindable({}),
    z_axis = $bindable({}),
    display = $bindable({}),
    camera_projection = $bindable(defaults.camera_projection),
    auto_rotate = $bindable(defaults.auto_rotate),
    series = [],
    surfaces = [],
    toggle_props,
    pane_props,
    children,
  }: {
    show_controls?: boolean
    controls_open?: boolean
    x_axis?: AxisConfig3D
    y_axis?: AxisConfig3D
    z_axis?: AxisConfig3D
    display?: DisplayConfig3D
    camera_projection?: CameraProjection3D
    auto_rotate?: number
    series?: DataSeries3D[]
    surfaces?: Surface3DConfig[]
    toggle_props?: PaneToggleProps
    pane_props?: PaneProps
    children?: Snippet
  } = $props()

  // Auto ranges for reset buttons without allocating flattened coordinate arrays.
  let auto_x_range = $derived(calc_auto_range(series, (series_data) => series_data.x))
  let auto_y_range = $derived(calc_auto_range(series, (series_data) => series_data.y))
  let auto_z_range = $derived(calc_auto_range(series, (series_data) => series_data.z))

  const set_display = (key: `projection_opacity` | `projection_scale`) => (val?: number) => {
    // Guard against cleared/invalid input - preserve existing value
    if (val != null && Number.isFinite(val)) display = { ...display, [key]: val }
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

  type AxisEntry = {
    name: string
    axis: AxisConfig3D
    auto_range: Vec2
    set: (val: AxisConfig3D) => void
  }
  const set_axis_range = (
    { axis, auto_range, set }: AxisEntry,
    bound: 0 | 1,
    value: number,
  ): void => {
    if (!Number.isFinite(value)) return
    const range: Vec2 = [axis.range?.[0] ?? auto_range[0], axis.range?.[1] ?? auto_range[1]]
    range[bound] = value
    set({ ...axis, range })
  }
  const axes = $derived<AxisEntry[]>([
    { name: `X`, axis: x_axis, auto_range: auto_x_range, set: (val) => (x_axis = val) },
    { name: `Y`, axis: y_axis, auto_range: auto_y_range, set: (val) => (y_axis = val) },
    { name: `Z`, axis: z_axis, auto_range: auto_z_range, set: (val) => (z_axis = val) },
  ])

  const display_toggles = [
    [`show_axes`, `Axes`],
    [`show_grid`, `Grid`],
    [`show_axis_labels`, `Labels`],
    [`show_bounding_box`, `Bounds`],
  ] as const
  const projection_planes = [`xy`, `xz`, `yz`] as const
</script>

{#if show_controls}
  <ControlPane
    bind:controls_open
    controls_name="scatter-3d"
    toggle_title="3D plot"
    pane_style="--pane-max-height: 80cqh"
    {toggle_props}
    pane_props={{
      title: `3D plot settings`,
      ...pane_props,
    }}
  >
    <!-- Camera Controls -->
    <SettingsSection
      title="Camera"
      current_values={{ projection: camera_projection, auto_rotate }}
      on_reset={() => ({ camera_projection, auto_rotate } = defaults)}
      layout="grid"
    >
      <label>
        <span>Projection</span>
        <select bind:value={camera_projection}>
          <option value="perspective">Perspective</option>
          <option value="orthographic">Orthographic</option>
        </select>
      </label>
      <NumberRangeInput min={0} max={5} step={0.1} bind:value={auto_rotate}
        >Auto-rotate</NumberRangeInput
      >
    </SettingsSection>

    <!-- Display Controls -->
    <SettingsSection
      title="Display"
      current_values={Object.fromEntries(display_toggles.map(([key]) => [key, display[key]]))}
      on_reset={() => {
        const { show_axes, show_grid, show_axis_labels, show_bounding_box } = defaults
        display = { ...display, show_axes, show_grid, show_axis_labels, show_bounding_box }
      }}
      layout="grid"
    >
      {#each display_toggles as [key, label] (key)}
        <label>
          <span>{label}</span>
          <input type="checkbox" checked={display[key]} onchange={toggle_display(key)} />
        </label>
      {/each}
    </SettingsSection>

    <!-- Projections: only when there's data to project -->
    {#if series.length > 0}
      <SettingsSection
        title="Projections"
        current_values={{
          ...Object.fromEntries(
            projection_planes.map((plane) => [plane, display.projections?.[plane]]),
          ),
          opacity: display.projection_opacity,
          scale: display.projection_scale,
        }}
        on_reset={() => {
          const { projections, projection_opacity, projection_scale } = defaults
          display = {
            ...display,
            projections: { ...projections },
            projection_opacity,
            projection_scale,
          }
        }}
        layout="grid"
      >
        <div class="setting">
          <span>Planes</span>
          <div class="check-options">
            {#each projection_planes as plane (plane)}
              <label>
                <input
                  type="checkbox"
                  checked={display.projections?.[plane]}
                  onchange={toggle_projection(plane)}
                />
                {plane.toUpperCase()}
              </label>
            {/each}
          </div>
        </div>
        <NumberRangeInput
          min={0}
          max={1}
          step={0.05}
          bind:value={
            () => display.projection_opacity ?? defaults.projection_opacity,
            set_display(`projection_opacity`)
          }>Opacity</NumberRangeInput
        >
        <NumberRangeInput
          min={0.1}
          max={1}
          step={0.05}
          bind:value={
            () => display.projection_scale ?? defaults.projection_scale,
            set_display(`projection_scale`)
          }>Size</NumberRangeInput
        >
      </SettingsSection>
    {/if}

    <!-- Axes (merged X/Y/Z) -->
    <SettingsSection
      title="Axes"
      current_values={{
        x_range: x_axis.range,
        y_range: y_axis.range,
        z_range: z_axis.range,
      }}
      on_reset={() => {
        for (const { axis, set } of axes) set({ ...axis, range: [null, null] })
      }}
      layout="grid"
    >
      {#each axes as entry (entry.name)}
        {@const { name, axis, auto_range, set } = entry}
        <div class="setting">
          <span>{name}</span>
          <div class="axis-inputs">
            <input
              type="text"
              value={axis.label}
              oninput={(event) => set({ ...axis, label: event.currentTarget.value })}
              placeholder="{name} label"
              aria-label="{name} label"
              class="axis-label-input"
            />
            <input
              type="number"
              step="any"
              value={round4(axis.range?.[0] ?? auto_range[0])}
              oninput={(event) => set_axis_range(entry, 0, event.currentTarget.valueAsNumber)}
              aria-label="{name} min"
              class="axis-range-input"
            />
            <span style="flex-shrink: 0; opacity: 0.5">–</span>
            <input
              type="number"
              step="any"
              value={round4(axis.range?.[1] ?? auto_range[1])}
              oninput={(event) => set_axis_range(entry, 1, event.currentTarget.valueAsNumber)}
              aria-label="{name} max"
              class="axis-range-input"
            />
          </div>
        </div>
      {/each}
    </SettingsSection>

    <!-- Data summary: only when there's data -->
    {#if series.length > 0 || surfaces.length > 0}
      <div class="data-summary">
        {#if series.length > 0}
          <span
            >{series.length} series · {series
              .reduce((sum, srs) => sum + srs.x.length, 0)
              .toLocaleString()} points</span
          >
        {/if}
        {#if surfaces.length > 0}
          <span>{surfaces.length} {surfaces.length === 1 ? `surface` : `surfaces`}</span>
        {/if}
      </div>
    {/if}

    <!-- User-provided children -->
    {@render children?.()}
  </ControlPane>
{/if}

<style>
  :is(.check-options, .axis-inputs) {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
    min-width: 0;
  }
  .check-options {
    gap: 1ex;
    label {
      display: flex;
      align-items: center;
      gap: 3pt;
    }
  }
  .axis-inputs {
    font-size: 0.9em;
    input {
      box-sizing: border-box;
      height: 1.4em;
      padding: 0 3px;
      font-size: inherit;
      line-height: 1;
    }
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
  .data-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 1ex;
    font-size: 0.85em;
    opacity: 0.7;
    margin-top: 4px;
  }
</style>
