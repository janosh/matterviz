// MatterViz settings schema - single source of truth for all MatterViz settings
// Used by both main package and VSCode extension

import type { D3InterpolateName } from '$lib/colors'
import { DEFAULT_FPS_RANGE, ELEMENT_COLOR_SCHEME_NAMES, FPS_STEP } from '$lib/constants'
import type { HullFaceColorMode } from '$lib/convex-hull/types'
import type { ElementSymbol } from '$lib/element/types'
import { capitalize, symbol_names } from '$lib/labels'
import type { Vec2, Vec3 } from '$lib/math'
import type { GizmoOptions } from '$lib/scene/gizmo'
import type { LegendVisibilityMode } from '$lib/plot/core/utils/series-visibility'
import { is_plain_record } from '$lib/utils'

// One leaf of the settings schema. `web_only` settings (fullscreen toggles) are skipped
// when the schema is synced into the VS Code extension's contributed configuration. A leaf
// whose `value` is a plain object is a free-form map (JSON-schema `object`); `additionalProperties`
// names its value type (string unless set).
export interface SettingType<T = unknown> {
  value: T
  description: string
  enum?: Readonly<Record<Extract<T, string>, string>>
  minimum?: number
  maximum?: number
  multipleOf?: number
  minItems?: number
  maxItems?: number
  items?: { minimum?: number; maximum?: number; multipleOf?: number }
  additionalProperties?: { type: `string` | `number` | `boolean` | `object` }
  web_only?: true
}

// The option labels of an enum setting, for controls that render their <select> from the schema
export function enum_labels(setting: SettingType): Readonly<Record<string, string>> {
  if (!setting.enum) throw new Error(`Setting "${setting.description}" has no enum`)
  return setting.enum
}

export const SHOW_BONDS_OPTIONS = [`never`, `always`, `crystals`, `molecules`] as const
export type ShowBonds = (typeof SHOW_BONDS_OPTIONS)[number]
// Shared enum labels for never|always|crystals|molecules settings (bonds, polyhedra)
const SHOW_BONDS_ENUM = Object.fromEntries(
  SHOW_BONDS_OPTIONS.map((key) => [key, capitalize(key)]),
) as Readonly<Record<ShowBonds, string>>
const self_labeled_enum = <Value extends string>(
  values: readonly Value[],
): Readonly<Record<Value, Value>> =>
  Object.fromEntries(values.map((value) => [value, value])) as Record<Value, Value>

// Shared enum labels for the tri-state legend settings. 'auto' defers to the shared
// resolve_legend_visibility rule so single-entry plots don't grow a pointless legend.
const LEGEND_VISIBILITY_ENUM: Readonly<Record<LegendVisibilityMode, string>> = {
  auto: `Auto`,
  always: `Always`,
  never: `Never`,
}
const legend_visibility_setting = (plot: string): SettingType<LegendVisibilityMode> => ({
  value: `auto`,
  description: `Legend visibility in ${plot} plots. 'auto' shows one only when the plot renders more than one legend entry`,
  enum: LEGEND_VISIBILITY_ENUM,
})

export type CameraProjection = `perspective` | `orthographic`
const camera_projection_setting = (
  value: CameraProjection,
  description: string,
): SettingType<CameraProjection> => ({
  value,
  description,
  enum: { perspective: `Perspective`, orthographic: `Orthographic` },
})
const opacity_setting = (value: number, description: string): SettingType<number> => ({
  value,
  description,
  minimum: 0,
  maximum: 1,
})
const fullscreen_toggle_setting = (): SettingType<boolean> => ({
  value: true,
  description: `Show fullscreen toggle button (web-only, always false in other contexts)`,
  web_only: true,
})

const VECTOR_COLOR_MODES = [
  `auto`,
  `element`,
  `spin_direction`,
  `magnitude`,
  `uniform`,
] as const
export type VectorColorMode = (typeof VECTOR_COLOR_MODES)[number]

// Per-key configuration for site vector layers (force, magmom, spin, etc.)
export type VectorLayerConfig = {
  visible: boolean
  color: string | null // null = auto from palette
  scale: number | null // null = use global scale only (multiplier of 1.0)
}

export const ATOM_COLOR_MODE_OPTIONS = [
  `element`,
  `coordination`,
  `wyckoff`,
  `selective_dynamics`,
  `property`,
  `custom`,
] as const
export type AtomColorMode = (typeof ATOM_COLOR_MODE_OPTIONS)[number]

type SettingDefinition = Omit<SettingType, `enum`> & {
  enum?: Readonly<Record<string, string>>
}
type SettingsDefinition = {
  [key: string]: SettingDefinition | SettingsDefinition
}
type DefinedSettingValue<Definition> = Definition extends {
  enum: Readonly<Record<infer Value extends string, string>>
}
  ? Value
  : Definition extends { value: infer Value }
    ? Value extends number
      ? number
      : Value extends boolean
        ? boolean
        : Value
    : never
type NormalizeSettings<Definition> = {
  [Key in keyof Definition]: Definition[Key] extends SettingDefinition
    ? SettingType<DefinedSettingValue<Definition[Key]>>
    : NormalizeSettings<Definition[Key]>
}
const define_settings = <Definition extends SettingsDefinition>(definition: Definition) =>
  definition as unknown as NormalizeSettings<Definition>
const typed_setting = <Value>(definition: SettingType<Value>): SettingType<Value> => definition

