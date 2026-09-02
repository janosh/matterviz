<script lang="ts">
  import { ControlPane } from '$lib/overlays'
  import { css_color_to_hex } from '$lib/colors'
  import { format_num } from '$lib/labels'
  import { NumberRangeInput, SettingsGroup, SettingsSection } from '$lib/layout'
  import { clamp } from '$lib/math'
  import type { AxisConfig } from '$lib/plot'
  import type { ComponentProps, Snippet } from 'svelte'
  import { tooltip } from 'svelte-widgets/attachments'
  import type { PhaseDiagramConfig, PhaseDiagramData } from './types'
  import { merge_phase_diagram_config, PHASE_DIAGRAM_DEFAULTS } from './utils'

  let {
    controls_open = $bindable(false),
    // Visibility toggles
    show_boundaries = $bindable(PHASE_DIAGRAM_DEFAULTS.show_boundaries),
    show_labels = $bindable(PHASE_DIAGRAM_DEFAULTS.show_labels),
    show_special_points = $bindable(PHASE_DIAGRAM_DEFAULTS.show_special_points),
    show_grid = $bindable(PHASE_DIAGRAM_DEFAULTS.show_grid),
    show_component_labels = $bindable(PHASE_DIAGRAM_DEFAULTS.show_component_labels),
    // Configuration
    config = $bindable({}),
    // Axis configuration
    x_axis = $bindable({}),
    y_axis = $bindable({}),
    // Data
    data,
    // Export
    enable_export = true,
    png_dpi = $bindable(PHASE_DIAGRAM_DEFAULTS.png_dpi),
    children,
    ...rest
  }: Omit<ComponentProps<typeof ControlPane>, `children`> & {
    // Visibility toggles
    show_boundaries?: boolean
    show_labels?: boolean
    show_special_points?: boolean
    show_grid?: boolean
    show_component_labels?: boolean
    // Configuration
    config?: Partial<PhaseDiagramConfig>
    // Axis configuration
    x_axis?: AxisConfig
    y_axis?: AxisConfig
    // Data for context (components, units, etc.)
    data?: PhaseDiagramData
    // Export settings
    enable_export?: boolean
    png_dpi?: number
    // Custom content rendered above the built-in sections
    children?: Snippet<[{ controls_open: boolean }]>
  } = $props()

  const merged_config = $derived(merge_phase_diagram_config(config))

  // Config and axis objects are reassigned, not mutated, so the $bindable props notify
  function update_config<K extends keyof PhaseDiagramConfig>(
    key: K,
    value: PhaseDiagramConfig[K],
  ) {
    config = { ...config, [key]: value }
  }

  function update_nested<K extends keyof Pick<PhaseDiagramConfig, `colors` | `tie_line`>>(
    key: K,
    prop: string,
    value: string | number,
  ) {
    config = { ...config, [key]: { ...config[key], [prop]: value } }
  }

  // Derive component info from data
  const title = $derived(
    data?.components?.[0] && data.components[1]
      ? `${data.components[0]}-${data.components[1]} phase diagram`
      : `Phase diagram controls`,
  )
  const temp_unit = $derived(data?.temperature_unit ?? `K`)
  const comp_unit = $derived(data?.composition_unit ?? `at%`)
  const has_special_points = $derived((data?.special_points?.length ?? 0) > 0)

  // [tie_line config key, row label, tooltip, min, max, step]
  const tie_line_rows = [
    [`stroke_width`, `Line width`, `Thickness of the tie-line`, 0.5, 5, 0.5],
    [
      `endpoint_radius`,
      `Endpoint radius`,
      `Radius of phase boundary endpoint markers`,
      2,
      10,
      1,
    ],
    [`cursor_radius`, `Cursor radius`, `Radius of the cursor position marker`, 2, 10, 1],
  ] as const
</script>

<ControlPane
  bind:controls_open
  controls_name="phase-diagram"
  pane_style=""
  toggle_style=""
  toggle_title="Phase diagram"
  {...rest}
