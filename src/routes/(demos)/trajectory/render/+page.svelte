<script lang="ts">
  import { Trajectory, type TrajectoryViewerController } from '$lib/trajectory'
  import type { StructureOptions } from '$lib/structure'
  import { tick } from 'svelte'

  let controller = $state.raw<TrajectoryViewerController>()
  let structure_props = $state<Partial<StructureOptions>>({
    show_controls: false,
    show_image_atoms: false,
    scene_props: { show_bonds: `never`, gizmo: false },
  })
  let input = $state<HTMLInputElement>()
  let error = $state(``)

  // A documented automation entry point on this dedicated page, backed by the public
  // component controller. Local files stay File objects, including multi-GB HDF5 inputs.
  $effect(() => {
    if (!controller) return
    const bridge = {
      ...controller,
      async configure(options: Partial<StructureOptions>) {
        structure_props = {
          ...structure_props,
          ...options,
          scene_props: { ...structure_props.scene_props, ...options.scene_props },
        }
        await tick()
      },
    }
    const host = window as typeof window & { matterviz_movie?: typeof bridge }
    host.matterviz_movie = bridge
    return () => {
      delete host.matterviz_movie
    }
  })

  async function load_selected() {
    error = ``
    try {
      const file = input?.files?.[0]
      if (!file || !controller) throw new Error(`Choose a trajectory first`)
      await controller.load(file)
    } catch (cause) {
      error = String(cause)
    }
  }
</script>

<svelte:head><title>Trajectory movie renderer</title></svelte:head>
<div class="movie-stage">
  <Trajectory
    display_mode="structure"
    auto_play={false}
    show_controls="never"
    {structure_props}
    on_controller={(value) => (controller = value ?? undefined)}
    style="width: 100%; height: 100%; --traj-border-radius: 0"
  />
  <div class="source-controls">
    <input
      id="movie-source"
      type="file"
      bind:this={input}
      aria-label="Movie trajectory file"
    />
    <button onclick={load_selected}>Load trajectory</button>
    {#if error}<span role="alert">{error}</span>{/if}
  </div>
</div>

<style>
  .movie-stage {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: #111318;
  }
  .source-controls {
    position: absolute;
    bottom: 0;
    left: 0;
    display: flex;
    gap: 0.5em;
    padding: 0.5em;
    opacity: 0;
    &:hover,
    &:focus-within {
      opacity: 1;
    }
  }
</style>
