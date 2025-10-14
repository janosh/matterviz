import {
  apply_gaussian_smearing,
  convert_frequencies,
  normalize_densities,
  pretty_sym_point,
} from '$lib/bands/helpers'
import { describe, expect, it } from 'vitest'

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
})

describe(`apply_gaussian_smearing`, () => {
  it(`returns original data when sigma is 0`, () => {
    const energies = [0, 1, 2, 3, 4]
    const densities = [1, 2, 3, 2, 1]
    const result = apply_gaussian_smearing(energies, densities, 0)
    expect(result).toEqual(densities)
  })

  it(`smooths sharp peak with gaussian kernel`, () => {
    const energies = [0, 1, 2, 3, 4]
    const densities = [0, 0, 10, 0, 0]
    const result = apply_gaussian_smearing(energies, densities, 0.5)

    expect(result[2]).toBeLessThan(10) // Peak should be lower
    expect(result[1]).toBeGreaterThan(0) // Spread to neighbors
    expect(result[3]).toBeGreaterThan(0)
    expect(result[0]).toBeGreaterThanOrEqual(0)
    expect(result[4]).toBeGreaterThanOrEqual(0)
  })
})
