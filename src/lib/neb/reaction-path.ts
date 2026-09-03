// Reaction-coordinate, barrier and cubic-interpolation math for NEB paths.
//
// The interpolant is a piecewise cubic Hermite curve; the two supported methods differ
// only in where the knot slopes dE/ds come from:
//   `force-hermite` — slopes from the forces projected on the path tangent, the standard
//                     NEB construction (Henkelman & Jónsson, JCP 113, 9978).
//   `natural-cubic` — slopes from a natural cubic spline through the energies alone, used
//                     when forces are unavailable.
// The fitted saddle is the maximum of the continuous curve and generally sits BETWEEN
// images; it is reported separately from the highest computed image, since quoting the
// interpolated value as if it were a computed image is a common reporting error.

import type { LatticeConverters, Vec3 } from '$lib/math'
import { clamp, create_lattice_converters, min_image_displacement } from '$lib/math'
import type { AnyStructure } from '$lib/structure'
import type { Pbc } from '$lib/structure/pbc'
import type {
  NamedReactionPath,
  NebImage,
  PathMetricOptions,
  ReactionCoordOptions,
  ReactionPath,
  ReactionPathInput,
} from './index'

// Index of the largest value; ties go to the first, as a forward scan would.
const arg_max = (values: readonly number[]): number =>
  values.reduce((best, val, idx) => (val > values[best] ? idx : best), 0)

// Images of a path, or the array itself when given bare images.
const path_images = (path: ReactionPath | NebImage[]): NebImage[] =>
  Array.isArray(path) ? path : path.images

export const path_energy_unit = (path: ReactionPath | NebImage[]): string =>
  (Array.isArray(path) ? undefined : path.energy_unit) ?? `eV`

const is_single_path = (input: ReactionPathInput): input is ReactionPath =>
  Array.isArray((input as ReactionPath).images)

// Flatten any accepted input shape into an ordered list of keyed paths.
export function normalize_paths(input: ReactionPathInput): NamedReactionPath[] {
  if (Array.isArray(input)) return [{ key: `path 1`, path: { images: input } }]
  if (is_single_path(input)) return [{ key: input.label ?? `path 1`, path: input }]
  const entries = Object.entries(input)
  if (entries.length === 0) {
    throw new Error(`normalize_paths got an empty record of reaction paths`)
  }
  return entries.map(([key, value]) => ({
    key,
    path: Array.isArray(value) ? { images: value } : value,
  }))
}

// A reaction path needs at least an initial and a final state; anything less has no
// coordinate, no barrier and no reaction energy, so fail loudly instead of yielding NaN.
export function assert_path(
  path: ReactionPath | NebImage[],
  context = `reaction path`,
): NebImage[] {
  const images = path_images(path)
  if (images.length < 2) {
    throw new Error(
      `${context} needs at least 2 images (initial and final state), got ${images.length}`,
    )
  }
  for (const [idx, image] of images.entries()) {
    if (typeof image.energy !== `number` || !Number.isFinite(image.energy)) {
      throw new TypeError(`${context} image ${idx} has non-finite energy ${image.energy}`)
    }
    if (!image.structure?.sites?.length) {
      throw new Error(`${context} image ${idx} has no structure sites`)
    }
  }
  return images
}

// Cached lattice geometry so a whole path is walked with one matrix inversion; null means
// raw Cartesian differences (no lattice, or `metric: cartesian`, which is only meaningful
// when no atom crosses a cell boundary).
type PathGeometry = { converters: LatticeConverters; pbc: Pbc } | null

function path_geometry(
  reference: AnyStructure,
  options: PathMetricOptions = {},
): PathGeometry {
  if (options.metric === `cartesian` || !(`lattice` in reference)) return null
  return {
    converters: create_lattice_converters(reference.lattice.matrix),
    pbc: options.pbc ?? reference.lattice.pbc,
  }
}

// Per-atom displacement vectors taking every atom by its shortest route.
function image_displacements(
  from: AnyStructure,
  to: AnyStructure,
  geometry: PathGeometry,
): Vec3[] {
  if (from.sites.length !== to.sites.length) {
    throw new Error(
      `image_displacements: image site counts differ (${from.sites.length} vs ${to.sites.length}); ` +
        `reaction-path images must contain the same atoms in the same order`,
    )
  }
  return from.sites.map(({ xyz }, site_idx) => {
    const target = to.sites[site_idx].xyz
    if (!geometry) return [target[0] - xyz[0], target[1] - xyz[1], target[2] - xyz[2]]
    const { converters, pbc } = geometry
    return min_image_displacement(xyz, target, converters.lattice, converters, pbc)
  })
}

