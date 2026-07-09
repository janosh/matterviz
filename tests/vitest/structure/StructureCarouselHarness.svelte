<script lang="ts">
  import StructureCarousel from '$lib/structure/StructureCarousel.svelte'
  import type { StructureCarouselItem } from '$lib/structure'

  interface Props {
    next_items: StructureCarouselItem[]
    on_prefetch_more?: () => void
  }

  let { next_items, on_prefetch_more }: Props = $props()
  let items = $state<StructureCarouselItem[]>([])

  export const show_items = (): void => {
    items = next_items
  }
</script>

<StructureCarousel {items} {on_prefetch_more} />
