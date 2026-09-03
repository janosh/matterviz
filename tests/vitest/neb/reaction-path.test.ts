import type { Vec3 } from '$lib/math'
import type { NebImage, PathMetricOptions } from '$lib/neb'
import {
  analyze_barrier,
  assert_path,
  fit_path_spline,
  natural_cubic_slopes,
  nearest_image_idx,
  normalize_paths,
  path_profile,
  path_spline,
  projected_force_slopes,
  reaction_coordinate,
} from '$lib/neb/reaction-path'
import type { AnyStructure, Crystal } from '$lib/structure'
import { describe, expect, test } from 'vitest'
import { make_crystal as build_crystal } from '../setup'

const as_li = (xyz: Vec3) => ({ element: `Li`, xyz })
// Cubic cell used throughout; 10 Å keeps fractional↔Cartesian arithmetic exact in binary
const make_crystal = (positions: Vec3[]): Crystal => build_crystal(10, positions.map(as_li))

// Cartesian positions of atoms strung out along x, the tangent of every walk_path below
const on_x_axis = (...x_vals: number[]): Vec3[] => x_vals.map((x_val) => [x_val, 0, 0])

const make_image = (positions: Vec3[], energy: number): NebImage => ({
  structure: make_crystal(positions),
  energy,
})

// Single atom walking along x, so arc length equals the x coordinate and the tangent is
// +x. A bare number in `forces` is therefore a force along that tangent.
const walk_path = (
  x_coords: number[],
  energies: number[],
  forces?: (number | Vec3 | undefined)[],
): NebImage[] =>
  x_coords.map((x_val, idx) => {
    const force = forces?.[idx]
    return {
      ...make_image(on_x_axis(x_val), energies[idx]),
      ...(force === undefined
        ? {}
        : { forces: [typeof force === `number` ? [force, 0, 0] : force] as Vec3[] }),
    }
  })

describe(`barrier arithmetic`, () => {
  // Asymmetric endpoints: symmetric ones would make forward and reverse barriers equal
  // and hide a sign error in either.
  const asymmetric = walk_path([0, 1, 2, 3, 4], [-10.0, -9.3, -8.6, -9.0, -9.4])

  test.each([
    [`forward barrier is highest image minus initial state`, `forward_barrier`, 1.4],
    [`reverse barrier is highest image minus final state`, `reverse_barrier`, 0.8],
    [`reaction energy is the endpoint difference`, `reaction_energy`, 0.6],
    [`transition state is the highest image`, `ts_image_idx`, 2],
    [`transition state energy is the highest energy`, `ts_energy`, -8.6],
  ] as const)(`%s`, (_name, key, expected) => {
    // Energies are one-decimal literals, so binary round-off after two subtractions
    // stays at the 1e-15 level; 1e-12 is a generous but still meaningful bound.
    expect(analyze_barrier(asymmetric)[key]).toBeCloseTo(expected, 12)
  })

  test(`path_profile measures coords, barrier and spline with one options object`, () => {
    const profile = path_profile(asymmetric, { mode: `image_index` })
    expect(profile.coords).toEqual([0, 1, 2, 3, 4])
    expect(profile.energies).toEqual(asymmetric.map((image) => image.energy))
    expect(profile.analysis.ts_coordinate).toBe(2)
    expect(profile.spline.method).toBe(`natural-cubic`)
    expect(profile.spline.highest_image.energy).toBe(profile.analysis.ts_energy)
  })

  test.each([
    [`adjacent to the initial state`, [0, 2.5, 1.0, 0.5, 0.2], 1],
    [`adjacent to the final state`, [0, 0.2, 0.5, 2.5, 1.0], 3],
    [`at the initial state for a barrierless path`, [1.0, 0.5, 0.2, 0.0, -0.4], 0],
    [`at the first of two equally high images`, [0, 1.5, 1.5, 0.3, 0.1], 1],
  ])(`transition state found %s`, (_name, energies, expected_idx) => {
    const { ts_image_idx } = analyze_barrier(walk_path([0, 1, 2, 3, 4], energies))
    expect(ts_image_idx).toBe(expected_idx)
  })

  test(`reverse barrier is negative when the final state is the highest image`, () => {
    const uphill = analyze_barrier(walk_path([0, 1, 2], [0, 0.5, 1.2]))
    expect(uphill.ts_image_idx).toBe(2)
    expect(uphill.reverse_barrier).toBeCloseTo(0, 12)
    expect(uphill.forward_barrier).toBeCloseTo(1.2, 12)
  })
})

