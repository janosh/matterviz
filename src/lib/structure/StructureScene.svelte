<script lang="ts">
  import type { PymatgenStructure, Site, Vector } from '$lib'
  import { Bond, atomic_radii, euclidean_dist, pretty_num } from '$lib'
  import { element_colors } from '$lib/stores'
  import { T } from '@threlte/core'
  import {
    HTML,
    Instance,
    InstancedMesh,
    OrbitControls,
    interactivity,
  } from '@threlte/extras'

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
  export let show_atoms: boolean = true
  export let show_bonds: boolean = true
  export let show_cell: 'surface' | 'wireframe' | null = `wireframe`
  // thickness of the wireframe lines that indicate the lattice's unit cell
  // due to limitations of OpenGL with WebGL renderer, on most platforms linewidth will be 1 regardless of set value
  // see https://threejs.org/docs/#api/en/materials/MeshBasicMaterial.wireframe
  export let cell_line_width: number = 1
  // cell opacity
  export let cell_opacity: number | undefined = undefined
  // whether to show the lattice vectors
  export let show_vectors: boolean = true
  // lattice vector colors
  export let vector_colors: [string, string, string] = [`red`, `green`, `blue`]
  // lattice vector origin (all arrows start from this point)
  export let vector_origin: { x: number; y: number; z: number } = { x: -1, y: -1, z: -1 }
  export let hovered_idx: number | null = null
  export let active_idx: number | null = null
  export let hovered_site: Site | null = null
  export let active_site: Site | null = null
  export let precision: string = `.3~f`
  export let auto_rotate: number | boolean = 0
  export let bond_radius: number | undefined = undefined
  export let bond_opacity: number = 0.5
  export let bond_color: string = `white`
  export let max_bond_dist: number = 3

  $: ({ a, b, c } = structure?.lattice ?? { a: 0, b: 0, c: 0 })
  $: hovered_site = structure?.sites?.[hovered_idx ?? -1] ?? null
  $: active_site = structure?.sites?.[active_idx ?? -1] ?? null

  interactivity()

  let bond_pairs: [Vector, Vector][] = []
  $: if (structure?.sites) {
    bond_pairs = []
    for (const { xyz } of structure.sites) {
      for (const { xyz: other_xyz } of structure.sites) {
        const dist = euclidean_dist(xyz, other_xyz)
        if (dist < max_bond_dist) bond_pairs.push([xyz, other_xyz])
      }
    }
  }

  // make bonds reactive to atom_radius unless bond_radius is set
  $: bond_thickness = bond_radius ?? 0.075 * atom_radius
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
    autoRotate={Boolean(auto_rotate)}
    autoRotateSpeed={auto_rotate}
  />
</T.PerspectiveCamera>

<T.DirectionalLight position={[3, 10, 10]} intensity={0.6} />
<T.AmbientLight intensity={0.3} />

{#if show_atoms && structure?.sites}
  <InstancedMesh>
    <T.MeshStandardMaterial />
    <T.SphereGeometry args={[1, 20, 20]} />
    {#each structure.sites as site, idx}
      {@const { species, xyz } = site}
      {@const elem = species[0].element}
      {@const radius = (same_size_atoms ? 1 : atomic_radii[elem]) * atom_radius}
      <Instance
        position={xyz}
        color={$element_colors[species[0].element]}
        on:pointerenter={() => {
          hovered_idx = idx
        }}
        on:pointerleave={() => {
          hovered_idx = null
        }}
        on:click={() => {
          if (active_idx == idx) active_idx = null
          else active_idx = idx
        }}
        scale={radius}
      />
    {/each}
  </InstancedMesh>
{/if}

{#if show_bonds}
  <InstancedMesh>
    <T.CylinderGeometry args={[bond_thickness, bond_thickness, 1, 16]} />
    <T.MeshStandardMaterial opacity={bond_opacity} color={bond_color} />
    {#each bond_pairs ?? [] as [from, to]}
      <Bond {from} {to} radius={1} />
    {/each}
  </InstancedMesh>
{/if}

<!-- highlight active and hovered sites -->
{#each [{ site: hovered_site, opacity: 0.2 }, { site: active_site, opacity: 0.3 }] as { site, opacity }}
  {#if site}
    {@const { xyz, species } = site}
    {@const elem = species[0].element}
    {@const radius = 1.1 * (same_size_atoms ? 1 : atomic_radii[elem]) * atom_radius}
    <T.Mesh position={xyz}>
      <T.SphereGeometry args={[radius, 20, 20]} />
      <T.MeshStandardMaterial color="white" transparent {opacity} />
    </T.Mesh>
  {/if}
{/each}

{#if hovered_site}
  <HTML position={hovered_site.xyz} pointerEvents="none">
    <div>
      {#each hovered_site.species ?? [] as { element, occu, oxidation_state }}
        {@const oxi_state =
          oxidation_state &&
          Math.abs(oxidation_state) + (oxidation_state > 0 ? `+` : `-`)}
        <strong>{element}{oxi_state ?? ``}</strong>
        {occu == 1 ? `` : `(occu=${occu})`}
      {/each}
      ({hovered_site.xyz.map((num) => pretty_num(num, precision)).join(`, `)})
      <!-- distance from hovered to active site -->
      <!-- TODO this doesn't handle periodic boundaries yet, so is currently grossly misleading -->
      {#if active_site && active_site != hovered_site}
        {@const distance = pretty_num(euclidean_dist(hovered_site.xyz, active_site.xyz))}
        dist={distance} Å
      {/if}
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
      wireframeLinewidth={cell_line_width}
    />
  </T.Mesh>
{/if}

{#if show_vectors}
  {#each structure?.lattice?.matrix ?? [] as [a, b, c], idx}
    <T.ArrowHelper
      args={[{ x: a, y: b, z: c }, vector_origin, 4, vector_colors[idx], 1, 0.3]}
    />
  {/each}
{/if}

<style>
  div {
    background-color: rgba(0, 0, 0, 0.5);
    padding: 1pt 5pt;
    width: max-content;
    box-sizing: border-box;
    border-radius: 5pt;
    pointer-events: none;
  }
</style>
