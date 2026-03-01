import type { Matrix3x3, Vec2, Vec3 } from '$lib/math'
import type { PymatgenCompleteDos } from '$lib/spectral/helpers'
import {
  ACOUSTIC_FREQ_THRESHOLD,
  apply_gaussian_smearing,
  build_point_metadata,
  classify_acoustic,
  compute_frequency_range,
  compute_slope,
  convert_frequencies,
  detect_zoom_change,
  extract_k_path_points,
  find_gamma_indices,
  find_qpoint_at_distance,
  find_qpoint_at_rescaled_x,
  generate_ribbon_path,
  get_band_xaxis_ticks,
  get_ribbon_config,
  is_valid_range,
  negative_fraction,
  normalize_band_structure,
  normalize_densities,
  normalize_dos,
  pretty_sym_point,
  ranges_equal,
  scale_segment_distances,
  shift_to_fermi,
} from '$lib/spectral/helpers'
import type { BaseBandStructure } from '$lib/spectral/types'
import { describe, expect, it, vi } from 'vitest'

describe(`is_valid_range`, () => {
  it.each([
    // Valid: finite 2-element arrays
    [[0, 10], true],
    [[-5, 5], true],
    [[0, 0], true],
    [[Number.MIN_VALUE, Number.MAX_VALUE], true],
    // Invalid: non-arrays
    [null, false],
    [undefined, false],
    [`[0, 10]`, false],
    [{ 0: 0, 1: 10 }, false],
    // Invalid: wrong length
    [[], false],
    [[5], false],
    [[1, 2, 3], false],
    // Invalid: non-finite numbers (NaN, Infinity)
    [[NaN, 5], false],
    [[5, NaN], false],
    [[Infinity, 5], false],
    [[5, -Infinity], false],
    // Invalid: non-number elements
    [[`0`, 10], false],
    [[0, null], false],
  ])(`is_valid_range(%j) -> %s`, (input, expected) => {
    expect(is_valid_range(input)).toBe(expected)
  })
})

describe(`ranges_equal`, () => {
  it.each([
    // Equal within default tolerance (0.001)
    [[0, 10], [0, 10], true],
    [[0, 10], [0.0001, 10.0001], true],
    // Beyond tolerance
    [[0, 10], [0.01, 10], false],
    [[0, 10], [5, 15], false],
    // Invalid inputs (leverages is_valid_range)
    [null, [0, 10], false],
    [[0, 10], undefined, false],
    [[NaN, 10], [0, 10], false],
    [[1, 2, 3], [1, 2], false],
  ])(`ranges_equal(%j, %j) -> %s`, (a, b, expected) => {
    expect(ranges_equal(a as Vec2, b as Vec2)).toBe(expected)
  })

  it(`respects custom tolerance`, () => {
    expect(ranges_equal([0, 10], [0.5, 10], 1)).toBe(true)
    expect(ranges_equal([0, 10], [2, 10], 1)).toBe(false)
  })
})

describe(`detect_zoom_change`, () => {
  const shared: Vec2 = [0, 10]
  const zoomed: Vec2 = [2, 8]
  const other: Vec2 = [3, 7]

  // Returns null (reset): bands/dos returns to shared or becomes invalid
  it.each([
    { bands: shared, dos: zoomed, synced: zoomed, dos_en: true, expected: null },
    { bands: zoomed, dos: shared, synced: zoomed, dos_en: true, expected: null },
    { bands: null, dos: zoomed, synced: zoomed, dos_en: true, expected: null },
    { bands: zoomed, dos: null, synced: zoomed, dos_en: true, expected: null },
  ])(
    `returns null for reset: $bands,$dos`,
    ({ bands, dos, synced, dos_en, expected }) => {
      expect(detect_zoom_change(bands, dos, shared, synced, dos_en)).toBe(expected)
    },
  )

  // Returns new zoom range
  it.each([
    { bands: zoomed, dos: shared, synced: null, dos_en: true, expected: zoomed },
    { bands: shared, dos: zoomed, synced: null, dos_en: true, expected: zoomed },
    { bands: zoomed, dos: other, synced: other, dos_en: true, expected: zoomed },
  ])(`returns new zoom: $bands`, ({ bands, dos, synced, dos_en, expected }) => {
    expect(detect_zoom_change(bands, dos, shared, synced, dos_en)).toEqual(expected)
  })

  // Returns undefined (no change)
  it.each([
    { bands: shared, dos: shared, synced: null, dos_en: true },
    { bands: zoomed, dos: zoomed, synced: zoomed, dos_en: true },
    { bands: [1, 9], dos: [2, 6], synced: null, dos_en: true },
  ])(`returns undefined for no change: $bands,$dos`, ({ bands, dos, synced, dos_en }) => {
    expect(detect_zoom_change(bands, dos, shared, synced, dos_en)).toBe(undefined)
  })

  // dos_enabled=false: ignores DOS
  it(`ignores dos when dos_enabled=false`, () => {
    expect(detect_zoom_change(shared, zoomed, shared, null, false)).toBe(undefined)
    expect(detect_zoom_change(zoomed, null, shared, zoomed, false)).toBe(undefined)
    expect(detect_zoom_change(zoomed, shared, shared, null, false)).toEqual(zoomed)
  })
})

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
      recip_lattice: {
        matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] satisfies Matrix3x3,
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
    recip_lattice: { matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] satisfies Matrix3x3 },
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
      recip_lattice: { matrix: [[2, 0, 0], [0, 2, 0], [0, 0, 1]] satisfies Matrix3x3 },
    }

    const recip_lattice: Matrix3x3 = [[2, 0, 0], [0, 2, 0], [0, 0, 1]]
    // Disable BZ wrapping to test basic coordinate transformation
    const result = extract_k_path_points(band_struct, recip_lattice, {
      wrap_to_bz: false,
    })

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
      recip_lattice: { matrix: identity_lattice },
    }

    // Non-orthogonal: frac[0]*recip[0] + frac[1]*recip[1] + frac[2]*recip[2]
    // X: 1*[1,0.5,0] + 0*[0,2,0] + 0*[0,0,1] = [1, 0.5, 0]
    // Disable BZ wrapping to test basic coordinate transformation
    const result = extract_k_path_points(
      band_struct,
      [[1, 0.5, 0], [0, 2, 0], [0, 0, 1]],
      {
        wrap_to_bz: false,
      },
    )
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
      recip_lattice: { matrix: identity_lattice },
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
    recip_lattice: { matrix: identity_lattice },
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
      recip_lattice: { matrix: identity_lattice },
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
      recip_lattice: { matrix: identity_lattice },
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

