# Structure

```svelte example
<script lang="ts">
  import { page } from '$app/state'
  import { goto } from '$app/navigation'
  import { browser } from '$app/environment'
  import { Structure, type StructureHandlerData } from 'matterviz'
  import { MultiSelect as Select } from 'svelte-widgets'
  import { structure_files } from '$site/structures'
  import { molecule_files } from '$site/molecules'
  import FilePicker from '$lib/FilePicker.svelte'
  import { decode_url_safe_base64, get_electro_neg_formula } from '$lib'

  const default_filename = `Bi2Zr2O8-Fm3m.json`
  let source_filename = $state(default_filename)
  let display_filename = $state(default_filename)
  // Inline structure data from URL hash (used by ferrox render CLI)
  let hash_structure_string = $state<string>()

  const all_files = [...structure_files, ...molecule_files]
  function get_file_url(filename: string): string {
    const file_info = all_files.find((file) => file.name === filename)
    return file_info?.url || `/structures/${filename}`
  }

  $effect(() => {
    if (!browser) return
    // Support #structure=BASE64 for CLI-generated links (ferrox render).
    // Must use window.location.hash since SvelteKit's page.url.hash is always empty.
    const hash = window.location.hash
    if (hash.startsWith(`#structure=`)) {
      const raw = hash.slice(`#structure=`.length)
      const decoded = decode_url_safe_base64(raw)
      if (decoded !== undefined) {
        hash_structure_string = decoded
        display_filename = `CLI structure`
      } else {
        console.error(`Failed to decode base64 structure from URL hash`)
      }
      return
    }
    const file = page.url.searchParams.get(`file`)
    if (file && file !== source_filename) {
      source_filename = file
      display_filename = file
    }
  })
</script>

<Structure
  data_url={hash_structure_string ? undefined : get_file_url(source_filename)}
  structure_string={hash_structure_string}
  on_file_load={(data: StructureHandlerData) => {
    display_filename = data.filename ?? source_filename
    if (hash_structure_string) return
    source_filename = data.source_filename ?? source_filename
    page.url.searchParams.set(`file`, source_filename)
    goto(`${page.url.pathname}?${page.url.searchParams.toString()}`, {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    })
  }}
>
  <h3 style="position: absolute; margin: 1ex 1em; font-family: monospace; z-index: 1">
    {display_filename}
  </h3>
</Structure>

<FilePicker files={all_files} show_category_filters style="margin-block: 2em" />
```

## Explicit Bond Orders

MatterViz accepts explicit bond metadata on `structure.properties.bonds`. The
viewer still computes normal proximity bonds, but any matching explicit entries
set the rendered order, and explicit-only entries are added to the scene.

In **Edit Bonds** mode, **Add** is the safe default: click two atoms to add or
restore a bond without risking accidental deletion. Switch to **Delete** to remove
existing bonds by clicking them. Use the order selector for new bonds, or open a
bond's context menu to update an existing bond order interactively.

```svelte example
<script lang="ts">
  import { Structure } from 'matterviz'
  import type { Molecule } from 'matterviz'

  const bond_order_playground: Molecule = {
    id: `explicit-bond-order-playground`,
    sites: [
      {
        species: [{ element: `C`, occu: 1, oxidation_state: 0 }],
        abc: [-2.4, 0, 0],
        xyz: [-2.4, 0, 0],
        label: `C1`,
        properties: {},
      },
      {
        species: [{ element: `C`, occu: 1, oxidation_state: 0 }],
        abc: [-1.2, 0, 0],
        xyz: [-1.2, 0, 0],
        label: `C2`,
        properties: {},
      },
      {
        species: [{ element: `O`, occu: 1, oxidation_state: 0 }],
        abc: [0, 0, 0],
        xyz: [0, 0, 0],
        label: `O1`,
        properties: {},
      },
      {
        species: [{ element: `N`, occu: 1, oxidation_state: 0 }],
        abc: [1.2, 0, 0],
        xyz: [1.2, 0, 0],
        label: `N1`,
        properties: {},
      },
      {
        species: [{ element: `C`, occu: 1, oxidation_state: 0 }],
        abc: [-1.2, 1.25, 0],
        xyz: [-1.2, 1.25, 0],
        label: `C3`,
        properties: {},
      },
    ],
    properties: {
      bonds: [
        { site_idx_1: 0, site_idx_2: 1, order: 1 },
        { site_idx_1: 1, site_idx_2: 2, order: 2 },
        { site_idx_1: 2, site_idx_2: 3, order: 3 },
        { site_idx_1: 1, site_idx_2: 4, order: `aromatic` },
      ],
    },
  }
</script>

<Structure
  structure={bond_order_playground}
  show_controls="always"
  scene_props={{
    camera_position: [0, 0, 12],
    show_site_labels: true,
    show_site_indices: true,
    bonding_options: { strength_threshold: 10 },
  }}
  style="height: 520px"
