import {
  has_lattice_matrix,
  has_usable_lattice,
  is_crystal,
  is_periodic,
  lattice_unavailable_reason,
} from '$lib/structure/validation'
import { describe, expect, test } from 'vitest'
import { cubic_matrix } from '../setup'

describe(`is_crystal`, () => {
  test.each([
    // Valid
    {
      input: { sites: [{ element: `H` }], lattice: { a: 5 } },
      expected: true,
      label: `valid`,
    },
    { input: { sites: [{}], lattice: {} }, expected: true, label: `minimal` },
    {
      input: {
        sites: [{}],
        lattice: cubic_matrix(1),
      },
      expected: true,
      label: `raw matrix`,
    },
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
    expect(is_crystal(input)).toBe(expected)
  })
})

// Geometry consumers require a matrix, while volume normalisation also requires an inverse.
// oxfmt-ignore
test.each([
  [`cubic`, cubic_matrix(1), true, true],
  [`left handed`, cubic_matrix(-1), true, true],
  [`small scale`, cubic_matrix(1e-5), true, true],
  [`singular`, [[1, 0, 0], [0, 1, 0], [0, 0, 0]], true, false],
  [`ill conditioned`, [[1, 0, 0], [1, 1e-12, 0], [0, 0, 1]], true, false],
  [`nonfinite`, cubic_matrix(NaN), false, false],
  [`overflow volume`, cubic_matrix(1e200), true, false],
  [`wrong shape`, [[1, 0], [0, 1]], false, false],
  [`sparse rows`, Array(3), false, false],
  [`sparse entries`, [Array(3), Array(3), Array(3)], false, false],
  [`missing matrix`, undefined, false, false],
])(`%s lattice eligibility`, (_label, matrix, finite, usable) => {
  const structure = { sites: [{}], lattice: { matrix } }
  expect(is_crystal(structure)).toBe(true)
  expect(has_lattice_matrix(structure)).toBe(finite)
  expect(has_usable_lattice(structure)).toBe(usable)
  expect(lattice_unavailable_reason(structure) === undefined).toBe(finite)
  expect(lattice_unavailable_reason(structure, true) === undefined).toBe(usable)
})

test.each([
  [undefined, true],
  [[true, true, true], true],
  [[true, true, false], true],
  [[false, false, false], false],
])(`periodicity follows axes %s`, (pbc, expected) => {
  const structure = {
    sites: [{}],
    lattice: {
      pbc,
      matrix: cubic_matrix(1),
    },
  }
  expect(is_periodic(structure)).toBe(expected)
  expect(has_usable_lattice(structure)).toBe(true)
  expect(is_periodic({ sites: [{}] })).toBe(false)
  expect(has_usable_lattice({ sites: [{}] })).toBe(false)
})
