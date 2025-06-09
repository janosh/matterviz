<script>
  import pkg from '$root/package.json'
</script>

# Element Color Schemes

```svelte example
<script>
  import { PeriodicTable } from '$lib'
  import { element_color_schemes } from '$lib/colors'
  import { elem_symbols } from '$lib/labels'

  const subtitles = {
    Vesta: 'From the <a href="https://jp-minerals.org/vesta/en/" target="_blank" rel="noopener">VESTA</a> crystallographic visualization software',
    Jmol: 'From the <a href="http://jmol.sourceforge.net/" target="_blank" rel="noopener">Jmol</a> molecular visualizer, based on <a href="https://en.wikipedia.org/wiki/CPK_coloring" target="_blank" rel="noopener">CPK coloring</a> (Corey-Pauling-Koltun)',
    Alloy: 'Custom high-contrast scheme optimized for contrast between elements commonly co-occurring in metal alloys',
    Pastel: 'Custom pastel scheme with bright, less saturated colors',
    Muted: 'Custom desaturated scheme for reduced visual strain but still trying to maintain some contrast',
    'Dark Mode': 'Custom bright colors optimized for dark backgrounds and dark theme interfaces',
  }
</script>

{#each Object.entries(element_color_schemes) as [id, scheme]}
  {@const color_overrides = Object.fromEntries(elem_symbols.map(((key) => [key, scheme[key] ?? 'transparent'])))}
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
    font-size: 5cqw;
  }
  .subtitle {
    max-width: 50cqw;
    margin: auto;
  }
</style>
```

Suggestions for new color schemes or improvements to the custom ones are welcome via [GitHub issues]({pkg.repository}/issues)!
