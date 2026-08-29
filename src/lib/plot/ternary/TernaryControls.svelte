<script lang="ts">
  import { NumberRangeInput, SettingsSection } from '$lib/layout'
  import { ControlPane } from '$lib/overlays'
  import type { ChartExportFormat } from '$lib/plot/core/utils/chart-export'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  const EXPORT_FORMATS: ChartExportFormat[] = [`png`, `svg`, `csv`]

  let {
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    grid_step = $bindable(0.1),
    show_grid = $bindable(true),
    show_ticks = $bindable(true),
    on_export,
    toggle_props = {},
    pane_props = {},
    children,
  }: {
    show_controls?: boolean
    controls_open?: boolean
    grid_step?: number
    show_grid?: boolean
    show_ticks?: boolean
    on_export?: (format: ChartExportFormat) => void
    toggle_props?: HTMLAttributes<HTMLButtonElement>
    pane_props?: HTMLAttributes<HTMLDivElement>
    children?: Snippet
  } = $props()
</script>

{#if show_controls}
  <ControlPane bind:controls_open controls_name="ternary" {toggle_props} {pane_props}>
    {@render children?.()}
    <SettingsSection
      title="Grid"
      current_values={{ grid_step, show_grid, show_ticks }}
      on_reset={() => {
        grid_step = 0.1
        show_grid = true
        show_ticks = true
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
      <SettingsSection title="Export" layout="flow">
        {#each EXPORT_FORMATS as format (format)}
          <button
            type="button"
            style="padding: 2pt 8pt; cursor: pointer"
            onclick={() => on_export?.(format)}
          >
            {format.toUpperCase()}
          </button>
        {/each}
      </SettingsSection>
    {/if}
  </ControlPane>
{/if}
