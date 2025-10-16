<script lang="ts">
  import { BrillouinZone } from '$lib'
  import { structure_map } from '$site/structures'

  const examples = [
    {
      id: `Po-simple-cubic`,
      label: `Simple Cubic (SC)`,
      description: `Po - cubic BZ`,
    },
    {
      id: `Fe-BCC`,
      label: `Body-Centered Cubic (BCC)`,
      description: `Fe - truncated octahedron BZ`,
    },
    {
      id: `Cu-FCC`,
      label: `Face-Centered Cubic (FCC)`,
      description: `Cu - rhombic dodecahedron BZ`,
    },
    {
      id: `mp-1207297-Ac2Br2O1-tetragonal`,
      label: `Tetragonal`,
      description: `Ac₂Br₂O - elongated/compressed octahedron`,
    },
    {
      id: `mp-862690-Ac4-hexagonal`,
      label: `Hexagonal`,
      description: `Ac - hexagonal prism BZ`,
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
    // {
    //   id: `mp-1183057-Ac3-trigonal`,
    //   label: `Trigonal`,
    //   description: `Ac - rhombohedral BZ`,
    // },
    {
      id: `mp-686119-Ag13Bi14I56-triclinic`,
      label: `Triclinic`,
      description: `Ag₁₃Bi₁₄I₅₆ - general parallelepiped BZ`,
    },
  ]

  const higher_order_examples = [
    {
      id: `Po-simple-cubic`,
      label: `Simple Cubic (SC)`,
      description: `2nd order BZ`,
      order: 2,
    },
    {
      id: `Fe-BCC`,
      label: `Body-Centered Cubic (BCC)`,
      description: `2nd order BZ`,
      order: 2,
    },
    {
      id: `Cu-FCC`,
      label: `Face-Centered Cubic (FCC)`,
      description: `3rd order BZ`,
      order: 3,
    },
    {
      id: `mp-862690-Ac4-hexagonal`,
      label: `Hexagonal`,
      description: `3rd order BZ`,
      order: 3,
    },
    {
      id: null,
      label: `Drag & Drop`,
      description: `Drop your structure file here`,
      order: 1,
    },
  ]

  let surface_opacity = $state(0.4)
</script>

<h1>Brillouin Zones</h1>

<label>
  Surface Opacity: {surface_opacity.toFixed(2)}
  <input type="range" min="0" max="1" step="0.05" bind:value={surface_opacity} />
</label>

<div class="full-bleed grid">
  {#each examples as { id, label, description } (id)}
    {@const structure = structure_map.get(id)}
    <div>
      <h3>{label}</h3>
      <p>{description}</p>
      <BrillouinZone {structure} {surface_opacity} />
    </div>
  {/each}
</div>

<h2 style="text-align: center; margin-block: 3em 1em">Higher-Order Brillouin Zones</h2>

<div class="full-bleed grid">
  {#each higher_order_examples as { id, label, description, order } (`${id}-${order}`)}
    {@const structure = id ? structure_map.get(id) : undefined}
    <div>
      <h3>{label}</h3>
      <p>{description}</p>
      <BrillouinZone
        {structure}
        {surface_opacity}
        bz_order={order}
        show_controls={true}
        allow_file_drop={true}
      />
    </div>
  {/each}
</div>

<style>
  .grid {
    text-align: center;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
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
  .full-bleed {
    h3 {
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
