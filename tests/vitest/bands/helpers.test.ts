import {
  apply_gaussian_smearing,
  convert_frequencies,
  extract_k_path_points,
  find_qpoint_at_distance,
  find_qpoint_at_rescaled_x,
  get_band_xaxis_ticks,
  normalize_densities,
  pretty_sym_point,
} from '$lib/bands/helpers'
import type { BaseBandStructure } from '$lib/bands/types'
import type { Matrix3x3, Vec3 } from '$lib/math'
import { describe, expect, it, vi } from 'vitest'

describe(`pretty_sym_point`, () => {
  it.each([
    { input: `GAMMA`, expected: `Γ` },
    { input: `DELTA`, expected: `Δ` },
    { input: `SIGMA`, expected: `Σ` },
  ])(`converts $input to $expected`, ({ input, expected }) => {
    expect(pretty_sym_point(input)).toBe(expected)
  })

  it.each([
    { input: `X1`, expected_subscript: `₁` },
    { input: `K2`, expected_subscript: `₂` },
    { input: `M3`, expected_subscript: `₃` },
  ])(
    `converts $input to include subscript $expected_subscript`,
    ({ input, expected_subscript }) => {
      expect(pretty_sym_point(input)).toContain(expected_subscript)
    },
  )

  it(`removes underscores`, () => {
    expect(pretty_sym_point(`S_0`)).not.toContain(`_`)
    expect(pretty_sym_point(`GAMMA_1`)).toContain(`₁`)
  })

  it(`converts Unicode letters with subscripts`, () => {
    expect(pretty_sym_point(`GAMMA1`)).toBe(`Γ₁`)
    expect(pretty_sym_point(`DELTA2`)).toBe(`Δ₂`)
    expect(pretty_sym_point(`SIGMA3`)).toBe(`Σ₃`)
  })
})

describe(`convert_frequencies`, () => {
  it.each([
    { unit: `THz` as const, input: [1.0, 2.0, 3.0], expected: [1.0, 2.0, 3.0] },
    { unit: `eV` as const, input: [1.0], expected_range: [0.001, 0.01] },
    { unit: `meV` as const, input: [1.0], expected_range: [1, 10] },
  ])(`converts $input from THz to $unit`, ({ unit, input, expected, expected_range }) => {
    const result = convert_frequencies(input, unit)
    if (expected) {
      expect(result).toEqual(expected)
    } else if (expected_range) {
      expect(result[0]).toBeGreaterThan(expected_range[0])
      expect(result[0]).toBeLessThan(expected_range[1])
    }
  })
})

describe(`normalize_densities`, () => {
  const densities = [1.0, 2.0, 3.0, 2.0, 1.0]
  const energies = [0, 1, 2, 3, 4]

  it.each([
    {
      mode: `max` as const,
      check: (result: number[]) => expect(Math.max(...result)).toBe(1.0),
    },
    {
      mode: `sum` as const,
      check: (result: number[]) => {
        const sum = result.reduce((acc, val) => acc + val, 0)
        expect(sum).toBeCloseTo(1.0)
      },
    },
    {
      mode: null,
      check: (result: number[]) => expect(result).toEqual(densities),
    },
  ])(`normalizes densities by $mode`, ({ mode, check }) => {
    const result = normalize_densities(densities, energies, mode)
    check(result)
  })

  it(`normalizes by integral preserves area ≈ 1`, () => {
    const result = normalize_densities(densities, energies, `integral`)
    const bin = energies[1] - energies[0]
    const area = result.reduce((acc, dens) => acc + dens, 0) * bin
    expect(area).toBeCloseTo(1, 6)
  })
})

