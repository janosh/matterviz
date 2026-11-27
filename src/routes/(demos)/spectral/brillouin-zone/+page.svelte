<script lang="ts">
  import { url_selection } from '#site/state.svelte'
  import { format_num } from 'svelte-widgets/format'
  import LazyMount from 'svelte-widgets/LazyMount.svelte'
  import { BrillouinZone } from '#lib'
  import FilePicker from '#lib/FilePicker.svelte'
  import type { Crystal } from '#lib/structure/index'
  import { is_crystal } from '#lib/structure/validation'
  import { parse_structure_fixture, structure_files, structure_map } from '#site/structures'

  let dropped_structure = $state<Crystal | undefined>()
  // A Brillouin zone needs a lattice, so molecules stay out of the picker
  const crystal_files = structure_files.filter((file) => file.category === `crystal`)

  // the picked fixture in ?file=, any format (CIF, POSCAR, ...), not only structure_map's JSON
  const crystal_names = crystal_files.map(({ name }) => name)
  const picked = url_selection(`file`, crystal_names, ``)
  $effect(() => {
    if (!picked.value) return
    const struct = parse_structure_fixture(picked.value)
    if (is_crystal(struct)) dropped_structure = struct
  })

  // [structure id, label, description]
  // oxfmt-ignore
  const examples: [string, string, string][] = [
    [`Po-simple-cubic`, `Simple Cubic (SC)`, `Po - cubic BZ, IBZ wedge 1/48th of it`],
    [`Fe-BCC`, `Body-Centered Cubic (BCC)`, `Fe - truncated octahedron BZ`],
    [`Cu-FCC`, `Face-Centered Cubic (FCC)`, `Cu - rhombic dodecahedron`],
    [`mp-1207297-Ac2Br2O1-tetragonal`, `Tetragonal`, `Ac₂Br₂O - elongated/compressed octahedron`],
    [`mp-862690-Ac4-hexagonal`, `Hexagonal`, `Ac - hexagonal prism`],
    [`mp-1183085-Ac4Mg2-orthorhombic`, `Orthorhombic`, `Ac₄Mg₂ - rectangular prism BZ`],
    [`mp-1183089-Ac4Mg2-monoclinic`, `Monoclinic`, `Ac₄Mg₂ - oblique prism BZ`],
    [`mp-686119-Ag13Bi14I56-triclinic`, `Triclinic`, `Ag₁₃Bi₁₄I₅₆ - general parallelepiped BZ`],
  ]

  // [example id, BZ order]: labels come from the matching first-order example
  const higher_order_ids = [
    [`Po-simple-cubic`, 2],
    [`Fe-BCC`, 2],
    [`Cu-FCC`, 3],
    [`mp-862690-Ac4-hexagonal`, 3],
  ] as const
  const higher_order_examples = [
    ...higher_order_ids.map(([id, order]) => ({
      id,
      label: examples.find(([example_id]) => example_id === id)?.[1] ?? id,
      description: `${order === 2 ? `2nd` : `3rd`} order BZ`,
      order,
    })),
    { id: null, label: `Drag & Drop`, description: `Drop your structure file here`, order: 1 },
  ]

  let surface_opacity = $state(0.4)
  // Setyawan–Curtarolo high-symmetry path from each structure's symmetry
  let default_k_path = $state(true)
</script>

<h1 id="brillouin-zones">Brillouin Zones</h1>

<label>
  Surface Opacity: {format_num(surface_opacity, `.2f`)}
  <input type="range" min="0" max="1" step="0.05" bind:value={surface_opacity} />
</label>
<label>
  <input type="checkbox" bind:checked={default_k_path} /> High-symmetry k-path
</label>

<div class="full-bleed grid">
  {#each examples as [identifier, label, description] (identifier)}
    {@const structure = structure_map.get(identifier)}
    <div>
      <h2>{label}</h2>
      <p>{description}</p>
      <LazyMount label="{label}: {description}">
        <BrillouinZone {structure} {surface_opacity} show_ibz {default_k_path} />
      </LazyMount>
    </div>
  {/each}
</div>

<h2 id="try-your-own-structure" style="margin-block: 3em 1em">Try Your Own Structure</h2>
<p class="demo-intro" style="color: var(--text-color-muted)">
  Pick a file or drag &amp; drop a structure (CIF, POSCAR, JSON) onto the viewer.
</p>

<div class="try-own">
  <FilePicker
    files={crystal_files}
    show_category_filters
    active_files={picked.value ? [picked.value] : []}
    on_click={({ name }) => (picked.value = name)}
    style="max-width: 600px; margin-inline: auto"
  />
  <LazyMount label="Try Your Own Structure" height="450px">
    <BrillouinZone
      bind:structure={dropped_structure}
      {surface_opacity}
      show_ibz
      show_controls
      allow_file_drop
      style="height: 450px"
    />
  </LazyMount>
</div>

<h2 id="higher-order-brillouin-zones" style="margin-block: 3em 1em">
  Higher-Order Brillouin Zones
</h2>

<div class="full-bleed grid">
  {#each higher_order_examples as { id: identifier, label, description, order } (`${identifier}-${order}`)}
    {@const structure = identifier ? structure_map.get(identifier) : undefined}
    <div>
      <h2>{label}</h2>
      <p>{description}</p>
      <LazyMount label="{label}: {description}">
        <BrillouinZone
          {structure}
          {surface_opacity}
          bz_order={order}
          show_ibz
          show_controls
          allow_file_drop
        />
      </LazyMount>
    </div>
  {/each}
</div>

<style>
  .grid {
    text-align: center;
    display: grid;
    /* min(400px, 100%) keeps a single column from forcing horizontal page scroll on phones */
    grid-template-columns: repeat(auto-fit, minmax(min(400px, 100%), 1fr));
    gap: 2em;
    margin-block: 2em;
  }
  label {
    display: block;
    text-align: center;
  }
  .try-own {
    max-width: 800px;
    margin: 1em auto 0;
    display: grid;
    gap: 1em;
  }
  .full-bleed {
    h2 {
      margin: 0;
    }
    > div {
      display: grid;
      grid-template-rows: subgrid;
      grid-row: span 3;
      gap: 0;
    }
    p {
      text-align: center;
      color: var(--text-color-muted);
      font-size: 0.9em;
    }
  }
</style>