// Euclidean norm of a 3N vector held as one Vec3 per atom.
const rss_norm = (vectors: readonly Vec3[]): number =>
  Math.sqrt(vectors.reduce((sum, vec) => sum + vec[0] ** 2 + vec[1] ** 2 + vec[2] ** 2, 0))

// Reaction coordinate of every image. `arc_length` (default) accumulates the
// configuration-space distance between consecutive images, so unevenly spaced images
// land where they physically belong; `image_index` returns the bare bead numbers.
export function reaction_coordinate(
  path: ReactionPath | NebImage[],
  options: ReactionCoordOptions = {},
): number[] {
  const images = assert_path(path, `reaction_coordinate`)
  if (options.mode === `image_index`) return images.map((_image, idx) => idx)

  const geometry = path_geometry(images[0].structure, options)
  const coords = [0]
  for (const [idx, image] of images.slice(1).entries()) {
    const step = image_displacements(images[idx].structure, image.structure, geometry)
    coords.push(coords[idx] + rss_norm(step))
  }
  return coords
}

export type BarrierAnalysis = {
  initial_energy: number
  final_energy: number
  // Index of the highest computed image — the transition state as sampled by NEB.
  ts_image_idx: number
  ts_energy: number
  ts_coordinate: number
  // Uphill from the initial state to the highest image.
  forward_barrier: number
  // Uphill from the final state to the highest image.
  reverse_barrier: number
  // Endpoint difference. Algebraically identical to forward_barrier - reverse_barrier;
  // in IEEE-754 the two differ by a few ulps, so compare them with a tolerance.
  reaction_energy: number
  energy_unit: string
}

// Barrier arithmetic from the computed images only (no interpolation). `coords` are the
// images' reaction coordinates; pass them when already computed (path_profile does) so the
// path metric is evaluated once.
export function analyze_barrier(
  path: ReactionPath | NebImage[],
  options: ReactionCoordOptions = {},
  coords: readonly number[] = reaction_coordinate(path, options),
): BarrierAnalysis {
  const energies = assert_path(path, `analyze_barrier`).map((image) => image.energy)
  const ts_image_idx = arg_max(energies)
  const [initial_energy, final_energy] = [energies[0], energies[energies.length - 1]]
  const ts_energy = energies[ts_image_idx]

  return {
    initial_energy,
    final_energy,
    ts_image_idx,
    ts_energy,
    ts_coordinate: coords[ts_image_idx],
    forward_barrier: ts_energy - initial_energy,
    reverse_barrier: ts_energy - final_energy,
    reaction_energy: final_energy - initial_energy,
    energy_unit: path_energy_unit(path),
  }
}

// Unit tangent of the path at each image, as a 3N vector flattened per atom.
// Central differences inside, one-sided at the endpoints.
function path_tangents(images: NebImage[], geometry: PathGeometry): Vec3[][] {
  return images.map((image, image_idx) => {
    const left = images[Math.max(0, image_idx - 1)].structure
    const right = images[Math.min(images.length - 1, image_idx + 1)].structure
    const raw = image_displacements(left, right, geometry)
    const norm = rss_norm(raw)
    if (norm === 0) {
      throw new Error(
        `Image ${image_idx} (${image.label ?? `unlabelled`}) has a zero-length path tangent; ` +
          `neighbouring images are identical, so dE/ds is undefined`,
      )
    }
    return raw.map((vec): Vec3 => [vec[0] / norm, vec[1] / norm, vec[2] / norm])
  })
}