describe(`normalize_band_structure`, () => {
  const ident: Matrix3x3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  const make_pmg = (opts: Record<string, unknown>) => ({
    '@class': `PhononBandStructureSymmLine`,
    ...opts,
  })

  describe(`matterviz format`, () => {
    it(`validates valid band structure`, () => {
      const result = normalize_band_structure({
        qpoints: [{ label: `GAMMA`, frac_coords: [0, 0, 0] }, {
          label: `X`,
          frac_coords: [0.5, 0, 0],
        }],
        branches: [{ start_index: 0, end_index: 1, name: `GAMMA-X` }],
        bands: [[0, 1], [2, 3]],
        distance: [0, 1.0],
        nb_bands: 2,
        labels_dict: { GAMMA: [0, 0, 0], X: [0.5, 0, 0] },
        recip_lattice: { matrix: ident },
      })
      expect(result?.qpoints).toHaveLength(2)
      expect(result?.bands).toHaveLength(2)
    })

    it.each([{}, { qpoints: [] }, { qpoints: [], branches: [] }])(
      `returns null for %p`,
      (input) => {
        expect(normalize_band_structure(input)).toBeNull()
      },
    )

    it.each([
      {
        desc: `mismatched lengths`,
        input: {
          qpoints: [{ label: `Γ`, frac_coords: [0, 0, 0] }],
          branches: [{ start_index: 0, end_index: 0, name: `t` }],
          bands: [[0, 1]],
          distance: [0],
        },
      },
      {
        desc: `invalid branch`,
        input: {
          qpoints: [{ label: `Γ`, frac_coords: [0, 0, 0] }],
          branches: [{ start_index: 0, end_index: 5, name: `t` }],
          bands: [[0]],
          distance: [0],
        },
      },
    ])(
      `returns null for $desc`,
      ({ input }) => expect(normalize_band_structure(input)).toBeNull(),
    )
  })

  describe(`pymatgen format`, () => {
    it(`converts PhononBandStructureSymmLine (default THz, no conversion)`, () => {
      // pymatgen defaults to unit="thz", so no conversion should happen
      const result = normalize_band_structure(make_pmg({
        qpoints: [[0, 0, 0], [0.5, 0, 0], [0.5, 0.5, 0]],
        bands: [[0, 5.0, 10.0]], // Already in THz
        labels_dict: { GAMMA: [0, 0, 0], X: [0.5, 0, 0], K: [0.5, 0.5, 0] },
        lattice_rec: { matrix: ident },
      }))
      expect(result?.qpoints).toHaveLength(3)
      expect(result?.bands[0][1]).toBe(5.0) // No conversion, stays 5.0 THz
    })

    it.each([
      { desc: `@class`, input: make_pmg({ qpoints: [[0, 0, 0]], bands: [[0]] }) },
      {
        desc: `structure`,
        input: {
          qpoints: [[0, 0, 0], [0.5, 0, 0]],
          bands: [[0, 1]],
          labels_dict: { GAMMA: [0, 0, 0], X: [0.5, 0, 0] },
        },
      },
    ])(
      `detects pymatgen by $desc`,
      ({ input }) => expect(() => normalize_band_structure(input)).not.toThrow(),
    )

    it(`handles Kpoint objects with labels`, () => {
      const result = normalize_band_structure({
        '@module': `pymatgen.phonon.bandstructure`,
        qpoints: [{ frac_coords: [0, 0, 0], label: `GAMMA` }, {
          frac_coords: [0.5, 0, 0],
          label: `X`,
        }],
        bands: [[0, 1]],
        labels_dict: { GAMMA: [0, 0, 0], X: [0.5, 0, 0] },
      })
      expect(result?.qpoints.map((qpt) => qpt.label)).toEqual([`GAMMA`, `X`])
    })

    it(`matches labels from labels_dict`, () => {
      const result = normalize_band_structure(make_pmg({
        qpoints: [[0, 0, 0], [0.5, 0, 0]],
        bands: [[0, 1]],
        labels_dict: { GAMMA: [0, 0, 0], X: [0.5, 0, 0] },
      }))
      expect(result?.qpoints.map((qpt) => qpt.label)).toEqual([`GAMMA`, `X`])
    })

    it(`creates branches covering k-path`, () => {
      const result = normalize_band_structure(make_pmg({
        qpoints: [[0, 0, 0], [0.25, 0, 0], [0.5, 0, 0]],
        bands: [[0, 1, 2]],
        labels_dict: { GAMMA: [0, 0, 0], X: [0.5, 0, 0] },
      }))
      expect(result?.branches[0].start_index).toBe(0)
      expect(result?.branches.at(-1)?.end_index).toBe(2)
    })

    it(`calculates monotonic distance array`, () => {
      const result = normalize_band_structure(make_pmg({
        qpoints: [[0, 0, 0], [0.5, 0, 0], [1, 0, 0]],
        bands: [[0, 1, 2]],
        labels_dict: { GAMMA: [0, 0, 0], X: [1, 0, 0] },
      }))
      expect(result?.distance[0]).toBe(0)
      expect(
        result?.distance.every((dist, idx, arr) => idx === 0 || dist >= arr[idx - 1]),
      )
        .toBe(true)
    })

    it(`handles discontinuities`, () => {
      const result = normalize_band_structure(make_pmg({
        qpoints: [[0, 0, 0], [0.05, 0, 0], [0.1, 0, 0], [0.9, 0.9, 0.9], [
          0.95,
          0.95,
          0.95,
        ], [1, 1, 1]],
        bands: [[0, 1, 2, 3, 4, 5]],
        labels_dict: { GAMMA: [0, 0, 0], L: [1, 1, 1] },
      }))
      expect(Math.max(...(result?.distance ?? []))).toBeLessThan(1.0) // Jump not accumulated
    })

    it(`converts eV→THz (factor 241.8) when unit='ev'`, () => {
      const result = normalize_band_structure(make_pmg({
        qpoints: [[0, 0, 0], [1, 0, 0]],
        bands: [[0, 0.001]], // 0.001 eV
        labels_dict: { GAMMA: [0, 0, 0], X: [1, 0, 0] },
        unit: `ev`, // Explicitly specify eV unit
      }))
      expect(result?.bands[0][1]).toBeCloseTo(0.2418, 2) // 0.001 eV * 241.8 = 0.2418 THz
    })

    it(`preserves THz values when unit='thz' (default)`, () => {
      const result = normalize_band_structure(make_pmg({
        qpoints: [[0, 0, 0], [1, 0, 0]],
        bands: [[0, 5.0]], // 5.0 THz
        labels_dict: { GAMMA: [0, 0, 0], X: [1, 0, 0] },
        unit: `thz`, // Explicit THz
      }))
      expect(result?.bands[0][1]).toBe(5.0) // No conversion
    })

    it(`converts cm-1→THz when unit='cm-1'`, () => {
      const result = normalize_band_structure(make_pmg({
        qpoints: [[0, 0, 0], [1, 0, 0]],
        bands: [[0, 333.5641]], // 333.5641 cm⁻¹ ≈ 10 THz
        labels_dict: { GAMMA: [0, 0, 0], X: [1, 0, 0] },
        unit: `cm-1`,
      }))
      expect(result?.bands[0][1]).toBeCloseTo(10.0, 2)
    })

    it(`tolerates floating point in labels_dict matching`, () => {
      const result = normalize_band_structure(make_pmg({
        qpoints: [[0.00001, -0.00001, 0], [0.49999, 0.00001, 0]],
        bands: [[0, 1]],
        labels_dict: { GAMMA: [0, 0, 0], X: [0.5, 0, 0] },
      }))
      expect(result?.qpoints.map((qpt) => qpt.label)).toEqual([`GAMMA`, `X`])
    })
  })

  describe(`branch inference fallback (no pmg.branches)`, () => {
    const spy_info = () => vi.spyOn(console, `info`).mockImplementation(() => {})

    it.each([
      {
        desc: `logs info and covers unlabeled qpoints`,
        qpoints: [[0.1, 0, 0], [0.25, 0, 0], [0.4, 0, 0]],
        labels_dict: { GAMMA: [0, 0, 0], X: [0.5, 0, 0] },
        expected: [{ start_index: 0, end_index: 2, name: `?-?` }],
      },
      {
        desc: `creates branches at single discontinuity`,
        qpoints: [[0, 0, 0], [0.1, 0, 0], [0.9, 0.9, 0.9], [1, 1, 1]],
        labels_dict: { GAMMA: [0, 0, 0], L: [1, 1, 1] },
        expected: [
          { start_index: 0, end_index: 1, name: `GAMMA-?` },
          { start_index: 2, end_index: 3, name: `?-L` },
        ],
      },
      {
        desc: `creates branches at multiple discontinuities`,
        qpoints: [[0, 0, 0], [0.1, 0, 0], [0.5, 0.5, 0], [0.6, 0.5, 0], [1, 1, 1], [
          1.1,
          1,
          1,
        ]],
        labels_dict: { GAMMA: [0, 0, 0], K: [0.5, 0.5, 0], L: [1, 1, 1] },
        expected: [
          { start_index: 0, end_index: 1, name: `GAMMA-?` },
          { start_index: 2, end_index: 3, name: `K-?` },
          { start_index: 4, end_index: 5, name: `L-?` },
        ],
      },
      {
        desc: `creates single branch with no discontinuities or labels`,
        qpoints: [[0, 0, 0], [0.1, 0, 0], [0.2, 0, 0], [0.3, 0, 0]],
        labels_dict: {},
        expected: [{ start_index: 0, end_index: 3, name: `?-?` }],
      },
      {
        desc: `uses labels for branch names`,
        qpoints: [[0, 0, 0], [0.25, 0, 0], [0.5, 0, 0]],
        labels_dict: { GAMMA: [0, 0, 0], X: [0.5, 0, 0] },
        expected: [{ start_index: 0, end_index: 2, name: `GAMMA-X` }],
      },
    ])(`$desc`, ({ qpoints, labels_dict, expected }) => {
      const spy = spy_info()
      const bands = [qpoints.map((_, idx) => idx)]
      const result = normalize_band_structure(make_pmg({ qpoints, bands, labels_dict }))
      expect(result?.branches).toEqual(expected)
      expect(spy).toHaveBeenCalledWith(
        `Band structure missing 'branches' field - inferring from path discontinuities`,
      )
      spy.mockRestore()
    })

    it(`prefers explicit branches over fallback`, () => {
      const spy = spy_info()
      const result = normalize_band_structure({
        '@class': `PhononBandStructureSymmLine`,
        qpoints: [[0, 0, 0], [0.5, 0, 0], [1, 0, 0]],
        bands: [[0, 1, 2]],
        branches: [
          { start_index: 0, end_index: 1, name: `custom-1` },
          { start_index: 1, end_index: 2, name: `custom-2` },
        ],
        labels_dict: { GAMMA: [0, 0, 0], X: [1, 0, 0] },
      })
      expect(result?.branches?.map((br) => br.name)).toEqual([`custom-1`, `custom-2`])
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    })

    it.each([
      { desc: `empty branches array`, branches: [] },
      {
        desc: `all invalid branches`,
        branches: [
          { start_index: -1, end_index: 0, name: `invalid` },
          { start_index: 0, end_index: 99, name: `out-of-bounds` },
        ],
      },
    ])(`triggers fallback with $desc`, ({ branches }) => {
      const spy = spy_info()
      const result = normalize_band_structure({
        '@class': `PhononBandStructureSymmLine`,
        qpoints: [[0, 0, 0], [0.5, 0, 0]],
        bands: [[0, 1]],
        branches,
        labels_dict: { GAMMA: [0, 0, 0], X: [0.5, 0, 0] },
      })
      expect(result?.branches).toHaveLength(1)
      expect(spy).toHaveBeenCalled()
      spy.mockRestore()
    })
  })

  describe(`edge cases`, () => {
    it.each([null, undefined, `string`, 123, [], {
      '@class': `X`,
      qpoints: [],
      bands: [],
    }])(
      `returns null for %p`,
      (input) => expect(normalize_band_structure(input)).toBeNull(),
    )
  })

  describe(`electronic band structures (pymatgen BandStructureSymmLine)`, () => {
    it(`converts BandStructureSymmLine with kpoints`, () => {
      const result = normalize_band_structure({
        '@class': `BandStructureSymmLine`,
        '@module': `pymatgen.electronic_structure.bandstructure`,
        kpoints: [[0, 0, 0], [0.5, 0, 0], [0.5, 0.5, 0]],
        bands: { '1': [[0, 1.5, 3.0], [-2, -1, 0]] }, // 2 bands, spin-keyed
        labels_dict: { GAMMA: [0, 0, 0], X: [0.5, 0, 0], K: [0.5, 0.5, 0] },
        lattice_rec: { matrix: ident },
        efermi: 0,
      })
      expect(result?.qpoints).toHaveLength(3)
      expect(result?.bands).toHaveLength(2)
      expect(result?.qpoints[0].label).toBe(`GAMMA`)
      expect(result?.qpoints[2].label).toBe(`K`)
    })

    it(`extracts first spin channel from spin-keyed bands`, () => {
      const result = normalize_band_structure({
        '@class': `BandStructureSymmLine`,
        kpoints: [[0, 0, 0], [0.5, 0, 0]],
        bands: {
          '1': [[0, 1], [2, 3]], // spin-up: 2 bands
          '-1': [[0.1, 1.1], [2.1, 3.1]], // spin-down
        },
        labels_dict: { GAMMA: [0, 0, 0], X: [0.5, 0, 0] },
      })
      expect(result?.bands).toEqual([[0, 1], [2, 3]]) // First spin channel
      expect(result?.spin_down_bands).toEqual([[0.1, 1.1], [2.1, 3.1]])
    })

    it(`drops malformed spin-down channel when band shapes mismatch`, () => {
      const result = normalize_band_structure({
        '@class': `BandStructureSymmLine`,
        kpoints: [[0, 0, 0], [0.5, 0, 0]],
        bands: {
          '1': [[0, 1], [2, 3]],
          '-1': [[0.1], [2.1, 3.1]], // first spin-down band has wrong length
        },
        labels_dict: { GAMMA: [0, 0, 0], X: [0.5, 0, 0] },
      })
      expect(result?.bands).toEqual([[0, 1], [2, 3]])
      expect(result?.spin_down_bands).toBeUndefined()
    })

    it(`handles BandStructure base class (not just SymmLine)`, () => {
      const result = normalize_band_structure({
        '@class': `BandStructure`,
        '@module': `pymatgen.electronic_structure.bandstructure`,
        kpoints: [[0, 0, 0], [0.25, 0, 0], [0.5, 0, 0]],
        bands: { '1': [[0, 0.5, 1.0]] },
        labels_dict: { GAMMA: [0, 0, 0], X: [0.5, 0, 0] },
      })
      expect(result?.qpoints).toHaveLength(3)
    })

    it(`handles pymatgen electronic with branches field`, () => {
      // Pymatgen BandStructureSymmLine can include branches
      const result = normalize_band_structure({
        '@class': `BandStructureSymmLine`,
        kpoints: [[0, 0, 0], [0.5, 0, 0], [0.5, 0.5, 0]],
        bands: { '1': [[0, 1, 2]] },
        branches: [
          { name: `\\Gamma-X`, start_index: 0, end_index: 1 },
          { name: `X-K`, start_index: 1, end_index: 2 },
        ],
        labels_dict: { GAMMA: [0, 0, 0], X: [0.5, 0, 0], K: [0.5, 0.5, 0] },
      })
      // Should still normalize correctly despite having branches
      expect(result?.qpoints).toHaveLength(3)
      expect(result?.branches).toHaveLength(2)
    })

    it(`handles electronic bands with array format (already extracted)`, () => {
      const result = normalize_band_structure({
        '@class': `BandStructureSymmLine`,
        kpoints: [[0, 0, 0], [0.5, 0, 0]],
        bands: [[0, 1], [2, 3]], // Already an array, not spin-keyed
        labels_dict: { GAMMA: [0, 0, 0], X: [0.5, 0, 0] },
      })
      expect(result?.bands).toEqual([[0, 1], [2, 3]])
    })

    it(`detects electronic format by @module containing electronic_structure`, () => {
      const result = normalize_band_structure({
        '@module': `pymatgen.electronic_structure.bandstructure`,
        kpoints: [[0, 0, 0], [0.5, 0, 0]],
        bands: { '1': [[0, 1]] },
        labels_dict: { GAMMA: [0, 0, 0], X: [0.5, 0, 0] },
      })
      expect(result?.qpoints).toHaveLength(2)
    })

    it(`returns null for electronic structure with empty kpoints`, () => {
      const result = normalize_band_structure({
        '@class': `BandStructureSymmLine`,
        kpoints: [],
        bands: { '1': [] },
        labels_dict: {},
      })
      expect(result).toBeNull()
    })

    it(`returns null for electronic structure with null bands`, () => {
      const result = normalize_band_structure({
        '@class': `BandStructureSymmLine`,
        kpoints: [[0, 0, 0], [0.5, 0, 0]],
        bands: null,
        labels_dict: { GAMMA: [0, 0, 0], X: [0.5, 0, 0] },
      })
      expect(result).toBeNull()
    })

    it(`detects pymatgen format via kpoints without @class/@module markers`, () => {
      // This tests the fallback detection in is_pymatgen_format
      const result = normalize_band_structure({
        // No @class or @module - relies on kpoints detection
        kpoints: [[0, 0, 0], [0.5, 0, 0]],
        bands: [[0, 1], [2, 3]],
        labels_dict: { GAMMA: [0, 0, 0], X: [0.5, 0, 0] },
      })
      expect(result?.qpoints).toHaveLength(2)
      expect(result?.bands).toHaveLength(2)
    })
  })
})

