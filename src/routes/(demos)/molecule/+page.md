```svelte example stackblitz
<script>
  import { Structure } from '$lib'
  import { molecules } from '$site'
  import Select from 'svelte-multiselect'

  let name = [`water`]
  let width
  let height
  $: molecule = molecules.find((struct) => struct.name === name[0]) || {}
</script>

<form>
  <label for="select">Select a molecule:</label>
  <Select
    id="select"
    options={molecules.map((mol) => mol.name)}
    bind:selected={name}
    maxSelect={1}
    minSelect={1}
  />

  <details>
    <summary>JSON for molecule {name[0]}</summary>
    <pre>
    <code>
    {JSON.stringify(molecule, null, 2)}
    </code>
  </pre>
  </details>
</form>

<h3 align='center'>{name}</h3>
<Structure structure={molecule} bind:width bind:height />

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
