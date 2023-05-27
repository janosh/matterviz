## Element Color Schemes

```svelte example
<script>
  import { PeriodicTable } from '$lib'
  import { element_color_schemes } from '$lib/colors'
  import { elem_symbols } from '$lib/labels'
</script>

{#each Object.entries(element_color_schemes) as [id, scheme]}
  {@const color_overrides = Object.fromEntries(elem_symbols.map(((key) => [key, scheme[key] ?? 'transparent'])))}
  <h3 {id}>{id}</h3>
  <PeriodicTable {color_overrides} labels={scheme} />
{/each}

<style>
  h3 {
    text-align: center;
    margin: 2em 0 -2em -20cqw;
    font-size: 5cqw;
  }
</style>
```
