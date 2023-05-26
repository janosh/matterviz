## `Structure.svelte`

```svelte example stackblitz code_above hideStyle
<script>
  import { Structure, StructureCard } from '$lib'
  import { structures } from '$site'
  import Select from 'svelte-multiselect'

  let mp_id = [`mp-756175`]
  let width
  let height
  $: href = `https://materialsproject.org/materials/${mp_id[0]}`
  $: structure = structures.find((struct) => struct.id === mp_id[0])
</script>

<form>
  <label for="select">Select a structure:</label>
  <Select
    id="select"
    options={structures.map((struct) => struct.id)}
    bind:selected={mp_id}
    maxSelect={1}
    minSelect={1}
  />

  <details>
    <summary>JSON for structure {mp_id[0]}</summary>
    <pre>
    <code>
    {JSON.stringify(structure, null, 2)}
    </code>
  </pre>
  </details>
</form>

<StructureCard {structure}>
  <a slot="title" {href}>{mp_id}</a>
</StructureCard>
<p>canvas width=<span>{width}</span>, height=<span>{height}</span></p>
<Structure {structure} bind:width bind:height />

<style>
  form {
    display: flex;
    gap: 1em;
    position: relative;
    align-items: center;
  }
  details > pre {
    position: absolute;
    top: 2em;
    left: 0;
    background: black;
    width: calc(100cqw - 2em);
    z-index: 2;
  }
  p {
    text-align: center;
  }
  p > span {
    color: orange;
  }
</style>
```

## Multiple Structures in a grid

```svelte example stackblitz code_above hideStyle
<script>
  import { Structure } from '$lib'
  import { structures } from '$site'
</script>

<ul>
  {#each structures as structure}
    {@const { id } = structure}
    <li>
      <h2>
        <a href="https://materialsproject.org/materials/{id}">{id}</a>
      </h2>
      <Structure {structure} />
    </li>
  {/each}
</ul>

<style>
  ul {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 1em;
    list-style: none;
    padding: 0;
    text-align: center;
  }
</style>
```
