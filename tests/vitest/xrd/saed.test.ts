import type { Vec2, Vec3 } from '$lib/math'
import { electron_form_factor } from '$lib/scattering'
import type { Crystal } from '$lib/structure'
import type { SaedOptions, SaedPatternData, SaedSpot } from '$lib/xrd'
import {
  compute_saed_pattern,
  electron_wavelength,
  laue_zone_label,
  saed_pattern_radius,
} from '$lib/xrd'
import { describe, expect, test } from 'vitest'
import { make_crystal } from '../setup'

// Angle in degrees between two spots as seen from the direct beam
const saed_spot_angle = (spot_a: Vec2, spot_b: Vec2): number => {
  const cos_angle =
    (spot_a[0] * spot_b[0] + spot_a[1] * spot_b[1]) /
    (Math.hypot(...spot_a) * Math.hypot(...spot_b))
  return (Math.acos(Math.min(1, Math.max(-1, cos_angle))) * 180) / Math.PI
}

const make_simple_cubic = (a_len: number): Crystal =>
  make_crystal(a_len, [{ element: `Al`, abc: [0, 0, 0], label: `A1` }])

const make_fcc = (a_len: number): Crystal =>
  make_crystal(a_len, [
    { element: `Cu`, abc: [0, 0, 0], label: `A1` },
    { element: `Cu`, abc: [0, 0.5, 0.5], label: `A2` },
    { element: `Cu`, abc: [0.5, 0, 0.5], label: `A3` },
    { element: `Cu`, abc: [0.5, 0.5, 0], label: `A4` },
  ])

// The default 200 kV view down [001]. Each test overrides only the option it is probing, so
// the assertions below never depend on an option a test did not mean to set.
const cubic_saed = (a_len: number, options: SaedOptions = {}): SaedPatternData =>
  compute_saed_pattern(make_simple_cubic(a_len), {
    zone_axis: [0, 0, 1],
    accelerating_voltage: 200,
    ...options,
  })

const spot_radius = (spot: SaedSpot): number => Math.hypot(...spot.position_2d)

const find_spot = (spots: SaedSpot[], target: Vec3): SaedSpot => {
  const found = spots.find((spot) => spot.hkl.every((val, idx) => val === target[idx]))
  if (!found) {
    throw new Error(`no spot ${target.join(``)} in [${spots.map((sp) => sp.hkl.join(``))}]`)
  }
  return found
}