describe(`periodic reaction coordinate`, () => {
  // An atom at x = 9.5 Å in a 10 Å cell hopping to x = 0.5 Å has really moved 1.0 Å
  // through the cell face. Raw subtraction reports 9.0 Å — nearly the whole cell.
  const start = make_crystal([[9.5, 0, 0]])
  const end = make_crystal([[0.5, 0, 0]])
  // Configuration-space distance between two images: the arc length of a two-image path
  const image_distance = (
    from: AnyStructure,
    to: AnyStructure,
    options: PathMetricOptions = {},
  ): number =>
    reaction_coordinate(
      [
        { structure: from, energy: 0 },
        { structure: to, energy: 0 },
      ],
      options,
    )[1]

  test(`migrating atom crossing a cell boundary gives the short distance`, () => {
    const min_image = image_distance(start, end)
    const raw = image_distance(start, end, { metric: `cartesian` })
    // Exact in binary: 9.5, 0.5 and 10 are all representable, so demand tight equality
    expect(min_image).toBeCloseTo(1.0, 12)
    expect(raw).toBeCloseTo(9.0, 12)
    expect(raw / min_image).toBeCloseTo(9.0, 12)
  })

  test(`arc length of a boundary-crossing path is the migration distance`, () => {
    const images = walk_path([9.5, 9.75, 0.0, 0.25, 0.5], [0, 0.4, 0.6, 0.3, 0.1])
    const min_image_coords = reaction_coordinate(images)
    const raw_coords = reaction_coordinate(images, { metric: `cartesian` })
    // The minimum-image convention round-trips through fractional coordinates, so
    // expect a few ulps of f64 error (~2.2e-16 each), not exact equality
    for (const [idx, expected] of [0, 0.25, 0.5, 0.75, 1.0].entries()) {
      expect(Math.abs(min_image_coords[idx] - expected)).toBeLessThan(1e-14)
    }
    // Raw subtraction turns the single boundary crossing into a 9.75 Å excursion,
    // inflating a 1.0 Å migration into a 10.5 Å arc length
    expect(raw_coords[4]).toBeCloseTo(10.5, 12)
    expect(raw_coords[4] / min_image_coords[4]).toBeCloseTo(10.5, 12)
  })

  test.each([
    [`disabled along the crossing axis`, [false, true, true] as const, 9.0],
    [`enabled along the crossing axis`, [true, true, true] as const, 1.0],
  ])(`pbc flags respected when %s`, (_name, pbc, expected) => {
    expect(image_distance(start, end, { pbc })).toBeCloseTo(expected, 12)
  })

  test(`multi-atom distance is the root-sum-square of per-atom displacements`, () => {
    const from = make_crystal(on_x_axis(0, 9.7))
    const to = make_crystal([[0, 3, 0], ...on_x_axis(0.1)])
    // atom 0 moves 3 Å, atom 1 wraps 0.4 Å → sqrt(9 + 0.16)
    expect(image_distance(from, to)).toBeCloseTo(Math.sqrt(9.16), 12)
  })

  test(`molecules without a lattice fall through to Euclidean distances`, () => {
    const as_molecule = (crystal: Crystal) => ({ sites: crystal.sites })
    expect(image_distance(as_molecule(start), as_molecule(end))).toBeCloseTo(9.0, 12)
  })
})

