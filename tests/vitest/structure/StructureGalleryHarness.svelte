<script lang="ts">
  import StructureGallery from '$lib/structure/StructureGallery.svelte'
  import type { StructureGalleryItem } from '$lib/structure'

  interface Props {
    next_items: StructureGalleryItem[]
    on_prefetch_more?: () => void
  }

  let { next_items, on_prefetch_more }: Props = $props()
  let items = $state<StructureGalleryItem[]>([])

  export const show_items = (): void => {
    items = next_items
  }
</script>

<StructureGallery {items} {on_prefetch_more} layout="horizontal" />