// Settings shared by the sunburst + treemap sections below so the two charts'
// options can't drift; `node` names the chart's visual unit (arc/cell) and
// `levels` its depth unit (rings/levels) in descriptions.
const hierarchy_chart_settings = (
  node: `arc` | `cell`,
  levels: `rings` | `levels`,
  zoom_desc: string,
) => ({
  value_mode: {
    value: `leaf-sum` as const,
    description: `How node values are interpreted (plotly branchvalues semantics): leaf-sum ignores parent values, total treats every value as authoritative, remainder adds a node's own value on top of its children`,
    enum: { 'leaf-sum': `Leaf sum`, total: `Total`, remainder: `Remainder` },
  },
  max_depth: {
    value: 0,
    description: `Number of ${levels} shown below the current zoom root (0 = all)`,
    minimum: 0,
    maximum: 10,
  },
  min_fraction: {
    value: 0,
    description: `Group sibling ${node}s smaller than this fraction of the current view's total into one 'Other' ${
      node === `arc` ? `slice` : `cell`
    } per parent (0 = off). Zooming into a parent re-measures its children against it, dissolving the group`,
    minimum: 0,
    maximum: 0.2,
  },
  max_children: {
    value: 0,
    description: `Keep at most this many children per parent, largest first, grouping the rest (0 = unlimited). Unlike min_fraction it guarantees a populated ${levels.slice(
      0,
      -1,
    )} however the values are spread`,
    minimum: 0,
    maximum: 20,
    multipleOf: 1,
  },
  show_labels: {
    value: true,
    description: `Show labels on ${node}s large enough to fit them`,
  },
  label_text: {
    value: `label` as const,
    description: `What ${node} labels display (percent is of the root total, parent-percent of the parent node)`,
    enum: {
      label: `Label`,
      value: `Value`,
      percent: `Percent`,
      'label+value': `Label + value`,
      'label+percent': `Label + percent`,
      'label+parent-percent': `Label + % of parent`,
    },
  },
  zoom_on_click: { value: true, description: zoom_desc },
  show_breadcrumbs: {
    value: true,
    description: `Show a clickable ${
      node === `arc` ? `trail` : `pathbar`
    } of ancestors when zoomed into a subtree`,
  },
})

// Settings shared by the binary/ternary/quaternary convex hull sections below so
// the three systems' options can't drift; only camera/threshold values differ.
const convex_hull_settings = (
  system: `binary` | `ternary` | `quaternary`,
  values: {
    camera_zoom: number
    camera_zoom_max: number
    max_hull_dist_show_phases: number
  },
) => {
  const dim = { binary: `2D`, ternary: `3D`, quaternary: `4D` }[system]
  const hull = `${dim} convex hull`
  return {
    camera_zoom: {
      value: values.camera_zoom,
      description: `Initial camera zoom for ${system} (${dim}) convex hull`,
      minimum: 0.1,
      maximum: values.camera_zoom_max,
    },
    color_mode: {
      value: `energy` as const,
      description: `Color mode for ${hull} points`,
      enum: { stability: `Stability`, energy: `Energy` },
    },
    color_scale: {
      value: `interpolateViridis`,
      description: `D3 interpolate color scale for ${hull} energy mode`,
    },
    show_stable: { value: true, description: `Show stable phases in ${hull}` },
    show_unstable: { value: true, description: `Show unstable phases in ${hull}` },
    show_stable_labels: {
      value: true,
      description: `Show labels for stable phases in ${hull}`,
    },
    show_unstable_labels: {
      value: false,
      description: `Show labels for unstable phases in ${hull}`,
    },
    max_hull_dist_show_phases: {
      value: values.max_hull_dist_show_phases,
      description: `Max eV/atom above hull for showing unstable entries in ${hull}`,
      minimum: 0,
      maximum: 2,
    },
    max_hull_dist_show_labels: {
      value: 0.1,
      description: `Max eV/atom above hull for labeling unstable entries in ${hull}`,
      minimum: 0,
      maximum: 2,
    },
    fullscreen: { value: false, description: `Start in fullscreen for ${hull}` },
    info_pane_open: { value: false, description: `Info pane open by default for ${hull}` },
    legend_pane_open: {
      value: false,
      description: `Legend pane open by default for ${hull}`,
    },
  }
}

// Hull-face settings shared by the 3D-capable hulls (ternary + quaternary)
const hull_face_settings = (
  dim: `3D` | `4D`,
  values: { opacity: number; color_mode: HullFaceColorMode },
) => ({
  show_hull_faces: { value: true, description: `Show hull faces in ${dim} convex hull` },
  hull_face_color: {
    value: `#4caf50`,
    description: `Color for hull faces in ${dim} convex hull`,
  },
  hull_face_opacity: opacity_setting(
    values.opacity,
    `Opacity for hull faces in ${dim} convex hull (0-1)`,
  ),
  hull_face_color_mode: {
    value: values.color_mode,
    description: `Coloring mode for hull faces: uniform (single color), formation_energy (by E_form), dominant_element (by element), or facet_index (categorical)`,
    enum: {
      uniform: `Uniform`,
      formation_energy: `Formation energy`,
      dominant_element: `Dominant element`,
      facet_index: `Facet index`,
    },
  },
})

