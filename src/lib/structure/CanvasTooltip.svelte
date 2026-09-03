<script lang="ts">
  import { HTML } from '@threlte/extras'
  import { useThrelte } from '@threlte/core'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { Vec3 } from '$lib/math'

  let {
    position,
    children,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    position: Vec3
    children: Snippet<[{ position: Vec3 }]>
  } = $props()

  // Threlte's Canvas host clips 3D rendering. Portal HTML overlays one level up so
  // tooltips can cross viewport/card boundaries without also unclipping the canvas.
  const { dom } = useThrelte()
  const portal = dom.parentElement
  if (!portal) throw new Error(`CanvasTooltip requires a mounted Canvas host`)

  // Placed at a projected 3D point, the tooltip grows right and down knowing
  // nothing of what clips it — and a scroll container, which a gallery track is,
  // can never show what leaves its box. So slide it back inside after each
  // placement.
  const clipper = (node: HTMLElement): DOMRect | undefined => {
    for (let el = node.parentElement; el; el = el.parentElement) {
      const { overflowX, overflowY } = getComputedStyle(el)
      if (overflowX !== `visible` || overflowY !== `visible`) return el.getBoundingClientRect()
    }
  }
  // Pull the far edge in, but never past where the near edge sits flush: a
  // tooltip too wide for its clip keeps its start rather than its tail.
  const slide_in = (near: number, far: number): number => Math.max(near, Math.min(0, far))

  let tip: HTMLElement | undefined = $state()
  $effect(() => {
    void position // the anchor moved, so any previous slide is stale
    const node = tip
    if (!node) return
    // threlte's HTML writes the anchor transform from a render-stage task, so
    // measuring on this flush still reads the previous site's screen box
    const frame = requestAnimationFrame(() => {
      node.style.translate = ``
      const clip = clipper(node)
      if (!clip) return
      const box = node.getBoundingClientRect()
      const dx = slide_in(clip.left - box.left, clip.right - box.right)
      const dy = slide_in(clip.top - box.top, clip.bottom - box.bottom)
      if (dx || dy) node.style.translate = `${dx}px ${dy}px`
    })
    return () => cancelAnimationFrame(frame)
  })
</script>

<!-- Constant zIndexRange: threlte's default [16777271, 0] maps camera distance
  over [near, far], which extrapolates to a NEGATIVE z-index for sites beyond
  camera.far (common in zoomed-out gallery cards) — painting the tooltip
  behind the canvas. A degenerate range pins z-index at 1000, always above the
  canvas and sibling overlays. -->
<HTML {portal} {position} pointerEvents="none" zIndexRange={[1000, 1000]}>
  <div bind:this={tip} {...rest} role="tooltip">
    {@render children({ position })}
  </div>
</HTML>

<style>
  div {
    width: max-content;
    max-width: var(--canvas-tooltip-max-width, 16em);
    box-sizing: border-box;
    text-align: var(--canvas-tooltip-text-align, left);
    border-radius: var(--canvas-tooltip-border-radius, var(--border-radius, 3pt));
    background: var(
      --canvas-tooltip-bg,
      light-dark(rgba(226, 232, 240, 0.96), rgba(15, 23, 42, 0.96))
    );
    padding: var(--canvas-tooltip-padding, 1pt 5pt);
    color: var(--canvas-tooltip-text-color, light-dark(#0f172a, #f8fafc));
    font-family: var(--canvas-tooltip-font-family);
    font-size: var(--canvas-tooltip-font-size, clamp(8pt, 3cqmin, 18pt));
    line-height: var(--canvas-tooltip-line-height);
    pointer-events: none;
  }
</style>
