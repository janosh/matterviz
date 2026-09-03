import type { CompositionType } from '$lib/composition'
import type { ElementSymbol } from '$lib/element'
import { element_by_symbol, element_data } from '$lib/element'
import type { FileLoadData } from '$lib/io/types'
import type { Matrix3x3, Vec3 } from '$lib/math'
import type { CameraProjection } from '$lib/settings'
import type { Pbc } from './pbc'

export { default as Arrow } from './Arrow.svelte'
export * from './atom-properties'
export { default as AtomLegend } from './AtomLegend.svelte'
export * from './bonding'
export { default as CanvasTooltip } from './CanvasTooltip.svelte'
export { default as Cylinder } from './Cylinder.svelte'
export { default as Lattice } from './Lattice.svelte'
export * from './lattice-planes'
export { default as LatticePlanes } from './LatticePlanes.svelte'
export * from './camera-fit'
export * from './density'
export * from './measure'
export * from './material'
export { StructureSession, type StructureSessionInputs } from './session.svelte'
export * from './pbc'
export * from './polyhedra'
export * from './export'
export * from './site'
export { default as Structure } from './Structure.svelte'
export { default as StructureGallery } from './StructureGallery.svelte'

// defined here (not in StructureGallery.svelte's module script) so plain-TS
// consumers can import it from '$lib/structure' without a .svelte module
// resolution, which type-aware lint can't see named exports of
export type StructureGalleryItem = {
  id: string
  label: string
  subtitle?: string
  structure: AnyStructure
  // Key/value captions for the viewer. Numeric ones are tinted by their rank across the whole
  // collection when the gallery has a property_color_scheme; `_` marks a subscript (`E_hull`).
  properties?: Record<string, number | string>
}
export { default as StructureControls } from './StructureControls.svelte'
export { default as StructureEditToolbar } from './StructureEditToolbar.svelte'
export { default as StructureExportPane } from './StructureExportPane.svelte'
export { default as StructureInfoPane } from './StructureInfoPane.svelte'
export { default as StructureScene } from './StructureScene.svelte'
export { default as StructureViewport } from './StructureViewport.svelte'
export { default as TrajectoryLines } from './TrajectoryLines.svelte'
export * from './trajectory-lines'
export * from './supercell'
export * from './validation'

export type MeasureMode = `distance` | `angle` | `dihedral` | `edit-bonds` | `edit-atoms`
export type BondEditMode = `add` | `delete`
export type StructureDisplayMode = `structure` | `slice`
// The one floating pane a Structure viewer has open
export type StructurePane = `controls` | `info` | `export`

// A single viewport definition for the multi-side (2x2) view. `direction` is the
// camera offset direction from the structure center (target-relative); `projection`
// chooses perspective vs orthographic; `label` is shown in the viewport corner.
export type StructureView = {
  label?: string
  projection?: CameraProjection
  direction?: Vec3
}

// Ovito-like default 2x2 view set: one perspective + three orthographic axis views.
export const DEFAULT_STRUCTURE_VIEWS: StructureView[] = [
  { label: `Perspective`, projection: `perspective`, direction: [1, 0.3, 0.8] },
  { label: `Front`, projection: `orthographic`, direction: [0, 0, 1] },
  { label: `Top`, projection: `orthographic`, direction: [0, 1, 0] },
  { label: `Right`, projection: `orthographic`, direction: [1, 0, 0] },
]

export type Species = {
  element: ElementSymbol
  occu: number
  oxidation_state: number
}
export type Site = {
  species: Species[]
  abc: Vec3
  xyz: Vec3
  label: string
  properties: Record<string, unknown>
}

export type LatticeParams = Record<`a` | `b` | `c` | `alpha` | `beta` | `gamma`, number>

export type LatticeType = {
  matrix: Matrix3x3
  pbc: Pbc
  volume: number
} & LatticeParams

