<script lang="ts">
  import type { Atoms, BondPair, Site, Vector } from '$lib'
  import {
    Bond,
    Lattice,
    add,
    atomic_radii,
    euclidean_dist,
    pretty_num,
    scale,
  } from '$lib'
  import { element_colors } from '$lib/stores'
  import { T } from '@threlte/core'
  import {
    Gizmo,
    HTML,
    InstancedMesh,
    OrbitControls,
    interactivity,
  } from '@threlte/extras'
  import type { ComponentProps } from 'svelte'
  import * as bonding_strategies from './bonding'

  // output of pymatgen.core.Structure.as_dict()
  export let structure: Atoms | undefined = undefined
  // scale factor for atomic radii
  export let atom_radius: number = 0.5
  // multiple of atom_radius (actually atom_radius * the element's atomic radius)
  // to use as distance for the site label(s) (multiple if site is disordered) from the site's center
  export let label_radius: number = 1
  // whether to use the same radius for all atoms. if not, the radius will be
  // determined by the atomic radius of the element
  export let same_size_atoms: boolean = true
  // initial camera position from which to render the scene
  export let camera_position: Vector = [12, 4, 2 * (structure?.lattice?.c ?? 5)]
  // rotation damping factor (how quickly the rotation comes to rest after mouse release)
  export let rotation_damping: number = 0.1
  // zoom level of the camera
  export let max_zoom: number | undefined = undefined
  export let min_zoom: number | undefined = undefined
  // zoom speed. set to 0 to disable zooming.
  export let zoom_speed: number = 0.3
  // pan speed. set to 0 to disable panning.
  export let pan_speed: number = 1
  export let show_atoms: boolean = true
  export let show_bonds: boolean = true
  export let gizmo: boolean | ComponentProps<Gizmo> = true
  export let hovered_idx: number | null = null
  export let active_idx: number | null = null
  export let hovered_site: Site | null = null
  export let active_site: Site | null = null
  export let precision: string = `.3~f`
  export let auto_rotate: number | boolean = 0 // auto rotate speed. set to 0 to disable auto rotation.
  export let bond_radius: number | undefined = 0.05
  export let bond_opacity: number = 0.5
  export let bond_color: string = `#ffffff` // must be hex code for <input type='color'>
  export let bonding_strategy: keyof typeof bonding_strategies = `nearest_neighbor`
  export let bonding_options: Record<string, unknown> = {}
  // set to null to disable showing distance between hovered and active sites
  type ActiveHoveredDist = { color: string; width: number; opacity: number }
  export let active_hovered_dist: ActiveHoveredDist | null = {
    color: `green`,
    width: 0.1,
    opacity: 0.5,
  }
  export let fov: number = 50 // field of view of the camera. 50 is THREE.js default
  export let ambient_light: number = 1.8
  export let directional_light: number = 2.5
  // number of segments in sphere geometry. higher is smoother but more
  // expensive to render (usually >16, <32)
  export let sphere_segments: number = 20

  // TODO bond_color_mode to be implemented
  export const bond_color_mode: `single` | `split-midpoint` | `gradient` = `single`
  export let lattice_props: Omit<ComponentProps<Lattice>, `matrix`> = {}

  $: hovered_site = structure?.sites?.[hovered_idx ?? -1] ?? null
  $: active_site = structure?.sites?.[active_idx ?? -1] ?? null
  interactivity()

  let bond_pairs: BondPair[]
  $: if (structure?.sites && show_bonds) {
    bond_pairs = bonding_strategies[bonding_strategy](structure, bonding_options)
  }

  // make bond thickness reactive to atom_radius unless bond_radius is set
  $: bond_thickness = bond_radius ?? 0.05 * atom_radius
  const gizmo_defaults: Partial<ComponentProps<Gizmo>> = {
    horizontalPlacement: `left`,
    size: 100,
    paddingX: 10,
    paddingY: 10,
    toneMapped: true,
  } as const
</script>

