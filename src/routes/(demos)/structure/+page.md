<script>
  import { FileDetails } from 'svelte-zoo'

  const structure_code_files = import.meta.glob('$lib/Structure*', {
    query: '?raw',
    import: 'default',
    eager: true,
  })
  const files = Object.entries(structure_code_files).map(([path, content]) => {
    return { title: path, content }
  })
</script>

## Select Structure from Dropdown

```svelte example stackblitz
<script>
  import { Structure, StructureCard } from '$lib'
  import { structures } from '$site'
  import Select from 'svelte-multiselect'

  let mp_id = `Bi2Zr2O7-Fm3m`
  let width = 0
  let height = 0
  let href = $derived(`https://materialsproject.org/materials/${mp_id}`)
  let structure = $derived(structures.find((struct) => struct.id === mp_id) || {})
</script>

<form>
  <label for="select">Select a structure:</label>
  <Select
    id="select"
    options={structures.map((struct) => struct.id)}
    selected={[mp_id]}
    bind:value={mp_id}
    maxSelect={1}
    minSelect={1}
  />

  <details>
    <summary>JSON for structure {mp_id}</summary>
    <pre>
    <code>
    {JSON.stringify(structure, null, 2)}
    </code>
  </pre>
  </details>
</form>

<h3 align='center'><a {href}>{mp_id}</a></h3>
<StructureCard {structure} />
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

<FileDetails {files} />

## Structures in a grid

Just to show off you can load several without the page getting too slow.

```svelte example stackblitz
<script>
  import { Structure } from '$lib'
  import { structures } from '$site'
</script>

<ul>
  {#each structures.filter(({sites}) => sites.length < 80) as structure}
    {@const { id } = structure}
    {@const href = `https://materialsproject.org/materials/${id}`}
    <li>
      <h2><a {href}>{id}</a></h2>
      <Structure {structure} />
    </li>
  {/each}
</ul>

<style>
  ul {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(500px, 1fr));
    gap: 1em;
    list-style: none;
    padding: 0;
    text-align: center;
    width: 90vw;
    margin: 0 calc(50cqw - 45vw);
  }
</style>
```
