// Tests for symmetry-element classification: analytic single-operation cases plus
// whole-group inventories generated from moyo's operations_from_number (real WASM).

import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import {
  analyze_structure_symmetry,
  classify_symmetry_op,
  clip_axis_family,
  clip_line_to_cell,
  clip_plane_family,
  dash_segments,
  frac_to_cart_direction,
  mat3_from_flat_col_major,
  MAX_TILED_SYM_ELEMENTS,
  piece_key,
  symmetry_elements_from_ops,
  symmetry_tiling_reason,
  tile_symmetry_elements,
} from '$lib/symmetry'
import type { Crystal } from '$lib/structure'
import type { SymmetryElement } from '$lib/symmetry'
import { clip_frac_plane_to_cell } from '$lib/structure/lattice-planes'
import type { MoyoDataset } from '@spglib/moyo-wasm'
import { operations_from_number } from '@spglib/moyo-wasm'
import { beforeAll, describe, expect, test } from 'vitest'
import {
  col_major,
  cubic_matrix,
  fcc_primitive_matrix,
  IDENTITY_MATRIX3 as IDENTITY,
  init_moyo_for_tests,
  make_crystal,
} from '../test-fixtures'

const INVERSION: Matrix3x3 = [
  [-1, 0, 0],
  [0, -1, 0],
  [0, 0, -1],
]
const ROT2_Z: Matrix3x3 = [
  [-1, 0, 0],
  [0, -1, 0],
  [0, 0, 1],
]
const ROT2_Y: Matrix3x3 = [
  [-1, 0, 0],
  [0, 1, 0],
  [0, 0, -1],
]
const MIRROR_Z: Matrix3x3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, -1],
]
const MIRROR_Y: Matrix3x3 = [
  [1, 0, 0],
  [0, -1, 0],
  [0, 0, 1],
]
const ROTOINV4_Z: Matrix3x3 = [
  [0, 1, 0],
  [-1, 0, 0],
  [0, 0, -1],
]
// 3-fold about c in a hexagonal cell (non-symmetric in fractional coords)
const ROT3_HEX: Matrix3x3 = [
  [0, -1, 0],
  [1, -1, 0],
  [0, 0, 1],
]
// Mirror swapping the two hexagonal in-plane axes
const MIRROR_HEX_SWAP: Matrix3x3 = [
  [0, 1, 0],
  [1, 0, 0],
  [0, 0, 1],
]

describe(`classify_symmetry_op`, () => {
  test(`identity and pure translations yield no element`, () => {
    expect(classify_symmetry_op(col_major(IDENTITY), [0, 0, 0])).toBeNull()
    // F-centering translation
    expect(classify_symmetry_op(col_major(IDENTITY), [0, 0.5, 0.5])).toBeNull()
  })

  test(`inversion center sits at w/2`, () => {
    const elem = classify_symmetry_op(col_major(INVERSION), [0.5, 0.5, 0.5])
    expect(elem).toMatchObject({ kind: `inversion`, label: `-1`, axis: null })
    expect(elem?.point).toEqual([0.25, 0.25, 0.25])
  })

  // The 2-fold about z (ROT2_Z) decomposes a translation into an in-axis screw part and a
  // perpendicular part that only shifts the axis location, covering every branch of the
  // proper-rotation classifier in one place:
  test.each([
    // [name, translation, expected {kind,label,point,translation}]
    [`pure rotation`, [0, 0, 0], `rotation`, `2`, [0, 0, 0], null],
    // perpendicular translation → same axis direction, shifted location at (1/4,1/4,z)
    [`perpendicular shift`, [0.5, 0.5, 0], `rotation`, `2`, [0.25, 0.25, 0], null],
    // half-period along axis → 2_1 screw with intrinsic (0,0,1/2)
    [`half-period screw`, [0, 0, 0.5], `screw`, `2_1`, [0, 0, 0], [0, 0, 0.5]],
    // full lattice period along axis is NOT intrinsic → still a pure rotation
    [`full-period not screw`, [0, 0, 1], `rotation`, `2`, [0, 0, 0], null],
  ] as [string, Vec3, string, string, Vec3, Vec3 | null][])(
    `2-fold about z: %s`,
    (_, translation, kind, label, point, intrinsic) => {
      const elem = classify_symmetry_op(col_major(ROT2_Z), translation)
      expect(elem).toMatchObject({ kind, order: 2, label, axis: [0, 0, 1], point })
      expect(elem?.translation).toEqual(intrinsic)
    },
  )

  // ITA #14: (−x, y+1/2, −z+1/2) and (x, −y+1/2, z+1/2)
  test.each([
    [ROT2_Y, `screw`, `2_1`, [0, 0.5, 0], [0, 0, 0.25]],
    [MIRROR_Y, `glide`, `c`, [0, 0, 0.5], [0, 0.25, 0]],
  ] as const)(`P2_1/c %j yields %s %s`, (rotation, kind, label, translation, point) => {
    const elem = classify_symmetry_op(col_major(rotation), [0, 0.5, 0.5])
    expect(elem).toMatchObject({ kind, label, axis: [0, 1, 0], translation, point })
  })

  test.each([
    [`mirror`, [0, 0, 0], `m`, null],
    [`a-glide`, [0.5, 0, 0], `a`, [0.5, 0, 0]],
    [`b-glide`, [0, 0.5, 0], `b`, [0, 0.5, 0]],
    [`n-glide`, [0.5, 0.5, 0], `n`, [0.5, 0.5, 0]],
    [`d-glide`, [0.25, 0.25, 0], `d`, [0.25, 0.25, 0]],
  ] as [string, Vec3, string, Vec3 | null][])(
    `%s normal to z`,
    (_, translation, label, glide_vec) => {
      const elem = classify_symmetry_op(col_major(MIRROR_Z), translation)
      expect(elem?.label).toBe(label)
      expect(elem?.axis).toEqual([0, 0, 1])
      expect(elem?.translation).toEqual(glide_vec)
    },
  )

  test(`-4 rotoinversion about z`, () => {
    const elem = classify_symmetry_op(col_major(ROTOINV4_Z), [0, 0, 0])
    expect(elem).toMatchObject({
      kind: `rotoinversion`,
      order: 4,
      label: `-4`,
      axis: [0, 0, 1],
      point: [0, 0, 0],
      translation: null,
    })
    // (I-W) has determinant 4: two x/y positions, each with centers at z=0 and 1/2.
    const elements = symmetry_elements_from_ops(
      [0, 2 - 2e-9].map((shift) => ({
        rotation: col_major(ROTOINV4_Z),
        translation: [0, 0, shift],
      })) as MoyoDataset[`operations`],
    )
    expect(elements.map(({ point }) => point)).toEqual([
      [0, 0, 0],
      [0, 0, 0.5],
      [0.5, 0.5, 0],
      [0.5, 0.5, 0.5],
    ])
    expect(new Set(elements.map(({ locus }) => locus)).size).toBe(2)
  })

  test(`3-fold and 3_1/3_2 screws in a hexagonal cell`, () => {
    expect(classify_symmetry_op(col_major(ROT3_HEX), [0, 0, 0])).toMatchObject({
      kind: `rotation`,
      order: 3,
      label: `3`,
      axis: [0, 0, 1],
    })
    const screw_1 = classify_symmetry_op(col_major(ROT3_HEX), [0, 0, 1 / 3])
    expect(screw_1?.label).toBe(`3_1`)
    expect(screw_1?.translation?.[2]).toBeCloseTo(1 / 3, 10)
    const screw_2 = classify_symmetry_op(col_major(ROT3_HEX), [0, 0, 2 / 3])
    expect(screw_2?.label).toBe(`3_2`)
  })

  test(`hexagonal mirror: fractional normal converts to a true Cartesian normal`, () => {
    const elem = classify_symmetry_op(col_major(MIRROR_HEX_SWAP), [0, 0, 0])
    expect(elem).toMatchObject({ kind: `mirror`, label: `m`, axis: [1, -1, 0] })
    expect(elem?.plane_normal).toEqual([1, -1, 0])

    // The plane of the a1↔a2 swap mirror contains (a1+a2) and c. Its fractional normal
    // [1,-1,0] must convert via the DIRECT lattice to a Cartesian vector orthogonal to
    // both in-plane directions — this is the subtle part for non-orthogonal cells.
    const [a_len, c_len] = [2.5, 4]
    const hex_lattice: Matrix3x3 = [
      [a_len, 0, 0],
      [-a_len / 2, (a_len * Math.sqrt(3)) / 2, 0],
      [0, 0, c_len],
    ]
    const normal_cart = frac_to_cart_direction(elem?.axis as Vec3, hex_lattice)
    const in_plane_1 = math.add(hex_lattice[0], hex_lattice[1]) // a1 + a2
    const in_plane_2 = hex_lattice[2] // c
    expect(math.dot(normal_cart, in_plane_1)).toBeCloseTo(0, 10)
    expect(math.dot(normal_cart, in_plane_2)).toBeCloseTo(0, 10)
    // the plane drawn from plane_normal is the one through the origin with that normal
    const [polygon] = clip_plane_family(elem?.point as Vec3, [1, -1, 0], hex_lattice)
    for (const vert of polygon) expect(math.dot(vert, normal_cart)).toBeCloseTo(0, 10)
  })
})

