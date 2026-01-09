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

  let is_interactive = $derived(Boolean(options?.length))

  function handle_change(event: Event) {
    const new_key = (event.target as HTMLSelectElement).value
    if (new_key && new_key !== selected_key) {
      selected_key = new_key
      on_select?.(new_key)
    }
  }

  // Format option for display: "Label (unit)" or just "Label"
  const format_opt = (opt: { label: string; unit?: string }) =>
    opt.unit ? `${opt.label} (${opt.unit})` : opt.label
</script>

<div
  class="interactive-axis-label {axis_type} {class_name}"
  class:interactive={is_interactive}
  class:loading
  style:color
  onmousedown={(evt) => evt.stopPropagation()}
  onmouseup={(evt) => evt.stopPropagation()}
  onclick={(evt) => evt.stopPropagation()}
  {...rest}
>
  {#if is_interactive && options}
    <select
      class="axis-select"
      value={selected_key ?? options[0]?.key ?? ``}
      onchange={handle_change}
      disabled={loading}
      aria-label="Select {axis_type}-axis property"
    >
      {#each options as opt (opt.key)}
        <option value={opt.key}>{format_opt(opt)}</option>
      {/each}
    </select>
    {#if loading}
      <Spinner
        style="--spinner-size: 0.9em; --spinner-border-width: 2px; --spinner-margin: 0 0 0 0.3em"
      />
    {/if}
  {:else}
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
