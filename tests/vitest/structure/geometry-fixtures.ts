// Point sets and structures shared by the structure, bond-angle and perf-baseline tests
import type { Vec3 } from '#lib/math.js'
import type { Crystal } from '#lib/structure/index.js'
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
