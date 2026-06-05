<script lang="ts">
  import { luminance } from '$lib/colors'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    x,
    y,
    bg_color,
    offset = { x: 6, y: 0 },
    fixed = false,
    wrapper = $bindable(),
    children,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    x: number
    y: number
    bg_color?: string | null
    offset?: { x: number; y: number }
    fixed?: boolean // Use position: fixed (for viewport coords) vs absolute
    wrapper?: HTMLDivElement // Bindable reference for measuring tooltip size
    children: Snippet
  } = $props()

  // Auto-compute contrasting text color based on background luminance only if bg_color is defined
  const text_color = $derived(
    bg_color != null ? (luminance(bg_color) > 0.5 ? `#000000` : `#ffffff`) : null,
  )

  // For fixed positioning (viewport coords), flip to opposite side when near viewport edges
  const pos = $derived.by(() => {
    const raw_x = x + offset.x
    const raw_y = y + offset.y
    if (!fixed) return { x: raw_x, y: raw_y }
    const tw = wrapper?.offsetWidth ?? 0
    const th = wrapper?.offsetHeight ?? 0
    const cx = raw_x + tw > globalThis.innerWidth ? x - Math.abs(offset.x) - tw : raw_x
    const cy = raw_y + th > globalThis.innerHeight ? y - Math.abs(offset.y) - th : raw_y
    return { x: Math.max(0, cx), y: Math.max(0, cy) }
  })

  const style = $derived(
    `position: ${fixed ? `fixed` : `absolute`}; pointer-events: none;
    left: ${pos.x}px; top: ${pos.y}px; ${rest.style ?? ``}`,
  )
</script>

<div
  {...rest}
  class="plot-tooltip {rest.class ?? ``}"
  style:background-color={bg_color}
  style:color={text_color}
  {style}
  bind:this={wrapper}
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
