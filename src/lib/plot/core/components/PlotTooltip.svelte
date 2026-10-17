<script module lang="ts">
  // The neutral chip for marks without a usable fill, also the CSS default below
  const NEUTRAL_BG = `var(--plot-tooltip-bg, light-dark(rgba(255, 255, 255, 0.95), rgba(0, 0, 0, 0.85)))`
</script>

<script lang="ts">
  import type { TooltipPaint } from '#lib/colors/index.js'
  import { resolve_color_token, tooltip_paint, watch_css_color } from '#lib/colors/index.js'
  import { DEFAULT_CURSOR_SIZE, place_tooltip } from '#lib/plot/core/decorations/tooltip.js'
  import type { Rect } from '#lib/plot/core/layout.js'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    x: coord_x,
    y: coord_y,
    bg_color,
    offset = { x: 6, y: 0 },
    fixed = false,
    constrain_to,
    exclusion_rects = [],
    avoid_cursor = true,
    fallback_size,
    pinned = false,
    wrapper = $bindable(),
    children,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    x: number
    y: number
    bg_color?: string | null // hovered mark's fill (also translucent or var()), see tooltip_paint
    // Signed gap from the anchor; the sign picks the preferred side (right/below for positive)
    offset?: { x: number; y: number }
    fixed?: boolean // position: fixed for viewport coords (absolute otherwise)
    // Flip/clamp inside this box (defaults to the viewport when `fixed`); omit for raw placement.
    // x/y place its origin in the tooltip's coordinates (default 0, e.g. a clipping ancestor).
    constrain_to?: { x?: number; y?: number; width: number; height: number }
    exclusion_rects?: readonly Rect[] // decorations (legend, colorbar) to keep clear of
    // Keep the pointer glyph clear too, widening a narrower `offset.x` to its width (keeping
    // the sign). Pass false when `x`/`y` snap to a mark, so no glyph sits on the anchor.
    avoid_cursor?: boolean
    fallback_size?: { width: number; height: number } // size estimate before first measure
    // Pinned (see TooltipPin): takes pointer events and selectable text, so it can be copied
    pinned?: boolean
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
    const bounds: typeof constrain_to =
      constrain_to ??
      (fixed ? { width: globalThis.innerWidth, height: globalThis.innerHeight } : undefined)
    if (!bounds) return { x: coord_x + offset.x, y: coord_y + offset.y }
    const tooltip_size = {
      width: measured_width || fallback_size?.width || 0,
      height: measured_height || fallback_size?.height || 0,
    }
    // The glyph is another rect to keep clear of, but a gap narrower than its width leaves the
    // right-hand candidates overlapping it from the start, so widen to its width (keeping the
    // sign that picks the preferred side; the left side matches so a flip keeps its distance).
    const gap = Math.max(Math.abs(offset.x), DEFAULT_CURSOR_SIZE.width)
    return place_tooltip({
      anchor: { x: coord_x, y: coord_y },
      tooltip_size,
      bounds: {
        x: bounds.x ?? 0,
        y: bounds.y ?? 0,
        width: bounds.width,
        height: bounds.height,
      },
      exclusion_rects: avoid_cursor
        ? [...exclusion_rects, { x: coord_x, y: coord_y, ...DEFAULT_CURSOR_SIZE }]
        : exclusion_rects,
      offset: avoid_cursor ? { x: offset.x >= 0 ? gap : -gap, y: offset.y } : offset,
    })
  })

  // Position flipping alone cannot keep a wide chip inside a small plot, so its width is
  // capped to the constrained box and the text wraps. Callers can ask for a narrower box with
  // --plot-tooltip-max-width (16rem by default); the container still caps it. Both meet in a
  // zero-specificity rule, so a caller's own max-width still wins.
  const max_width = $derived(constrain_to ? Math.max(0, constrain_to.width - 16) : undefined)
  // A fill JS can parse is painted outright, with no DOM reads as the tooltip follows the
  // pointer. Anything else (var() fill, or none: the neutral chip) resolves through a probe
  // once per fill and theme change, watched from the parent to skip the style:left/top writes.
  const js_paint = $derived(tooltip_paint(bg_color))
  const dom_fill = $derived(js_paint ? null : (bg_color ?? NEUTRAL_BG))
  let dom_paint = $state<TooltipPaint | null>(null)
  $effect(() => {
    const [node, fill] = [wrapper, dom_fill]
    if (!node || !fill) return
    const resolve = (color: string) => tooltip_paint(resolve_color_token(node, color))
    const read = () => (dom_paint = resolve(fill) ?? resolve(NEUTRAL_BG))
    read()
    return watch_css_color(node.parentElement ?? node, read)
  })
  const paint = $derived(js_paint ?? dom_paint)