<T.PerspectiveCamera makeDefault position={camera_position} {fov}>
  <!-- fix the ugly target -->
  <OrbitControls
    position={[0, 0, 0]}
    enableZoom={zoom_speed > 0}
    zoomSpeed={zoom_speed}
    enablePan={pan_speed > 0}
    panSpeed={pan_speed}
    target={structure?.lattice
      ? scale(add(...(structure?.lattice?.matrix ?? [])), 0.5)
      : [0, 0, 0]}
    maxZoom={max_zoom}
    minZoom={min_zoom}
    autoRotate={Boolean(auto_rotate)}
    autoRotateSpeed={auto_rotate}
    enableDamping={Boolean(rotation_damping)}
    dampingFactor={rotation_damping}
  />
</T.PerspectiveCamera>

{#if gizmo}
  <Gizmo {...{ ...gizmo_defaults, ...(typeof gizmo === `boolean` ? {} : gizmo) }} />
{/if}

<T.DirectionalLight position={[3, 10, 10]} intensity={directional_light} />
<T.AmbientLight intensity={ambient_light} />

{#if show_atoms && structure?.sites}
  {#each structure.sites as site, site_idx}
    {@const { species, xyz } = site}
    {#each species as { element: elem, occu }, spec_idx}
      {@const radius = (same_size_atoms ? 1 : atomic_radii[elem]) * atom_radius}
      {@const start_angle = species
        .slice(0, spec_idx)
        .reduce((total, spec) => total + spec.occu, 0)}
      <T.Mesh position={xyz}>
        <T.SphereGeometry
          args={[
            0.5,
            sphere_segments,
            sphere_segments,
            2 * Math.PI * start_angle,
            2 * Math.PI * (start_angle + occu),
          ]}
        />
        <T.MeshStandardMaterial
          color={$element_colors[elem]}
          on:pointerenter={() => {
            hovered_idx = site_idx
          }}
          on:pointerleave={() => {
            hovered_idx = null
          }}
          on:click={() => {
            if (active_idx == site_idx) active_idx = null
            else active_idx = site_idx
          }}
          scale={radius}
        />
      </T.Mesh>
      {#if $$slots[`atom-label`]}
        <!-- use polar coordinates + offset if site has partial occupancy to move the text to the side of the corresponding sphere slice -->
        {@const phi = 2 * Math.PI * (start_angle + occu / 2)}
        {@const pos = add(
          xyz,
          scale([Math.cos(phi), 0, Math.sin(phi)], label_radius * radius),
        )}
        <HTML center position={pos}>
          <slot name="atom-label" {elem} xyz={pos} {species} />
        </HTML>
      {/if}
    {/each}
  {/each}
{/if}

{#if show_bonds}
  <InstancedMesh>
    <T.CylinderGeometry args={[bond_thickness, bond_thickness, 1, 16]} />
    <T.MeshStandardMaterial opacity={bond_opacity} color={bond_color} />
    {#key bond_pairs}
      {#each bond_pairs ?? [] as [from, to]}
        <Bond {from} {to} radius={1} />
      {/each}
    {/key}
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

<!-- cylinder between active and hovered site to indicate measured distance -->
{#if active_site && hovered_site && active_hovered_dist}
  {@const { color, width, opacity } = active_hovered_dist}
  <InstancedMesh>
    <T.CylinderGeometry args={[width, width, 1, 16]} />
    <T.MeshStandardMaterial {opacity} {color} />
    <Bond from={active_site.xyz} to={hovered_site.xyz} radius={1} />
  </InstancedMesh>
{/if}

<!-- hovered site tooltip -->
{#if hovered_site}
  <HTML position={hovered_site.xyz} pointerEvents="none">
    <div class="tooltip">
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
      {#if active_site && active_site != hovered_site && active_hovered_dist}
        {@const distance = euclidean_dist(hovered_site.xyz, active_site.xyz)}
        <br />
        dist={pretty_num(distance)} Å (no PBC yet)
      {/if}
    </div>
  </HTML>
{/if}

{#if structure?.lattice}
  <Lattice matrix={structure?.lattice?.matrix} {...lattice_props} />
{/if}

<style>
  div.tooltip {
    width: max-content;
    box-sizing: border-box;
    pointer-events: none;
    border-radius: var(--struct-tooltip-border-radius, 5pt);
    background: var(--struct-tooltip-bg, rgba(0, 0, 0, 0.5));
    padding: var(--struct-tooltip-padding, 1pt 5pt);
  }
</style>