// dE/ds at each image from the forces projected on the path tangent: dE/ds = -F·τ̂.
// Returns null when any image lacks forces, so callers can drop to a plain cubic.
export function projected_force_slopes(
  path: ReactionPath | NebImage[],
  options: PathMetricOptions = {},
): number[] | null {
  const images = assert_path(path, `projected_force_slopes`)
  if (!images.every((image) => image.forces)) return null

  const tangents = path_tangents(images, path_geometry(images[0].structure, options))
  return images.map((image, image_idx) => {
    const forces = image.forces
    if (!forces) throw new Error(`Image ${image_idx} unexpectedly lost its forces`)
    if (forces.length !== image.structure.sites.length) {
      throw new Error(
        `Image ${image_idx} has ${forces.length} force vectors for ${image.structure.sites.length} sites`,
      )
    }
    const tangent = tangents[image_idx]
    let projection = 0
    for (const [atom_idx, force] of forces.entries()) {
      const tau = tangent[atom_idx]
      projection += force[0] * tau[0] + force[1] * tau[1] + force[2] * tau[2]
    }
    return -projection
  })
}

// === Piecewise cubic interpolation ===

// Validate a strictly increasing knot sequence and return the interval widths.
function knot_widths(xs: readonly number[], ys: readonly number[]): number[] {
  if (xs.length !== ys.length) {
    throw new Error(
      `Spline needs matching x/y lengths, got ${xs.length} x-values and ${ys.length} y-values`,
    )
  }
  if (xs.length < 2) throw new Error(`Spline needs at least 2 knots, got ${xs.length}`)
  return xs.slice(1).map((next, idx) => {
    if (!(next - xs[idx] > 0)) {
      throw new Error(
        `Spline knots must strictly increase, got x[${idx}]=${xs[idx]} and x[${
          idx + 1
        }]=${next}`,
      )
    }
    return next - xs[idx]
  })
}

// Knot slopes of the natural cubic spline (zero curvature at both ends) through (xs, ys).
export function natural_cubic_slopes(xs: readonly number[], ys: readonly number[]): number[] {
  const widths = knot_widths(xs, ys)
  const n_knots = xs.length
  // Second derivatives, zero at both ends by the natural boundary condition
  const curvature = Array.from<number>({ length: n_knots }).fill(0)

  // Thomas algorithm over the interior rows. The system is strictly diagonally dominant
  // (diagonal 2(h_left + h_right) against off-diagonals h_left + h_right, both positive),
  // so no pivot can vanish and no pivoting is needed.
  const n_interior = n_knots - 2
  const c_prime = Array.from<number>({ length: n_interior }).fill(0)
  const d_prime = Array.from<number>({ length: n_interior }).fill(0)
  for (let row = 0; row < n_interior; row++) {
    const [left, right] = [widths[row], widths[row + 1]]
    const rhs = 6 * ((ys[row + 2] - ys[row + 1]) / right - (ys[row + 1] - ys[row]) / left)
    const denom = 2 * (left + right) - (row > 0 ? left * c_prime[row - 1] : 0)
    c_prime[row] = right / denom
    d_prime[row] = (rhs - (row > 0 ? left * d_prime[row - 1] : 0)) / denom
  }
  for (let row = n_interior - 1; row >= 0; row--) {
    curvature[row + 1] = d_prime[row] - c_prime[row] * curvature[row + 2]
  }

  const slopes = widths.map(
    (width, knot) =>
      (ys[knot + 1] - ys[knot]) / width -
      (width * (2 * curvature[knot] + curvature[knot + 1])) / 6,
  )
  const last = n_knots - 1
  const width = widths[last - 1]
  slopes.push(
    (ys[last] - ys[last - 1]) / width +
      (width * (curvature[last - 1] + 2 * curvature[last])) / 6,
  )
  return slopes
}

// Cubic Hermite basis evaluated on a unit interval; `m0`/`m1` are tangents in t-space.
const hermite = (p0: number, p1: number, m0: number, m1: number, t_val: number): number => {
  const t_sq = t_val * t_val
  const t_cu = t_sq * t_val
  return (
    (2 * t_cu - 3 * t_sq + 1) * p0 +
    (t_cu - 2 * t_sq + t_val) * m0 +
    (-2 * t_cu + 3 * t_sq) * p1 +
    (t_cu - t_sq) * m1
  )
}

