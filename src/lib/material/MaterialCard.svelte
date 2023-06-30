<script lang="ts">
  import { InfoCard } from '$lib'
  import type { SummaryDoc } from '$lib/material'

  export let material: SummaryDoc
</script>

<InfoCard
  data={[
    { title: `Band Gap`, value: material.band_gap, unit: `eV` },
    {
      title: `Space Group`,
      value: `${material.symmetry.number} (${material.symmetry.symbol})`,
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
  ]}
  {...$$restProps}
/>
