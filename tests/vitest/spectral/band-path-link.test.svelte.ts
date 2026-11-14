import type { Vec2, Vec3 } from '#lib/math.js'
import { band_point_meta, create_band_path_link } from '#lib/spectral/band-path-link.svelte.js'
import type { BandHover } from '#lib/spectral/band-path-link.svelte.js'
import type { BaseBandStructure } from '#lib/spectral/types.js'
import { flushSync } from 'svelte'
import { afterEach, describe, expect, test } from 'vite-plus/test'
import { IDENTITY_MATRIX3 } from '../test-fixtures'

const roots: (() => void)[] = []
afterEach(() => {
  for (const destroy of roots.splice(0)) destroy()
})

// Γ→X→M, pymatgen style: X repeated as the end of one branch and the start of the next
// oxfmt-ignore
const coords: Vec3[] = [[0, 0, 0], [0.25, 0, 0], [0.5, 0, 0], [0.5, 0, 0], [0.5, 0.25, 0], [0.5, 0.5, 0]]
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

// a Bands hover event of band 0 at a q-point of the given structure
const hover = (qpoint_idx: number, x = 0, struct = band_struct): BandHover => ({
  x,
  metadata: { band_idx: 0, qpoint_idx, frac_coords: struct.qpoints[qpoint_idx].frac_coords },
})

const make_link = (inputs: Partial<Parameters<typeof create_band_path_link>[0]> = {}) => {
  let link: ReturnType<typeof create_band_path_link> | undefined
  roots.push(
    $effect.root(() => {
      link = create_band_path_link({
        band_struct: () => band_struct,
        k_lattice: () => IDENTITY_MATRIX3,
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

// oxfmt-ignore
test.each([
  [{ band_idx: 2, qpoint_idx: 7, frac_coords: [0.5, 0, 0], spin: `up` }, { band_idx: 2, qpoint_idx: 7, frac_coords: [0.5, 0, 0] }],
  [{ band_idx: 0, qpoint_idx: 1, frac_coords: [`0.5`, 0, 0] }, { band_idx: 0, qpoint_idx: 1, frac_coords: null }],
  [{ band_idx: `0`, qpoint_idx: 1 }, null],
  [{ band_idx: 0 }, null],
  [null, null],
])(`band_point_meta(%j) -> %j`, (metadata, expected) => {
  expect(band_point_meta(metadata)).toEqual(expected)
})

describe(`create_band_path_link`, () => {
  // the first point of X→M (q-point 3) shades X→M, not the Γ→X branch ending at the same x; a
  // band hover wins over a k-path hover until it clears
  test(`k-path follows the band structure; hovers mark the q-point, k-point and branch`, () => {
    const link = make_link()
    const branches = [
      [0, 2],
      [3, 5],
    ]
    expect(link.k_path).toEqual({
      points: coords,
      labels: [`Γ`, ...labels.slice(1)],
      branches,
    })
    link.hover_path(1)
    const path_state = {
      active_qpoint: 1,
      hovered_k_point: [0.25, 0, 0],
      highlighted_qpoint_range: [0, 2],
    }
    expect(state(link)).toEqual(path_state)
    link.hover_band(hover(3))
    expect(state(link)).toEqual({
      active_qpoint: 3,
      hovered_k_point: [0.5, 0, 0],
      highlighted_qpoint_range: [3, 5],
    })
    link.hover_band(null)
    expect(state(link)).toEqual(path_state)
    link.hover_path(null)
    expect(state(link)).toEqual(idle)
  })

  test(`a missing band structure marks nothing, a missing lattice no k-point`, () => {
    const empty = make_link({ band_struct: () => undefined })
    empty.hover_band(hover(1))
    expect(state(empty)).toEqual(idle)
    expect(empty.k_path).toBeUndefined()
    // without a reciprocal lattice the q-point still links but has no k-point
    const no_lattice = make_link({ k_lattice: () => undefined })
    no_lattice.hover_band(hover(4))
    expect(state(no_lattice)).toEqual({
      ...idle,
      active_qpoint: 4,
      highlighted_qpoint_range: [3, 5],
    })
  })

  // a coarser second structure Bands overlays: its q-point 3 (M at x=2) is not band_struct's
  // q-point 3, so it maps by x, and cannot be placed without x positions
  test(`a point of another structure maps by x onto the band structure's path`, () => {
    const coarse_struct = {
      ...band_struct,
      qpoints: [0, 2, 3, 5].map((idx) => band_struct.qpoints[idx]),
    }
    const x_positions: Record<string, Vec2> = { GAMMA_X: [0, 1], X_M: [1, 2] }
    const link = make_link({ x_positions: () => x_positions })
    link.hover_band(hover(3, 2, coarse_struct))
    expect(state(link).active_qpoint).toBe(5)
    const unplaced = make_link()
    unplaced.hover_band(hover(3, 2, coarse_struct))
    expect(state(unplaced)).toEqual(idle)
  })
})
