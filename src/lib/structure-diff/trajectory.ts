// Structure diffs along a trajectory, read from a collected position stream: stepping reads no
// frames and rewrites one scratch reference in place instead of building structures per step.
// Frames share one atom order, so sites pair by index.
import type { Vec3 } from '#lib/math.js'
import type { AnyStructure } from '#lib/structure/index.js'
import type { TrajectoryMetadata, TrajectoryPositionStream } from '#lib/trajectory/index.js'
import { compute_structure_diff, type StructureDiffResult } from './compute'

// What each frame is compared against: the first collected frame or the one before it
export type DiffReference = `off` | `first` | `previous`

// A structure with the trajectory's sites whose positions and cell load_row rewrites (its
// fractional coordinates go stale: compute_structure_diff reads xyz only)
const scratch_structure = (template: AnyStructure, stream: TrajectoryPositionStream) => {
  if (template.sites.length !== stream.n_atoms) {
    throw new Error(
      `Frame has ${template.sites.length} sites but the position stream ${stream.n_atoms} atoms`,
    )
  }
  return {
    ...template,
    sites: template.sites.map((site) => ({ ...site, xyz: [0, 0, 0] as Vec3 })),
  }
}

// Collected frame `row` of `stream` written into `scratch`
function load_row(stream: TrajectoryPositionStream, row: number, scratch: AnyStructure) {
  const offset = row * stream.n_atoms * 3
  for (const [idx, { xyz }] of scratch.sites.entries()) {
    for (const axis of [0, 1, 2]) xyz[axis] = stream.positions[offset + idx * 3 + axis]
  }
  const matrix = stream.lattice_matrices?.[row]
  if (`lattice` in scratch && scratch.lattice && matrix) {
    scratch.lattice = { ...scratch.lattice, matrix }
  }
  return scratch
}

// Diffs the displayed frame against the first or previous collected frame of `stream`
// (`template` gives the sites). Null for the first frame in `previous` mode.
export function create_trajectory_differ(
  stream: TrajectoryPositionStream,
  template: AnyStructure,
) {
  const first = load_row(stream, 0, scratch_structure(template, stream))
  const previous = scratch_structure(template, stream)
  return (
    target: AnyStructure,
    frame_idx: number,
    reference: Exclude<DiffReference, `off`>,
    remove_drift: boolean,
  ): { diff: StructureDiffResult; reference_frame: number } | null => {
    // with a frame stride, the latest collected frame before this one
    const row = reference === `first` ? 0 : Math.floor((frame_idx - 1) / stream.frame_stride)
    if (row < 0) return null
    const reference_structure = row === 0 ? first : load_row(stream, row, previous)
    const diff = compute_structure_diff(reference_structure, target, {
      matching: `index`,
      remove_drift,
    })
    return { diff, reference_frame: row * stream.frame_stride }
  }
}

// RMSD of every collected frame against the first, as plot rows under the `rmsd` key
export function rmsd_rows(
  stream: TrajectoryPositionStream,
  template: AnyStructure,
  remove_drift: boolean,
): TrajectoryMetadata[] {
  const reference = load_row(stream, 0, scratch_structure(template, stream))
  const target = scratch_structure(template, stream)
  return stream.steps.map((step, row) => ({
    frame_number: row * stream.frame_stride,
    step,
    properties: {
      rmsd: compute_structure_diff(reference, load_row(stream, row, target), {
        matching: `index`,
        remove_drift,
      }).rmsd,
    },
  }))
}
