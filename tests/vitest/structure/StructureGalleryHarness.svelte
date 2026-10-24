<script lang="ts">
  import StructureGallery from '#lib/structure/StructureGallery.svelte'
  import { type ComponentProps, untrack } from 'svelte'

  // Lets a test change props on a mounted gallery. Mounting twice and comparing
  // proves a prop is honoured; changing one in place proves it repaints. What it
  // does NOT prove is how a prop is read: Svelte tracks a read through a closure
  // the template invokes. `initial` is read once — the harness owns them after.
  let { initial }: { initial: ComponentProps<typeof StructureGallery> } = $props()
  // .raw: deep-proxying the items would hand the gallery a new proxy of the same structure
  // whenever an update re-wraps them, which Svelte flags as state_proxy_equality_mismatch
  let live = $state.raw({ ...untrack(() => initial) })

  export const update = (patch: Partial<ComponentProps<typeof StructureGallery>>): void => {
    live = { ...live, ...patch }
  }
</script>

<StructureGallery {...live} />
