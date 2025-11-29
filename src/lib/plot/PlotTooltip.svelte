<script lang="ts">
  import { luminance } from '$lib/colors'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  let { x, y, bg_color, offset = { x: 6, y: 0 }, fixed = false, children, ...rest }:
    & HTMLAttributes<HTMLDivElement>
    & {
      x: number
      y: number
      bg_color?: string | null
      offset?: { x: number; y: number }
      fixed?: boolean // Use position: fixed (for viewport coords) vs absolute
      children: Snippet
    } = $props()

  // Auto-compute contrasting text color based on background luminance only if bg_color is defined
  const text_color = $derived(
    bg_color != null ? (luminance(bg_color) > 0.5 ? `#000000` : `#ffffff`) : null,
  )
  const style = $derived(
    `position: ${fixed ? `fixed` : `absolute`}; pointer-events: none;
    left: ${x + offset.x}px; top: ${y + offset.y}px; ${rest.style ?? ``}`,
  )
</script>

<div
  {...rest}
  class="plot-tooltip {rest.class ?? ``}"
  style:background-color={bg_color}
  style:color={text_color}
  {style}
>
  {@render children()}
</div>

<style>
  .plot-tooltip {
    padding: var(--plot-tooltip-padding, 2px 6px);
    border-radius: var(--plot-tooltip-border-radius, 4px);
    font-size: var(--plot-tooltip-font-size, 0.8em);
    white-space: nowrap;
    z-index: var(--plot-tooltip-z-index, 1000);
  }
</style>
