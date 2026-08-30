<script lang="ts">
  import { SlabBuilder } from '$lib/slab'
  import type { Slab } from '$lib/slab'
  import type { Crystal } from '$lib/structure'
  import { Structure } from '$lib/structure'
  import bi2zr2o8 from '$site/structures/Bi2Zr2O8-Fm3m.json'
  import cs_bcc from '$site/structures/mp-1.json'
  import ac_tetragonal from '$site/structures/mp-1207297-Ac2Br2O1-tetragonal.json'
  import al_lu from '$site/structures/mp-1234.json'
  import pd_fcc from '$site/structures/mp-2.json'
  import ac_hexagonal from '$site/structures/mp-862690-Ac4-hexagonal.json'
  import po_cubic from '$site/structures/Po-simple-cubic.json'

  const bulk_structures = {
    'Pd (fcc)': pd_fcc,
    'Cs (bcc)': cs_bcc,
    'Po (simple cubic)': po_cubic,
    'AlLu (cubic)': al_lu,
    'Ac (hexagonal)': ac_hexagonal,
    'Ac2Br2O (tetragonal)': ac_tetragonal,
    'Bi2Zr2O8 (disordered)': bi2zr2o8,
  } as unknown as Record<string, Crystal>

  let selected = $state(`Pd (fcc)`)
  let slab = $state<Slab | null>(null)
  const bulk = $derived(bulk_structures[selected])
</script>

<h1>Surface Slabs</h1>

<p class="demo-intro">
  Cut a bulk crystal along a set of (hkl) lattice planes. The cell is rebuilt so that c crosses
  the planes exactly once, the atoms are grouped into layers, the crystal is cleaved at the
  chosen termination and vacuum is opened up along the surface normal. Miller indices refer to
  the axes of the bulk cell shown on the left, where the (hkl) lattice planes are drawn in
  orange.
</p>

<div class="bleed-1400">
  <SlabBuilder structure={bulk} bind:slab>
    <label>
      Bulk
      <select bind:value={selected}>
        {#each Object.keys(bulk_structures) as key (key)}
          <option value={key}>{key}</option>
        {/each}
      </select>
    </label>
  </SlabBuilder>

  <section class="demo-2col">
    <!-- planes follow the slab's validated, gcd-reduced indices so invalid input (000) draws
      nothing instead of throwing inside the scene and (222) shows the same planes as the
      (111) slab it builds -->
    <Structure
      structure={bulk}
      scene_props={{
        lattice_planes: slab ? [{ hkl: slab.slab_info.miller_indices }] : [],
      }}
    >
      <p class="demo-overlay-label">Bulk · {selected}</p>
    </Structure>
    {#if slab}
      <Structure structure={slab}>
        <p class="demo-overlay-label">Slab · ({slab.slab_info.miller_indices.join(` `)})</p>
      </Structure>
    {/if}
  </section>
</div>

<style>
  .bleed-1400 :global(.slab-builder .controls) {
    justify-content: center;
    margin: 1em 0;
  }
  .demo-2col {
    gap: 1.5em;
    --struct-height: 600px;
  }
</style>
