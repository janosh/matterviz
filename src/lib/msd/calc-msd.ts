// Mean squared displacement (MSD) and Einstein diffusion analysis for MD trajectories.
//
// MSD(Δt) = <|r(t0 + Δt) − r(t0)|²> averaged over every atom AND every time origin t0.
// Longer lags have fewer origins, so `n_origins` and `std_error` are reported per lag
// and callers are expected to show that the tail is statistically weak.
import type { LatticeConverters, Matrix3x3, Vec3 } from '$lib/math'
import { create_lattice_converters, min_image_displacement } from '$lib/math'
import type { Pbc } from '$lib/structure'
import type {
  EinsteinFit,
  EinsteinFitOptions,
  MsdCurve,
  MsdOptions,
  MsdPositions,
  MsdResult,
} from './index'

// Guard helper: prefixes every message with the function that raised it, so no call
// site has to repeat the name and most guards stay on one line
const make_fail =
  (fn_name: string) =>
  (message: string): never => {
    throw new Error(`${fn_name}: ${message}`)
  }

// Ordinary least squares of msd against time over the requested lag window.
// Returns null (not a widened window) when the window holds fewer than 2 points —
// callers must surface that rather than quietly fitting something else.
export function fit_einstein_diffusion(
  lags: number[],
  times: number[],
  msd: number[],
  options: EinsteinFitOptions & { time_unit?: string } = {},
): EinsteinFit | null {
  // Default window skips the ballistic rise and the origin-starved tail
  const {
    start_fraction = 0.2,
    end_fraction = 0.8,
    dimensionality = 3,
    time_unit = `frame`,
  } = options
  const fail = make_fail(`fit_einstein_diffusion`)
  if (dimensionality <= 0) fail(`dimensionality must be positive, got ${dimensionality}`)
  if (start_fraction >= end_fraction) {
    fail(`start_fraction (${start_fraction}) must be below end_fraction (${end_fraction})`)
  }
  if (lags.length !== times.length || lags.length !== msd.length) {
    fail(
      `lags (${lags.length}), times (${times.length}) and msd (${msd.length}) must ` +
        `be the same length`,
    )
  }
  if (lags.length === 0) return null

  const max_lag = lags[lags.length - 1]
  const [lo, hi] = [start_fraction * max_lag, end_fraction * max_lag]
  const picked = [...lags.keys()].filter((idx) => lags[idx] >= lo && lags[idx] <= hi)
  if (picked.length < 2) return null

  const mean_of = (values: number[]) =>
    picked.reduce((sum, idx) => sum + values[idx], 0) / picked.length
  const [mean_x, mean_y] = [mean_of(times), mean_of(msd)]

  let [sxx, sxy, syy] = [0, 0, 0]
  for (const idx of picked) {
    const dx = times[idx] - mean_x
    const dy = msd[idx] - mean_y
    sxx += dx * dx
    sxy += dx * dy
    syy += dy * dy
  }
  if (sxx === 0) return null

  const slope = sxy / sxx
  const intercept = mean_y - slope * mean_x
  // R² = 1 for a perfectly flat MSD too (syy == 0 means every residual is 0).
  // The squared ratio cannot go negative, so only the upper clamp is reachable.
  const r_squared = syy === 0 ? 1 : Math.min(1, (sxy * sxy) / (sxx * syy))

  return {
    diffusion_coefficient: slope / (2 * dimensionality),
    slope,
    intercept,
    r_squared,
    lag_window: [lags[picked[0]], lags[picked[picked.length - 1]]],
    n_points: picked.length,
    dimensionality,
    units: `Å²/${time_unit}`,
  }
}

// One Welford step for slot `idx` of a running mean / sum-of-squared-deviations pair.
// `count` is the sample number including this one. Exported for $lib/vacf, which averages
// its own per-origin samples the same way.
export const welford_update = (
  mean: Float64Array,
  m2: Float64Array,
  idx: number,
  count: number,
  value: number,
): void => {
  const delta = value - mean[idx]
  mean[idx] += delta / count
  m2[idx] += delta * (value - mean[idx])
}

// Map each atom onto a dense element-group slot so a single pass over atoms feeds every
// per-element curve. Callers reserve slot `labels.length` for the all-atom total.
// Exported for $lib/vacf, which groups the same atoms for its own curves.
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

