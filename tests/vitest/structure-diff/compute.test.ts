import { cross_3d, dot, type Matrix3x3, mulberry32, type Vec3 } from '#lib/math.js'
import type { AnyStructure, Crystal, Species } from '#lib/structure/index.js'
import {
  compute_structure_diff,
  MAX_NEAREST_GROUP,
  ghost_positions,
  LATTICE_KEYS,
  type LatticeKey,
  type SiteMatching,
  solve_assignment,
} from '#lib/structure-diff/compute.js'
import { describe, expect, test } from 'vite-plus/test'
import { make_crystal } from '../test-fixtures'

// Rocksalt-like 8-site cubic cell with two species
// oxfmt-ignore
const base_sites: [string, Vec3][] = [
  [`Na`, [0, 0, 0]], [`Na`, [0.5, 0.5, 0]], [`Na`, [0.5, 0, 0.5]], [`Na`, [0, 0.5, 0.5]],
  [`Cl`, [0.5, 0, 0]], [`Cl`, [0, 0.5, 0]], [`Cl`, [0, 0, 0.5]], [`Cl`, [0.5, 0.5, 0.5]],
]
const nacl_sites = base_sites.map(([element, abc]) => ({ element, abc }))
const nacl = make_crystal(5.64, base_sites)
// oxfmt-ignore
const skewed: Matrix3x3 = [[4, 0, 0], [1, 4.5, 0], [0.5, 0.2, 6]]
const rotate = ([x_val, y_val, z_val]: Vec3): Vec3 => [
  Math.cos(0.7) * x_val - Math.sin(0.7) * y_val,
  Math.sin(0.7) * x_val + Math.cos(0.7) * y_val,
  z_val,
]
// pbc [T, T, F] slab of two Cu atoms at fixed Cartesian height, a = a_len, c = c_len (vacuum)
// oxfmt-ignore
const slab = (a_len: number, c_len: number) =>
  make_crystal([[a_len, 0, 0], [0, 3, 0], [0, 0, c_len]], [
    { element: `Cu`, xyz: [0, 0, 5] }, { element: `Cu`, xyz: [0.5 * a_len, 1.5, 7] },
  ], { pbc: [true, true, false] })
const single_na = () => make_crystal(5, [[`Na`, [0, 0, 0]]])
const two_atoms = (element: string, abc_0: Readonly<Vec3>, abc_1: Readonly<Vec3>) =>
  make_crystal(10, [
    [element, abc_0],
    [element, abc_1],
  ])
const molecule = (elements: string[], positions: Vec3[]): AnyStructure => ({
  sites: positions.map((xyz, idx) => ({
    species: [{ element: elements[idx] as Species[`element`], occu: 1 }],
    abc: [0, 0, 0],
    xyz,
    label: elements[idx],
    properties: {},
  })),
})
const nan_crystal = single_na()
nan_crystal.sites[0].xyz = [Number.NaN, 0, 0]

// Cartesian shifts in Å, all well under half the nearest-neighbor distance
// oxfmt-ignore
const shifts: Vec3[] = [
  [0.1, 0, 0], [0, -0.2, 0.05], [0.03, 0.03, -0.03], [0, 0, 0],
  [-0.15, 0.1, 0], [0.2, 0.2, 0.2], [0, 0, -0.12], [0.07, -0.04, 0.01],
]
// matchers for each component within 5e-13 (half a unit in the 12th decimal)
const close_to = (values: readonly number[]) => values.map((val) => expect.closeTo(val, 12))
const shifted = (crystal: Crystal, vectors: Vec3[]): Crystal =>
  make_crystal(
    crystal.lattice.matrix,
    crystal.sites.map((site, idx) => ({
      element: site.species[0].element,
      xyz: site.xyz.map((coord, axis) => coord + vectors[idx][axis]) as Vec3,
    })),
  )

