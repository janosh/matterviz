# Structure

```svelte example
<script lang="ts">
  import { page } from '$app/state'
  import { goto } from '$app/navigation'
  import { browser } from '$app/environment'
  import { Structure } from 'matterviz'
  import Select from 'svelte-multiselect'
  import { structure_files } from '$site/structures'
  import { molecule_files } from '$site/molecules'
  import FilePicker from '$lib/FilePicker.svelte'
  import { get_electro_neg_formula } from '$lib'

  let current_filename = $state(`Bi2Zr2O8-Fm3m.json`)

  const all_files = [...structure_files, ...molecule_files]
  function get_file_url(filename: string): string {
    const file_info = all_files.find((file) => file.name === filename)
    return file_info?.url || `/structures/${filename}`
  }

  $effect(() => {
    if (!browser) return
    const file = page.url.searchParams.get(`file`)
    if (file && file !== current_filename) current_filename = file
  })
</script>

<Structure
  data_url={get_file_url(current_filename)}
  on_file_load={(data: { filename: string }) => {
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
  files={all_files}
  show_category_filters
  style="margin-block: 2em"
/>
```

## Different Crystal Systems

Showcasing structures with different crystal systems.

```svelte example
<script lang="ts">
  import { CRYSTAL_SYSTEMS, Structure } from 'matterviz'
  import { structures } from '$site/structures'
</script>

<ul class="crystal-systems">
  {#each structures.filter((struct) =>
      CRYSTAL_SYSTEMS.some((system) => struct.id.includes(system))
    ) as
    structure
    (structure.id)
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

## Load Structure from String

You can load structures directly from text content using the `structure_string` prop, supporting various formats (CIF, POSCAR, XYZ, JSON, etc.).

```svelte example
<script lang="ts">
  import { Structure } from 'matterviz'
  import { format_num } from '$lib'
  import c2ho_scientific_notation_xyz from '$site/molecules/C2HO-scientific-notation.xyz?raw'
  import c5_extra_data_xyz from '$site/molecules/C5-extra-data.xyz?raw'
  import cyclohexane from '$site/molecules/cyclohexane.xyz?raw'
  import aviary_CuF3K_triolith from '$site/structures/aviary-CuF3K-triolith.poscar?raw'
  import ba_ti_o3_tetragonal from '$site/structures/BaTiO3-tetragonal.poscar?raw'
  import mof_issue_127 from '$site/structures/mof-issue-127.cif?raw'
  import na_cl_cubic from '$site/structures/NaCl-cubic.poscar?raw'
  import ru_p_complex_cif from '$site/structures/P24Ru4H252C296S24N16.cif?raw'
  import pf_sd_1601634_cif from '$site/structures/PF-sd-1601634.cif?raw'
  import extended_xyz_quartz from '$site/structures/quartz.extxyz?raw'
  import scientific_notation_poscar from '$site/structures/scientific-notation.poscar?raw'
  import selective_dynamics from '$site/structures/selective-dynamics.poscar?raw'
  import tio2_cif from '$site/structures/TiO2.cif?raw'
  import vasp4_format from '$site/structures/vasp4-format.poscar?raw'

  const structure_files = [
    { name: `MOF (CIF)`, content: mof_issue_127 },
    { name: `Ru Complex (CIF)`, content: ru_p_complex_cif },
    { name: `PF Structure (CIF)`, content: pf_sd_1601634_cif },
    { name: `Cyclohexane (XYZ)`, content: cyclohexane },
    { name: `C2HO (XYZ)`, content: c2ho_scientific_notation_xyz },
    { name: `C5 (XYZ)`, content: c5_extra_data_xyz },
    { name: `CuF3K (POSCAR)`, content: aviary_CuF3K_triolith },
    { name: `BaTiO3 (POSCAR)`, content: ba_ti_o3_tetragonal },
    { name: `NaCl (POSCAR)`, content: na_cl_cubic },
    { name: `Quartz (ExtXYZ)`, content: extended_xyz_quartz },
    { name: `Scientific Notation (POSCAR)`, content: scientific_notation_poscar },
    { name: `Selective Dynamics (POSCAR)`, content: selective_dynamics },
    { name: `TiO2 (CIF)`, content: tio2_cif },
    { name: `VASP4 Format (POSCAR)`, content: vasp4_format },
  ]

  let selected_idx = $state(0)
  let parsed_structure = $state(undefined)
  let selected_file = $derived(structure_files[selected_idx])
</script>

<label style="display: block; margin-block: 1em">
  Structure:
  <select bind:value={selected_idx}>
    {#each structure_files as file, idx (file.name)}
      <option value={idx}>{file.name}</option>
    {/each}
  </select>
  &ensp;(parsed <strong>{parsed_structure?.sites?.length || 0}</strong> atoms from {
    format_num(selected_file.content.length)
  }B)
</label>

<Structure
  structure_string={selected_file.content}
  bind:structure={parsed_structure}
/>
```
