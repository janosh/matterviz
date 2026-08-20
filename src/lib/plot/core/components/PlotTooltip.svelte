<script lang="ts">
  import { contrast_text_color, resolve_backdrop, resolve_computed_color } from '$lib/colors'
  import { place_tooltip } from '$lib/plot/core/decorations/tooltip'
  import type { Rect } from '$lib/plot/core/layout'
  import { type Snippet, untrack } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    x,
    y,
    bg_color,
    offset = { x: 6, y: 0 },
    fixed = false,
    constrain_to,
    exclusion_rects = [],
    fallback_size,
    wrapper = $bindable(),
    children,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    x: number
    y: number
    bg_color?: string | null
    // Signed gap from the anchor; the sign picks the preferred side (right/below for positive)
    offset?: { x: number; y: number }
    fixed?: boolean // position: fixed for viewport coords (absolute otherwise)
    // Flip/clamp inside this box (defaults to the viewport when `fixed`); omit for raw placement
    constrain_to?: { width: number; height: number }
    exclusion_rects?: readonly Rect[] // decorations (legend, colorbar) to keep clear of
    fallback_size?: { width: number; height: number } // size estimate before first measure
    wrapper?: HTMLDivElement // bindable reference for measuring tooltip size
    children: Snippet
  } = $props()

  // Measured on mount and whenever content changes size, so flips never use a stale box
  let measured = $state.raw({ width: 0, height: 0 })
  const measure = (node: HTMLElement) => {
    const update = () => {
      const { offsetWidth: width, offsetHeight: height } = node
      // plain comparison (no reactive read) so the attachment doesn't re-run on each measure
      const last = untrack(() => measured)
      if (width !== last.width || height !== last.height) measured = { width, height }
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }

  const pos = $derived.by(() => {
    const bounds =
      constrain_to ??
      (fixed ? { width: globalThis.innerWidth, height: globalThis.innerHeight } : undefined)
    if (!bounds) return { x: x + offset.x, y: y + offset.y }
    const tooltip_size = {
      width: measured.width || fallback_size?.width || 0,
      height: measured.height || fallback_size?.height || 0,
    }
    return place_tooltip({
      anchor: { x, y },
      tooltip_size,
      bounds: { x: 0, y: 0, ...bounds },
      exclusion_rects,
      offset,
    })
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
      : contrast_text_color({ background: rendered_bg.current, backdrop: backdrop.current }),
  )
</script>

<div
  {...rest}
  class={[`plot-tooltip`, max_width != null && `plot-tooltip-wrap`, rest.class]}
  style:background-color={bg_color}
  style:color={text_color}
  style:max-width={max_width != null ? `${max_width}px` : undefined}
  style="position: {fixed
    ? `fixed`
    : `absolute`}; pointer-events: none; left: {pos.x}px; top: {pos.y}px; {rest.style ?? ``}"
  bind:this={wrapper}
  {@attach measure}
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
