`Nucleus.svelte`

```svelte example stackblitz code_above
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
    display: flex;
    flex-wrap: wrap;
    gap: 2em;
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