describe(`cumulative arc length`, () => {
  test.each([
    [`evenly spaced images`, [0, 1, 2, 3, 4]],
    [`images clustered near the saddle`, [0, 2.5, 3.0, 3.2, 6.0]],
    [`a path that doubles back on itself`, [0, 2, 1, 3, 0.5]],
  ])(`starts at zero and increases monotonically for %s`, (_name, x_coords) => {
    const coords = reaction_coordinate(
      walk_path(
        x_coords,
        x_coords.map(() => 0),
      ),
    )
    expect(coords[0]).toBe(0)
    expect(coords).toHaveLength(x_coords.length)
    for (const [idx, coord] of coords.slice(1).entries()) {
      expect(coord).toBeGreaterThan(coords[idx])
    }
  })

  test(`image_index mode returns the bare bead numbers`, () => {
    const images = walk_path([0, 2.5, 3.0, 6.0], [0, 1, 2, 3])
    expect(reaction_coordinate(images, { mode: `image_index` })).toEqual([0, 1, 2, 3])
  })

  test(`unevenly spaced images place the transition state off-centre in arc length`, () => {
    // Images bunch near the start; arc length must not pretend they are evenly spread
    const images = walk_path([0, 0.5, 1.0, 4.0], [0, 0.4, 0.9, 0.2])
    const { ts_coordinate, ts_image_idx } = analyze_barrier(images)
    expect(ts_image_idx).toBe(2)
    expect(ts_coordinate).toBeCloseTo(1.0, 12)
    expect(analyze_barrier(images, { mode: `image_index` }).ts_coordinate).toBe(2)
  })
})

describe(`energy reference`, () => {
  const images = walk_path([0, 1, 2], [-100.4, -99.6, -100.1])

  test(`shifting every energy by the initial one leaves barriers unchanged`, () => {
    const shifted = images.map((image) => ({
      ...image,
      energy: image.energy - images[0].energy,
    }))
    const raw_barrier = analyze_barrier(images).forward_barrier
    expect(analyze_barrier(shifted).forward_barrier).toBeCloseTo(raw_barrier, 12)
  })
})

describe(`degenerate paths fail loudly`, () => {
  test.each([
    [`an empty path`, [], /at least 2 images.*got 0/],
    [`a single-image path`, [make_image([[0, 0, 0]], -1)], /at least 2 images.*got 1/],
  ])(`%s throws instead of producing NaN`, (_name, images, pattern) => {
    for (const run of [assert_path, reaction_coordinate, analyze_barrier, path_spline]) {
      expect(() => run(images)).toThrow(pattern)
    }
  })

  // oxfmt-ignore
  test.each([
    [`a non-finite energy`, [make_image([[0, 0, 0]], 0), make_image([[1, 0, 0]], Number.NaN)], /non-finite energy/],
    [`a structure without sites`, [make_image([[0, 0, 0]], 0), { structure: { sites: [] }, energy: 1 }], /no structure sites/],
  ])(`%s throws`, (_name, images, pattern) => {
    expect(() => analyze_barrier(images)).toThrow(pattern)
  })

  test(`mismatched image site counts are reported with both counts`, () => {
    const images = [make_image(on_x_axis(0), 0), make_image(on_x_axis(0, 1), 1)]
    expect(() => reaction_coordinate(images)).toThrow(/site counts differ \(1 vs 2\)/)
  })
})

