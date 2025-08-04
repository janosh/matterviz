<script lang="ts">
  import type { Vec3 } from '$lib/math'
    import { HTML } from '@threlte/extras'
    import type { Snippet } from 'svelte'

    interface Props {
      position: Vec3
      children: Snippet
      [key: string]: unknown
    }
    let { position, children, ...rest }: Props = $props()
</script>

<HTML {position} pointerEvents="none">
  <div {...rest} class="tooltip {rest.class ?? ``}">
    {@render children()}
  </div>
</HTML>

<style>
  .tooltip {
    width: max-content;
    box-sizing: border-box;
    text-align: var(--canvas-tooltip-text-align, left);
    border-radius: var(--canvas-tooltip-border-radius, 5pt);
    background: var(--canvas-tooltip-bg, rgba(0, 0, 0, 0.5));
    padding: var(--canvas-tooltip-padding, 1pt 5pt);
    color: var(--canvas-tooltip-text-color);
    font-family: var(--canvas-tooltip-font-family);
    font-size: var(--canvas-tooltip-font-size);
    line-height: var(--canvas-tooltip-line-height);
    pointer-events: none;
  }
</style>
