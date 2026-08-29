<script lang="ts">
  import { contrast_text_color, resolve_backdrop, resolve_computed_color } from '$lib/colors'
  import { DEFAULT_CURSOR_SIZE, place_tooltip } from '$lib/plot/core/decorations/tooltip'
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
    exclusion_rects = [],
    avoid_cursor = true,
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
    // Keep the pointer glyph clear too, widening a narrower `offset.x` to its width
    // (keeping the sign). On by default because most tooltips track the cursor; pass
    // false when `x`/`y` snap to a mark instead, so no glyph sits on the anchor.
    avoid_cursor?: boolean
    fallback_size?: { width: number; height: number } // size estimate before first measure
    wrapper?: HTMLDivElement // bindable reference for measuring tooltip size
    children: Snippet
  } = $props()

  // Measured on mount and whenever content changes size, so flips never use a stale box
  let measured_width = $state(0)
  let measured_height = $state(0)
  const measure = (node: HTMLElement) => {
    const update = () => {
      measured_width = node.offsetWidth
      measured_height = node.offsetHeight
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
      width: measured_width || fallback_size?.width || 0,
      height: measured_height || fallback_size?.height || 0,
    }
    // The glyph is just another rect to keep clear of — except that a gap narrower
    // than its width leaves the right-hand candidates overlapping it from the start,
    // so the scoring has nothing to tell them apart by. Widen to its width, keeping
    // the sign that picks the preferred side; the left side is clear at any gap but
    // matches so a flip keeps its distance.
    const gap = Math.max(Math.abs(offset.x), DEFAULT_CURSOR_SIZE.width)
    return place_tooltip({
      anchor: { x, y },
      tooltip_size,
      bounds: { x: 0, y: 0, ...bounds },
      exclusion_rects: avoid_cursor
        ? [...exclusion_rects, { x, y, ...DEFAULT_CURSOR_SIZE }]
        : exclusion_rects,
      offset: avoid_cursor ? { x: offset.x >= 0 ? gap : -gap, y: offset.y } : offset,
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
  style:position={fixed ? `fixed` : `absolute`}
  style:left="{pos.x}px"
  style:top="{pos.y}px"
  style="pointer-events: none; {rest.style ?? ``}"
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
