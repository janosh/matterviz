```svelte example stackblitz
<script>
  import { Structure } from '$lib'
  import { molecules } from '$site'
  import Select from 'svelte-multiselect'

  let name = `benzene`
  let molecule = $derived(molecules.find((struct) => struct.name === name) || {})
</script>

<form>
  <label for="select">Select a molecule:</label>
  <Select
    id="select"
    options={molecules.map((mol) => mol.name)}
    selected={[name]}
    bind:value={name}
    maxSelect={1}
    minSelect={1}
  />

  <details>
    <summary>JSON for molecule {name}</summary>
    <pre>
    <code>
    {JSON.stringify(molecule, null, 2)}
    </code>
  </pre>
  </details>
</form>

<h3 align='center'>{name}</h3>
<Structure structure={molecule} bonding_strategy="max_dist" bonding_options={{max_bond_dist: 2}} />

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
</style>
```
