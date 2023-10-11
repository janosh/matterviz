<script lang="ts">
  import { InfoCard } from '$lib'
  import type { SummaryDoc } from '$types'

  export let title: string = `Symmetry`

  export let material: SummaryDoc

  $: data = [
    {
      title: `Crystal System`,
      value: `${material.symmetry?.crystal_system}`,
    },
    {
      title: `International Number`,
      value: material.symmetry?.number,
    },
    {
      title: `Point Group`,
      value: `${material.symmetry?.point_group}`,
    },
    {
      title: `Symbol`,
      value: `${material.symmetry?.symbol}`,
    },
  ]
</script>

<InfoCard {data} {...$$restProps} {title} />
