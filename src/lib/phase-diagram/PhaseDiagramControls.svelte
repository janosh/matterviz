<script lang="ts">
  import { format_num } from '$lib/labels'
  import SettingsSection from '$lib/layout/SettingsSection.svelte'
  import DraggablePane from '$lib/overlays/DraggablePane.svelte'
  import { css_color_to_hex } from '$lib/colors'
  import type { AxisConfig } from '$lib/plot'
  import type { ComponentProps, Snippet } from 'svelte'
  import { tooltip } from 'svelte-multiselect/attachments'
  import type { PhaseDiagramConfig, PhaseDiagramData } from './types'
  import { merge_phase_diagram_config, PHASE_DIAGRAM_DEFAULTS } from './utils'

  type Props = Omit<ComponentProps<typeof DraggablePane>, `children`> & {
    controls_open?: boolean
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
    // Pane customization
    pane_props?: ComponentProps<typeof DraggablePane>[`pane_props`]
    toggle_props?: ComponentProps<typeof DraggablePane>[`toggle_props`]
    // Custom content snippets
    children?: Snippet<[{ controls_open: boolean }]>
    post_children?: Snippet<[{ controls_open: boolean }]>
  }

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
    // Pane props
    pane_props = {},
    toggle_props = {},
    // Snippets
    children,
    post_children,
    ...rest
  }: Props = $props()

  // Merged config using shared helper
  const merged_config = $derived(merge_phase_diagram_config(config))

  // Helper to update top-level config properties (e.g., font_size, special_point_radius)
  function update_config<K extends keyof PhaseDiagramConfig>(
    key: K,
    value: PhaseDiagramConfig[K],
  ) {
    config = { ...config, [key]: value }
  }

  // Helper to update nested config properties
  function update_nested<
    K extends keyof Pick<PhaseDiagramConfig, `colors` | `tie_line`>,
  >(
    key: K,
    prop: string,
    value: string | number,
  ) {
    config = { ...config, [key]: { ...config[key], [prop]: value } }
  }

  // Derive component info from data
  const component_a = $derived(data?.components?.[0])
  const component_b = $derived(data?.components?.[1])
  const title = $derived(
    component_a && component_b
      ? `${component_a}-${component_b} Phase Diagram`
      : `Phase Diagram Controls`,
  )
  const temp_unit = $derived(data?.temperature_unit ?? `K`)
  const comp_unit = $derived(data?.composition_unit ?? `at%`)
  const has_special_points = $derived((data?.special_points?.length ?? 0) > 0)
</script>

<!-- Reusable snippet for number + range input pairs -->
{#snippet num_range(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  on_change: (val: number) => void,
  tip: string,
)}
  {@const oninput = (ev: Event) =>
    on_change(Number((ev.currentTarget as HTMLInputElement).value))}
  <label {@attach tooltip({ content: tip })}>
    {label}
    <input type="number" {min} {max} {step} {value} {oninput} />
    <input type="range" {min} {max} {step} {value} {oninput} />
  </label>
{/snippet}

<DraggablePane
  bind:show={controls_open}
  pane_props={{
    ...pane_props,
    class: `phase-diagram-controls-pane ${pane_props?.class ?? ``}`,
    style: `--pane-padding: 12px; --pane-gap: 6px; ${pane_props?.style ?? ``}`,
  }}
  toggle_props={{
    title: controls_open ? `` : `Phase diagram controls`,
    class: `phase-diagram-controls-toggle`,
    ...toggle_props,
  }}
  closed_icon="Settings"
  open_icon="Cross"
  {...rest}
