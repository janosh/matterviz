<script lang="ts">
  import StructureGallery from '$lib/structure/StructureGallery.svelte'
  import { type ComponentProps, untrack } from 'svelte'

  // Lets a test change props on a mounted gallery. Mounting twice and comparing
  // proves a prop is honoured; changing one in place proves it repaints. What it
  // does NOT prove is how a prop is read: Svelte tracks a read through a closure
  // the template invokes. `initial` is read once — the harness owns them after.
  let { initial }: { initial: ComponentProps<typeof StructureGallery> } = $props()
  const live = $state({ ...untrack(() => initial) })

  export const update = (patch: Partial<ComponentProps<typeof StructureGallery>>): void =>
    void Object.assign(live, patch)
</script>

<StructureGallery {...live} />