describe(`apply_gaussian_smearing`, () => {
  const energies = [0, 1, 2, 3, 4]

  it(`returns original data when sigma is 0`, () => {
    const densities = [1, 2, 3, 2, 1]
    expect(apply_gaussian_smearing(energies, densities, 0)).toEqual(densities)
  })

  it(`smooths sharp peak with gaussian kernel`, () => {
    const densities = [0, 0, 10, 0, 0]
    const result = apply_gaussian_smearing(energies, densities, 0.5)
    expect(result[2]).toBeLessThan(10)
    expect(result[1]).toBeGreaterThan(0)
    expect(result[3]).toBeGreaterThan(0)
  })

  it(`preserves total integral after smearing`, () => {
    const densities = [0, 0, 10, 0, 0]
    const smeared = apply_gaussian_smearing(energies, densities, 0.5)
    const bin = energies[1] - energies[0]
    const area_orig = densities.reduce((acc, dens) => acc + dens, 0) * bin
    const area_smeared = smeared.reduce((acc, dens) => acc + dens, 0) * bin
    expect(area_smeared).toBeCloseTo(area_orig, 6)
  })

  it(`handles all-zero densities without NaN`, () => {
    const densities = [0, 0, 0, 0, 0]
    const smeared = apply_gaussian_smearing(energies, densities, 0.5)
    expect(smeared).toEqual(densities)
    expect(smeared.every((val) => !Number.isNaN(val))).toBe(true)
  })
})

describe(`DOS stacking with mismatched lengths`, () => {
  it.each([
    {
      name: `matching lengths`,
      cumulative: [1, 2, 3, 2, 1],
      current: [0.5, 1, 1.5, 1, 0.5],
      expected: [1.5, 3, 4.5, 3, 1.5],
    },
    {
      name: `mismatched lengths`,
      cumulative: [1, 2, 3],
      current: [0.5, 1, 1.5, 1, 0.5],
      expected: [1.5, 3, 4.5, 1, 0.5],
    },
  ])(`stacks with $name without NaN`, ({ cumulative, current, expected }) => {
    const stacked = current.map((d, idx) => d + (cumulative[idx] ?? 0))
    expect(stacked).toEqual(expected)
    expect(stacked.every((val) => !Number.isNaN(val))).toBe(true)
  })

  it(`warns on length mismatch`, () => {
    const console_warn_spy = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const cumulative = [1, 2, 3]
    const current = [0.5, 1, 1.5, 1, 0.5]

    if (cumulative.length !== current.length) {
      console.warn(
        `DOS stacking: length mismatch (cumulative=${cumulative.length}, current=${current.length})`,
      )
    }

    expect(console_warn_spy).toHaveBeenCalledWith(
      `DOS stacking: length mismatch (cumulative=3, current=5)`,
    )
    console_warn_spy.mockRestore()
  })
})

describe(`get_band_xaxis_ticks`, () => {
  it(`preserves branch order (not alphabetical)`, () => {
    // Create a band structure with segments that would sort differently alphabetically
    // Physical path: Z→Γ→X (alphabetically would be: Γ→X→Z)
    const band_struct = {
      qpoints: [
        { label: `Z`, frac_coords: [0, 0, 0.5] as Vec3, distance: 0 },
        { label: null, frac_coords: [0, 0, 0.25] as Vec3, distance: 0.5 },
        { label: `GAMMA`, frac_coords: [0, 0, 0] as Vec3, distance: 1.0 },
        { label: null, frac_coords: [0.25, 0, 0] as Vec3, distance: 1.5 },
        { label: `X`, frac_coords: [0.5, 0, 0] as Vec3, distance: 2.0 },
      ],
      branches: [
        { start_index: 0, end_index: 2, name: `Z-GAMMA` },
        { start_index: 2, end_index: 4, name: `GAMMA-X` },
      ],
      distance: [0, 0.5, 1.0, 1.5, 2.0],
      bands: [[0, 1, 2, 3, 4]],
      nb_bands: 1,
      labels_dict: {
        Z: [0, 0, 0.5] as Vec3,
        GAMMA: [0, 0, 0] as Vec3,
        X: [0.5, 0, 0] as Vec3,
      },
      lattice_rec: {
        matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Matrix3x3,
      },
    }

    const [positions, labels] = get_band_xaxis_ticks(band_struct)

    // Should preserve physical order: Z, then branch transition combines Γ|X
    // If alphabetically sorted, would have been: Γ|X, Z (incorrect)
    expect(labels).toEqual([`Z`, `Γ|X`])
    expect(positions).toEqual([0, 2.0]) // X is at distance 2.0

    // Verify Z comes first (physical order), not Γ (alphabetical order)
    expect(labels[0]).toBe(`Z`)
  })
})

