<script>
</script>

# Structure

```svelte example
<script>
  import { page } from '$app/state'
  import { goto } from '$app/navigation'
  import { browser } from '$app/environment'
  import { Structure } from 'matterviz'
  import Select from 'svelte-multiselect'
  import { structure_files } from '$site/structures'
  import { molecule_files } from '$site/molecules'
  import { FilePicker, get_electro_neg_formula } from '$lib'

  let current_filename = $state(`Bi2Zr2O8-Fm3m.json`)

  $effect(() => {
    if (!browser) return
    const file = page.url.searchParams.get(`file`)
    if (file && file !== current_filename) current_filename = file
  })
</script>

<Structure
  data_url="/structures/{current_filename}"
  on_file_load={(data) => {
    current_filename = data.filename
    page.url.searchParams.set(`file`, current_filename)
    goto(`${page.url.pathname}?${page.url.searchParams.toString()}`, {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    })
  }}
>
  <h3 style="position: absolute; margin: 1ex 1em; font-family: monospace; z-index: 1">
    {current_filename}
  </h3>
</Structure>

<FilePicker
  files={[...structure_files, ...molecule_files]}
  show_category_filters
  category_labels={{ '🔷': `🔷 Crystal`, '🧬': `🧬 Molecule`, '❓': `❓ Unknown` }}
  style="margin-block: 2em"
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
      <h3><a {href}>{mp_id}</a> <small>{crystal_system}</small></h3>
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
  ul.crystal-systems h3 {
    margin: 0.5em auto;
    font-size: 1.1em;
    display: flex;
    place-items: center;
    place-content: center;
  }
  ul.crystal-systems small {
    margin: 0 0 0 0.5em;
    font-weight: lighter;
    color: var(--text-color-muted);
  }
</style>
```
