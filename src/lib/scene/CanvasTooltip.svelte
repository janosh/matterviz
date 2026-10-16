<script lang="ts">
  // PlotTooltip pinned to a 3D point. `position` is in the local space of where this sits in
  // the scene graph (inside the structure's rotation groups, say), projected to the canvas on
  // every rendered frame. The chip flips and clamps inside the box that would cut it off and
  // keeps clear of the hovered object's screen disk (`anchor_radius`).
  import type { Vec3 } from '#lib/math.js'
  import PlotTooltip from '#lib/plot/core/components/PlotTooltip.svelte'
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
  type Bounds = { x: number; y: number; width: number; height: number }
  let screen = $state<Screen | null>(null)
  let bounds = $state<Bounds | undefined>()

  // The box that would cut the tooltip off, in the host's coordinates: the nearest ancestor
  // that clips its overflow, else the viewport
  function clip_bounds(node: HTMLElement): Bounds {
    const origin = node.getBoundingClientRect()
    let clip: HTMLElement | null = node
    // the shorthand lists both axes when they differ, so any clipping value counts
    const clips = (el: HTMLElement) =>
      /hidden|clip|scroll|auto/.test(getComputedStyle(el).overflow)
    while (clip && !clips(clip)) clip = clip.parentElement
    const { left, top, width, height } = clip?.getBoundingClientRect() ?? {
      left: 0,
      top: 0,
      width: globalThis.innerWidth,
      height: globalThis.innerHeight,
    }
    return { x: left - origin.left, y: top - origin.top, width, height }
  }

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
    bounds = clip_bounds(host)
  }
  // follow camera motion on rendered frames, like threlte's <HTML>
  useTask(project, { stage: renderStage, autoInvalidate: false })
  // and place at once when the anchor or viewport changes without a frame
  $effect(() => {
    anchor.position.set(...position)
    void [anchor_radius, host, $size]
    untrack(project)
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