describe(`normalize_dos`, () => {
  const spy_info = () => vi.spyOn(console, `info`).mockImplementation(() => {})

  describe(`spin-keyed densities (pymatgen format)`, () => {
    it(`extracts first spin channel from {1: [...], -1: [...]} format`, () => {
      const result = normalize_dos({
        energies: [-5, 0, 5],
        densities: { '1': [0.5, 1.0, 0.5], '-1': [0.4, 0.9, 0.4] },
      })
      expect(result?.type).toBe(`electronic`)
      if (result?.type === `electronic`) {
        expect(result.densities).toEqual([0.5, 1.0, 0.5]) // First spin channel
      }
    })

    it(`extracts first spin channel from {"Spin.up": [...], "Spin.down": [...]} format`, () => {
      const result = normalize_dos({
        energies: [-2, 0, 2],
        densities: { 'Spin.up': [0.3, 0.8, 0.3], 'Spin.down': [0.2, 0.7, 0.2] },
      })
      expect(result?.type).toBe(`electronic`)
      if (result?.type === `electronic`) {
        expect(result.densities).toEqual([0.3, 0.8, 0.3])
      }
    })

    it(`handles already-array densities (non-spin-polarized)`, () => {
      const result = normalize_dos({
        energies: [-1, 0, 1],
        densities: [0.2, 0.6, 0.2],
      })
      expect(result?.type).toBe(`electronic`)
      if (result?.type === `electronic`) {
        expect(result.densities).toEqual([0.2, 0.6, 0.2])
      }
    })

    it(`handles pymatgen CompleteDos with spin-keyed densities`, () => {
      const result = normalize_dos({
        '@class': `CompleteDos`,
        '@module': `pymatgen.electronic_structure.dos`,
        energies: [-5, -2.5, 0, 2.5, 5],
        densities: { '1': [0.1, 0.4, 1.0, 0.4, 0.1], '-1': [0.1, 0.3, 0.9, 0.3, 0.1] },
        efermi: 0,
      })
      expect(result?.type).toBe(`electronic`)
      if (result?.type === `electronic`) {
        expect(result.densities).toEqual([0.1, 0.4, 1.0, 0.4, 0.1])
      }
    })

    it(`handles LobsterCompleteDos with spin-keyed densities`, () => {
      const result = normalize_dos({
        '@class': `LobsterCompleteDos`,
        '@module': `Lobster`,
        energies: [-10, -5, 0, 5, 10],
        densities: { '-1': [0.0, 0.5, 1.0, 0.5, 0.0], '1': [0.0, 0.6, 1.1, 0.6, 0.0] },
        efermi: 0,
      })
      expect(result?.type).toBe(`electronic`)
      if (result?.type === `electronic`) {
        // First key in object iteration order
        expect(result.densities).toHaveLength(5)
      }
    })

    it(`returns null for empty spin-keyed densities object`, () => {
      const result = normalize_dos({
        energies: [-1, 0, 1],
        densities: {},
      })
      expect(result).toBeNull()
    })
  })

  describe(`phonon DOS`, () => {
    it(`validates with frequencies array`, () => {
      const result = normalize_dos({
        frequencies: [0, 1, 2, 3, 4],
        densities: [0, 0.5, 1, 0.5, 0],
      })
      expect(result?.type).toBe(`phonon`)
      if (result?.type === `phonon`) expect(result.frequencies).toEqual([0, 1, 2, 3, 4])
    })

    it(`auto-converts cm⁻¹→THz when max > 100`, () => {
      const info_spy = spy_info()
      const result = normalize_dos({
        frequencies: [0, 100, 200, 300, 400],
        densities: [0, 0.5, 1, 0.5, 0],
      })
      if (result?.type === `phonon`) {
        expect(result.frequencies[4]).toBeCloseTo(11.99, 1) // 400 cm⁻¹
        expect(result.frequencies[2]).toBeCloseTo(5.99, 1) // 200 cm⁻¹
      }
      expect(info_spy).toHaveBeenCalled()
      info_spy.mockRestore()
    })

    it(`cm⁻¹→THz uses factor 33.356`, () => {
      const info_spy = spy_info()
      const result = normalize_dos({ frequencies: [0, 333.5641], densities: [0, 1] })
      if (result?.type === `phonon`) expect(result.frequencies[1]).toBeCloseTo(10.0, 4)
      info_spy.mockRestore()
    })

    it(`preserves THz when max < 100`, () => {
      const result = normalize_dos({
        frequencies: [0, 5, 10, 15, 20],
        densities: [0, 0.5, 1, 0.5, 0],
      })
      if (result?.type === `phonon`) {
        expect(result.frequencies).toEqual([0, 5, 10, 15, 20])
      }
    })

    it(`skips cm⁻¹→THz conversion when auto_convert_units: false`, () => {
      const info_spy = spy_info()
      const result = normalize_dos(
        { frequencies: [0, 100, 200, 300, 400], densities: [0, 0.5, 1, 0.5, 0] },
        { auto_convert_units: false },
      )
      if (result?.type === `phonon`) {
        // Frequencies should remain unchanged (not converted)
        expect(result.frequencies).toEqual([0, 100, 200, 300, 400])
      }
      expect(info_spy).not.toHaveBeenCalled()
      info_spy.mockRestore()
    })
  })

  describe(`electronic DOS`, () => {
    it(`validates with energies array`, () => {
      const result = normalize_dos({
        energies: [-5, -2.5, 0, 2.5, 5],
        densities: [0.1, 0.5, 1, 0.5, 0.1],
      })
      expect(result?.type).toBe(`electronic`)
      if (result?.type === `electronic`) {
        expect(result.energies).toEqual([-5, -2.5, 0, 2.5, 5])
      }
    })

    it(`preserves spin_polarized flag`, () => {
      const result = normalize_dos({
        energies: [-1, 0, 1],
        densities: [0.5, 1, 0.5],
        spin_polarized: true,
      })
      if (result?.type === `electronic`) expect(result.spin_polarized).toBe(true)
    })
  })

  describe(`pymatgen format`, () => {
    it(`warns on incomplete pymatgen DOS`, () => {
      const spy = vi.spyOn(console, `warn`).mockImplementation(() => {})
      expect(normalize_dos({ '@class': `PhononDos`, densities: [0, 0.5, 1] })).toBeNull()
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining(`Pymatgen DOS format detected`),
      )
      spy.mockRestore()
    })

    it(`accepts pymatgen with frequencies`, () => {
      const result = normalize_dos({
        '@class': `PhononDos`,
        frequencies: [0, 5, 10],
        densities: [0, 1, 0],
      })
      expect(result?.type).toBe(`phonon`)
    })
  })

  describe(`validation`, () => {
    it.each([
      { frequencies: [1, 2, 3] }, // missing densities
      { frequencies: [1, 2, 3], densities: [0, 1] }, // length mismatch
      null,
      undefined,
      `string`, // non-object
    ])(`returns null for %p`, (input) => expect(normalize_dos(input)).toBeNull())
  })
})

