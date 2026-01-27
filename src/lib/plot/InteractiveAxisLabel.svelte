<script lang="ts">
  import Spinner from '$lib/feedback/Spinner.svelte'
  import PortalSelect from './PortalSelect.svelte'
  import type { AxisOption } from './types'

  let {
    label = ``,
    options = undefined,
    selected_key = $bindable(),
    loading = $bindable(false),
    axis_type = `x`,
    color = $bindable(),
    on_select,
    ...rest
  }: {
    label?: string
    options?: AxisOption[]
    selected_key?: string
    loading?: boolean
    axis_type?: `x` | `y` | `y2`
    color?: string | null
    on_select?: (key: string) => void
    [key: string]: unknown
  } = $props()

  let is_interactive = $derived(Boolean(options?.length))

  const stop = (evt: Event) => evt.stopPropagation()
  // Only stop propagation for keys the dropdown handles, allow Tab/Escape for navigation
  const stop_key = (evt: KeyboardEvent) => {
    if (![`Tab`, `Escape`].includes(evt.key)) evt.stopPropagation()
  }
</script>

<div
  class:interactive={is_interactive}
  class:loading
  style:color
  onmousedown={stop}
  onmouseup={stop}
  onclick={stop}
  onkeydown={stop_key}
  role="group"
  {...rest}
  class="interactive-axis-label {axis_type} {rest.class ?? ``}"
>
  {#if is_interactive && options}
    <PortalSelect
      {options}
      bind:selected_key
      {on_select}
      disabled={loading}
      class="axis-trigger"
    />
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
    justify-content: center;
    width: 100%;
    height: 100%;
  }
  .static-label {
    display: inline-flex;
    align-items: baseline;
    gap: 0.2em;
  }
  .loading :global(.axis-trigger) {
    opacity: 0.7;
    pointer-events: none;
  }
  .interactive-axis-label :global(:is(sub, sup)) {
    font-size: 0.75em;
    line-height: 0;
  }
  .interactive-axis-label :global(sub) {
    vertical-align: sub;
  }
  .interactive-axis-label :global(sup) {
    vertical-align: super;
  }
</style>