// Accumulate minimum-image steps straight into a second flat buffer. math.unwrap_positions
// is the same algorithm but takes Vec3[][]; inflating the flat buffer into that shape and
// back costs ~660 MB of nested arrays for a 96 MB buffer (2000 frames x 2000 atoms,
// measured), putting the module's own 512 MB collect budget out of reach. The kernel is
// still math's verified min_image_displacement, driven over one reused scratch pair.
// Exported for $lib/vacf, which differentiates the same unwrapped coordinates, and for
// trajectory lines, which draws them.
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
    // frame too. One null cell in a 21-frame run reported MSD 445 Å² against a true 900.
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
      const step =
        lattice && converters
          ? min_image_displacement(from, to, lattice, converters, pbc)
          : [to[0] - from[0], to[1] - from[1], to[2] - from[2]]
      for (let axis = 0; axis < 3; axis++) {
        unwrapped[off + axis] = unwrapped[prev_off + axis] + step[axis]
      }
    }
  }
  return unwrapped
}

export function calc_msd(input: MsdPositions, options: MsdOptions = {}): MsdResult {
  const { positions, n_frames, n_atoms, elements, lattice_matrices, coords_unwrapped } = input
  const {
    dt = 1,
    time_unit: requested_time_unit,
    max_lag_fraction = 0.5,
    // Cap on the number of distinct lags evaluated before lag sub-sampling kicks in
    max_lags = 200,
    // Rough (origin x atom) operation budget used to auto-tune `origin_stride`
    work_budget = 2e8,
    fit: fit_options = {},
  } = options

  const fail = make_fail(`calc_msd`)
  if (n_frames < 2) fail(`need at least 2 frames to form a lag, got ${n_frames}`)
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
  if (!(dt > 0)) fail(`dt must be positive, got ${dt}`)
  // Nothing in TrajectoryType records a timestep, so a dt without a unit would mean
  // inventing a time axis. Demand the unit instead of guessing one.
  if (options.dt !== undefined && !requested_time_unit) {
    fail(
      `dt was supplied (${options.dt}) without time_unit; pass e.g. time_unit: 'ps' ` +
        `so the axis and diffusion coefficient carry real units`,
    )
  }
  if (!(max_lag_fraction > 0) || max_lag_fraction > 1) {
    fail(`max_lag_fraction must be in (0, 1], got ${max_lag_fraction}`)
  }
  if (lattice_matrices && lattice_matrices.length !== n_frames) {
    fail(`got ${lattice_matrices.length} lattice matrices for ${n_frames} frames`)
  }

  // Honour the parser's already-unwrapped flag: re-applying the minimum image
  // convention to LAMMPS xu/yu/zu coordinates silently truncates real displacements.
  const has_lattice = Boolean(lattice_matrices?.some((matrix) => matrix != null))
  const should_unwrap = !coords_unwrapped && !options.skip_unwrap && has_lattice
  // The collected stream carries the cell's own pbc flags; ignoring them folds real
  // displacements along a slab's free axis back into the box (36 A² reported as 16).
  const pbc = options.pbc ?? input.pbc ?? [true, true, true]
  const coords = should_unwrap
    ? unwrap_flat_positions(positions, n_frames, n_atoms, lattice_matrices, pbc)
    : positions

  const max_lag = Math.max(1, Math.floor((n_frames - 1) * max_lag_fraction))
  const lag_stride = options.lag_stride ?? Math.max(1, Math.ceil(max_lag / max_lags))
  // Fractional strides would index the flat buffer at non-integer frame offsets
  if (!Number.isInteger(lag_stride) || lag_stride < 1) {
    fail(`lag_stride must be a positive integer, got ${lag_stride}`)
  }
  // Evenly spaced lags 1..max_lag, thinned so at most `max_lags` are evaluated
  const lags: number[] = []
  for (let lag = lag_stride; lag <= max_lag; lag += lag_stride) lags.push(lag)
  if (lags.length === 0) {
    fail(`lag_stride ${lag_stride} exceeds the maximum lag ${max_lag}; no lags to evaluate`)
  }

  // Auto-tune origin sub-sampling so a 100k-frame run stays interactive. The chosen
  // stride is reported in the result so a thinned average is never mistaken for a full one.
  const unstrided_work = lags.reduce((total, lag) => total + (n_frames - lag) * n_atoms, 0)
  const origin_stride =
    options.origin_stride ?? Math.max(1, Math.ceil(unstrided_work / work_budget))
  if (!Number.isInteger(origin_stride) || origin_stride < 1) {
    fail(`origin_stride must be a positive integer, got ${origin_stride}`)
  }

  // The total curve is the atom-count weighted combination of the element curves
  const { labels, group_sizes, atom_group } = group_atoms_by_element(elements)
  const n_groups = labels.length

  // Per-lag Welford accumulators over time origins. The naive sum/sum-of-squares form
  // loses the whole variance to cancellation when every origin agrees (a ballistic run
  // reports ~sqrt(eps) * msd instead of 0), so track the running mean and M2 instead.
  // Slot n_groups is the all-atom total, so one loop feeds every curve.
  const curve_sizes = [...group_sizes, n_atoms]
  const mean_msd = Array.from(curve_sizes, () => new Float64Array(lags.length))
  const m2_msd = Array.from(curve_sizes, () => new Float64Array(lags.length))
  const origin_counts = new Int32Array(lags.length)
  const origin_sums = new Float64Array(curve_sizes.length)

  for (let lag_idx = 0; lag_idx < lags.length; lag_idx++) {
    const lag = lags[lag_idx]
    const last_origin = n_frames - 1 - lag
    let n_origins = 0
    for (let origin = 0; origin <= last_origin; origin += origin_stride) {
      origin_sums.fill(0)
      const base_from = origin * n_atoms * 3
      const base_to = (origin + lag) * n_atoms * 3
      for (let atom_idx = 0; atom_idx < n_atoms; atom_idx++) {
        const off_from = base_from + atom_idx * 3
        const off_to = base_to + atom_idx * 3
        const dx = coords[off_to] - coords[off_from]
        const dy = coords[off_to + 1] - coords[off_from + 1]
        const dz = coords[off_to + 2] - coords[off_from + 2]
        origin_sums[atom_group[atom_idx]] += dx * dx + dy * dy + dz * dz
      }
      n_origins++
      let total_for_origin = 0
      for (let group = 0; group < n_groups; group++) total_for_origin += origin_sums[group]
      origin_sums[n_groups] = total_for_origin
      for (const [slot, size] of curve_sizes.entries()) {
        welford_update(
          mean_msd[slot],
          m2_msd[slot],
          lag_idx,
          n_origins,
          origin_sums[slot] / size,
        )
      }
    }
    origin_counts[lag_idx] = n_origins
  }

  const time_unit = requested_time_unit ?? `frame`
  const times = lags.map((lag) => lag * dt)

  const make_curve = (label: string, slot: number): MsdCurve => {
    const msd = Array.from(mean_msd[slot])
    const m2 = m2_msd[slot]
    // Standard error of the mean over (overlapping, hence correlated) time origins.
    // Welford's m2 is a sum of squared deviations, so the unbiased sample variance
    // divides by count - 1; using count under-reports by 41% at the n = 2 tail.
    const std_error = Array.from(origin_counts, (count, lag_idx) =>
      count < 2 ? 0 : Math.sqrt(m2[lag_idx] / (count - 1) / count),
    )
    return {
      label,
      n_atoms: curve_sizes[slot],
      msd,
      std_error,
      // A fresh array per curve: callers mutating one must not corrupt the others
      n_origins: Array.from(origin_counts),
      fit: fit_einstein_diffusion(lags, times, msd, { ...fit_options, time_unit }),
    }
  }

  const curves: MsdCurve[] = [make_curve(`Total`, n_groups)]
  // A lone species adds nothing over the total, so only a mixture gets element curves
  if (n_groups > 1) {
    const by_label = [...labels.keys()].toSorted((left, right) =>
      labels[left].localeCompare(labels[right]),
    )
    for (const slot of by_label) curves.push(make_curve(labels[slot], slot))
  }

  return {
    lags,
    times,
    curves,
    dt,
    time_unit,
    x_label: time_unit === `frame` ? `Lag (frames)` : `Lag time (${time_unit})`,
    n_frames,
    n_atoms,
    unwrapped: should_unwrap,
    lag_stride,
    origin_stride,
    frame_stride: input.frame_stride,
  }
}
