<script>
  import struct_json from './mp-1234.json?raw'
</script>

## `Structure.svelte`

```svelte example stackblitz code_above
<script>
  import { Structure, StructureCard } from '$lib'
  import structure from './mp-1234.json'

  const mp_id = 'mp-1234'
  const href = `https://materialsproject.org/materials/${mp_id}`
</script>

<StructureCard {structure}>
  <a slot="title" {href}>{mp_id}</a>
</StructureCard>
<Structure {structure} />
```

<details>
  <summary>JSON Structure for mp-1234</summary>
  <pre>
    <code>
    {struct_json}
    </code>
  </pre>
</details>