// Complete settings configuration with values, descriptions, and constraints
export const SETTINGS_CONFIG = define_settings({
  // General display settings
  color_scheme: typed_setting<string>({
    value: `Vesta`,
    description: `Color scheme for atoms and bonds`,
    enum: self_labeled_enum(ELEMENT_COLOR_SCHEME_NAMES),
  }),
  background_color: {
    value: `#000000`,
    description: `Background color of the 3D viewport`,
  },
  // 0.1, not 0: embedded viewers spread DEFAULTS, and 0 renders their background transparent
  background_opacity: opacity_setting(
    0.1,
    `Opacity of the background (0.0 = transparent, 1.0 = opaque)`,
  ),

  // Symmetry Analysis
  symmetry: {
    symprec: {
      value: 1e-4,
      description: `Symmetry precision tolerance for spacegroup detection`,
      minimum: 1e-8,
      maximum: 1,
    },
    algo: {
      value: `Moyo` as const,
      description: `Algorithm for symmetry analysis`,
      enum: { Moyo: `Moyo`, Spglib: `Spglib` },
    },
  },

  // Structure viewer settings
  structure: {
    // Atoms & Bonds
    atom_radius: {
      value: 0.7,
      description: `Radius multiplier for atoms (0.7 = standard atomic radii)`,
      minimum: 0.1,
      maximum: 3.0,
    },
    same_size_atoms: {
      value: false,
      description: `Render all atoms with the same size regardless of element`,
    },
    show_atoms: { value: true, description: `Display atoms in the structure` },
    show_image_atoms: {
      value: true,
      description: `Show atoms on the edge of the cell that are not part of the primitive basis`,
    },
    sphere_segments: {
      value: 20,
      description: `Number of segments for sphere rendering (higher = smoother)`,
      minimum: 8,
      maximum: 64,
    },
    bond_thickness: {
      value: 0.07,
      description: `Thickness of bonds relative to atom radius`,
      minimum: 0.01,
      maximum: 0.5,
    },
    auto_bond_order: {
      value: false,
      description: `Automatically perceive double/triple/aromatic bonds from geometry (main-group/organic; metals fall back to single)`,
    },
    aromatic_display: {
      value: `aromatic`,
      description: `How to render perceived aromatic rings`,
      enum: { aromatic: `Aromatic (1.5)`, kekule: `Kekulé (alternating)` },
    },
    show_bonds: {
      value: `always`,
      description: `When to display bonds between atoms`,
      enum: SHOW_BONDS_ENUM,
    },
    bond_color: { value: `#666666`, description: `Color for bonds (hex color code)` },
    bonding_strategy: {
      value: `electroneg_ratio`,
      description: `Method for determining bonds between atoms`,
      enum: {
        electroneg_ratio: `Electronegativity Ratio`,
        explicit_only: `Explicit Bonds Only`,
      },
    },
    show_polyhedra: {
      value: `crystals`,
      description: `When to render coordination polyhedra around cation-like centers`,
      enum: SHOW_BONDS_ENUM,
    },
    polyhedra_opacity: opacity_setting(0.25, `Opacity of coordination polyhedra faces`),
    polyhedra_show_edges: {
      value: true,
      description: `Draw outlines along coordination polyhedra edges`,
    },
    polyhedra_edge_color: {
      value: `#222222`,
      description: `Color of coordination polyhedra edge lines`,
    },
    polyhedra_color_mode: {
      value: `vertex`,
      description: `Color polyhedra by the atoms at their corners, the center atom, or a single custom color`,
      enum: { vertex: `Vertex Atoms`, center: `Center Atom`, uniform: `Custom Color` },
    },
    polyhedra_color: {
      value: `#4a90d9`,
      description: `Custom polyhedra color (used when color mode is Custom Color)`,
    },
    polyhedra_hide_center_atoms: {
      value: false,
      description: `Hide the central atom of each rendered polyhedron`,
    },
    polyhedra_min_neighbors: {
      value: 4,
      description: `Minimum number of bonded neighbors (coordination number) to form a polyhedron`,
      minimum: 4, // hulls of <4 points are degenerate and render nothing
      maximum: 12,
    },
    polyhedra_max_neighbors: {
      value: 8,
      description: `Maximum number of bonded neighbors for a polyhedron (skips e.g. CN-12 cuboctahedra around large A-site cations)`,
      minimum: 4,
      maximum: 16,
    },
    polyhedra_excluded_elements: {
      value: [] as readonly string[],
      description: `Elements excluded from acting as polyhedra centers`,
    },
    polyhedra_included_elements: {
      value: [] as readonly string[],
      description: `Elements always allowed as polyhedra centers (overrides automatic hiding of spectator cations like alkali metals and the max neighbors cap)`,
    },
    atom_color_mode: {
      value: `element`,
      description: `Property to use for atom coloring`,
      enum: {
        element: `Element`,
        coordination: `Coordination Number`,
        wyckoff: `Wyckoff Position`,
        selective_dynamics: `Selective Dynamics`,
        property: `Site Property`,
      } as Readonly<Record<AtomColorMode, string>>,
    },
    atom_color_scale: typed_setting<D3InterpolateName>({
      value: `interpolateViridis`,
      description: `D3 color scale for property-based coloring (e.g. interpolateViridis, interpolatePlasma)`,
    }),
    atom_color_scale_type: {
      value: `continuous`,
      description: `Color scale type for property-based coloring`,
      enum: { continuous: `Continuous Gradient`, categorical: `Discrete Categories` },
    },

    // Camera & Controls
    gizmo: typed_setting<boolean | GizmoOptions>({
      value: true,
      description: `Show orientation gizmo in the corner of structure viewer`,
    }),
    camera_position: {
      value: [0, 0, 0] satisfies Vec3,
      description: `Initial camera position [x, y, z]`,
      minItems: 3,
      maxItems: 3,
    },
    camera_projection: camera_projection_setting(`orthographic`, `Camera projection type`),
    initial_zoom: {
      value: 50,
      description: `Relative orthographic zoom scale (50 = fit structure bounding sphere to the shorter viewport edge; ignored for perspective)`,
      minimum: 0.1,
      maximum: 200,
    },
    fov: {
      value: 10,
      description: `Field of view in degrees for perspective projection`,
      minimum: 5,
      maximum: 150,
    },
    rotation_damping: {
      // Larger factors settle sooner, not slower: the queued rotation decays by (1 - factor)
      // per frame, so 0.1 keeps drifting for ~0.7 s after release (a fast flick lands another
      // 30°+ past where the pointer stopped) while 0.2 is done in ~0.35 s.
      value: 0.2,
      description: `Camera rotation damping factor (0 disables damping; higher values stop rotation sooner)`,
      minimum: 0,
      maximum: 0.3,
    },
    rotate_speed: {
      // Rotation is 360° * drag_px * rotate_speed / canvas_height_px, so 1.0 spins a full turn
      // per canvas height (0.72 °/px at the default 500 px) — small enough that trackpad jitter
      // swings the view. 0.6 makes a 15° nudge a deliberate ~35 px drag.
      value: 0.6,
      description: `Mouse rotation sensitivity (set to 0 to disable rotation)`,
      minimum: 0,
      maximum: 2.0,
    },
    zoom_speed: {
      value: 0.5,
      description: `Mouse wheel zoom sensitivity`,
      minimum: 0.1,
      maximum: 0.8,
    },
    pan_speed: {
      value: 0.5,
      description: `Mouse pan sensitivity (set to 0 to disable panning)`,
      minimum: 0,
      maximum: 2.0,
    },
    zoom_to_cursor: {
      // off by default: cursor zoom shifts the orbit target toward the pointer and zooming
      // back out does not undo it, so a few wheel flicks walk the structure into a corner
      value: false,
      description: `Zoom toward the cursor instead of the scene center (the view drifts off-center as you zoom)`,
    },
    max_zoom: typed_setting<number | undefined>({
      value: 500,
      description: `Maximum zoom level (orthographic: larger = more zoomed out, perspective: larger = further away)`,
    }),
    min_zoom: typed_setting<number | undefined>({
      value: 10,
      description: `Minimum zoom level (orthographic: smaller = more zoomed in, perspective: smaller = closer)`,
    }),
    auto_rotate: {
      // Off by default: a permanently spinning scene is hard to read, keeps the render loop
      // running every frame (no on-demand rendering, so it costs battery on every embed),
      // and fights the user the moment they orbit.
      value: 0,
      description: `Automatic rotation speed (0 = disabled, positive = clockwise)`,
      minimum: 0,
      maximum: 2,
    },
    rotation: {
      value: [0, 0, 0] satisfies Vec3,
      description: `Manual rotation around X, Y, Z axes, displayed in degrees [0, 360] but normalized as radians to [-π, π] for each of [x, y, z]. Combines additively with auto-rotation when both are active.`,
      minItems: 3,
      maxItems: 3,
    },

    // Labels & Lighting
    show_site_labels: { value: false, description: `Show element labels on atoms` },
    show_site_indices: { value: false, description: `Show site index numbers on atoms` },
    site_label_size: {
      value: 1,
      description: `Font size for atom labels`,
      minimum: 0.5,
      maximum: 2,
    },
    site_label_color: { value: `#111111`, description: `Text color for atom labels` },
    site_label_bg_color: {
      value: `transparent`,
      description: `Background color for atom labels`,
    },
    site_label_padding: {
      value: 2,
      description: `Padding around atom labels in pixels`,
      minimum: 0,
      maximum: 10,
    },
    site_label_offset: {
      value: [0, 0.5, 0] satisfies Vec3,
      description: `3D offset for atom labels [x, y, z]`,
      minItems: 3,
      maxItems: 3,
    },
    ambient_light: {
      value: 1.5,
      description: `Ambient light intensity (0 = dark, higher = brighter)`,
      minimum: 0,
      maximum: 4,
    },
    directional_light: {
      value: 2.2,
      description: `Directional light intensity (0 = no shadows, higher = stronger shadows)`,
      minimum: 0,
      maximum: 4,
    },

    // Site Vectors (force, magmom, spin) & Lattice
    vector_configs: typed_setting<Record<string, VectorLayerConfig>>({
      value: {},
      description: `Per-key configuration for site vector layers. Keys map to site property names (e.g. force, magmom, force_DFT). Auto-populated when a structure with vector data loads.`,
      additionalProperties: { type: `object` },
    }),
    vector_scale: {
      value: 0.75,
      description: `Scale factor for site vector arrows`,
      minimum: 0.001,
      maximum: 10.0,
    },
    vector_color: {
      value: `#ff0000`,
      description: `Color for site vector arrows (used in uniform mode and as fallback)`,
    },
    vector_color_mode: typed_setting<VectorColorMode>({
      value: `auto`,
      description: `How to color arrows. auto = element for force, spin-direction for magmom/spin. element = majority species color. spin_direction = red/blue by z-component. magnitude = continuous color scale by vector length. uniform = single color (vector_color).`,
      enum: {
        auto: `auto`,
        element: `element`,
        spin_direction: `spin direction`,
        magnitude: `magnitude`,
        uniform: `uniform`,
      },
    }),
    vector_color_scale: typed_setting<D3InterpolateName>({
      value: `interpolateViridis`,
      description: `D3 color scale for magnitude coloring mode`,
    }),
    vector_normalize: {
      value: false,
      description: `Show all arrows at the same length (direction only). Useful for spin/magmom visualization where orientation matters but magnitude does not.`,
    },
    vector_uniform_thickness: {
      value: true,
      description: `Use the same shaft and head size for all arrows regardless of length. Negative radii are scaled by characteristic atom spacing.`,
    },
    vector_origin_gap: {
      value: 0,
      description: `Fraction of visual atom radius to offset each arrow origin when multiple vectors are shown per site. 0 = all from atom center, 0.5 = halfway to surface.`,
      minimum: 0,
      maximum: 0.5,
    },
    vector_shaft_radius: {
      value: -0.01,
      description: `Radius of vector shaft (negative = relative to length or atom spacing with uniform thickness, positive = absolute)`,
      minimum: -0.1,
      maximum: 0.1,
    },
    vector_arrow_head_radius: {
      value: -0.04,
      description: `Radius of vector arrow head (negative = relative to length or atom spacing with uniform thickness, positive = absolute)`,
      minimum: -0.2,
      maximum: 0.2,
    },
    vector_arrow_head_length: {
      value: -0.1,
      description: `Length of vector arrow head (negative = relative to length or atom spacing with uniform thickness, positive = absolute)`,
      minimum: -0.5,
      maximum: 0.5,
    },
    show_displacement_arrows: {
      value: true,
      description: `Draw an arrow per atom from its position in the reference structure to its current one (only when a reference structure is supplied)`,
    },
    displacement_arrow_scale: {
      value: 1,
      description: `Length multiplier for displacement arrows. Arrows are auto-scaled first so the largest displacement spans ~0.9x the characteristic atom spacing (true magnitudes are reported as RMSD/max), since real relaxations are smaller than an atomic radius and would otherwise hide inside their atoms`,
      minimum: 0.1,
      maximum: 20,
    },
    displacement_arrow_color: {
      value: `#ff7f0e`,
      description: `Color of displacement arrows`,
    },
    show_trajectory_lines: {
      value: false,
      description: `Draw the path each atom traces over the whole trajectory as a polyline (requires a trajectory, not a single structure)`,
    },
    trajectory_line_trail_frames: {
      value: 0,
      description: `Length of the trail behind the current frame, in collected frames. 0 draws the whole run; a finite window leaves a comet tail during playback`,
      minimum: 0,
      maximum: 10000,
      multipleOf: 1,
    },
    trajectory_line_frame_stride: {
      value: 1,
      description: `Draw every Nth collected frame of the trail. Raise it so a 100k-frame run does not allocate 100k vertices per atom`,
      minimum: 1,
      maximum: 1000,
      multipleOf: 1,
    },
    trajectory_line_color_mode: {
      value: `element`,
      description: `Color trails by their atom's element (matching the spheres) or by time along the path`,
      enum: { element: `Element`, time: `Time` },
    },
    trajectory_line_wrap_mode: {
      value: `unwrap`,
      description: `Unwrap paths across periodic boundaries (real diffusion paths, may leave the cell) or keep them wrapped and break the line where an atom crosses a cell face`,
      enum: { unwrap: `Unwrap (continuous)`, break: `Break at cell crossings` },
    },
    show_cell_vectors: { value: true, description: `Display cell vectors` },
    cell_edge_opacity: opacity_setting(0.3, `Opacity of cell edge lines`),
    cell_surface_opacity: opacity_setting(0.1, `Opacity of cell surfaces`),
    cell_edge_color: { value: `#808080`, description: `Color of cell edges` },
    cell_surface_color: { value: `#e0e0e0`, description: `Color of cell surfaces` },
    cell_edge_width: {
      value: 1.5,
      description: `Width of cell edge lines`,
      minimum: 0.5,
      maximum: 5.0,
    },
    fullscreen_toggle: fullscreen_toggle_setting(),
  },

  // Brillouin zone viewer settings
  brillouin: {
    bz_order: {
      value: 1,
      description: `Brillouin zone order to render (1 = first BZ)`,
      minimum: 1,
      maximum: 5,
    },
    surface_color: { value: `#4488ff`, description: `Brillouin zone face color` },
    surface_opacity: opacity_setting(0.3, `Opacity of Brillouin zone faces`),
    edge_color: { value: `#000000`, description: `Brillouin zone edge color` },
    edge_width: {
      value: 0.002,
      description: `Width of Brillouin zone edges (fraction of zone size)`,
      minimum: 0,
      maximum: 0.05,
    },
    show_vectors: { value: true, description: `Display reciprocal lattice vectors` },
    vector_scale: {
      value: 1.0,
      description: `Length multiplier for reciprocal lattice vectors`,
      minimum: 0.1,
      maximum: 5,
    },
    camera_projection: camera_projection_setting(
      `perspective`,
      `Camera projection mode for the Brillouin zone scene`,
    ),
    // Irreducible BZ
    show_ibz: { value: false, description: `Display the irreducible Brillouin zone` },
    ibz_color: { value: `#ff8844`, description: `Irreducible Brillouin zone face color` },
    ibz_opacity: opacity_setting(0.5, `Opacity of irreducible Brillouin zone faces`),
    fullscreen_toggle: fullscreen_toggle_setting(),
  },

  // Fermi surface viewer settings
  fermi: {
    mu: {
      value: 0,
      description: `Chemical potential offset from the Fermi level (eV)`,
    },
    color_property: {
      value: `band`,
      // VS Code's configuration schema carries no per-value deprecation, so the removed values
      // are called out in the description
      description: `Quantity mapped onto the Fermi surface color scale ('velocity' and 'custom' were removed; use 'property')`,
      enum: { band: `Band`, spin: `Spin`, property: `Property` },
    },
    color_scale: typed_setting<D3InterpolateName>({
      value: `interpolateViridis`,
      description: `D3 color scale for the Fermi surface (e.g. interpolateViridis, interpolatePlasma)`,
    }),
    representation: {
      value: `solid`,
      description: `How to render the Fermi surface`,
      enum: { solid: `Solid`, wireframe: `Wireframe`, transparent: `Transparent` },
    },
    surface_opacity: opacity_setting(0.8, `Opacity of the Fermi surface`),
    show_bz: { value: true, description: `Display the Brillouin zone around the surface` },
    bz_opacity: opacity_setting(0.1, `Opacity of the Brillouin zone faces`),
    show_vectors: { value: true, description: `Display reciprocal lattice vectors` },
    tile_bz: {
      value: false,
      description: `Tile an irreducible surface across the full Brillouin zone`,
    },
    // Clipping plane
    clip_enabled: {
      value: false,
      description: `Cut the surface with a plane to reveal its interior`,
    },
    clip_axis: {
      value: `z` as const,
      description: `Axis the clipping plane is normal to`,
      enum: { x: `X`, y: `Y`, z: `Z` },
    },
    clip_position: {
      value: 0,
      description: `Clipping plane offset along its axis (fraction of the zone extent)`,
      minimum: -1,
      maximum: 1,
    },
    clip_flip: { value: false, description: `Keep the other side of the clipping plane` },
    interpolation_factor: {
      value: 1,
      description: `Band-grid upsampling factor (higher = smoother surface, slower)`,
      minimum: 1,
      maximum: 5,
    },
    camera_projection: camera_projection_setting(
      `perspective`,
      `Camera projection mode for the Fermi surface scene`,
    ),
    fullscreen_toggle: fullscreen_toggle_setting(),
  },

  // Trajectory viewer settings
  trajectory: {
    // Core trajectory settings
    auto_play: {
      value: false,
      description: `Automatically start playing trajectory when opened`,
    },
    fps: {
      value: 10,
      description: `Playback FPS in 0.1 increments (0 pauses)`,
      minimum: DEFAULT_FPS_RANGE[0],
      maximum: DEFAULT_FPS_RANGE[1],
      multipleOf: FPS_STEP,
    },
    fps_range: typed_setting<Readonly<Vec2>>({
      value: DEFAULT_FPS_RANGE,
      description: `Allowed range for playback speed [min, max], where 0 means paused`,
      minItems: 2,
      maxItems: 2,
      items: {
        minimum: DEFAULT_FPS_RANGE[0],
        maximum: DEFAULT_FPS_RANGE[1],
        multipleOf: FPS_STEP,
      },
    }),
    display_mode: {
      value: `structure+scatter` as const,
      description: `Visualization mode for trajectory data`,
      enum: {
        'structure+scatter': `Structure + Scatter`,
        structure: `Structure`,
        scatter: `Scatter`,
        histogram: `Histogram`,
        'structure+histogram': `Structure + Histogram`,
      },
    },
    show_controls: { value: true, description: `Show playback controls` },
    fullscreen_toggle: fullscreen_toggle_setting(),
    step_labels: {
      value: 5,
      description: `Number of frame labels to display`,
      minimum: 0,
      maximum: 20,
    },
    layout: {
      value: `auto` as const,
      description: `Layout arrangement for trajectory viewer`,
      enum: { auto: `Auto`, horizontal: `Horizontal`, vertical: `Vertical` },
    },

    // File handling and loading
    allow_file_drop: {
      value: true,
      description: `Allow drag-and-drop of trajectory files`,
    },
    index_above_bytes: {
      value: 25000000,
      description: `Trajectory files (XYZ, EXTXYZ, ASE .traj) larger than this many bytes are parsed in a Web Worker and decoded frame by frame on demand instead of all at once`,
      minimum: 1000000,
      maximum: 2000000000,
    },
    // Keys are the integer atom types of a LAMMPS dump (JSON object keys are strings);
    // AtomTypeMapping indexes them by number, which resolves to the same properties
    atom_type_mapping: typed_setting<Readonly<Record<string, ElementSymbol>>>({
      value: {},
      description: `Element symbol for each LAMMPS dump atom type, e.g. { "1": "Si", "2": "O" }. Dumps rarely carry an element column; unmapped types are read as atomic numbers (type 1 = H, 2 = He, ...)`,
      additionalProperties: { type: `string` },
    }),
  },

  // Histogram specific
  histogram: {
    mode: {
      value: `overlay` as const,
      description: `Histogram display mode. 'overlay' shows multiple histograms in the same plot, 'single' shows a single histogram`,
      enum: { overlay: `Overlay`, single: `Single` },
    },
    show_legend: legend_visibility_setting(`histogram`),
    normalize: {
      value: `count` as const,
      description: `Bar heights: raw counts, fraction of samples in the plotted range, or probability density (integrates to 1)`,
      enum: { count: `Count`, probability: `Probability`, density: `Density` },
    },
    bin_count: {
      // Wider than the HistogramControls slider (5..100 in steps of 5) on purpose: the
      // component accepts any positive bin count and tests drive it with 2 and 3.
      value: 100,
      description: `Number of bins for histogram plots`,
      minimum: 1,
      maximum: 1000,
    },
    bar: {
      color: { value: `#4A9EFF`, description: `Histogram bar fill color` },
      opacity: opacity_setting(0.7, `Histogram bar opacity`),
      stroke_width: {
        value: 1,
        description: `Histogram bar stroke width`,
        minimum: 0,
        maximum: 5,
      },
      stroke_color: { value: `#000000`, description: `Histogram bar stroke color` },
      stroke_opacity: opacity_setting(0.5, `Histogram bar stroke opacity`),
    },
  },

  // Bar plot specific
  bar: {
    bar: {
      color: { value: `#4A9EFF`, description: `Bar plot fill color` },
      opacity: opacity_setting(0.6, `Bar plot opacity (overlay mode)`),
      border_radius: {
        value: 3,
        description: `Corner radius for bar tops (px)`,
        minimum: 0,
        maximum: 10,
      },
    },
    line: {
      width: { value: 2, description: `Bar plot line width`, minimum: 0.5, maximum: 10 },
      color: { value: `#4A9EFF`, description: `Bar plot line color` },
    },
  },

  // Box plot specific
  box: {
    whisker_mode: {
      value: `tukey` as const,
      description: `How whiskers are computed: 'tukey' (1.5*IQR), 'minmax' (data extremes), 'percentile' (5th/95th), or 'std' (mean ± std)`,
      enum: {
        tukey: `Tukey (1.5·IQR)`,
        minmax: `Min/Max`,
        percentile: `Percentile`,
        std: `Std Dev`,
      },
    },
    box_width: {
      value: 0.8,
      description: `Box width as a fraction of the category slot`,
      minimum: 0.1,
      maximum: 1,
    },
    show_outliers: {
      value: true,
      description: `Show outlier points beyond the whiskers`,
    },
    show_mean: { value: false, description: `Show the mean marker inside each box` },
    kind: {
      value: `box` as const,
      description: `Glyph to draw per series: box, violin (KDE density), or both`,
      enum: { box: `Box`, violin: `Violin`, 'violin+box': `Violin + Box` },
    },
    side: {
      value: `both` as const,
      description: `Which half of the slot a violin occupies (one-sided / split violins)`,
      enum: { both: `Both`, positive: `Positive`, negative: `Negative` },
    },
    bandwidth: {
      value: `silverman` as const,
      description: `KDE bandwidth rule for violins`,
      enum: { silverman: `Silverman`, scott: `Scott` },
    },
    violin_width: {
      value: 0.9,
      description: `Violin width as a fraction of the category slot`,
      minimum: 0.1,
      maximum: 1,
    },
    violin_box_width: {
      value: 0.2,
      description: `Inner box width (fraction of slot) when a box is drawn inside a violin`,
      minimum: 0.05,
      maximum: 1,
    },
    box: {
      color: { value: `#4A9EFF`, description: `Box fill color` },
      opacity: opacity_setting(0.6, `Box fill opacity`),
      stroke_width: {
        value: 0.5,
        description: `Box outline width`,
        minimum: 0,
        maximum: 5,
      },
      stroke_color: {
        value: `var(--text-color, black)`, // theme-responsive like axis/grid colors
        description: `Box outline color`,
      },
      border_radius: {
        value: 0,
        description: `Corner radius for boxes (px)`,
        minimum: 0,
        maximum: 10,
      },
    },
    whisker: {
      width: { value: 1, description: `Whisker line width`, minimum: 0.5, maximum: 5 },
      color: {
        value: `var(--text-color, black)`, // theme-responsive like axis/grid colors
        description: `Whisker line color`,
      },
      cap_fraction: {
        value: 0.3,
        description: `Whisker cap width as a fraction of the box width`,
        minimum: 0,
        maximum: 1,
      },
    },
    median: {
      width: { value: 1.5, description: `Median line width`, minimum: 0.5, maximum: 6 },
      color: {
        value: `var(--text-color, black)`, // theme-responsive like axis/grid colors
        description: `Median line color`,
      },
    },
    outlier: {
      radius: {
        value: 2.5,
        description: `Outlier point radius (px)`,
        minimum: 0.5,
        maximum: 10,
      },
      opacity: opacity_setting(0.6, `Outlier point opacity`),
      stroke_width: {
        value: 0,
        description: `Outlier point stroke width`,
        minimum: 0,
        maximum: 3,
      },
    },
    violin: {
      opacity: opacity_setting(0.5, `Violin fill opacity`),
      stroke_width: {
        value: 1,
        description: `Violin outline width`,
        minimum: 0,
        maximum: 5,
      },
    },
  },

  // Sankey diagram specific
  sankey: {
    min_fraction: {
      value: 0,
      description: `Fold a node's outgoing links carrying less than this fraction of its outflow into one 'Other' link (0 = off). Only links to terminal targets are folded, so no downstream flow is lost`,
      minimum: 0,
      maximum: 0.2,
    },
    max_links: {
      value: 0,
      description: `Keep at most this many outgoing links per node, largest first, folding the rest into one 'Other' link (0 = unlimited). Not a hard cap on what is drawn: only links to terminal targets can be folded, and the 'Other' link itself is additional`,
      minimum: 0,
      maximum: 20,
      multipleOf: 1,
    },
    orientation: {
      value: `horizontal` as const,
      description: `Flow direction of the Sankey diagram`,
      enum: { horizontal: `Horizontal`, vertical: `Vertical` },
    },
    node_align: {
      value: `justify` as const,
      description: `How nodes are aligned across columns (maps to d3-sankey alignment)`,
      enum: { justify: `Justify`, left: `Left`, right: `Right`, center: `Center` },
    },
    node_width: {
      value: 24,
      description: `Node thickness in pixels`,
      minimum: 4,
      maximum: 60,
    },
    node_padding: {
      value: 12,
      description: `Vertical gap in pixels between nodes sharing a column`,
      minimum: 0,
      maximum: 40,
    },
    link_opacity: {
      value: 0.5,
      description: `Opacity of link ribbons`,
      minimum: 0.05,
      maximum: 1,
    },
    show_node_labels: { value: true, description: `Show node labels next to each node` },
    iterations: {
      value: 6,
      description: `Number of d3-sankey relaxation iterations for node positioning`,
      minimum: 0,
      maximum: 64,
    },
  },

  // Sunburst chart specific
  sunburst: {
    ...hierarchy_chart_settings(
      `arc`,
      `rings`,
      `Clicking a branch arc zooms into that subtree (center circle zooms out)`,
    ),
    shape: {
      value: `sunburst` as const,
      description: `Chart geometry: polar rings (sunburst) or stacked rows (icicle)`,
      enum: { sunburst: `Sunburst`, icicle: `Icicle` },
    },
    inner_radius: {
      value: 0.25,
      description: `Center hole size as fraction of the outer radius`,
      minimum: 0,
      maximum: 0.8,
    },
    pad_angle: {
      value: 0.1,
      description: `Angular gap in degrees between sibling arcs`,
      minimum: 0,
      maximum: 4,
    },
    label_rotation: {
      value: `auto` as const,
      description: `Arc label orientation (auto picks radial/tangential per arc)`,
      enum: {
        auto: `Auto`,
        radial: `Radial`,
        tangential: `Tangential`,
        horizontal: `Horizontal`,
      },
    },
  },

  // Treemap chart specific
  treemap: {
    ...hierarchy_chart_settings(
      `cell`,
      `levels`,
      `Clicking any cell zooms into it, plotly-style (the breadcrumb pathbar zooms out)`,
    ),
    padding_inner: {
      value: 0,
      description: `Pixel gap between sibling cells (0 = cells share a single stroke divider; gaps > 0 show the parent's fill)`,
      minimum: 0,
      maximum: 10,
    },
    padding_top: {
      value: 18,
      description: `Pixel strip reserved at the top of branch cells for their label (0 = no headers)`,
      minimum: 0,
      maximum: 40,
    },
    padding_outer: {
      value: 3,
      description: `Pixel inset of child cells within their parent's left/right/bottom edges, so parents visibly enclose their subtree (plotly marker.pad)`,
      minimum: 0,
      maximum: 10,
    },
  },

  // Scatter plot specific
  scatter: {
    symbol_type: {
      value: `Circle`,
      description: `Default symbol type for scatter plots`,
      enum: self_labeled_enum(symbol_names),
    },
    show_legend: legend_visibility_setting(`scatter`),
    show_points: { value: true, description: `Show points in scatter plots` },
    show_lines: { value: true, description: `Show connecting lines in scatter plots` },
    point: {
      size: {
        value: 3,
        description: `Point size for scatter plots`,
        minimum: 1,
        maximum: 20,
      },
      color: { value: `#4A9EFF`, description: `Default color for scatter plot points` },
      opacity: opacity_setting(1, `Opacity of scatter plot points`),
      stroke_width: {
        value: 0.5,
        description: `Stroke width for scatter plot points`,
        minimum: 0,
        maximum: 5,
      },
      stroke_color: {
        value: `#000000`,
        description: `Stroke color for scatter plot points`,
      },
      stroke_opacity: opacity_setting(0.45, `Stroke opacity for scatter plot points`),
    },
    line: {
      width: {
        value: 2,
        description: `Line width for scatter plot connections`,
        minimum: 0.5,
        maximum: 10,
      },
      color: { value: `#4A9EFF`, description: `Default color for scatter plot lines` },
      opacity: opacity_setting(1, `Opacity of scatter plot lines`),
      dash: {
        value: `solid`,
        description: `Line dash pattern for scatter plots (e.g. "4,4" for dashed)`,
      },
    },
  },

  // Plot general (shared by scatter, bar, box and histogram plots)
  plot: {
    display: {
      x_grid: { value: true, description: `Show X-axis grid lines` },
      y_grid: { value: true, description: `Show Y-axis grid lines` },
      y2_grid: { value: false, description: `Show Y2-axis grid lines` },
      x_zero_line: { value: true, description: `Show X-axis zero reference line` },
      y_zero_line: { value: true, description: `Show Y-axis zero reference line` },
    },
  },

  convex_hull: {
    // Convex hull defaults (binary/ternary/quaternary)
    binary: convex_hull_settings(`binary`, {
      camera_zoom: 1.0,
      camera_zoom_max: 10,
      max_hull_dist_show_phases: 0.1,
    }),
    ternary: {
      ...convex_hull_settings(`ternary`, {
        camera_zoom: 1.5,
        camera_zoom_max: 10,
        max_hull_dist_show_phases: 0.5,
      }),
      ...hull_face_settings(`3D`, { opacity: 0.3, color_mode: `uniform` }),
      camera_elevation: {
        value: 45,
        description: `Initial camera elevation (deg) for ternary (3D) convex hull`,
        minimum: -180,
        maximum: 180,
      },
      camera_azimuth: {
        value: 60,
        description: `Initial camera azimuth (deg) for ternary (3D) convex hull`,
        minimum: -360,
        maximum: 360,
      },
    },
    quaternary: {
      ...convex_hull_settings(`quaternary`, {
        camera_zoom: 1.4,
        camera_zoom_max: 20,
        max_hull_dist_show_phases: 0.1,
      }),
      ...hull_face_settings(`4D`, { opacity: 0.03, color_mode: `dominant_element` }),
      camera_rotation_x: {
        value: -0.6,
        description: `Initial camera X rotation (rad) for quaternary (4D) convex hull`,
        minimum: -6.283,
        maximum: 6.283,
      },
      camera_rotation_y: {
        value: 0.8,
        description: `Initial camera Y rotation (rad) for quaternary (4D) convex hull`,
        minimum: -6.283,
        maximum: 6.283,
      },
    },
  },
})

