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

  function on_keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      show_controls = false
    }
  }

  let tooltip = { visible: false, content: '', x: 0, y: 0 }

  function on_mouse_enter(event, position, element) {
    console.log(`event`, event)

    const { clientX, clientY } = event.detail.event
    tooltip.visible = true
    tooltip.content = `${element} - (${position.join(', ')})`
    tooltip.x = clientX
    tooltip.y = clientY
  }

  function on_mouse_leave() {
    tooltip.visible = false
  }

  const lattice = structure.lattice.matrix

  $: ({ a, b, c } = structure.lattice)
</script>

<svelte:window on:keydown={on_keydown} />

<div>
  <button class="controls-toggle" on:click={() => (show_controls = !show_controls)}>
    {show_controls ? 'Hide' : 'Show'} controls
  </button>
  <section class="controls" class:open={show_controls}>
    <label>
      Atom radius
      <input type="range" min="0.1" max="2" step="0.05" bind:value={atom_radius} />
    </label>
    <label>
      <input type="checkbox" bind:checked={same_size_atoms} />
      Scale atoms according to atomic radius (if false, all atoms have same size)
    </label>
  </section>

  <div
    class="tooltip"
    style="top: {tooltip.y}px; left: {tooltip.x}px; display: {tooltip.visible
      ? 'block'
      : 'none'};"
  >
    {tooltip.content}
  </div>

  <Canvas>
    <T.PerspectiveCamera makeDefault position={camera_position} fov={zoom}>
      <OrbitControls enableZoom enablePan target={{ x: a / 2, y: b / 2, z: c / 2 }} />
    </T.PerspectiveCamera>

    <T.DirectionalLight position={[3, 10, 10]} />
    <T.DirectionalLight position={[-3, 10, -10]} intensity={0.2} />
    <T.AmbientLight intensity={0.2} />

    {#each structure.sites as { xyz: position, species }}
      {@const symbol = species[0].element}
      {@const radius = (same_size_atoms ? 1 : atomic_radii[symbol]) * atom_radius}
      <T.Mesh
        {position}
        interactive
        on:pointerenter={(e) => on_mouse_enter(e, position, symbol)}
        on:pointerleave={on_mouse_leave}
      >
        <T.SphereGeometry args={[radius, 20, 20]} />
        <T.MeshStandardMaterial
          color="rgb({atomic_colors[symbol].map((x) => Math.floor(x * 255)).join(',')})"
        />
      </T.Mesh>
    {/each}

    <!-- Render lattice as a cuboid of white lines -->
    <T.Mesh position={[lattice[0][0] / 2, lattice[1][1] / 2, lattice[2][2] / 2]}>
      <T.BoxGeometry args={[lattice[0][0], lattice[1][1], lattice[2][2]]} />
      <T.MeshBasicMaterial transparent opacity={0.2} />
      <T.LineSegments>
        <T.EdgesGeometry />
        <T.LineBasicMaterial color="white" />
      </T.LineSegments>
    </T.Mesh>
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
    padding: 2em 5pt 0;
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

  .tooltip {
    position: absolute;
    background-color: rgba(0, 0, 0, 0.7);
    color: white;
    padding: 5px;
    border-radius: 5px;
    pointer-events: none;
  }
</style>
