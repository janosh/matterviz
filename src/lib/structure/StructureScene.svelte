<script lang="ts">
  import type { AnyStructure, BondPair, Site, Vec3 } from '$lib'
  import { atomic_radii, element_data } from '$lib'
  import { format_num } from '$lib/labels'
  import * as math from '$lib/math'
  import { DEFAULTS } from '$lib/settings'
  import { colors } from '$lib/state.svelte'
  import { Bond, get_center_of_mass, Lattice, Vector } from '$lib/structure'
  import { T } from '@threlte/core'
  import {
    Gizmo,
    HTML,
    Instance,
    InstancedMesh,
    interactivity,
    OrbitControls,
  } from '@threlte/extras'
  import type { ComponentProps } from 'svelte'
  import { type Snippet } from 'svelte'
  import * as bonding_strategies from './bonding'
  import { CanvasTooltip } from './index'

  type ActiveHoveredDist = { color: string; width: number; opacity: number }

  interface Props {
    structure?: AnyStructure | undefined
    atom_radius?: number // scale factor for atomic radii
    same_size_atoms?: boolean // whether to use the same radius for all atoms. if not, the radius will be
    // determined by the atomic radius of the element
    camera_position?: [x: number, y: number, z: number] // initial camera position from which to render the scene
    camera_projection?: `perspective` | `orthographic` // camera projection type
    rotation_damping?: number // rotation damping factor (how quickly the rotation comes to rest after mouse release)
    // zoom level of the camera
    max_zoom?: number | undefined
    min_zoom?: number | undefined
    zoom_speed?: number // zoom speed. set to 0 to disable zooming.
    pan_speed?: number // pan speed. set to 0 to disable panning.
    show_atoms?: boolean
    show_bonds?: boolean
    show_site_labels?: boolean
    show_force_vectors?: boolean
    force_vector_scale?: number
    force_vector_color?: string
    gizmo?: boolean | ComponentProps<typeof Gizmo>
    hovered_idx?: number | null
    active_idx?: number | null
    hovered_site?: Site | null
    active_site?: Site | null
    precision?: string
    auto_rotate?: number
    bond_thickness?: number
    bond_color?: string
    bonding_strategy?: keyof typeof bonding_strategies
    bonding_options?: Record<string, unknown>
    active_hovered_dist?: ActiveHoveredDist | null // set to null to disable showing distance between hovered and active sites
    fov?: number
    ambient_light?: number
    directional_light?: number
    sphere_segments?: number
    lattice_props?: ComponentProps<typeof Lattice>
    atom_label?: Snippet<[Site, number]>
    site_label_size?: number
    site_label_offset?: Vec3
    site_label_bg_color?: string
    site_label_color?: string
    site_label_padding?: number
    camera_is_moving?: boolean // used to prevent tooltip from showing while camera is moving
    orbit_controls?: ComponentProps<typeof OrbitControls>[`ref`]
  }
  let {
    structure = undefined,
    atom_radius = 0.5,
    same_size_atoms = false,
    camera_position = [0, 0, 0],
    camera_projection = DEFAULTS.structure.projection,
    rotation_damping = DEFAULTS.structure.rotation_damping,
    max_zoom = undefined,
    min_zoom = undefined,
    zoom_speed = DEFAULTS.structure.zoom_speed,
    pan_speed = 1,
    show_atoms = true,
    show_bonds = false,
    show_site_labels = false,
    site_label_size = DEFAULTS.structure.site_label_size,
    site_label_offset = $bindable(DEFAULTS.structure.site_label_offset),
    site_label_bg_color = `color-mix(in srgb, #000000 0%, transparent)`,
    site_label_color = `#ffffff`,
    site_label_padding = 3,
    show_force_vectors = false,
    force_vector_scale = DEFAULTS.structure.force_scale,
    force_vector_color = DEFAULTS.structure.force_color,
    gizmo = true,
    hovered_idx = $bindable(null),
    active_idx = $bindable(null),
    hovered_site = $bindable(null),
    active_site = $bindable(null),
    precision = `.3~f`,
    auto_rotate = DEFAULTS.structure.auto_rotate,
    bond_thickness = DEFAULTS.structure.bond_thickness,
    bond_color = DEFAULTS.structure.bond_color,
    bonding_strategy = `nearest_neighbor`,
    bonding_options = {},
    active_hovered_dist = { color: `green`, width: 0.1, opacity: 0.5 },
    fov = 10,
    ambient_light = 1.8,
    directional_light = 2.5,
    sphere_segments = 20,
    lattice_props = {},
    atom_label,
    camera_is_moving = $bindable(false),
    orbit_controls = $bindable(undefined),
  }: Props = $props()

  let bond_pairs: BondPair[] = $state([])

  interactivity()
  $effect.pre(() => {
    hovered_site = structure?.sites?.[hovered_idx ?? -1] ?? null
  })
  $effect.pre(() => {
    active_site = structure?.sites?.[active_idx ?? -1] ?? null
  })
  let lattice = $derived(
    structure && `lattice` in structure ? structure.lattice : null,
  )

  // Get rotation target: cell center for crystalline structures, center of mass for molecular systems
  let rotation_target = $derived(
    lattice
      ? (math.scale(math.add(...lattice.matrix), 0.5) as Vec3)
      : structure
      ? get_center_of_mass(structure)
      : [0, 0, 0] as Vec3,
  )

  // Calculate structure size for camera setup
  let structure_size = $derived(
    lattice ? (lattice.a + lattice.b + lattice.c) / 2 : 10,
  )

  $effect.pre(() => {
    // Simple camera auto-positioning if not already set: use sum of lattice dimensions for size estimate
    if (camera_position.every((val) => val === 0) && structure) {
      const distance = structure_size * (65 / fov)
      camera_position = [distance, distance * 0.3, distance * 0.8]
    }
  })
  $effect.pre(() => {
    if (structure && show_bonds) {
      bond_pairs = bonding_strategies[bonding_strategy](structure, bonding_options)
    }
  })

  // Update orbit controls when switching between camera projections to ensure proper centering
  $effect(() => {
    if (orbit_controls && camera_projection) {
      // Small delay to ensure camera switch is complete
      setTimeout(() => {
        // Explicitly set the target to the rotation center
        orbit_controls.target.set(...rotation_target)
        orbit_controls.update()
      }, 10)
    }
  })

  // Pre-compute atom data for performance
  let { atom_data, force_data, instanced_atom_groups } = $derived.by(() => {
    if (!show_atoms || !structure?.sites) {
      return { atom_data: [], force_data: [], instanced_atom_groups: [] }
    }

    // Build atom data with partial occupancy handling
    const atoms = structure.sites.flatMap((site, site_idx) => {
      const radius = same_size_atoms ? atom_radius : site.species.reduce(
        (sum, spec) => sum + spec.occu * (atomic_radii[spec.element] ?? 1),
        0,
      ) * atom_radius

      let start_angle = 0
      return site.species.map(({ element, occu }) => ({
        site_idx,
        element,
        occupancy: occu,
        position: site.xyz,
        radius,
        color: colors.element?.[element],
        has_partial_occupancy: occu < 1,
        start_phi: 2 * Math.PI * start_angle,
        end_phi: 2 * Math.PI * (start_angle += occu),
      }))
    })

    // Group full-occupancy atoms for instanced rendering
    const instanced_atom_groups = Object.values(
      atoms.filter((atom) => !atom.has_partial_occupancy)
        .reduce(
          (groups, atom) => {
            const key = `${atom.element}-${atom.radius.toFixed(3)}`
            if (!groups[key]) {
              groups[key] = {
                element: atom.element,
                radius: atom.radius,
                color: atom.color,
                atoms: [],
              }
            }
            groups[key].atoms.push(atom)
            return groups
          },
          {} as Record<
            string,
            { element: string; radius: number; color: string; atoms: typeof atoms }
          >,
        ),
    )

    // Compute force vectors
    const force_data = show_force_vectors
      ? structure.sites
        .map((site) => {
          if (
            !site.properties?.force || !Array.isArray(site.properties.force)
          ) return null
          const majority_element = site.species.reduce((max, spec) =>
            spec.occu > max.occu ? spec : max
          ).element
          return {
            position: site.xyz,
            vector: site.properties.force as Vec3,
            scale: force_vector_scale,
            color: colors.element?.[majority_element] || force_vector_color,
          }
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
      : []

    return { atom_data: atoms, force_data, instanced_atom_groups }
  })

  let gizmo_props = $derived.by(() => {
    const axes = [
      [`x`, `#d75555`, `#e66666`],
      [`y`, `#55b855`, `#66c966`],
      [`z`, `#5555d7`, `#6666e6`],
      [`nx`, `#b84444`, `#cc5555`],
      [`ny`, `#44a044`, `#55b155`],
      [`nz`, `#4444b8`, `#5555c9`],
    ]

    const axis_options = Object.fromEntries(
      axes.map(([axis, color, hover_color]) => [
        axis,
        {
          color,
          labelColor: `#555555`,
          opacity: axis.startsWith(`n`) ? 0.7 : 0.85,
          hover: {
            color: hover_color,
            labelColor: `#222222`,
            opacity: axis.startsWith(`n`) ? 0.85 : 0.95,
          },
        },
      ]),
    )

    return {
      background: { enabled: false },
      className: `responsive-gizmo`,
      ...axis_options,
      ...(typeof gizmo === `boolean` ? {} : gizmo),
    }
  })

  let orbit_controls_props = $derived({
    'bind:ref': orbit_controls,
    position: [0, 0, 0],
    enableZoom: zoom_speed > 0,
    zoomSpeed: camera_projection === `orthographic` ? zoom_speed * 2 : zoom_speed,
    enablePan: pan_speed > 0,
    panSpeed: pan_speed,
    target: rotation_target,
    maxZoom: camera_projection === `orthographic` ? (max_zoom || 200) : max_zoom,
    minZoom: camera_projection === `orthographic` ? (min_zoom || 0.1) : min_zoom,
    autoRotate: Boolean(auto_rotate),
    autoRotateSpeed: auto_rotate,
    enableDamping: Boolean(rotation_damping),
    dampingFactor: rotation_damping,
    onstart: () => {
      camera_is_moving = true
      hovered_idx = null
    },
    onend: () => {
      camera_is_moving = false
    },
  })
</script>

{#snippet site_label_snippet(element: string, position: Vec3, site_idx: number)}
  {@const [x, y, z] = math.add(position, site_label_offset)}
  <HTML center {position} position.x={x} position.y={y} position.z={z}>
    {#if atom_label}
      {@render atom_label(structure!.sites[site_idx], site_idx)}
    {:else}
      <span
        class="atom-label"
        style:font-size="{site_label_size}em"
        style:background={site_label_bg_color}
        style:padding="{site_label_padding}px"
        style:color={site_label_color}
      >{element}</span>
    {/if}
  </HTML>
{/snippet}

{#if camera_projection === `perspective`}
  <T.PerspectiveCamera makeDefault position={camera_position} {fov}>
    <OrbitControls {...orbit_controls_props}>
      {#if gizmo}<Gizmo {...gizmo_props} />{/if}
    </OrbitControls>
  </T.PerspectiveCamera>
{:else}
  {@const ortho_size = structure_size * 1.5}
  <T.OrthographicCamera
    makeDefault
    position={camera_position}
    zoom={50}
    left={-ortho_size}
    right={ortho_size}
    top={ortho_size}
    bottom={-ortho_size}
    near={0.1}
    far={1000}
  >
    <OrbitControls {...orbit_controls_props}>
      {#if gizmo}<Gizmo {...gizmo_props} />{/if}
    </OrbitControls>
  </T.OrthographicCamera>
{/if}

<T.DirectionalLight position={[3, 10, 10]} intensity={directional_light} />
<T.AmbientLight intensity={ambient_light} />

{#if show_atoms}
  <!-- Instanced rendering for full occupancy atoms -->
  {#each instanced_atom_groups as group (group.element + group.radius)}
    <InstancedMesh limit={group.atoms.length} range={group.atoms.length}>
      <T.SphereGeometry args={[0.5, sphere_segments, sphere_segments]} />
      <T.MeshStandardMaterial color={group.color} />
      {#each group.atoms as atom (atom.site_idx)}
        <Instance
          position={atom.position}
          scale={atom.radius}
          onpointerenter={() => hovered_idx = atom.site_idx}
          onpointerleave={() => hovered_idx = null}
          onclick={() => active_idx = active_idx === atom.site_idx ? null : atom.site_idx}
        />
      {/each}
    </InstancedMesh>
  {/each}

  <!-- Regular rendering for partial occupancy atoms -->
  {#each atom_data.filter((atom) => atom.has_partial_occupancy) as
    atom
    (atom.site_idx + atom.element + atom.occupancy)
  }
    <T.Group
      position={atom.position}
      scale={atom.radius}
      onpointerenter={() => hovered_idx = atom.site_idx}
      onpointerleave={() => hovered_idx = null}
      onclick={() => active_idx = active_idx === atom.site_idx ? null : atom.site_idx}
    >
      <T.Mesh>
        <T.SphereGeometry
          args={[
            0.5,
            sphere_segments,
            sphere_segments,
            atom.start_phi,
            2 * Math.PI * atom.occupancy,
          ]}
        />
        <T.MeshStandardMaterial color={atom.color} />
      </T.Mesh>

      {#if atom.has_partial_occupancy}
        <T.Mesh rotation={[0, atom.start_phi, 0]}>
          <T.CircleGeometry args={[0.5, sphere_segments]} />
          <T.MeshStandardMaterial color={atom.color} side={2} />
        </T.Mesh>
        <T.Mesh rotation={[0, atom.end_phi, 0]}>
          <T.CircleGeometry args={[0.5, sphere_segments]} />
          <T.MeshStandardMaterial color={atom.color} side={2} />
        </T.Mesh>
      {/if}
    </T.Group>

    {#if show_site_labels}
      {@render site_label_snippet(atom.element, atom.position, atom.site_idx)}
    {/if}
  {/each}

  <!-- Site labels for instanced atoms -->
  {#if show_site_labels}
    {#each instanced_atom_groups as group (group.element + group.radius)}
      {#each group.atoms as atom (atom.site_idx)}
        {@render site_label_snippet(atom.element, atom.position, atom.site_idx)}
      {/each}
    {/each}
  {/if}
{/if}

{#if force_data.length > 0}
  {#each force_data as force (force.position.join(`,`) + force.vector.join(`,`))}
    <Vector {...force} />
  {/each}
{/if}

{#if show_bonds}
  {#each bond_pairs as [from, to, idx_a, idx_b] ([from, to, idx_a, idx_b])}
    {@const site_a = structure?.sites[idx_a]}
    {@const site_b = structure?.sites[idx_b]}
    {@const get_majority_color = (site: typeof site_a) => {
    if (!site?.species || site.species.length === 0) return bond_color
    // Find species with highest occupancy
    const majority_species = site.species.reduce((max, spec) =>
      spec.occu > max.occu ? spec : max
    )
    return colors.element?.[majority_species.element] || bond_color
  }}
    {@const from_color = get_majority_color(site_a)}
    {@const to_color = get_majority_color(site_b)}
    <Bond
      {from}
      {to}
      thickness={bond_thickness}
      {from_color}
      {to_color}
      color={bond_color}
    />
  {/each}
{/if}

<!-- highlight active and hovered sites -->
{#each [{ site: hovered_site, opacity: 0.2 }, { site: active_site, opacity: 0.3 }] as
  { site, opacity }
  (opacity)
}
  {#if site}
    {@const { xyz, species } = site}
    {@const highlight_radius = atom_radius * (same_size_atoms
    ? 1
    : species.reduce((sum, spec) =>
      sum + spec.occu * (atomic_radii[spec.element] ?? 1), 0))}
    <T.Mesh position={xyz} scale={1.02 * highlight_radius}>
      <T.SphereGeometry args={[0.5, 20, 20]} />
      <T.MeshStandardMaterial color="white" transparent {opacity} />
    </T.Mesh>
  {/if}
{/each}

<!-- cylinder between active and hovered site to indicate measured distance -->
{#if active_site && hovered_site && active_hovered_dist}
  {@const { color, width } = active_hovered_dist}
  <Bond from={active_site.xyz} to={hovered_site.xyz} thickness={width} {color} />
{/if}

<!-- hovered site tooltip -->
{#if hovered_site && !camera_is_moving}
  <CanvasTooltip position={hovered_site.xyz}>
    <!-- Element symbols with occupancies for disordered sites -->
    <div class="elements">
      {#each hovered_site.species ?? [] as
        { element, occu, oxidation_state: oxi_state },
        idx
        ([element, occu, oxi_state])
      }
        {@const oxi_str = oxi_state != null && oxi_state !== 0
        ? `<sup>${oxi_state}${oxi_state > 0 ? `+` : `-`}</sup>`
        : ``}
        {@const element_name = element_data.find((elem) => elem.symbol === element)?.name ??
        ``}
        {#if idx > 0}&thinsp;{/if}
        {#if occu !== 1}<span class="occupancy">{format_num(occu, `.3~f`)}</span>{/if}
        <strong>{element}{@html oxi_str}</strong>
        {#if element_name}<span class="elem-name">{element_name}</span>{/if}
      {/each}
    </div>
    <div class="coordinates fractional">
      abc: ({hovered_site.abc.map((num) => format_num(num, precision)).join(`, `)})
    </div>
    <div class="coordinates cartesian">
      xyz: ({hovered_site.xyz.map((num) => format_num(num, precision)).join(`, `)}) Å
    </div>
    <!-- distance from hovered to active site -->
    {#if active_site && active_site != hovered_site && active_hovered_dist}
      {@const direct_distance = math.euclidean_dist(hovered_site.xyz, active_site.xyz)}
      {@const pbc_distance = lattice
      ? math.pbc_dist(hovered_site.xyz, active_site.xyz, lattice.matrix)
      : direct_distance}
      <div class="distance">
        <strong>dist:</strong>
        {format_num(pbc_distance, precision)} Å{lattice ? ` (PBC)` : ``}
        {#if lattice && Math.abs(pbc_distance - direct_distance) > 0.1}
          <small> | direct: {format_num(direct_distance, precision)} Å</small>
        {/if}
      </div>
    {/if}
  </CanvasTooltip>
{/if}

{#if lattice}
  <Lattice matrix={lattice.matrix} {...lattice_props} />
{/if}

<style>
  :global(.responsive-gizmo) {
    width: clamp(70px, 12cqw, 100px) !important;
    height: clamp(70px, 12cqw, 100px) !important;
  }
  .atom-label {
    background: var(--struct-atom-label-bg, rgba(0, 0, 0, 0.1));
    border-radius: var(--struct-atom-label-border-radius, 3pt);
    padding: var(--struct-atom-label-padding, 0 3px);
  }
  .elements {
    margin-bottom: var(--struct-tooltip-elements-margin);
  }
  .occupancy {
    font-size: var(--struct-tooltip-occu-font-size);
    opacity: var(--struct-tooltip-occu-opacity);
    margin-right: var(--struct-tooltip-occu-margin);
  }
  .elem-name {
    font-size: var(--struct-tooltip-elem-name-font-size, 0.85em);
    opacity: var(--struct-tooltip-elem-name-opacity, 0.7);
    margin: var(--struct-tooltip-elem-name-margin, 0 0 0 0.3em);
    font-weight: var(--struct-tooltip-elem-name-font-weight, normal);
  }
  .coordinates,
  .distance {
    font-size: var(--struct-tooltip-coords-font-size);
    margin: var(--struct-tooltip-coords-margin);
  }
</style>
