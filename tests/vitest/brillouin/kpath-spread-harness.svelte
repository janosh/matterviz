<script lang="ts">
  // Spreads a props object into KPath like FermiSurfaceScene does, so a test can replace the
  // object (e.g. a new hovered index) while the path inside it stays the same
  import KPath from '#lib/brillouin/KPath.svelte'
  import type { ComponentProps } from 'svelte'

  let { k_path }: { k_path: Omit<ComponentProps<typeof KPath>, `size`> } = $props()
</script>

<KPath {...k_path} size={1} />
