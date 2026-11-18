// Point sets and structures shared by the structure, bond-angle and perf-baseline tests
import type { Vec3 } from '#lib/math.js'
import { bond_records } from '#lib/structure/bond-rendering.js'
import type { BondData } from '#lib/structure/bond-rendering.js'
import type { BondPair, Crystal } from '#lib/structure/index.js'
import { expect } from 'vite-plus/test'
import { max_abs_error } from '../numeric-helpers'
import { make_crystal } from '../test-fixtures'

// ±x, ±y, ±z unit vectors: a regular octahedron whose first four corners are a square
// oxfmt-ignore
export const octahedron_points: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]

// 1000 H sites inside a 1 Å cubic cell, the base of the large-supercell tests
export const thousand_site_crystal = (): Crystal =>
  make_crystal(
    1,
    Array.from({ length: 1000 }, (_, idx) => ({
      element: `H`,
      abc: [(idx % 10) / 10, (idx % 100) / 100, idx / 1000] as Vec3,
    })),
  )

// Bonds carried over to moved sites match a fresh search's: same pairs, orders and shifts,
// lengths and positions within 1e-12 A
export function expect_same_bonds(carried: BondData, fresh: readonly BondPair[]): void {
  const split = ({ pos_1, pos_2, bond_length, ...rest }: BondPair) => ({
    rest,
    numbers: [bond_length, ...pos_1, ...pos_2],
  })
  const records = bond_records(carried)
  expect(records).toHaveLength(fresh.length)
  for (const [idx, record] of records.entries()) {
    const [actual, expected] = [record, fresh[idx]].map(split)
    expect(actual.rest).toEqual(expected.rest)
    expect(max_abs_error(actual.numbers, expected.numbers)).toBeLessThan(1e-12)
  }
}