</script>

<div
  {...rest}
  class={[`plot-tooltip`, { pinned }, rest.class]}
  style:background-color={paint?.background}
  style:color={paint?.color}
  style:--plot-tooltip-cap={max_width != null ? `${max_width}px` : undefined}
  style:position={fixed ? `fixed` : `absolute`}
  style:left="{pos.x}px"
  style:top="{pos.y}px"
  style="pointer-events: {pinned ? `auto` : `none`}; {rest.style ?? ``}"
  bind:this={wrapper}
  {@attach measure}
>
  <!-- a tab on the chip's top-right edge: inside, a float squeezed full-width first rows and
  an overlay covered them, while a line of its own made the chip taller -->
  {#if pinned}<small class="pin-hint">Pinned · Esc to unpin</small>{/if}{@render children()}
</div>

<style>
  /* zero specificity: a caller's class may restyle the chip until the probe resolves */
  :where(.plot-tooltip) {
    background: var(
      --plot-tooltip-bg,
      light-dark(rgba(255, 255, 255, 0.95), rgba(0, 0, 0, 0.85))
    );
    color: var(--plot-tooltip-color, light-dark(#222, #eee));
    max-width: min(var(--plot-tooltip-max-width, 16rem), var(--plot-tooltip-cap, 100vw));
    border: var(
      --plot-tooltip-border,
      1px solid color-mix(in srgb, currentColor 18%, transparent)
    );
    box-shadow: var(--plot-tooltip-shadow, 0 4px 12px rgba(0, 0, 0, 0.15));
  }
  .plot-tooltip {
    box-sizing: border-box;
    padding: var(--plot-tooltip-padding, 3px 6px);
    border-radius: var(--plot-tooltip-border-radius, 5px);
    font-size: var(--plot-tooltip-font-size, 12px);
    line-height: var(--plot-tooltip-line-height, 1.25);
    /* never inherit a centered page or card layout */
    text-align: start;
    /* as wide as the content up to max-width, then wrap: an absolute box would otherwise
    shrink to the room left of its anchor and wrap early near the right edge */
    width: max-content;
    white-space: var(--plot-tooltip-white-space, normal);
    overflow-wrap: break-word; /* mid-token only when that token alone exceeds the line */
    z-index: var(--plot-tooltip-z-index, 1000);
  }
  .plot-tooltip.pinned {
    user-select: text;
    cursor: auto;
  }
  .pin-hint {
    position: absolute;
    bottom: 100%; /* over the chip's top border, so tab and chip join seamlessly */
    right: 6px;
    padding: 1px 5px 0;
    border: 1px solid currentColor;
    border-bottom: none;
    border-radius: 4px 4px 0 0;
    background: inherit;
    opacity: 1; /* the dense <small> reset would make the tab's fill see-through */
    color: color-mix(in srgb, currentColor 65%, transparent);
    font-size: 0.7em;
    white-space: nowrap;
    /* a reminder, not chrome: once read it slides back into the chip */
    animation: pin-hint-retract 0.35s ease-in 2.5s forwards;
  }
  @keyframes pin-hint-retract {
    to {
      transform: translateY(100%);
      opacity: 0;
      visibility: hidden;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .pin-hint {
      animation-name: pin-hint-fade;
    }
    @keyframes pin-hint-fade {
      to {
        opacity: 0;
        visibility: hidden;
      }
    }
  }
  /* a pinned chip wears a solid border */
  :where(.plot-tooltip.pinned) {
    border-color: currentColor;
  }
  /* Dense defaults for common tooltip markup: page and UA margins would pad a small chip.
  Zero specificity, so any tooltip snippet's own styles win. */
  :where(.plot-tooltip) :global(:where(h4)) {
    margin: 0;
    font-size: 1.05em;
  }
  :where(.plot-tooltip) :global(:where(p)) {
    margin: 1px 0 0;
  }
  /* superscripts (units like Å<sup>−3</sup>) must not open up a dense row */
  :where(.plot-tooltip) :global(:where(sup)) {
    line-height: 0;
  }
  :where(.plot-tooltip) :global(:where(small, .key)) {
    opacity: 0.75;
  }
</style>
