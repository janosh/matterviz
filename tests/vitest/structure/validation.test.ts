import { is_valid_structure } from '$lib/structure/validation'
import { describe, expect, test } from 'vitest'

describe(`is_valid_structure`, () => {
  test.each([
    // Valid
    {
      input: { sites: [{ element: `H` }], lattice: { a: 5 } },
      expected: true,
      label: `valid`,
    },
    { input: { sites: [{}], lattice: {} }, expected: true, label: `minimal` },
    // Invalid: non-objects
    { input: null, expected: false, label: `null` },
    { input: `string`, expected: false, label: `primitive` },
    // Invalid: missing/empty sites
    { input: {}, expected: false, label: `empty object` },
    { input: { lattice: { a: 5 } }, expected: false, label: `no sites` },
    { input: { sites: [], lattice: { a: 5 } }, expected: false, label: `empty sites` },
    { input: { sites: null, lattice: { a: 5 } }, expected: false, label: `sites null` },
    // Invalid: missing/invalid lattice
    { input: { sites: [{}] }, expected: false, label: `no lattice` },
    { input: { sites: [{}], lattice: null }, expected: false, label: `lattice null` },
    {
      input: { sites: [{}], lattice: `invalid` },
      expected: false,
      label: `lattice string`,
    },
  ])(`$label → $expected`, ({ input, expected }) => {
    expect(is_valid_structure(input)).toBe(expected)
  })
})