>
  <h4 style="margin: 0 0 8pt 0">{title}</h4>

  {@render children?.({ controls_open })}

  <SettingsGroup title="Diagram" open>
    <SettingsSection
      title="Visibility"
      current_values={{
        show_boundaries,
        show_labels,
        show_special_points,
        show_grid,
        show_component_labels,
      }}
      on_reset={() =>
        ({
          show_boundaries,
          show_labels,
          show_special_points,
          show_grid,
          show_component_labels,
        } = PHASE_DIAGRAM_DEFAULTS)}
      layout="grid"
      class="visibility-grid"
    >
      <label {@attach tooltip({ content: `Show phase boundary lines` })}>
        <span>Boundaries</span>
        <input type="checkbox" bind:checked={show_boundaries} />
      </label>
      <label {@attach tooltip({ content: `Show phase region labels` })}>
        <span>Labels</span>
        <input type="checkbox" bind:checked={show_labels} />
      </label>
      <label {@attach tooltip({ content: `Show background grid lines` })}>
        <span>Grid</span>
        <input type="checkbox" bind:checked={show_grid} />
      </label>
      {#if has_special_points}
        <label {@attach tooltip({ content: `Show eutectic/peritectic points` })}>
          <span>Special pts</span>
          <input type="checkbox" bind:checked={show_special_points} />
        </label>
      {/if}
      <label {@attach tooltip({ content: `Show component labels at axes` })}>
        <span>Comp. labels</span>
        <input type="checkbox" bind:checked={show_component_labels} />
      </label>
    </SettingsSection>

    <SettingsSection
      title="Appearance"
      current_values={{
        font_size: merged_config.font_size,
        special_point_radius: merged_config.special_point_radius,
      }}
      on_reset={() => {
        update_config(`font_size`, PHASE_DIAGRAM_DEFAULTS.font_size)
        update_config(`special_point_radius`, PHASE_DIAGRAM_DEFAULTS.special_point_radius)
      }}
      layout="grid"
    >
      <NumberRangeInput
        min={8}
        max={20}
        step={1}
        title="Font size for axis labels and tick marks"
        bind:value={() => merged_config.font_size, (val) => update_config(`font_size`, val)}
        >Font size</NumberRangeInput
      >
      {#if has_special_points}
        <NumberRangeInput
          min={2}
          max={12}
          step={1}
          title="Radius of special point markers (eutectic, peritectic, etc.)"
          bind:value={
            () => merged_config.special_point_radius,
            (val) => update_config(`special_point_radius`, val)
          }>Special pt radius</NumberRangeInput
        >
      {/if}
    </SettingsSection>

    {@const color_options = [
      [`background`, `#ffffff`, `Background`, `Background color of the plot area`],
      [`grid`, `#888888`, `Grid`, `Color of grid lines`],
      [`boundary`, `#333333`, `Boundaries`, `Color of phase boundary lines`],
      [`special_point`, `#d32f2f`, `Special pts`, `Color of special point markers`],
      [`axis`, `#333333`, `Axis`, `Color of axis lines`],
      [`text`, `#333333`, `Text`, `Color of text labels`],
    ] as const}
    <SettingsSection
      title="Colors"
      current_values={{ ...merged_config.colors }}
      on_reset={() => (config = { ...config, colors: { ...PHASE_DIAGRAM_DEFAULTS.colors } })}
      layout="grid"
    >
      {#each color_options as [key, fallback, label, tip] (key)}
        <label {@attach tooltip({ content: tip })}>
          <span>{label}</span>
          <input
            type="color"
            value={css_color_to_hex(merged_config.colors[key], fallback)}
            oninput={(ev) => update_nested(`colors`, key, ev.currentTarget.value)}
          />
        </label>
      {/each}
    </SettingsSection>
  </SettingsGroup>

  <SettingsGroup title="Interaction" open>
    <SettingsSection
      title="Tie-line display"
      current_values={{ ...merged_config.tie_line }}
      on_reset={() => {
        config = { ...config, tie_line: { ...PHASE_DIAGRAM_DEFAULTS.tie_line } }
      }}
      layout="grid"
    >
      {#each tie_line_rows as [key, label, title, min, max, step] (key)}
        <NumberRangeInput
          {min}
          {max}
          {step}
          {title}
          bind:value={
            () => merged_config.tie_line[key], (val) => update_nested(`tie_line`, key, val)
          }>{label}</NumberRangeInput
        >
      {/each}
    </SettingsSection>

    {@const axis_configs = [
      [x_axis, `x`, comp_unit, `composition`],
      [y_axis, `y`, temp_unit, `temperature`],
    ] as const}
    <SettingsSection
      title="Axes"
      current_values={{ x_ticks: x_axis.ticks, y_ticks: y_axis.ticks }}
      on_reset={() => {
        x_axis = { ...x_axis, ticks: PHASE_DIAGRAM_DEFAULTS.x_ticks }
        y_axis = { ...y_axis, ticks: PHASE_DIAGRAM_DEFAULTS.y_ticks }
      }}
      layout="grid"
    >
      {#each axis_configs as [axis_cfg, axis_name, unit, desc] (axis_name)}
        <label {@attach tooltip({ content: `Ticks on ${desc} axis (${unit})` })}>
          <span>{axis_name.toUpperCase()}-axis ticks</span>
          <input
            type="number"
            min={2}
            max={15}
            value={axis_cfg.ticks ?? PHASE_DIAGRAM_DEFAULTS[`${axis_name}_ticks`]}
            oninput={(ev) => {
              const parsed_ticks = ev.currentTarget.valueAsNumber
              if (!Number.isFinite(parsed_ticks)) return
              const new_ticks = clamp(Math.round(parsed_ticks), 2, 15)
              if (axis_name === `x`) x_axis = { ...x_axis, ticks: new_ticks }
              else y_axis = { ...y_axis, ticks: new_ticks }
            }}
          />
        </label>
      {/each}
    </SettingsSection>
  </SettingsGroup>

  {#if enable_export}
    <SettingsSection
      title="Export"
      current_values={{ png_dpi }}
      on_reset={() => (png_dpi = PHASE_DIAGRAM_DEFAULTS.png_dpi)}
      layout="grid"
    >
      <label
        {@attach tooltip({
          content: `DPI (dots per inch) for PNG export. Higher values produce larger, higher-quality images.`,
        })}
      >
        <span>PNG DPI</span>
        <span class="dpi-value" style="display: inline-flex; align-items: baseline; gap: 1pt">
          <input type="number" min={72} max={600} step={50} bind:value={png_dpi} />
          <span style="font-size: 0.85em; opacity: 0.8">{format_num(png_dpi, `d`)} dpi</span>
        </span>
        <input type="range" min={72} max={600} step={50} bind:value={png_dpi} />
      </label>
    </SettingsSection>
  {/if}
</ControlPane>

<style>
  :global(.phase-diagram-controls-pane) {
    font-size: 0.85em;
    max-width: 320px;
    --pane-padding: 10px;
    --pane-gap: 4px;
    --ctrl-label-w: 8.5em;
    --ctrl-value-w: 5.5em;
  }
  :global(.phase-diagram-controls-pane h4) {
    margin: 6pt 0 2pt !important;
  }
  :global(.phase-diagram-controls-pane h4:first-of-type) {
    margin-top: 0 !important;
  }
  input {
    font-size: inherit;
    font-family: inherit;
  }
  input[type='number'] {
    width: 3.5em;
  }
  input[type='range'] {
    min-width: 40px;
  }
  input[type='color'] {
    width: 32px;
    height: 24px;
    box-sizing: border-box;
    padding: 0;
    border: 1px solid var(--border-color, #ccc);
    border-radius: 4px;
    cursor: pointer;
  }
</style>