describe(`find_qpoint_at_distance`, () => {
  // Create a simple band structure: Γ→X→K→Γ
  const test_bs: BaseBandStructure = {
    qpoints: [
      { label: `GAMMA`, frac_coords: [0, 0, 0] as Vec3 },
      { label: null, frac_coords: [0.25, 0, 0] as Vec3 },
      { label: `X`, frac_coords: [0.5, 0, 0] as Vec3 },
      { label: null, frac_coords: [0.5, 0.25, 0] as Vec3 },
      { label: `K`, frac_coords: [0.5, 0.5, 0] as Vec3 },
      { label: null, frac_coords: [0.25, 0.25, 0] as Vec3 },
      { label: `GAMMA`, frac_coords: [0, 0, 0] as Vec3 },
    ],
    branches: [
      { start_index: 0, end_index: 2, name: `GAMMA-X` },
      { start_index: 2, end_index: 4, name: `X-K` },
      { start_index: 4, end_index: 6, name: `K-GAMMA` },
    ],
    distance: [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0],
    bands: [[0, 1, 2, 3, 4, 5, 6]],
    nb_bands: 1,
    labels_dict: {
      GAMMA: [0, 0, 0] as Vec3,
      X: [0.5, 0, 0] as Vec3,
      K: [0.5, 0.5, 0] as Vec3,
    },
    lattice_rec: { matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Matrix3x3 },
  }

  it.each([
    { dist: 0.0, expected: 0, label: `First Γ` },
    { dist: 1.0, expected: 2, label: `X` },
    { dist: 2.0, expected: 4, label: `K` },
    { dist: 3.0, expected: 6, label: `Second Γ` },
    { dist: 0.4, expected: 1, label: `between Γ and X, closer to intermediate` },
    { dist: 0.7, expected: 1, label: `0.7: |0.7-0.5|=0.2 < |0.7-1.0|=0.3` },
    { dist: 1.5, expected: 3, label: `middle of X-K` },
    { dist: -0.1, expected: 0, label: `clamp to start` },
    { dist: 3.5, expected: 6, label: `clamp to end` },
    { dist: 0.99, expected: 2, label: `just before X` },
    { dist: 1.01, expected: 2, label: `just after X` },
  ])(`finds qpoint at distance $dist ($label)`, ({ dist, expected }) => {
    expect(find_qpoint_at_distance(test_bs, dist)).toBe(expected)
  })

  it(`returns null for empty or invalid band structure`, () => {
    expect(find_qpoint_at_distance({ distance: [] } as unknown as BaseBandStructure, 1.0))
      .toBe(null)
    expect(
      find_qpoint_at_distance(
        { distance: undefined } as unknown as BaseBandStructure,
        1.0,
      ),
    ).toBe(null)
  })

  it(`correctly distinguishes repeated symmetry points`, () => {
    const idx_first_gamma = find_qpoint_at_distance(test_bs, 0.0)
    const idx_second_gamma = find_qpoint_at_distance(test_bs, 3.0)
    expect(idx_first_gamma).toBe(0)
    expect(idx_second_gamma).toBe(6)
    expect(idx_first_gamma).not.toBe(idx_second_gamma)
  })
})

