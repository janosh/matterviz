import type { CompositionType } from '$lib/composition'
import type { ElementSymbol } from '$lib/element'
import { element_by_symbol, element_data } from '$lib/element'
import type { FileLoadData } from '$lib/io/types'
import type { Matrix3x3, Vec3 } from '$lib/math'
import type { CameraProjection } from '$lib/settings'
import type { Pbc } from './pbc'
import { numeric_sites } from './site'

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
export {
  structure_host_tool,
  prediction_to_json,
  prediction_from_json,
} from './host-tool.svelte'
export type {
  StructureToolProps,
  StructureToolRun,
  StructureToolOverlay,
  StructureToolVolume,
  StructureToolProvenance,
  StructureToolPrediction,
  StructureToolView,
  StructureToolViewProps,
} from './host-tool.svelte'
export * from './measure'
export * from './material'
export { StructureSession, type StructureSessionInputs } from './session.svelte'
export * from './pbc'
export * from './polyhedra'
export * from './export'
export * from './site'
export { default as Structure } from './Structure.svelte'
export type { StructureSettings, StructureOptions } from './settings'
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
export type StructurePane = `controls` | `info` | `export` | `flight`

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
  // Viewer-generated copies. Kept outside imported properties and preserved by cloning.
  provenance?: {
    image_of?: number
    unit_cell_idx?: number
    completion?: boolean
  }
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
  element_data.map((element) => [element.symbol, element.atomic_radius ?? 1]),
)

const atomic_masses = new Map(
  element_data.map(({ number, atomic_mass }) => [number, atomic_mass]),
)

export function get_center_of_mass(structure: AnyStructure): Vec3 {
  let [sum_x, sum_y, sum_z, total_weight] = [0, 0, 0, 0]
  const columns = numeric_sites.get(structure)
  if (columns) {
    const { numbers, coordinates, stride } = columns
    for (let idx = 0; idx < numbers.length; idx++) {
      const weight = atomic_masses.get(numbers[idx])
      if (weight === undefined)
        throw new Error(`Invalid atomic number ${numbers[idx]} at site ${idx}`)
      const offset = idx * stride
      sum_x += weight * coordinates[offset]
      sum_y += weight * coordinates[offset + 1]
      sum_z += weight * coordinates[offset + 2]
      total_weight += weight
    }
  } else
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

export * from './vectors'

export const RESET_VIEW_TITLE = `Reset view (r, or double-click)`

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
