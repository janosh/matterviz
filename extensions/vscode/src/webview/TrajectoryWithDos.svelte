<script lang="ts">
  // Trajectory viewer with an electronic DOS panel below it, for vaspout.h5
  // files that carry results/electron_dos alongside the ionic trajectory.
  // Single component so create_display keeps returning one mountable app.
  import type { DosInput } from '$lib/spectral'
  import Dos from '$lib/spectral/Dos.svelte'
  import Trajectory from '$lib/trajectory/Trajectory.svelte'
  import type { ComponentProps } from 'svelte'

  let {
    dos,
    trajectory_props,
  }: {
    dos: DosInput
    trajectory_props: ComponentProps<typeof Trajectory>
  } = $props()
</script>

<div class="trajectory-with-dos">
  <Trajectory {...trajectory_props} />
  <Dos doses={dos} style="min-height: 0" />
</div>

<style>
  .trajectory-with-dos {
    display: grid;
    grid-template-rows: minmax(0, 2fr) minmax(0, 1fr);
    height: 100%;
  }
</style>