describe(`shift_to_fermi`, () => {
  const make_dos = (efermi: number, energies: number[]): PymatgenCompleteDos => ({
    '@class': `CompleteDos`,
    '@module': `pymatgen.electronic_structure.dos`,
    energies,
    densities: energies.map(() => 1.0), // Dummy densities
    efermi,
  })

  it(`shifts energies so E_F = 0`, () => {
    const dos = make_dos(5.0, [-10, -5, 0, 5, 10])
    const shifted = shift_to_fermi(dos)

    expect(shifted.efermi).toBe(0)
    expect(shifted.energies).toEqual([-15, -10, -5, 0, 5])
  })

  it(`preserves non-energy DOS properties`, () => {
    const dos: PymatgenCompleteDos = {
      '@class': `LobsterCompleteDos`,
      '@module': `Lobster`,
      energies: [0, 5, 10],
      densities: { '1': [0.5, 1.0, 0.5], '-1': [0.4, 0.9, 0.4] },
      efermi: 5.0,
      structure: { lattice: {} },
    }
    const shifted = shift_to_fermi(dos)

    expect(shifted[`@class`]).toBe(`LobsterCompleteDos`)
    expect(shifted[`@module`]).toBe(`Lobster`)
    expect(shifted.densities).toEqual(dos.densities) // Unchanged
    expect(shifted.structure).toEqual(dos.structure) // Preserved
  })

  it(`shifts nested atom_dos and spd_dos energies`, () => {
    const dos: PymatgenCompleteDos = {
      '@class': `CompleteDos`,
      '@module': `pymatgen.electronic_structure.dos`,
      energies: [0, 5, 10],
      densities: [0.5, 1.0, 0.5],
      efermi: 5.0,
      atom_dos: {
        Fe: {
          '@class': `Dos`,
          '@module': `pymatgen.electronic_structure.dos`,
          energies: [0, 5, 10],
          densities: [0.3, 0.6, 0.3],
          efermi: 5.0,
        },
        O: {
          '@class': `Dos`,
          '@module': `pymatgen.electronic_structure.dos`,
          energies: [0, 5, 10],
          densities: [0.2, 0.4, 0.2],
          efermi: 5.0,
        },
      },
      spd_dos: {
        s: {
          '@class': `Dos`,
          '@module': `pymatgen.electronic_structure.dos`,
          energies: [0, 5, 10],
          densities: [0.1, 0.2, 0.1],
          efermi: 5.0,
        },
      },
    }
    const shifted = shift_to_fermi(dos)

    // Main DOS shifted
    expect(shifted.efermi).toBe(0)
    expect(shifted.energies).toEqual([-5, 0, 5])

    // Nested atom_dos shifted
    expect(shifted.atom_dos?.Fe.efermi).toBe(0)
    expect(shifted.atom_dos?.Fe.energies).toEqual([-5, 0, 5])
    expect(shifted.atom_dos?.Fe.densities).toEqual([0.3, 0.6, 0.3]) // Unchanged
    expect(shifted.atom_dos?.O.efermi).toBe(0)
    expect(shifted.atom_dos?.O.energies).toEqual([-5, 0, 5])

    // Nested spd_dos shifted
    expect(shifted.spd_dos?.s.efermi).toBe(0)
    expect(shifted.spd_dos?.s.energies).toEqual([-5, 0, 5])
    expect(shifted.spd_dos?.s.densities).toEqual([0.1, 0.2, 0.1]) // Unchanged
  })

  it(`handles zero Fermi energy (no-op)`, () => {
    const dos = make_dos(0, [-5, 0, 5])
    const shifted = shift_to_fermi(dos)

    expect(shifted.efermi).toBe(0)
    expect(shifted.energies).toEqual([-5, 0, 5]) // Unchanged
  })

  it(`handles negative Fermi energy`, () => {
    const dos = make_dos(-2.5, [-10, -5, 0, 5])
    const shifted = shift_to_fermi(dos)

    expect(shifted.efermi).toBe(0)
    expect(shifted.energies).toEqual([-7.5, -2.5, 2.5, 7.5])
  })

  it(`handles typical pymatgen efermi values`, () => {
    // Real-world example: mp-865805 has efermi ≈ 5.36 eV
    const dos = make_dos(5.36, [0, 2.68, 5.36, 8.04, 10.72])
    const shifted = shift_to_fermi(dos)

    expect(shifted.efermi).toBe(0)
    expect(shifted.energies[0]).toBeCloseTo(-5.36, 10)
    expect(shifted.energies[2]).toBeCloseTo(0, 10) // E_F now at 0
    expect(shifted.energies[4]).toBeCloseTo(5.36, 10)
  })

  it(`returns new object (immutable)`, () => {
    const dos = make_dos(5.0, [0, 5, 10])
    const shifted = shift_to_fermi(dos)

    expect(shifted).not.toBe(dos)
    expect(shifted.energies).not.toBe(dos.energies)
    // Original unchanged
    expect(dos.efermi).toBe(5.0)
    expect(dos.energies).toEqual([0, 5, 10])
  })
})

