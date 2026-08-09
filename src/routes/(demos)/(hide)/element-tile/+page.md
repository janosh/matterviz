# ElementTile

`ElementTile.svelte` takes a `segments` array describing what to paint. Each segment carries its own `color` and optional `value` label, so the two can never disagree in length. One segment paints a solid tile; two to four split it. Text color is chosen for maximum WCAG contrast against the segment's color, composited over the surface behind the tile. Pass an explicit `text_color` whenever the rendered background is not a solid CSS color.

```svelte example code_above
<script lang="ts">
  import { element_data, ElementTile } from 'matterviz'

  const rand_color = () =>
    `hsl(${Math.random() * 360}, ${Math.random() * 50 + 50}%, ${Math.random() * 50 + 50}%)`
</script>

<ol>
  {#each Array(27)
    .fill(0)
    .map( (_, idx) => ({ color: rand_color(), element: element_data[idx] }) ) as { color, element } (element.symbol)}
    <ElementTile segments={[{ color }]} {element} style="width: 4em; margin: 0" />
  {/each}
</ol>

<style>
  ol {
    display: flex;
    flex-wrap: wrap;
    gap: 1em;
  }
</style>
```

Give a segment a `value` to label it instead of showing the element name.

```svelte example code_above
<script lang="ts">
  import { element_data, ElementTile } from 'matterviz'

  const colors = `red green blue yellow cyan magenta black white`.split(` `)
</script>

<ol>
  {#each colors as color, idx (color)}
    <ElementTile
      element={element_data[idx]}
      segments={[{ color, value: Math.random() }]}
      style="width: 4em; margin: 0"
      active
    />
  {/each}
</ol>

<style>
  ol {
    display: flex;
    flex-wrap: wrap;
    gap: 1em;
  }
</style>
```

## Multi-value Split Layouts

Two to four segments split the tile. `split_layout` picks between the layouts that exist for that segment count: `diagonal` for two, `horizontal` or `vertical` for three, `quadrant` or `triangular` for four. Invalid layouts fall back to the default for that segment count.

```svelte example code_above
<script lang="ts">
  import { element_data, ElementTile } from 'matterviz'

  const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24']
  const values = [1.2, 2.5, 0.8, 3.1]
  const segments = (count: number) =>
    colors.slice(0, count).map((color, idx) => ({ color, value: values[idx] }))
  const tile_style = 'width: 5em; height: 5em;'
</script>

<h4>Auto-determined Layouts</h4>
<p>
  Without <code>split_layout</code>, the layout follows the segment count.
</p>
<div class="examples">
  <ElementTile element={element_data[0]} segments={segments(2)} style={tile_style} />
  <ElementTile element={element_data[1]} segments={segments(3)} style={tile_style} />
  <ElementTile element={element_data[2]} segments={segments(4)} style={tile_style} />
</div>

<h4>Explicit Layout Control</h4>
<div class="examples">
  <!-- 3 segments: horizontal vs vertical -->
  <ElementTile
    element={element_data[3]}
    segments={segments(3)}
    split_layout="horizontal"
    style={tile_style}
  />
  <ElementTile
    element={element_data[4]}
    segments={segments(3)}
    split_layout="vertical"
    style={tile_style}
  />

  <!-- 4 segments: triangular vs quadrant -->
  <ElementTile
    element={element_data[5]}
    segments={segments(4)}
    split_layout="triangular"
    style={tile_style}
  />
  <ElementTile
    element={element_data[6]}
    segments={segments(4)}
    split_layout="quadrant"
    style={tile_style}
  />
</div>

<style>
  .examples {
    display: flex;
    gap: 1.5em;
    align-items: center;
    margin: 2em 0;
    flex-wrap: wrap;
  }
</style>
```

**Note:** The atomic number is automatically hidden on split tiles to prevent overlap with value labels. Override that with the `show_number` prop.
