<script lang="ts">
  // Single overlay for all site labels: one portaled DOM container plus one
  // per-frame position pass. Replaces per-label threlte <HTML> components (each
  // of which carries its own portal, per-frame task and matrix updates), which
  // made labels on large structures/supercells unusable.
  import type { Vec3 } from '$lib/math'
  import { T, useTask, useThrelte } from '@threlte/core'
  import type { Snippet } from 'svelte'
  import { Group } from 'three'
  import { type LabelPlacement, LabelProjector } from './atom-label-placement'

  type SiteLabelEntry = {
    site_idx: number
    position: Vec3 // in the local space of the surrounding rotation groups
    radius: number // visual atom scale (SphereGeometry(0.5) scale factor)
  }

  let {
    entries,
    get_offset,
    screen_margin,
    label,
  }: {
    entries: SiteLabelEntry[]
    get_offset: (site_idx: number) => Vec3
    screen_margin: number
    label: Snippet<[{ site_idx: number }]>
  } = $props()

  const { camera, size, dom, renderStage } = useThrelte()

  // Anchor object inside the scene's rotation groups so label positions follow
  // the same transform as the atoms they annotate.
  const anchor = new Group()
  let container = $state<HTMLDivElement>()

  const projector = new LabelProjector()
  const placement: LabelPlacement = { x: 0, y: 0, visible: false }
  // Cache last-applied transform per label to skip redundant style writes
  let last_transforms: string[] = []

  function update_positions() {
    const cam = camera.current
    if (!container || !cam) return
    cam.updateMatrixWorld()
    anchor.updateWorldMatrix(true, false)
    projector.update(cam, anchor.matrixWorld, size.current, screen_margin)
    // Read reactive props once, not per label (prop getters cross a component
    // boundary and would otherwise run 2-3x per label per frame)
    const items = entries
    const offset_of = get_offset
    const kids = container.children
    for (let idx = 0; idx < items.length; idx++) {
      const el = kids[idx] as HTMLElement | undefined
      if (!el) break
      const entry = items[idx]
      projector.place(entry.position, offset_of(entry.site_idx), entry.radius * 0.5, placement)
      // Hide labels behind the camera (same check as threlte's <HTML>)
      if (!placement.visible) {
        if (el.style.display !== `none`) el.style.display = `none`
        continue
      }
      if (el.style.display === `none`) el.style.display = ``
      const transform = `translate(-50%, -50%) translate3d(${placement.x.toFixed(1)}px, ${placement.y.toFixed(
        1,
      )}px, 0)`
      if (last_transforms[idx] !== transform) {
        last_transforms[idx] = transform
        el.style.transform = transform
      }
    }
  }

  // Follow camera motion (runs only on rendered frames, like threlte's <HTML>)
  useTask(update_positions, { stage: renderStage, autoInvalidate: false })

  // Immediate repositioning when label data, offsets or viewport size changes.
  // update_positions is deliberately tracked: it reads entries, screen_margin and
  // (via get_offset) the scene's offset state, so offset changes re-run this
  // effect even when no frame is scheduled.
  $effect(() => {
    void $size
    last_transforms = []
    update_positions()
  })

  const portal_action = (el: HTMLElement) => {
    if (!dom) return
    dom.append(el)
    return { destroy: () => el.remove() }
  }
</script>

<T is={anchor} />

<div bind:this={container} class="site-labels-overlay" use:portal_action>
  {#each entries as entry (entry.site_idx)}
    <div class="site-label">
      {@render label({ site_idx: entry.site_idx })}
    </div>
  {/each}
</div>

<style>
  .site-labels-overlay {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
  }
  .site-label {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: auto;
    white-space: nowrap;
    /* measured A/B (888 labels, 2x2x2 supercell, auto-rotating, dpr 2): 60fps
      with will-change vs ~34fps without - promoting labels to their own layers
      avoids repaints when only transforms change */
    will-change: transform;
  }
</style>