type SettingsConfig = typeof SETTINGS_CONFIG

// Recursively extract each setting's runtime value type from the schema.
type SettingsValues<Config> = {
  [Key in keyof Config]: Config[Key] extends SettingType<infer Value>
    ? Value
    : Config[Key] extends object
      ? SettingsValues<Config[Key]>
      : never
}
export type DefaultSettings = SettingsValues<SettingsConfig>

// Extract values from settings config for runtime use
const extract_values = <Config extends object>(config: Config): SettingsValues<Config> => {
  const result = {} as Record<string, unknown>
  for (const [key, value] of Object.entries(config)) {
    if (!value || typeof value !== `object`) continue
    result[key] = `value` in value ? value.value : extract_values(value)
  }
  return result as SettingsValues<Config>
}

// Runtime defaults - extracted values for use in components
export const DEFAULTS = extract_values(SETTINGS_CONFIG)

// === Validation of stored / host-supplied values ===
// One admissibility rule for every place a setting value arrives from outside the program:
// localStorage view state (settings/viewer-state.ts) and VS Code settings.json (the extension).

const valid_number = (value: unknown, setting: SettingType): value is number => {
  if (typeof value !== `number` || !Number.isFinite(value)) return false
  if (setting.minimum !== undefined && value < setting.minimum) return false
  if (setting.maximum !== undefined && value > setting.maximum) return false
  if (setting.multipleOf !== undefined) {
    const quotient = value / setting.multipleOf
    const tolerance = Number.EPSILON * Math.max(1, Math.abs(quotient)) * 4
    if (Math.abs(quotient - Math.round(quotient)) > tolerance) return false
  }
  return true
}

