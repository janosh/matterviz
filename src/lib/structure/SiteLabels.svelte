<script lang="ts">
  // Single overlay for all site labels: one portaled DOM container plus one
  // per-frame position pass. Replaces per-label threlte <HTML> components (each
  // of which carries its own portal, per-frame task and matrix updates), which
  // made labels on large structures/supercells unusable. Labels show the site's
  // species and/or index (or a caller's atom_label snippet) and are offset away
  // from the site's bonds.
  import { format_num } from '#lib/labels.js'
  import type { Vec3 } from '#lib/math.js'
  import type { AnyStructure, Site } from '#lib/structure/index.js'
  import { T, useTask, useThrelte } from '@threlte/core'
  import type { Snippet } from 'svelte'
  import { Group } from 'three/webgpu'
  import {
    type LabelPlacement,
    LabelProjector,
    site_label_offsets,
  } from './atom-label-placement'
  import type { SiteAnchor } from './atom-groups'
  import type { BondData } from './bond-rendering'
  import { get_site } from './site'

  let {
    entries,
    structure,
    bonds,
    show_labels,
    show_indices,
    size: label_size,
    offset,
    bg_color,
    color,
    padding,
    atom_label,
    on_select,
  }: {
    // position in the local space of the surrounding rotation groups, radius the visual atom
    // scale (SphereGeometry(0.5) scale factor)
    entries: SiteAnchor[]
    structure: AnyStructure | undefined
    bonds: BondData // drawn bonds: labels turn away from them
    show_labels: boolean // species symbols (with occupancies for disordered sites)
    show_indices: boolean // 1-based site indices
    size: number // em, scaled by 0.85
    offset: Vec3 // preferred offset from the atom center
    bg_color: string
    color: string
    padding: number // px
    atom_label?: Snippet<[{ site: Site; site_idx: number }]> // replaces the default label
    on_select: (site_idx: number, event: Event) => void
  } = $props()

  // Past this many labels, they share the canvas overlay's layer instead of one layer each
  const MAX_LAYERED_LABELS = 1000

  const smart_offsets = $derived(site_label_offsets(bonds, offset))
  // Everything a label renders, resolved per label here so no label reads a shared signal:
  // tens of thousands of labels each subscribed to the same props made unmounting them
  // quadratic (every removed subscription searched one shared list, 1.4 s at 47k labels)
  const label_items = $derived(
    entries.map(({ site_idx }) => ({
      site_idx,
      site: get_site(structure, site_idx),
      show_labels,
      show_indices,
      atom_label,
    })),
  )
  // Own compositor layers (will-change) keep moving labels off the paint path, but each
  // layer costs ~0.3 ms to tear down: 47k labels froze the tab for 13 s on hiding them
  const promote_layers = $derived(entries.length <= MAX_LAYERED_LABELS)
  const screen_margin = $derived(label_size * 10 + padding)

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
    const [offsets, base_offset] = [smart_offsets, offset]
    const kids = container.children
    for (let idx = 0; idx < items.length; idx++) {
      const element = kids[idx] as HTMLElement | undefined
      if (!element) break
      const entry = items[idx]
      const label_offset = offsets.get(entry.site_idx) ?? base_offset
      projector.place(entry.position, label_offset, entry.radius * 0.5, placement)
      // Hide labels behind the camera (same check as threlte's <HTML>)
      if (!placement.visible) {
        if (element.style.display !== `none`) element.style.display = `none`
        continue
      }
      if (element.style.display === `none`) element.style.display = ``
      // 2D: a 3D transform would promote every label to its own layer regardless
      const transform = `translate(-50%, -50%) translate(${placement.x.toFixed(1)}px, ${placement.y.toFixed(
        1,
      )}px)`
      if (last_transforms[idx] !== transform) {
        last_transforms[idx] = transform
        element.style.transform = transform
      }
    }
  }

  // Follow camera motion (runs only on rendered frames, like threlte's <HTML>)
  useTask(update_positions, { stage: renderStage, autoInvalidate: false })

  // Immediate repositioning when label data, offsets or viewport size changes.
  // update_positions is deliberately tracked: it reads entries, screen_margin and
  // the bond-aware offsets, so offset changes re-run this effect even when no
  // frame is scheduled.
  $effect(() => {
    void $size
    last_transforms = []
    update_positions()
  })

  const portal_to_dom = (element: HTMLElement) => {
    if (!dom) return
    dom.append(element)
    return () => element.remove()
  }
</script>

<T is={anchor} />

<div
  bind:this={container}
  class={[`site-labels-overlay`, { layered: promote_layers }]}
  style:--label-font-size="{label_size * 0.85}em"
  style:--label-bg={bg_color}
  style:--label-padding="{padding}px"
  style:--label-color={color || `var(--text-color)`}
  {@attach portal_to_dom}
>
  {#each label_items as item (item.site_idx)}
    {@const { site, site_idx } = item}
    <!-- one div per entry, site or not: update_positions pairs them by index -->
    <div class="site-label">
      {#if site}
        {#if item.atom_label}
          {@render item.atom_label({ site, site_idx })}
        {:else}
          <button
            type="button"
            class="atom-label"
            onpointerdown={(event) => {
              event.preventDefault()
              event.stopImmediatePropagation()
              on_select(site_idx, event)
            }}
            onclick={(event) => {
              event.preventDefault()
              event.stopImmediatePropagation()
              // keyboard and assistive-tech activation arrive as a click with detail 0; a
              // pointer's click follows the pointerdown that already selected
              if (event.detail === 0) on_select(site_idx, event)
            }}
            onkeydown={(event) => {
              // the key's click selects; the key itself must not reach the viewer's key walk
              if (event.key === `Enter` || event.key === ` `) event.stopPropagation()
            }}
          >
            {#if item.show_labels}
              {#if site.species.length === 1}
                {site.species[0].element}{#if item.show_indices}-{site_idx + 1}{/if}
              {:else}
                {#each site.species as { element, occu, oxidation_state } (`${element}-${occu}-${oxidation_state}`)}
                  {element}<sub>{format_num(occu, `.3~`).replace(`0.`, `.`)}</sub>
                {/each}
                {#if item.show_indices}-{site_idx + 1}{/if}
              {/if}
            {:else if item.show_indices}
              {site_idx + 1}
            {/if}
          </button>
        {/if}
      {/if}
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
    .layered > & {
      will-change: transform;
    }
  }
  /* background, color and padding come from the overlay's variables (site_label_* settings) */
  .atom-label {
    background: var(--label-bg);
    padding: var(--label-padding);
    color: var(--label-color);
    border: 0;
    border-radius: var(--struct-atom-label-border-radius, var(--border-radius, 3pt));
    cursor: pointer;
    font: inherit;
    font-size: var(--label-font-size);
    white-space: nowrap;
  }
</style>
