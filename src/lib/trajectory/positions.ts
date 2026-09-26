// Kernels shared by every consumer of a flat frame-major position stream: MSD, VACF/VDOS,
// trajectory spectroscopy and the trajectory trails. Pure functions over Float64Array so Web
// Worker bundles can import them without dragging a component in.
import { fft_in_place, next_power_of_two } from '$lib/fft'
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
  const target: Vec3 = [0, 0, 0]
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
    if (converters && (pbc[0] || pbc[1] || pbc[2]) && is_diagonal(converters.lattice)) {
      unwrap_diagonal_frame(positions, unwrapped, base, prev_base, n_atoms, converters, pbc)
      continue
    }
    for (let atom_idx = 0; atom_idx < n_atoms; atom_idx++) {
      const prev_off = prev_base + atom_idx * 3
      const off = base + atom_idx * 3
      for (let axis = 0; axis < 3; axis++) {
        from[axis] = positions[prev_off + axis]
        target[axis] = positions[off + axis]
      }
      // Plain difference only before any cell has been seen - nothing was wrapped yet
      if (lattice && converters) {
        min_image_displacement_into(from, target, lattice, converters, pbc, step)
      } else {
        for (let axis = 0; axis < 3; axis++) step[axis] = target[axis] - from[axis]
      }
      for (let axis = 0; axis < 3; axis++) {
        unwrapped[off + axis] = unwrapped[prev_off + axis] + step[axis]
      }
    }
  }
  return unwrapped
}

const is_diagonal = ([[, ab, ac], [ba, , bc], [ca, cb]]: Matrix3x3): boolean =>
  ab === 0 && ac === 0 && ba === 0 && bc === 0 && ca === 0 && cb === 0

