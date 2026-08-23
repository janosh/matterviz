// Kernels shared by every consumer of a flat frame-major position stream: MSD, VACF/VDOS,
// trajectory spectroscopy and the trajectory trails. Pure functions over Float64Array so Web
// Worker bundles can import them without dragging a component in.
import type { LatticeConverters, Matrix3x3, Vec3 } from '$lib/math'
import { create_lattice_converters, min_image_displacement_into } from '$lib/math'
import type { Pbc } from '$lib/structure'
import type { TrajectoryPositionStream } from './index'

// Map each atom onto a dense element-group slot so a single pass over atoms feeds every
// per-element curve. Callers reserve slot `labels.length` for the all-atom total.
export function group_atoms_by_element(elements: readonly string[]): {
  labels: string[]
  group_sizes: number[]
  atom_group: Int32Array
} {
  const labels: string[] = []
  const group_sizes: number[] = []
  const label_to_group = new Map<string, number>()
  const atom_group = Int32Array.from(elements, (label) => {
    let group = label_to_group.get(label)
    if (group === undefined) {
      group = labels.length
      label_to_group.set(label, group)
      labels.push(label)
      group_sizes.push(0)
    }
    group_sizes[group]++
    return group
  })
  return { labels, group_sizes, atom_group }
}

// Element-group slots in the order the analysis curves are reported: the all-atom total
// first, then one slot per element sorted by symbol — only for a mixture, since a lone
// species adds nothing over the total.
export const curve_slots = (labels: string[]): { label: string; slot: number }[] => {
  const slots = [{ label: `Total`, slot: labels.length }]
  if (labels.length > 1) {
    const by_label = [...labels.keys()].toSorted((left, right) =>
      labels[left].localeCompare(labels[right]),
    )
    for (const slot of by_label) slots.push({ label: labels[slot], slot })
  }
  return slots
}

// Turn per-frame WRAPPED Cartesian positions into a continuous unwrapped trajectory by
// accumulating minimum-image steps straight into a second flat buffer. Stays flat because
// a Vec3[][] round trip costs ~660 MB of nested arrays for a 96 MB buffer (2000 frames x
// 2000 atoms, measured), putting the module's own 512 MB collect budget out of reach. The
// kernel is still math's verified minimum-image search, over one reused scratch triple so
// the inner loop allocates nothing per atom-frame.
//
// CALLER BEWARE: the input must be wrapped coordinates. Feeding coordinates that are
// ALREADY unwrapped (e.g. a LAMMPS dump with xu/yu/zu columns, which the parser flags as
// `coords_unwrapped: true`) re-applies the minimum image convention and silently truncates
// every real displacement longer than half a cell — check that flag before calling this.
export function unwrap_flat_positions(
  positions: Float64Array,
  n_frames: number,
  n_atoms: number,
  lattice_matrices: (Matrix3x3 | null)[] | null,
  pbc: Pbc,
): Float64Array {
  const unwrapped = new Float64Array(positions.length)
  // Frame 0 is the reference and is copied verbatim
  unwrapped.set(positions.subarray(0, n_atoms * 3))
  const from: Vec3 = [0, 0, 0]
  const to: Vec3 = [0, 0, 0]
  const step: Vec3 = [0, 0, 0]
  // A fixed cell hands back the same matrix every frame; only NPT rebuilds the inverse.
  // Seeded from frame 0 because the loop starts at 1: without it, a null lattice at frame 1
  // has no cell to fall back on and takes the plain difference the fallback below exists to
  // avoid.
  let cached_lattice: Matrix3x3 | null = lattice_matrices?.[0] ?? null
  let converters: LatticeConverters | null = cached_lattice
    ? create_lattice_converters(cached_lattice)
    : null

  for (let frame_idx = 1; frame_idx < n_frames; frame_idx++) {
    const frame_lattice = lattice_matrices?.[frame_idx] ?? null
    if (frame_lattice && frame_lattice !== cached_lattice) {
      cached_lattice = frame_lattice
      converters = create_lattice_converters(frame_lattice)
    }
    // Carry the last known cell into frames whose own lattice is missing. A null entry
    // mid-trajectory is a parse gap, not a genuinely aperiodic frame: the neighbouring
    // frames ARE wrapped, so taking the plain coordinate difference there admits a jump
    // of up to one box length, and because the unwrap accumulates it corrupts every later
    // frame too. One null cell in a 21-frame run reported MSD 445 A^2 against a true 900.
    const lattice = frame_lattice ?? cached_lattice
    const prev_base = (frame_idx - 1) * n_atoms * 3
    const base = frame_idx * n_atoms * 3
    for (let atom_idx = 0; atom_idx < n_atoms; atom_idx++) {
      const prev_off = prev_base + atom_idx * 3
      const off = base + atom_idx * 3
      for (let axis = 0; axis < 3; axis++) {
        from[axis] = positions[prev_off + axis]
        to[axis] = positions[off + axis]
      }
      // Plain difference only before any cell has been seen - nothing was wrapped yet
      if (lattice && converters) {
        min_image_displacement_into(from, to, lattice, converters, pbc, step)
      } else {
        for (let axis = 0; axis < 3; axis++) step[axis] = to[axis] - from[axis]
      }
      for (let axis = 0; axis < 3; axis++) {
        unwrapped[off + axis] = unwrapped[prev_off + axis] + step[axis]
      }
    }
  }
  return unwrapped
}