describe(`compute_saed_pattern geometry`, () => {
  const a_len = 4

  // Down [001] of a cubic crystal the zero-order Laue zone is the (h k 0) plane, whose
  // reciprocal net is a square of side 1/a. Both the spacing and the 90°/45° angles are
  // fixed by geometry alone, independent of any scattering model.
  test(`cubic [001] gives a square net of side 1/a`, () => {
    const pattern = cubic_saed(a_len)
    expect(pattern.spots.length).toBeGreaterThan(20)

    // compute_in_plane_basis([0,0,1]) returns x̂, ŷ, so position_2d is (h/a, k/a) exactly
    for (const spot of pattern.spots) {
      expect(spot.position_2d[0]).toBeCloseTo(spot.hkl[0] / a_len, 12)
      expect(spot.position_2d[1]).toBeCloseTo(spot.hkl[1] / a_len, 12)
    }

    const spot_100 = find_spot(pattern.spots, [1, 0, 0])
    const spot_010 = find_spot(pattern.spots, [0, 1, 0])
    const spot_110 = find_spot(pattern.spots, [1, 1, 0])
    expect(spot_radius(spot_100)).toBeCloseTo(1 / a_len, 12)
    expect(spot_radius(spot_010)).toBeCloseTo(1 / a_len, 12)
    expect(spot_radius(spot_110)).toBeCloseTo(Math.SQRT2 / a_len, 12)
    expect(saed_spot_angle(spot_100.position_2d, spot_010.position_2d)).toBeCloseTo(90, 10)
    expect(saed_spot_angle(spot_100.position_2d, spot_110.position_2d)).toBeCloseTo(45, 10)
  })

  // Down [111] the in-zone reflections are those with h + k + l = 0, whose shortest vectors
  // are the six ⟨1 1̄ 0⟩ types — a hexagonal net with 60° between neighbours.
  test(`cubic [111] gives a hexagonal net with 60° spacing`, () => {
    const pattern = cubic_saed(a_len, { zone_axis: [1, 1, 1] })
    const first_ring_radius = Math.SQRT2 / a_len
    const first_ring = pattern.spots.filter(
      (spot) => Math.abs(spot_radius(spot) - first_ring_radius) < 1e-9,
    )
    expect(first_ring).toHaveLength(6)

    // Every first-ring reflection lies in the zone (h + k + l = 0) and has |g| = √2/a
    for (const spot of first_ring) {
      expect(spot.hkl[0] + spot.hkl[1] + spot.hkl[2]).toBe(0)
      expect(spot.laue_zone).toBe(0)
      expect(spot.d_spacing).toBeCloseTo(a_len / Math.SQRT2, 12)
    }

    const polar_angles = first_ring
      .map((spot) => Math.atan2(spot.position_2d[1], spot.position_2d[0]) * (180 / Math.PI))
      .toSorted((ang_a, ang_b) => ang_a - ang_b)
    for (let idx = 1; idx < polar_angles.length; idx++) {
      expect(polar_angles[idx] - polar_angles[idx - 1]).toBeCloseTo(60, 10)
    }
  })

  test.each([
    [[0, 0, 1] as Vec3, 90],
    [[1, 1, 0] as Vec3, 90], // rectangular net: ⟨001⟩ perpendicular to ⟨11̄0⟩
  ])(
    `cubic %s: the two shortest independent spots are perpendicular`,
    (zone_axis, expected) => {
      const pattern = cubic_saed(a_len, { zone_axis })
      // Shortest spot, then the shortest one not (anti)parallel to it
      const by_radius = pattern.spots.toSorted(
        (spot_a, spot_b) => spot_radius(spot_a) - spot_radius(spot_b),
      )
      const first = by_radius[0]
      const second = by_radius.find((spot) => {
        const angle = saed_spot_angle(first.position_2d, spot.position_2d)
        return angle > 1 && angle < 179
      })
      if (!second) throw new Error(`no spot independent of ${first.hkl.join(``)}`)
      expect(saed_spot_angle(first.position_2d, second.position_2d)).toBeCloseTo(expected, 8)
    },
  )

  test(`every spot's position_2d reproduces |g| = 1/d for a ZOLZ reflection`, () => {
    const pattern = cubic_saed(4.2)
    for (const spot of pattern.spots.filter((candidate) => candidate.laue_zone === 0)) {
      // In the zero-order zone g lies entirely in the projection plane, so the 2D length is
      // the full |g| and must invert to the d-spacing
      expect(spot_radius(spot)).toBeCloseTo(1 / spot.d_spacing, 12)
    }
  })

  test(`saed_pattern_radius reports the outermost spot`, () => {
    // Spots carry |g| = sqrt(h² + k²) / a for the [001] zone of a simple cubic cell, so the
    // outermost one is the largest in-window hkl radius
    const pattern = cubic_saed(4)
    const max_hk = Math.max(...pattern.spots.map(({ hkl }) => Math.hypot(hkl[0], hkl[1])))
    expect(max_hk).toBeGreaterThan(1)
    expect(saed_pattern_radius(pattern)).toBeCloseTo(max_hk / 4, 10)
  })
})

describe(`compute_saed_pattern structure factor`, () => {
  // FCC extinguishes every reflection with mixed-parity indices. Down [001] the zero-order
  // zone has l = 0 (even), so only all-even hkl can survive — 200/220/400 but never 100 or
  // 210. An intensity-magnitude test would not catch a structure-factor phase-sign bug; this
  // does, because a wrong phase resurrects the forbidden spots.
  test(`FCC [001] shows only all-even or all-odd reflections`, () => {
    const pattern = compute_saed_pattern(make_fcc(3.615), {
      zone_axis: [0, 0, 1],
      accelerating_voltage: 200,
    })
    expect(pattern.spots.length).toBeGreaterThan(10)
    for (const { hkl } of pattern.spots) {
      const parities = hkl.map((index) => Math.abs(index % 2))
      const all_even = parities.every((parity) => parity === 0)
      const all_odd = parities.every((parity) => parity === 1)
      expect(all_even || all_odd, `hkl ${hkl.join(` `)} has mixed parity`).toBe(true)
    }
    // Sanity: the allowed 200 is present (d = a/2) while the forbidden 100 and 110 are not
    expect(find_spot(pattern.spots, [2, 0, 0]).d_spacing).toBeCloseTo(3.615 / 2, 10)
    expect(() => find_spot(pattern.spots, [1, 0, 0])).toThrow(/no spot 100/)
    expect(() => find_spot(pattern.spots, [1, 1, 0])).toThrow(/no spot 110/)
    // max_g 0.4 excludes the allowed 200 (g = 2/3.615 = 0.553), leaving only extinct
    // reflections, whose round-off used to render at full brightness under relative scaling
    const extinct_only = compute_saed_pattern(make_fcc(3.615), {
      zone_axis: [0, 0, 1],
      accelerating_voltage: 200,
      max_g: 0.4,
    })
    expect(extinct_only.spots).toEqual([])
  })

  test(`FCC and simple cubic differ only by the absences, not the net`, () => {
    const options = { zone_axis: [0, 0, 1] as Vec3, accelerating_voltage: 200 }
    const fcc = compute_saed_pattern(make_fcc(3.615), options)
    const simple = compute_saed_pattern(make_simple_cubic(3.615), options)
    // Every FCC spot must also exist in the simple-cubic net at the same place
    for (const spot of fcc.spots) {
      const match = find_spot(simple.spots, spot.hkl)
      expect(match.position_2d[0]).toBeCloseTo(spot.position_2d[0], 12)
      expect(match.position_2d[1]).toBeCloseTo(spot.position_2d[1], 12)
    }
    expect(fcc.spots.length).toBeLessThan(simple.spots.length)
  })
})

