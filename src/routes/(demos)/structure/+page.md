## `Structure.svelte`

```svelte example stackblitz code_above hideStyle
<script>
  import { Structure, StructureCard } from '$lib'
  import Select from 'svelte-multiselect'

  const structs = import.meta.glob(`./mp-*.json`, {
    eager: true,
    import: `default`,
  })

  let mp_id = [`mp-756175`]
  let width
  let height
  $: href = `https://materialsproject.org/materials/${mp_id[0]}`
  $: structure = structs[`./${mp_id[0]}.json`] ?? {}
</script>

<form>
  <label for="select">Select a structure:</label>
  <Select
    id="select"
    options={Object.keys(structs).map((k) => k.slice(2, -5))}
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