describe(`force projection`, () => {
  test(`projected slope is minus the force along the tangent`, () => {
    // Straight-line path: the tangent is +x everywhere, so dE/ds = -F_x
    const slopes = projected_force_slopes(walk_path([0, 1, 2], [0, 0.1, 0.2], [-0.3, 0, 0.4]))
    expect(slopes).toEqual([0.3, -0, -0.4])
  })

  test(`forces perpendicular to the path project to zero slope`, () => {
    const perpendicular: Vec3 = [0, 1.5, 0]
    const slopes = projected_force_slopes(
      walk_path([0, 1, 2], [0, 0.1, 0.2], [perpendicular, perpendicular, perpendicular]),
    )
    expect(slopes?.every((slope) => Math.abs(slope) < 1e-15)).toBe(true)
  })

  test(`returns null when any image lacks forces`, () => {
    const partial = walk_path([0, 1, 2], [0, 0.1, 0.2], [0, undefined, 0])
    expect(projected_force_slopes(partial)).toBeNull()
  })

  test(`throws when a force array does not cover every site`, () => {
    const two_atoms = (x_val: number, energy: number, n_forces: number): NebImage => ({
      ...make_image(on_x_axis(0, x_val), energy),
      forces: Array.from({ length: n_forces }, (): Vec3 => [0, 0, 0]),
    })
    const images = [two_atoms(1, 0, 1), two_atoms(2, 1, 2)]
    expect(() => projected_force_slopes(images)).toThrow(/1 force vectors for 2 sites/)
  })

  test(`throws when neighbouring images are identical so the tangent vanishes`, () => {
    const identical = walk_path([0, 0], [0, 1], [0, 0])
    expect(() => projected_force_slopes(identical)).toThrow(/zero-length path tangent/)
  })
})

describe(`input normalization`, () => {
  const images = walk_path([0, 1, 2], [0, 1, 0.5])

  test.each([
    [`a bare image array`, () => images, 1],
    [`a single path object`, () => ({ images, label: `hop` }), 1],
    [`a keyed record of paths`, () => ({ vacancy: images, interstitial: { images } }), 2],
  ])(`%s normalizes to named paths`, (_name, make_input, expected_count) => {
    const paths = normalize_paths(make_input())
    expect(paths).toHaveLength(expected_count)
    for (const { path } of paths) expect(path.images).toHaveLength(3)
  })

  test(`a single path keeps its label as key`, () => {
    expect(normalize_paths({ images, label: `hop` })[0].key).toBe(`hop`)
  })

  test(`an empty record throws`, () => {
    expect(() => normalize_paths({})).toThrow(/empty record/)
  })
})

describe(`plot hover mapping`, () => {
  // Reaction coordinates are physical distances, so a hovered x maps back by nearest
  // image — rounding would only be correct if x were the image index.
  const coords = [0, 0.25, 0.5, 1.75, 3.0]

  // oxfmt-ignore
  test.each(
    [[0.0, 0], [0.3, 1], [0.4, 2], [1.2, 3], [2.9, 4], [-5, 0], [99, 4]],
  )(`coordinate %f maps to image %i`, (coord, expected_idx) => {
    expect(nearest_image_idx(coords, coord)).toBe(expected_idx)
  })

  test(`an empty coordinate array throws`, () => {
    expect(() => nearest_image_idx([], 0)).toThrow(/empty coordinate array/)
  })
})

// Piecewise cubic Hermite evaluation (clamped to the knots) for probing fitted slopes; the
// production curve is sampled by fit_path_spline, which uses the same basis
const eval_hermite = (
  xs: readonly number[],
  ys: readonly number[],
  slopes: readonly number[],
  coord: number,
): number => {
  const last = xs.length - 1
  if (coord <= xs[0]) return ys[0]
  if (coord >= xs[last]) return ys[last]
  let seg = 0
  while (seg < last - 1 && coord > xs[seg + 1]) seg++
  const width = xs[seg + 1] - xs[seg]
  const t_val = (coord - xs[seg]) / width
  const [t_sq, t_cu] = [t_val ** 2, t_val ** 3]
  return (
    (2 * t_cu - 3 * t_sq + 1) * ys[seg] +
    (t_cu - 2 * t_sq + t_val) * slopes[seg] * width +
    (-2 * t_cu + 3 * t_sq) * ys[seg + 1] +
    (t_cu - t_sq) * slopes[seg + 1] * width
  )
}