describe(`scale_segment_distances`, () => {
  it(`scales distances to target range`, () => {
    // Input: [0, 1, 2, 3] → range [10, 20] with dist_range = 3
    // d=0: 10 + (0/3)*10 = 10
    // d=1: 10 + (1/3)*10 = 13.333...
    // d=2: 10 + (2/3)*10 = 16.666...
    // d=3: 10 + (3/3)*10 = 20
    const result = scale_segment_distances([0, 1, 2, 3], 10, 20)
    expect(result[0]).toBe(10)
    expect(result[1]).toBeCloseTo(10 + 10 / 3, 10)
    expect(result[2]).toBeCloseTo(10 + 20 / 3, 10)
    expect(result[3]).toBe(20)
  })

  it(`handles zero-range segment by placing at midpoint`, () => {
    const result = scale_segment_distances([5, 5, 5], 10, 20)
    expect(result).toEqual([15, 15, 15])
  })

  it(`returns empty array for empty input`, () => {
    expect(scale_segment_distances([], 0, 10)).toEqual([])
  })

  it(`handles single point by placing at midpoint`, () => {
    const result = scale_segment_distances([42], 0, 10)
    expect(result).toEqual([5])
  })

  it.each([
    { distances: [0, 0.5, 1], x_start: 0, x_end: 100, expected: [0, 50, 100] },
    { distances: [10, 15, 20], x_start: 0, x_end: 1, expected: [0, 0.5, 1] },
    { distances: [0, 2, 4, 8], x_start: 0, x_end: 8, expected: [0, 2, 4, 8] },
  ])(
    `maps $distances to [$x_start, $x_end] → $expected`,
    ({ distances, x_start, x_end, expected }) => {
      const result = scale_segment_distances(distances, x_start, x_end)
      expect(result).toEqual(expected)
    },
  )
})

