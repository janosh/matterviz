import {
  BondFrame,
  pack_bonds,
  prepare_bond_placements,
  type BondColumns,
  type BondPlacements,
} from '$lib/structure/bond-rendering'
import {
  compute_display_metrics,
  prepare_vector_geometry,
  type PreparedVectorGeometry,
  type VectorGeometrySettings,
} from '$lib/structure/vectors'
import { numeric_sites, type DisplayMetrics } from '$lib/structure/site'
import {
  compute_polyhedra,
  type PolyhedraOptions,
  type Polyhedron,
} from '$lib/structure/polyhedra'
// Display preparation travels with a frame through the existing source worker and prefetch.
// Source arrays remain independently owned; only this worker's scratch projection is mutable.
import { BondSearch, compute_bonds, type BondingStrategy } from '$lib/structure/bonding'
import {
  FrameView,
  frame_transfers,
  wrap_frame_coordinates,
  type NumericFrame,
  type FrameChannels,
} from './frame'

export type FramePreparation = {
  bonding_strategy: BondingStrategy
  bonding_options: Record<string, unknown>
  auto_bond_order?: boolean
  channels?: FrameChannels
  bonds?: boolean
  vector_geometry?: VectorGeometrySettings
  polyhedra?: PolyhedraOptions
}
export type DisplayFrame = {
  frame: NumericFrame
  preparation?: FramePreparation
  bonds?: BondColumns
  bond_placements?: BondPlacements
  metrics?: DisplayMetrics
  vector_geometry?: PreparedVectorGeometry
  polyhedra?: Polyhedron[]
}

// Decoder heaps and GPU resources are additional to this prepared-frame budget.
export const display_cache_budget = (): number => {
  const memory =
    typeof navigator !== `undefined` ? Reflect.get(navigator, `deviceMemory`) : undefined
  return (typeof memory === `number` && memory >= 16 ? 1024 : 512) * 1024 ** 2
}

// Worker transfer and cache accounting share one inventory of owned backing buffers.
export const display_frame_transfers = ({
  frame,
  bonds,
  bond_placements,
  metrics,
  vector_geometry,
}: DisplayFrame): ArrayBufferLike[] => [
  ...new Set([
    ...frame_transfers(frame),
    ...Object.values(bonds ?? {}).map((column) => column.buffer),
    ...(bond_placements
      ? [
          bond_placements.centers.buffer,
          bond_placements.deltas.buffer,
          bond_placements.sizes.buffer,
        ]
      : []),
    ...Object.values(metrics?.vector_magnitudes ?? {}).map(({ values }) => values.buffer),
    ...(vector_geometry?.layers.flatMap(({ site_indices, placements }) => [
      site_indices.buffer,
      placements.origins.buffer,
      placements.rotations.buffer,
      placements.lengths.buffer,
    ]) ?? []),
  ]),
]

// Include unused capacity; the session bounds materialized site records separately.
export const display_frame_bytes = (frame: DisplayFrame): number =>
  display_frame_transfers(frame).reduce((bytes, buffer) => bytes + buffer.byteLength, 0) +
  // Conservatively charge nested JS arrays and records as well as their numeric payload.
  (frame.polyhedra?.reduce(
    (bytes, poly) => bytes + 256 + poly.vertices.length * 96 + poly.faces.length * 64,
    0,
  ) ?? 0)

export class FramePreparer {
  private readonly view = new FrameView()
  private readonly search = new BondSearch()

  prepare(frame: NumericFrame, preparation: FramePreparation): DisplayFrame {
    frame = wrap_frame_coordinates(frame)
    const { structure } = this.view.update(frame)
    const metrics = compute_display_metrics(structure)
    const columns = numeric_sites.get(structure)
    if (columns) columns.display_metrics = metrics
    const display: DisplayFrame = { frame, preparation, metrics }
    if (columns && preparation.vector_geometry)
      display.vector_geometry = prepare_vector_geometry(structure, preparation.vector_geometry)
    if (preparation.bonds === false) return display
    const bonds =
      preparation.bonding_strategy === `electroneg_ratio` && !preparation.auto_bond_order
        ? this.search.compute_columns(structure, preparation.bonding_options)
        : pack_bonds(
            compute_bonds(
              structure,
              preparation.bonding_strategy,
              preparation.bonding_options,
            ),
          )
    const bond_frame = new BondFrame(structure, bonds)
    return {
      ...display,
      bonds,
      bond_placements: prepare_bond_placements(bond_frame),
      ...(preparation.polyhedra && {
        polyhedra: compute_polyhedra(structure, bond_frame, preparation.polyhedra),
      }),
    }
  }
}