describe(`natural cubic slopes`, () => {
  test.each([
    [`a straight line`, [0, 1, 2, 3], [0, 2, 4, 6], [2, 2, 2, 2]],
    [`a two-knot path (degenerates to linear)`, [0, 4], [1, 3], [0.5, 0.5]],
    [`unevenly spaced knots on a line`, [0, 0.5, 3], [1, 0, -5], [-2, -2, -2]],
    // xs = [0,1,2], ys = [0,1,0]: natural BCs give curvatures [0, -3, 0], hence
    // slopes [1 - (-3)/6, -1 - (-6)/6, -1 + (-3)/6] = [1.5, 0, -1.5]
    [`a hand-solved symmetric tent`, [0, 1, 2], [0, 1, 0], [1.5, 0, -1.5]],
  ])(`reproduce the exact derivative for %s`, (_name, xs, ys, expected) => {
    // A cubic spline reproduces linear data exactly; only f64 round-off separates them
    for (const [idx, slope] of natural_cubic_slopes(xs, ys).entries()) {
      expect(slope).toBeCloseTo(expected[idx], 12)
    }
  })

  test(`impose zero curvature at both ends, as the natural boundary condition requires`, () => {
    const xs = [0, 1, 2, 3.5]
    const ys = [0, 1.4, 0.6, 2.2]
    const slopes = natural_cubic_slopes(xs, ys)
    const step = 1e-3
    // A central second difference is exact for a cubic, so the only error is
    // cancellation: ~eps·|y|/step² ≈ 5e-10, far below the 1e-6 bound used here
    const curvature = (coord: number) =>
      (eval_hermite(xs, ys, slopes, coord + step) -
        2 * eval_hermite(xs, ys, slopes, coord) +
        eval_hermite(xs, ys, slopes, coord - step)) /
      step ** 2
    // The spline's curvature is linear within each segment, so sampling twice and
    // extrapolating back to the end knot must land on zero
    expect(Math.abs(2 * curvature(0.1) - curvature(0.2))).toBeLessThan(1e-6)
    expect(Math.abs(2 * curvature(3.4) - curvature(3.3))).toBeLessThan(1e-6)
  })

  test(`interpolate every knot value exactly`, () => {
    const xs = [0, 0.7, 2.1, 5]
    const ys = [1, -2, 3.5, 0.25]
    const slopes = natural_cubic_slopes(xs, ys)
    for (const [idx, coord] of xs.entries()) {
      expect(eval_hermite(xs, ys, slopes, coord)).toBeCloseTo(ys[idx], 12)
    }
  })

  test.each([
    [`non-increasing knots`, [0, 1, 1], [0, 1, 2], /strictly increase/],
    [`decreasing knots`, [0, 2, 1], [0, 1, 2], /strictly increase/],
    [`a single knot`, [0], [1], /at least 2 knots/],
    [`mismatched lengths`, [0, 1, 2], [0, 1], /matching x\/y lengths/],
  ])(`throw for %s`, (_name, xs, ys, pattern) => {
    expect(() => natural_cubic_slopes(xs, ys)).toThrow(pattern)
  })
})

