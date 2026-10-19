<script lang="ts">
  // PlotTooltip pinned to a 3D point. `position` is in the local space of where this sits in
  // the scene graph (inside the structure's rotation groups, say), projected to the canvas on
  // every rendered frame. The chip flips and clamps inside the box that would cut it off and
  // keeps clear of the hovered object's screen disk (`anchor_radius`).
  import type { Vec3 } from '#lib/math.js'
  import PlotTooltip from '#lib/plot/core/components/PlotTooltip.svelte'
  import { clip_bounds } from '#lib/plot/core/decorations/tooltip.js'
  import type { Rect } from '#lib/plot/core/layout.js'
  import { T, useTask, useThrelte } from '@threlte/core'
  import { type ComponentProps, type Snippet, untrack } from 'svelte'
  import { Group, Vector3 } from 'three/webgpu'

  let {
    position,
    anchor_radius = 0,
    portal,
    children,
    ...rest
  }: Omit<ComponentProps<typeof PlotTooltip>, `x` | `y` | `children`> & {
    position: Vec3
    anchor_radius?: number // scene-space radius of the hovered object, kept clear on screen
    // Overlay host whose origin is the canvas's. Defaults to the Canvas host's parent, as
    // threlte's Canvas clips its own overflow: the tooltip may leave the canvas (a gallery
    // card) but not the nearest box that clips that parent (the gallery track).
    portal?: HTMLElement
    children: Snippet
  } = $props()

  const { camera, size, dom, renderStage } = useThrelte()
  const host = $derived(portal ?? dom.parentElement)

  type Screen = { x: number; y: number; radius: number }
  let screen = $state<Screen | null>(null)
  let bounds = $state<Rect | undefined>()

  const anchor = new Group()
  const [center, edge] = [new Vector3(), new Vector3()]
  function project(): void {
    const cam = camera.current
    if (!cam || !host) return
    anchor.updateWorldMatrix(true, false)
    center.setFromMatrixPosition(anchor.matrixWorld)
    // a point anchor_radius along the camera's up axis gives the disk's on-screen radius
    const radius = anchor_radius * anchor.matrixWorld.getMaxScaleOnAxis()
    edge.setFromMatrixColumn(cam.matrixWorld, 1).normalize().multiplyScalar(radius).add(center)
    center.project(cam)
    edge.project(cam)
    // outside the clip volume, including behind the camera
    if (Math.abs(center.z) > 1) {
      screen = null
      return
    }
    const { width, height } = size.current
    const next = {
      x: ((center.x + 1) * width) / 2,
      y: ((1 - center.y) * height) / 2,
      radius: Math.hypot(
        ((edge.x - center.x) * width) / 2,
        ((edge.y - center.y) * height) / 2,
      ),
    }
    // skip sub-pixel changes: each write re-places the tooltip
    const same = (key: keyof Screen) => screen && Math.abs(next[key] - screen[key]) < 0.5
    if (same(`x`) && same(`y`) && same(`radius`)) return
    screen = next
  }
  // follow camera motion on rendered frames, like threlte's <HTML>
  useTask(project, { stage: renderStage, autoInvalidate: false })
  // and place at once when the anchor or viewport changes without a frame
  $effect(() => {
    anchor.position.set(...position)
    void [anchor_radius, host, $size]
    untrack(project)
  })

  // Measured once the tooltip is in the DOM: hosts may lift their clip only while one shows (a
  // gallery card's overflow), so a box read before mounting would keep it inside the card.
  // Tracks only whether it shows, not where: the anchor moves on every frame of a camera
  // orbit, and each measure forces layout and walks the ancestors' computed styles. A scroll or
  // window resize moves the clip box relative to the host, so a shown (e.g. pinned) tooltip
  // re-measures on those.
  const tooltip_shown = $derived(screen !== null)
  $effect(() => {
    void $size
    if (!tooltip_shown || !host) return
    const measure = () => (bounds = clip_bounds(host))
    measure()
    const options = { capture: true, passive: true }
    globalThis.addEventListener(`scroll`, measure, options)
    globalThis.addEventListener(`resize`, measure, options)
    return () => {
      globalThis.removeEventListener(`scroll`, measure, options)
      globalThis.removeEventListener(`resize`, measure, options)
    }
  })

  const portal_to_host = (node: HTMLElement) => {
    host?.append(node)
    return () => node.remove()
  }
</script>

<T is={anchor} />

{#if screen}
  {@const { x, y, radius } = screen}
  <!-- PlotTooltip renders in place, which inside threlte's Canvas is the <canvas> element, so
  a wrapper carries it to the host -->
  <div {@attach portal_to_host} style="display: contents">
    <PlotTooltip
      {x}
      {y}
      role="tooltip"
      avoid_cursor={false}
      offset={{ x: radius + 4, y: 4 }}
      exclusion_rects={[
        { x: x - radius, y: y - radius, width: 2 * radius, height: 2 * radius },
      ]}
      constrain_to={bounds}
      {...rest}
    >
      {@render children()}
    </PlotTooltip>
  </div>
{/if}