describe(`symmetry_elements_from_ops: space group inventories`, () => {
  beforeAll(init_moyo_for_tests)

  const elements_for = (spg_num: number, primitive = false): SymmetryElement[] =>
    symmetry_elements_from_ops(
      operations_from_number(spg_num, { type: `Standard` }, primitive),
    )

  // A group's operations re-expressed in the sheared basis b' = b + shear·a (x = M·x')
  const sheared_ops = (
    spg: number,
    shear: number,
    primitive = false,
  ): MoyoDataset[`operations`] => {
    // oxfmt-ignore
    const [to_old, to_new]: Matrix3x3[] = [[[1, shear, 0], [0, 1, 0], [0, 0, 1]], [[1, -shear, 0], [0, 1, 0], [0, 0, 1]]]
    const ops = operations_from_number(spg, { type: `Standard` }, primitive)
    return ops.map(({ rotation, translation }) => {
      const rot = math.dot(to_new, mat3_from_flat_col_major(rotation))
      return {
        rotation: col_major(math.dot(rot, to_old)),
        translation: math.dot(to_new, translation),
      }
    }) as MoyoDataset[`operations`]
  }

  const count_by = (elements: SymmetryElement[], key: `kind` | `label`) =>
    elements.reduce<Record<string, number>>((acc, elem) => {
      acc[elem[key]] = (acc[elem[key]] ?? 0) + 1
      return acc
    }, {})

  test(`P1 (#1) has no symmetry elements`, () => {
    expect(elements_for(1)).toEqual([])
  })

  test(`P-1 (#2) has exactly the 8 inversion centers at half-lattice points`, () => {
    const elements = elements_for(2)
    expect(elements).toHaveLength(8)
    expect(elements.every((elem) => elem.kind === `inversion`)).toBe(true)
    const centers = new Set(elements.map((elem) => elem.point.join(`,`)))
    for (const coord_x of [0, 0.5]) {
      for (const coord_y of [0, 0.5]) {
        for (const coord_z of [0, 0.5])
          expect(centers).toContain([coord_x, coord_y, coord_z].join(`,`))
      }
    }
  })

  // A center at 1 - 1e-9 (below wrap_to_unit_cell's 1e-10 snap) is the lattice image of the
  // one at 0 and must share its locus key, else the same point shows up twice
  test(`inversion centers at 1 - 1e-9 and 0 dedupe to one element`, () => {
    const inversion = col_major(INVERSION)
    const elements = symmetry_elements_from_ops([
      { rotation: inversion, translation: [0, 0, 0] },
      { rotation: inversion, translation: [2 - 2e-9, 0, 0] }, // center at w/2 = 1 - 1e-9
    ] as MoyoDataset[`operations`])
    expect(elements).toHaveLength(8)
    expect(elements.every((elem) => elem.kind === `inversion`)).toBe(true)
  })

  test(`P2_1/c (#14): 8 inversion centers, 4 screw axes, 2 c-glide planes`, () => {
    const elements = elements_for(14)
    expect(count_by(elements, `kind`)).toEqual({ inversion: 8, screw: 4, glide: 2 })

    const screws = elements.filter((elem) => elem.kind === `screw`)
    expect(screws.every((elem) => elem.label === `2_1`)).toBe(true)
    // ITA: 2_1 axes along b at (x, z) ∈ {0, 1/2} × {1/4, 3/4}
    expect(screws.every((elem) => String(elem.axis) === `0,1,0`)).toBe(true)
    const axis_positions = new Set(screws.map((elem) => `${elem.point[0]},${elem.point[2]}`))
    expect(axis_positions).toEqual(new Set([`0,0.25`, `0.5,0.25`, `0,0.75`, `0.5,0.75`]))

    const glides = elements.filter((elem) => elem.kind === `glide`)
    expect(glides.every((elem) => elem.label === `c`)).toBe(true)
    // ITA: c-glides normal to b at y = 1/4 and 3/4
    expect(new Set(glides.map((elem) => elem.point[1]))).toEqual(new Set([0.25, 0.75]))
  })

  test(`P2_12_12_1 (#19) is chiral: only 2_1 screw axes`, () => {
    const elements = elements_for(19)
    // 4 screw axes per direction x 3 directions; nothing but 2_1 screws
    expect(count_by(elements, `label`)).toEqual({ '2_1': 12 })
    expect(count_by(elements, `kind`)).toEqual({ screw: 12 })
    const directions = new Set(elements.map((elem) => String(elem.axis)))
    expect(directions).toEqual(new Set([`1,0,0`, `0,1,0`, `0,0,1`]))
  })

  // One tally per geometric element, whichever operations reach it. ITA's N_p advances p/N of the
  // period per +2π/N turn, so enantiomorphs carry mirror-image screws (I4_1 holds both hands);
  // Fm-3m's double glides (a/2 and b/2) and R3c's origin glides (c/2 and the equally short
  // (1/3,-1/3,1/6)) are listed once each
  test.each([
    [`P3_1`, 144, `screw`, { '3_1': 3 }],
    [`P3_2`, 145, `screw`, { '3_2': 3 }],
    [`P4_1`, 76, `screw`, { '4_1': 2, '2_1': 4 }],
    [`P4_3`, 78, `screw`, { '4_3': 2, '2_1': 4 }],
    [`P6_1`, 169, `screw`, { '6_1': 1, '3_1': 3, '2_1': 4 }],
    [`P6_5`, 170, `screw`, { '6_5': 1, '3_2': 3, '2_1': 4 }],
    [`P6_2`, 171, `screw`, { '6_2': 1, '3_2': 3 }],
    [`P6_4`, 172, `screw`, { '6_4': 1, '3_1': 3 }],
    [`I4_1`, 80, `screw`, { '4_1': 2, '4_3': 2, '2_1': 4 }],
    [`Fm-3m`, 225, `glide`, { a: 4, b: 2, d: 12 }],
    [`R3c`, 161, `glide`, { c: 3, g: 3 }],
  ])(`%s (#%i) %s labels`, (_, spg, kind, expected) => {
    const matching = elements_for(spg).filter((elem) => elem.kind === kind)
    expect(count_by(matching, `label`)).toEqual(expected)
  })

  test(`P2_13 (#198): 3-fold axes along ⟨111⟩ + 2_1 screws, no improper elements`, () => {
    const elements = elements_for(198)
    const kinds = new Set(elements.map((elem) => elem.kind))
    expect(kinds).toEqual(new Set([`rotation`, `screw`]))
    expect(elements.some((elem) => elem.order === 3 && String(elem.axis) === `1,1,1`)).toBe(
      true,
    )
    expect(elements.some((elem) => elem.label === `2_1`)).toBe(true)
  })

  test(`Fm-3m (#225) contains the full cubic element inventory`, () => {
    const elements = elements_for(225)
    const has = (pred: (elem: SymmetryElement) => boolean) => elements.some(pred)

    // 4-fold axes along cell edges, 3-fold along body diagonals, 2-fold along face
    // diagonals, mirrors normal to ⟨100⟩ and ⟨110⟩, inversion at the origin
    expect(
      has(
        (element) =>
          element.kind === `rotation` &&
          element.order === 4 &&
          String(element.axis) === `0,0,1`,
      ),
    ).toBe(true)
    expect(
      has(
        (element) =>
          element.kind === `rotation` &&
          element.order === 3 &&
          String(element.axis) === `1,1,1`,
      ),
    ).toBe(true)
    expect(
      has(
        (element) =>
          element.kind === `rotation` &&
          element.order === 2 &&
          String(element.axis) === `1,1,0`,
      ),
    ).toBe(true)
    expect(
      has((element) => element.kind === `mirror` && String(element.axis) === `0,0,1`),
    ).toBe(true)
    expect(
      has((element) => element.kind === `mirror` && String(element.axis) === `1,1,0`),
    ).toBe(true)
    expect(
      has((element) => element.kind === `inversion` && String(element.point) === `0,0,0`),
    ).toBe(true)
    expect(has((element) => element.kind === `rotoinversion`)).toBe(true)
    // F-centering composes mirrors into glides
    expect(has((element) => element.kind === `glide`)).toBe(true)
  })

  test(`Fd-3m (#227, diamond) has d-glides, 4_1 screws, and -3 rotoinversions`, () => {
    const elements = elements_for(227)
    const labels = new Set(elements.map((elem) => elem.label))
    expect(labels).toContain(`d`)
    expect(labels).toContain(`4_1`)
    expect(labels).toContain(`-3`)
    // diamond is centrosymmetric (inversion on 8b sites, not at the 8a origin setting?
    // moyo's Standard setting uses origin choice 2 with -1 at the origin)
    expect(elements.some((elem) => elem.kind === `inversion`)).toBe(true)
  })

  // Exact in-cell counts pin element_locus_key dedup and the centering handling:
  // - P4mm=14: dropping the plane-offset wrap splits lattice-equivalent mirrors
  // - R-3m=81: locus-key fmt precision 4→1 collides/shifts trigonal loci; ignoring the
  //   centerings lifted into mirror planes miscounts its glides
  // - Cm=4: the C-centering alternates mirrors (y = 0, 1/2) with a-glides (y = 1/4, 3/4)
  test.each([
    [`P4mm`, 99, 14],
    [`R-3m`, 166, 81],
    [`Cm`, 8, 4],
  ])(`%s (#%i) has exactly %i distinct in-cell elements`, (_, spg, expected) => {
    expect(elements_for(spg)).toHaveLength(expected)
  })

  // R-3m is the metric-sensitive case: in the hexagonal setting the plane-equation normal
  // is G·axis, not axis, and keying the offset off the direct-space normal used the wrong
  // period. The hexagonal cell holds 3 primitive rhombohedral cells, so every element
  // family appears 3 times in it and each per-kind count must be divisible by 3. Keying
  // off `axis` gave rotation:2 = 22, screw:2_1 = 20, m = 5 and g = 5 — orbits split
  // inconsistently — against 18/18/3/3 once the covariant normal is used.
  test(`R-3m (#166) element counts respect the 3-fold R-centering multiplicity`, () => {
    const elements = elements_for(166)
    const by_kind = count_by(elements, `label`)
    expect(by_kind).toEqual({
      // 3-folds on the 9 threefold points of the R-centred net: 3 of each of 3, 3_1 and 3_2
      '3': 3,
      '2': 18,
      '3_1': 3,
      '3_2': 3,
      '2_1': 18,
      // det(I - W) = 2 for -3, times three R-centering translations: six centers.
      '-3': 6,
      m: 3,
      g: 3,
      '-1': 24,
    })
    for (const [label, count] of Object.entries(by_kind)) {
      expect(count % 3, `${label} count ${count} is not a multiple of 3`).toBe(0)
    }
    // The 3 label-`g` elements are the rhombohedral diagonal glides: reduced glide vector
    // (1/6, 1/3, 1/3) is no half cell-axis (a/b/c), half diagonal (n) or quarter diagonal
    // (d), so glide_letter must fall back to its otherwise-untested catch-all "g" — and
    // they must still classify as order-2 glide planes, not something mislabeled
    const g_glides = elements.filter((elem) => elem.label === `g`)
    expect(g_glides.map((elem) => [elem.kind, elem.order])).toEqual([
      [`glide`, 2],
      [`glide`, 2],
      [`glide`, 2],
    ])
  })

  test(`hexagonal mirror x, x-y, z: lattice-equivalent planes collapse to one family`, () => {
    // The direct-space normal (elem.axis) of this mirror is (0, 1, 0), but the plane
    // EQUATION normal is the −1 eigenvector of Wᵀ, proportional to (−1, 2, 0). Keying the
    // offset off the former halved the period, so the planes through (0, 0, 0) and
    // (0, 1/2, 0) — one lattice translation apart — were emitted as two families, as were
    // those through (0, 1/4, 0) and (0, 3/4, 0). Four planes where there are two.
    const mirror: Matrix3x3 = [
      [1, 0, 0],
      [1, -1, 0],
      [0, 0, 1],
    ]
    const elements = symmetry_elements_from_ops(
      [IDENTITY, mirror].map((rot) => ({
        rotation: col_major(rot),
        translation: [0, 0, 0],
      })) as MoyoDataset[`operations`],
    )
    const planes = elements.filter(
      (element) => element.kind === `mirror` || element.kind === `glide`,
    )
    expect(planes).toHaveLength(2)
  })

  test(`every space group yields classifiable operations`, () => {
    // Smoke test: classification must not throw for ANY operation of ANY space group,
    // and every non-trivial op must classify to an element with a valid label
    for (let num = 1; num <= 230; num++) {
      const ops = operations_from_number(num, { type: `Standard` }, false)
      // centering vectors (needed to reduce screw/glide translations in centered cells)
      const centerings = ops
        .filter(
          (operation) =>
            String(operation.rotation) === `1,0,0,0,1,0,0,0,1` &&
            operation.translation.some((val) => Math.abs(val - Math.round(val)) > 1e-6),
        )
        .map((operation) => operation.translation)
      for (const operation of ops) {
        const elem = classify_symmetry_op(
          operation.rotation,
          operation.translation,
          centerings,
        )
        if (elem === null) continue
        expect(elem.label).toMatch(/^(?:-?[1-6](?:_[1-5])?|[mabcndg])$/)
        if (elem.axis) {
          // axes are reduced integer vectors with canonical sign
          expect(elem.axis.every((val) => Number.isInteger(val))).toBe(true)
          expect(elem.axis.find((val) => val !== 0)).toBeGreaterThan(0)
        }
        // points are wrapped to [0, 1)
        for (const coord of elem.point) {
          expect(coord).toBeGreaterThanOrEqual(0)
          expect(coord).toBeLessThan(1)
        }
      }
    }
  })

  test(`primitive diamond frame: every order-4 axis line carries an order-2 axis with the same locus`, async () => {
    // W² of any order-4 operation (4, 4_1, -4) is an order-2 proper operation about the same
    // line, so each order-4 locus must also appear as an order-2 locus — the invariant
    // hide_redundant_axes relies on. In a primitive (non-standard) frame the two operations'
    // fixed points can differ by a lattice vector that is not along the axis; a perpendicular
    // -foot intercept keyed such lines differently and left 5 of 12 sub-axes drawn inside
    // their enclosing axes, while the covector-based locus is lattice-invariant.
    const prim_diamond = make_crystal(fcc_primitive_matrix(5.43), [
      { element: `Si`, abc: [0, 0, 0] },
      { element: `Si`, abc: [0.25, 0.25, 0.25] },
    ])
    const { operations } = await analyze_structure_symmetry(prim_diamond)
    const axes = symmetry_elements_from_ops(operations).filter(
      (elem) => elem.axis && elem.kind !== `mirror` && elem.kind !== `glide`,
    )
    const order_4 = axes.filter((elem) => elem.order === 4)
    const order = axes.filter((elem) => elem.order === 2)
    expect(order_4.length).toBeGreaterThan(0)
    const two_fold_loci = new Set(order.map((elem) => elem.locus))
    for (const elem of order_4) expect(two_fold_loci).toContain(elem.locus)
    // the legacy intercept key (point − λ·axis, unwrapped) misses some of these coincidences
    const intercept_key = (elem: SymmetryElement): string => {
      const axis = elem.axis as Vec3
      const lambda = math.dot(elem.point, axis) / math.dot(axis, axis)
      const intercept = elem.point.map((val, idx) => val - lambda * axis[idx])
      return `${axis.join(`,`)}|${intercept.map((val) => val.toFixed(4)).join(`,`)}`
    }
    const two_fold_intercepts = new Set(order.map(intercept_key))
    expect(order_4.some((elem) => !two_fold_intercepts.has(intercept_key(elem)))).toBe(true)
  })

  // moyo reports operations in the input frame, where a sheared basis b' = b + k·a turns cubic
  // [110] into [k+1,-1,0] and searches sized for reduced cells failed: glide periods, half periods
  // along centered axes, re-anchoring over t ∈ {0,1}³ (drops e.g. one of Fm-3m's 100 elements in
  // the primitive frame at k = 50). Glide letters name cell axes (the n-glide on x = y is b'/2 at
  // k = 1), so glides tally as one kind.
  test.each([1, 4, 50])(
    `sheared cell (b' = b + %da) keeps every element inventory`,
    async (shear) => {
      const tally = (elements: SymmetryElement[]) =>
        count_by(
          elements.map((elem) => (elem.kind === `glide` ? { ...elem, label: `glide` } : elem)),
          `label`,
        )
      for (let spg = 1; spg <= 230; spg++) {
        for (const primitive of [false, true]) {
          const sheared = symmetry_elements_from_ops(sheared_ops(spg, shear, primitive))
          const expected = tally(elements_for(spg, primitive))
          expect(tally(sheared), `#${spg} primitive=${primitive}`).toEqual(expected)
        }
      }
      // and moyo itself on sheared simple-cubic, bcc (Im-3m) and hcp (P6_3/mmc) cells
      const moyo_tally = async (crystal: Crystal) => {
        const { operations } = await analyze_structure_symmetry(crystal)
        return tally(symmetry_elements_from_ops(operations))
      }
      // oxfmt-ignore
      const hexagonal: Matrix3x3 = [[3.2, 0, 0], [-1.6, 1.6 * Math.sqrt(3), 0], [0, 0, 5.2]]
      // oxfmt-ignore
      const crystals = [
        make_crystal(4, [[`Cu`, [0, 0, 0]]]),
        make_crystal(2.9, [[`Cu`, [0, 0, 0]], [`Cu`, [0.5, 0.5, 0.5]]]),
        make_crystal(hexagonal, [[`Cu`, [1 / 3, 2 / 3, 0.25]], [`Cu`, [2 / 3, 1 / 3, 0.75]]]),
      ]
      for (const crystal of crystals) {
        const [vec_a, vec_b, vec_c] = crystal.lattice.matrix
        const lattice: Matrix3x3 = [vec_a, math.add(vec_b, math.scale(vec_a, shear)), vec_c]
        const sites = crystal.sites.map(({ xyz }) => ({ element: `Cu` as const, xyz }))
        const sheared = await moyo_tally(make_crystal(lattice, sites))
        expect(sheared).toEqual(await moyo_tally(crystal))
      }
    },
  )

  test(`P321 (#150): hexagonal in-plane 2-fold axes have correct directions`, () => {
    // The 2-fold Ws here are non-symmetric in fractional coords, so a transposed
    // (row-major) decode yields wrong axes like [2,-1,0]
    const elements = elements_for(150)
    const two_fold_axes = new Set(
      elements
        .filter((elem) => elem.kind === `rotation` && elem.order === 2)
        .map((elem) => String(elem.axis)),
    )
    expect(two_fold_axes).toEqual(new Set([`1,0,0`, `0,1,0`, `1,1,0`]))
    expect(
      elements.some((element) => element.order === 3 && String(element.axis) === `0,0,1`),
    ).toBe(true)
  })

  test(`I2_13 (#199): body centering halves the <111> axis period`, () => {
    // Without centering-aware reduction, ops composed with the (1/2,1/2,1/2) centering
    // get intrinsic translation 5/6 along <111> and a bogus "3_0" label
    const elements = elements_for(199)
    for (const elem of elements) {
      expect(elem.label).toMatch(/^(?:-?[1-6](?:_[1-5])?|[mabcndg])$/)
    }
    const labels = new Set(elements.map((elem) => elem.label))
    expect(labels).toContain(`3`)
    expect(labels).toContain(`2_1`)
  })

  // Against brute force: a representative alone can merely graze the cell (Pm-3m's [1-11] 3-fold
  // touches one corner) and a box of translates misses pieces of sheared cells. A line crossing
  // the cell at q is the translate through q − f·axis (f ∈ [0, 1)), which lies in the box
  // −point + [0, 1]³ − [0, 1]·axis; planes scan a wide range of levels.
  test.each([221, 225, 229].flatMap((spg) => [0, 4].map((shear) => [spg, shear])))(
    `#%i sheared by %i: the family clippers draw every in-cell piece`,
    (spg, shear) => {
      // oxfmt-ignore
      const lattice: Matrix3x3 = [[4, 0, 0], [4 * shear, 4, 0], [0, 0, 4]]
      for (const { kind, point, axis, plane_normal } of symmetry_elements_from_ops(
        sheared_ops(spg, shear),
      )) {
        if (!axis) continue
        const expected = new Set<string>()
        let pieces: Vec3[][]
        if (plane_normal) {
          // the metric preserved by the group makes the covector parallel to the normal direction
          const normal_cart = math.miller_plane_normal(lattice, plane_normal)
          const cross = math.cross_3d(normal_cart, frac_to_cart_direction(axis, lattice))
          expect(Math.hypot(...cross), kind).toBeLessThan(1e-12 * Math.hypot(...normal_cart))
          const level = math.dot(plane_normal, point)
          for (let shift = -20; shift <= 20; shift++) {
            const polygon = clip_frac_plane_to_cell(plane_normal, level + shift, lattice)
            if (polygon.length > 0) expected.add(piece_key(polygon))
          }
          pieces = clip_plane_family(point, plane_normal, lattice)
        } else {
          const [range_x, range_y, range_z] = point.map((coord, dim) => [
            Math.floor(-coord - Math.max(axis[dim], 0)),
            Math.ceil(1 - coord - Math.min(axis[dim], 0)),
          ])
          for (let t_x = range_x[0]; t_x <= range_x[1]; t_x++)
            for (let t_y = range_y[0]; t_y <= range_y[1]; t_y++)
              for (let t_z = range_z[0]; t_z <= range_z[1]; t_z++) {
                const segment = clip_line_to_cell(
                  math.add(point, [t_x, t_y, t_z]),
                  axis,
                  lattice,
                )
                if (segment) expected.add(piece_key(segment))
              }
          pieces = clip_axis_family(point, axis, lattice)
        }
        expect(pieces, kind).toHaveLength(expected.size)
        expect(new Set(pieces.map(piece_key)), kind).toEqual(expected)
      }
    },
  )
})