describe(`fitted saddle versus highest image`, () => {
  // A symmetric barrier sampled off its peak: the true maximum sits between images
  const coords = [0, 1, 2, 3]
  const energies = [0, 0.9, 0.9, 0]

  // oxfmt-ignore
  test.each([
    [`without forces`, undefined, `natural-cubic`],
    [`with force-projected slopes`, [0.5, 0.4, -0.4, -0.5], `force-hermite`],
  ] as const)(`method is reported %s`, (_name, slopes, expected_method) => {
    expect(fit_path_spline(coords, energies, slopes ? { slopes } : {}).method)
      .toBe(expected_method)
  })

  // oxfmt-ignore
  test.each([
    [`a saddle between two images`, [0, 1, 2, 3], [0, 0.9, 0.9, 0], false],
    [`a saddle clearly at one image`, [0, 1, 2, 3], [0, 0.2, 1.4, 0.3], false],
    [`a monotonic uphill path`, [0, 1, 2], [0, 0.5, 1.0], true],
  ])(`fitted max is never below the highest image for %s`, (_name, xs, ys, at_image) => {
    const spline = fit_path_spline(xs, ys)
    expect(spline.fitted_max.energy).toBeGreaterThanOrEqual(spline.highest_image.energy)
    expect(spline.saddle_at_image).toBe(at_image)
  })

  test(`fitted saddle is distinct from, and above, the highest image`, () => {
    const spline = fit_path_spline(coords, energies)
    expect(spline.highest_image).toEqual({ idx: 1, coord: 1, energy: 0.9 })
    // Symmetric profile ⇒ the interpolated peak sits at the midpoint, above both images
    expect(spline.fitted_max.coord).toBeCloseTo(1.5, 10)
    expect(spline.fitted_max.energy).toBeGreaterThan(0.9)
    expect(spline.fitted_max.between_images).toEqual([1, 2])
    expect(spline.saddle_at_image).toBe(false)
    const peak_idx = spline.coords.findIndex(
      (coord) => Math.abs(coord - spline.fitted_max.coord) < 1e-12,
    )
    expect(peak_idx).toBeGreaterThanOrEqual(0)
    expect(spline.energies[peak_idx]).toBeCloseTo(spline.fitted_max.energy, 12)
    // inserting the saddle must keep the sample arrays parallel and the coords sorted
    expect(spline.energies).toHaveLength(spline.coords.length)
    expect(spline.energies.every(Number.isFinite)).toBe(true)
    expect(spline.coords).toEqual(spline.coords.toSorted((a, b) => a - b))
  })

  test(`sampled curve passes through every image energy`, () => {
    const spline = fit_path_spline(coords, energies, { n_samples: 601 })
    for (const [idx, coord] of coords.entries()) {
      const sample_idx = spline.coords.findIndex((val) => Math.abs(val - coord) < 1e-9)
      expect(sample_idx).toBeGreaterThanOrEqual(0)
      expect(spline.energies[sample_idx]).toBeCloseTo(energies[idx], 10)
    }
  })

  test(`sampled curve never exceeds the exactly located fitted maximum`, () => {
    const spline = fit_path_spline(coords, energies, { n_samples: 5000 })
    expect(Math.max(...spline.energies)).toBeLessThanOrEqual(spline.fitted_max.energy + 1e-12)
  })

  test.each([
    [`mismatched slope count`, { slopes: [0, 0] }, /2 knot slopes for 4 images/],
    [`too few samples`, { n_samples: 1 }, /n_samples >= 2/],
  ])(`throws for %s`, (_name, options, pattern) => {
    expect(() => fit_path_spline(coords, energies, options)).toThrow(pattern)
  })
})

