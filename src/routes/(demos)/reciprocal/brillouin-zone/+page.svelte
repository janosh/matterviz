<script lang="ts">
  import LazyDemo from '#site/LazyDemo.svelte'
  import { BrillouinZone } from '#lib'
  import FilePicker from '#lib/FilePicker.svelte'
  import type { FileInfo } from '#lib/io/types.js'
  import { format_num } from '#lib/labels.js'
  import type { Crystal } from '#lib/structure/index.js'
  import { is_crystal } from '#lib/structure/validation.js'
  import { parse_structure_fixture, structure_files, structure_map } from '#site/structures.js'

  let dropped_structure = $state<Crystal | undefined>()
  // A Brillouin zone needs a lattice, so molecules stay out of the picker
  const crystal_files = structure_files.filter((file) => file.category === `crystal`)

  // any fixture format (CIF, POSCAR, ...), not only the plain-JSON ones in structure_map
  function handle_file_pick(file: FileInfo) {
    const struct = parse_structure_fixture(file.name)
    if (is_crystal(struct)) dropped_structure = struct
  }

  type BZExample = {
    id: string
    label: string
    description: string
  }

  const examples: BZExample[] = [
    {
      id: `Po-simple-cubic`,
      label: `Simple Cubic (SC)`,
      description: `Po - cubic BZ, IBZ wedge 1/48th of it`,
    },
    {
      id: `Fe-BCC`,
      label: `Body-Centered Cubic (BCC)`,
      description: `Fe - truncated octahedron BZ`,
    },
    {
      id: `Cu-FCC`,
      label: `Face-Centered Cubic (FCC)`,
      description: `Cu - rhombic dodecahedron`,
    },
    {
      id: `mp-1207297-Ac2Br2O1-tetragonal`,
      label: `Tetragonal`,
      description: `Ac₂Br₂O - elongated/compressed octahedron`,
    },
    {
      id: `mp-862690-Ac4-hexagonal`,
      label: `Hexagonal`,
      description: `Ac - hexagonal prism`,
    },
    {
      id: `mp-1183085-Ac4Mg2-orthorhombic`,
      label: `Orthorhombic`,
      description: `Ac₄Mg₂ - rectangular prism BZ`,
    },
    {
      id: `mp-1183089-Ac4Mg2-monoclinic`,
      label: `Monoclinic`,
      description: `Ac₄Mg₂ - oblique prism BZ`,
    },
    {
      id: `mp-686119-Ag13Bi14I56-triclinic`,
      label: `Triclinic`,
      description: `Ag₁₃Bi₁₄I₅₆ - general parallelepiped BZ`,
    },
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
      label: examples.find((example) => example.id === id)?.label,
      description: `${order === 2 ? `2nd` : `3rd`} order BZ`,
      order,
    })),
    { id: null, label: `Drag & Drop`, description: `Drop your structure file here`, order: 1 },
  ]

  let surface_opacity = $state(0.4)
</script>

<h1 id="brillouin-zones">Brillouin Zones</h1>

<label>
  Surface Opacity: {format_num(surface_opacity, `.2f`)}
  <input type="range" min="0" max="1" step="0.05" bind:value={surface_opacity} />
</label>

<div class="full-bleed grid">
  {#each examples as { id: identifier, label, description } (identifier)}
    {@const structure = structure_map.get(identifier)}
    <div>
      <h2>{label}</h2>
      <p>{description}</p>
      <LazyDemo label="brillouin zone">
        <BrillouinZone {structure} {surface_opacity} show_ibz />
      </LazyDemo>
    </div>
  {/each}
</div>

<h2 id="try-your-own-structure" style="text-align: center; margin-block: 3em 1em">
  Try Your Own Structure
</h2>
<p style="text-align: center; color: var(--text-color-muted)">
  Pick a file or drag &amp; drop a structure (CIF, POSCAR, JSON) onto the viewer.
</p>

<div class="try-own">
  <FilePicker
    files={crystal_files}
    show_category_filters
    on_click={handle_file_pick}
    style="max-width: 600px; margin-inline: auto"
  />
  <LazyDemo label="Try Your Own Structure" height="450px">
    <BrillouinZone
      bind:structure={dropped_structure}
      {surface_opacity}
      show_ibz
      show_controls
      allow_file_drop
      style="height: 450px"
    />
  </LazyDemo>
</div>

<h2 id="higher-order-brillouin-zones" style="text-align: center; margin-block: 3em 1em">
  Higher-Order Brillouin Zones
</h2>

<div class="full-bleed grid">
  {#each higher_order_examples as { id: identifier, label, description, order } (`${identifier}-${order}`)}
    {@const structure = identifier ? structure_map.get(identifier) : undefined}
    <div>
      <h2>{label}</h2>
      <p>{description}</p>
      <LazyDemo label="brillouin zone">
        <BrillouinZone
          {structure}
          {surface_opacity}
          bz_order={order}
          show_ibz
          show_controls
          allow_file_drop
        />
      </LazyDemo>
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
  h1 {
    text-align: center;
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
