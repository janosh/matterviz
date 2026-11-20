<script lang="ts">
  import type { PlacedDecoration } from '#lib/plot/core/placed-decoration.svelte.js'
  import type { PlotAnnotation } from '#lib/plot/core/types.js'

  // Solver-placed wrapper around a plot's free annotation (text or snippet)
  let {
    decoration,
    annotation,
    height,
    width,
    fullscreen,
  }: {
    decoration: PlacedDecoration
    annotation: PlotAnnotation
    height: number
    width: number
    fullscreen: boolean
  } = $props()
</script>

<div
  bind:this={decoration.element}
  class="plot-annotation"
  {...decoration.data_attrs}
  style={decoration.style}
  class:text={typeof annotation === `string`}
>
  {#if typeof annotation === `string`}
    {annotation}
  {:else}
    {@render annotation({ height, width, fullscreen })}
  {/if}
</div>

<style>
  .plot-annotation {
    pointer-events: none;
    position: absolute;
    width: max-content;
  }
  /* plain text gets a readable box over the data; snippets style their own */
  .plot-annotation.text {
    white-space: pre-line;
    padding: 3pt 6pt;
    border-radius: 4pt;
    background: color-mix(in srgb, var(--plot-legend-bg-color, Canvas) 85%, transparent);
    font-size: var(--plot-annotation-font-size, 0.9em);
  }
</style>
