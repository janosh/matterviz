<script lang="ts">
  import { T } from '@threlte/core'
  import { HTML, OrbitControls, interactivity } from '@threlte/extras'

  import { pretty_num } from './labels'
  import { element_colors } from './stores'
  import type { PymatgenStructure, Species } from './structure'
  import { atomic_radii } from './structure'

  // output of pymatgen.core.Structure.as_dict()
  export let structure: PymatgenStructure | undefined = undefined
  // scale factor for atomic radii
  export let atom_radius: number = 0.5
  // whether to use the same radius for all atoms. if not, the radius will be
  // determined by the atomic radius of the element
  export let same_size_atoms: boolean = true
  // initial camera position from which to render the scene
  export let camera_position: [number, number, number] = [10, 10, 10]
  // zoom level of the camera
  export let orbit_controls: OrbitControls | undefined = undefined
  export let max_zoom: number | undefined = undefined
  export let min_zoom: number | undefined = undefined
  // zoom speed. set to 0 to disable zooming.
  export let zoom_speed: number = 0.3
  // pan speed. set to 0 to disable panning.
  export let pan_speed: number = 1
  // TODO whether to make the canvas fill the whole screen
  // export let fullscreen: boolean = false
  // whether to show the structure's lattice cell as a wireframe
  export let show_cell: 'surface' | 'wireframe' | null = `wireframe`
  // cell opacity
  export let cell_opacity: number | undefined = undefined
  // whether to show the lattice vectors
  export let show_vectors: boolean = true
  // lattice vector colors
  export let vector_colors: [string, string, string] = [`red`, `green`, `blue`]
  // lattice vector origin (all arrows start from this point)
  export let vector_origin: { x: number; y: number; z: number } = { x: -1, y: -1, z: -1 }
  export let hovered_atom: { xyz: [number, number, number]; species: Species[] } | null =
    null

  $: ({ a, b, c } = structure?.lattice ?? { a: 0, b: 0, c: 0 })

  interactivity()
</script>

<T.PerspectiveCamera makeDefault position={camera_position}>
  <OrbitControls
    enableZoom={zoom_speed > 0}
    zoomSpeed={zoom_speed}
    enablePan={pan_speed > 0}
    panSpeed={pan_speed}
    target={[a / 2, b / 2, c / 2]}
    maxZoom={max_zoom}
    minZoom={min_zoom}
    bind:this={orbit_controls}
  />
</T.PerspectiveCamera>

<T.DirectionalLight position={[3, 10, 10]} intensity={0.8} />
<T.AmbientLight intensity={0.2} />

{#each structure?.sites ?? [] as { xyz, species }}
  {@const elem = species[0].element}
  {@const radius = (same_size_atoms ? 1 : atomic_radii[elem]) * atom_radius}
  <T.Mesh
    position={xyz}
    transparent
    opacity={1}
    on:pointerenter={() => {
      hovered_atom = { xyz, species }
    }}
    on:pointerleave={() => {
      hovered_atom = null
    }}
  >
    <T.SphereGeometry args={[radius, 20, 20]} />
    <T.MeshStandardMaterial color={$element_colors[elem]} />
  </T.Mesh>
{/each}
{#if hovered_atom}
  {@const { xyz, species } = hovered_atom}
  <HTML position={xyz}>
    <div
      style="background-color: rgba(0, 0, 0, 0.5); padding: 3pt 1ex; width: max-content;"
    >
      {#each species as { element, occu, oxidation_state }}
        <strong>{element}{oxidation_state ?? ``}</strong>: ({xyz
          .map((num) => pretty_num(num))
          .join(`, `)})
        {occu == 1 ? `` : `occu=${occu}`}
      {/each}
    </div>
  </HTML>
{/if}

{#if show_cell}
  <T.Mesh position={[a / 2, b / 2, c / 2]}>
    <T.BoxGeometry args={[a, b, c]} />
    <T.MeshBasicMaterial
      transparent
      opacity={cell_opacity ?? (show_cell == `surface` ? 0.2 : 1)}
      wireframe={show_cell == `wireframe`}
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