// Interior critical points of one Hermite segment, as t-values in (0, 1).
function segment_critical_points(p0: number, p1: number, m0: number, m1: number): number[] {
  // d/dt of the Hermite cubic is the quadratic quad_a·t² + quad_b·t + quad_c
  const quad_a = 6 * p0 - 6 * p1 + 3 * m0 + 3 * m1
  const quad_b = -6 * p0 + 6 * p1 - 4 * m0 - 2 * m1
  const quad_c = m0
  const in_range = (t_val: number) => t_val > 0 && t_val < 1
  if (quad_a === 0) return quad_b === 0 ? [] : [-quad_c / quad_b].filter(in_range)
  const discriminant = quad_b * quad_b - 4 * quad_a * quad_c
  if (discriminant < 0) return []
  const sqrt_disc = Math.sqrt(discriminant)
  const roots = [(-quad_b + sqrt_disc) / (2 * quad_a), (-quad_b - sqrt_disc) / (2 * quad_a)]
  return roots.filter(in_range)
}

export type PathSpline = {
  method: `force-hermite` | `natural-cubic`
  // Densely sampled curve for plotting.
  coords: number[]
  energies: number[]
  // dE/ds at each image, in energy_unit / Å.
  knot_slopes: number[]
  // Maximum of the fitted curve — the interpolated saddle. `between_images` are the
  // indices bracketing it, the same index twice when the maximum lands on an image.
  fitted_max: { coord: number; energy: number; between_images: [number, number] }
  // Highest actually computed image. Never conflate with `fitted_max`.
  highest_image: { idx: number; coord: number; energy: number }
  // True when the fitted saddle coincides with an image rather than lying between two.
  saddle_at_image: boolean
}

// Fit a cubic through the image energies and locate the interpolated saddle exactly.
// The knots themselves are candidates, so `fitted_max.energy >= max(energies)` always
// holds. `slopes` (dE/ds per knot) selects the force-projected Hermite spline; without
// them a natural cubic through the energies supplies the slopes instead.
export function fit_path_spline(
  coords: readonly number[],
  energies: readonly number[],
  options: {
    slopes?: readonly number[]
    n_samples?: number
    // Run each supplied slope is measured against, per segment (the segment's arc length when
    // `slopes` are dE/ds). Defaults to the coord widths, identical when coords are arc lengths.
    slope_widths?: readonly number[]
  } = {},
): PathSpline {
  const widths = knot_widths(coords, energies)
  const { slopes: given_slopes, n_samples = 200, slope_widths = widths } = options
  if (given_slopes && given_slopes.length !== coords.length) {
    throw new Error(
      `Got ${given_slopes.length} knot slopes for ${coords.length} images; they must match one-to-one`,
    )
  }
  if (slope_widths.length !== widths.length) {
    throw new Error(
      `Got ${slope_widths.length} slope widths for ${widths.length} segments; they must match one-to-one`,
    )
  }
  // Every tangent is slope * width, so a NaN, 0 or negative width silently flattens or
  // inverts a segment instead of failing. knot_widths guarantees this for its own output;
  // fit_path_spline is exported, so a caller-supplied array needs the same check.
  const bad_width = slope_widths.findIndex((width) => !(width > 0) || !Number.isFinite(width))
  if (bad_width !== -1) {
    throw new Error(
      `Slope width ${slope_widths[bad_width]} at segment ${bad_width} must be finite and > 0`,
    )
  }
  if (n_samples < 2) throw new Error(`fit_path_spline needs n_samples >= 2, got ${n_samples}`)
  const knot_slopes = given_slopes ? [...given_slopes] : natural_cubic_slopes(coords, energies)
  // The Hermite basis wants t-space tangents: dE/dx times the run that slope was measured over
  const tangents = (seg: number) =>
    [knot_slopes[seg] * slope_widths[seg], knot_slopes[seg + 1] * slope_widths[seg]] as const
  const seg_energy = (seg: number, t_val: number) =>
    hermite(energies[seg], energies[seg + 1], ...tangents(seg), t_val)
  const highest_idx = arg_max(energies)

  // Start from the highest knot; interior critical points can only push it higher
  let best: PathSpline[`fitted_max`] = {
    coord: coords[highest_idx],
    energy: energies[highest_idx],
    between_images: [highest_idx, highest_idx],
  }
  for (const [seg, width] of widths.entries()) {
    const [tan_0, tan_1] = tangents(seg)
    const criticals = segment_critical_points(energies[seg], energies[seg + 1], tan_0, tan_1)
    for (const t_val of criticals) {
      const energy = hermite(energies[seg], energies[seg + 1], tan_0, tan_1, t_val)
      if (energy > best.energy) {
        best = { coord: coords[seg] + t_val * width, energy, between_images: [seg, seg + 1] }
      }
    }
  }

  const [start, end] = [coords[0], coords[coords.length - 1]]
  const sample_coords: number[] = []
  const sample_energies: number[] = []
  // Samples are generated in increasing order, so the segment cursor only moves forward
  let seg = 0
  for (let sample = 0; sample < n_samples; sample++) {
    const coord = start + ((end - start) * sample) / (n_samples - 1)
    while (seg < widths.length - 1 && coord > coords[seg + 1]) seg++
    sample_coords.push(coord)
    sample_energies.push(seg_energy(seg, clamp((coord - coords[seg]) / widths[seg], 0, 1)))
  }

  // Include the analytic saddle so the plotted polyline peaks where the annotation sits. An
  // interior saddle lies strictly inside [start, end], so a later sample always exists.
  if (
    best.between_images[0] !== best.between_images[1] &&
    !sample_coords.includes(best.coord)
  ) {
    const at = sample_coords.findIndex((coord) => coord > best.coord)
    sample_coords.splice(at, 0, best.coord)
    sample_energies.splice(at, 0, best.energy)
  }

  return {
    method: given_slopes ? `force-hermite` : `natural-cubic`,
    coords: sample_coords,
    energies: sample_energies,
    knot_slopes,
    fitted_max: best,
    highest_image: {
      idx: highest_idx,
      coord: coords[highest_idx],
      energy: energies[highest_idx],
    },
    saddle_at_image: best.between_images[0] === best.between_images[1],
  }
}

