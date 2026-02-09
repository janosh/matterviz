<script lang="ts">
  import type { D3InterpolateName } from '$lib/colors'
  import { AXIS_COLORS, NEG_AXIS_COLORS } from '$lib/colors'
  import type { ElementSymbol } from '$lib/element'
  import { element_data } from '$lib/element'
  import Isosurface from '$lib/isosurface/Isosurface.svelte'
  import type { IsosurfaceSettings, VolumetricData } from '$lib/isosurface/types'
  import { DEFAULT_ISOSURFACE_SETTINGS } from '$lib/isosurface/types'
  import { format_num } from '$lib/labels'
  import type { Vec3 } from '$lib/math'
  import * as math from '$lib/math'
  import { type CameraProjection, DEFAULTS, type ShowBonds } from '$lib/settings'
  import { colors } from '$lib/state.svelte'
  import type { AnyStructure, BondPair, Site } from '$lib/structure'
  import {
    Arrow,
    atomic_radii,
    Cylinder,
    get_center_of_mass,
    Lattice,
  } from '$lib/structure'
  import type { AtomColorConfig } from '$lib/structure/atom-properties'
  import {
    get_orig_site_idx,
    get_property_colors,
  } from '$lib/structure/atom-properties'
  import * as measure from '$lib/structure/measure'
  import type { MeasureMode } from '$lib/structure/Structure.svelte'
  import type { MoyoDataset } from '@spglib/moyo-wasm'
  import { T, useThrelte } from '@threlte/core'
  import * as extras from '@threlte/extras'
  import type { ComponentProps } from 'svelte'
  import { type Snippet, untrack } from 'svelte'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'
  import { type Camera, Color, type Mesh, type Scene } from 'three'
  import Bond from './Bond.svelte'
  import type { BondingStrategy } from './bonding'
  import { BONDING_STRATEGIES, compute_bond_transform } from './bonding'
  import { CanvasTooltip } from './index'

  type InstancedAtomGroup = {
    element: string
    radius: number
    color: string
    is_image_atom: boolean
    atoms: (typeof atom_data)[number][]
  }

  let pulse_time = $state(0)
  let pulse_opacity = $derived(0.15 + 0.25 * Math.sin(pulse_time * 5))
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

  let {
    structure = undefined,
    base_structure = undefined,
    atom_radius = DEFAULTS.structure.atom_radius,
    same_size_atoms = false,
    camera_position = DEFAULTS.structure.camera_position,
    camera_projection = DEFAULTS.structure.camera_projection,
    rotation_damping = DEFAULTS.structure.rotation_damping,
    max_zoom = DEFAULTS.structure.max_zoom,
    min_zoom = DEFAULTS.structure.min_zoom,
    rotate_speed = DEFAULTS.structure.rotate_speed,
    zoom_speed = DEFAULTS.structure.zoom_speed,
    pan_speed = DEFAULTS.structure.pan_speed,
    zoom_to_cursor = DEFAULTS.structure.zoom_to_cursor,
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
    width = 0,
    height = 0,
    measure_mode = `distance`,
    selected_sites = $bindable([]),
    measured_sites = $bindable([]),
    added_bonds = $bindable([]),
    removed_bonds = $bindable([]),
    selection_highlight_color = `#6cf0ff`,
    // Active highlight group with different color
    active_sites = $bindable([]),
    active_highlight_color = `var(--struct-active-highlight-color, #2563eb)`,
    rotation = DEFAULTS.structure.rotation,
    scene = $bindable(),
    camera = $bindable(),
    orbit_controls = $bindable(),
    rotation_target_ref = $bindable(),
    initial_computed_zoom = $bindable(),
    hidden_elements = $bindable(new SvelteSet()),
    hidden_prop_vals = $bindable(new SvelteSet<number | string>()),
    element_radius_overrides = $bindable<Partial<Record<ElementSymbol, number>>>({}),
    site_radius_overrides = $bindable<SvelteMap<number, number>>(new SvelteMap()),
    atom_color_config = {
      mode: DEFAULTS.structure.atom_color_mode,
      scale: DEFAULTS.structure.atom_color_scale as D3InterpolateName,
      scale_type: DEFAULTS.structure.atom_color_scale_type,
    },
    sym_data = null,
    // Edit-atoms mode callbacks
    on_sites_moved,
    on_operation_start,
    on_add_atom,
    add_atom_mode = $bindable(false),
    add_element = $bindable(`C`),
    cursor = $bindable(`default`),
    dragging_atoms = $bindable(false),
    volumetric_data = undefined,
    isosurface_settings = DEFAULT_ISOSURFACE_SETTINGS,
  }: {
    structure?: AnyStructure
    base_structure?: AnyStructure // The original structure without image atoms, used for property color calculation
    atom_radius?: number // scale factor for atomic radii
    same_size_atoms?: boolean // whether to use the same radius for all atoms. if not, the radius will be
    // determined by the atomic radius of the element
    camera_position?: [x: number, y: number, z: number] // initial camera position from which to render the scene
    camera_projection?: CameraProjection // camera projection type
    rotation_damping?: number // rotation damping factor (how quickly the rotation comes to rest after mouse release)
    // zoom level of the camera
    max_zoom?: number
    min_zoom?: number
    rotate_speed?: number // rotation speed. set to 0 to disable rotation.
    zoom_speed?: number // zoom speed. set to 0 to disable zooming.
    pan_speed?: number // pan speed. set to 0 to disable panning.
    zoom_to_cursor?: boolean // zoom toward cursor position instead of scene center
    show_atoms?: boolean
    show_bonds?: ShowBonds
    show_site_labels?: boolean
    show_site_indices?: boolean
    show_force_vectors?: boolean
    force_scale?: number
    force_color?: string
    gizmo?: boolean | ComponentProps<typeof extras.Gizmo>
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
    atom_label?: Snippet<[{ site: Site; site_idx: number }]>
    site_label_size?: number
    site_label_offset?: Vec3
    site_label_bg_color?: string
    site_label_color?: string
    site_label_padding?: number
    camera_is_moving?: boolean // used to prevent tooltip from showing while camera is moving
    width?: number // Viewer dimensions for responsive zoom
    height?: number
    // measurement props
    measure_mode?: MeasureMode
    selected_sites?: number[]
    measured_sites?: number[]
    added_bonds?: [number, number][]
    removed_bonds?: [number, number][]
    selection_highlight_color?: string
    // Support for active highlight group with different color
    active_sites?: number[]
    active_highlight_color?: string
    rotation?: Vec3 // rotation control prop
    // Expose scene and camera for external use (e.g. export pane)
    scene?: Scene
    camera?: Camera
    orbit_controls?: ComponentProps<typeof extras.OrbitControls>[`ref`] // OrbitControls instance
    rotation_target_ref?: Vec3 // Expose rotation target for reset
    initial_computed_zoom?: number // Expose initial zoom for reset
    hidden_elements?: Set<ElementSymbol>
    hidden_prop_vals?: Set<number | string> // Track hidden property values (e.g. Wyckoff positions, coordination numbers)
    element_radius_overrides?: Partial<Record<ElementSymbol, number>> // Per-element absolute radius in Angstroms
    site_radius_overrides?: Map<number, number> | SvelteMap<number, number> // Per-site absolute radius in Angstroms
    atom_color_config?: Partial<AtomColorConfig> // Atom coloring configuration
    sym_data?: MoyoDataset | null // Symmetry data for Wyckoff coloring
    // Edit-atoms mode callbacks and state
    on_sites_moved?: (scene_indices: number[], delta: Vec3) => void
    on_operation_start?: () => void
    on_add_atom?: (xyz: Vec3, element: ElementSymbol) => void
    add_atom_mode?: boolean // whether user is in click-to-place add-atom sub-mode
    add_element?: ElementSymbol // element to add when clicking in add-atom mode
    cursor?: string // cursor style for the 3D canvas
    dragging_atoms?: boolean // true while TransformControls drag is active (skips expensive recalculations)
    volumetric_data?: VolumetricData // Active volumetric data for isosurface rendering
    isosurface_settings?: IsosurfaceSettings // Isosurface rendering settings
  } = $props()

  const threlte = useThrelte()
  $effect(() => {
    scene = threlte.scene
    camera = threlte.camera.current
    if (threlte.renderer) {
      Object.assign(threlte.renderer.domElement, {
        __renderer: threlte.renderer,
      })
    }
  })

  // Expose rotation target for external reset
  $effect(() => {
    rotation_target_ref = rotation_target
  })

  // Track initial computed zoom for reset
  let stored_initial_zoom = $state<number | undefined>(undefined)
  $effect(() => {
    if (stored_initial_zoom === undefined && computed_zoom > 0) {
      stored_initial_zoom = computed_zoom
    }
    initial_computed_zoom = stored_initial_zoom
  })

  let bond_pairs: BondPair[] = $state([])
  let active_tooltip = $state<`atom` | `bond` | null>(null)
  let hovered_bond_key = $state<string | null>(null)

  // Cursor style for the canvas, derived from mode and hover state
  let canvas_cursor = $derived.by(() => {
    if (measure_mode === `edit-atoms` && add_atom_mode) return `crosshair`
    if (hovered_idx != null) {
      if (measure_mode === `edit-atoms`) {
        const site = structure?.sites?.[hovered_idx]
        if (site?.properties?.orig_site_idx != null) return `not-allowed`
        return `pointer`
      }
      return `pointer`
    }
    return `default`
  })

  // Desaturate a color by blending it toward gray (for ghosting image atoms in edit mode)
  const gray = new Color(0x999999)
  function desaturate(hex: string | undefined, amount = 0.4): string {
    return `#${new Color(hex ?? 0x999999).lerp(gray, amount).getHexString()}`
  }

  // === Edit-atoms mode state ===
  let transform_object = $state<Mesh | undefined>(undefined)
  // Plain variable — only used imperatively in TransformControls drag handlers
  let drag_start_centroid: Vec3 | null = null
  // Frozen centroid set on drag start. While non-null, the TransformControls mesh
  // position stays at this fixed value so Svelte's reactive centroid updates (from
  // PBC wrapping) don't fight TransformControls. Cleared on mouseUp so the mesh
  // snaps to the new wrapped centroid.
  let frozen_centroid = $state<Vec3 | null>(null)

  function get_bond_key(idx1: number, idx2: number): string {
    return idx1 < idx2 ? `${idx1}-${idx2}` : `${idx2}-${idx1}`
  }

  // Toggle a bond between two atoms: cycles through add → remove → restore states
  function toggle_bond(site_1: number, site_2: number) {
    const idx_i = Math.min(site_1, site_2)
    const idx_j = Math.max(site_1, site_2)
    // added/removed pairs are stored sorted, so direct comparison works
    const match = ([a, b]: [number, number]) => a === idx_i && b === idx_j

    const added_idx = added_bonds.findIndex(match)
    if (added_idx >= 0) {
      added_bonds = added_bonds.toSpliced(added_idx, 1)
      return
    }

    const removed_idx = removed_bonds.findIndex(match)
    if (removed_idx >= 0) {
      removed_bonds = removed_bonds.toSpliced(removed_idx, 1)
      return
    }

    // bond_pairs may not be sorted, so use get_bond_key for comparison
    const key = `${idx_i}-${idx_j}`
    if (
      bond_pairs.some((bond) =>
        get_bond_key(bond.site_idx_1, bond.site_idx_2) === key
      )
    ) {
      removed_bonds = [...removed_bonds, [idx_i, idx_j]]
    } else {
      added_bonds = [...added_bonds, [idx_i, idx_j]]
    }
  }

  // Deduplicate clicks: when a highlight sphere and the underlying atom both
  // intercept the same native click, only the first intersection should fire.
  // All threlte intersection events from one click share the same nativeEvent ref.
  let last_native_event: Event | null = null

  function toggle_selection(site_index: number, evt?: Event) {
    evt?.stopPropagation?.()
    const native = (evt as unknown as { nativeEvent?: Event })?.nativeEvent
    if (native && native === last_native_event) return
    if (native) last_native_event = native

    if (measure_mode === `edit-bonds`) {
      // In edit-bonds mode, select atoms to add/remove bonds between them
      const new_sites = measured_sites.includes(site_index)
        ? measured_sites.filter((idx) => idx !== site_index)
        : [...measured_sites, site_index]

      measured_sites = new_sites
      selected_sites = new_sites

      // When two atoms are selected, toggle the bond between them
      if (measured_sites.length === 2) {
        toggle_bond(measured_sites[0], measured_sites[1])
        measured_sites = []
        selected_sites = []
      }
      return
    }

    if (measure_mode === `edit-atoms`) {
      // Block image atoms (detected by orig_site_idx property from PBC)
      const site = structure?.sites?.[site_index]
      if (site?.properties?.orig_site_idx != null) return

      const is_selected = selected_sites.includes(site_index)
      const is_shift = evt instanceof MouseEvent && evt.shiftKey

      // In edit-atoms mode, selected_sites and measured_sites always stay in sync
      let new_sites: number[]
      if (is_shift) {
        // Multi-select: toggle this site in/out of selection
        new_sites = is_selected
          ? selected_sites.filter((idx) => idx !== site_index)
          : [...selected_sites, site_index]
      } else {
        // Single-select: replace selection (or deselect if already selected)
        new_sites = is_selected ? [] : [site_index]
      }
      selected_sites = new_sites
      measured_sites = new_sites
      return
    }

    if (
      !measured_sites.includes(site_index) &&
      measured_sites.length >= measure.MAX_SELECTED_SITES
    ) {
      console.warn(
        `Selection size limit reached (${measure.MAX_SELECTED_SITES}). Deselect some sites first.`,
      )
      return
    }

    measured_sites = measured_sites.includes(site_index)
      ? measured_sites.filter((idx) => idx !== site_index)
      : [...measured_sites, site_index]
    selected_sites = selected_sites.includes(site_index)
      ? selected_sites.filter((idx) => idx !== site_index)
      : [...selected_sites, site_index]
  }
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

  $effect(() => {
    cursor = canvas_cursor
  })

  extras.interactivity()
  $effect.pre(() => {
    hovered_site = structure?.sites?.[hovered_idx ?? -1] ?? null
  })
  let lattice = $derived(
    structure && `lattice` in structure ? structure.lattice : null,
  )

  let visual_lattice = $derived(
    base_structure && `lattice` in base_structure ? base_structure.lattice : lattice,
  )

  let rotation_target = $derived(
    lattice
      ? (math.scale(math.add(...lattice.matrix), 0.5) as Vec3)
      : structure
      ? get_center_of_mass(structure)
      : [0, 0, 0] as Vec3,
  )

  let structure_size = $derived(
    lattice ? (lattice.a + lattice.b + lattice.c) / 2 : 10,
  )

  // Compute dynamic camera clipping planes based on structure size
  // This prevents z-fighting and disappearing objects when zooming in close on large supercells
  let camera_near = $derived(Math.max(0.01, structure_size * 0.01))
  let camera_far = $derived(Math.max(1000, structure_size * 100))

  // Using $state because this is mutated in an effect based on viewport/structure size
  let computed_zoom = $state(untrack(() => initial_zoom))
  $effect(() => {
    if (!(width > 0) || !(height > 0)) return
    const structure_max_dim = Math.max(1, untrack(() => structure_size))
    const viewer_min_dim = Math.min(width, height)
    const scale_factor = viewer_min_dim / (structure_max_dim * 50) // 50px per unit
    let new_zoom = initial_zoom * scale_factor
    if (min_zoom && min_zoom > 0) new_zoom = Math.max(min_zoom, new_zoom)
    if (max_zoom && max_zoom > 0) new_zoom = Math.min(max_zoom, new_zoom)
    computed_zoom = new_zoom
  })

  $effect.pre(() => { // Simple initial camera auto-position: proportional to structure size and fov
    if (camera_position.every((v) => v === 0) && structure) {
      const distance = Math.max(1, structure_size) * (60 / fov)
      camera_position = [distance, distance * 0.3, distance * 0.8]
    }
  })
  $effect(() => {
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

  // Compute property-based colors when not using element coloring
  // Use base_structure (original unit cell) for color calculation
  let property_colors = $derived(
    get_property_colors(
      base_structure || structure,
      atom_color_config,
      bonding_strategy,
      sym_data,
    ),
  )

  // Compute weighted average radius for a site based on species occupancies
  // Normalizes by total occupancy so vacancy-containing sites render at full size
  const calc_weighted_radius = (site: Site): number => {
    const total_occu = site.species.reduce((sum, { occu }) => sum + occu, 0)
    const weighted_sum = site.species.reduce((sum, { element, occu }) => {
      const override = element_radius_overrides?.[element as ElementSymbol]
      return sum + occu * (override ?? atomic_radii[element] ?? 1)
    }, 0)
    return total_occu > 0 ? weighted_sum / total_occu : 1
  }

  let atom_data = $derived.by(() => {
    if (!show_atoms || !structure?.sites) return []
    return structure.sites.flatMap((site, site_idx) => {
      const orig_idx = get_orig_site_idx(site, site_idx)

      // Skip sites with hidden property values
      const prop_val = property_colors?.values[orig_idx]
      if (prop_val !== undefined && hidden_prop_vals.has(prop_val)) return []

      // Calculate radius: same_size > site override > element override > default
      // All radii scale uniformly with atom_radius for consistent slider behavior
      const base_radius = same_size_atoms
        ? 1
        : site_radius_overrides?.get(site_idx) ?? calc_weighted_radius(site)
      const radius = base_radius * atom_radius

      // Use property color if available (e.g. coordination number, Wyckoff position)
      // Otherwise, each species gets its own element color (important for disordered sites)
      const site_property_color = property_colors?.colors[orig_idx]

      // Detect image atoms by presence of orig_site_idx property (set by get_pbc_image_sites)
      const is_image_atom = site.properties?.orig_site_idx != null

      let start_angle = 0
      return site.species
        .filter(({ element }) => !hidden_elements.has(element))
        .map(({ element, occu }) => ({
          site_idx,
          element,
          occupancy: occu,
          position: site.xyz,
          radius,
          color: site_property_color ?? colors.element?.[element],
          has_partial_occupancy: occu < 1,
          start_phi: 2 * Math.PI * start_angle,
          end_phi: 2 * Math.PI * (start_angle += occu),
          is_image_atom,
        }))
    })
  })

  let filtered_bond_pairs = $derived.by(() => {
    if (!structure?.sites) return bond_pairs

    const is_site_visible = (site_idx: number) => {
      const site = structure.sites[site_idx]
      const has_visible_element = site?.species.some(({ element }) =>
        !hidden_elements.has(element)
      )
      const orig_idx = get_orig_site_idx(site, site_idx)
      const prop_val = property_colors?.values[orig_idx]
      const prop_visible = prop_val === undefined ||
        !hidden_prop_vals.has(prop_val)
      return has_visible_element && prop_visible
    }

    // Build set of removed bond keys for efficient lookup
    const removed_keys = new Set(
      removed_bonds.map(([idx_i, idx_j]) => get_bond_key(idx_i, idx_j)),
    )

    // Filter calculated bonds: exclude removed and hidden
    const calculated = bond_pairs.filter(({ site_idx_1, site_idx_2 }) => {
      if (removed_keys.has(get_bond_key(site_idx_1, site_idx_2))) return false
      return is_site_visible(site_idx_1) && is_site_visible(site_idx_2)
    })

    // Create BondPair objects for manually added bonds
    const added: BondPair[] = added_bonds
      .map(([idx_i, idx_j]) => {
        if (!is_site_visible(idx_i) || !is_site_visible(idx_j)) return null
        const site1 = structure.sites[idx_i]
        const site2 = structure.sites[idx_j]
        if (!site1 || !site2) return null

        const pos_1 = site1.xyz
        const pos_2 = site2.xyz
        const dist = math.euclidean_dist(pos_1, pos_2)

        return {
          pos_1,
          pos_2,
          site_idx_1: idx_i,
          site_idx_2: idx_j,
          bond_length: dist,
          strength: 1.0,
          transform_matrix: compute_bond_transform(pos_1, pos_2),
        }
      })
      .filter((bond): bond is BondPair => bond !== null)

    return [...calculated, ...added]
  })

  let instanced_bond_groups = $derived.by(() => {
    if (!structure?.sites || filtered_bond_pairs.length === 0) return []

    const group = {
      thickness: bond_thickness,
      ambient_light,
      directional_light,
      instances: [] as {
        matrix: Float32Array
        color_start: string
        color_end: string
      }[],
    }

    for (const bond_data of filtered_bond_pairs) {
      const site_a = structure.sites[bond_data.site_idx_1]
      const site_b = structure.sites[bond_data.site_idx_2]

      const get_majority_color = (site: typeof site_a) => {
        if (!site?.species || site.species.length === 0) return bond_color
        const majority_species = site.species.reduce((max, spec) =>
          spec.occu > max.occu ? spec : max
        )
        return colors.element?.[majority_species.element] || bond_color
      }

      const color_start = get_majority_color(site_a)
      const color_end = get_majority_color(site_b)
      const instance = { matrix: bond_data.transform_matrix, color_start, color_end }
      group.instances.push(instance)
    }

    return group.instances.length > 0 ? [group] : []
  })

  let radius_by_site_idx = $derived.by(() => {
    const map = new SvelteMap<number, number>()
    for (const atom of atom_data) {
      if (!map.has(atom.site_idx)) map.set(atom.site_idx, atom.radius)
    }
    return map
  })

  // Get radius for a site (for highlight fallback when site is hidden/filtered)
  // Checks site_radius_overrides first for consistency with visible atoms
  const get_site_radius = (site: Site, site_idx: number | null): number => {
    const override = site_idx !== null
      ? site_radius_overrides?.get(site_idx)
      : undefined
    const base_radius = same_size_atoms ? 1 : override ?? calc_weighted_radius(site)
    return base_radius * atom_radius
  }

  let force_data = $derived.by(() =>
    show_force_vectors && structure?.sites
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
  )

  let instanced_atom_groups = $derived(
    Object.values(
      atom_data
        .filter((atom) => !atom.has_partial_occupancy)
        .reduce(
          (groups, atom) => {
            const { element, radius, color, is_image_atom } = atom
            // Separate image atoms into their own groups for distinct styling in edit-atoms mode
            const key = `${element}-${format_num(radius, `.3~`)}-${color}-${
              is_image_atom ? `img` : `base`
            }`
            const bucket = groups[key] ||
              (groups[key] = { element, radius, color, is_image_atom, atoms: [] })
            bucket.atoms.push(atom)
            return groups
          },
          {} as Record<string, InstancedAtomGroup>,
        ),
    ),
  )

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
      [...AXIS_COLORS, ...NEG_AXIS_COLORS].map(([axis, color, hover_color]) => [
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
    position: [0, 0, 0],
    enableRotate: rotate_speed > 0,
    rotateSpeed: rotate_speed,
    enableZoom: zoom_speed > 0,
    zoomSpeed: camera_projection === `orthographic` ? zoom_speed * 2 : zoom_speed,
    zoomToCursor: zoom_to_cursor,
    enablePan: pan_speed > 0,
    panSpeed: pan_speed,
    target: rotation_target,
    maxZoom: max_zoom,
    minZoom: min_zoom,
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

  let measure_line_color = $derived.by(() => {
    if (typeof window === `undefined`) return
    const root_styles = getComputedStyle(document.documentElement)
    const text_color = root_styles.getPropertyValue(`--text-color`).trim()
    return text_color || `#808080`
  })
</script>

{#snippet bond_instanced_mesh_snippet(
  group: ComponentProps<typeof Bond>[`group`],
)}
  {#key group.instances.length}
    <Bond {group} />
  {/key}
{/snippet}

{#snippet site_label_snippet(position: Vec3, site_idx: number)}
  {@const site = structure!.sites[site_idx]}
  {@const pos = math.add(position, site_label_offset)}
  <extras.HTML center position={pos}>
    {#if atom_label}
      {@render atom_label({ site, site_idx })}
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
  </extras.HTML>
{/snippet}

{#if camera_projection === `perspective`}
  <T.PerspectiveCamera
    makeDefault
    position={camera_position}
    {fov}
    near={camera_near}
    far={camera_far}
  >
    <extras.OrbitControls bind:ref={orbit_controls} {...orbit_controls_props}>
      {#if gizmo}<extras.Gizmo {...gizmo_props} />{/if}
    </extras.OrbitControls>
  </T.PerspectiveCamera>
{:else}
  <T.OrthographicCamera
    makeDefault
    position={camera_position}
    zoom={computed_zoom}
    near={-100}
    far={camera_far}
  >
    <extras.OrbitControls bind:ref={orbit_controls} {...orbit_controls_props}>
      {#if gizmo}<extras.Gizmo {...gizmo_props} />{/if}
    </extras.OrbitControls>
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
          { element, radius, color, is_image_atom, atoms }
          (`${element}-${radius}-${color}-${is_image_atom ? `img` : `base`}`)
        }
          {@const edit_mode_image = measure_mode === `edit-atoms` && is_image_atom}
          <extras.InstancedMesh
            key="{element}-{format_num(radius, `.3~`)}-{color}-{is_image_atom ? `img` : `base`}-{edit_mode_image}"
            range={atoms.length}
            frustumCulled={false}
          >
            <T.SphereGeometry args={[0.5, sphere_segments, sphere_segments]} />
            <T.MeshStandardMaterial
              color={edit_mode_image ? desaturate(color) : color}
              opacity={edit_mode_image ? 0.5 : 1}
              transparent={edit_mode_image}
            />
            {#each atoms as atom (atom.site_idx)}
              <extras.Instance
                position={atom.position}
                scale={atom.radius}
                onpointerenter={() => {
                  if (edit_mode_image) return
                  hovered_idx = atom.site_idx
                  active_tooltip = `atom`
                }}
                onpointerleave={() => {
                  if (edit_mode_image) return
                  hovered_idx = null
                  active_tooltip = null
                }}
                onclick={(event: MouseEvent) => {
                  if (edit_mode_image) return
                  toggle_selection(atom.site_idx, event)
                }}
              />
            {/each}
          </extras.InstancedMesh>
        {/each}

        <!-- Regular rendering for partial occupancy atoms -->
        {#each atom_data.filter((atom) => atom.has_partial_occupancy) as
          atom
          (atom.site_idx + atom.element + atom.occupancy)
        }
          {@const partial_edit_image = measure_mode === `edit-atoms` && atom.is_image_atom}
          {@const ghost_opacity = partial_edit_image ? 0.5 : 1}
          <T.Group
            position={atom.position}
            scale={atom.radius}
            onpointerenter={() => {
              if (partial_edit_image) return
              hovered_idx = atom.site_idx
              active_tooltip = `atom`
            }}
            onpointerleave={() => {
              if (partial_edit_image) return
              hovered_idx = null
              active_tooltip = null
            }}
            onclick={(event: MouseEvent) => {
              if (partial_edit_image) return
              toggle_selection(atom.site_idx, event)
            }}
          >
            {@const partial_color = partial_edit_image
            ? desaturate(atom.color)
            : atom.color}
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
              <T.MeshStandardMaterial
                color={partial_color}
                opacity={ghost_opacity}
                transparent={partial_edit_image}
              />
            </T.Mesh>

            {#if atom.has_partial_occupancy}
              <T.Mesh rotation={[0, atom.start_phi, 0]}>
                <T.CircleGeometry args={[0.5, sphere_segments]} />
                <T.MeshStandardMaterial
                  color={partial_color}
                  side={2}
                  opacity={ghost_opacity}
                  transparent={partial_edit_image}
                />
              </T.Mesh>
              <T.Mesh rotation={[0, atom.end_phi, 0]}>
                <T.CircleGeometry args={[0.5, sphere_segments]} />
                <T.MeshStandardMaterial
                  color={partial_color}
                  side={2}
                  opacity={ghost_opacity}
                  transparent={partial_edit_image}
                />
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
          <Arrow {...force} />
        {/each}
      {/if}

      <!-- Instanced bond rendering with gradient colors -->
      {#if instanced_bond_groups.length > 0}
        {#each instanced_bond_groups as group (group.thickness + group.instances.length)}
          {@render bond_instanced_mesh_snippet(group)}
        {/each}
      {/if}

      <!-- Clickable bond hit-test cylinders in edit-bonds mode -->
      {#if measure_mode === `edit-bonds` && filtered_bond_pairs.length > 0}
        {#each filtered_bond_pairs as
          bond
          (`bond-hit-${bond.site_idx_1}-${bond.site_idx_2}`)
        }
          {@const bond_key = get_bond_key(bond.site_idx_1, bond.site_idx_2)}
          {@const is_hovered = hovered_bond_key === bond_key}
          <T.Mesh
            matrixAutoUpdate={false}
            oncreate={(ref) => {
              ref.matrix.fromArray(bond.transform_matrix)
              ref.matrixWorldNeedsUpdate = true
            }}
            onclick={(event: MouseEvent) => {
              event.stopPropagation()
              toggle_bond(bond.site_idx_1, bond.site_idx_2)
              measured_sites = []
              selected_sites = []
              hovered_bond_key = null
            }}
            onpointerenter={() => (hovered_bond_key = bond_key)}
            onpointerleave={() => (hovered_bond_key = null)}
          >
            <T.CylinderGeometry args={[bond_thickness * 3, bond_thickness * 3, 1, 6]} />
            <T.MeshBasicMaterial
              transparent
              opacity={is_hovered ? 0.25 : 0}
              color={is_hovered ? `#ff4444` : `white`}
              depthWrite={false}
            />
          </T.Mesh>
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
          ? radius_by_site_idx.get(site_idx) ?? get_site_radius(site, site_idx)
          : get_site_radius(site, site_idx)}
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

      <!-- selection order labels (1, 2, 3, ...) for measured sites (hidden in edit-atoms mode) -->
      {#if structure?.sites && (measured_sites?.length ?? 0) > 0 &&
          measure_mode !== `edit-atoms`}
        {#each measured_sites as site_index, loop_idx (site_index)}
          {@const site = structure.sites[site_index]}
          {#if site}
            <!-- shift selected site labels down to avoid overlapping regular site labels-->
            {@const selection_offset = math.add(site_label_offset, [0, -0.5, 0])}
            {@const pos = math.add(site.xyz, selection_offset) as Vec3}
            <extras.HTML center position={pos}>
              <span class="selection-label">{loop_idx + 1}</span>
            </extras.HTML>
          {/if}
        {/each}
      {/if}

      <!-- hovered site tooltip -->
      {#if hovered_site && !camera_is_moving && active_tooltip === `atom`}
        {@const abc = hovered_site.abc.map((x) => format_num(x, float_fmt)).join(`, `)}
        {@const xyz = hovered_site.xyz.map((x) => format_num(x, float_fmt)).join(`, `)}
        {@const bond_neighbors = (() => {
          if (hovered_idx == null || !structure?.sites) return []
          return filtered_bond_pairs
            .filter((b) =>
              b.site_idx_1 === hovered_idx || b.site_idx_2 === hovered_idx
            )
            .map((b) => {
              const neighbor_idx = b.site_idx_1 === hovered_idx
                ? b.site_idx_2
                : b.site_idx_1
              return structure.sites[neighbor_idx]?.species[0]?.element ?? `?`
            })
        })()}
        {@const bond_summary = (() => {
          if (bond_neighbors.length === 0) return ``
          const counts: Record<string, number> = {}
          for (const elem of bond_neighbors) {
            counts[elem] = (counts[elem] ?? 0) + 1
          }
          const parts = Object.entries(counts)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([elem, count]) => `${elem}: ${count}`)
          return ` (${parts.join(`, `)})`
        })()}
        <CanvasTooltip position={hovered_site.xyz}>
          <!-- Element symbols with occupancies for disordered sites -->
          <div class="elements">
            {#each hovered_site.species ?? [] as
              { element, occu, oxidation_state: oxi_state },
              idx
              (`${element ?? ``}-${occu ?? ``}-${oxi_state ?? ``}-${idx}`)
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
          {#if bond_neighbors.length > 0}
            <div class="coordinates">Bonds: {bond_neighbors.length}{bond_summary}</div>
          {/if}
        </CanvasTooltip>
      {/if}

      {#if visual_lattice}
        <Lattice matrix={visual_lattice.matrix} {...lattice_props} />
      {/if}

      <!-- TransformControls for editing atoms in edit-atoms mode -->
      {#if measure_mode === `edit-atoms` && selected_sites.length > 0 &&
          structure?.sites}
        {@const selected_atoms = selected_sites
          .map((idx) => structure?.sites?.[idx])
          .filter(Boolean) as Site[]}
        {#if selected_atoms.length > 0}
          {@const avg = (dim: number) =>
          selected_atoms.reduce((sum, atom) => sum + atom.xyz[dim], 0) /
          selected_atoms.length}
          {@const centroid = [avg(0), avg(1), avg(2)] as Vec3}
          <!-- Invisible mesh at centroid for TransformControls to manipulate.
               During drag, use frozen_centroid so Svelte doesn't override TransformControls
               with the wrapped centroid (which jumps on PBC boundary crossings). -->
          <T.Mesh
            position={frozen_centroid ?? centroid}
            bind:ref={transform_object}
          >
            <T.SphereGeometry args={[0.01, 4, 4]} />
            <T.MeshBasicMaterial transparent opacity={0} />
          </T.Mesh>
          <extras.TransformControls
            object={transform_object}
            translationSnap={0.1}
            size={1.2}
            space="world"
            onobjectChange={() => {
              if (!transform_object?.position || !drag_start_centroid) return
              const { x: tx, y: ty, z: tz } = transform_object.position
              const delta: Vec3 = [
                tx - drag_start_centroid[0],
                ty - drag_start_centroid[1],
                tz - drag_start_centroid[2],
              ]
              // Update reference point so deltas are incremental, not cumulative.
              // Without this, each frame compounds: sites already moved by previous
              // delta get the full cumulative delta re-applied.
              drag_start_centroid = [tx, ty, tz]
              on_sites_moved?.(selected_sites, delta)
            }}
            onmouseDown={() => {
              dragging_atoms = true
              drag_start_centroid = frozen_centroid = [...centroid] as Vec3
              on_operation_start?.()
            }}
            onmouseUp={() => {
              dragging_atoms = false
              frozen_centroid = null
              drag_start_centroid = null
            }}
          />
        {/if}
      {/if}

      <!-- Invisible plane for click-to-place atom in add-atom mode -->
      <!-- Uses onBeforeRender to orient normal toward camera so raycasts always hit -->
      {#if measure_mode === `edit-atoms` && add_atom_mode}
        {@const center = rotation_target ?? [0, 0, 0]}
        <T.Mesh
          position={center}
          onBeforeRender={(mesh: Mesh) => {
            if (camera) {
              mesh.lookAt(camera.position)
            }
          }}
          onclick={(event: { point: { x: number; y: number; z: number } }) => {
            const { x, y, z } = event.point
            on_add_atom?.([x, y, z] as Vec3, add_element as ElementSymbol)
          }}
        >
          <T.PlaneGeometry
            args={[
              Math.max(200, structure_size * 4),
              Math.max(200, structure_size * 4),
            ]}
          />
          <T.MeshBasicMaterial transparent opacity={0} side={2} depthWrite={false} />
        </T.Mesh>
      {/if}

      <!-- Isosurface rendering from volumetric data (CHGCAR, .cube files) -->
      {#if volumetric_data && isosurface_settings}
        <Isosurface volume={volumetric_data} settings={isosurface_settings} />
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
              <Cylinder
                from={pos_i}
                to={pos_j}
                thickness={0.12}
                color={measure_line_color}
              />
              {@const midpoint = [
          (pos_i[0] + pos_j[0]) / 2,
          (pos_i[1] + pos_j[1]) / 2,
          (pos_i[2] + pos_j[2]) / 2,
        ] as Vec3}
              {@const direct = math.euclidean_dist(pos_i, pos_j)}
              {@const pbc = lattice
          ? measure.distance_pbc(pos_i, pos_j, lattice.matrix)
          : direct}
              {@const differ = lattice ? Math.abs(pbc - direct) > 1e-6 : false}
              <extras.HTML center position={midpoint}>
                <span class="measure-label">
                  {#if differ}
                    PBC: {format_num(pbc, float_fmt)} Å<br /><small>
                      Direct: {format_num(direct, float_fmt)} Å</small>
                  {:else}
                    {format_num(pbc, float_fmt)} Å
                  {/if}
                </span>
              </extras.HTML>
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
                {@const v1 = measure.displacement_pbc(center.xyz, site_a.xyz, lattice?.matrix)}
                {@const v2 = measure.displacement_pbc(center.xyz, site_b.xyz, lattice?.matrix)}
                {@const n1 = Math.hypot(v1[0], v1[1], v1[2])}
                {@const n2 = Math.hypot(v2[0], v2[1], v2[2])}
                {@const angle_deg = measure.angle_between_vectors(v1, v2, `degrees`)}
                {#if n1 > math.EPS && n2 > math.EPS}
                  <!-- draw rays from center to the two sites -->
                  <Cylinder
                    from={center.xyz}
                    to={site_a.xyz}
                    thickness={0.05}
                    color={measure_line_color}
                  />
                  <Cylinder
                    from={center.xyz}
                    to={site_b.xyz}
                    thickness={0.05}
                    color={measure_line_color}
                  />
                  {@const bisector = math.add(math.scale(v1, 1 / n1), math.scale(v2, 1 / n2))}
                  {@const bis_norm = Math.hypot(...bisector) || 1}
                  {@const offset_dir = math.scale(bisector, 1 / bis_norm)}
                  {@const label_pos = math.add(center.xyz, math.scale(offset_dir, 0.6))}
                  <extras.HTML center position={label_pos}>
                    <span class="measure-label">{format_num(angle_deg, float_fmt)}°</span>
                  </extras.HTML>
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
    border-radius: var(--struct-atom-label-border-radius, var(--border-radius, 3pt));
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
    background: var(--measure-label-bg, var(--surface-bg));
    color: var(--measure-label-color, var(--text-color));
    border-radius: var(--border-radius, 3pt);
    padding: 0 5px;
    user-select: none;
    white-space: pre;
    display: grid;
    place-items: center;
    line-height: 1.2;
    font-size: var(--canvas-tooltip-font-size, clamp(8pt, 2cqmin, 18pt));
    box-shadow: var(--measure-label-shadow, 0 1px 6px rgba(0, 0, 0, 0.2));
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
