# StructureGallery

A scrollable gallery of 3D structure viewers, laid out as a grid by default, or as a horizontal strip or vertical column. Only cards near the viewport exist at all (the visible page plus `overscan` cards per side, default 3, rounded up to whole rows in a grid, and bounded by `max_live_cards`), while spacer-based virtualization keeps scroll geometry correct for any item count. The overscan doubles as a prefetch: any scroll shorter than it reveals structures that are already rendered.

Bringing up a canvas costs enough GPU setup to stall a fling, so cards that enter the viewport mid-scroll show their label chip alone and gain their structure once the scroll settles. Pager and keyboard jumps skip that delay, and the mounted cards always keep up enough that the viewport never goes entirely blank.

Mouse wheel, trackpad and the pager (‹ 1–3 / 40 ›) all page through the cards. The track is keyboard-navigable too: when focused, main-axis arrow keys move one card, <kbd>PageUp</kbd>/<kbd>PageDown</kbd> one page, and <kbd>Home</kbd>/<kbd>End</kbd> jump to the ends. At the first/last card, wheel and arrow events pass through to the surrounding page.

## Grid (the default)

The default layout fills its host in both axes and scrolls vertically through as many columns as `min_card_width` allows, recomputing them on every resize. Virtualization works in whole rows, so a collection of any size costs the same: only the rows intersecting the viewport (plus `overscan` rows per side) exist in the DOM.

Because every live card owns its own WebGPU canvas and device, `max_live_cards` (default 24) budgets how many run at once. It is spent on whole rows around the visible page and outranks `overscan`, so a six-column grid stops rendering rows once the budget is gone rather than adding cards that could never hold a viewer. The budget yields to one thing only: a viewport holding more cards than it allows still fills, because a permanently blank card on screen is worse than a few viewers over budget.

Give the host a definite height. Without one the track falls back to `visible_rows` rows tall rather than laying out the whole collection.

The corner grip works here too, and dragging narrower adds columns: the width it moves is the per-card minimum the column count derives from, so the layout re-flows as a drag crosses each boundary.

```svelte example
<script lang="ts">
  import { StructureGallery, type StructureGalleryItem } from 'matterviz'
  import { structures } from '$site/structures'

  const make_item = (idx: number): StructureGalleryItem => {
    const structure = structures[idx % structures.length]
    return {
      id: `grid-item-${idx}`,
      label: `${structure.id} (#${idx + 1})`,
      subtitle: `${structure.sites.length} sites`,
      structure,
    }
  }

  const page_of_items = 24
  let items = $state(Array.from({ length: page_of_items }, (_, idx) => make_item(idx)))

  // endless: every prefetch appends another batch
  const load_more = () => {
    const next = Array.from({ length: page_of_items }, (_, idx) =>
      make_item(items.length + idx),
    )
    items = [...items, ...next]
  }
</script>

<div class="grid-host">
  <StructureGallery
    {items}
    height={200}
    min_card_width={200}
    on_prefetch_more={load_more}
    resizable
  />
</div>

<style>
  .grid-host {
    block-size: 70vh;
    padding: 4px;
    border: 1px solid color-mix(in srgb, currentColor 15%, transparent);
    border-radius: 6px;
    overflow: hidden;
  }
</style>
```

## Horizontal strip

Each item pairs a `structure` with a `label`/`subtitle` chip.

`resizable` puts a grip in the gallery's bottom-right corner, visible on hover, that scales cards on both axes in one drag. Arrow keys do the same when it has focus. Horizontally, the width it moves is the per-card minimum: widen the cards and fewer fit, so the ones that remain stretch to divide the strip.

```svelte example
<script lang="ts">
  import { StructureGallery, type StructureGalleryItem } from 'matterviz'
  import { structures } from '$site/structures'

  const items: StructureGalleryItem[] = structures.slice(0, 12).map((structure, idx) => ({
    id: structure.id ?? `structure-${idx}`,
    label: structure.id ?? `structure ${idx}`,
    subtitle: `${structure.sites.length} sites`,
    structure,
  }))
</script>

<StructureGallery {items} layout="horizontal" height={300} resizable />
```

## Vertical column

`layout="vertical"` stacks cards in a column (scrolling vertically), with `visible_rows` capping the track at that many cards tall.

A single column has nothing to divide, so it does not stretch to its host: cards default to square, as wide as the viewer is tall, floored by `min_card_width`, capped by the host width, and centred in the track. The corner grip overrides that with an exact width.

```svelte example
<script lang="ts">
  import { StructureGallery, type StructureGalleryItem } from 'matterviz'
  import { structures } from '$site/structures'

  const items: StructureGalleryItem[] = structures.slice(0, 6).map((structure, idx) => ({
    id: structure.id ?? `structure-${idx}`,
    label: structure.id ?? `structure ${idx}`,
    structure,
  }))
</script>

<StructureGallery
  {items}
  layout="vertical"
  height={200}
  visible_rows={3}
  min_card_width={280}
  resizable
/>
```

## Title bar and infinite loading

`on_prefetch_more` fires once fewer than a page of items trail the render window (on mount and resize as well as while scrolling). `prefetch_cooldown_ms` throttles repeat asks only while the item count is unchanged, so a host that appends is asked again straight away and keeps being asked until the window is full: batch generously, or a host handing back one item at a time will be called once per item.

`pager_target` teleports the pager out of the cards into any host element (here a panel title bar).

```svelte example
<script lang="ts">
  import { StructureGallery, type StructureGalleryItem } from 'matterviz'
  import { structures } from '$site/structures'

  const max_items = 40
  const make_item = (idx: number): StructureGalleryItem => {
    const structure = structures[idx % structures.length]
    return {
      id: `item-${idx}`,
      label: `${structure.id} (#${idx + 1})`,
      subtitle: `${structure.sites.length} sites`,
      structure,
    }
  }

  let items = $state(Array.from({ length: 8 }, (_, idx) => make_item(idx)))

  const load_more = () => {
    if (items.length >= max_items) return
    setTimeout(() => {
      // simulate fetch latency
      const next = Array.from({ length: 6 }, (_, idx) => make_item(items.length + idx))
      items = [...items, ...next].slice(0, max_items)
    }, 300)
  }
</script>

<StructureGallery
  {items}
  layout="horizontal"
  height={260}
  on_prefetch_more={load_more}
  resizable
>
  {#snippet header()}
    <strong>Recent structures ({items.length}{items.length < max_items ? `+` : ``})</strong>
  {/snippet}
</StructureGallery>
```
