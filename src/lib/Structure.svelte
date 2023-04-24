<script lang="ts">
  import { Canvas, OrbitControls, T } from '@threlte/core'
  import { atomic_colors, atomic_radii, get_elements, type Structure } from './structure'

  // output of pymatgen.core.Structure.as_dict()
  export let structure: Structure | undefined = undefined
  // scale factor for atomic radii
  export let atom_radius: number = 0.5
  // whether to use the same radius for all atoms. if not, the radius will be
  // determined by the atomic radius of the element
  export let same_size_atoms: boolean = true
  // initial camera position from which to render the scene
  export let camera_position: [number, number, number] = [10, 10, 10]
  // zoom level of the camera
  export let zoom: number = 1 / 50
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
  // whether to show the lattice vectors
  export let show_vectors: boolean = true
  // lattice vector colors
  export let vector_colors: [string, string, string] = ['red', 'green', 'blue']
  // lattice vector origin (all arrows start from this point)
  export let vector_origin: { x: number; y: number; z: number } = { x: -1, y: -1, z: -1 }

  function on_keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      show_controls = false
    }
  }

  $: ({ a, b, c } = structure?.lattice ?? {})

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

{#if structure?.sites}
  <div class="structure">
    <button
      class="controls-toggle"
      on:click={() => (show_controls = !show_controls)}
      bind:this={toggle_controls_btn}
    >
      <slot name="controls-toggle" {show_controls}>
        {show_controls ? 'Close' : 'Controls'}
      </slot>
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
      {#if show_cell}
        <label>
          Cell opacity
          <input type="range" min="0" max="1" step="0.05" bind:value={cell_opacity} />
        </label>
      {/if}
      <label>
        <input type="checkbox" bind:checked={show_vectors} />
        Show lattice vectors
      </label>
    </section>

    <Canvas>
      <T.PerspectiveCamera makeDefault position={camera_position} fov={1 / zoom}>
        <OrbitControls enableZoom enablePan target={{ x: a / 2, y: b / 2, z: c / 2 }} />
      </T.PerspectiveCamera>

      <T.DirectionalLight position={[3, 10, 10]} />
      <T.DirectionalLight position={[-3, 10, -10]} intensity={0.2} />
      <T.AmbientLight intensity={0.2} />

      {#each structure?.sites ?? [] as { xyz, species }}
        {@const elem = species[0].element}
        {@const radius = (same_size_atoms ? 1 : atomic_radii[elem]) * atom_radius}
        <T.Mesh position={xyz} transparent opacity={1}>
          <T.SphereGeometry args={[radius, 20, 20]} />
          <T.MeshStandardMaterial color={atomic_colors[elem]} />
        </T.Mesh>
      {/each}

      {#if show_cell}
        <T.Mesh position={[a / 2, b / 2, c / 2]}>
          <T.BoxGeometry args={[a, b, c]} />
          <T.MeshBasicMaterial
            transparent
            opacity={cell_opacity ?? (show_cell == 'surface' ? 0.2 : 1)}
            wireframe={show_cell == 'wireframe'}
          />
        </T.Mesh>
      {/if}

      {#if show_vectors}
        {#each structure?.lattice?.matrix ?? [] as [a, b, c], idx}
          <T.ArrowHelper
            args={[{ x: a, y: b, z: c }, vector_origin, 3, vector_colors[idx], 1, 0.5]}
          />
        {/each}
      {/if}
    </Canvas>

    <div class="element-list">
      {#each get_elements(structure) as elem}
        <span class="element" style="background-color: {atomic_colors[elem]}">
          {elem}
        </span>
      {/each}
    </div>
  </div>
{:else if structure}
  <p class="warn">No sites found in structure</p>
{:else}
  <p class="warn">No pymatgen <code>Structure</code> provided</p>
{/if}

<style>
  .structure {
    height: 600px;
    width: 100%;
    background-color: rgba(255, 255, 255, 0.1);
    border-radius: 3pt;
    position: relative;
    container-type: inline-size;
  }

  .controls-toggle {
    position: absolute;
    z-index: var(--svelte-controls-toggle-z-index, 1);
    top: var(--svelte-controls-toggle-top, 8pt);
    right: var(--svelte-controls-toggle-right, 8pt);
  }
  section.controls {
    display: grid;
    position: absolute;
    top: 5pt;
    right: 5pt;
    background-color: rgba(0, 0, 0, 0.6);
    padding: 6pt 9pt;
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
    background-color: rgba(0, 0, 0, 0.4);
  }

  p.warn {
    font-size: larger;
    text-align: center;
  }

  .element-list {
    position: absolute;
    bottom: var(--struct-elem-list-bottom, 8pt);
    right: var(--struct-elem-list-right, 8pt);
    display: flex;
    gap: 5pt;
    font-size: var(--struct-elem-list-font-size, 14pt);
  }
  .element {
    padding: 1pt 4pt;
    border-radius: var(--struct-elem-list-border-radius, 3pt);
  }
</style>
