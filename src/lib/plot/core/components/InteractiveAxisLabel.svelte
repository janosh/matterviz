<script lang="ts">
  import Spinner from '$lib/feedback/Spinner.svelte'
  import { sanitize_html } from '$lib/sanitize'
  import PortalSelect from '$lib/plot/core/components/PortalSelect.svelte'
  import type { AxisTitleSegment } from '$lib/plot/core/layout'
  import type { AxisOption } from '$lib/plot/core/types'

  let {
    label = ``,
    options = undefined,
    selected_key = $bindable(),
    loading = $bindable(false),
    axis_type = `x`,
    color = $bindable(),
    on_select,
    line_segments,
    ...rest
  }: {
    label?: string
    options?: AxisOption[]
    selected_key?: string
    loading?: boolean
    axis_type?: `x` | `x2` | `y` | `y2`
    color?: string | null
    on_select?: (key: string) => void
    // Pre-wrapped semantic spans matching the metrics used by plot padding.
    line_segments?: readonly (readonly AxisTitleSegment[])[]
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
  class={[`interactive-axis-label`, axis_type, rest.class]}
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
    <span class="static-label">
      {#if line_segments && line_segments.length > 1}
        {#each line_segments as segments}
          <span>
            {#each segments as segment}
              {#if segment.shift === `sub`}
                <sub>{segment.text}</sub>
              {:else if segment.shift === `super`}
                <sup>{segment.text}</sup>
              {:else}
                {segment.text}
              {/if}
            {/each}
          </span>
        {/each}
      {:else}
        {@html sanitize_html(label)}
      {/if}
    </span>
  {/if}
</div>

<style>
  .interactive-axis-label {
    position: relative;
    /* A block flex root avoids inline-flex's baseline shift outside the SVG foreignObject. */
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    pointer-events: none;
    white-space: normal;
  }
  .interactive-axis-label :global(.axis-trigger) {
    pointer-events: auto;
  }
  .static-label {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    /* The layout already wrapped lines; prevent a second browser wrap. */
    white-space: nowrap;
    width: 100%;
  }
  .loading :global(.axis-trigger) {
    opacity: 0.7;
    pointer-events: none;
  }
  .interactive-axis-label :global(:is(sub, sup)) {
    font-size: 0.75em;
    line-height: 0;
    /* vertical-align is ignored in the flex label wrapper. */
    position: relative;
    vertical-align: baseline;
  }
  .interactive-axis-label :global(sub) {
    top: 0.35em;
  }
  .interactive-axis-label :global(sup) {
    top: -0.5em;
  }
</style>