export type Molecule = {
  sites: Site[]
  charge?: number
  id?: string
  properties?: StructureProperties
}
export type Crystal = Molecule & { lattice: LatticeType }
export type AnyStructure = Crystal | Molecule

export type BondOrder = 1 | 1.5 | 2 | 3 | `aromatic`

export type StructureBond = {
  site_idx_1: number
  site_idx_2: number
  order: BondOrder
  // Integer lattice-vector offset applied to site_idx_2 relative to site_idx_1.
  cell_shift?: Vec3
}

type StructureProperties = Record<string, unknown> & { bonds?: StructureBond[] }

// Chemistry/topology bond data shared by rendering, analysis, and editing consumers.
export type BondPair = {
  pos_1: Vec3
  pos_2: Vec3
  site_idx_1: number
  site_idx_2: number
  bond_length: number
  bond_order?: BondOrder
  cell_shift?: Vec3
}

export type { PerceivedBond, PerceptionOptions } from '$lib/structure/bond-order-perception'
export {
  compose_perceived_bonds,
  perceive_bond_orders,
} from '$lib/structure/bond-order-perception'

// Atomic radii in Angstroms (used for relative sizing, not absolute rendering scale)
export const atomic_radii: CompositionType = Object.fromEntries(
  element_data.map((el) => [el.symbol, el.atomic_radius ?? 1]),
)

export function get_center_of_mass(structure: AnyStructure): Vec3 {
  let [sum_x, sum_y, sum_z, total_weight] = [0, 0, 0, 0]
  for (const { species, xyz } of structure.sites) {
    // a disordered site contributes every species, weighted by its occupancy
    for (const { element, occu } of species) {
      const weight = (element_by_symbol.get(element)?.atomic_mass ?? 1) * occu
      sum_x += weight * xyz[0]
      sum_y += weight * xyz[1]
      sum_z += weight * xyz[2]
      total_weight += weight
    }
  }
  return [sum_x / total_weight, sum_y / total_weight, sum_z / total_weight]
}

// Recognized prefixes for per-site vector data (force, magnetic moment, spin, velocity).
// Both singular and plural forms are accepted. Keys matching exactly or starting
// with one of these followed by `_` (e.g. `force_DFT`) are treated as vectors.
const VECTOR_KEY_PREFIXES = [
  `force`,
  `forces`,
  `magmom`,
  `magmoms`,
  `spin`,
  `spins`,
  `velocity`,
  `velocities`,
  `phonon`,
] as const

// Memoised: the scan below asks this for every property key of every site on every
// trajectory frame, and the set of distinct key names in a session is tiny
const vector_key_memo = new Map<string, boolean>()
export const is_vector_key = (key: string): boolean => {
  let is_vector = vector_key_memo.get(key)
  if (is_vector === undefined) {
    is_vector = VECTOR_KEY_PREFIXES.some(
      (prefix) => key === prefix || key.startsWith(`${prefix}_`),
    )
    if (vector_key_memo.size >= 1024) vector_key_memo.clear()
    vector_key_memo.set(key, is_vector)
  }
  return is_vector
}

export const RESET_VIEW_TITLE = `Reset view (r, or double-click)`

// Default color palette for distinguishing multiple vector layers
export const VECTOR_PALETTE = [
  `#e74c3c`,
  `#3498db`,
  `#2ecc71`,
  `#f39c12`,
  `#9b59b6`,
  `#1abc9c`,
] as const

// Same key shape as is_vector_key, restricted to the velocity prefixes
const is_velocity_vector_key = (key: string): boolean =>
  [`velocity`, `velocities`].some((prefix) => key === prefix || key.startsWith(`${prefix}_`))

// MD velocities are much larger than typical force-vector values in supported file units.
// Shorter, thinner defaults keep velocity arrows from overwhelming the structure or cell.
export const vector_display_defaults = (key: string) =>
  is_velocity_vector_key(key)
    ? { scale: 0.05, shaft_radius: 0.2, arrow_head_radius: 0.1, arrow_head_length: 0.1 }
    : { scale: null, shaft_radius: 1, arrow_head_radius: 1, arrow_head_length: 1 }

