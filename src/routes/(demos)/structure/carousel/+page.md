# StructureCarousel

A scrollable strip of 3D structure viewers. Only cards near the viewport hold live canvases (the visible page plus `overscan` cards per side, default 3), while spacer-based virtualization keeps scroll geometry correct for any item count. The overscan doubles as a prefetch: any scroll shorter than it reveals structures that are already rendered.

Bringing up a canvas costs enough GPU setup to stall a fling, so cards that enter the viewport mid-scroll show their label chip alone and gain their structure once the scroll settles. Pager and keyboard jumps skip that delay, and the mounted cards always keep up enough that the viewport never goes entirely blank.

Mouse wheel, trackpad and the pager (‹ 1–3 / 40 ›) all page through the strip. The track is keyboard-navigable too: when focused, main-axis arrow keys move one card, <kbd>PageUp</kbd>/<kbd>PageDown</kbd> one page, and <kbd>Home</kbd>/<kbd>End</kbd> jump to the ends. At the first/last card, wheel and arrow events pass through to the surrounding page.

## Horizontal carousel

Each item pairs a `structure` with a `label`/`subtitle` chip. `resizable` adds a drag handle below the cards (arrow keys work too, when focused).

```svelte example
<script lang="ts">
  import { StructureCarousel, type StructureCarouselItem } from 'matterviz'
  import { structures } from '$site/structures'

  const items: StructureCarouselItem[] = structures.slice(0, 12).map((structure, idx) => ({
    id: structure.id ?? `structure-${idx}`,
    label: structure.id ?? `structure ${idx}`,
    subtitle: `${structure.sites.length} sites`,
    structure,
  }))
</script>

<StructureCarousel {items} height={300} resizable />
```

## Infinite loading with a portaled pager

`on_prefetch_more` fires once fewer than a page of items trail the render window (on mount and resize as well as while scrolling). `prefetch_cooldown_ms` throttles repeat asks only while the item count is unchanged, so a host that appends is asked again straight away and keeps being asked until the window is full: batch generously, or a host handing back one item at a time will be called once per item.

`pager_target` teleports the pager out of the cards into any host element (here a panel title bar).

```svelte example
<script lang="ts">
  import { StructureCarousel, type StructureCarouselItem } from 'matterviz'
  import { structures } from '$site/structures'

  const max_items = 40
  const make_item = (idx: number): StructureCarouselItem => {
    const structure = structures[idx % structures.length]
    return {
      id: `item-${idx}`,
      label: `${structure.id} (#${idx + 1})`,
      subtitle: `${structure.sites.length} sites`,
      structure,
    }
  }

  let items = $state(Array.from({ length: 8 }, (_, idx) => make_item(idx)))
  let pager_target = $state<HTMLElement | null>(null)

  const load_more = () => {
    if (items.length >= max_items) return
    setTimeout(() => {
      // simulate fetch latency
      const next = Array.from({ length: 6 }, (_, idx) => make_item(items.length + idx))
      items = [...items, ...next].slice(0, max_items)
    }, 300)
  }
</script>

<header class="carousel-panel-header">
  <strong>Recent structures ({items.length}{items.length < max_items ? `+` : ``})</strong>
  <span bind:this={pager_target}></span>
</header>
<StructureCarousel {items} {pager_target} height={260} on_prefetch_more={load_more} />

<style>
  .carousel-panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 10px;
    border: 1px solid color-mix(in srgb, currentColor 15%, transparent);
    border-bottom: none;
    border-radius: 6px 6px 0 0;
    background: color-mix(in srgb, currentColor 6%, transparent);
    font-size: 0.9em;
  }
</style>
```

## Vertical layout

`layout="vertical"` stacks cards in a column (scrolling vertically), with `visible_rows` capping the track at that many cards tall. With `resizable`, the drag handle on the right edge adjusts card width instead of height; `min_card_width` sets its lower bound.

```svelte example
<script lang="ts">
  import { StructureCarousel, type StructureCarouselItem } from 'matterviz'
  import { structures } from '$site/structures'

  const items: StructureCarouselItem[] = structures.slice(0, 6).map((structure, idx) => ({
    id: structure.id ?? `structure-${idx}`,
    label: structure.id ?? `structure ${idx}`,
    structure,
  }))
</script>

<StructureCarousel
  {items}
  layout="vertical"
  height={200}
  visible_rows={3}
  min_card_width={280}
  resizable
/>
```
