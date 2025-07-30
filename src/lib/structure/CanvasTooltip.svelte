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
    border-radius: var(--struct-tooltip-border-radius, 5pt);
    background: var(--struct-tooltip-bg, rgba(0, 0, 0, 0.5));
    padding: var(--struct-tooltip-padding, 1pt 5pt);
    color: var(--struct-tooltip-text-color);
    font-family: var(--struct-tooltip-font-family);
    font-size: var(--struct-tooltip-font-size);
    line-height: var(--struct-tooltip-line-height);
    pointer-events: none;
  }
</style>