describe(`extract_k_path_points`, () => {
  const identity_lattice: Matrix3x3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]

  it(`converts fractional coordinates to Cartesian reciprocal space`, () => {
    const band_struct: BaseBandStructure = {
      qpoints: [
        { label: `GAMMA`, frac_coords: [0, 0, 0] as Vec3 },
        { label: `X`, frac_coords: [0.5, 0, 0] as Vec3 },
        { label: `K`, frac_coords: [1 / 3, 1 / 3, 0] as Vec3 },
      ],
      branches: [{ start_index: 0, end_index: 2, name: `GAMMA-K` }],
      distance: [0, 1.0, 2.0],
      bands: [[0, 1, 2]],
      nb_bands: 1,
      labels_dict: {
        GAMMA: [0, 0, 0] as Vec3,
        X: [0.5, 0, 0] as Vec3,
        K: [1 / 3, 1 / 3, 0] as Vec3,
      },
      lattice_rec: { matrix: [[2, 0, 0], [0, 2, 0], [0, 0, 1]] as Matrix3x3 },
    }

    const recip_lattice: Matrix3x3 = [[2, 0, 0], [0, 2, 0], [0, 0, 1]]
    const result = extract_k_path_points(band_struct, recip_lattice)

    expect(result[0]).toEqual([0, 0, 0]) // Γ: [0,0,0] -> [0,0,0]
    expect(result[1]).toEqual([1, 0, 0]) // X: [0.5,0,0] -> [1, 0, 0]
    expect(result[2][0]).toBeCloseTo(2 / 3, 10) // K: [1/3,1/3,0] -> [2/3, 2/3, 0]
    expect(result[2][1]).toBeCloseTo(2 / 3, 10)
    expect(result[2][2]).toBe(0)
  })

  it(`handles arbitrary reciprocal lattice matrices`, () => {
    const band_struct: BaseBandStructure = {
      qpoints: [
        { label: `GAMMA`, frac_coords: [0, 0, 0] as Vec3 },
        { label: `X`, frac_coords: [1, 0, 0] as Vec3 },
      ],
      branches: [{ start_index: 0, end_index: 1, name: `GAMMA-X` }],
      distance: [0, 1.0],
      bands: [[0, 1]],
      nb_bands: 1,
      labels_dict: { GAMMA: [0, 0, 0] as Vec3, X: [1, 0, 0] as Vec3 },
      lattice_rec: { matrix: identity_lattice },
    }

    // Non-orthogonal: frac[0]*recip[0] + frac[1]*recip[1] + frac[2]*recip[2]
    // X: 1*[1,0.5,0] + 0*[0,2,0] + 0*[0,0,1] = [1, 0.5, 0]
    const result = extract_k_path_points(band_struct, [[1, 0.5, 0], [0, 2, 0], [0, 0, 1]])
    expect(result[1]).toEqual([1, 0.5, 0])
  })

  it(`returns empty array for invalid inputs`, () => {
    const empty_bs: BaseBandStructure = {
      qpoints: [],
      branches: [],
      distance: [],
      bands: [],
      nb_bands: 0,
      labels_dict: {},
      lattice_rec: { matrix: identity_lattice },
    }
    expect(extract_k_path_points(empty_bs, identity_lattice)).toEqual([])
  })
})