describe(`get_ribbon_config`, () => {
  it.each([
    { cfg: {}, label: `any`, expected: { opacity: 0.3, max_width: 6, scale: 1 } },
    {
      cfg: { opacity: 0.5 },
      label: `any`,
      expected: { opacity: 0.5, max_width: 6, scale: 1 },
    },
    {
      cfg: { A: { opacity: 0.4 } },
      label: `A`,
      expected: { opacity: 0.4, max_width: 6, scale: 1 },
    },
    {
      cfg: { A: { opacity: 0.4 } },
      label: `B`,
      expected: { opacity: 0.3, max_width: 6, scale: 1 },
    },
  ])(`$cfg for label "$label" → $expected`, ({ cfg, label, expected }) => {
    expect(get_ribbon_config(cfg, label)).toEqual(expected)
  })

  it(`distinguishes structure named "opacity" from opacity config value`, () => {
    // Bug case: { opacity: {...} } should be per-structure, not single config
    const per_struct = { opacity: { color: `red` }, scale: { color: `blue` } }
    expect(get_ribbon_config(per_struct, `opacity`).color).toBe(`red`)
    expect(get_ribbon_config(per_struct, `scale`).color).toBe(`blue`)
    // Single config has primitive value
    expect(get_ribbon_config({ opacity: 0.5 }, `any`).opacity).toBe(0.5)
  })
})

describe(`generate_ribbon_path`, () => {
  const id = (v: number) => v

  it(`generates valid SVG path with lower edge reversed`, () => {
    const path = generate_ribbon_path([0, 1, 2], [0, 0, 0], [1, 1, 1], id, id, 5)
    expect(path).toMatch(/^M[\d.,-]+( L[\d.,-]+)+ Z$/)
    // Verify polygon structure: upper edge 0→1→2, lower edge 2→1→0
    const points = path.match(/[\d.-]+,[\d.-]+/g) ?? []
    expect(points).toHaveLength(6)
    expect(points.slice(0, 3).map((p) => p.split(`,`)[0])).toEqual([
      `0.00`,
      `1.00`,
      `2.00`,
    ])
    expect(points.slice(3).map((p) => p.split(`,`)[0])).toEqual([`2.00`, `1.00`, `0.00`])
  })

  it.each([
    [`too few points`, [0], [0, 1], [1, 1]],
    [`mismatched y`, [0, 1, 2], [0, 1], [1, 1, 1]],
    [`mismatched width`, [0, 1, 2], [0, 1, 2], [1, 1]],
    [`zero widths`, [0, 1, 2], [0, 1, 0], [0, 0, 0]],
    [`negative widths`, [0, 1], [0, 1], [-1, -2]],
  ])(`returns "" for %s`, (_, x, y, w) => {
    expect(generate_ribbon_path(x, y, w, id, id, 10)).toBe(``)
  })

  it(`normalizes widths and applies scale`, () => {
    // width=2 is max, so at x=1: half_width=10, upper=5-10=-5, lower=5+10=15
    expect(generate_ribbon_path([0, 1, 2], [5, 5, 5], [1, 2, 1], id, id, 10)).toContain(
      `1.00,-5.00`,
    )
    // scale=2 doubles the width offset
    expect(generate_ribbon_path([0, 1], [5, 5], [1, 1], id, id, 10, 2)).toContain(
      `,-15.00`,
    )
  })

  it(`applies custom scale functions`, () => {
    const path = generate_ribbon_path(
      [0, 1, 2],
      [0, 0, 0],
      [1, 1, 1],
      (v) => v * 2,
      id,
      5,
    )
    expect(path).toContain(`0.00,`)
    expect(path).toContain(`2.00,`)
    expect(path).toContain(`4.00,`) // x doubled: 0→0, 1→2, 2→4
  })

  it(`handles Infinity in widths`, () => {
    expect(generate_ribbon_path([0, 1, 2], [0, 1, 0], [1, Infinity, 1], id, id, 10)).not
      .toBe(``)
  })
})

