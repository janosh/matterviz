<script module lang="ts">
  // Single source for the initial values (here and in TernaryPlot) and what Reset restores
  export const GRID_DEFAULTS = { grid_step: 0.1, show_grid: true, show_ticks: true }
</script>

<script lang="ts">
  import { track_settings } from '#lib/controls.js'
  import type { ShowControlsProp } from '#lib/controls.js'
  import { NumberRangeInput, SettingsSection } from '#lib/layout/index.js'
  import { ControlPane } from '#lib/overlays/index.js'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    show_controls = true,
    controls_open = $bindable(false),
    grid_step = $bindable(GRID_DEFAULTS.grid_step),
    show_grid = $bindable(GRID_DEFAULTS.show_grid),
    show_ticks = $bindable(GRID_DEFAULTS.show_ticks),
    toggle_props = {},
    pane_props = {},
    children,
  }: {
    show_controls?: ShowControlsProp<`controls` | `fullscreen`>
    controls_open?: boolean
    grid_step?: number
    show_grid?: boolean
    show_ticks?: boolean
    toggle_props?: HTMLAttributes<HTMLButtonElement>
    pane_props?: HTMLAttributes<HTMLDivElement>
    children?: Snippet
  } = $props()

  const grid_settings = track_settings(
    () => ({ grid_step, show_grid, show_ticks }),
    GRID_DEFAULTS,
  )
</script>

<ControlPane
  {show_controls}
  bind:controls_open
  controls_name="ternary"
  {toggle_props}
  {pane_props}
>
  {@render children?.()}
  <SettingsSection
    title="Grid"
    changed_keys={grid_settings.changed_keys}
    on_reset={() => {
      ;({ grid_step, show_grid, show_ticks } = GRID_DEFAULTS)
    }}
    layout="grid"
  >
    <NumberRangeInput min={0.05} max={0.5} step={0.05} bind:value={grid_step}
      >Grid step</NumberRangeInput
    >
    <label>
      <span>Show grid</span>
      <input type="checkbox" bind:checked={show_grid} />
    </label>
    <label>
      <span>Show ticks</span>
      <input type="checkbox" bind:checked={show_ticks} />
    </label>
  </SettingsSection>
</ControlPane>