// Single key → null color (semantic coloring); multiple keys → palette colors.
export const default_vector_configs = (keys: string[]) =>
  Object.fromEntries(
    keys.map((key, idx) => [
      key,
      {
        visible: true,
        color: keys.length > 1 ? VECTOR_PALETTE[idx % VECTOR_PALETTE.length] : null,
        scale: vector_display_defaults(key).scale,
      },
    ]),
  )

function try_parse_vec3(val: unknown): Vec3 | null {
  if (
    Array.isArray(val) &&
    val.length === 3 &&
    val.every((elem) => typeof elem === `number` && isFinite(elem))
  )
    return val as Vec3
  if (typeof val === `number` && isFinite(val)) return [0, 0, val]
  return null
}

// Priority index for ordering: bare names first in VECTOR_KEY_PREFIXES order,
// then prefixed keys in the same prefix order, alphabetically within each prefix group.
function vector_key_sort_order(key: string): [number, number, string] {
  for (const [prefix_idx, prefix] of VECTOR_KEY_PREFIXES.entries()) {
    if (key === prefix) return [prefix_idx, 0, ``]
    if (key.startsWith(`${prefix}_`)) return [prefix_idx, 1, key]
  }
  return [VECTOR_KEY_PREFIXES.length, 0, key]
}

function compare_vector_keys(left: string, right: string): number {
  const ord_l = vector_key_sort_order(left)
  const ord_r = vector_key_sort_order(right)
  return ord_l[0] - ord_r[0] || ord_l[1] - ord_r[1] || ord_l[2].localeCompare(ord_r[2])
}

// Extract ALL vector properties from a site (not just the first match).
// Returns entries for every key that is_vector_key() and has a valid 3D vector value.
// Ordered by VECTOR_KEY_PREFIXES priority by default; callers may skip sorting when order is unused.
export function get_all_site_vectors(
  site: Site,
  ordered = true,
): { vec: Vec3; key: string }[] {
  const props = site.properties
  if (!props) return []
  const results: { vec: Vec3; key: string }[] = []
  for (const key of Object.keys(props)) {
    if (!is_vector_key(key)) continue
    const vec = try_parse_vec3(props[key])
    if (vec) results.push({ vec, key })
  }
  if (ordered) results.sort((left, right) => compare_vector_keys(left.key, right.key))
  return results
}

// Collect the union of all vector property keys across all sites in a structure,
// preserving VECTOR_KEY_PREFIXES priority order. Memoised per structure: Structure, its
// controls and every scene pane ask for the same answer on every trajectory frame.
const vector_keys_memo = new WeakMap<AnyStructure, string[]>()
export function get_structure_vector_keys(structure: AnyStructure): string[] {
  const memo = vector_keys_memo.get(structure)
  if (memo) return memo
  const seen = new Set<string>()
  for (const site of structure.sites) {
    const props = site.properties
    if (!props) continue
    // a key already seen skips its prefix and vector checks
    for (const key of Object.keys(props)) {
      if (!seen.has(key) && is_vector_key(key) && try_parse_vec3(props[key])) seen.add(key)
    }
  }
  // oxlint-disable-next-line eslint-plugin-unicorn/no-array-sort -- spread creates a fresh array
  const keys = [...seen].sort(compare_vector_keys)
  vector_keys_memo.set(structure, keys)
  return keys
}

// Payload of Structure's file, fullscreen and camera callbacks; each emitter fills what it knows
export interface StructureHandlerData extends FileLoadData {
  structure?: AnyStructure
  file_size?: number
  total_atoms?: number
  error_msg?: string
  fullscreen?: boolean
  camera_position?: Vec3
  camera_target?: Vec3
  camera_zoom?: number
  camera_has_moved?: boolean
}
