<script lang="ts">
  import { pretty_num } from '$lib'
  import { alphabetical_formula, density, type PymatgenStructure } from '.'
  import InfoCard from '../InfoCard.svelte'

  interface Props {
    structure: PymatgenStructure
    title?: string
    [key: string]: unknown
  }
  let { structure, title = `Structure`, ...rest }: Props = $props()

  let { volume, a, b, c, alpha, beta, gamma } = $derived(structure?.lattice ?? {})
</script>

<InfoCard
  data={[
    { title: `Formula`, value: alphabetical_formula(structure) },
    { title: `Number of atoms`, value: structure?.sites?.length, fmt: `.0f` },
    { title: `Volume`, value: volume, unit: `Å³` },
    { title: `Density`, value: density(structure), unit: `g/cm³` },
    {
      title: `Lattice lengths a, b, c`,
      value: [a, b, c].map(pretty_num).join(`, `),
      unit: `Å`,
    },
    {
      title: `Lattice angles α, β, γ`,
      value: [alpha, beta, gamma].map(pretty_num).join(`°, `) + `°`,
    },
    // { title: 'Charge', value: structure?.charge },
  ]}
  {...rest}
  {title}
/>