export type PathSplineOptions = ReactionCoordOptions & {
  // Number of points in the sampled curve returned for plotting.
  n_samples?: number
  // Force `natural-cubic` even when forces are present (e.g. to compare methods).
  ignore_forces?: boolean
}

// Fit the conventional smooth NEB curve through the images, preferring the
// force-projected Hermite spline when forces are available. `coords` are the images'
// reaction coordinates under `options` (computed here when not supplied).
export function path_spline(
  path: ReactionPath | NebImage[],
  options: PathSplineOptions = {},
  coords: readonly number[] = reaction_coordinate(path, options),
): PathSpline {
  const { ignore_forces, n_samples } = options
  const energies = assert_path(path, `path_spline`).map((image) => image.energy)
  const slopes = ignore_forces ? null : projected_force_slopes(path, options)
  // projected_force_slopes returns dE/ds per Å of arc length, so a segment's Hermite tangent
  // is that slope times the segment's ARC width, whatever the plotted x axis is. Rescaling each
  // knot slope by a central-difference ds/di averaged the two runs a knot sits between, making
  // the saddle depend on the x-axis dropdown (0.99727 vs 1.02563 on a sin² path, true 1).
  // Derived for every slope-bearing fit, not just `image_index`: a caller passing its own
  // `coords` leaves `mode` undefined, and those coords need not be arc lengths either. It is
  // the same computation `coords` already did whenever they ARE arc lengths.
  const slope_widths = slopes
    ? knot_widths(reaction_coordinate(path, { ...options, mode: `arc_length` }), energies)
    : undefined
  return fit_path_spline(coords, energies, {
    n_samples,
    slopes: slopes ?? undefined,
    slope_widths,
  })
}

export type PathProfile = {
  coords: number[]
  energies: number[]
  analysis: BarrierAnalysis
  spline: PathSpline
}

// Everything a viewer needs about one path under ONE set of options, so a summary table
// and a plot annotation of the same path cannot drift apart via separate option literals.
// The reaction coordinate is computed once and shared by the barrier analysis and spline.
export function path_profile(
  path: ReactionPath | NebImage[],
  options: PathSplineOptions = {},
): PathProfile {
  const coords = reaction_coordinate(path, options)
  return {
    coords,
    energies: path_images(path).map((image) => image.energy),
    analysis: analyze_barrier(path, options, coords),
    spline: path_spline(path, options, coords),
  }
}

// Index of the image whose reaction coordinate is closest to `coord`. Reaction
// coordinates are not indices, so a hovered plot position maps back by nearest
// neighbour rather than by rounding.
export function nearest_image_idx(coords: readonly number[], coord: number): number {
  if (coords.length === 0) throw new Error(`nearest_image_idx got an empty coordinate array`)
  return coords.reduce(
    (best, val, idx) => (Math.abs(val - coord) < Math.abs(coords[best] - coord) ? idx : best),
    0,
  )
}
