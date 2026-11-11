# StructureGallery

A scrollable gallery of 3D structure viewers, laid out as a grid by default, or as a horizontal strip or vertical column. Only cards near the viewport exist, so any item count scrolls smoothly.

<details>
<summary>Virtualization, scrolling and navigation</summary>

Only cards near the viewport exist at all, while spacer-based virtualization keeps scroll geometry correct for any item count. The overscan doubles as a prefetch: any scroll shorter than it reveals structures that are already rendered.

Bringing up a canvas costs enough GPU setup to stall a fling, so cards that enter the viewport mid-scroll show their label chip alone and gain their structure once the scroll settles. Pager and keyboard jumps skip that delay, and the mounted cards always keep up enough that the viewport never goes entirely blank. Mouse wheel, trackpad and the pager (‹ 1–3 / 40 ›) all page through the cards. The track is keyboard-navigable too: when focused, main-axis arrow keys move one card, <kbd>PageUp</kbd>/<kbd>PageDown</kbd> one page, and <kbd>Home</kbd>/<kbd>End</kbd> jump to the ends. At the first/last card, wheel and arrow events pass through to the surrounding page. The examples below cap `max_live_cards` well under its default, since several galleries on one page would otherwise ask for more simultaneous WebGPU contexts than a browser will hand out.

</details>

## Grid (the default)

The default layout fills its host in both axes and scrolls vertically through as many columns as `min_card_width` allows. Give the host a definite height, and drag the corner grip to re-flow columns. `on_prefetch_more` appends the next batch as the end nears.

<details>
<summary>Row virtualization and prefetch</summary>

Virtualization works in whole rows, so a collection of any size costs the same.

Without a definite height the track falls back to a two-row floor rather than laying out the whole collection.

`on_prefetch_more` also fires on mount and resize, not only while scrolling. A host that appends is asked again straight away until the window is full, while one that has nothing left to give is not asked again until its count moves. Batch generously, or a host handing back one item at a time will be called once per item.

</details>

```svelte example
<script lang="ts">
  import { StructureGallery, type StructureGalleryItem } from 'matterviz'
  import { structures } from '#site/structures.js'

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
    max_live_cards={9}
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

## Per-structure properties

Give an item `properties` and the gallery captions its viewer with them. `property_color_scheme` tints each pair by its rank across the whole collection, and `property_units` adds units after values.

<details>
<summary>Caption layout and color ranking</summary>

The caption is a strip along the bottom of the card, keys muted, values tabular. Cards wide enough for two key/value pairs per line get them, narrow ones stack; either way the pairs borrow the card's own grid columns through a CSS subgrid, so keys and values line up across every row of a card.

Color ranks span the whole collection, not just the cards on screen, so a card keeps its colour as it scrolls; here `property_color_reverse` makes the lowest energy blue and the highest red. Non-numeric values, and any key whose values are all identical, are left untinted rather than implying a ranking that isn't there.

An underscore in a key marks a subscript, so `E_hull` captions the way the quantity is written.

</details>

```svelte example
<script lang="ts">
  import { StructureGallery, type StructureGalleryItem } from 'matterviz'
  import { structures } from '#site/structures.js'

  // stand-ins for whatever your pipeline computed per structure
  const items: StructureGalleryItem[] = structures.slice(0, 12).map((structure, idx) => ({
    id: structure.id ?? `structure-${idx}`,
    label: structure.id ?? `structure ${idx}`,
    structure,
    properties: {
      E: -8.4 + Math.sin(idx * 1.7) * 1.6,
      E_hull: Math.abs(Math.cos(idx * 0.9)) * 0.12,
      Gap: Math.abs(Math.sin(idx * 2.3)) * 3.1,
      Sites: structure.sites.length,
    },
  }))
</script>

<div class="property-host">
  <StructureGallery
    {items}
    height={230}
    min_card_width={260}
    max_live_cards={6}
    property_units={{ E: `eV/atom`, E_hull: `eV`, Gap: `eV` }}
    property_color_scheme="interpolateRdYlBu"
    property_color_reverse
  />
</div>

<style>
  .property-host {
    block-size: 60vh;
  }
</style>
```

## Horizontal strip and title bar

Each item pairs a `structure` with a `label`/`subtitle` chip. `resizable` adds a corner grip that scales cards, and a `header` snippet turns the gallery into a panel with the pager docked in its title bar.

<details>
<summary>Grip and pager details</summary>

The grip is visible on hover and scales cards on both axes in one drag; arrow keys do the same when it has focus. Horizontally, the width it moves is the per-card minimum: widen the cards and fewer fit, so the ones that remain stretch to divide the strip, and the layout re-flows as a drag crosses each column boundary.

</details>

```svelte example
<script lang="ts">
  import { StructureGallery, type StructureGalleryItem } from 'matterviz'
  import { structures } from '#site/structures.js'

  const items: StructureGalleryItem[] = structures.slice(0, 12).map((structure, idx) => ({
    id: structure.id ?? `structure-${idx}`,
    label: structure.id ?? `structure ${idx}`,
    subtitle: `${structure.sites.length} sites`,
    structure,
  }))
</script>

<StructureGallery {items} layout="horizontal" height={300} max_live_cards={6} resizable>
  {#snippet header()}
    <strong>Recent structures ({items.length})</strong>
  {/snippet}
</StructureGallery>
```

## Vertical column

`layout="vertical"` stacks cards in a column, with `visible_rows` capping the track at that many cards tall.

<details>
<summary>Card sizing in a single column</summary>

A single column has nothing to divide, so it does not stretch to its host: cards default to square, as wide as the viewer is tall, floored by `min_card_width`, capped by the host width, and centred in the track. The corner grip overrides that with an exact width.

</details>

```svelte example
<script lang="ts">
  import { StructureGallery, type StructureGalleryItem } from 'matterviz'
  import { structures } from '#site/structures.js'

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
  max_live_cards={4}
  resizable
/>
```
