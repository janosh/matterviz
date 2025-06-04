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

  let mp_id = $state(`Bi2Zr2O7-Fm3m`)
  let width = $state(0)
  let height = $state(0)
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

## Different Crystal Systems

Showcasing structures with different crystal systems.

```svelte example stackblitz
<script>
  import { Structure, crystal_systems } from '$lib'
  import { structures } from '$site'
</script>

<ul class="crystal-systems">
  {#each structures.filter(struct => crystal_systems.some(system => struct.id.includes(system))) as structure}
    {@const { id } = structure}
    {@const href = `https://materialsproject.org/materials/${id.split('-')[0]}-${id.split('-')[1]}`}
    {@const crystal_system = id.split('-').at(-1) || 'unknown'}
    <li>
      <h3><a {href}>{id.split('-')[0]}-{id.split('-')[1]}</a></h3>
      <p class="crystal-system">Crystal System: <strong>{crystal_system}</strong></p>
      <Structure {structure} style="--struct-height: 400px;" />
    </li>
  {/each}
</ul>

<style>
  ul.crystal-systems {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(500px, 1fr));
    gap: 1.5em;
    list-style: none;
    padding: 0;
    text-align: center;
    width: 95vw;
    margin: 2em calc(50cqw - 47.5vw);
  }
  .crystal-system {
    margin: 0.5em 0;
    font-size: 0.9em;
    color: var(--text-color-secondary, #666);
  }
  .crystal-system strong {
    color: var(--text-color-primary, #333);
    text-transform: capitalize;
  }
  ul.crystal-systems h3 {
    margin: 0.5em 0;
    font-size: 1.1em;
  }
</style>
```
