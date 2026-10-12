import type { Matrix3x3, Vec2, Vec3 } from '#lib/math.js'
import { band_point_meta, create_band_path_link } from '#lib/spectral/band-path-link.svelte.js'
import type { BandHover } from '#lib/spectral/band-path-link.svelte.js'
import type { BaseBandStructure } from '#lib/spectral/types.js'
import { flushSync } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'

const roots: (() => void)[] = []
afterEach(() => {
  for (const destroy of roots.splice(0)) destroy()
})

const identity: Matrix3x3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]

// Γ→X→M, pymatgen style: X repeated as the end of one branch and the start of the next
const coords: Vec3[] = [
  [0, 0, 0],
  [0.25, 0, 0],
  [0.5, 0, 0],
  [0.5, 0, 0],
  [0.5, 0.25, 0],
  [0.5, 0.5, 0],
]
const labels = [`GAMMA`, null, `X`, `X`, null, `M`]
const distance = [0, 0.5, 1, 1, 1.5, 2]
const band_struct: BaseBandStructure = {
  type: `phonon`,
  qpoints: coords.map((frac_coords, idx) => ({
    label: labels[idx],
    frac_coords,
    distance: distance[idx],
  })),
  branches: [
    { start_index: 0, end_index: 2, name: `GAMMA-X` },
    { start_index: 3, end_index: 5, name: `X-M` },
  ],
  labels_dict: { GAMMA: [0, 0, 0], X: [0.5, 0, 0], M: [0.5, 0.5, 0] },
  distance,
  nb_bands: 1,
  bands: [[0, 1, 2, 2, 3, 4]],
}
// the same path sampled more coarsely (a second structure Bands overlays)
const coarse_struct: BaseBandStructure = {
  ...band_struct,
  qpoints: [0, 2, 3, 5].map((idx) => band_struct.qpoints[idx]),
  branches: [
    { start_index: 0, end_index: 1, name: `GAMMA-X`, is_discontinuity: false },
    { start_index: 2, end_index: 3, name: `X-M`, is_discontinuity: false },
  ],
  distance: [0, 1, 1, 2],
  bands: [[0, 2, 2, 4]],
}

// a Bands hover event of band 0 at a q-point of the given structure
const hover = (qpoint_idx: number, x = 0, struct = band_struct): BandHover => ({
  x,
  metadata: {
    band_idx: 0,
    qpoint_idx,
    frac_coords: struct.qpoints[qpoint_idx].frac_coords,
  },
})

const make_link = (inputs: Partial<Parameters<typeof create_band_path_link>[0]> = {}) => {
  let link: ReturnType<typeof create_band_path_link> | undefined
  roots.push(
    $effect.root(() => {
      link = create_band_path_link({
        band_struct: () => band_struct,
        k_lattice: () => identity,
        ...inputs,
      })
    }),
  )
  if (!link) throw new Error(`link not created`)
  return link
}

// active q-point, its k-point and its branch range in one snapshot
const state = (link: ReturnType<typeof create_band_path_link>) => {
  flushSync()
  const { active_qpoint, hovered_k_point, highlighted_qpoint_range } = link
  return { active_qpoint, hovered_k_point, highlighted_qpoint_range }
}
const idle = { active_qpoint: null, hovered_k_point: null, highlighted_qpoint_range: null }

describe(`band_point_meta`, () => {
  test.each([
    [
      { band_idx: 2, qpoint_idx: 7, frac_coords: [0.5, 0, 0], spin: `up` },
      { band_idx: 2, qpoint_idx: 7, frac_coords: [0.5, 0, 0] },
    ],
    [
      { band_idx: 0, qpoint_idx: 1, frac_coords: [`0.5`, 0, 0] },
      { band_idx: 0, qpoint_idx: 1, frac_coords: null },
    ],
    [
      { band_idx: 0, qpoint_idx: 1 },
      { band_idx: 0, qpoint_idx: 1, frac_coords: null },
    ],
    [{ band_idx: 0 }, null],
    [{ band_idx: `0`, qpoint_idx: 1 }, null],
    [null, null],
    [undefined, null],
  ])(`%j -> %j`, (metadata, expected) => {
    expect(band_point_meta(metadata)).toEqual(expected)
  })
})

