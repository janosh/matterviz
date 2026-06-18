// Tests for symmetry-element classification: analytic single-operation cases plus
// whole-group inventories generated from moyo's operations_from_number (real WASM).

import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import {
  classify_symmetry_op,
  clip_line_to_cell,
  clip_plane_to_cell,
  dash_segments,
  frac_to_cart_direction,
  symmetry_elements_from_ops,
} from '$lib/symmetry'
import type { SymmetryElement } from '$lib/symmetry'
import { operations_from_number } from '@spglib/moyo-wasm'
import { beforeAll, describe, expect, test } from 'vitest'
import {
  col_major,
  cubic_matrix,
  IDENTITY_MATRIX3 as IDENTITY,
  init_moyo_for_tests,
} from '../setup'

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

  test(`P2_1/c operation 2: screw 2_1 along b at (0, y, 1/4)`, () => {
    // ITA #14: (−x, y+1/2, −z+1/2)
    const elem = classify_symmetry_op(col_major(ROT2_Y), [0, 0.5, 0.5])
    expect(elem).toMatchObject({ kind: `screw`, label: `2_1`, axis: [0, 1, 0] })
    expect(elem?.translation).toEqual([0, 0.5, 0])
    expect(elem?.point).toEqual([0, 0, 0.25])
  })

  test(`P2_1/c operation 4: c-glide normal b at y = 1/4`, () => {
    // ITA #14: (x, −y+1/2, z+1/2)
    const elem = classify_symmetry_op(col_major(MIRROR_Y), [0, 0.5, 0.5])
    expect(elem).toMatchObject({ kind: `glide`, label: `c`, axis: [0, 1, 0] })
    expect(elem?.translation).toEqual([0, 0, 0.5])
    expect(elem?.point).toEqual([0, 0.25, 0])
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
      if (glide_vec === null) expect(elem?.translation).toBeNull()
      else expect(elem?.translation).toEqual(glide_vec)
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
  })
})

