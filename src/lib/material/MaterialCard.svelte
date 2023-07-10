<script lang="ts">
  import { InfoCard } from '$lib'
  import type { SummaryDoc } from '$types'

  export let material: SummaryDoc

  $: data = [
    {
      title: `Band Gap`,
      value: material.band_gap,
      unit: `eV`,
      tooltip:
        material.vbm && material.cbm ? `VBM: ${material.vbm}, CBM: ${material.cbm}` : ``,
    },
    {
      title: `Space Group`,
      value: `${material.symmetry?.number}`,
      unit: `(${material.symmetry?.symbol})`,
      condition: material.symmetry?.number,
    },
    {
      title: `E<sub>above hull</sub>`,
      value: 1000 * (material?.energy_above_hull ?? 0),
      unit: `meV/atom`,
      condition: material?.energy_above_hull,
    },
    {
      title: `Formation Energy`,
      value: material.formation_energy_per_atom,
      unit: `eV/atom`,
    },
    { title: `Experimentally Observed`, value: material.theoretical ? `No` : `Yes` },
    { title: `Total Energy`, value: material.energy_per_atom, unit: `eV/atom` },
    {
      title: `Uncorrected Energy`,
      value: material.uncorrected_energy_per_atom,
      unit: `eV/atom`,
      condition: material.uncorrected_energy_per_atom != material.energy_per_atom,
    },
    {
      title: `Last updated`,
      value: material.last_updated?.$date.split(`T`)[0],
    },
    {
      title: `Origins`,
      value: material.origins,
      condition: material.origins?.length,
    },
  ].filter((itm) => itm?.condition ?? true)
</script>

<InfoCard {data} {...$$restProps} />

<details>
  <summary>Related materials IDs</summary>
  {#if material.task_ids?.length}
  <p>
    Task IDs: {#each material.task_ids as id}
      <a href="https://materialsproject.org/tasks/{id}">{id}</a>
    {/each}
  </p>
{/if}
{#if material.database_IDs.icsd?.length}

<p>
  ICSD IDs: {#each material.database_IDs.icsd as id}
    <a href="https://ccdc.cam.ac.uk/structures/Search?Ccdcid={id}&DatabaseToSearch=ICSD">{id}</a>
  {/each}
</p>
{/if}
</details>

<p class="warning">
  {material.warnings}
</p>

<style>
  .warning {
    color: var(--warning-color, darkred);
  }
  p {
    display: flex;
    flex-wrap: wrap;
    gap: 0 1em;
  }
</style>
