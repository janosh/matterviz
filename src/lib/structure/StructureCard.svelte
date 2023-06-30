<script lang="ts">
  import { pretty_num } from '$lib'
  import { alphabetical_formula, density, type PymatgenStructure } from '.'
  import InfoCard from '../InfoCard.svelte'

  export let structure: PymatgenStructure

  $: ({ volume, a, b, c, alpha, beta, gamma } = structure?.lattice ?? {})
</script>

<InfoCard
  data={[
    { title: `Formula`, value: alphabetical_formula(structure) },
    { title: `Number of atoms`, value: structure?.sites.length },
    { title: `Volume`, value: volume, unit: `Å³` },
    { title: `Density`, value: density(structure), unit: `g/cm³` },
    {
      title: `Lattice lengths a, b, c`,
      value: [a, b, c].map(pretty_num).join(`, `),
      unit: `Å`,
    },
    {
      title: `Lattice angles α, β, γ`,
      value: [alpha, beta, gamma].map(pretty_num).join(`, `),
      unit: `°`,
    },
    // { title: 'Charge', value: structure?.charge },
  ]}
  {...$$restProps}
/>
