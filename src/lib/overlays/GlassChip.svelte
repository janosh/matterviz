<!-- Small text overlay with a frosted-glass backdrop, for annotating visual
  content (3D structure viewers, plots) without fully obscuring it. Shared by
  StructurePopup's stats block and StructureCarousel's card headers so both
  render identically. Position/size via --glass-chip-* custom properties. -->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  let { children, ...rest }: HTMLAttributes<HTMLDivElement> & { children: Snippet } = $props()
</script>

<div {...rest} class={[`glass-chip`, rest.class]}>
  {@render children()}
</div>

<style>
  .glass-chip {
    position: absolute;
    top: var(--glass-chip-top, 10px);
    left: var(--glass-chip-left, 10px);
    z-index: var(--glass-chip-z, var(--z-index-viewer-chip, 2));
    /* own compositing layer, or WKWebView paints the canvas over this (see app.css) */
    will-change: transform;
    max-width: var(--glass-chip-max-width, calc(100% - 20px));
    padding: 4px 8px;
    border-radius: 6px;
    background: var(--glass-chip-bg, transparent);
    backdrop-filter: blur(8px);
    color: var(--text-color);
    font-size: var(--glass-chip-font-size, 0.85em);
  }
</style>