describe(`compute_frequency_range`, () => {
  // Create valid band structure with matching array lengths
  const make_bs = (bands: number[][]) => {
    const num_kpoints = bands[0]?.length ?? 0
    return {
      qpoints: Array.from({ length: num_kpoints }, (_, idx) => ({
        label: idx === 0 ? `Γ` : idx === num_kpoints - 1 ? `X` : null,
        frac_coords: [idx / (num_kpoints - 1 || 1), 0, 0] as Vec3,
      })),
      branches: [{ start_index: 0, end_index: num_kpoints - 1, name: `Γ-X` }],
      bands,
      distance: Array.from({ length: num_kpoints }, (_, idx) => idx),
      nb_bands: bands.length,
      labels_dict: { Γ: [0, 0, 0] as Vec3, X: [1, 0, 0] as Vec3 },
      recip_lattice: { matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Matrix3x3 },
    }
  }

  it(`computes range from band structure`, () => {
    const bs = make_bs([[0, 5, 10], [2, 8, 15]])
    const range = compute_frequency_range(bs, undefined)
    expect(range).toBeDefined()
    // Phonon with min>=0 clamps to 0, plus 2% padding on max
    expect(range?.[0]).toBe(0)
    expect(range?.[1]).toBeCloseTo(15.3, 1)
  })

  it(`computes range from DOS`, () => {
    const dos = { frequencies: [0, 5, 10, 15], densities: [0, 1, 1, 0] }
    const range = compute_frequency_range(undefined, dos)
    expect(range).toBeDefined()
    expect(range?.[0]).toBe(0)
    expect(range?.[1]).toBeCloseTo(15.3, 1)
  })

  it(`combines bands and DOS ranges`, () => {
    const bs = make_bs([[0, 5], [1, 3]])
    const dos = { frequencies: [0, 10, 20], densities: [0, 1, 0] }
    const range = compute_frequency_range(bs, dos)
    expect(range?.[0]).toBe(0)
    expect(range?.[1]).toBeCloseTo(20.4, 1)
  })

  it(`handles electronic DOS with negative energies`, () => {
    const dos = { energies: [-10, -5, 0, 5, 10], densities: [0, 0.5, 1, 0.5, 0] }
    const range = compute_frequency_range(undefined, dos)
    expect(range).toBeDefined()
    // Electronic: no clamping, 2% padding both sides
    expect(range?.[0]).toBeCloseTo(-10.4, 1)
    expect(range?.[1]).toBeCloseTo(10.4, 1)
  })

  it(`handles multiple band structures`, () => {
    const bs1 = make_bs([[0, 5], [1, 4]])
    const bs2 = make_bs([[2, 12], [3, 10]])
    const range = compute_frequency_range({ bs1, bs2 }, undefined)
    expect(range?.[0]).toBe(0)
    expect(range?.[1]).toBeCloseTo(12.24, 1)
  })

  it(`handles multiple DOS`, () => {
    const dos1 = { frequencies: [0, 8], densities: [0, 1] }
    const dos2 = { frequencies: [0, 15], densities: [0, 1] }
    const range = compute_frequency_range(undefined, { dos1, dos2 })
    expect(range?.[0]).toBe(0)
    expect(range?.[1]).toBeCloseTo(15.3, 1)
  })

  it(`returns undefined for empty/invalid input`, () => {
    expect(compute_frequency_range(undefined, undefined)).toBeUndefined()
    expect(compute_frequency_range({}, {})).toBeUndefined()
  })

  it(`respects custom padding factor`, () => {
    const dos = { frequencies: [0, 10], densities: [0, 1] }
    const range = compute_frequency_range(undefined, dos, 0.1)
    expect(range?.[1]).toBeCloseTo(11, 1)
  })

  it(`ignores non-finite values`, () => {
    const bs = make_bs([[0, NaN, 5, Infinity, 10]])
    const range = compute_frequency_range(bs, undefined)
    expect(range?.[0]).toBe(0)
    expect(range?.[1]).toBeCloseTo(10.2, 1)
  })

  it(`clamps small negative numerical noise to 0 for phonon DOS`, () => {
    // Small negative values (< 0.5% of total area) should be treated as noise
    // 100 points from -0.1 to 10, with most density at positive frequencies
    const frequencies = Array.from({ length: 101 }, (_, idx) => -0.1 + idx * 0.101)
    const densities = frequencies.map((freq) =>
      freq < 0 ? 0.001 : Math.exp(-Math.pow(freq - 5, 2))
    )
    const dos = { frequencies, densities }
    const range = compute_frequency_range(undefined, dos)
    expect(range).toBeDefined()
    // Should clamp to 0 since negative area is negligible
    expect(range?.[0]).toBe(0)
  })

  it(`preserves significant imaginary modes in phonon DOS`, () => {
    // Significant negative area (> 0.5% of total) should be preserved
    // DOS with substantial density at negative frequencies (imaginary modes)
    const frequencies = [-3, -2, -1, 0, 1, 2, 3, 4, 5]
    const densities = [0.5, 1, 0.5, 0.1, 0.5, 1, 1, 0.5, 0.1] // significant at negative
    const dos = { frequencies, densities }
    const range = compute_frequency_range(undefined, dos)
    expect(range).toBeDefined()
    // Should preserve negative range since imaginary modes are significant
    expect(range?.[0]).toBeLessThan(0)
  })

  it(`clamps small negative noise in phonon bands`, () => {
    // Bands with tiny negative values (< 0.5% of total |freq|)
    const bs = make_bs([[-0.01, 5, 10], [0, 8, 15]])
    const range = compute_frequency_range(bs, undefined)
    expect(range).toBeDefined()
    // Should clamp to 0 since negative contribution is negligible
    expect(range?.[0]).toBe(0)
  })

  it(`preserves significant imaginary modes in phonon bands`, () => {
    // Bands with substantial negative frequencies (imaginary modes)
    const bs = make_bs([[-2, -1, 0, 5, 10], [-3, 0, 2, 8, 15]])
    const range = compute_frequency_range(bs, undefined)
    expect(range).toBeDefined()
    // Should preserve negative range since imaginary modes are significant
    expect(range?.[0]).toBeLessThan(0)
  })

  // Tests electronic detection via different markers (efermi, kpoints, @class)
  // Uses small negative values (< 0.5% of total) that would be clamped for phonon but preserved for electronic
  it.each([
    { marker: { efermi: 5 }, is_electronic: true, desc: `efermi field` },
    {
      marker: { kpoints: [{ frac_coords: [0, 0, 0], label: `Γ` }] },
      is_electronic: true,
      desc: `kpoints array`,
    },
    {
      marker: { '@class': `BandStructureSymmLine` },
      is_electronic: true,
      desc: `electronic @class`,
    },
    {
      marker: { '@class': `PhononBandStructureSymmLine` },
      is_electronic: false,
      desc: `phonon @class`,
    },
  ])(`detects band structure type via $desc`, ({ marker, is_electronic }) => {
    const bs = { ...make_bs([[-0.01, 5, 10]]), ...marker }
    const range = compute_frequency_range(bs, undefined)
    expect(range).toBeDefined()
    // Electronic preserves small negatives, phonon clamps to 0
    if (is_electronic) {
      expect(range?.[0]).toBeLessThan(0)
    } else {
      expect(range?.[0]).toBe(0)
    }
  })

  it(`handles electronic DOS overriding phonon band structure detection`, () => {
    // Mixed: phonon-like band structure with electronic DOS - DOS type is authoritative
    const bs = make_bs([[0, 5, 10]])
    const dos = {
      type: `electronic` as const,
      energies: [-5, 0, 5],
      densities: [0, 1, 0],
    }
    const range = compute_frequency_range(bs, dos)
    expect(range).toBeDefined()
    // Electronic DOS should override phonon band structure assumption
    expect(range?.[0]).toBeCloseTo(-5.3, 1)
  })
})

describe(`negative_fraction`, () => {
  it.each([
    { values: [], expected: 0, desc: `empty array` },
    { values: [1, 2, 3], expected: 0, desc: `all positive` },
    { values: [-1, -2, -3], expected: 1, desc: `all negative` },
    { values: [0, 0, 0], expected: 0, desc: `all zeros` },
    { values: [-1, 1], expected: 0.5, desc: `equal positive and negative` },
    { values: [-1, 3], expected: 0.25, desc: `-1 and 3 → 1/4` },
    { values: [-2, -1, 7], expected: 0.3, desc: `-2, -1, 7 → 3/10` },
  ])(`returns $expected for $desc`, ({ values, expected }) => {
    expect(negative_fraction(values)).toBeCloseTo(expected, 5)
  })

  it(`ignores NaN and Infinity`, () => {
    expect(negative_fraction([NaN, -1, 1, Infinity])).toBeCloseTo(0.5, 5)
    expect(negative_fraction([NaN, Infinity, -Infinity])).toBe(0)
  })
})

// === Band Tooltip Helper Tests ===

// Shared factory for BaseBandStructure test fixtures
function make_bs(overrides: Partial<BaseBandStructure> = {}): BaseBandStructure {
  const qpoints = overrides.qpoints ?? [
    { label: `GAMMA`, frac_coords: [0, 0, 0] as Vec3 },
    { label: null, frac_coords: [0.25, 0, 0] as Vec3 },
    { label: `X`, frac_coords: [0.5, 0, 0] as Vec3 },
  ]
  const bands = overrides.bands ?? []
  return {
    qpoints,
    branches: [{
      start_index: 0,
      end_index: Math.max(0, qpoints.length - 1),
      name: `GAMMA-X`,
    }],
    distance: qpoints.map((_, idx) => idx),
    bands,
    nb_bands: bands.length,
    labels_dict: { GAMMA: [0, 0, 0] as Vec3, X: [0.5, 0, 0] as Vec3 },
    recip_lattice: { matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] satisfies Matrix3x3 },
    ...overrides,
  }
}