describe(`create_band_path_link`, () => {
  test(`k-path points and labels follow the band structure and reciprocal lattice`, () => {
    const link = make_link()
    expect(link.k_path_points).toEqual(coords)
    expect(link.k_path_labels.map(({ label }) => label)).toEqual([
      `Γ`,
      null,
      `X`,
      `X`,
      null,
      `M`,
    ])
    const doubled = make_link({
      k_lattice: () => [
        [2, 0, 0],
        [0, 2, 0],
        [0, 0, 2],
      ],
    })
    expect(doubled.k_path_points[4]).toEqual([1, 0.5, 0])
  })

  test.each([
    [1, [0.25, 0, 0], [0, 2]],
    [2, [0.5, 0, 0], [0, 2]],
    // the first point of X→M shades X→M, not the Γ→X branch ending at the same x
    [3, [0.5, 0, 0], [3, 5]],
    [4, [0.5, 0.25, 0], [3, 5]],
  ])(`band hover at q-point %i marks its k-point and branch`, (qpoint_idx, k_point, range) => {
    const link = make_link()
    link.hover_band(hover(qpoint_idx))
    expect(state(link)).toEqual({
      active_qpoint: qpoint_idx,
      hovered_k_point: k_point,
      highlighted_qpoint_range: range,
    })
    link.hover_band(null)
    expect(state(link)).toEqual(idle)
  })

  test(`path hover marks the q-point, a band hover wins over it until it clears`, () => {
    const link = make_link()
    link.hover_path(1)
    const path_state = {
      active_qpoint: 1,
      hovered_k_point: [0.25, 0, 0],
      highlighted_qpoint_range: [0, 2],
    }
    expect(state(link)).toEqual(path_state)
    link.hover_band(hover(4))
    expect(state(link)).toMatchObject({ active_qpoint: 4, highlighted_qpoint_range: [3, 5] })
    link.hover_band(null)
    expect(state(link)).toEqual(path_state)
    link.hover_path(null)
    expect(state(link)).toEqual(idle)
  })

  test(`points without band metadata or band structure mark nothing`, () => {
    const link = make_link()
    link.hover_band({ x: 0.5, metadata: { label: `caller series` } })
    expect(state(link)).toEqual(idle)
    link.hover_band({ x: 0.5, metadata: null })
    expect(state(link)).toEqual(idle)
    const empty = make_link({ band_struct: () => undefined })
    empty.hover_band(hover(1))
    expect(state(empty)).toEqual(idle)
    expect(empty.k_path_points).toEqual([])
    expect(empty.k_path_labels).toEqual([])
  })

  test(`without a reciprocal lattice the q-point still links but has no k-point`, () => {
    const link = make_link({ k_lattice: () => undefined })
    link.hover_band(hover(4))
    expect(state(link)).toEqual({
      active_qpoint: 4,
      hovered_k_point: null,
      highlighted_qpoint_range: [3, 5],
    })
    expect(link.k_path_points).toEqual([])
  })

  // coarse q-point 1 is X; band_struct's q-point 1 is a different k-point
  test.each([
    [1, 1, 2],
    [3, 2, 5],
  ])(
    `a point of another structure (coarse q-point %i at x=%d) maps by x onto q-point %i`,
    (coarse_idx, x, expected_idx) => {
      const x_positions: Record<string, Vec2> = { GAMMA_X: [0, 1], X_M: [1, 2] }
      const link = make_link({ x_positions: () => x_positions })
      link.hover_band(hover(coarse_idx, x, coarse_struct))
      expect(state(link).active_qpoint).toBe(expected_idx)
      // without x positions it cannot be placed on band_struct's path
      const unplaced = make_link()
      unplaced.hover_band(hover(coarse_idx, x, coarse_struct))
      expect(state(unplaced)).toEqual(idle)
    },
  )
})