const same_primitive_type = (value: unknown, reference: unknown): boolean =>
  typeof value === typeof reference && (typeof value !== `number` || Number.isFinite(value))

const valid_array = (value: unknown, setting: SettingType, reference: readonly unknown[]) => {
  if (!Array.isArray(value)) return false
  if (setting.minItems !== undefined && value.length < setting.minItems) return false
  if (setting.maxItems !== undefined && value.length > setting.maxItems) return false
  // The only empty-array settings in the schema are element-symbol lists.
  if (reference.length === 0) return value.every((item) => typeof item === `string`)
  return value.every((item, item_idx) =>
    same_primitive_type(item, reference[item_idx] ?? reference[0]),
  )
}

// Whether `value` may stand in for the schema default: enum membership, a finite number inside
// minimum/maximum/multipleOf, an array of the default's item types inside minItems/maxItems, a
// plain object for free-form maps, else the default's primitive type.
export const is_valid_setting_value = (value: unknown, setting: SettingType): boolean => {
  if (setting.enum) return typeof value === `string` && Object.hasOwn(setting.enum, value)
  if (typeof setting.value === `number`) return valid_number(value, setting)
  if (Array.isArray(setting.value)) return valid_array(value, setting, setting.value)
  if (is_plain_record(setting.value)) return is_plain_record(value)
  return same_primitive_type(value, setting.value)
}