/>
```

## Selective Dynamics

POSCAR files with a `Selective dynamics` block record a per-axis `T`/`F` flag triple
for every atom. Pick **Selective Dynamics** under _Appearance → Atoms → Color by_ to color
atoms by how constrained they are. The flags are per-axis, so there are three real
categories, not two: `free` (`T T T`), `partially fixed` (e.g. `T T F`, an atom pinned
out of plane but free to slide within it) and `fixed` (`F F F`). Sites that never declare
the property read as `unknown`; anything declared that is not three booleans throws rather
than being read as unconstrained. The mode is disabled for structures where no site
declares the property.

Like the other property modes, this feeds the atom legend, so clicking a category hides
those atoms. Handy for isolating the relaxing adlayer of a slab.

## Color Coding by Site Property

Pick **Site Property** under _Appearance → Atoms → Color by_ to map any per-atom scalar onto the color scale (OVITO's Color Coding). The **Property** dropdown next to it lists the keys actually present on the current structure's sites: extXYZ writes every column its `Properties=` string declares (`charge`, `c_pe`, `velocities`, ...) and LAMMPS dumps write every column past the coordinates (`vx vy vz` as `velocity`, `fx fy fz` as `force`, `q` as `charge`, computes and variables under their dump names). Vec3 properties are colored by their magnitude, so `velocity` gives a speed map. Sites that don't declare the selected key stay gray and are left out of the min/max the color bar shows, and the mode is disabled entirely for structures with no numeric site properties.

`velocity`/`velocities` also count as site-vector keys, so a dump carrying `vx vy vz` gets a velocity arrow layer under _Appearance → Site vectors_ with no extra configuration, next to the usual force and magmom layers.

## Dihedral (Torsion) Measurement

The measurement menu has a third mode next to Distance and Angle. Click exactly four
atoms and the viewer draws the p1-p2-p3-p4 chain and labels the central bond with the
**signed** torsion in (-180°, 180°]. The sign follows the IUPAC convention (viewed along
p2→p3, positive means the front bond p2→p1 rotates clockwise to eclipse the rear bond
p3→p4), so gauche+ and gauche- conformers, and a molecule versus its mirror image, are
distinguishable.

Displacements are chained through the minimum image convention, so a torsion whose atoms
straddle a cell boundary measures the real bonded geometry instead of the angle to a
distant periodic image. Three collinear consecutive atoms leave the torsion undefined and
report 0 rather than NaN.

## Zone-Axis Camera

_Camera → View → Look down_ points the camera along a crystallographic direction
while keeping the current viewing distance. Two index conventions are offered because
they only coincide for cubic cells:

- **Zone axis [uvw]** is a direct-lattice direction, `u·a + v·b + w·c`.
- **Plane normal (hkl)** needs the reciprocal lattice, `h·b1 + k·b2 + l·b3`.

For a triclinic cell the two can differ by tens of degrees for the same index triple.
The control is disabled for molecules, which have no lattice. The flight reuses the same
easing and pole handling as the orientation gizmo's axis handles.

## Comparing Two Structures

Pass a `reference_structure` alongside `structure` to overlay per-atom displacement
arrows showing what a relaxation moved. Displacements use the
minimum image convention, so an atom that relaxed across a cell face draws a short arrow
rather than one spanning the whole box. Sites pair up by index, so a mismatched atom count
or a reordered species list fails loudly instead of reporting a confident RMSD for atoms
that were never the same atom.

Arrow lengths are auto-scaled so the largest displacement spans a fixed fraction of the
atom spacing (relaxations are usually smaller than an atomic radius, so true-length arrows
would sit entirely inside their own atoms). The true numbers are reported instead: the
controls pane shows the RMSD and the largest single displacement, and `Structure` exposes
the RMSD through the bindable `displacement_rmsd` prop.

```svelte example
<script lang="ts">
  import type { AnyStructure, Vec3 } from 'matterviz'
  import { format_num, Structure } from 'matterviz'
  import { structures } from '$site/structures'

  const relaxed = structures.find(
    (struct) => `lattice` in struct && struct.sites.length > 3 && struct.sites.length < 30,
  ) as AnyStructure | undefined

  // Stand-in for an unrelaxed input geometry: a smooth per-atom offset, deliberately large
  // enough that some atoms end up on the far side of a cell face.
  const unrelaxed: AnyStructure | undefined = relaxed && {
    ...relaxed,
    sites: relaxed.sites.map((site, site_idx) => ({
      ...site,
      xyz: site.xyz.map(
        (coord, axis) => coord + 0.35 * Math.sin(1.7 * site_idx + 2.1 * axis),
      ) as Vec3,
    })),
  }

  let displacement_rmsd = $state<number | undefined>()
</script>

{#if relaxed && unrelaxed}
  <p>
    RMSD vs reference:
    <strong>
      {displacement_rmsd === undefined ? `-` : format_num(displacement_rmsd, `.4~f`)} Å
    </strong>
  </p>
  <Structure
    structure={relaxed}
    reference_structure={unrelaxed}
    bind:displacement_rmsd
    show_controls="always"
    style="height: 500px"
  />
{/if}
```

## Different Crystal Systems

Structures from several crystal systems.

```svelte example
<script lang="ts">
  import { CRYSTAL_SYSTEMS, Structure } from 'matterviz'
  import { structures } from '$site/structures'
</script>

<ul class="crystal-systems">
  {#each structures.filter( (struct) => CRYSTAL_SYSTEMS.some( (system) => struct.id.includes(system) ) ) as structure (structure.id)}
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

Load structures from text with `structure_string` (CIF, POSCAR, XYZ, JSON, …).

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
  &ensp;(parsed <strong>{parsed_structure?.sites?.length || 0}</strong> atoms from {format_num(
    selected_file.content.length,
  )}B)
</label>

<Structure structure_string={selected_file.content} bind:structure={parsed_structure} />
```
