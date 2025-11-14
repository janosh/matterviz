<script>
  import pkg from '$root/package.json'
</script>

# Element Color Schemes

**Multi-scheme comparison**: Compare 3 color palettes side by side as horizontal bars in each element tile.

```svelte example
<script>
  import { element_data, PeriodicTable, TableInset } from 'matterviz'
  import { element_color_schemes } from 'matterviz/colors'

  // Create multi-scheme color data - each element gets an array of 3 colors
  const multi_scheme_colors = element_data.map((el) => [
    element_color_schemes.Jmol[el.symbol] ?? '#666666',
    element_color_schemes.Vesta[el.symbol] ?? '#666666',
    element_color_schemes.Alloy[el.symbol] ?? '#666666',
  ])
</script>

<PeriodicTable
  tile_props={{ show_name: false, show_number: false }}
  heatmap_values={multi_scheme_colors}
  tooltip={false}
  style="margin: 1em auto; max-width: 800px"
>
  {#snippet inset()}
    <TableInset>
      <div class="scheme-legend">
        <div class="legend-item">
          <div class="color-sample jmol"></div>
          <span>Top: Jmol/CPK</span>
        </div>
        <div class="legend-item">
          <div class="color-sample vesta"></div>
          <span>Middle: VESTA</span>
        </div>
        <div class="legend-item">
          <div class="color-sample alloy"></div>
          <span>Bottom: Alloy</span>
        </div>
      </div>
    </TableInset>
  {/snippet}
</PeriodicTable>

<style>
  .scheme-legend {
    display: flex;
    gap: 2em;
    justify-content: center;
    align-items: center;
    flex-wrap: wrap;
    padding: 0.5em;
  }
  .legend-item {
    display: flex;
    align-items: center;
    gap: 0.5em;
    font-size: 0.9em;
  }
  .color-sample {
    width: 20px;
    height: 12px;
    border-radius: 2px;
    border: 1px solid rgba(255, 255, 255, 0.3);
  }
  .color-sample.jmol {
    background: linear-gradient(90deg, #ff1493, #00ff00, #1e90ff);
  }
  .color-sample.vesta {
    background: linear-gradient(90deg, #ff6347, #32cd32, #4169e1);
  }
  .color-sample.alloy {
    background: linear-gradient(90deg, #ff4500, #ffd700, #00ced1);
  }
</style>
```

## Individual Color Schemes

```svelte example
<script>
  import { PeriodicTable } from 'matterviz'
  import { element_color_schemes } from 'matterviz/colors'
  import { ELEM_SYMBOLS } from 'matterviz/labels'

  const subtitles = {
    Vesta:
      'From the <a href="https://jp-minerals.org/vesta/en/" target="_blank" rel="noopener">VESTA</a> crystallographic visualization software',
    Jmol:
      'From the <a href="http://jmol.sourceforge.net/" target="_blank" rel="noopener">Jmol</a> molecular visualizer, based on <a href="https://en.wikipedia.org/wiki/CPK_coloring" target="_blank" rel="noopener">CPK coloring</a> (Corey-Pauling-Koltun)',
    Alloy:
      'Custom high-contrast scheme optimized for contrast between elements commonly co-occurring in metal alloys',
    Pastel: 'Custom pastel scheme with bright, less saturated colors',
    Muted:
      'Custom desaturated scheme for reduced visual strain but still trying to maintain some contrast',
    'Dark Mode':
      'Custom bright colors optimized for dark backgrounds and dark theme interfaces',
  }
</script>

{#each Object.entries(element_color_schemes) as [id, scheme]}
  {@const color_overrides = Object.fromEntries(
    ELEM_SYMBOLS.map((key) => [key, scheme[key] ?? 'transparent']),
  )}
  <section>
    <h3 {id}>{id}</h3>
    <p class="subtitle">{@html subtitles[id]}</p>
  </section>
  <PeriodicTable {color_overrides} labels={scheme} />
{/each}

<style>
  section {
    text-align: center;
    margin: 2em 0 -2em -20cqw;
  }
  h3 {
    font-size: 1.5rem;
  }
  .subtitle {
    max-width: 50cqw;
    margin: auto;
  }
</style>
```

Suggestions for new color schemes or improvements to the custom ones are welcome via [GitHub issues]({pkg.repository}/issues)!
