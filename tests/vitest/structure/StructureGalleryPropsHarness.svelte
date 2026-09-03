<script lang="ts">
  import StructureGallery from '$lib/structure/StructureGallery.svelte'
  import { type ComponentProps, untrack } from 'svelte'

  // Lets a test change props on a mounted gallery. Mounting twice and comparing
  // proves a prop is honoured; only changing one in place proves it repaints.
  // What it does NOT prove is how a prop is read: Svelte tracks a read through a
  // closure the template invokes, so moving one out of a derived and into the
  // closure it returns keeps this green. Built to catch exactly that and didn't.
  // `initial` is read once on purpose: the harness owns the props from then on.
  let { initial }: { initial: ComponentProps<typeof StructureGallery> } = $props()
  const live = $state({ ...untrack(() => initial) })

  export const update = (patch: Partial<ComponentProps<typeof StructureGallery>>): void =>
    void Object.assign(live, patch)
</script>

<StructureGallery {...live} />
