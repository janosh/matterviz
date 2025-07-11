`Nucleus.svelte`

```svelte example code_above
<script>
  import { element_data, Nucleus } from '$lib'
</script>

<ul>
  {#each element_data as { protons, neutrons, symbol, name }}
    <li>
      <a href="/{name.toLowerCase()}">{symbol}</a>
      <Nucleus {protons} {neutrons} />
    </li>
  {/each}
</ul>

<style>
  ul {
    list-style: none;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: 2em;
    margin: 2em 0;
    padding: 0;
  }
  ul > li {
    position: relative;
  }
  ul > li > a {
    position: absolute;
    top: -1em;
    color: var(--color-text);
  }
</style>
```
