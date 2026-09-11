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
  import { track_settings } from '$lib/controls'
  import { format_num } from '$lib/labels'
  import type { ShowControlsProp } from '$lib/controls'
  import { ControlPane, type PaneProps, type PaneToggleProps } from '$lib/overlays'
  // NOTE: Axis config objects must be reassigned (not mutated) to trigger $bindable reactivity.
  // Pattern: `x_axis = { ...x_axis, prop: value }` instead of `x_axis.prop = value`
  import { NumberRangeInput, SettingsSection } from '$lib/layout'
  import type { Vec2 } from '$lib/math'
  import type { AxisConfig3D, CameraProjection3D } from '$lib/plot/core/types'
  import { type Snippet, untrack } from 'svelte'

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
    auto_ranges = { x: [0, 1], y: [0, 1], z: [0, 1] },
    toggle_props,
    pane_props,
    children,
  }: {
    show_controls?: ShowControlsProp<`controls` | `fullscreen`>
    controls_open?: boolean
    x_axis?: AxisConfig3D
    y_axis?: AxisConfig3D
    z_axis?: AxisConfig3D
    display?: DisplayConfig3D
    camera_projection?: CameraProjection3D
    auto_rotate?: number
    // Data-derived bounds are supplied by the chart; controls never sample or transform data.
    auto_ranges?: Record<`x` | `y` | `z`, Vec2>
    toggle_props?: PaneToggleProps
    pane_props?: PaneProps
    children?: Snippet
  } = $props()

  const set_display = (key: `projection_opacity` | `projection_scale`) => (val?: number) => {
    // Guard against cleared/invalid input - preserve existing value
    if (val != null && Number.isFinite(val)) display = { ...display, [key]: val }
  }
  type AxisEntry = {
    name: string
    axis: AxisConfig3D
    auto_range: Vec2
    set: (val: AxisConfig3D) => void
  }
  const set_axis_range = ({ axis, set }: AxisEntry, bound: 0 | 1, value: string): void => {
    const parsed = value === `` ? null : Number(value)
    if (parsed !== null && !Number.isFinite(parsed)) return
    const range: [number | null, number | null] = [...(axis.range ?? [null, null])]
    range[bound] = parsed
    set({ ...axis, range })
  }
  const axes = $derived<AxisEntry[]>([
    { name: `X`, axis: x_axis, auto_range: auto_ranges.x, set: (val) => (x_axis = val) },
    { name: `Y`, axis: y_axis, auto_range: auto_ranges.y, set: (val) => (y_axis = val) },
    { name: `Z`, axis: z_axis, auto_range: auto_ranges.z, set: (val) => (z_axis = val) },
  ])

  const display_toggles = [
    [`show_axes`, `Axes`],
    [`show_grid`, `Grid`],
    [`show_axis_labels`, `Labels`],
    [`show_bounding_box`, `Bounds`],
  ] as const
  const projection_planes = [`xy`, `xz`, `yz`] as const
  const camera_settings = track_settings(
    () => ({
      projection: camera_projection,
      auto_rotate,
    }),
    { projection: defaults.camera_projection, auto_rotate: defaults.auto_rotate },
  )
  const display_settings = track_settings(
    () =>
      Object.fromEntries(display_toggles.map(([key]) => [key, display[key] ?? defaults[key]])),
    defaults,
  )
  const projections_settings = track_settings(
    () => ({
      ...Object.fromEntries(
        projection_planes.map((plane) => [
          plane,
          display.projections?.[plane] ?? defaults.projections[plane],
        ]),
      ),
      opacity: display.projection_opacity ?? defaults.projection_opacity,
      scale: display.projection_scale ?? defaults.projection_scale,
    }),
    {
      ...defaults.projections,
      opacity: defaults.projection_opacity,
      scale: defaults.projection_scale,
    },
  )
  const initial_axis_labels = untrack(() => axes.map(({ axis }) => axis.label))
  const axes_settings = track_settings(
    () =>
      Object.fromEntries(
        axes.flatMap(({ name, axis }) => [
          [`${name}_range`, axis.range ?? [null, null]],
          [`${name}_label`, axis.label],
        ]),
      ),
    untrack(() =>
      Object.fromEntries(
        axes.flatMap(({ name }, idx) => [
          [`${name}_range`, [null, null]],
          [`${name}_label`, initial_axis_labels[idx]],
        ]),
      ),
    ),
  )