// Unwrapping allocates a second copy of the whole trajectory, so it must not rerun every
// time the playhead moves or a second analysis reads the same stream. Keyed on the stream
// object: a new stream (new file, new stride) gets a fresh unwrap and the old buffer
// becomes collectable with its stream.
const unwrap_cache = new WeakMap<TrajectoryPositionStream, Float64Array>()

// Unwrapped coordinates of a stream, or the stream's own BY IDENTITY when nothing was ever
// folded (no lattice) or the parser already unwrapped them (LAMMPS xu/yu/zu) - re-applying
// the minimum image to those would truncate every real displacement beyond half a box, see
// the CALLER BEWARE note on unwrap_flat_positions. The second value says which happened,
// for the result summaries.
export const unwrapped_positions_of = (
  stream: TrajectoryPositionStream,
): { coords: Float64Array; unwrapped: boolean } => {
  const { positions, n_frames, n_atoms, lattice_matrices, coords_unwrapped, pbc } = stream
  const has_lattice = Boolean(lattice_matrices?.some((matrix) => matrix != null))
  if (coords_unwrapped || !has_lattice) return { coords: positions, unwrapped: false }
  let coords = unwrap_cache.get(stream)
  if (!coords) {
    coords = unwrap_flat_positions(
      positions,
      n_frames,
      n_atoms,
      lattice_matrices,
      pbc ?? [true, true, true],
    )
    unwrap_cache.set(stream, coords)
  }
  return { coords, unwrapped: true }
}

// Layout checks every lag analysis runs before touching the buffer, prefixed with the
// analysis name so the message says who raised it
export function validate_position_stream_layout(
  stream: TrajectoryPositionStream,
  analysis_name: string,
  min_frames: number,
): void {
  const fail = (message: string): never => {
    throw new Error(`${analysis_name}: ${message}`)
  }
  const { n_frames, n_atoms, positions, elements, lattice_matrices } = stream
  if (n_frames < min_frames) fail(`need at least ${min_frames} frames, got ${n_frames}`)
  if (n_atoms < 1) fail(`need at least 1 atom, got ${n_atoms}`)
  if (elements.length !== n_atoms) {
    fail(
      `got ${elements.length} element labels for ${n_atoms} atoms; atom order is the ` +
        `atom identity and must be one label per atom`,
    )
  }
  const expected_length = n_frames * n_atoms * 3
  if (positions.length !== expected_length) {
    fail(
      `positions has ${positions.length} entries but ${n_frames} frames x ${n_atoms} ` +
        `atoms x 3 requires ${expected_length}`,
    )
  }
  if (lattice_matrices && lattice_matrices.length !== n_frames) {
    fail(`got ${lattice_matrices.length} lattice matrices for ${n_frames} frames`)
  }
}

// The dt / time_unit contract shared by MSD and VACF: a run may not record a timestep, so a
// dt without a unit would mean inventing a time axis. Returns the unit to label axes with.
export function resolve_lag_time_unit(
  analysis_name: string,
  dt: number | undefined,
  time_unit: string | undefined,
  unit_example: string,
): string {
  if (dt !== undefined && !(dt > 0)) {
    throw new Error(`${analysis_name}: dt must be positive, got ${dt}`)
  }
  if (dt !== undefined && !time_unit) {
    throw new Error(
      `${analysis_name}: dt was supplied (${dt}) without time_unit; pass e.g. time_unit: ` +
        `'${unit_example}' so the lag axis carries real units`,
    )
  }
  if (dt !== undefined && time_unit === `frame`) {
    throw new Error(
      `${analysis_name}: time_unit 'frame' cannot be combined with dt; omit dt for a ` +
        `frame-based lag axis`,
    )
  }
  return time_unit ?? `frame`
}

// Evenly spaced lags in collected frames, capped by `max_lag_fraction` of the series length
export function lag_range(
  analysis_name: string,
  n_frames: number,
  max_lag_fraction: number,
): number {
  if (!(max_lag_fraction > 0) || max_lag_fraction > 1) {
    throw new Error(
      `${analysis_name}: max_lag_fraction must be in (0, 1], got ${max_lag_fraction}`,
    )
  }
  return Math.max(1, Math.floor((n_frames - 1) * max_lag_fraction))
}
