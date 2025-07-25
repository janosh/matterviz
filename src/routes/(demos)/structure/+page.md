<script>
</script>

# Structure

```svelte example
<script>
  import { Structure } from 'matterviz'
  import { structures } from '$site/structures'
  import Select from 'svelte-multiselect'
  import { FilePicker } from '$site'
  import { structure_files } from '$site/structures'
  import { get_electro_neg_formula } from '$lib'

  let structure = $state(
    structures.find((struct) => struct.id === `Bi2Zr2O7-Fm3m`) || {},
  )
</script>

<Structure bind:structure>
  <h3 style="position: absolute; left: 0; margin: 1ex 1em">
    {@html get_electro_neg_formula(structure)}
  </h3>
</Structure>

<FilePicker
  files={structure_files}
  show_category_filters
  category_labels={{ '🔷': `🔷 Crystal`, '🧬': `🧬 Molecule`, '❓': `❓ Unknown` }}
  style="max-width: var(--max-text-width); margin-block: 2em"
/>
```

## Different Crystal Systems

Showcasing structures with different crystal systems.

```svelte example
<script>
  import { crystal_systems, Structure } from 'matterviz'
  import { structures } from '$site/structures'
</script>

<ul class="crystal-systems">
  {#each structures.filter((struct) =>
      crystal_systems.some((system) => struct.id.includes(system))
    ) as
    structure
  }
    {@const mp_id = structure.id.split(`-`).slice(0, 2).join(`-`)}
    {@const href = `https://materialsproject.org/materials/${mp_id}`}
    {@const crystal_system = structure.id.split(`-`).at(-1) || 'unknown'}
    <li>
      <h3><a {href}>{mp_id}</a></h3>
      <p class="crystal-system">Crystal System <strong>{crystal_system}</strong></p>
      <Structure {structure} />
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
    color: var(--text-color-secondary, #888);
  }
  .crystal-system strong {
    color: var(--text-color-primary, #999);
    text-transform: capitalize;
  }
  ul.crystal-systems h3 {
    margin: 0.5em 0;
    font-size: 1.1em;
  }
</style>
```
