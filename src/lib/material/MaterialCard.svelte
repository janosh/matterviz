<script lang="ts">
  import { InfoCard } from '$lib'
  import type { SummaryDoc } from '$lib/material'

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
      value: `${material.symmetry.number}`,
      unit: `(${material.symmetry.symbol})`,
    },
    {
      title: `E<sub>above hull</sub>`,
      value: 1000 * material.energy_above_hull,
      unit: `meV/atom`,
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
      value: material.last_updated.$date.split(`T`)[0],
    },
    {
      title: `Origins`,
      value: material.origins,
      condition: material.origins?.length,
    },
    {
      title: `Database IDs`,
      value: material.database_IDs.icsd,
      condition: material.database_IDs?.icsd?.length ?? false,
    },
  ].filter((itm) => itm?.condition ?? true)
</script>

<InfoCard {data} {...$$restProps} />

{#if material.task_ids?.length}
  <p>
    Task IDs: {@html material.task_ids
      .filter((id) => id != material.material_id)
      .map((id) => `<a href="https://materialsproject.org/tasks/${id}">${id}</a>`)
      .join(`, `)}
  </p>
{/if}

<p class="warning">
  {material.warnings}
</p>

<style>
  .warning {
    color: var(--warning-color, darkred);
  }
</style>
