# ElementTile

`ElementTile.svelte` automatically changes text color to ensure high contrast with its background. If its background is transparent, it traverses up the DOM tree to find the first element with non-transparent background color. This an, of course, go wrong e.g. if the tile is absolutely positioned outside its parent element. In that case, pass an explicit `text_color` prop and `text_color_threshold={null}` to `ElementTile` to override the automatic color selection.

```svelte example code_above
<script>
  import { element_data, ElementTile } from 'matterviz'

  const rand_color = () =>
    `hsl(${Math.random() * 360}, ${Math.random() * 50 + 50}%, ${
      Math.random() * 50 + 50
    }%)`
</script>

<ol>
  {#each Array(27).fill(0).map(rand_color) as bg_color, idx}
    <ElementTile {bg_color} element={element_data[idx]} style="width: 4em; margin: 0" />
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

Displaying values instead of element names by passing the `value` prop.

```svelte example code_above
<script>
  import { element_data, ElementTile } from 'matterviz'

  const bg_colors = 'red green blue yellow cyan magenta black white'.split()
</script>

<ol>
  {#each bg_colors as bg_color, idx}
    <ElementTile
      {bg_color}
      element={element_data[idx]}
      value={Math.random()}
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

ElementTile supports displaying multiple values per tile with different split layout options. Control the layout using the `split_layout` prop.

```svelte example code_above
<script>
  import { element_data, ElementTile } from 'matterviz'

  const values = {
    two: [1.2, 2.5],
    three: [1.2, 2.5, 0.8],
    four: [1.2, 2.5, 0.8, 3.1],
  }
  const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24']
  const tile_style = 'width: 5em; height: 5em;'
</script>

<h4>Auto-determined Layouts</h4>
<p>
  When <code>split_layout</code> is not specified, the layout is automatically chosen
  based on the number of values.
</p>
<div class="examples">
  <ElementTile
    element={element_data[0]}
    value={values.two}
    bg_colors={colors.slice(0, 2)}
    style={tile_style}
  />
  <ElementTile
    element={element_data[1]}
    value={values.three}
    bg_colors={colors.slice(0, 3)}
    style={tile_style}
  />
  <ElementTile
    element={element_data[2]}
    value={values.four}
    bg_colors={colors}
    style={tile_style}
  />
</div>

<h4>Explicit Layout Control</h4>
<div class="examples">
  <!-- 3 values: horizontal vs vertical -->
  <ElementTile
    element={element_data[3]}
    value={values.three}
    bg_colors={colors.slice(0, 3)}
    split_layout="horizontal"
    style={tile_style}
  />
  <ElementTile
    element={element_data[4]}
    value={values.three}
    bg_colors={colors.slice(0, 3)}
    split_layout="vertical"
    style={tile_style}
  />

  <!-- 4 values: triangular vs quadrant -->
  <ElementTile
    element={element_data[5]}
    value={values.four}
    bg_colors={colors}
    split_layout="triangular"
    style={tile_style}
  />
  <ElementTile
    element={element_data[6]}
    value={values.four}
    bg_colors={colors}
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

**Note:** The atomic number is automatically hidden for multi-value splits to prevent overlap with value labels. You can override this behavior with the `show_number` prop.