>
  <h4 style="margin: 0 0 8pt 0">{title}</h4>

  {@render children?.({ controls_open })}

  <!-- Visibility Section -->
  <SettingsSection
    title="Visibility"
    current_values={{
      show_boundaries,
      show_labels,
      show_special_points,
      show_grid,
      show_component_labels,
    }}
    on_reset={() => {
      show_boundaries = PHASE_DIAGRAM_DEFAULTS.show_boundaries
      show_labels = PHASE_DIAGRAM_DEFAULTS.show_labels
      show_special_points = PHASE_DIAGRAM_DEFAULTS.show_special_points
      show_grid = PHASE_DIAGRAM_DEFAULTS.show_grid
      show_component_labels = PHASE_DIAGRAM_DEFAULTS.show_component_labels
    }}
  >
    <div class="visibility-grid">
      <label {@attach tooltip({ content: `Show phase boundary lines` })}>
        <input type="checkbox" bind:checked={show_boundaries} />
        Boundaries
      </label>
      <label {@attach tooltip({ content: `Show phase region labels` })}>
        <input type="checkbox" bind:checked={show_labels} />
        Labels
      </label>
      <label {@attach tooltip({ content: `Show background grid lines` })}>
        <input type="checkbox" bind:checked={show_grid} />
        Grid
      </label>
      {#if has_special_points}
        <label {@attach tooltip({ content: `Show eutectic/peritectic points` })}>
          <input type="checkbox" bind:checked={show_special_points} />
          Special Pts
        </label>
      {/if}
      <label
        {@attach tooltip({
          content: `Show component labels at axes`,
        })}
      >
        <input type="checkbox" bind:checked={show_component_labels} />
        Comp. Labels
      </label>
    </div>
  </SettingsSection>

  <!-- Appearance Section -->
  <SettingsSection
    title="Appearance"
    current_values={{
      font_size: merged_config.font_size,
      special_point_radius: merged_config.special_point_radius,
    }}
    on_reset={() => {
      update_config(`font_size`, PHASE_DIAGRAM_DEFAULTS.font_size)
      update_config(
        `special_point_radius`,
        PHASE_DIAGRAM_DEFAULTS.special_point_radius,
      )
    }}
  >
    {@render num_range(
        `Font size`,
        merged_config.font_size,
        8,
        20,
        1,
        (val) => update_config(`font_size`, val),
        `Font size for axis labels and tick marks`,
      )}
    {#if has_special_points}
      {@render num_range(
        `Special pt radius`,
        merged_config.special_point_radius,
        2,
        12,
        1,
        (val) => update_config(`special_point_radius`, val),
        `Radius of special point markers (eutectic, peritectic, etc.)`,
      )}
    {/if}
  </SettingsSection>

  <!-- Colors Section -->
  {@const color_options = [
      [`background`, `#ffffff`, `Background`, `Background color of the plot area`],
      [`grid`, `#888888`, `Grid`, `Color of grid lines`],
      [`boundary`, `#333333`, `Boundaries`, `Color of phase boundary lines`],
      [`special_point`, `#d32f2f`, `Special Pts`, `Color of special point markers`],
      [`axis`, `#333333`, `Axis`, `Color of axis lines`],
      [`text`, `#333333`, `Text`, `Color of text labels`],
    ] as const}
  <SettingsSection
    title="Colors"
    current_values={{ ...merged_config.colors }}
    on_reset={() => {
      config = { ...config, colors: { ...PHASE_DIAGRAM_DEFAULTS.colors } }
    }}
  >
    <div class="color-grid">
      {#each color_options as [key, fallback, label, tip] (key)}
        <label {@attach tooltip({ content: tip })}>
          {label}
          <input
            type="color"
            value={css_color_to_hex(merged_config.colors[key], fallback)}
            oninput={(ev) => update_nested(`colors`, key, ev.currentTarget.value)}
          />
        </label>
      {/each}
    </div>
  </SettingsSection>

  <!-- Tie-line Section -->
  <SettingsSection
    title="Tie-line Display"
    current_values={{
      ...merged_config.tie_line,
    }}
    on_reset={() => {
      config = {
        ...config,
        tie_line: { ...PHASE_DIAGRAM_DEFAULTS.tie_line },
      }
    }}
  >
    {@render num_range(
        `Line width`,
        merged_config.tie_line.stroke_width,
        0.5,
        5,
        0.5,
        (val) => update_nested(`tie_line`, `stroke_width`, val),
        `Thickness of the horizontal tie-line`,
      )}
    {@render num_range(
        `Endpoint radius`,
        merged_config.tie_line.endpoint_radius,
        2,
        10,
        1,
        (val) => update_nested(`tie_line`, `endpoint_radius`, val),
        `Radius of phase boundary endpoint markers`,
      )}
    {@render num_range(
        `Cursor radius`,
        merged_config.tie_line.cursor_radius,
        2,
        10,
        1,
        (val) => update_nested(`tie_line`, `cursor_radius`, val),
        `Radius of the cursor position marker`,
      )}
  </SettingsSection>

  <!-- Axis Configuration Section -->
  {@const axis_configs = [
      [x_axis, `x`, comp_unit, `composition`],
      [y_axis, `y`, temp_unit, `temperature`],
    ] as const}
  <SettingsSection
    title="Axes"
    current_values={{ x_ticks: x_axis.ticks, y_ticks: y_axis.ticks }}
    on_reset={() => {
      // Reassign entire objects to trigger $bindable reactivity up the chain
      x_axis = { ...x_axis, ticks: PHASE_DIAGRAM_DEFAULTS.x_ticks }
      y_axis = { ...y_axis, ticks: PHASE_DIAGRAM_DEFAULTS.y_ticks }
    }}
  >
    <div class="pane-row">
      {#each axis_configs as [axis_cfg, axis_name, unit, desc] (axis_name)}
        <label {@attach tooltip({ content: `Ticks on ${desc} axis (${unit})` })}>
          {axis_name.toUpperCase()}-axis ticks
          <input
            type="number"
            min={2}
            max={15}
            value={axis_cfg.ticks ?? PHASE_DIAGRAM_DEFAULTS[`${axis_name}_ticks`]}
            oninput={(ev) => {
              // Reassign entire object to trigger $bindable reactivity up the chain
              const new_ticks = Number(ev.currentTarget.value)
              if (axis_name === `x`) x_axis = { ...x_axis, ticks: new_ticks }
              else if (axis_name === `y`) y_axis = { ...y_axis, ticks: new_ticks }
            }}
          />
        </label>
      {/each}
    </div>
  </SettingsSection>

  <!-- Export Section (if enabled) -->
  {#if enable_export}
    <SettingsSection
      title="Export"
      current_values={{ png_dpi }}
      on_reset={() => {
        png_dpi = PHASE_DIAGRAM_DEFAULTS.png_dpi
      }}
    >
      <label
        {@attach tooltip({
          content:
            `DPI (dots per inch) for PNG export. Higher values produce larger, higher-quality images.`,
        })}
      >
        PNG DPI
        <input
          type="number"
          min={72}
          max={600}
          step={50}
          bind:value={png_dpi}
        />
        <input
          type="range"
          min={72}
          max={600}
          step={50}
          bind:value={png_dpi}
        />
        <span style="font-size: 0.85em; opacity: 0.7">{format_num(png_dpi, `d`)}
          dpi</span>
      </label>
    </SettingsSection>
  {/if}

  {@render post_children?.({ controls_open })}
</DraggablePane>

<style>
  :global(.phase-diagram-controls-pane) {
    font-size: 0.85em;
    max-width: 320px;
  }
  :global(.phase-diagram-controls-pane section) {
    display: flex;
    flex-direction: column;
    gap: 6pt;
  }
  :global(.phase-diagram-controls-pane h4) {
    margin: 10pt 0 4pt !important;
  }
  :global(.phase-diagram-controls-pane h4:first-of-type) {
    margin-top: 0 !important;
  }
  .pane-row {
    display: flex;
    gap: 12pt;
    justify-content: space-between;
    width: 100%;
  }
  .visibility-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 6pt 12pt;
  }
  .color-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8pt;
  }
  .color-grid label {
    flex-direction: column;
    align-items: center;
    font-size: 0.9em;
  }
  label {
    display: flex;
    align-items: center;
    gap: 6pt;
  }
  input {
    font-size: inherit;
    font-family: inherit;
  }
  input[type='range'] {
    flex: 1;
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