describe(`symmetry_elements_from_ops: space group inventories`, () => {
  beforeAll(init_moyo_for_tests)

  const elements_for = (spg_num: number): SymmetryElement[] =>
    symmetry_elements_from_ops(operations_from_number(spg_num, { type: `Standard` }, false))

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
    for (const x of [0, 0.5]) {
      for (const y of [0, 0.5]) {
        for (const z of [0, 0.5]) expect(centers).toContain([x, y, z].join(`,`))
      }
    }
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
    expect(elements.length).toBeGreaterThan(0)
    expect(elements.every((elem) => elem.kind === `screw` && elem.label === `2_1`)).toBe(true)
    const directions = new Set(elements.map((elem) => String(elem.axis)))
    expect(directions).toEqual(new Set([`1,0,0`, `0,1,0`, `0,0,1`]))
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
      has((el) => el.kind === `rotation` && el.order === 4 && String(el.axis) === `0,0,1`),
    ).toBe(true)
    expect(
      has((el) => el.kind === `rotation` && el.order === 3 && String(el.axis) === `1,1,1`),
    ).toBe(true)
    expect(
      has((el) => el.kind === `rotation` && el.order === 2 && String(el.axis) === `1,1,0`),
    ).toBe(true)
    expect(has((el) => el.kind === `mirror` && String(el.axis) === `0,0,1`)).toBe(true)
    expect(has((el) => el.kind === `mirror` && String(el.axis) === `1,1,0`)).toBe(true)
    expect(has((el) => el.kind === `inversion` && String(el.point) === `0,0,0`)).toBe(true)
    expect(has((el) => el.kind === `rotoinversion`)).toBe(true)
    // F-centering composes mirrors into glides
    expect(has((el) => el.kind === `glide`)).toBe(true)
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

  // Exact in-cell counts (hand-verified vs ITA diagrams) pin element_locus_key dedup and
  // invariant_translations' in-plane invariance check; each kills a distinct mutation:
  // - P4mm=14: dropping the plane-offset wrap splits lattice-equivalent mirrors
  // - R-3m=94: locus-key fmt precision 4→1 collides/shifts trigonal loci
  // - Cm=4: weakening invariant_translations' some()→every() invariance test
  test.each([
    [`P4mm`, 99, 14],
    [`R-3m`, 166, 94],
    [`Cm`, 8, 4],
  ])(`%s (#%i) has exactly %i distinct in-cell elements`, (_, spg, expected) => {
    expect(elements_for(spg)).toHaveLength(expected)
  })

  test(`R-3m (#166) emits a g-glide: rhombohedral diagonal glides reduce to no a/b/c/n/d letter in the hexagonal-axes basis, so glide_letter must fall back to "g"`, () => {
    // The reduced glide vector (1/6, 1/3, 1/3) — no half cell-axis (a/b/c), half diagonal
    // (n), or quarter diagonal (d) — hits glide_letter's otherwise-untested catch-all "g".
    const labels = elements_for(166).map((elem) => elem.label)
    expect(labels).toContain(`g`)
    // and it really is a glide plane, not mislabeled as something else
    const g_glides = elements_for(166).filter((elem) => elem.label === `g`)
    expect(g_glides.every((elem) => elem.kind === `glide` && elem.order === 2)).toBe(true)
  })

  test(`every space group yields classifiable operations`, () => {
    // Smoke test: classification must not throw for ANY operation of ANY space group,
    // and every non-trivial op must classify to an element with a valid label
    for (let num = 1; num <= 230; num++) {
      const ops = operations_from_number(num, { type: `Standard` }, false)
      // centering vectors (needed to reduce screw/glide translations in centered cells)
      const centerings = ops
        .filter(
          (op) =>
            String(op.rotation) === `1,0,0,0,1,0,0,0,1` &&
            op.translation.some((val) => Math.abs(val - Math.round(val)) > 1e-6),
        )
        .map((op) => op.translation as Vec3)
      for (const op of ops) {
        const elem = classify_symmetry_op(op.rotation, op.translation, centerings)
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
    expect(elements.some((el) => el.order === 3 && String(el.axis) === `0,0,1`)).toBe(true)
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
})

describe(`cell clipping helpers`, () => {
  const cubic_2 = cubic_matrix(2)

  test(`clip_line_to_cell: axis along z through the origin spans the cell`, () => {
    const seg = clip_line_to_cell([0, 0, 0], [0, 0, 1], cubic_2)
    expect(seg).not.toBeNull()
    const [start, end] = seg as [Vec3, Vec3]
    expect([start, end].toSorted((s1, s2) => s1[2] - s2[2])).toEqual([
      [0, 0, 0],
      [0, 0, 2],
    ])
  })

  test(`clip_line_to_cell: shifted axis and body diagonal`, () => {
    const shifted = clip_line_to_cell([0.25, 0.25, 0.5], [0, 0, 1], cubic_2)
    expect(shifted).not.toBeNull()
    const [s1, s2] = (shifted as [Vec3, Vec3]).toSorted((v1, v2) => v1[2] - v2[2])
    expect(s1).toEqual([0.5, 0.5, 0])
    expect(s2).toEqual([0.5, 0.5, 2])

    const diag = clip_line_to_cell([0, 0, 0], [1, 1, 1], cubic_2)
    expect(diag).not.toBeNull()
    const [d1, d2] = (diag as [Vec3, Vec3]).toSorted((v1, v2) => v1[2] - v2[2])
    expect(d1).toEqual([0, 0, 0])
    expect(d2).toEqual([2, 2, 2])
  })

  test(`clip_line_to_cell: line outside the cell returns null`, () => {
    expect(clip_line_to_cell([1.5, 0.5, 0], [0, 0, 1], cubic_2)).toBeNull()
  })

  test(`clip_plane_to_cell: z=0 mirror plane is the full bottom face`, () => {
    const poly = clip_plane_to_cell([0, 0, 0], [0, 0, 1], cubic_2)
    expect(poly).toHaveLength(4)
    for (const vert of poly) expect(vert[2]).toBeCloseTo(0, 10)
    const corner_keys = new Set(poly.map((vert) => `${vert[0]},${vert[1]}`))
    expect(corner_keys).toEqual(new Set([`0,0`, `2,0`, `0,2`, `2,2`]))
  })

  test(`clip_plane_to_cell: diagonal plane normal [110] through cell center`, () => {
    const poly = clip_plane_to_cell([0.5, 0.5, 0.5], [1, 1, 0], cubic_2)
    expect(poly).toHaveLength(4)
    // plane x + y = 2 in Cartesian coords of the a=2 cell
    for (const vert of poly) expect(vert[0] + vert[1]).toBeCloseTo(2, 10)
  })

  test(`clip_plane_to_cell: plane outside the cell yields an empty polygon`, () => {
    // z = 2 plane (point well above the unit cube) intersects no edge
    expect(clip_plane_to_cell([0, 0, 2], [0, 0, 1], cubic_2)).toEqual([])
  })

  test(`clip_plane_to_cell: hexagonal mirror polygon lies in the true Cartesian plane`, () => {
    const [a_len, c_len] = [2.5, 4]
    const hex_lattice: Matrix3x3 = [
      [a_len, 0, 0],
      [-a_len / 2, (a_len * Math.sqrt(3)) / 2, 0],
      [0, 0, c_len],
    ]
    // mirror swapping a1 and a2: fractional normal [1,-1,0] through (1/2, 1/2, z)
    const normal_frac: Vec3 = [1, -1, 0]
    const poly = clip_plane_to_cell([0.5, 0.5, 0], normal_frac, hex_lattice)
    expect(poly.length).toBeGreaterThanOrEqual(3)
    const normal_cart = frac_to_cart_direction(normal_frac, hex_lattice)
    const point_cart = frac_to_cart_direction([0.5, 0.5, 0], hex_lattice)
    for (const vert of poly) {
      expect(math.dot(math.subtract(vert, point_cart), normal_cart)).toBeCloseTo(0, 8)
    }
  })

  test(`skew mirror: plane equation needs the metric pullback of the normal`, () => {
    // Mirror mapping a2 ↦ a1 − a2 of an oblique lattice (|a2| = |a1 − a2|). Its
    // fractional normal [1,-2,0] is NOT plain-dot orthogonal to the invariant plane
    // (spanned by a1, a3), so using it directly as the fractional plane equation
    // (instead of pulling back the Cartesian normal) clips the wrong plane.
    const skew_mirror: Matrix3x3 = [
      [1, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
    ]
    const elem = classify_symmetry_op(col_major(skew_mirror), [0, 0, 0])
    expect(elem).toMatchObject({ kind: `mirror`, label: `m`, axis: [1, -2, 0] })

    const lattice: Matrix3x3 = [
      [1, 0, 0],
      [0.5, 0.8, 0],
      [0, 0, 2],
    ]
    const poly = clip_plane_to_cell([0, 0, 0], elem?.axis as Vec3, lattice)
    expect(poly.length).toBeGreaterThanOrEqual(3)
    // Cartesian normal: (1,-2,0)·L = a1 − 2·a2 = (0,-1.6,0) → the plane is y = 0
    for (const vert of poly) expect(vert[1]).toBeCloseTo(0, 8)
  })

  test(`clip_plane_to_cell returns vertices in convex winding order`, () => {
    // The body-diagonal plane through the cell center cuts a regular hexagon. Vertices
    // must come out sorted around the centroid (the angle-sort step) — otherwise the
    // rendered polygon self-intersects. A convex, consistently-wound polygon turns the
    // same way at every vertex, so all consecutive edge cross products project onto the
    // plane normal with the same sign.
    const lattice: Matrix3x3 = [
      [2, 0, 0],
      [0, 2, 0],
      [0, 0, 2],
    ]
    const poly = clip_plane_to_cell([0.5, 0.5, 0.5], [1, 1, 1], lattice)
    expect(poly).toHaveLength(6) // hexagonal cross-section
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
    expect(segs.length).toBeGreaterThan(2)
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

  test.each([
    { length: 0.3, label: `shorter than one dash` },
    { length: 0.45, label: `exactly one dash` },
  ])(`$label: single full-length segment`, ({ length }) => {
    expect(dash_segments(length, 0.45, 0.3)).toEqual([{ center: length / 2, length }])
  })

  test(`between one and two dash periods: single centered dash`, () => {
    const segs = dash_segments(0.9, 0.45, 0.3) // 0.9 < 2*0.45 + 0.3
    expect(segs).toEqual([{ center: 0.45, length: 0.45 }])
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