describe(`compute_structure_diff`, () => {
  test(`identical structures give zero displacement and zero lattice change`, () => {
    const diff = compute_structure_diff(nacl, structuredClone(nacl))
    expect(diff.rmsd).toBe(0)
    expect(diff.max_displacement).toBe(0)
    expect(diff.reordered).toBe(false)
    expect(diff.displacements.map(({ reference_idx }) => reference_idx)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ])
    expect(Object.values(diff.lattice?.percent ?? {})).toEqual(
      Array.from({ length: 7 }, () => 0),
    )
  })

  test(`a known perturbation is recovered with RMSD and max site`, () => {
    const diff = compute_structure_diff(nacl, shifted(nacl, shifts))
    // shifted() keeps the cell, so xyz differences are exact up to one addition: ~1e-15 Å
    expect(diff.displacements.map(({ vector }) => vector)).toEqual(shifts.map(close_to))
    const magnitudes = shifts.map((vec) => Math.hypot(...vec))
    expect(diff.displacements.map(({ magnitude }) => magnitude)).toEqual(close_to(magnitudes))
    const expected_rmsd = Math.sqrt(
      shifts.reduce((sum, vec) => sum + Math.hypot(...vec) ** 2, 0) / shifts.length,
    )
    expect(diff.rmsd).toBeCloseTo(expected_rmsd, 12)
    expect(diff.max_site_idx).toBe(5)
    expect(diff.max_displacement).toBeCloseTo(Math.hypot(0.2, 0.2, 0.2), 12)
  })

  test.each([
    [0.98, 0.02, 0.04],
    [0.02, 0.98, -0.04],
    [0.5, 0.49, -0.01],
  ])(`fractional %s -> %s takes the minimum image (%s)`, (from, to, frac_delta) => {
    const ref = make_crystal(10, [[`Fe`, [from, 0.3, 0.3]]])
    const target = make_crystal(10, [[`Fe`, [to, 0.3, 0.3]]])
    const [{ vector }] = compute_structure_diff(ref, target).displacements
    expect(vector[0]).toBeCloseTo(frac_delta * 10, 12)
    expect(Math.abs(vector[1]) + Math.abs(vector[2])).toBeLessThan(1e-12)
  })

  test(`minimum image in a skewed cell beats rounded fractional wrapping`, () => {
    // hexagonal-ish 60° cell: the short image lies along a - b, not a pure axis wrap
    // oxfmt-ignore
    const matrix: Matrix3x3 = [[4, 0, 0], [2, 3.4641016151377544, 0], [0, 0, 6]]
    const ref = make_crystal(matrix, [[`Mg`, [0.05, 0.9, 0.5]]])
    const target = make_crystal(matrix, [[`Mg`, [0.95, 0.12, 0.5]]])
    const [{ magnitude }] = compute_structure_diff(ref, target).displacements
    // brute force over neighbor images
    const delta = target.sites[0].xyz.map((coord, axis) => coord - ref.sites[0].xyz[axis])
    let best = Infinity
    for (const shift_a of [-1, 0, 1]) {
      for (const shift_b of [-1, 0, 1]) {
        const vec = delta.map(
          (val, axis) => val + shift_a * matrix[0][axis] + shift_b * matrix[1][axis],
        )
        best = Math.min(best, Math.hypot(...vec))
      }
    }
    expect(magnitude).toBeCloseTo(best, 12)
  })

  test.each([`auto`, `nearest`] as const)(
    `shuffled target site order maps back to the right reference sites (%s)`,
    (matching) => {
      const target = shifted(nacl, shifts)
      const order = [6, 2, 7, 0, 5, 3, 1, 4]
      const shuffled = { ...target, sites: order.map((idx) => target.sites[idx]) }
      const diff = compute_structure_diff(nacl, shuffled, { matching })
      expect(diff.reordered).toBe(true)
      expect(diff.displacements.map(({ reference_idx }) => reference_idx)).toEqual(order)
      const vectors = diff.displacements.map(({ vector }) => vector)
      expect(vectors).toEqual(order.map((idx) => close_to(shifts[idx])))
    },
  )

  test(`conflicting nearest picks fall back to the optimal assignment`, () => {
    // both target atoms are nearest to reference site 1; the optimal pairing is 0->0, 1->1
    const ref = two_atoms(`Cu`, [0, 0, 0], [0.01, 0, 0])
    const target = two_atoms(`Cu`, [0.006, 0, 0], [0.016, 0, 0])
    const diff = compute_structure_diff(ref, target, { matching: `nearest` })
    expect(diff.displacements.map(({ reference_idx }) => reference_idx)).toEqual([0, 1])
    expect(diff.rmsd).toBeCloseTo(0.06, 12)
  })

  test(`displacements are measured in the target cell, across a face`, () => {
    // strained + sheared target: the fractional step [0.02, 0.02, 0] (0.99 -> 0.01 wraps)
    // must come out as 0.02 * (a_T + b_T), not in the reference cell's 5 Å units
    const ref = make_crystal(5, [[`Fe`, [0.99, 0.5, 0.5]]])
    // oxfmt-ignore
    const target = make_crystal([[5.1, 0, 0], [0.3, 5, 0], [0, 0, 4.9]], [[`Fe`, [0.01, 0.52, 0.5]]])
    const [{ vector }] = compute_structure_diff(ref, target).displacements
    expect(vector).toEqual(close_to([0.02 * (5.1 + 0.3), 0.02 * 5, 0]))
  })

  // A cell change alone moves no atom and shows only in the lattice percentages (keys not
  // listed stay 0): uniform strain, a rigid rotation of the frame, and a slab's vacuum growing
  // along its non-periodic axis while a stretches in-plane
  // oxfmt-ignore
  test.each([
    [`uniform 1% strain`, nacl, make_crystal(5.64 * 1.01, nacl_sites), { a: 1, b: 1, c: 1, volume: (1.01 ** 3 - 1) * 100 }],
    [`rotated cell frame`, make_crystal(skewed, nacl_sites), make_crystal(skewed.map(rotate) as Matrix3x3, nacl_sites), {}],
    [`slab vacuum and in-plane strain`, slab(3, 20), slab(3.3, 30), { a: 10, c: 50, volume: 65 }],
  ] as [string, Crystal, Crystal, Partial<Record<LatticeKey, number>>][])(
    `%s moves no atom`,
    (_label, ref, target, expected_percent) => {
      const diff = compute_structure_diff(ref, target)
      // cart -> frac -> cart round trips in ~6 Å cells: ~1e-15 Å per site
      expect(diff.max_displacement).toBeLessThan(1e-12)
      for (const key of LATTICE_KEYS) {
        expect(diff.lattice?.percent[key], key).toBeCloseTo(expected_percent[key] ?? 0, 10)
      }
    },
  )

  // oxfmt-ignore
  test.each([
    [`oxidation states`, [{ element: `Na`, occu: 1, oxidation_state: 1 }], [{ element: `Na`, occu: 1 }], `Na`],
    [`disordered species order`, [{ element: `Fe`, occu: 0.5 }, { element: `Ni`, occu: 0.5 }],
      [{ element: `Ni`, occu: 0.5 }, { element: `Fe`, occu: 0.5 }], `Fe0.5Ni0.5`],
  ] as [string, Species[], Species[], string][])(
    `site labels ignore %s`,
    (_label, ref_species, target_species, expected_label) => {
      const [ref, target] = [single_na(), single_na()]
      ref.sites[0].species = ref_species
      target.sites[0].species = target_species
      const diff = compute_structure_diff(ref, target)
      expect(diff.max_displacement).toBe(0)
      expect(diff.displacements[0].species).toBe(expected_label)
    },
  )

  test(`nearest matching refuses species groups over the size limit, auto keeps order`, () => {
    const size = MAX_NEAREST_GROUP + 1
    const rand = mulberry32(3)
    const sites = Array.from({ length: size }, () => ({
      element: `Ar`,
      abc: [rand(), rand(), rand()] as Vec3,
    }))
    const ref = make_crystal(40, sites)
    // one atom jumps far, so auto cannot accept the file order on displacement size alone
    const target = make_crystal(
      40,
      sites.toSpliced(0, 1, { element: `Ar`, abc: [0.5, 0.5, 0.5] }),
    )
    expect(() => compute_structure_diff(ref, target, { matching: `nearest` })).toThrow(
      `${size} Ar sites exceeds the limit of ${MAX_NEAREST_GROUP}`,
    )
    expect(compute_structure_diff(ref, target).reordered).toBe(false)
  })

  // Both Fe move 3.5 Å (beyond half the 1.7 Å characteristic spacing), so auto weighs
  // re-pairing: swapped is shorter (12.5 vs 24.5 Å^2) but not half the RMSD, keep file order.
  // Listed swapped: re-pairing shrinks the RMSD ~100x, unless index matching forces file order.
  test.each([
    [`large motion`, [0.45, 0.5, 0.5], [0.35, 0.5, 0.5], false, `auto`],
    [`listed swapped`, [0.7, 0.5, 0.5], [0.101, 0.5, 0.5], true, `auto`],
    [`listed swapped, index matching`, [0.7, 0.5, 0.5], [0.101, 0.5, 0.5], false, `index`],
  ] as const)(`aligned species, %s`, (_label, abc_0, abc_1, reordered, matching) => {
    const ref = two_atoms(`Fe`, [0.1, 0.5, 0.5], [0.7, 0.5, 0.5])
    const target = two_atoms(`Fe`, abc_0, abc_1)
    expect(compute_structure_diff(ref, target, { matching }).reordered).toBe(reordered)
  })

  test(`molecules compare by plain Cartesian difference`, () => {
    // oxfmt-ignore
    const water = (dx: number) => molecule([`O`, `H`, `H`], [[0, 0, 0], [1 + dx, 0, 0], [2, 0, 0]])
    const diff = compute_structure_diff(water(0), water(0.25))
    expect(diff.lattice).toBeNull()
    // oxfmt-ignore
    expect(diff.displacements.map(({ vector }) => vector)).toEqual([[0, 0, 0], [0.25, 0, 0], [0, 0, 0]])
  })

  // zero-mean local moves on top of a translation that pushes the atoms at 0 across the
  // b face; the target is wrapped back into the cell
  const translation: Vec3 = [0.3, -0.25, 0.4]
  const mean_shift = [0, 1, 2].map(
    (axis) => shifts.reduce((sum, vec) => sum + vec[axis], 0) / 8,
  )
  const local_moves = shifts.map(
    (vec) => vec.map((val, axis) => val - mean_shift[axis]) as Vec3,
  )
  const rms = (vecs: Vec3[]) =>
    Math.sqrt(vecs.reduce((sum, vec) => sum + Math.hypot(...vec) ** 2, 0) / vecs.length)
  test.each([
    [`pure translation`, shifts.map((): Vec3 => [0, 0, 0])],
    [`translation plus local moves`, local_moves],
  ])(`%s: drift removal leaves the local moves, across cell faces`, (_label, moves) => {
    const target = make_crystal(
      5.64,
      nacl.sites.map(({ species, abc }, idx): [string, Vec3] => [
        species[0].element,
        abc.map((val, axis) => {
          const frac = val + (moves[idx][axis] + translation[axis]) / 5.64
          return frac - Math.floor(frac)
        }) as Vec3,
      ]),
    )
    const raw = compute_structure_diff(nacl, target)
    expect(raw.drift).toBeNull()
    const total = moves.map((vec) => vec.map((val, axis) => val + translation[axis]) as Vec3)
    expect(raw.rmsd).toBeCloseTo(rms(total), 12)
    const fitted = compute_structure_diff(nacl, target, { remove_drift: true })
    // a periodic cell allows a translation only
    expect(fitted.drift?.rotation_deg).toBeNull()
    expect(fitted.drift?.shift).toEqual(close_to(translation))
    expect(fitted.displacements.map(({ vector }) => vector)).toEqual(moves.map(close_to))
    expect(fitted.rmsd).toBeCloseTo(rms(moves), 12)
  })

  // Rodrigues rotation about a unit axis
  const rotate_about = (vec: Vec3, axis: Vec3, degrees: number): Vec3 => {
    const [cos, sin] = [Math.cos, Math.sin].map((fn) => fn((degrees * Math.PI) / 180))
    const [cross, along] = [cross_3d(axis, vec), dot(axis, vec)]
    return vec.map(
      (val, idx) => val * cos + cross[idx] * sin + axis[idx] * along * (1 - cos),
    ) as Vec3
  }
  // oxfmt-ignore
  test.each([
    [`tetrahedral`, [[0, 0, 0], [1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]], 30],
    // planar sets have a zero singular value: the rotation must stay proper, not a mirror
    [`planar ring`, [0, 1, 2, 3, 4, 5].map((idx): Vec3 => [Math.cos(idx), Math.sin(idx), 0]), 50],
    // a linear set has no unique rotation: translation only, also when bent by 1e-4 Å (whose
    // fitted rotation would lose orthogonality as its middle singular value shrinks)
    [`linear`, [[0, 0, 0], [1, 0, 0], [2.5, 0, 0]], null, 1e-12],
    [`nearly linear`, [[0, 0, 0], [1, 1e-4, 0], [2.5, 0, 0]], null, 1e-4],
  ] as [string, Vec3[], number | null, number?][])(`%s molecule: drift removal fits a rigid rotation`, (_label, positions, degrees, max_rmsd = 1e-12) => {
    const axis: Vec3 = degrees === null ? [1, 0, 0] : [Math.SQRT1_2, 0, Math.SQRT1_2]
    const moved = positions.map((xyz) =>
      rotate_about(xyz, axis, degrees ?? 40).map((val, idx) => val + [2, -1, 0.5][idx]) as Vec3)
    const elements = positions.map(() => `C`)
    const [reference, target] = [positions, moved].map((xyz) => molecule(elements, xyz))
    expect(compute_structure_diff(reference, target).rmsd).toBeGreaterThan(1)
    const { rmsd, drift } = compute_structure_diff(reference, target, { remove_drift: true })
    expect(rmsd).toBeLessThan(max_rmsd)
    if (degrees === null) expect(drift?.rotation_deg).toBeNull()
    else expect(drift?.rotation_deg).toBeCloseTo(degrees, 10)
  })

  // oxfmt-ignore
  test.each([
    [`different compositions`, make_crystal(5, [[`Na`, [0, 0, 0]], [`Cl`, [0.5, 0.5, 0.5]]]),
      make_crystal(5, [[`Na`, [0, 0, 0]], [`Br`, [0.5, 0.5, 0.5]]]),
      /different compositions: reference ClNa .* target BrNa .*Cl \+1, Br -1/],
    [`different site counts`, single_na(), two_atoms(`Na`, [0, 0, 0], [0.5, 0.5, 0.5]), /1 sites.*2 sites/],
    [`empty structures`, make_crystal(5, []), make_crystal(5, []), /empty structures/],
    [`different periodicity`, single_na(), make_crystal(5, [[`Na`, [0, 0, 0]]], { pbc: [true, true, false] }),
      /different periodicity/],
    [`crystal vs molecule`, single_na(), { sites: single_na().sites }, /crystal reference with a molecule target/],
    [`non-finite reference xyz`, nan_crystal, single_na(), /reference site 1 has non-finite xyz \[NaN,0,0\]/],
    [`non-finite target xyz`, single_na(), nan_crystal, /target site 1 has non-finite xyz/],
    [`index matching of a reordered species list`, nacl, { ...nacl, sites: nacl.sites.toReversed() },
      /site 1 is Na in the reference and Cl in the target/, `index`],
  ] as [string, AnyStructure, AnyStructure, RegExp, SiteMatching?][])(
    `throws on %s`,
    (_label, ref, target, message, matching = `auto`) => {
      expect(() => compute_structure_diff(ref, target, { matching })).toThrow(message)
    },
  )
})

