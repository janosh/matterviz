<script>
  import { Structure, StructureCard } from '$lib'
  import { structures } from '$site'
  import Select from 'svelte-multiselect'

  let mp_id = `Bi2Zr2O7-Fm3m`
  let width
  let height
  $: href = `https://materialsproject.org/materials/${mp_id}`
  $: structure = structures.find((struct) => struct.id === mp_id) || {}
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

<h3 align="center"><a {href}>{mp_id}</a></h3>
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