// Deep copy by hand rather than structuredClone: values arrive through Svelte $state proxies,
// which structuredClone rejects with DataCloneError.
const clone_value = <Value>(value: Value): Value => {
  if (Array.isArray(value)) return value.map(clone_value) as Value
  if (!is_plain_record(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, clone_value(nested)]),
  ) as Value
}

// A copy of `value` when it is admissible for `setting`, else a copy of the schema default
export const validate_setting_value = <Value>(
  value: unknown,
  setting: SettingType<Value>,
): Value =>
  clone_value(is_valid_setting_value(value, setting) ? (value as Value) : setting.value)

export const get_convex_hull_defaults = (element_count: 2 | 3 | 4) =>
  DEFAULTS.convex_hull[
    element_count === 2 ? `binary` : element_count === 3 ? `ternary` : `quaternary`
  ]

type DeepPartial<T> = {
  [Key in keyof T]?: T[Key] extends Record<string, unknown> ? DeepPartial<T[Key]> : T[Key]
}

// Partial settings at every nesting level (`{ scatter: { point: { size: 5 } } }`): merge()
// fills the gaps from DEFAULTS at every level, so the type and the runtime agree whatever
// depth the schema grows to.
export type PartialSettings = DeepPartial<DefaultSettings>

// Recurse wherever both sides are plain records; anything else the user supplies (a primitive,
// array, null, Date, ...) replaces the default, and an undefined user value keeps it
const merge_deep = <T>(defaults: T, user: unknown): T => {
  if (!is_plain_record(defaults) || !is_plain_record(user)) {
    return (user === undefined ? defaults : user) as T
  }
  const merged: Record<string, unknown> = { ...defaults }
  for (const [key, value] of Object.entries(user)) {
    // JSON.parse yields an own `__proto__` key; assigning it would rewire merged's prototype
    if (key === `__proto__`) continue
    merged[key] = merge_deep(defaults[key], value)
  }
  return merged as T
}

export const merge = (user: PartialSettings = {}): DefaultSettings =>
  merge_deep(DEFAULTS, user)

// Group the structure defaults into the prop bundles <Structure> expects. Used by embedders
// (file viewer, VS Code webview) that build a viewer from settings alone.
export const build_structure_props_from_settings = (defaults: DefaultSettings) => {
  const { structure } = defaults
  return {
    scene_props: { ...structure },
    color_scheme: defaults.color_scheme,
    background_color: defaults.background_color,
    background_opacity: defaults.background_opacity,
    show_image_atoms: structure.show_image_atoms,
    show_trajectory_lines: structure.show_trajectory_lines,
  }
}