describe(`cell clipping helpers`, () => {
  const cubic_2 = cubic_matrix(2)

  // [name, point, direction, low and high endpoint]. clip_line_to_cell promises no endpoint
  // ordering, so the returned pair is sorted by z before comparing.
  test.each([
    [`axis along z through origin`, [0, 0, 0], [0, 0, 1], [0, 0, 0], [0, 0, 2]],
    [`shifted axis`, [0.25, 0.25, 0.5], [0, 0, 1], [0.5, 0.5, 0], [0.5, 0.5, 2]],
    [`body diagonal`, [0, 0, 0], [1, 1, 1], [0, 0, 0], [2, 2, 2]],
  ] as [string, Vec3, Vec3, Vec3, Vec3][])(
    `clip_line_to_cell: %s spans the cell`,
    (_name, point, direction, low_end, high_end) => {
      const seg = clip_line_to_cell(point, direction, cubic_2)
      expect(seg).not.toBeNull()
      const sorted = (seg as [Vec3, Vec3]).toSorted(
        (vector_1, vector_2) => vector_1[2] - vector_2[2],
      )
      expect(sorted).toEqual([low_end, high_end])
    },
  )

  test(`clip_line_to_cell: line outside the cell returns null`, () => {
    expect(clip_line_to_cell([1.5, 0.5, 0], [0, 0, 1], cubic_2)).toBeNull()
  })

  test(`clip_plane_family: the z = 0 mirror family is the bottom and top faces`, () => {
    const polygons = clip_plane_family([0.5, 0.5, 0], [0, 0, 1], cubic_2)
    const heights = [0, 2].map((height) => Array(4).fill(expect.closeTo(height, 12)))
    expect(polygons.map((poly) => poly.map((vert) => vert[2]))).toEqual(heights)
    const corner_keys = new Set(polygons[0].map((vert) => `${vert[0]},${vert[1]}`))
    expect(corner_keys).toEqual(new Set([`0,0`, `2,0`, `0,2`, `2,2`]))
  })

  test(`clip_plane_family: the [110] family crosses the cell once, through its center`, () => {
    // x + y = 0 and x + y = 2 (fractional) only touch cell edges and are dropped
    const polygons = clip_plane_family([0.5, 0.5, 0.5], [1, 1, 0], cubic_2)
    expect(polygons).toHaveLength(1)
    for (const vert of polygons[0]) expect(vert[0] + vert[1]).toBeCloseTo(2, 10)
  })

  test(`skew mirror: plane_normal is the exact plane covector, not the normal direction`, () => {
    // Mirror mapping a2 ↦ a1 − a2 of an oblique lattice (|a2| = |a1 − a2|). Its normal
    // direction [1,-2,0] is NOT plain-dot orthogonal to the invariant plane (spanned by a1, a3);
    // the plane is y = const in fractional coordinates, i.e. plane_normal (0,1,0)
    const skew_mirror: Matrix3x3 = [
      [1, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
    ]
    const elem = classify_symmetry_op(col_major(skew_mirror), [0, 0, 0])
    expect(elem).toMatchObject({ kind: `mirror`, label: `m`, axis: [1, -2, 0] })
    expect(elem?.plane_normal).toEqual([0, 1, 0])

    const lattice: Matrix3x3 = [
      [1, 0, 0],
      [0.5, 0.8, 0],
      [0, 0, 2],
    ]
    // Cartesian normal of the direction: (1,-2,0)·L = a1 − 2·a2 = (0,-1.6,0), so the planes
    // are y = 0 and its translate y = 0.8
    const polygons = clip_plane_family(elem?.point as Vec3, [0, 1, 0], lattice)
    const heights = [0, 0.8].map((height) => Array(4).fill(expect.closeTo(height, 12)))
    expect(polygons.map((poly) => poly.map((vert) => vert[1]))).toEqual(heights)
  })

  test(`clip_plane_family returns vertices in convex winding order`, () => {
    // The body-diagonal plane through the cell center cuts a regular hexagon. Vertices
    // must come out sorted around the centroid (the angle-sort step) — otherwise the
    // rendered polygon self-intersects. A convex, consistently-wound polygon turns the
    // same way at every vertex, so all consecutive edge cross products project onto the
    // plane normal with the same sign.
    const polygons = clip_plane_family([0.5, 0.5, 0.5], [1, 1, 1], cubic_2)
    // triangles at x + y + z = 1/2 and 5/2 around the hexagonal cross-section at 3/2
    expect(polygons.map((poly) => poly.length)).toEqual([3, 6, 3])
    const poly = polygons[1]
    const normal = math.normalize_vec([1, 1, 1])
    const turn_signs = poly.map((vert, idx) => {
      const edge_a = math.subtract(poly[(idx + 1) % poly.length], vert)
      const edge_b = math.subtract(
        poly[(idx + 2) % poly.length],
        poly[(idx + 1) % poly.length],
      )
      return Math.sign(math.dot(math.cross_3d(edge_a, edge_b), normal))
    })
    expect(new Set(turn_signs)).toEqual(new Set([1])) // all same-sign → convex, no crossings
  })
})

describe(`dash_segments`, () => {
  test(`dashes touch both segment ends and never overlap`, () => {
    const segs = dash_segments(10, 0.45, 0.3)
    // floor((10 + 0.3) / (0.45 + 0.3)) = 13 dashes fit
    expect(segs).toHaveLength(13)
    // first dash starts at 0, last dash ends exactly at the segment length
    expect(segs[0].center - segs[0].length / 2).toBeCloseTo(0, 10)
    const last = segs[segs.length - 1]
    expect(last.center + last.length / 2).toBeCloseTo(10, 10)
    // uniform dash length, monotone centers, gaps >= requested gap
    for (let idx = 0; idx < segs.length; idx++) {
      expect(segs[idx].length).toBeCloseTo(0.45, 10)
      if (idx > 0) {
        const gap =
          segs[idx].center -
          segs[idx].length / 2 -
          (segs[idx - 1].center + segs[idx - 1].length / 2)
        expect(gap).toBeGreaterThanOrEqual(0.3 - 1e-10)
      }
    }
  })

  // Below two dash periods (2*0.45 + 0.3 = 1.2) only a single dash fits: it spans the whole
  // segment while shorter than one dash length, and is centered once it is capped at 0.45
  test.each([
    [`shorter than one dash`, 0.3, [{ center: 0.15, length: 0.3 }]],
    [`exactly one dash`, 0.45, [{ center: 0.225, length: 0.45 }]],
    [`between one and two dash periods`, 0.9, [{ center: 0.45, length: 0.45 }]],
  ])(`%s: a single segment`, (_label, length, expected) => {
    expect(dash_segments(length, 0.45, 0.3)).toEqual(expected)
  })

  test.each([
    { length: 0, dash: 0.4, gap: 0.2 },
    { length: -1, dash: 0.4, gap: 0.2 },
    { length: 5, dash: 0, gap: 0.2 },
    { length: 5, dash: 0.4, gap: -0.1 },
  ])(`degenerate input (len=$length dash=$dash gap=$gap) gives no segments`, (args) => {
    expect(dash_segments(args.length, args.dash, args.gap)).toEqual([])
  })

  test(`zero gap tiles the segment completely`, () => {
    const segs = dash_segments(2, 0.5, 0)
    const covered = segs.reduce((sum, seg) => sum + seg.length, 0)
    expect(covered).toBeCloseTo(2, 10)
  })
})

describe(`tile_symmetry_elements`, () => {
  const cell = cubic_matrix(4)
  const mirror: SymmetryElement = {
    kind: `mirror`,
    order: 2,
    label: `m`,
    axis: [1, 0, 0],
    plane_normal: [1, 0, 0],
    point: [0.25, 0, 0],
    translation: null,
    locus: `m-x`,
  }
  const screw: SymmetryElement = {
    kind: `screw`,
    order: 2,
    label: `2_1`,
    axis: [0, 0, 1],
    plane_normal: null,
    point: [0.5, 0.5, 0],
    translation: [0, 0, 0.5],
    locus: `screw-z`,
  }

  test.each([
    [2, 1, 3],
    [0.5, 1, 1],
    [4001, 1, 1],
    [1, 1e9, 1e9],
    [Infinity, 1, 1],
  ] as Vec3[])(`preflights %s,%s,%s without allocating translated elements`, (...tiling) => {
    const elements = [mirror, screw]
    const expected = tile_symmetry_elements(elements, tiling).unavailable_reason
    expect(
      symmetry_tiling_reason(
        elements.map((element) => ({
          ...element,
          get point(): Vec3 {
            throw new Error(
              `Preflight must not read coordinates to allocate translated elements`,
            )
          },
        })),
        tiling,
      ),
    ).toBe(expected)
  })

  test(`repeats each element per tile at unchanged Cartesian positions`, () => {
    const elements = [mirror, screw]
    expect(tile_symmetry_elements(elements, [1, 1, 1]).elements).toBe(elements)
    const tiling: Vec3 = [2, 1, 3]
    const block = math.scale_lattice_matrix(cell, tiling)
    // Along-plane/axis translations must not add coincident geometry.
    const tiled = tile_symmetry_elements([mirror, screw], tiling).elements
    expect(tiled.filter((copy) => copy.locus === mirror.locus)).toHaveLength(2)
    expect(tiled.filter((copy) => copy.locus === screw.locus)).toHaveLength(2)

    for (const element of [mirror, screw]) {
      const cart = frac_to_cart_direction(element.point, cell)
      const matches = tiled.filter(
        (copy) =>
          copy.locus === element.locus &&
          math.euclidean_dist(frac_to_cart_direction(copy.point, block), cart) < 1e-9,
      )
      expect(matches, `${element.label} at its original place`).toHaveLength(1)
    }
    const mirror_x = tiled
      .filter((copy) => copy.locus === mirror.locus)
      .map((copy) => frac_to_cart_direction(copy.point, block)[0])
      .toSorted((one, two) => one - two)
    expect(mirror_x.map((coord) => Number(coord.toFixed(9)))).toEqual([1, 5])
    // the screw line runs along c, so tiling along c alone adds nothing
    expect(tile_symmetry_elements([screw], [1, 1, 4]).elements).toHaveLength(1)
    expect(tile_symmetry_elements([mirror], [1, 4, 4]).elements).toHaveLength(1)

    // Cartesian screw/glide translations survive the basis change, while directions stay primitive
    // integer vectors for the family clippers: [1,1,0] reads (1/2, 1, 0) ∥ [1,2,0] as an axis and
    // (2,1,0) as plane indices
    for (const copy of tiled) {
      const source = copy.locus === mirror.locus ? mirror : screw
      expect([copy.axis, copy.plane_normal]).toEqual([source.axis, source.plane_normal])
      if (!source.translation) continue
      expect(frac_to_cart_direction(copy.translation as Vec3, block)).toEqual(
        frac_to_cart_direction(source.translation, cell).map((val) => expect.closeTo(val, 9)),
      )
    }
    const oblique: SymmetryElement = { ...mirror, axis: [1, 1, 0], plane_normal: [1, 1, 0] }
    expect(tile_symmetry_elements([oblique], tiling).elements[0]).toMatchObject({
      axis: [1, 2, 0],
      plane_normal: [2, 1, 0],
    })
  })

  // A plane shifts by the exact integer plane_normal · offset. The metric pullback G·axis it
  // replaced split nearly symmetric cells (b tilted by 1e-5 tiled x = 1/4 1x3x1 into 3 copies).
  test(`tiles planes by their integer covector, independent of the metric`, () => {
    const hexagonal: Matrix3x3 = [
      [3, 0, 0],
      [-1.5, (3 * Math.sqrt(3)) / 2, 0],
      [0, 0, 5],
    ]
    // Cartesian normal along x: direction [1, 0, 0], plane (2 -1 0) in this cell
    const mirror_x: SymmetryElement = {
      ...mirror,
      plane_normal: [2, -1, 0],
      point: [0, 0, 0],
      locus: `m-hex`,
    }
    const tiled = tile_symmetry_elements([mirror_x], [1, 2, 1]).elements
    expect(tiled).toHaveLength(2)
    // the two planes really do sit at different distances along the normal
    const block = math.scale_lattice_matrix(hexagonal, [1, 2, 1])
    const to_cart = math.create_frac_to_cart(block)
    const offsets = tiled.map((copy) => to_cart(copy.point)[0])
    expect(Math.abs(offsets[0] - offsets[1])).toBeCloseTo(1.5, 9)
    // while translations that lie in the plane dedup away, however many
    expect(tile_symmetry_elements([mirror_x], [1, 1, 3]).elements).toHaveLength(1)
    expect(tile_symmetry_elements([mirror], [1, 3, 1]).elements).toHaveLength(1)
    const planes: SymmetryElement[] = [mirror, { ...mirror, kind: `glide`, label: `g` }]
    expect(tile_symmetry_elements(planes, [1, 1e9, 1e9])).toEqual({
      elements: planes,
      unavailable_reason: null,
    })
  })

  // Rotoinversion centers repeat along the axis, unlike plain rotation lines.
  test(`repeats a rotoinversion along its axis but not a rotation`, () => {
    const rotation: SymmetryElement = {
      ...screw,
      kind: `rotation`,
      order: 4,
      label: `4`,
      point: [0, 0, 0],
      translation: null,
      locus: `line-z`,
    }
    const roto: SymmetryElement = { ...rotation, kind: `rotoinversion`, label: `-4` }
    expect(tile_symmetry_elements([rotation], [1, 1, 3]).elements).toHaveLength(1)
    expect(tile_symmetry_elements([roto], [1, 1, 3]).elements).toHaveLength(3)
    const centers = [roto, { ...roto, point: [0, 0, 0.5] as Vec3 }]
    expect(
      tile_symmetry_elements(centers, [1, 1, 3]).elements.map(({ point }) => point[2]),
    ).toEqual([0, 1 / 3, 2 / 3, 1 / 6, 0.5, 5 / 6])
    // Custom source centers outside the unit cell remain outside it; coincident copies dedup.
    expect(
      tile_symmetry_elements([roto, { ...roto, point: [0, 0, 1] }], [1, 1, 2]).elements.map(
        ({ point }) => point[2],
      ),
    ).toEqual([0, 0.5, 1])
    // and the two never collapse into each other despite sharing a locus
    expect(tile_symmetry_elements([rotation, roto], [1, 1, 2]).elements).toHaveLength(3)
  })

  test(`deduplicates before enforcing the cap and refuses oversized overlays`, () => {
    const many = Array.from({ length: 200 }, (_, idx) => ({ ...mirror, locus: `m-${idx}` }))
    expect(many.length * 64).toBeGreaterThan(MAX_TILED_SYM_ELEMENTS)
    expect(tile_symmetry_elements(many, [4, 4, 4]).elements).toHaveLength(800)
    expect(tile_symmetry_elements(many, [2, 1, 1]).elements).toHaveLength(400)
    expect(tile_symmetry_elements(many, [20, 1, 1]).elements).toHaveLength(
      MAX_TILED_SYM_ELEMENTS,
    )
    const refused = tile_symmetry_elements(many, [21, 1, 1])
    expect(refused.elements).toEqual([])
    expect(refused.unavailable_reason).toContain(
      `exceeds ${MAX_TILED_SYM_ELEMENTS} unique elements`,
    )
    expect(tile_symmetry_elements([], [1e9, 1e9, 1e9]).elements).toEqual([])
    expect(tile_symmetry_elements([mirror], [1, 1e9, 1e9]).elements).toHaveLength(1)
    expect(tile_symmetry_elements([screw], [1, 1, 1e9]).elements).toHaveLength(1)
    const diagonal: SymmetryElement = { ...mirror, axis: [1, 1, 1], plane_normal: [1, 1, 1] }
    expect(tile_symmetry_elements([diagonal], [100, 100, 100]).elements).toHaveLength(298)
  })

  test(`treats a null axis (inversion centre) and fractional counts safely`, () => {
    const centre: SymmetryElement = {
      kind: `inversion`,
      order: 1,
      label: `-1`,
      axis: null,
      plane_normal: null,
      point: [0, 0, 0],
      translation: null,
      locus: `inv`,
    }
    const tiled = tile_symmetry_elements([centre], [2, 1, 1]).elements
    expect(tiled.map((copy) => copy.axis)).toEqual([null, null])
    expect(tiled.map((copy) => copy.point[0])).toEqual([0, 0.5])
    expect(tile_symmetry_elements([centre], [0.5, 1, 1]).elements).toEqual([centre])
  })
})
