<script lang="ts">
  import type { AnyStructure, BondPair, ElementSymbol, Site, Vec3 } from '$lib'
  import { atomic_radii, axis_colors, element_data, neg_axis_colors } from '$lib'
  import { format_num } from '$lib/labels'
  import * as math from '$lib/math'
  import { type CameraProjection, DEFAULTS, type ShowBonds } from '$lib/settings'
  import { colors } from '$lib/state.svelte'
  import { Cylinder, get_center_of_mass, Lattice, Vector } from '$lib/structure'
  import {
    angle_between_vectors,
    displacement_pbc,
    distance_pbc,
    MAX_SELECTED_SITES,
  } from '$lib/structure/measure'
  import { T, useThrelte } from '@threlte/core'
  import * as extras from '@threlte/extras'
  import type { ComponentProps } from 'svelte'
  import { type Snippet, untrack } from 'svelte'
  import { SvelteMap } from 'svelte/reactivity'
  import type { Camera, Scene } from 'three'
  import Bond from './Bond.svelte'
  import { BONDING_STRATEGIES, type BondingStrategy } from './bonding'
  import { CanvasTooltip } from './index'

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
    scene = $bindable(undefined),
    camera = $bindable(undefined),
    hidden_elements = $bindable(new Set()),
  }: {
    structure?: AnyStructure
    atom_radius?: number // scale factor for atomic radii
    same_size_atoms?: boolean // whether to use the same radius for all atoms. if not, the radius will be
    // determined by the atomic radius of the element
    camera_position?: [x: number, y: number, z: number] // initial camera position from which to render the scene
    camera_projection?: CameraProjection // camera projection type
    rotation_damping?: number // rotation damping factor (how quickly the rotation comes to rest after mouse release)
    // zoom level of the camera
    max_zoom?: number
    min_zoom?: number
    zoom_speed?: number // zoom speed. set to 0 to disable zooming.
    pan_speed?: number // pan speed. set to 0 to disable panning.
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
    atom_label?: Snippet<[Site, number]>
    site_label_size?: number
    site_label_offset?: Vec3
    site_label_bg_color?: string
    site_label_color?: string
    site_label_padding?: number
    camera_is_moving?: boolean // used to prevent tooltip from showing while camera is moving
    width?: number // Viewer dimensions for responsive zoom
    height?: number
    // measurement props
    measure_mode?: `distance` | `angle`
    selected_sites?: number[]
    measured_sites?: number[]
    selection_highlight_color?: string
    // Support for active highlight group with different color
    active_sites?: number[]
    active_highlight_color?: string
    rotation?: Vec3 // rotation control prop
    // Expose scene and camera for external use (e.g., export pane)
    scene?: Scene
    camera?: Camera
    hidden_elements?: Set<ElementSymbol>
  } = $props()

  const threlte = useThrelte()
  $effect(() => {
    scene = threlte.scene
    camera = threlte.camera.current
  })

  let bond_pairs: BondPair[] = $state([])
  let active_tooltip = $state<`atom` | `bond` | null>(null)

  function toggle_selection(site_index: number, evt?: Event) {
    evt?.stopPropagation?.()

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

  extras.interactivity()
  $effect.pre(() => {
    hovered_site = structure?.sites?.[hovered_idx ?? -1] ?? null
  })
  let lattice = $derived(
    structure && `lattice` in structure ? structure.lattice : null,
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

  let computed_zoom = $state<number>(initial_zoom)
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

  $effect.pre(() => {
    if (camera_position.every((v) => v === 0) && structure) {
      const distance = Math.max(1, structure_size) * (60 / fov)
      camera_position = [distance, distance * 0.3, distance * 0.8]
    }
  })
  $effect(() => {
    if (structure && show_bonds !== `never`) {
      const should_show_bonds = show_bonds === `always` ||
        (show_bonds === `crystals` && lattice) ||
        (show_bonds === `molecules` && !lattice)

      if (should_show_bonds) {
        bond_pairs = []
        BONDING_STRATEGIES[bonding_strategy](structure, bonding_options)
          .then((bonds) => {
            bond_pairs = bonds
          })
          .catch((err) => {
            console.error(`Bonding calculation failed:`, err)
            bond_pairs = []
          })
      } else {
        bond_pairs = []
      }
    } else {
      bond_pairs = []
    }
  })

  let atom_data = $derived.by(() => {
    if (!show_atoms || !structure?.sites) return []
    return structure.sites.flatMap((site, site_idx) => {
      const radius = same_size_atoms ? atom_radius : site.species.reduce(
        (sum, spec) => sum + spec.occu * (atomic_radii[spec.element] ?? 1),
        0,
      ) * atom_radius

      let start_angle = 0
      return site.species
        .filter(({ element }) => !hidden_elements?.has(element))
        .map(({ element, occu }) => ({
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
  })

  let filtered_bond_pairs = $derived.by(() => {
    if (!structure?.sites || hidden_elements.size === 0) return bond_pairs
    return bond_pairs.filter((bond) => {
      const site_1 = structure.sites[bond.site_idx_1]
      const site_2 = structure.sites[bond.site_idx_2]
      const site_1_visible = site_1?.species.some(({ element }) =>
        !hidden_elements.has(element)
      )
      const site_2_visible = site_2?.species.some(({ element }) =>
        !hidden_elements.has(element)
      )
      return site_1_visible && site_2_visible
    })
  })

  let instanced_bond_groups = $derived.by(() => {
    if (!structure?.sites || filtered_bond_pairs.length === 0) return []

    const group = {
      thickness: bond_thickness,
      ambient_light,
      directional_light,
      instances: [] as Array<{
        matrix: Float32Array
        color_start: string
        color_end: string
      }>,
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

      group.instances.push({
        matrix: new Float32Array(bond_data.transform_matrix),
        color_start,
        color_end,
      })
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

  let force_data = $derived.by(() => {
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
              atoms: (typeof atom_data)[number][]
            }
          >,
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
  </extras.HTML>
{/snippet}

{#if camera_projection === `perspective`}
  <T.PerspectiveCamera makeDefault position={camera_position} {fov}>
    <extras.OrbitControls {...orbit_controls_props}>
      {#if gizmo}<extras.Gizmo {...gizmo_props} />{/if}
    </extras.OrbitControls>
  </T.PerspectiveCamera>
{:else}
  <T.OrthographicCamera
    makeDefault
    position={camera_position}
    zoom={computed_zoom}
    near={-100}
  >
    <extras.OrbitControls {...orbit_controls_props}>
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
        {#each instanced_atom_groups as group (group.element + group.radius)}
          <extras.InstancedMesh
            key="{group.element}-{group.radius}-{group.atoms.length}"
            range={group.atoms.length}
          >
            <T.SphereGeometry args={[0.5, sphere_segments, sphere_segments]} />
            <T.MeshStandardMaterial color={group.color} />
            {#each group.atoms as atom (atom.site_idx)}
              <extras.Instance
                position={atom.position}
                scale={atom.radius}
                onpointerenter={() => {
                  hovered_idx = atom.site_idx
                  active_tooltip = `atom`
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
          </extras.InstancedMesh>
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

      <!-- Instanced bond rendering with gradient colors -->
      {#if instanced_bond_groups.length > 0}
        {#each instanced_bond_groups as group (group.thickness + group.instances.length)}
          {@render bond_instanced_mesh_snippet(group)}
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
      {#if structure?.sites && (measured_sites?.length ?? 0) > 0}
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
              {@const pbc = lattice ? distance_pbc(pos_i, pos_j, lattice.matrix) : direct}
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
                {@const v1 = displacement_pbc(center.xyz, site_a.xyz, lattice?.matrix)}
                {@const v2 = displacement_pbc(center.xyz, site_b.xyz, lattice?.matrix)}
                {@const n1 = Math.hypot(v1[0], v1[1], v1[2])}
                {@const n2 = Math.hypot(v2[0], v2[1], v2[2])}
                {@const angle_deg = angle_between_vectors(v1, v2, `degrees`)}
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
    background: var(--measure-label-bg, var(--surface-bg));
    color: var(--measure-label-color, var(--text-color));
    border-radius: 4px;
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