describe(`solve_assignment`, () => {
  const permutations = (size: number): number[][] =>
    size === 0
      ? [[]]
      : permutations(size - 1).flatMap((perm) =>
          Array.from({ length: size }, (_, pos) => perm.toSpliced(pos, 0, size - 1)),
        )

  test.each([1, 2, 3, 5, 6])(`matches brute force on random %sx%s matrices`, (size) => {
    // fixed LCG so the matrices are reproducible
    let state = 12345 + size
    const rand = () => (state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
    for (let trial = 0; trial < 20; trial++) {
      const costs = Float64Array.from({ length: size * size }, rand)
      const total = (cols: ArrayLike<number>) =>
        Array.from(cols).reduce((sum, col, row) => sum + costs[row * size + col], 0)
      const best = Math.min(...permutations(size).map(total))
      const assigned = solve_assignment(costs, size)
      expect(new Set(assigned).size).toBe(size)
      expect(total(assigned)).toBeCloseTo(best, 12)
    }
  })

  test(`rejects a non-square cost matrix`, () => {
    expect(() => solve_assignment(new Float64Array(5), 2)).toThrow(/5 entries, expected 2x2/)
  })
})

describe(`ghost_positions`, () => {
  const target = shifted(nacl, shifts)
  const order = [1, 0, 2, 3, 4, 5, 6, 7]
  const reordered = { ...target, sites: order.map((idx) => target.sites[idx]) }
  const diff = compute_structure_diff(nacl, reordered, { matching: `nearest` })

  test.each([1, 3.5])(`scale %s: ghost = target atom - scale * displacement`, (scale) => {
    const ghosts = ghost_positions(diff, reordered, scale)
    for (const [idx, ghost] of ghosts.entries()) {
      const { reference_idx, vector } = diff.displacements[idx]
      // the arrow from ghost to atom is the scaled reference -> target displacement
      const arrow = reordered.sites[idx].xyz.map((coord, axis) => coord - ghost[axis])
      expect(arrow).toEqual(close_to(vector.map((val) => scale * val)))
      // at true size the ghost sits on the matched reference atom (cells agree here)
      if (scale === 1) expect(ghost).toEqual(close_to(nacl.sites[reference_idx].xyz))
    }
  })
})