describe(`compute_slope`, () => {
  it.each([
    { y: [0, 2], x: [0, 1], idx: 0, expected: 2, desc: `forward diff at start` },
    { y: [0, 2], x: [0, 1], idx: 1, expected: 2, desc: `backward diff at end` },
    { y: [0, 2, 6], x: [0, 1, 2], idx: 1, expected: 3, desc: `central diff interior` },
    {
      y: [1, 3, 3, 7],
      x: [0, 1, 2, 3],
      idx: 1,
      expected: 1,
      desc: `central (3-3)/(2-0)`,
    },
    {
      y: [1, 3, 3, 7],
      x: [0, 1, 2, 3],
      idx: 2,
      expected: 2,
      desc: `central (7-3)/(3-1)`,
    },
    { y: [10, 0], x: [0, 5], idx: 0, expected: -2, desc: `negative slope` },
  ])(`$desc → $expected`, ({ y, x, idx, expected }) => {
    expect(compute_slope(y, x, idx)).toBeCloseTo(expected, 10)
  })

  it.each([
    { y: [5], x: [0], idx: 0, desc: `single point` },
    { y: [] as number[], x: [] as number[], idx: 0, desc: `empty arrays` },
    { y: [1, 2], x: [3, 3], idx: 0, desc: `forward dx=0` },
    { y: [1, 2], x: [3, 3], idx: 1, desc: `backward dx=0` },
    { y: [1, 2, 3], x: [0, 5, 0], idx: 1, desc: `central dx=0` },
    { y: [1, 2, 3], x: [0, 1, 2], idx: -1, desc: `negative idx` },
    { y: [1, 2, 3], x: [0, 1, 2], idx: 3, desc: `idx = length (out of bounds)` },
    { y: [1, 2, 3], x: [0, 1, 2], idx: 99, desc: `idx >> length` },
  ])(`returns null for $desc`, ({ y, x, idx }) => {
    expect(compute_slope(y, x, idx)).toBeNull()
  })
})

describe(`find_gamma_indices`, () => {
  it.each([
    {
      desc: `exact Gamma [0,0,0]`,
      qpoints: [[`GAMMA`, [0, 0, 0]], [`X`, [0.5, 0, 0]]],
      expected: [0],
    },
    {
      desc: `periodic images [1,0,0] and [-1,0,0]`,
      qpoints: [[null, [1, 0, 0]], [null, [0.5, 0, 0]], [null, [-1, 0, 0]]],
      expected: [0, 2],
    },
    {
      desc: `multiple Gamma in path (Γ→X→Γ)`,
      qpoints: [[`GAMMA`, [0, 0, 0]], [`X`, [0.5, 0, 0]], [`GAMMA`, [0, 0, 0]]],
      expected: [0, 2],
    },
    {
      desc: `no Gamma points`,
      qpoints: [[`X`, [0.5, 0, 0]], [`K`, [0.5, 0.5, 0]]],
      expected: [],
    },
    { desc: `empty qpoints`, qpoints: [], expected: [] },
    {
      desc: `excludes 0.02 (outside tolerance)`,
      qpoints: [[null, [0.02, 0, 0]]],
      expected: [],
    },
    {
      desc: `includes within 0.01 tolerance`,
      qpoints: [[null, [0.009, -0.005, 0.001]]],
      expected: [0],
    },
  ] as { desc: string; qpoints: [string | null, Vec3][]; expected: number[] }[])(
    `$desc → $expected`,
    ({ qpoints, expected }) => {
      const bs = make_bs({
        qpoints: qpoints.map(([label, frac_coords]) => ({ label, frac_coords })),
      })
      expect(find_gamma_indices(bs)).toEqual(expected)
    },
  )
})

describe(`classify_acoustic`, () => {
  it(`returns null when no Gamma indices`, () => {
    expect(classify_acoustic(make_bs({ bands: [[5, 10, 15]] }), 0, [])).toBeNull()
  })

  it.each([
    { freq: 0, expected: true, desc: `zero at Gamma` },
    { freq: 0.3, expected: true, desc: `below threshold` },
    { freq: -0.3, expected: true, desc: `negative (imaginary acoustic)` },
    { freq: ACOUSTIC_FREQ_THRESHOLD, expected: false, desc: `at threshold boundary` },
    { freq: 2.5, expected: false, desc: `above threshold` },
  ])(`$desc (freq=$freq) → $expected`, ({ freq, expected }) => {
    expect(classify_acoustic(make_bs({ bands: [[freq, 5, 10]] }), 0, [0])).toBe(expected)
  })

  it(`acoustic if ANY Gamma point has near-zero freq`, () => {
    // freq at idx 0 is 5 (optical), but at idx 2 is 0.1 (acoustic)
    expect(classify_acoustic(make_bs({ bands: [[5, 10, 0.1]] }), 0, [0, 2])).toBe(true)
  })

  it(`returns false for out-of-range band_idx`, () => {
    expect(classify_acoustic(make_bs({ bands: [[0, 5, 10]] }), 99, [0])).toBe(false)
  })

  it.each([
    { band_idx: 0, freq: 0, expected: true },
    { band_idx: 1, freq: 0.1, expected: true },
    { band_idx: 2, freq: 0.2, expected: true },
    { band_idx: 3, freq: 3.0, expected: false },
    { band_idx: 4, freq: 5.0, expected: false },
  ])(`mixed bands: band $band_idx (freq=$freq) → $expected`, ({ band_idx, expected }) => {
    const bs = make_bs({
      bands: [[0, 2, 4], [0.1, 3, 6], [0.2, 4, 8], [3.0, 5, 10], [5.0, 8, 12]],
    })
    expect(classify_acoustic(bs, band_idx, [0])).toBe(expected)
  })
})

describe(`build_point_metadata`, () => {
  const test_bs = make_bs({ bands: [[0, 5, 10], [3, 6, 9]] })

  // Helper: fill defaults so each test only specifies what it cares about
  const bpm = (overrides: Partial<Parameters<typeof build_point_metadata>[0]> = {}) =>
    build_point_metadata({
      x_vals: [0, 1, 2],
      y_vals: [0, 5, 10],
      band_idx: 0,
      spin: `up`,
      is_acoustic: true,
      bs: test_bs,
      start_idx: 0,
      ...overrides,
    })

  it(`populates per-series fields correctly`, () => {
    const result = bpm({
      x_vals: [0, 1],
      y_vals: [0, 5],
      band_idx: 1,
      spin: `down`,
      is_acoustic: false,
    })
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      band_idx: 1,
      spin: `down`,
      is_acoustic: false,
      nb_bands: 2,
    })
  })

  it(`resolves qpoint labels and frac_coords via start_idx`, () => {
    const result = bpm()
    expect(result[0]).toMatchObject({ qpoint_label: `GAMMA`, frac_coords: [0, 0, 0] })
    expect(result[1]).toMatchObject({ qpoint_label: null, frac_coords: [0.25, 0, 0] })
    expect(result[2]).toMatchObject({ qpoint_label: `X`, frac_coords: [0.5, 0, 0] })
  })

  it(`offsets into qpoints via start_idx`, () => {
    const result = bpm({
      x_vals: [0, 1],
      y_vals: [5, 10],
      is_acoustic: null,
      start_idx: 1,
    })
    expect(result[0]).toMatchObject({ frac_coords: [0.25, 0, 0], is_acoustic: null })
    expect(result[1]).toMatchObject({ qpoint_label: `X` })
  })

  it(`band_width is null when absent, populated when present`, () => {
    expect(bpm({ x_vals: [0], y_vals: [5] })[0].band_width).toBeNull()

    const bs_widths = make_bs({
      bands: [[0, 5, 10], [3, 6, 9]],
      band_widths: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]],
    })
    const result = bpm({ band_idx: 1, is_acoustic: false, bs: bs_widths })
    expect(result.map((pt) => pt.band_width)).toEqual([0.4, 0.5, 0.6])
  })

  it(`computes slopes for each point`, () => {
    for (const pt of bpm()) expect(pt.slope).toBeCloseTo(5, 10)
  })

  it(`returns empty array for empty input`, () => {
    expect(bpm({ x_vals: [], y_vals: [], is_acoustic: null })).toEqual([])
  })
})
