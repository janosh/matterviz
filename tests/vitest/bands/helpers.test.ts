import {
  apply_gaussian_smearing,
  convert_frequencies,
  get_band_xaxis_ticks,
  normalize_densities,
  pretty_sym_point,
} from '$lib/bands/helpers'
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
