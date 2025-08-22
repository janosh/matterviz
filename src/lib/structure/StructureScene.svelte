<script lang="ts">
  import type { AnyStructure, BondPair, Site, Vec3 } from '$lib'
  import { atomic_radii, element_data } from '$lib'
  import { format_num } from '$lib/labels'
  import * as math from '$lib/math'
  import { DEFAULTS, type ShowBonds } from '$lib/settings'
  import { colors } from '$lib/state.svelte'
  import { Bond, get_center_of_mass, Lattice, Vector } from '$lib/structure'
  import {
    displacement_pbc,
    distance_pbc,
    MAX_SELECTED_SITES,
  } from '$lib/structure/measure'
  import { T } from '@threlte/core'
  import * as Extras from '@threlte/extras'
  import type { ComponentProps } from 'svelte'
  import { type Snippet, untrack } from 'svelte'
  import { BONDING_STRATEGIES, type BondingStrategy } from './bonding'
  import { CanvasTooltip } from './index'

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
    show_bonds?: ShowBonds
    show_site_labels?: boolean
    show_force_vectors?: boolean
    force_vector_scale?: number
    force_vector_color?: string
    gizmo?: boolean | ComponentProps<typeof Extras.Gizmo>
    hovered_idx?: number | null
    hovered_site?: Site | null
    float_fmt?: string
    auto_rotate?: number
    initial_zoom?: number
    bond_thickness?: number
    bond_color?: string
    bonding_strategy?: BondingStrategy
    bonding_options?: Record<string, unknown>
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
    orbit_controls?: ComponentProps<typeof Extras.OrbitControls>[`ref`]
    width?: number // Viewer dimensions for responsive zoom
    height?: number
    // measurement props
    measure_mode?: `distance` | `angle`
    selected_sites?: number[]
    measured_sites?: number[]
    selection_highlight_color?: string
  }
  let {
    structure = undefined,
    atom_radius = DEFAULTS.structure.atom_radius,
    same_size_atoms = false,
    camera_position = DEFAULTS.structure.camera_position,
    camera_projection = DEFAULTS.structure.camera_projection,
    rotation_damping = DEFAULTS.structure.rotation_damping,
    max_zoom = DEFAULTS.structure.max_zoom,
    min_zoom = DEFAULTS.structure.min_zoom,
    zoom_speed = DEFAULTS.structure.zoom_speed,
    pan_speed = DEFAULTS.structure.pan_speed,
    show_atoms = DEFAULTS.structure.show_atoms,
    show_bonds = DEFAULTS.structure.show_bonds,
    show_site_labels = DEFAULTS.structure.show_site_labels,
    site_label_size = DEFAULTS.structure.site_label_size,
    site_label_offset = $bindable(DEFAULTS.structure.site_label_offset),
    site_label_bg_color = `color-mix(in srgb, #000000 0%, transparent)`,
    site_label_color = `#ffffff`,
    site_label_padding = 3,
    show_force_vectors = DEFAULTS.structure.show_force_vectors,
    force_vector_scale = DEFAULTS.structure.force_scale,
    force_vector_color = DEFAULTS.structure.force_color,
    gizmo = DEFAULTS.structure.show_gizmo,
    hovered_idx = $bindable(null),
    hovered_site = $bindable(null),
    float_fmt = `.3~f`,
    auto_rotate = DEFAULTS.structure.auto_rotate,
    bond_thickness = DEFAULTS.structure.bond_thickness,
    bond_color = DEFAULTS.structure.bond_color,
    bonding_strategy = DEFAULTS.structure.bonding_strategy,
    bonding_options = {},
    fov = DEFAULTS.structure.fov,
    initial_zoom = DEFAULTS.structure.initial_zoom,
    ambient_light = DEFAULTS.structure.ambient_light,
    directional_light = DEFAULTS.structure.directional_light,
    sphere_segments = DEFAULTS.structure.sphere_segments,
    lattice_props = {},
    atom_label,
    camera_is_moving = $bindable(false),
    orbit_controls = $bindable(undefined),
    width = 0,
    height = 0,
    measure_mode = `distance`,
    selected_sites = $bindable([]),
    measured_sites = $bindable([]),
    selection_highlight_color = `#6cf0ff`,
  }: Props = $props()

  let bond_pairs: BondPair[] = $state([])
  let active_tooltip = $state<`atom` | `bond` | null>(null)
  let hovered_bond_data: BondPair | null = $state(null)

  function toggle_selection(site_index: number, evt?: Event) {
    evt?.stopPropagation?.()

    // Check if adding this site would exceed the soft cap
    if (
      !measured_sites.includes(site_index) &&
      measured_sites.length >= MAX_SELECTED_SITES
    ) {
      console.warn(
        `Selection size limit reached (${MAX_SELECTED_SITES}). Deselect some sites first.`,
      )
      return
    }

    measured_sites = measured_sites.includes(site_index)
      ? measured_sites.filter((idx) => idx !== site_index)
      : [...measured_sites, site_index]
  }

  // Keep measured site selection valid across structure changes (new structure might have fewer sites)
  $effect(() => {
    const count = structure?.sites?.length ?? 0
    if (count <= 0) {
      measured_sites = []
      return
    }
    untrack(() => {
      measured_sites = measured_sites.filter((idx) => idx >= 0 && idx < count)
    })
  })

  Extras.interactivity()
  $effect.pre(() => {
    hovered_site = structure?.sites?.[hovered_idx ?? -1] ?? null
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

  // Persisted zoom; recompute only on viewport changes
  let computed_zoom = $state<number>(initial_zoom)
  $effect(() => {
    if (!(width > 0) || !(height > 0)) return
    // Avoid depending on structure/structure_size so trajectories don't retrigger zoom
    const structure_max_dim = Math.max(1, untrack(() => structure_size))
    const viewer_min_dim = Math.min(width, height)
    const scale_factor = viewer_min_dim / (structure_max_dim * 50) // 50px per unit
    let new_zoom = initial_zoom * scale_factor
    if (min_zoom && min_zoom > 0) new_zoom = Math.max(min_zoom, new_zoom)
    if (max_zoom && max_zoom > 0) new_zoom = Math.min(max_zoom, new_zoom)
    computed_zoom = new_zoom
  })

  $effect.pre(() => {
    // Simple initial camera auto-position: proportional to structure size and fov
    if (camera_position.every((v) => v === 0) && structure) {
      const distance = Math.max(1, structure_size) * (60 / fov)
      camera_position = [distance, distance * 0.3, distance * 0.8]
    }
  })
  $effect.pre(() => {
    if (structure && show_bonds !== `never`) {
      // Determine if we should show bonds based on the setting and structure type
      const should_show_bonds = show_bonds === `always` ||
        (show_bonds === `crystals` && lattice) ||
        (show_bonds === `molecules` && !lattice)

      if (should_show_bonds) {
        bond_pairs = BONDING_STRATEGIES[bonding_strategy](structure, bonding_options)
      } else bond_pairs = []
    } else bond_pairs = []
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
  {@const pos = math.add(position, site_label_offset)}
  <Extras.HTML center position={pos}>
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
  </Extras.HTML>
{/snippet}

{#if camera_projection === `perspective`}
  <T.PerspectiveCamera makeDefault position={camera_position} {fov}>
    <Extras.OrbitControls {...orbit_controls_props}>
      {#if gizmo}<Extras.Gizmo {...gizmo_props} />{/if}
    </Extras.OrbitControls>
  </T.PerspectiveCamera>
{:else}
  <T.OrthographicCamera
    makeDefault
    position={camera_position}
    zoom={computed_zoom}
    near={-100}
  >
    <Extras.OrbitControls {...orbit_controls_props}>
      {#if gizmo}<Extras.Gizmo {...gizmo_props} />{/if}
    </Extras.OrbitControls>
  </T.OrthographicCamera>
{/if}

<T.DirectionalLight position={[3, 10, 10]} intensity={directional_light} />
<T.AmbientLight intensity={ambient_light} />

{#if show_atoms}
  <!-- Instanced rendering for full occupancy atoms -->
  {#each instanced_atom_groups as group (group.element + group.radius)}
    <Extras.InstancedMesh
      key="{group.element}-{group.radius}-{group.atoms.length}"
      range={group.atoms.length}
    >
      <T.SphereGeometry args={[0.5, sphere_segments, sphere_segments]} />
      <T.MeshStandardMaterial color={group.color} />
      {#each group.atoms as atom (atom.site_idx)}
        <Extras.Instance
          position={atom.position}
          scale={atom.radius}
          onpointerenter={() => {
            hovered_idx = atom.site_idx
            active_tooltip = `atom`
            hovered_bond_data = null
          }}
          onpointerleave={() => {
            hovered_idx = null
            active_tooltip = null
          }}
          onclick={(event: MouseEvent) => {
            const site_idx = atom.site_idx
            toggle_selection(site_idx, event)
          }}
        />
      {/each}
    </Extras.InstancedMesh>
  {/each}

  <!-- Regular rendering for partial occupancy atoms -->
  {#each atom_data.filter((atom) => atom.has_partial_occupancy) as
    atom
    (atom.site_idx + atom.element + atom.occupancy)
  }
    <T.Group
      position={atom.position}
      scale={atom.radius}
      onpointerenter={() => {
        hovered_idx = atom.site_idx
        active_tooltip = `atom`
        hovered_bond_data = null
      }}
      onpointerleave={() => {
        hovered_idx = null
        active_tooltip = null
      }}
      onclick={(event: MouseEvent) => {
        const site_idx = atom.site_idx
        toggle_selection(site_idx, event)
      }}
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

{#if bond_pairs.length > 0}
  {#each bond_pairs as bond_data (JSON.stringify(bond_data))}
    {@const site_a = structure?.sites[bond_data.site_idx_1]}
    {@const site_b = structure?.sites[bond_data.site_idx_2]}
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
      from={bond_data.pos_1}
      to={bond_data.pos_2}
      thickness={bond_thickness}
      {from_color}
      {to_color}
      color={bond_color}
      {bond_data}
      {bonding_strategy}
      {active_tooltip}
      {hovered_bond_data}
      onbondhover={(data) => hovered_bond_data = data}
      ontooltipchange={(type) => active_tooltip = type}
    />
  {/each}
{/if}

<!-- highlight hovered, active and selected sites -->
{#each [
    {
      kind: `hover`,
      site: hovered_site,
      opacity: 0.28,
      color: `white`,
      site_idx: hovered_idx,
    },
    ...((selected_sites ?? []).map((idx) => ({
      kind: `selected`,
      site: structure?.sites?.[idx] ?? null,
      site_idx: idx,
      opacity: 0.6,
      color: selection_highlight_color,
    }))),
  ] as
  entry
  (`${entry.kind}-${entry.site_idx}`)
}
  {@const site = entry.site}
  {@const opacity = entry.opacity}
  {@const color = entry.color}
  {#if site}
    {@const xyz = site.xyz}
    {@const species = site.species}
    {@const highlight_radius = atom_radius * (same_size_atoms
    ? 1
    : species.reduce((sum, spec) =>
      sum + spec.occu * (atomic_radii[spec.element] ?? 1), 0))}
    <T.Mesh
      position={xyz}
      scale={1.2 * highlight_radius}
      onclick={(event: MouseEvent) => {
        if (entry?.site_idx !== null && Number.isInteger(entry.site_idx)) {
          toggle_selection(entry.site_idx, event)
        }
      }}
    >
      <T.SphereGeometry args={[0.5, 22, 22]} />
      <T.MeshStandardMaterial
        {color}
        transparent
        {opacity}
        emissive={color}
        emissiveIntensity={entry.kind === `selected` ? 0.5 : 0.2}
      />
    </T.Mesh>
  {/if}
{/each}

<!-- selection order labels (1, 2, 3, ...) for measured sites -->
{#if structure?.sites && (measured_sites?.length ?? 0) > 0}
  {#each measured_sites as site_index, loop_idx (site_index)}
    {@const site = structure.sites[site_index]}
    {#if site}
      {@const pos = math.add(site.xyz, site_label_offset)}
      <Extras.HTML center position={pos}>
        <span class="selection-label">{loop_idx + 1}</span>
      </Extras.HTML>
    {/if}
  {/each}
{/if}

<!-- hovered site tooltip -->
{#if hovered_site && !camera_is_moving && active_tooltip === `atom`}
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
      abc: ({hovered_site.abc.map((num) => format_num(num, float_fmt)).join(`, `)})
    </div>
    <div class="coordinates cartesian">
      xyz: ({hovered_site.xyz.map((num) => format_num(num, float_fmt)).join(`, `)}) Å
    </div>
  </CanvasTooltip>
{/if}

{#if lattice}
  <Lattice matrix={lattice.matrix} {...lattice_props} />
{/if}

<!-- Measurement overlays for measured sites -->
{#if structure?.sites && (measured_sites?.length ?? 0) > 0}
  {#if measure_mode === `distance`}
    {#each measured_sites as idx_i, loop_idx (idx_i)}
      {#each measured_sites.slice(loop_idx + 1) as idx_j (idx_i + `-` + idx_j)}
        {@const site_i = structure.sites[idx_i]}
        {@const site_j = structure.sites[idx_j]}
        {@const pos_i = site_i.xyz}
        {@const pos_j = site_j.xyz}
        <Bond from={pos_i} to={pos_j} thickness={0.06} color="#cccccc" />
        {@const midpoint = [
    (pos_i[0] + pos_j[0]) / 2,
    (pos_i[1] + pos_j[1]) / 2,
    (pos_i[2] + pos_j[2]) / 2,
  ] as Vec3}
        {@const direct = math.euclidean_dist(pos_i, pos_j)}
        {@const pbc = lattice ? distance_pbc(pos_i, pos_j, lattice.matrix) : direct}
        {@const differ = lattice ? Math.abs(pbc - direct) > 1e-6 : false}
        <Extras.HTML center position={midpoint}>
          <span class="measure-label">
            {#if differ}
              PBC: {format_num(pbc, float_fmt)} Å<br /><small>
                Direct: {format_num(direct, float_fmt)} Å</small>
            {:else}
              {format_num(pbc, float_fmt)} Å
            {/if}
          </span>
        </Extras.HTML>
      {/each}
    {/each}
  {:else if measure_mode === `angle` && measured_sites.length >= 3}
    {#each measured_sites as idx_center (idx_center)}
      {@const center = structure.sites[idx_center]}
      {#each measured_sites.filter((x) => x !== idx_center) as
        idx_a,
        loop_idx
        (idx_center + `-` + idx_a)
      }
        {#each measured_sites.filter((x) => x !== idx_center).slice(loop_idx + 1) as
          idx_b
          (idx_center + `-` + idx_a + `-` + idx_b)
        }
          {@const site_a = structure.sites[idx_a]}
          {@const site_b = structure.sites[idx_b]}
          {@const v1 = lattice ? displacement_pbc(center.xyz, site_a.xyz, lattice.matrix) : ([
    site_a.xyz[0] - center.xyz[0],
    site_a.xyz[1] - center.xyz[1],
    site_a.xyz[2] - center.xyz[2],
  ] as Vec3)}
          {@const v2 = lattice ? displacement_pbc(center.xyz, site_b.xyz, lattice.matrix) : ([
    site_b.xyz[0] - center.xyz[0],
    site_b.xyz[1] - center.xyz[1],
    site_b.xyz[2] - center.xyz[2],
  ] as Vec3)}
          {@const n1 = Math.hypot(v1[0], v1[1], v1[2])}
          {@const n2 = Math.hypot(v2[0], v2[1], v2[2])}
          {@const cos_ang = Math.max(
    -1,
    Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) / (n1 * n2)),
  )}
          {@const angle_deg = Math.acos(cos_ang) * 180 / Math.PI}
          {#if n1 > math.EPS && n2 > math.EPS}
            <!-- draw rays from center to the two sites -->
            <Bond from={center.xyz} to={site_a.xyz} thickness={0.05} color="#bbbbbb" />
            <Bond from={center.xyz} to={site_b.xyz} thickness={0.05} color="#bbbbbb" />
            {@const bisector = [
    v1[0] / n1 + v2[0] / n2,
    v1[1] / n1 + v2[1] / n2,
    v1[2] / n1 + v2[2] / n2,
  ] as Vec3}
            {@const bis_norm = Math.sqrt(bisector[0] ** 2 + bisector[1] ** 2 + bisector[2] ** 2) || 1}
            {@const offset_dir = [
    bisector[0] / bis_norm,
    bisector[1] / bis_norm,
    bisector[2] / bis_norm,
  ] as Vec3}
            {@const label_pos = [
    center.xyz[0] + offset_dir[0] * 0.6,
    center.xyz[1] + offset_dir[1] * 0.6,
    center.xyz[2] + offset_dir[2] * 0.6,
  ] as Vec3}
            <Extras.HTML center position={label_pos}>
              <span class="measure-label">{format_num(angle_deg, float_fmt)}°</span>
            </Extras.HTML>
          {/if}
        {/each}
      {/each}
    {/each}
  {/if}
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
    margin-bottom: var(--canvas-tooltip-elements-margin);
  }
  .occupancy {
    font-size: var(--canvas-tooltip-occu-font-size);
    opacity: var(--canvas-tooltip-occu-opacity);
    margin-right: var(--canvas-tooltip-occu-margin);
  }
  .elem-name {
    font-size: var(--canvas-tooltip-elem-name-font-size, 0.85em);
    opacity: var(--canvas-tooltip-elem-name-opacity, 0.7);
    margin: var(--canvas-tooltip-elem-name-margin, 0 0 0 0.3em);
    font-weight: var(--canvas-tooltip-elem-name-font-weight, normal);
  }
  .coordinates {
    font-size: var(--canvas-tooltip-coords-font-size);
    margin: var(--canvas-tooltip-coords-margin);
  }
  .measure-label {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 4px;
    padding: 0 5px;
    user-select: none;
    white-space: pre;
    display: grid;
    place-items: center;
    line-height: 1.2;
    font-size: var(--canvas-tooltip-font-size, clamp(8pt, 1.5cqw, 18pt));
  }
  .selection-label {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.2em;
    height: 1.2em;
    padding: 0 0.25em;
    border-radius: 999px;
    background: var(--pane-btn-bg-hover);
    color: var(--struct-text-color);
    font-size: 0.85em;
    line-height: 1;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }
</style>
