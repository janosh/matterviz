<script lang="ts">
  import ColorInput from 'svelte-widgets/ColorInput.svelte'
  import { track_settings } from '#lib/controls.js'
  import { ControlPane } from '#lib/overlays/index.js'
  import { css_color_to_hex } from '#lib/colors/index.js'
  import { NumberRangeInput, SettingsGroup, SettingsSection } from '#lib/layout/index.js'
  import type { AxisConfig } from '#lib/plot/index.js'
  import type { ComponentProps, Snippet } from 'svelte'
  import { tooltip } from 'svelte-widgets/attachments'
  import type { BinaryPhaseDiagram, CompUnit, PhaseDiagramConfig, TempUnit } from './types'
  import { merge_phase_diagram_config, PHASE_DIAGRAM_DEFAULTS } from './utils'

  let {
    controls_open = $bindable(false),
    show_boundaries = $bindable(PHASE_DIAGRAM_DEFAULTS.show_boundaries),
    show_labels = $bindable(PHASE_DIAGRAM_DEFAULTS.show_labels),
    show_special_points = $bindable(PHASE_DIAGRAM_DEFAULTS.show_special_points),
    show_grid = $bindable(PHASE_DIAGRAM_DEFAULTS.show_grid),
    show_component_labels = $bindable(PHASE_DIAGRAM_DEFAULTS.show_component_labels),
    hidden_overlays = $bindable(new Set<number>()),
    show_observations = $bindable(PHASE_DIAGRAM_DEFAULTS.show_observations),
    show_uncertainty = $bindable(PHASE_DIAGRAM_DEFAULTS.show_uncertainty),
    show_disagreement = $bindable(PHASE_DIAGRAM_DEFAULTS.show_disagreement),
    lens = $bindable(PHASE_DIAGRAM_DEFAULTS.lens),
    temp_unit = $bindable(PHASE_DIAGRAM_DEFAULTS.temp_unit),
    comp_unit = $bindable(PHASE_DIAGRAM_DEFAULTS.comp_unit),
    overlay_idxs = [],
    has_observations = false,
    has_special_points = false,
    has_uncertainty = false,
    config = $bindable({}),
    x_axis = $bindable({}),
    y_axis = $bindable({}),
    data,
    children,
    ...rest
  }: Omit<ComponentProps<typeof ControlPane>, `children`> & {
    show_boundaries?: boolean
    show_labels?: boolean
    show_special_points?: boolean
    show_grid?: boolean
    show_component_labels?: boolean
    // Indices of the diagram's overlays not drawn (see IsobaricBinaryPhaseDiagram)
    hidden_overlays?: ReadonlySet<number>
    show_observations?: boolean
    show_uncertainty?: boolean
    show_disagreement?: boolean
    lens?: boolean
    temp_unit?: TempUnit
    comp_unit?: CompUnit
    // Indices of the diagram's valid overlays, toggled together by the Overlays checkbox
    overlay_idxs?: readonly number[]
    // Whether the diagram has observations / marked points to toggle
    has_observations?: boolean
    has_special_points?: boolean
    has_uncertainty?: boolean
    config?: Partial<PhaseDiagramConfig>
    x_axis?: AxisConfig
    y_axis?: AxisConfig
    // Data for context (components)
    data?: BinaryPhaseDiagram
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

  const title = $derived(
    data ? `${data.components.join(`-`)} phase diagram` : `Phase diagram controls`,
  )
  const temp_units: TempUnit[] = [`K`, `°C`, `°F`]
  const comp_units: [CompUnit, string][] = [
    [`at%`, `at.%`],
    [`fraction`, `mole fraction`],
  ]

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

  // Checked while any overlay is drawn: unchecking hides them all, checking shows them all
  const overlays_shown = $derived(overlay_idxs.some((idx) => !hidden_overlays.has(idx)))
  const visibility_settings = track_settings(
    () => ({
      show_boundaries,
      show_labels,
      show_special_points,
      show_grid,
      show_component_labels,
      show_observations,
      show_uncertainty,
      show_disagreement,
      lens,
    }),
    PHASE_DIAGRAM_DEFAULTS,
  )
  const units_settings = track_settings(
    () => ({ temp_unit, comp_unit }),
    PHASE_DIAGRAM_DEFAULTS,
  )
  const appearance_settings = track_settings(
    () => ({
      font_size: merged_config.font_size,
      special_point_radius: merged_config.special_point_radius,
    }),
    PHASE_DIAGRAM_DEFAULTS,
  )
  const colors_settings = track_settings(
    () => merged_config.colors,
    PHASE_DIAGRAM_DEFAULTS.colors,
  )
  const tie_line_display_settings = track_settings(
    () => merged_config.tie_line,
    PHASE_DIAGRAM_DEFAULTS.tie_line,
  )
  const axes_settings = track_settings(
    () => ({
      x_ticks: x_axis.ticks ?? PHASE_DIAGRAM_DEFAULTS.x_ticks,
      y_ticks: y_axis.ticks ?? PHASE_DIAGRAM_DEFAULTS.y_ticks,
    }),
    PHASE_DIAGRAM_DEFAULTS,
  )
</script>

<ControlPane
  bind:controls_open
  controls_name="phase-diagram"
  toggle_style=""
  toggle_title="Phase diagram"
  {...rest}
>
  <h4 style="margin: 0 0 8pt 0">{title}</h4>

  {@render children?.({ controls_open })}

  <SettingsGroup title="Diagram" open>
    <SettingsSection
      title="Visibility"
      changed_keys={[
        ...visibility_settings.changed_keys,
        ...(overlay_idxs.some((idx) => hidden_overlays.has(idx)) ? [`hidden_overlays`] : []),
      ]}
      on_reset={() => {
        hidden_overlays = new Set()
        ;({
          show_boundaries,
          show_labels,
          show_special_points,
          show_grid,
          show_component_labels,
          show_observations,
          show_uncertainty,
          show_disagreement,
          lens,
        } = PHASE_DIAGRAM_DEFAULTS)
      }}
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
      {#if overlay_idxs.length}
        <label {@attach tooltip({ content: `Show the comparison diagrams' boundaries` })}>
          <span>Overlays</span>
          <input
            type="checkbox"
            checked={overlays_shown}
            onchange={(event) =>
              (hidden_overlays = new Set(event.currentTarget.checked ? [] : overlay_idxs))}
          />
        </label>
        <label
          {@attach tooltip({
            content: `Hatch where the first shown overlay's phase set differs`,
          })}
        >
          <span>Disagreement</span>
          <input type="checkbox" bind:checked={show_disagreement} />
        </label>
      {/if}
      {#if has_uncertainty}
        <label
          {@attach tooltip({
            content: `Show the diagram's ±1σ temperature bands and marked-point error bars`,
          })}
        >
          <span>Uncertainty</span>
          <input type="checkbox" bind:checked={show_uncertainty} />
        </label>
      {/if}
      <label {@attach tooltip({ content: `Magnifier following the pointer (key m)` })}>
        <span>Lens</span>
        <input type="checkbox" bind:checked={lens} />
      </label>
      {#if has_observations}
        <label {@attach tooltip({ content: `Show experimental observations` })}>
          <span>Observations</span>
          <input type="checkbox" bind:checked={show_observations} />
        </label>
      {/if}
    </SettingsSection>

    <SettingsSection
      title="Units"
      changed_keys={units_settings.changed_keys}
      on_reset={() => ({ temp_unit, comp_unit } = PHASE_DIAGRAM_DEFAULTS)}
      layout="grid"
    >
      <label {@attach tooltip({ content: `Temperature display unit (data is in K)` })}>
        <span>Temperature</span>
        <select bind:value={temp_unit} data-testid="temp-unit">
          {#each temp_units as unit (unit)}<option value={unit}>{unit}</option>{/each}
        </select>
      </label>
      <label {@attach tooltip({ content: `Composition display (data is mole fraction)` })}>
        <span>Composition</span>
        <select bind:value={comp_unit} data-testid="comp-unit">
          {#each comp_units as [unit, label] (unit)}<option value={unit}>{label}</option
            >{/each}
        </select>
      </label>
    </SettingsSection>

    <SettingsSection
      title="Appearance"
      changed_keys={appearance_settings.changed_keys}
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
      [`overlay`, `#e6007e`, `Overlay`, `Color of the comparison diagram's boundaries`],
      [`special_point`, `#d32f2f`, `Special pts`, `Color of special point markers`],
      [`axis`, `#333333`, `Axis`, `Color of axis lines`],
      [`text`, `#333333`, `Text`, `Color of text labels`],
    ] as const}
    <SettingsSection
      title="Colors"
      changed_keys={colors_settings.changed_keys}
      on_reset={() => (config = { ...config, colors: { ...PHASE_DIAGRAM_DEFAULTS.colors } })}
      layout="grid"
    >
      {#each color_options as [key, fallback, label, tip] (key)}
        <ColorInput
          {label}
          title={tip}
          value={css_color_to_hex(merged_config.colors[key], fallback)}
          labels={{ picker: label, hex: `${label} hex` }}
          on_commit={(color) => update_nested(`colors`, key, color)}
        />
      {/each}
    </SettingsSection>
  </SettingsGroup>

  <SettingsGroup title="Interaction" open>
    <SettingsSection
      title="Tie-line display"
      changed_keys={tie_line_display_settings.changed_keys}
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
      changed_keys={axes_settings.changed_keys}
      on_reset={() => {
        x_axis = { ...x_axis, ticks: PHASE_DIAGRAM_DEFAULTS.x_ticks }
        y_axis = { ...y_axis, ticks: PHASE_DIAGRAM_DEFAULTS.y_ticks }
      }}
      layout="grid"
    >
      {#each axis_configs as [axis_cfg, axis_name, unit, desc] (axis_name)}
        <!-- drafts below 2 or above 15 wait for the next keystroke instead of being clamped and
          rewritten mid-typing (typing 12 used to give 15: the 1 became 2, then 22) -->
        <NumberRangeInput
          min={2}
          max={15}
          step={1}
          title="Ticks on {desc} axis ({unit})"
          bind:value={
            () =>
              typeof axis_cfg.ticks === `number`
                ? axis_cfg.ticks
                : PHASE_DIAGRAM_DEFAULTS[`${axis_name}_ticks`],
            (ticks) => {
              // empty="retain" (the default) never commits a cleared field
              if (ticks === undefined) throw new Error(`${axis_name}-axis ticks cleared`)
              const axis = { ticks: Math.round(ticks) }
              if (axis_name === `x`) x_axis = { ...x_axis, ...axis }
              else y_axis = { ...y_axis, ...axis }
            }
          }>{axis_name.toUpperCase()}-axis ticks</NumberRangeInput
        >
      {/each}
    </SettingsSection>
  </SettingsGroup>
</ControlPane>

<style>
  :global(.phase-diagram-controls-pane) {
    font-size: 0.85em;
    max-width: 320px;
    --ctrl-label-w: 8.5em;
    --ctrl-value-w: 5.5em;
  }
  :global(.phase-diagram-controls-pane h4) {
    margin: 6pt 0 2pt !important;
  }
  :global(.phase-diagram-controls-pane h4:first-of-type) {
    margin-top: 0 !important;
  }
</style>
