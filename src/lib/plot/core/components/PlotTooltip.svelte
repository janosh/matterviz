<script lang="ts">
  import { luminance } from '$lib/colors'
  import { place_tooltip } from '$lib/plot/core/decorations/tooltip'
  import { constrain_tooltip_position } from '$lib/plot/core/layout'
  import type { Rect } from '$lib/plot/core/layout'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    x,
    y,
    bg_color,
    offset = { x: 6, y: 0 },
    fixed = false,
    constrain_to,
    exclusion_rects,
    fallback_size,
    wrapper = $bindable(),
    children,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    x: number
    y: number
    bg_color?: string | null
    offset?: { x: number; y: number }
    fixed?: boolean // Use position: fixed (for viewport coords) vs absolute
    constrain_to?: { width: number; height: number } // flip/clamp within these bounds (offset consumed by constraining)
    exclusion_rects?: readonly Rect[] // Decorations to avoid; absolute mode also needs constrain_to
    fallback_size?: { width: number; height: number } // size estimate before first measure
    wrapper?: HTMLDivElement // Bindable reference for measuring tooltip size
    children: Snippet
  } = $props()

  // Auto-compute contrasting text color based on background luminance only if bg_color is defined
  const text_color = $derived(
    bg_color != null ? (luminance(bg_color) > 0.5 ? `#000000` : `#ffffff`) : null,
  )

  // For fixed positioning (viewport coords), flip to opposite side when near viewport edges
  const pos = $derived.by(() => {
    const exclusion_bounds = constrain_to
      ? { x: 0, y: 0, width: constrain_to.width, height: constrain_to.height }
      : fixed
        ? { x: 0, y: 0, width: globalThis.innerWidth, height: globalThis.innerHeight }
        : undefined
    if (exclusion_rects && exclusion_bounds) {
      const measured_width = wrapper?.offsetWidth ?? 0
      const measured_height = wrapper?.offsetHeight ?? 0
      return place_tooltip({
        anchor: { x, y },
        tooltip_size: {
          width: measured_width > 0 ? measured_width : (fallback_size?.width ?? 0),
          height: measured_height > 0 ? measured_height : (fallback_size?.height ?? 0),
        },
        bounds: exclusion_bounds,
        exclusion_rects,
        offset,
      })
    }
    if (constrain_to) {
      return constrain_tooltip_position(
        x,
        y,
        wrapper?.offsetWidth ?? fallback_size?.width ?? 0,
        wrapper?.offsetHeight ?? fallback_size?.height ?? 0,
        constrain_to.width,
        constrain_to.height,
        { offset_x: offset.x, offset_y: offset.y },
      )
    }
    const raw_x = x + offset.x
    const raw_y = y + offset.y
    if (!fixed) return { x: raw_x, y: raw_y }
    const tw = wrapper?.offsetWidth ?? 0
    const th = wrapper?.offsetHeight ?? 0
    const cx = raw_x + tw > globalThis.innerWidth ? x - Math.abs(offset.x) - tw : raw_x
    const cy = raw_y + th > globalThis.innerHeight ? y - Math.abs(offset.y) - th : raw_y
    return { x: Math.max(0, cx), y: Math.max(0, cy) }
  })

  // Position flipping alone cannot keep a nowrap chip inside a small plot when the
  // label path is long — cap width to the constrained box and let the text wrap.
  const max_width = $derived(constrain_to ? Math.max(0, constrain_to.width - 16) : undefined)
  const style = $derived(
    `position: ${fixed ? `fixed` : `absolute`}; pointer-events: none;
    left: ${pos.x}px; top: ${pos.y}px; ${rest.style ?? ``}`,
  )
</script>

<div
  {...rest}
  class={[`plot-tooltip`, max_width != null && `plot-tooltip-wrap`, rest.class]}
  style:background-color={bg_color}
  style:color={text_color}
  style:max-width={max_width != null ? `${max_width}px` : undefined}
  {style}
  bind:this={wrapper}
>
  {@render children()}
</div>

<style>
  .plot-tooltip {
    box-sizing: border-box;
    padding: var(--plot-tooltip-padding, 2px 6px);
    border-radius: var(--plot-tooltip-border-radius, 4px);
    font-size: var(--plot-tooltip-font-size, 0.8em);
    white-space: nowrap;
    z-index: var(--plot-tooltip-z-index, 1000);
  }
  .plot-tooltip-wrap {
    white-space: normal;
    overflow-wrap: break-word; /* mid-token only when that token alone exceeds the line */
  }
</style>
