<script lang="ts">
  // PlotTooltip pinned to a 3D `position` (local to its parent), flipped and clamped inside
  // the box that would clip it, clear of the hovered object's disk (`anchor_radius`)
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
    // Overlay host sharing the canvas's origin, by default the Canvas host's parent (threlte's
    // Canvas clips its overflow), so the tooltip stays inside the box clipping that parent
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

  // Measured once shown (hosts may lift their clip only then), not per anchor move since it
  // forces layout; a scroll or window resize moves the clip box, so it re-measures then.
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