describe(`path_spline on structures`, () => {
  const x_coords = [0, 1, 2, 3]
  const energies = [0, 0.9, 0.9, 0]

  test(`picks force-hermite when every image carries forces`, () => {
    const spline = path_spline(walk_path(x_coords, energies, [-0.6, -0.2, 0.2, 0.6]))
    expect(spline.method).toBe(`force-hermite`)
    // Tangent is +x, so dE/ds = -F_x
    for (const [idx, slope] of spline.knot_slopes.entries()) {
      expect(slope).toBeCloseTo([0.6, 0.2, -0.2, -0.6][idx], 10)
    }
  })

  test.each([
    [`no forces are present`, false],
    [`forces are explicitly ignored`, true],
  ])(`falls back to a natural cubic when %s`, (_name, ignore_forces) => {
    const forces = ignore_forces ? [-0.6, -0.2, 0.2, 0.6] : undefined
    const path = walk_path(x_coords, energies, forces)
    expect(path_spline(path, { ignore_forces }).method).toBe(`natural-cubic`)
  })

  test(`spline coordinates span the reaction coordinate`, () => {
    const path = walk_path(x_coords, energies)
    const coords = reaction_coordinate(path)
    const spline = path_spline(path)
    expect(spline.coords[0]).toBeCloseTo(coords[0], 12)
    expect(spline.coords.at(-1)).toBeCloseTo(coords.at(-1) as number, 12)
  })

  // dE/ds is measured in energy per Å of arc length, so a segment's Hermite tangent is that
  // slope times the segment's ARC width — no matter what the plot's x axis is. Deliberately
  // uneven spacing: with unit spacing every arc width is 1 and the bug is invisible.
  const arc_positions = [0, 0.15, 0.45, 0.69, 1.2]
  const total = 1.2
  const barrier_energies = arc_positions.map(
    (s_val) => Math.sin((Math.PI * s_val) / total) ** 2,
  )
  // dE/ds = -F_x on a +x tangent, so the force is minus the analytic slope
  const rescale_path = walk_path(
    arc_positions,
    barrier_energies,
    arc_positions.map((s_val) => -(Math.PI / total) * Math.sin((2 * Math.PI * s_val) / total)),
  )

  test(`the fitted saddle does not depend on which x-axis is plotted`, () => {
    const arc = path_spline(rescale_path)
    const index = path_spline(rescale_path, { mode: `image_index` })
    // The knot slopes stay dE/ds under both modes, and the interpolant is bit-identical
    expect(index.knot_slopes).toEqual(arc.knot_slopes)
    expect(index.fitted_max.energy).toBe(arc.fitted_max.energy)

    // Both earlier tangent constructions were wrong on the bead-number axis: a
    // central-difference ds/di collapsed the two arc widths a knot sits between into their
    // average, and raw eV/Å slopes ignored the arc entirely.
    const spacings = [0.15, 0.225, 0.27, 0.375, 0.51]
    const central_diff = fit_path_spline([0, 1, 2, 3, 4], barrier_energies, {
      slopes: arc.knot_slopes.map((slope, idx) => slope * spacings[idx]),
    }).fitted_max.energy
    const ungraded = fit_path_spline([0, 1, 2, 3, 4], barrier_energies, {
      slopes: arc.knot_slopes,
    }).fitted_max.energy
    expect(Math.abs(central_diff - arc.fitted_max.energy)).toBeGreaterThan(1e-3)
    expect(ungraded - arc.fitted_max.energy).toBeGreaterThan(0.2)
  })

  // A cubic Hermite segment with exact end slopes reproduces any cubic exactly, so a cubic
  // energy profile E(x) = 1.5x² − x³ (maximum 0.5 at x = 1) sampled at uneven positions
  // with its analytic forces F = −dE/dx is an exact analytic case for the whole chain:
  // forces → projected slopes → Hermite → saddle search.
  test(`force-hermite reproduces a cubic profile and its saddle exactly`, () => {
    const profile = (x_val: number) => 1.5 * x_val ** 2 - x_val ** 3
    const force = (x_val: number) => -(3 * x_val - 3 * x_val ** 2)
    const x_vals = [0, 0.35, 0.8, 1.3, 1.9]
    const path = walk_path(x_vals, x_vals.map(profile), x_vals.map(force))
    const spline = path_spline(path, { n_samples: 101 })
    expect(spline.method).toBe(`force-hermite`)
    expect(spline.fitted_max.coord).toBeCloseTo(1, 12)
    expect(spline.fitted_max.energy).toBeCloseTo(0.5, 12)
    expect(spline.fitted_max.between_images).toEqual([2, 3])
    expect(spline.highest_image).toEqual({ idx: 2, coord: 0.8, energy: profile(0.8) })
    const max_err = Math.max(
      ...spline.coords.map((coord, idx) => Math.abs(spline.energies[idx] - profile(coord))),
    )
    expect(max_err).toBeLessThan(1e-12)
    // The natural cubic has no slope information and misplaces the saddle by several %
    const natural = path_spline(path, { ignore_forces: true })
    expect(Math.abs(natural.fitted_max.coord - 1)).toBeGreaterThan(0.01)
  })

  test(`force-projected slopes raise the fitted saddle above the plain cubic`, () => {
    // Forces that stay uphill into the gap between images 1 and 2 push the peak higher
    const path = walk_path(x_coords, energies, [-0.6, -0.6, 0.6, 0.6])
    const with_forces = path_spline(path)
    const without = path_spline(path, { ignore_forces: true })
    expect(with_forces.fitted_max.energy).toBeGreaterThan(without.fitted_max.energy)
    expect(with_forces.highest_image.energy).toBe(without.highest_image.energy)
  })
})
