<script lang="ts">
  import Spinner from '$lib/feedback/Spinner.svelte'
  import type { AxisOption } from './types'

  let {
    label = ``,
    options = undefined,
    selected_key = $bindable(),
    loading = $bindable(false),
    axis_type = `x`,
    color = $bindable(),
    on_select,
    class: class_name = ``,
    ...rest
  }: {
    label?: string
    options?: AxisOption[]
    selected_key?: string
    loading?: boolean
    axis_type?: `x` | `y` | `y2`
    color?: string | null
    on_select?: (key: string) => void
    class?: string
    [key: string]: unknown
  } = $props()

  // Check if interactive (has options)
  let is_interactive = $derived(options && options.length > 0)

  // Handle selection change from native select
  function handle_change(event: Event) {
    const target = event.target as HTMLSelectElement
    const new_key = target.value
    if (new_key && new_key !== selected_key) {
      selected_key = new_key
      on_select?.(new_key)
    }
  }

  // Format option for display
  function format_option(key: string): string {
    const option = options?.find((opt) => opt.key === key)
    if (!option) return key
    return option.unit ? `${option.label} (${option.unit})` : option.label
  }

  // Stop event propagation to prevent plot drag handlers
  function stop_propagation(event: MouseEvent) {
    event.stopPropagation()
  }
</script>

<!-- Stop all mouse events from bubbling to plot -->
<div
  class="interactive-axis-label {axis_type} {class_name}"
  class:interactive={is_interactive}
  class:loading
  style:color
  onmousedown={stop_propagation}
  onmouseup={stop_propagation}
  onclick={stop_propagation}
  {...rest}
>
  {#if is_interactive && options}
    <select
      class="axis-select {axis_type}"
      value={selected_key ?? ``}
      onchange={handle_change}
      disabled={loading}
    >
      {#each options as opt (opt.key)}
        <option value={opt.key}>{format_option(opt.key)}</option>
      {/each}
    </select>
    {#if loading}
      <Spinner
        style="--spinner-size: 0.9em; --spinner-border-width: 2px; --spinner-margin: 0 0 0 0.3em"
      />
    {/if}
  {:else}
    <!-- Static label (no options) -->
    <span class="static-label">{@html label}</span>
  {/if}
</div>

<style>
  .interactive-axis-label {
    position: relative;
    display: inline-flex;
    align-items: center;
    text-align: center;
    width: 100%;
    height: 100%;
    justify-content: center;
  }
  .static-label {
    display: inline-flex;
    align-items: center;
    gap: 0.2em;
  }
  .loading .axis-select {
    opacity: 0.7;
    pointer-events: none;
  }
  /* Style the native select to look like an axis label */
  .axis-select {
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    background: transparent;
    border: none;
    border-radius: 3px;
    padding: 2px 16px 2px 4px;
    font: inherit;
    color: inherit;
    cursor: pointer;
    text-align: center;
    text-align-last: center;
    /* Add dropdown arrow */
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23666' d='M3 4.5L6 8l3-3.5H3z'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 2px center;
    background-size: 12px;
  }
  .axis-select:hover {
    background-color: var(--surface-bg-hover, rgba(128, 128, 128, 0.15));
  }
  .axis-select:focus {
    outline: 2px solid var(--focus-color, #4a90d9);
    outline-offset: 1px;
  }
  .axis-select option {
    background: var(--surface-bg, white);
    color: var(--text-color, black);
    padding: 4px 8px;
  }
</style>
