<script lang="ts">
  import { format_num, InfoCard } from '$lib'
  import { density, electro_neg_formula, type PymatgenStructure } from '.'

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
    { title: `Formula`, value: electro_neg_formula(structure) },
    { title: `Number of atoms`, value: structure?.sites?.length, fmt: `.0f` },
    { title: `Volume`, value: volume, unit: `Å³` },
    { title: `Density`, value: density(structure), unit: `g/cm³` },
    {
      title: `Lattice lengths a, b, c`,
      value: [a, b, c].map(format_num).join(`, `),
      unit: `Å`,
    },
    {
      title: `Lattice angles α, β, γ`,
      value: [alpha, beta, gamma].map(format_num).join(`°, `) + `°`,
    },
    // { title: 'Charge', value: structure?.charge },
  ]}
  {...rest}
  {title}
/>
