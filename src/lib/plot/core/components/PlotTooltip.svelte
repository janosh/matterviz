<script lang="ts">
  import { contrast_text_color, resolve_backdrop, resolve_computed_color } from '$lib/colors'
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

  const measured_or_fallback = (measured?: number, fallback?: number): number =>
    measured && measured > 0 ? measured : (fallback ?? 0)

  // For fixed positioning (viewport coords), flip to opposite side when near viewport edges
  const pos = $derived.by(() => {
    const tooltip_width = measured_or_fallback(wrapper?.offsetWidth, fallback_size?.width)
    const tooltip_height = measured_or_fallback(wrapper?.offsetHeight, fallback_size?.height)
    const bounds =
      constrain_to ??
      (fixed ? { width: globalThis.innerWidth, height: globalThis.innerHeight } : undefined)
    if (exclusion_rects && exclusion_rects.length > 0 && bounds) {
      return place_tooltip({
        anchor: { x, y },
        tooltip_size: { width: tooltip_width, height: tooltip_height },
        bounds: { x: 0, y: 0, ...bounds },
        exclusion_rects,
        offset,
      })
    }
    if (constrain_to) {
      return constrain_tooltip_position(
        x,
        y,
        tooltip_width,
        tooltip_height,
        constrain_to.width,
        constrain_to.height,
        { offset_x: offset.x, offset_y: offset.y },
      )
    }
    const raw_x = x + offset.x
    const raw_y = y + offset.y
    if (!bounds) return { x: raw_x, y: raw_y }
    const constrained_x =
      raw_x + tooltip_width > bounds.width ? x - Math.abs(offset.x) - tooltip_width : raw_x
    const constrained_y =
      raw_y + tooltip_height > bounds.height ? y - Math.abs(offset.y) - tooltip_height : raw_y
    return { x: Math.max(0, constrained_x), y: Math.max(0, constrained_y) }
  })

  // Position flipping alone cannot keep a nowrap chip inside a small plot when the
  // label path is long — cap width to the constrained box and let the text wrap.
  const max_width = $derived(constrain_to ? Math.max(0, constrain_to.width - 16) : undefined)
  const backdrop = resolve_backdrop(() => wrapper)
  const rendered_bg = resolve_computed_color(
    () => (bg_color == null ? undefined : wrapper),
    `background-color`,
    { fallback: () => bg_color ?? backdrop.current },
  )
  const text_color = $derived(
    bg_color == null
      ? undefined
      : contrast_text_color({
          background: rendered_bg.current,
          backdrop: backdrop.current,
          choices: [`#000000`, `#ffffff`],
        }),
  )
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