describe(`compute_saed_pattern Ewald geometry`, () => {
  test(`the ZOLZ dominates because the Ewald sphere is nearly flat`, () => {
    const pattern = cubic_saed(4)
    // λ = 0.0251 Å puts the Ewald radius at 39.9 1/Å against a 0.25 1/Å reciprocal spacing,
    // so the whole zero-order plane is excited and no higher-order zone is within reach.
    expect(pattern.spots.every((spot) => spot.laue_zone === 0)).toBe(true)
    expect(pattern.spots.every((spot) => spot.hkl[2] === 0)).toBe(true)
  })

  test.each([
    [50, 1 / 50],
    [200, 1 / 200],
  ])(`thickness %i Å keeps |s_g| below the relrod first zero %f`, (thickness, cutoff) => {
    const pattern = cubic_saed(4, { crystal_thickness: thickness })
    expect(pattern.spots.length).toBeGreaterThan(4)
    for (const spot of pattern.spots) {
      expect(Math.abs(spot.excitation_error)).toBeLessThan(cutoff)
      // ZOLZ points sit inside the sphere, so their excitation error is negative
      expect(spot.excitation_error).toBeLessThanOrEqual(0)
    }
  })

  test(`a thinner foil excites more spots`, () => {
    const thin = cubic_saed(4, { crystal_thickness: 20 })
    const thick = cubic_saed(4, { crystal_thickness: 200 })
    expect(thin.spots.length).toBeGreaterThan(thick.spots.length)
  })

  test(`a longer wavelength curves the sphere and excites fewer spots`, () => {
    const at_300kv = cubic_saed(4, { crystal_thickness: 50, accelerating_voltage: 300 })
    const at_30kv = cubic_saed(4, { crystal_thickness: 50, accelerating_voltage: 30 })
    expect(at_300kv.wavelength).toBeLessThan(at_30kv.wavelength)
    expect(at_300kv.spots.length).toBeGreaterThan(at_30kv.spots.length)
  })

  test(`the default is a 200 kV beam`, () => {
    const pattern = compute_saed_pattern(make_simple_cubic(4))
    expect(pattern.wavelength).toBeCloseTo(electron_wavelength(200), 15)
    expect(pattern.zone_axis).toEqual([0, 0, 1])
  })

  test.each([
    [0, `ZOLZ`],
    [1, `FOLZ`],
    [2, `HOLZ2`],
  ])(`laue_zone_label(%i) is %s`, (laue_zone, expected) => {
    expect(laue_zone_label(laue_zone)).toBe(expected)
  })

  // Two failure modes at once. A 4 Å cell down [112] puts every excited reflection in the
  // ZOLZ, so the dot-product assertion degenerates to 0 === 0 there and `laue_zone: 0` passes;
  // a 20 Å cell packs the reciprocal planes 5x closer so a 3 1/Å window reaches several.
  // And [002] is the same beam direction as [001], so counting h·u + k·v + l·w against the
  // unreduced axis doubles every index and mislabels the FOLZ as HOLZ2 — hence the
  // expectation is always stated against the PRIMITIVE axis.
  test.each([
    { zone_axis: [1, 1, 2], primitive: [1, 1, 2] },
    { zone_axis: [0, 0, 1], primitive: [0, 0, 1] },
    { zone_axis: [0, 0, 2], primitive: [0, 0, 1] },
  ] as { zone_axis: Vec3; primitive: Vec3 }[])(
    `zone axis $zone_axis counts Laue zones against $primitive`,
    ({ zone_axis, primitive }) => {
      const pattern = cubic_saed(20, { zone_axis, max_g: 3, crystal_thickness: 20 })
      expect(pattern.spots.length).toBeGreaterThan(4)
      for (const spot of pattern.spots) {
        const dot_product =
          spot.hkl[0] * primitive[0] + spot.hkl[1] * primitive[1] + spot.hkl[2] * primitive[2]
        expect(spot.laue_zone).toBe(Math.abs(dot_product))
      }
      const zones = pattern.spots.map((spot) => spot.laue_zone)
      expect(Math.min(...zones)).toBe(0)
      expect(Math.max(...zones)).toBeGreaterThanOrEqual(3)
    },
  )
})

