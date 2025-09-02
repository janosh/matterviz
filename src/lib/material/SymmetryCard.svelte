<script lang="ts">
  import { InfoCard } from '$lib'
  import type { HTMLAttributes } from 'svelte/elements'
  // import type { SummaryDoc } from '$types'

  interface Props extends HTMLAttributes<HTMLElementTagNameMap[`section`]> {
    title?: string
    material: Record<string, unknown> // previously SummaryDoc
  }
  let { title = `Symmetry`, material, ...rest }: Props = $props()

  let data = $derived([
    { title: `Crystal System`, value: `${material.symmetry?.crystal_system}` },
    { title: `International Number`, value: material.symmetry?.number },
    { title: `Point Group`, value: `${material.symmetry?.point_group}` },
    { title: `Symbol`, value: `${material.symmetry?.symbol}` },
  ])
</script>

<InfoCard {data} {...rest} {title} />