// One frame of unwrap_flat_positions for an orthogonal (diagonal) cell, the common MD box:
// min_image_displacement_into's diagonal branch inlined with the cell hoisted out of the atom
// loop: bit-identical to the generic path and ~2x faster (2000 frames x 2000 atoms: 206 ->
// 105 ms) without the per-atom scratch copies, cell-shape check and call.
function unwrap_diagonal_frame(
  positions: Float64Array,
  unwrapped: Float64Array,
  base: number,
  prev_base: number,
  n_atoms: number,
  { lattice, reciprocal }: LatticeConverters,
  [wrap_a, wrap_b, wrap_c]: Pbc,
): void {
  const inv_a = reciprocal[0][0]
  const inv_b = reciprocal[1][1]
  const inv_c = reciprocal[2][2]
  const len_a = lattice[0][0]
  const len_b = lattice[1][1]
  const len_c = lattice[2][2]
  for (let offset = 0; offset < n_atoms * 3; offset += 3) {
    const off = base + offset
    const prev = prev_base + offset
    const frac_a = inv_a * (positions[off] - positions[prev])
    const frac_b = inv_b * (positions[off + 1] - positions[prev + 1])
    const frac_c = inv_c * (positions[off + 2] - positions[prev + 2])
    if (!Number.isFinite(frac_a + frac_b + frac_c)) {
      throw new TypeError(
        `Minimum-image displacement is non-finite: from=[${positions.subarray(prev, prev + 3)}], ` +
          `target=[${positions.subarray(off, off + 3)}], fractional=[${frac_a}, ${frac_b}, ${frac_c}]`,
      )
    }
    // `+ 0` matches the positive zero min_image_displacement_into returns
    unwrapped[off] =
      unwrapped[prev] + ((wrap_a ? frac_a - Math.round(frac_a) : frac_a) * len_a + 0)
    unwrapped[off + 1] =
      unwrapped[prev + 1] + ((wrap_b ? frac_b - Math.round(frac_b) : frac_b) * len_b + 0)
    unwrapped[off + 2] =
      unwrapped[prev + 2] + ((wrap_c ? frac_c - Math.round(frac_c) : frac_c) * len_c + 0)
  }
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
  const fail = analysis_fail(analysis_name)
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

// Guard thrower that prefixes every message with the analysis raising it, so most guards
// stay on one line
export const analysis_fail =
  (analysis_name: string) =>
  (message: string): never => {
    throw new Error(`${analysis_name}: ${message}`)
  }

// Axis label of a lag axis in `time_unit` (as returned by resolve_lag_time_unit)
export const lag_axis_label = (time_unit: string): string =>
  time_unit === `frame` ? `Lag (frames)` : `Lag time (${time_unit})`

// The dt / time_unit contract shared by MSD and VACF: a run may not record a timestep, so a
// dt without a unit would mean inventing a time axis. Returns the unit to label axes with.
export function resolve_lag_time_unit(
  analysis_name: string,
  delta_time: number | undefined,
  time_unit: string | undefined,
  unit_example: string,
): string {
  if (delta_time !== undefined && !(delta_time > 0)) {
    throw new Error(`${analysis_name}: dt must be positive, got ${delta_time}`)
  }
  if (delta_time !== undefined && !time_unit) {
    throw new Error(
      `${analysis_name}: dt was supplied (${delta_time}) without time_unit; pass e.g. time_unit: ` +
        `'${unit_example}' so the lag axis carries real units`,
    )
  }
  // The converse: a unit without dt would label frame lags as e.g. ps and derive D / THz
  // from an implied dt of 1 unit per frame
  if (delta_time === undefined && time_unit !== undefined && time_unit !== `frame`) {
    throw new Error(
      `${analysis_name}: time_unit '${time_unit}' was supplied without dt; pass the time per ` +
        `collected frame as dt, or omit time_unit for a frame-based lag axis`,
    )
  }
  if (delta_time !== undefined && time_unit === `frame`) {
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

// Per-group sums over atoms and time origins of x(t) . x(t + lag), for lags 0..max_lag, of a
// flat frame-major vec3 series (velocities for the VACF, positions for the MSD). Slot
// `n_groups` is the all-atom total. `offsets` (one per component, frame-independent) is
// subtracted from every sample first (the MSD centres each coordinate on its mean).
//
// One forward FFT per PAIR of components accumulates their |X(f)|^2 into the group's power
// spectrum; one inverse FFT per group then yields the autocorrelation sums. Forward and
// inverse coincide up to 1/n_fft here because a power spectrum is real and even.
export function autocorrelation_sums(
  series: Float64Array,
  n_frames: number,
  n_atoms: number,
  atom_group: Int32Array,
  n_groups: number,
  max_lag: number,
  offsets: Float64Array | null = null,
): Float64Array[] {
  // >= n_frames + max_lag so no circular wrap reaches a lag we keep: the padded series'
  // circular correlation equals the linear one up to max_lag. Padding to 2 n_frames instead
  // doubled the FFT length (and cost) for the default half-length lag windows.
  const n_fft = next_power_of_two(n_frames + max_lag)
  const real = new Float64Array(n_fft)
  const imaginary = new Float64Array(n_fft)
  const power = Array.from({ length: n_groups }, () => new Float64Array(n_fft))
  const frame_size = n_atoms * 3
  // Component offsets within a frame, bucketed by group, so two components of the same
  // group can share one complex transform
  const group_components = Array.from({ length: n_groups }, (): number[] => [])
  for (let atom_idx = 0; atom_idx < n_atoms; atom_idx++) {
    for (let axis = 0; axis < 3; axis++) {
      group_components[atom_group[atom_idx]].push(atom_idx * 3 + axis)
    }
  }
  for (const [group, components] of group_components.entries()) {
    const group_power = power[group]
    for (let pair_idx = 0; pair_idx < components.length; pair_idx += 2) {
      // Two real series a, b packed as z = a + i b: with Z(k) their joint transform,
      // |A(k)|^2 + |B(k)|^2 = (|Z(k)|^2 + |Z(-k)|^2) / 2, which halves the FFT count. An
      // unpaired last component leaves b = 0, where the identity reduces to |Z(k)|^2.
      const first = components[pair_idx]
      const second = pair_idx + 1 < components.length ? components[pair_idx + 1] : null
      const first_offset = offsets?.[first] ?? 0
      const second_offset = second === null ? 0 : (offsets?.[second] ?? 0)
      real.fill(0)
      imaginary.fill(0)
      for (let frame_idx = 0; frame_idx < n_frames; frame_idx++) {
        real[frame_idx] = series[frame_idx * frame_size + first] - first_offset
        if (second !== null) {
          imaginary[frame_idx] = series[frame_idx * frame_size + second] - second_offset
        }
      }
      fft_in_place(real, imaginary)
      for (let bin = 0; bin < n_fft; bin++) {
        const mirror = bin === 0 ? 0 : n_fft - bin
        group_power[bin] +=
          (real[bin] ** 2 + imaginary[bin] ** 2 + real[mirror] ** 2 + imaginary[mirror] ** 2) /
          2
      }
    }
  }
  // A lone species IS the total, so its sums are copied instead of transformed a second time
  if (n_groups > 1) {
    const total_power = new Float64Array(n_fft)
    for (const group_power of power) {
      for (let bin = 0; bin < n_fft; bin++) total_power[bin] += group_power[bin]
    }
    power.push(total_power)
  }
  const sums = power.map((group_power) => {
    imaginary.fill(0)
    fft_in_place(group_power, imaginary)
    const group_sums = new Float64Array(max_lag + 1)
    for (let lag = 0; lag <= max_lag; lag++) group_sums[lag] = group_power[lag] / n_fft
    return group_sums
  })
  if (n_groups === 1) sums.push(sums[0].slice())
  return sums
}