describe(`compute_saed_pattern validation`, () => {
  test.each([
    [`zero-length zone axis`, { zone_axis: [0, 0, 0] as Vec3 }, /zero-length direct-lattice/],
    [`non-finite zone axis`, { zone_axis: [1, NaN, 0] as Vec3 }, /Expected three integer/],
    // A fractional axis is not a lattice translation; accepting it produced HOLZ0.5 labels
    [`fractional zone axis`, { zone_axis: [0, 0.5, 1] as Vec3 }, /Expected three integer/],
    [`max_g past the Ewald radius`, { max_g: 100 }, /must stay below the Ewald radius/],
    [`wavelength plus voltage`, { wavelength: 0.025, accelerating_voltage: 200 }, /not both/],
    [`negative wavelength`, { wavelength: -0.025 }, /Invalid wavelength/],
    [`zero max_g`, { max_g: 0 }, /Invalid max_g/],
    [`negative thickness`, { crystal_thickness: -5 }, /Invalid crystal_thickness/],
    [`invalid voltage`, { accelerating_voltage: 0 }, /Invalid accelerating voltage/],
  ] as const)(`%s throws`, (_label, options, expected) => {
    expect(() => compute_saed_pattern(make_simple_cubic(4), options)).toThrow(expected)
  })

  test(`intensities follow |f_e|²·sinc²(t·s_g), scaled to 100 and sorted strongest-first`, () => {
    const thickness = 50
    // Al, so |F|² below is a single form factor with no interference term
    const permissive = cubic_saed(4, { crystal_thickness: thickness })
    const strict = cubic_saed(4, { crystal_thickness: thickness, intensity_tol: 50 })
    expect(Math.max(...permissive.spots.map((spot) => spot.intensity))).toBeCloseTo(100, 10)
    expect(strict.spots.length).toBeLessThan(permissive.spots.length)
    expect(strict.spots.every((spot) => spot.intensity > 50)).toBe(true)
    // Sorted strongest-first so renderers can draw large discs beneath small ones
    for (let idx = 1; idx < permissive.spots.length; idx++) {
      expect(permissive.spots[idx - 1].intensity).toBeGreaterThanOrEqual(
        permissive.spots[idx].intensity,
      )
    }

    // Deleting `* shape * shape` from the intensity leaves every other test in this file
    // passing — they only ever exercise the |s_g| < 1/t cutoff, never the weight inside it.
    // A one-atom cell has |F|² = f_e(|g|/2)² exactly, so dividing out f_e²·sinc²(t·s_g) must
    // leave one shared normalisation constant across the whole pattern.
    const sinc = (x_val: number) =>
      x_val === 0 ? 1 : Math.sin(Math.PI * x_val) / (Math.PI * x_val)
    const shapes = permissive.spots.map((spot) => sinc(thickness * spot.excitation_error) ** 2)
    // The weight must span a real range, else sinc ≡ 1 would satisfy the check below
    expect(Math.max(...shapes) / Math.min(...shapes)).toBeGreaterThan(5)
    const ratios = permissive.spots.map(
      (spot, spot_idx) =>
        spot.intensity /
        (electron_form_factor(`Al`, 1 / (2 * spot.d_spacing)) ** 2 * shapes[spot_idx]),
    )
    // 1e-11 relative: s is recovered through d = 1/|g|, and the Gaussian sum amplifies those
    // few ulps by b·s² ≈ 12, giving ~1e-14 in f_e² — three orders below the tolerance
    expect(Math.max(...ratios.map((ratio) => Math.abs(ratio / ratios[0] - 1)))).toBeLessThan(
      1e-11,
    )
  })

  test(`in_plane_basis is orthonormal and perpendicular to the zone axis`, () => {
    const zone_axis: Vec3 = [1, 1, 2]
    const pattern = cubic_saed(4, { zone_axis })
    const [basis_u, basis_v] = pattern.in_plane_basis
    const zone_cart: Vec3 = [zone_axis[0] * 4, zone_axis[1] * 4, zone_axis[2] * 4]
    const dot = (vec_a: Vec3, vec_b: Vec3) =>
      vec_a[0] * vec_b[0] + vec_a[1] * vec_b[1] + vec_a[2] * vec_b[2]
    expect(dot(basis_u, basis_u)).toBeCloseTo(1, 12)
    expect(dot(basis_v, basis_v)).toBeCloseTo(1, 12)
    expect(dot(basis_u, basis_v)).toBeCloseTo(0, 12)
    expect(dot(basis_u, zone_cart)).toBeCloseTo(0, 12)
    expect(dot(basis_v, zone_cart)).toBeCloseTo(0, 12)
  })
})