</script>

<ControlPane
  {show_controls}
  bind:controls_open
  controls_name="scatter-3d"
  toggle_title="3D plot"
  pane_class="compact-settings"
  {toggle_props}
  pane_props={{
    title: `3D plot settings`,
    ...pane_props,
  }}
>
  <!-- Camera Controls -->
  <SettingsSection
    title="Camera"
    changed_keys={camera_settings.changed_keys}
    on_reset={() => ({ camera_projection, auto_rotate } = defaults)}
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
    changed_keys={display_settings.changed_keys}
    on_reset={() => {
      const { show_axes, show_grid, show_axis_labels, show_bounding_box } = defaults
      display = { ...display, show_axes, show_grid, show_axis_labels, show_bounding_box }
    }}
    class="ctrl-line"
    style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr))"
  >
    {#each display_toggles as [key, label] (key)}
      <label>
        <input
          type="checkbox"
          checked={display[key] ?? defaults[key]}
          onchange={(event) => (display = { ...display, [key]: event.currentTarget.checked })}
        />
        {label}
      </label>
    {/each}
  </SettingsSection>

  <!-- Projection settings also apply to data supplied later. -->
  <SettingsSection
    title="Projections"
    changed_keys={projections_settings.changed_keys}
    on_reset={() => {
      const { projections, projection_opacity, projection_scale } = defaults
      display = {
        ...display,
        projections: { ...projections },
        projection_opacity,
        projection_scale,
      }
    }}
  >
    <div style="display: flex; align-items: center; gap: 1em">
      <span>Planes</span>
      <div class="check-options">
        {#each projection_planes as plane (plane)}
          <label>
            <input
              type="checkbox"
              checked={display.projections?.[plane] ?? defaults.projections[plane]}
              onchange={(event) =>
                (display = {
                  ...display,
                  projections: {
                    ...display.projections,
                    [plane]: event.currentTarget.checked,
                  },
                })}
            />
            {plane.toUpperCase()}
          </label>
        {/each}
      </div>
    </div>
    {#each [[`projection_opacity`, `Opacity`, 0], [`projection_scale`, `Size`, 0.1]] as const as [key, label, min] (key)}
      <NumberRangeInput
        {min}
        max={1}
        step={0.05}
        bind:value={() => display[key] ?? defaults[key], set_display(key)}
        >{label}</NumberRangeInput
      >
    {/each}
  </SettingsSection>
  <!-- Axes (merged X/Y/Z) -->
  <SettingsSection
    title="Axes"
    changed_keys={axes_settings.changed_keys}
    on_reset={() => {
      axes.forEach(({ axis, set }, idx) =>
        set({ ...axis, label: initial_axis_labels[idx], range: [null, null] }),
      )
    }}
  >
    {#each axes as entry (entry.name)}
      {@const { name, axis, auto_range, set } = entry}
      <div class="axis-row">
        <span>{name}</span>
        <div class="axis-inputs">
          <input
            type="text"
            value={axis.label}
            oninput={(event) => set({ ...axis, label: event.currentTarget.value })}
            placeholder="{name} label"
            aria-label="{name} label"
          />
          {#each [0, 1] as const as bound (bound)}
            {#if bound === 1}<span style="opacity: 0.5">–</span>{/if}
            <input
              type="number"
              step="any"
              value={axis.range?.[bound] ?? ``}
              placeholder={format_num(auto_range[bound], `.6~g`)}
              oninput={(event) => set_axis_range(entry, bound, event.currentTarget.value)}
              aria-label="{name} {bound === 0 ? `min` : `max`}"
            />
          {/each}
        </div>
      </div>
    {/each}
  </SettingsSection>

  <!-- User-provided children -->
  {@render children?.()}
</ControlPane>

<style>
  .check-options {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 1ex;
    min-width: 0;
    label {
      display: flex;
      align-items: center;
      gap: 3pt;
    }
  }
  .axis-row {
    display: grid;
    grid-template-columns: 1em minmax(0, 1fr);
    align-items: center;
    gap: 6pt;
  }
  .axis-inputs {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 4pt;
    input[type] {
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      height: 1.8em;
      margin: 0;
      padding: 0 4px;
      font-size: inherit;
    }
  }
</style>
