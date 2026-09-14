<script lang="ts">
  import ExportDestination from '$lib/io/ExportDestination.svelte'
  import { FileExportState, type FileExportContext } from '$lib/io/file-export.svelte'

  import { track_settings } from '$lib/controls'
  import type { ShowControlsProp } from '$lib/controls'
  import { NumberRangeInput, SettingsSection } from '$lib/layout'
  import { ControlPane } from '$lib/overlays'
  import type { ChartExportFormat } from '$lib/plot/core/utils/chart-export'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  const EXPORT_FORMATS: ChartExportFormat[] = [`png`, `svg`, `csv`]
  // single source for the initial values and what Reset restores
  const GRID_DEFAULTS = { grid_step: 0.1, show_grid: true, show_ticks: true }

  let {
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    grid_step = $bindable(GRID_DEFAULTS.grid_step),
    show_grid = $bindable(GRID_DEFAULTS.show_grid),
    show_ticks = $bindable(GRID_DEFAULTS.show_ticks),
    on_export,
    toggle_props = {},
    pane_props = {},
    children,
  }: {
    show_controls?: ShowControlsProp<`controls` | `fullscreen`>
    controls_open?: boolean
    grid_step?: number
    show_grid?: boolean
    show_ticks?: boolean
    on_export?: (format: ChartExportFormat, context: FileExportContext) => void | Promise<void>
    toggle_props?: HTMLAttributes<HTMLButtonElement>
    pane_props?: HTMLAttributes<HTMLDivElement>
    children?: Snippet
  } = $props()

  const export_state = new FileExportState(() => `ternary`)
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
  {#if on_export}
    <ExportDestination state={export_state} />
    <SettingsSection title="Export" layout="flow">
      {#each EXPORT_FORMATS as format (format)}
        <button
          type="button"
          style="padding: 2pt 8pt; cursor: pointer"
          disabled={export_state.busy || Boolean(export_state.filename_error)}
          onclick={() => export_state.run((context) => on_export?.(format, context))}
        >
          {format.toUpperCase()}
        </button>
      {/each}
    </SettingsSection>
  {/if}
</ControlPane>