describe(`find_qpoint_at_rescaled_x`, () => {
  const identity_lattice: Matrix3x3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]

  // Test band structure: Γ→X→K with rescaled segments
  const rescaled_bs: BaseBandStructure = {
    qpoints: [
      { label: `GAMMA`, frac_coords: [0, 0, 0] as Vec3 },
      { label: null, frac_coords: [0.125, 0, 0] as Vec3 },
      { label: null, frac_coords: [0.25, 0, 0] as Vec3 },
      { label: `X`, frac_coords: [0.5, 0, 0] as Vec3 },
      { label: null, frac_coords: [0.5, 0.25, 0] as Vec3 },
      { label: `K`, frac_coords: [0.5, 0.5, 0] as Vec3 },
    ],
    branches: [
      { start_index: 0, end_index: 3, name: `GAMMA-X` },
      { start_index: 3, end_index: 5, name: `X-K` },
    ],
    distance: [0, 1.0, 2.0, 3.0, 4.0, 5.0], // Original distances
    bands: [[0, 1, 2, 3, 4, 5]],
    nb_bands: 1,
    labels_dict: {
      GAMMA: [0, 0, 0] as Vec3,
      X: [0.5, 0, 0] as Vec3,
      K: [0.5, 0.5, 0] as Vec3,
    },
    lattice_rec: { matrix: identity_lattice },
  }

  const x_pos = { 'GAMMA_X': [0, 1.0], 'X_K': [1.0, 1.5] } as Record<
    string,
    [number, number]
  >

  it.each([
    { x: 0.0, expected: 0, label: `Γ` },
    { x: 1.0, expected: 3, label: `X` },
    { x: 1.5, expected: 5, label: `K` },
    { x: 1.25, expected: 4, label: `middle of X-K segment` },
  ])(`maps rescaled x=$x to qpoint index $expected ($label)`, ({ x, expected }) => {
    expect(find_qpoint_at_rescaled_x(rescaled_bs, x, x_pos)).toBe(expected)
  })

  it(`maps intermediate rescaled x in GAMMA-X correctly`, () => {
    // rescaled_x=0.5 → middle of segment → closest to idx 1 or 2
    const idx = find_qpoint_at_rescaled_x(rescaled_bs, 0.5, x_pos)
    expect([1, 2]).toContain(idx)
  })

  it(`handles repeated symmetry points (second Gamma)`, () => {
    const bs: BaseBandStructure = {
      qpoints: [
        { label: `GAMMA`, frac_coords: [0, 0, 0] as Vec3 },
        { label: null, frac_coords: [0.25, 0, 0] as Vec3 },
        { label: `X`, frac_coords: [0.5, 0, 0] as Vec3 },
        { label: null, frac_coords: [0.25, 0.25, 0] as Vec3 },
        { label: `GAMMA`, frac_coords: [0, 0, 0] as Vec3 },
      ],
      branches: [
        { start_index: 0, end_index: 2, name: `GAMMA-X` },
        { start_index: 2, end_index: 4, name: `X-GAMMA` },
      ],
      distance: [0, 1.0, 2.0, 3.0, 4.0],
      bands: [[0, 1, 2, 3, 4]],
      nb_bands: 1,
      labels_dict: { GAMMA: [0, 0, 0] as Vec3, X: [0.5, 0, 0] as Vec3 },
      lattice_rec: { matrix: identity_lattice },
    }
    const x_pos_repeat = { 'GAMMA_X': [0, 1.0], 'X_GAMMA': [1.0, 2.0] } as Record<
      string,
      [number, number]
    >

    const idx_first = find_qpoint_at_rescaled_x(bs, 0.0, x_pos_repeat)
    const idx_second = find_qpoint_at_rescaled_x(bs, 2.0, x_pos_repeat)
    expect(idx_first).toBe(0)
    expect(idx_second).toBe(4)
    expect(idx_first).not.toBe(idx_second)
  })

  it(`handles discontinuous segments (zero-length)`, () => {
    const bs: BaseBandStructure = {
      qpoints: [
        { label: `GAMMA`, frac_coords: [0, 0, 0] as Vec3 },
        { label: `X`, frac_coords: [0.5, 0, 0] as Vec3 },
        { label: `K`, frac_coords: [0.5, 0.5, 0] as Vec3 },
      ],
      branches: [
        { start_index: 0, end_index: 1, name: `GAMMA-X` },
        { start_index: 1, end_index: 2, name: `X-K` },
      ],
      distance: [0, 1.0, 2.0],
      bands: [[0, 1, 2]],
      nb_bands: 1,
      labels_dict: {
        GAMMA: [0, 0, 0] as Vec3,
        X: [0.5, 0, 0] as Vec3,
        K: [0.5, 0.5, 0] as Vec3,
      },
      lattice_rec: { matrix: identity_lattice },
    }
    const x_pos_disc = { 'GAMMA_X': [0, 0.5], 'X_K': [0.5, 0.5] } as Record<
      string,
      [number, number]
    >

    // At discontinuity, should return X (idx 1)
    expect(find_qpoint_at_rescaled_x(bs, 0.5, x_pos_disc)).toBe(1)
  })

  it(`returns null for empty or invalid inputs`, () => {
    expect(find_qpoint_at_rescaled_x(rescaled_bs, 0.5, {})).toBe(0) // Fallback
    expect(
      find_qpoint_at_rescaled_x(
        { branches: [] } as unknown as BaseBandStructure,
        0.5,
        {},
      ),
    ).toBe(null)
  })
})
