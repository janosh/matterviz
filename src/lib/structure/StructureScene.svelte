<script lang="ts">
  import type { AnyStructure, BondPair, Site, Vec3 } from '$lib'
  import { atomic_radii, axis_colors, element_data, neg_axis_colors } from '$lib'
  import { format_num } from '$lib/labels'
  import * as math from '$lib/math'
  import { DEFAULTS, type ShowBonds } from '$lib/settings'
  import { colors } from '$lib/state.svelte'
  import { Bond, get_center_of_mass, Lattice, Vector } from '$lib/structure'
  import {
    angle_between_vectors,
    distance_pbc,
    MAX_SELECTED_SITES,
    smart_displacement_vectors,
  } from '$lib/structure/measure'
  import { T } from '@threlte/core'
  import * as Extras from '@threlte/extras'
  import { TransformControls } from '@threlte/extras'
  import type { ComponentProps } from 'svelte'
  import { type Snippet, untrack } from 'svelte'
  import { SvelteMap } from 'svelte/reactivity'
  import { BONDING_STRATEGIES, type BondingStrategy } from './bonding'
  import { CanvasTooltip } from './index'

  // Add pulsating animation for selected sites
  let pulse_time = $state(0)
  let pulse_opacity = $derived(0.15 + 0.25 * Math.sin(pulse_time * 5))

  // Update pulse time for animation
  $effect(() => {
    if (!selected_sites?.length && !active_sites?.length) return
    if (typeof globalThis === `undefined`) return
    const reduce = globalThis.matchMedia?.(`(prefers-reduced-motion: reduce)`).matches
    if (reduce) return
    let frame_id = 0
    const animate = () => {
      pulse_time += 0.015
      frame_id = requestAnimationFrame(animate)
    }
    frame_id = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame_id)
  })

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
    show_site_indices?: boolean
    show_force_vectors?: boolean
    force_scale?: number
    force_color?: string
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
    measure_mode?: `distance` | `angle` | `edit`
    selected_sites?: number[]
    measured_sites?: number[]
    selection_highlight_color?: string
    // Support for active highlight group with different color
    active_sites?: number[]
    active_highlight_color?: string
    rotation?: Vec3 // rotation control prop
    original_atom_count?: number // number of atoms in original structure (before image atoms)
    on_atom_move?: (
      event: {
        detail: {
          site_idx: number
          new_position: Vec3
          new_abc?: Vec3
          element?: string
          delete_site_idx?: number
        }
      },
    ) => void
    on_operation_start?: () => void
    on_operation_end?: () => void
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
    show_site_indices = DEFAULTS.structure.show_site_indices,
    site_label_size = DEFAULTS.structure.site_label_size,
    site_label_offset = $bindable(DEFAULTS.structure.site_label_offset),
    site_label_bg_color = `color-mix(in srgb, #000000 0%, transparent)`,
    site_label_color = `#ffffff`,
    site_label_padding = 3,
    show_force_vectors = DEFAULTS.structure.show_force_vectors,
    force_scale = DEFAULTS.structure.force_scale,
    force_color = DEFAULTS.structure.force_color,
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
    // Active highlight group with different color
    active_sites = $bindable([]),
    active_highlight_color = `var(--struct-active-highlight-color, #2563eb)`,
    rotation = DEFAULTS.structure.rotation,
    original_atom_count,
    on_atom_move,
    on_operation_start,
    on_operation_end,
  }: Props = $props()

  let bond_pairs: BondPair[] = $state([])
  let active_tooltip = $state<`atom` | `bond` | null>(null)
  let hovered_bond_data: BondPair | null = $state(null)

  // Transform controls state
  let transform_controls = $state<any>(undefined)
  let is_transforming = $state(false)
  let transform_object = $state<any>(undefined)
  let drag_coordinates = $state<{ xyz: Vec3; abc?: Vec3 } | null>(null)
  let has_saved_history_for_drag = $state(false)

  // Context menu state
  let context_menu = $state<{ x: number; y: number; world_pos: Vec3 } | null>(null)
  let selected_element = $state(`C`) // Default to Carbon

  // Helper functions
  const get_material_props = (item: { color: string; is_image_atom?: boolean }) => ({
    color: item.color,
    opacity: item.is_image_atom && measure_mode === `edit` ? 0.4 : 1.0,
    transparent: item.is_image_atom && measure_mode === `edit`,
  })

  const get_atom_handlers = (atom: typeof atom_data[0]) => ({
    onpointerenter: () => {
      hovered_idx = atom.site_idx
      active_tooltip = `atom`
      hovered_bond_data = null
    },
    onpointerleave: () => {
      hovered_idx = null
      active_tooltip = null
    },
    onclick: (event: MouseEvent) => {
      if (measure_mode === `edit` && atom.is_image_atom) return
      toggle_selection(atom.site_idx, event)
    },
    style: atom.is_image_atom && measure_mode === `edit`
      ? `cursor: not-allowed`
      : `cursor: pointer`,
  })

  // Function to update atom position after transformation
  function update_atom_position(
    site_idx: number,
    new_position: Vec3,
  ) {
    if (!structure?.sites?.[site_idx] || !on_atom_move) return

    let new_abc: Vec3 | undefined
    if (lattice) {
      try {
        const lattice_transposed = math.transpose_3x3_matrix(lattice.matrix)
        const lattice_inv = math.matrix_inverse_3x3(lattice_transposed)
        const raw_abc = math.mat3x3_vec3_multiply(lattice_inv, new_position)
        new_abc = raw_abc.map((coord) => coord - Math.floor(coord)) as Vec3
      } catch {
        console.warn(
          `Failed to calculate fractional coordinates for site ${site_idx}`,
        )
      }
    }

    on_atom_move({
      detail: {
        site_idx,
        new_position: [...new_position] as Vec3,
        new_abc,
      },
    })
  }

  // Function to update multiple atoms at once (for batch operations)
  function update_multiple_atoms(
    updates: Array<{ site_idx: number; new_position: Vec3 }>,
  ) {
    if (!on_atom_move || updates.length === 0) return

    // For batch updates, just update all atoms without individual history saves
    for (const { site_idx, new_position } of updates) {
      update_atom_position(site_idx, new_position)
    }
  }

  // Add atom at position
  function add_atom(position: Vec3, element: string) {
    if (!on_atom_move) return

    let abc: Vec3 | undefined
    if (lattice) {
      try {
        const lattice_transposed = math.transpose_3x3_matrix(lattice.matrix)
        const lattice_inv = math.matrix_inverse_3x3(lattice_transposed)
        const raw_abc = math.mat3x3_vec3_multiply(lattice_inv, position)
        abc = raw_abc.map((coord) => coord - Math.floor(coord)) as Vec3
      } catch {
        console.warn(`Failed to calculate fractional coordinates for new atom`)
      }
    }

    // Emit add atom event with special site_idx of -1 to indicate new atom
    on_atom_move({
      detail: {
        site_idx: -1,
        new_position: [...position] as Vec3,
        new_abc: abc,
        element,
      },
    })
  }

  // Delete selected atoms
  function delete_selected_atoms() {
    if (!on_atom_move || selected_sites.length === 0) return

    // Emit delete events for selected atoms (site_idx: -2 indicates deletion)
    for (const site_idx of selected_sites) {
      on_atom_move({
        detail: {
          site_idx: -2,
          new_position: [0, 0, 0] as Vec3,
          delete_site_idx: site_idx,
        },
      })
    }

    // Clear selection
    selected_sites = []
    measured_sites = []
  }

  function toggle_selection(site_index: number, evt?: Event) {
    evt?.stopPropagation?.()

    // In edit mode, allow multi-selection with Shift+Click
    if (measure_mode === `edit`) {
      const is_currently_selected = selected_sites.includes(site_index)
      const is_shift_click = evt instanceof MouseEvent && evt.shiftKey

      if (is_shift_click) {
        // Multi-selection mode
        if (is_currently_selected) {
          // Remove from selection
          selected_sites = selected_sites.filter((idx) => idx !== site_index)
          measured_sites = measured_sites.filter((idx) => idx !== site_index)
        } else {
          // Add to selection
          selected_sites = [...selected_sites, site_index]
          measured_sites = [...measured_sites, site_index]
        }
      } else {
        // Single selection mode - clear previous selections and select only this atom
        if (is_currently_selected) {
          // Deselect this atom
          selected_sites = []
          measured_sites = []
        } else {
          // Select only this atom (clear others)
          selected_sites = [site_index]
          measured_sites = [site_index]
        }
      }
      return
    }

    // Normal measurement mode behavior
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
    // keep selected_sites in sync with user clicks
    selected_sites = selected_sites.includes(site_index)
      ? selected_sites.filter((idx) => idx !== site_index)
      : [...selected_sites, site_index]
  }

  // Keep measured site selection valid across structure changes (new structure might have fewer sites)
  $effect(() => {
    const count = structure?.sites?.length ?? 0
    if (count <= 0) {
      measured_sites = []
      selected_sites = []
      return
    }
    untrack(() => {
      measured_sites = measured_sites.filter((idx) => idx >= 0 && idx < count)
      selected_sites = selected_sites.filter((idx) => idx >= 0 && idx < count)
    })
  })

  // Clear selection when switching away from edit mode or when switching between modes
  $effect(() => {
    // When switching to edit mode, limit selection to one atom
    if (measure_mode === `edit` && selected_sites.length > 1) {
      selected_sites = selected_sites.slice(0, 1)
      measured_sites = measured_sites.slice(0, 1)
    }
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
      queueMicrotask(() => {
        orbit_controls.target.set(...rotation_target) // Structure is positioned with rotation_target as the center
        orbit_controls.update()
      })
    }
  })

  let atom_data = $derived.by(() => { // Pre-compute atom data for performance (site_idx, element, occupancy, position, radius, color, ...)
    if (!show_atoms || !structure?.sites) return []

    // Determine which atoms are image atoms
    const base_atom_count = original_atom_count || structure.sites.length

    // Build atom data with partial occupancy handling
    return structure.sites.flatMap((site, site_idx) => {
      const radius = same_size_atoms ? atom_radius : site.species.reduce(
        (sum, spec) => sum + spec.occu * (atomic_radii[spec.element] ?? 1),
        0,
      ) * atom_radius

      // Check if this is an image atom
      const is_image_atom = site_idx >= base_atom_count

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
        is_image_atom, // Add flag to identify image atoms
      }))
    })
  })

  let radius_by_site_idx = $derived.by(() => { // Precompute radius lookup to avoid per-frame search
    const map = new SvelteMap<number, number>()
    for (const atom of atom_data) {
      if (!map.has(atom.site_idx)) map.set(atom.site_idx, atom.radius)
    }
    return map
  })

  let force_data = $derived.by(() => { // Compute force vectors
    return show_force_vectors && structure?.sites
      ? structure?.sites
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
            scale: force_scale,
            color: colors.element?.[majority_element] || force_color,
          }
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
      : []
  })

  let instanced_atom_groups = $derived(
    Object.values(
      atom_data
        .filter((atom) => !atom.has_partial_occupancy)
        .reduce(
          (groups, atom) => {
            const { element, radius, color } = atom
            const key = `${element}-${format_num(radius, `.3~`)}`
            const bucket = groups[key] ||
              (groups[key] = { element, radius, color, atoms: [] })
            bucket.atoms.push(atom)
            return groups
          },
          {} as Record<
            string,
            {
              element: string
              radius: number
              color: string
              is_image_atom: boolean
              atoms: typeof atom_data
            }
          >,
        ),
    ),
  )

  // Pre-calculate unique site atoms for labeling
  let unique_instanced_atoms = $derived(
    Object.values(
      instanced_atom_groups
        .flatMap((group) => group.atoms)
        .reduce((acc, atom) => {
          acc[atom.site_idx] = atom
          return acc
        }, {} as Record<number, (typeof atom_data)[number]>),
    ),
  )

  let gizmo_props = $derived.by(() => {
    const axis_options = Object.fromEntries(
      [...axis_colors, ...neg_axis_colors].map(([axis, color, hover_color]) => [
        axis,
        {
          color,
          labelColor: `#111`,
          opacity: axis.startsWith(`n`) ? 0.9 : 0.8,
          hover: {
            color: hover_color,
            labelColor: `#222222`,
            opacity: axis.startsWith(`n`) ? 1 : 0.9,
          },
        },
      ]),
    )
    return {
      background: { enabled: false },
      className: `responsive-gizmo`,
      ...axis_options,
      ...(typeof gizmo === `boolean` ? {} : gizmo),
      offset: { left: 5, bottom: 5 },
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

{#snippet site_label_snippet(position: Vec3, site_idx: number)}
  {@const site = structure!.sites[site_idx]}
  {@const pos = math.add(position, site_label_offset)}
  <Extras.HTML center position={pos}>
    {#if atom_label}
      {@render atom_label(site, site_idx)}
    {:else}
      <span
        class="atom-label"
        style:font-size="{site_label_size * 0.85}em"
        style:background={site_label_bg_color}
        style:padding="{site_label_padding}px"
        style:color={site_label_color}
      >
        {#if show_site_labels && show_site_indices}
          {#if site.species.length === 1}
            {site.species[0].element}-{site_idx + 1}
          {:else}
            {@html site.species.map((spec) =>
        `${spec.element}<sub>${
          format_num(spec.occu, `.3~`).replace(`0.`, `.`)
        }</sub>`
      ).join(``)}-{
              site_idx + 1
            }
          {/if}
        {:else if show_site_labels}
          {#if site.species.length === 1}
            {site.species[0].element}
          {:else}
            {@html site.species.map((spec) =>
        `${spec.element}<sub>${
          format_num(spec.occu, `.3~`).replace(`0.`, `.`)
        }</sub>`
      ).join(``)}
          {/if}
        {:else if show_site_indices}
          {site_idx + 1}
        {/if}
      </span>
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

<!-- Apply manual rotation around center: translate to origin, rotate, translate back -->
<T.Group position={rotation_target}>
  <T.Group {rotation}>
    <T.Group position={math.scale(rotation_target, -1)}>
      {#if show_atoms}
        <!-- Instanced rendering for full occupancy atoms -->
        {#each instanced_atom_groups as
          group
          (group.element + group.radius + group.is_image_atom)
        }
          <Extras.InstancedMesh
            key="{group.element}-{group.radius}-{group.atoms.length}-{group.is_image_atom}"
            range={group.atoms.length}
          >
            <T.SphereGeometry args={[0.5, sphere_segments, sphere_segments]} />
            <T.MeshStandardMaterial {...get_material_props(group)} />
            {#each group.atoms as atom (atom.site_idx)}
              <Extras.Instance
                position={atom.position}
                scale={atom.radius}
                {...get_atom_handlers(atom)}
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
            {...get_atom_handlers(atom)}
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
              <T.MeshStandardMaterial {...get_material_props(atom)} />
            </T.Mesh>

            {#if atom.has_partial_occupancy}
              <T.Mesh rotation={[0, atom.start_phi, 0]}>
                <T.CircleGeometry args={[0.5, sphere_segments]} />
                <T.MeshStandardMaterial {...get_material_props(atom)} side={2} />
              </T.Mesh>
              <T.Mesh rotation={[0, atom.end_phi, 0]}>
                <T.CircleGeometry args={[0.5, sphere_segments]} />
                <T.MeshStandardMaterial {...get_material_props(atom)} side={2} />
              </T.Mesh>
            {/if}
          </T.Group>

          <!-- Render label only for the first species of this site to avoid duplicates -->
          {#if (show_site_labels || show_site_indices) &&
          atom.element === structure!.sites[atom.site_idx].species[0].element}
            {@render site_label_snippet(atom.position, atom.site_idx)}
          {/if}
        {/each}

        <!-- Site labels/indices for instanced atoms -->
        {#if show_site_labels || show_site_indices}
          {#each unique_instanced_atoms as atom (atom.site_idx)}
            {@render site_label_snippet(atom.position, atom.site_idx)}
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
            onbondhover={(data: BondPair | null) => hovered_bond_data = data}
            ontooltipchange={(type: `atom` | `bond` | null) => active_tooltip = type}
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
            opacity: pulse_opacity,
            color: selection_highlight_color,
          }))),
          ...((active_sites ?? []).map((idx) => ({
            kind: `active`,
            site: structure?.sites?.[idx] ?? null,
            site_idx: idx,
            opacity: pulse_opacity, // Let it pulse freely
            color: active_highlight_color,
          }))),
        ] as
        entry
        (`${entry.kind}-${entry.site_idx}`)
      }
        {@const { site, opacity, color, kind, site_idx } = entry}
        {#if site}
          {@const xyz = site.xyz}
          {@const highlight_radius = site_idx !== null
          ? radius_by_site_idx.get(site_idx) ?? atom_radius
          : atom_radius}
          <T.Mesh
            position={xyz}
            scale={1.2 * highlight_radius}
            onclick={(event: MouseEvent) => {
              if (site_idx !== null && Number.isInteger(site_idx)) {
                toggle_selection(site_idx, event)
              }
            }}
          >
            <T.SphereGeometry args={[0.5, 22, 22]} />
            <T.MeshStandardMaterial
              {color}
              transparent
              {opacity}
              emissive={color}
              emissiveIntensity={kind === `selected` || kind === `active` ? 0.7 : 0.2}
              depthTest={false}
              depthWrite={false}
            />
          </T.Mesh>
        {/if}
      {/each}

      <!-- selection order labels (1, 2, 3, ...) for measured sites -->
      {#if structure?.sites && (measured_sites?.length ?? 0) > 0 &&
          measure_mode !== `edit`}
        {#each measured_sites as site_index, loop_idx (site_index)}
          {@const site = structure.sites[site_index]}
          {#if site}
            <!-- shift selected site labels down to avoid overlapping regular site labels-->
            {@const selection_offset = math.add(site_label_offset, [0, -0.5, 0])}
            {@const pos = math.add(site.xyz, selection_offset) as Vec3}
            <Extras.HTML center position={pos}>
              <span class="selection-label">{loop_idx + 1}</span>
            </Extras.HTML>
          {/if}
        {/each}
      {/if}

      <!-- hovered site tooltip -->
      {#if hovered_site && !camera_is_moving && active_tooltip === `atom`}
        {@const abc = hovered_site.abc.map((x) => format_num(x, float_fmt)).join(`, `)}
        {@const xyz = hovered_site.xyz.map((x) => format_num(x, float_fmt)).join(`, `)}
        <CanvasTooltip position={hovered_site.xyz}>
          <!-- Element symbols with occupancies for disordered sites -->
          <div class="elements">
            {#each hovered_site.species ?? [] as
              { element, occu, oxidation_state: oxi_state },
              idx
              ([element, occu, oxi_state])
            }
              {@const oxi_str = (oxi_state != null && oxi_state !== 0)
              ? `<sup>${Math.abs(oxi_state)}${
                oxi_state > 0 ? `+` : `−`
              }</sup>`
              : ``}
              {@const element_name = element_data.find((elem) =>
              elem.symbol === element
            )?.name ??
              ``}
              {#if idx > 0}&thinsp;{/if}
              {#if occu !== 1}<span class="occupancy">{
                  format_num(occu, `.3~f`)
                }</span>{/if}
              <strong>{element}{@html oxi_str}</strong>
              {#if element_name}<span class="elem-name">{element_name}</span>{/if}
            {/each}
          </div>
          <div class="coordinates fractional">abc: ({abc})</div>
          <div class="coordinates cartesian">xyz: ({xyz}) Å</div>
        </CanvasTooltip>
      {/if}

      <!-- Live coordinate display during drag -->
      {#if drag_coordinates && is_transforming}
        {@const xyz_str = drag_coordinates.xyz.map((x) => format_num(x, float_fmt)).join(
          `, `,
        )}
        {@const abc_str = drag_coordinates.abc?.map((x) =>
          format_num(x, float_fmt)
        ).join(`, `) || `N/A`}
        {@const pos = math.add(drag_coordinates.xyz, [0, 1, 0]) as Vec3}
        <Extras.HTML center position={pos}>
          <div class="drag-coordinates">
            <div class="coord-line">XYZ: {xyz_str}</div>
            {#if drag_coordinates.abc}
              <div class="coord-line">ABC: {abc_str}</div>
            {/if}
            <div class="coord-hint">
              {
                selected_sites.length > 1
                ? `Moving ${selected_sites.length} atoms`
                : `Moving atom`
              }
            </div>
          </div>
        </Extras.HTML>
      {/if}

      {#if lattice}
        <Lattice matrix={lattice.matrix} {...lattice_props} />
      {/if}

      <!-- Transform controls for editing atoms in edit mode -->
      {#if measure_mode === `edit` && selected_sites.length > 0}
        {@const selected_atoms = selected_sites.map((idx) => structure?.sites?.[idx])
          .filter(Boolean)}
        {#if selected_atoms.length > 0}
          {@const centroid = selected_atoms.length === 1 ? selected_atoms[0]!.xyz : [
          selected_atoms.reduce((sum, atom) => sum + (atom?.xyz[0] || 0), 0) /
          selected_atoms.length,
          selected_atoms.reduce((sum, atom) => sum + (atom?.xyz[1] || 0), 0) /
          selected_atoms.length,
          selected_atoms.reduce((sum, atom) => sum + (atom?.xyz[2] || 0), 0) /
          selected_atoms.length,
        ] as Vec3}

          <!-- Invisible target object for transform controls -->
          <T.Mesh
            position={centroid}
            bind:ref={transform_object}
            onpointerenter={() => {}}
          >
            <T.SphereGeometry args={[0.01, 4, 4]} />
            <T.MeshBasicMaterial transparent opacity={0} />
          </T.Mesh>

          <!-- Transform controls that manipulate the target object -->
          <TransformControls
            object={transform_object}
            translationSnap={0.1}
            rotationSnap={Math.PI / 8}
            scaleSnap={0.1}
            showX={true}
            showY={true}
            showZ={true}
            enabled={true}
            size={1.2}
            space="world"
            onchange={() => {
              if (transform_object?.position && selected_atoms.length > 0) {
                const { x, y, z } = transform_object.position
                const new_centroid = [x, y, z] as Vec3
                const offset = [
                  new_centroid[0] - centroid[0],
                  new_centroid[1] - centroid[1],
                  new_centroid[2] - centroid[2],
                ] as Vec3

                // Prepare batch updates for all selected atoms
                const updates = selected_sites
                  .map((site_idx) => {
                    const original_pos = structure?.sites?.[site_idx]?.xyz
                    if (!original_pos) return null
                    return {
                      site_idx,
                      new_position: [
                        original_pos[0] + offset[0],
                        original_pos[1] + offset[1],
                        original_pos[2] + offset[2],
                      ] as Vec3,
                    }
                  })
                  .filter(Boolean) as Array<{ site_idx: number; new_position: Vec3 }>

                // Update drag coordinates for display
                if (lattice) {
                  try {
                    const lattice_transposed = math.transpose_3x3_matrix(
                      lattice.matrix,
                    )
                    const lattice_inv = math.matrix_inverse_3x3(lattice_transposed)
                    const raw_abc = math.mat3x3_vec3_multiply(
                      lattice_inv,
                      new_centroid,
                    )
                    const abc = raw_abc.map((coord) =>
                      coord - Math.floor(coord)
                    ) as Vec3
                    drag_coordinates = { xyz: new_centroid, abc }
                  } catch {
                    drag_coordinates = { xyz: new_centroid }
                  }
                } else {
                  drag_coordinates = { xyz: new_centroid }
                }

                // Save history only on first change of this drag operation
                const should_save_history = !has_saved_history_for_drag
                if (should_save_history) {
                  has_saved_history_for_drag = true
                }

                // Apply batch update
                if (updates.length === 1) {
                  update_atom_position(
                    updates[0].site_idx,
                    updates[0].new_position,
                  )
                } else if (updates.length > 1) {
                  update_multiple_atoms(updates)
                }
              }
            }}
            ondragstart={() => {
              is_transforming = true
              has_saved_history_for_drag = false
              if (orbit_controls) orbit_controls.enabled = false

              // Notify parent that a continuous operation is starting
              on_operation_start?.()

              // Initialize drag coordinates
              if (transform_object?.position) {
                const { x, y, z } = transform_object.position
                const xyz = [x, y, z] as Vec3
                let abc: Vec3 | undefined
                if (lattice) {
                  try {
                    const lattice_transposed = math.transpose_3x3_matrix(
                      lattice.matrix,
                    )
                    const lattice_inv = math.matrix_inverse_3x3(lattice_transposed)
                    const raw_abc = math.mat3x3_vec3_multiply(lattice_inv, xyz)
                    abc = raw_abc.map((coord) => coord - Math.floor(coord)) as Vec3
                  } catch {
                    // Ignore coordinate conversion errors during drag
                  }
                }
                drag_coordinates = { xyz, abc }
              }
            }}
            ondragend={() => {
              is_transforming = false
              drag_coordinates = null
              if (orbit_controls) orbit_controls.enabled = true

              // Notify parent that the continuous operation has ended
              on_operation_end?.()
            }}
          />
        {/if}
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
                {@const [v1, v2] = smart_displacement_vectors(
          center.xyz,
          site_a.xyz,
          site_b.xyz,
          lattice?.matrix,
          center.abc,
          site_a.abc,
          site_b.abc,
        )}
                {@const n1 = Math.hypot(v1[0], v1[1], v1[2])}
                {@const n2 = Math.hypot(v2[0], v2[1], v2[2])}
                {@const angle_deg = angle_between_vectors(v1, v2, `degrees`)}
                {#if n1 > math.EPS && n2 > math.EPS}
                  <!-- draw rays from center to the two sites -->
                  <Bond
                    from={center.xyz}
                    to={site_a.xyz}
                    thickness={0.05}
                    color="#bbbbbb"
                  />
                  <Bond
                    from={center.xyz}
                    to={site_b.xyz}
                    thickness={0.05}
                    color="#bbbbbb"
                  />
                  {@const bisector = [
          v1[0] / n1 + v2[0] / n2,
          v1[1] / n1 + v2[1] / n2,
          v1[2] / n1 + v2[2] / n2,
        ] as Vec3}
                  {@const bis_norm =
          Math.sqrt(bisector[0] ** 2 + bisector[1] ** 2 + bisector[2] ** 2) ||
          1}
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
    </T.Group>
  </T.Group>
</T.Group>

<style>
  :global(.structure .responsive-gizmo) {
    width: clamp(70px, 18cqmin, 100px) !important;
    height: clamp(70px, 18cqmin, 100px) !important;
  }
  .atom-label {
    background: var(--struct-atom-label-bg, rgba(0, 0, 0, 0.1));
    border-radius: var(--struct-atom-label-border-radius, 3pt);
    padding: var(--struct-atom-label-padding, 0 3px);
    white-space: nowrap;
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
    font-size: var(--canvas-tooltip-font-size, clamp(8pt, 2cqmin, 18pt));
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
  .drag-coordinates {
    background: rgba(0, 0, 0, 0.8);
    border-radius: 6px;
    padding: 8px 12px;
    color: white;
    font-family: var(--font-mono, monospace);
    font-size: 0.85em;
    line-height: 1.3;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.2);
  }
  .coord-line {
    margin: 2px 0;
  }
  .coord-hint {
    margin-top: 4px;
    font-size: 0.75em;
    opacity: 0.8;
    font-style: italic;
  }
</style>
