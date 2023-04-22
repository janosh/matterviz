<script lang="ts">
  import { Canvas, OrbitControls, T } from '@threlte/core'
  import { atomic_colors, atomic_radii, type Structure } from './structure'

  // output of pymatgen.core.Structure.as_dict()
  export let structure: Structure
  // scale factor for atomic radii
  export let atom_radius: number = 0.5
  // whether to use the same radius for all atoms. if not, the radius will be
  // determined by the atomic radius of the element
  export let same_size_atoms: boolean = true
  // initial camera position from which to render the scene
  export let camera_position: [number, number, number] = [10, 10, 10]
  // zoom level of the camera
  export let zoom: number = 60
  // whether to show the controls panel
  export let show_controls: boolean = false
  // TODO whether to make the canvas fill the whole screen
  // export let fullscreen: boolean = false
  // whether to show the structure's lattice cell as a wireframe
  export let show_cell: 'surface' | 'wireframe' | null = 'wireframe'
  // the control panel DOM element
  export let controls: HTMLElement | null = null
  // the button to toggle the control panel
  export let toggle_controls_btn: HTMLButtonElement | null = null
  // cell opacity
  export let cell_opacity: number | undefined = undefined

  function on_keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      show_controls = false
    }
  }

  $: ({ a, b, c } = structure.lattice)

  const on_window_click =
    (node: (HTMLElement | null)[], cb: () => void) => (event: MouseEvent) => {
      if (!node || !event.target) return

      if (node && !node.some((n) => n?.contains(event.target as Node))) {
        cb()
      }
    }
</script>

<svelte:window
  on:keydown={on_keydown}
  on:click={on_window_click([controls, toggle_controls_btn], () => {
    if (show_controls) show_controls = false
  })}
/>

<div>
  <button
    class="controls-toggle"
    on:click={() => (show_controls = !show_controls)}
    bind:this={toggle_controls_btn}
  >
    {show_controls ? 'Hide' : 'Show'} controls
  </button>
  <section bind:this={controls} class="controls" class:open={show_controls}>
    <label>
      Atom radius
      <input type="range" min="0.1" max="2" step="0.05" bind:value={atom_radius} />
    </label>
    <label>
      <input type="checkbox" bind:checked={same_size_atoms} />
      Scale atoms according to atomic radius (if false, all atoms have same size)
    </label>
    <label>
      Show lattice matrix as
      <select bind:value={show_cell}>
        <option value="surface">surface</option>
        <option value="wireframe">wireframe</option>
        <option value={null}>none</option>
      </select>
    </label>
    <label>
      Cell opacity
      <input type="range" min="0" max="1" step="0.01" bind:value={cell_opacity} />
    </label>
  </section>

  <Canvas>
    <T.PerspectiveCamera makeDefault position={camera_position} fov={zoom}>
      <OrbitControls enableZoom enablePan target={{ x: a / 2, y: b / 2, z: c / 2 }} />
    </T.PerspectiveCamera>

    <T.DirectionalLight position={[3, 10, 10]} />
    <T.DirectionalLight position={[-3, 10, -10]} intensity={0.2} />
    <T.AmbientLight intensity={0.2} />

    {#each structure.sites as { xyz, species }}
      {@const symbol = species[0].element}
      {@const radius = (same_size_atoms ? 1 : atomic_radii[symbol]) * atom_radius}
      <T.Mesh position={xyz}>
        <T.SphereGeometry args={[radius, 20, 20]} />
        <T.MeshStandardMaterial
          color="rgb({atomic_colors[symbol].map((x) => Math.floor(x * 255)).join(',')})"
        />
      </T.Mesh>
    {/each}

    {#if show_cell}
      <T.Mesh position={[a / 2, b / 2, c / 2]}>
        <T.BoxGeometry args={[a, b, c]} />
        <T.MeshBasicMaterial
          transparent
          opacity={cell_opacity ?? (show_cell === 'surface' ? 0.2 : 1)}
          wireframe={show_cell === 'wireframe'}
        />
      </T.Mesh>
    {/if}
  </Canvas>
</div>

<style>
  div {
    height: 600px;
    width: 100%;
    background-color: rgba(255, 255, 255, 0.1);
    border-radius: 3pt;
    position: relative;
    container-type: inline-size;
  }

  .controls-toggle {
    position: absolute;
    top: 5pt;
    right: 5pt;
    z-index: 100;
  }
  section.controls {
    display: grid;
    position: absolute;
    top: 5pt;
    right: 5pt;
    background-color: rgba(255, 255, 255, 0.2);
    padding: 2em 6pt 3pt;
    border-radius: 3pt;
    visibility: hidden;
    opacity: 0;
    transition: visibility 0.1s, opacity 0.1s linear;
    max-width: 40cqw;
  }
  section.controls.open {
    visibility: visible;
    opacity: 1;
  }
  select {
    margin-left: 5pt;
    color: white;
    /* transparent */
    background-color: rgba(255, 255, 255, 0.2);
  }
</style>
