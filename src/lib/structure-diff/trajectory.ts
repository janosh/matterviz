// Structure diffs along a trajectory, read from a collected position stream: stepping reads no
// frames and rewrites one scratch reference in place instead of building structures per step.
// Frames share one atom order, so sites pair by index.
import type { Vec3 } from '#lib/math.js'
import type { AnyStructure } from '#lib/structure/index.js'
import type { TrajectoryMetadata, TrajectoryPositionStream } from '#lib/trajectory/index.js'
import { compute_structure_diff, type StructureDiffResult } from './compute'

// What each frame is compared against: the first collected frame or the one before it
export type DiffReference = `off` | `first` | `previous`

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

// Diffs along a trajectory's collected position stream (`template` gives the sites): `rows`,
// the RMSD of every collected frame against the first as plot rows under `rmsd`, and `frame`,
// the displayed frame against the first or the latest collected frame before it (a message
// for the first frame in `previous` mode)
export function trajectory_diffs(
  stream: TrajectoryPositionStream,
  template: AnyStructure,
  remove_drift: boolean,
) {
  if (template.sites.length !== stream.n_atoms) {
    throw new Error(
      `Frame has ${template.sites.length} sites but the position stream ${stream.n_atoms} atoms`,
    )
  }
  // structures with the trajectory's sites whose positions and cell load_row rewrites (their
  // fractional coordinates go stale: compute_structure_diff reads xyz only)
  const scratch_structure = (): AnyStructure => ({
    ...template,
    sites: template.sites.map((site) => ({ ...site, xyz: [0, 0, 0] as Vec3 })),
  })
  const first = load_row(stream, 0, scratch_structure())
  const scratch = scratch_structure()
  const diff = (reference: AnyStructure, target: AnyStructure) =>
    compute_structure_diff(reference, target, { matching: `index`, remove_drift })
  const rows: TrajectoryMetadata[] = stream.steps.map((step, row) => ({
    frame_number: row * stream.frame_stride,
    step,
    properties: { rmsd: diff(first, load_row(stream, row, scratch)).rmsd },
  }))
  const frame = (
    target: AnyStructure,
    frame_idx: number,
    reference: Exclude<DiffReference, `off`>,
  ): { diff: StructureDiffResult; reference_frame: number } | string => {
    const row = reference === `first` ? 0 : Math.floor((frame_idx - 1) / stream.frame_stride)
    if (row < 0) return `The first frame has no previous frame`
    const reference_structure = row === 0 ? first : load_row(stream, row, scratch)
    return {
      diff: diff(reference_structure, target),
      reference_frame: row * stream.frame_stride,
    }
  }
  return { rows, frame }
}
