import type { Matrix3x3, Vec2, Vec3 } from '#lib/math.js'
import { branch_segment_keys } from '#lib/spectral/helpers.js'
import {
  mode_value_markers,
  MODE_MARKER_BINS,
  thin_mode_markers,
  normalize_mode_values,
  project_qpoints_onto_path,
} from '#lib/spectral/mode-values.js'
import type { BaseBandStructure } from '#lib/spectral/types.js'
import { describe, expect, test } from 'vitest'
import { IDENTITY_MATRIX3 } from '../test-fixtures'

// Paths in a reciprocal lattice of 2·identity (Cartesian = 2 × frac) with x = path distance in
// fractional units (Bands scales each segment to its distance span)
const SQRT_HALF = Math.SQRT1_2
const path_struct = (frac_coords: Vec3[], branches: Vec2[]): BaseBandStructure => {
  const distance = frac_coords.map(() => 0)
  for (const [start, end] of branches) {
    for (let idx = start + 1; idx <= end; idx++) {
      const step = Math.hypot(
        ...frac_coords[idx].map((coord, axis) => coord - frac_coords[idx - 1][axis]),
      )
      distance[idx] = distance[idx - 1] + step
    }
    const next = end + 1
    if (next < distance.length) distance[next] = distance[end]
  }
  return {
    type: `phonon`,
    qpoints: frac_coords.map((coords) => ({ label: null, frac_coords: coords })),
    branches: branches.map(([start_index, end_index]) => ({
      start_index,
      end_index,
      name: `${start_index}-${end_index}`,
    })),
    labels_dict: {},
    distance,
    nb_bands: 1,
    bands: [frac_coords.map(() => 1)],
  }
}
// x-ranges laid end to end as Bands does: a jump advances nothing
const x_positions_of = (band_struct: BaseBandStructure): Record<string, Vec2> => {
  const keys = branch_segment_keys(band_struct)
  let current = 0
  return Object.fromEntries(
    band_struct.branches.map(({ start_index, end_index }, idx) => {
      const span = band_struct.distance[end_index] - band_struct.distance[start_index]
      current += span
      return [keys[idx], [current - span, current]]
    }),
  )
}
// Γ→X, a jump X|M, then M→Γ
const recip = IDENTITY_MATRIX3.map((row) => row.map((val) => 2 * val)) as Matrix3x3
// oxfmt-ignore
const jump_path = path_struct(
  [[0, 0, 0], [0.25, 0, 0], [0.5, 0, 0], [0.5, 0.5, 0], [0.25, 0.25, 0], [0, 0, 0]],
  [[0, 2], [3, 5]],
)
// Γ→X→M with X duplicated at the joint of two branches, so the path is continuous there
// oxfmt-ignore
const joint_path = path_struct(
  [[0, 0, 0], [0.25, 0, 0], [0.5, 0, 0], [0.5, 0, 0], [0.5, 0.25, 0], [0.5, 0.5, 0]],
  [[0, 2], [3, 5]],
)
// median step 2 × 0.25√2 = 0.707 (Cartesian), so the default tolerance (0.1 steps) is 0.0707,
// 0.035 in fractional units
const m_gamma_end = 0.5 + SQRT_HALF

describe(`project_qpoints_onto_path`, () => {
  // oxfmt-ignore
  test.each<[string, BaseBandStructure, Vec3, number[]]>([
    [`on a segment`, jump_path, [0.1, 0, 0], [0.1]],
    [`at an interior path q-point, once`, jump_path, [0.25, 0, 0], [0.25]],
    [`off the path within tolerance`, jump_path, [0.375, 0.02, 0], [0.375]],
    [`off the path beyond tolerance`, jump_path, [0.3, 0.1, 0], []],
    [`a periodic image of a path point`, jump_path, [-0.9, 1, 2], [0.1]],
    [`a point the path visits twice (Γ at both ends)`, jump_path, [0, 0, 0], [0, m_gamma_end]],
    [`the end of the branch before a jump (X)`, jump_path, [0.5, 0, 0], [0.5]],
    [`the start of the branch after a jump (M)`, jump_path, [0.5, 0.5, 0], [0.5]],
    [`just before the jump`, jump_path, [0.49, 0, 0], [0.49]],
    [`just after the jump`, jump_path, [0.49, 0.49, 0], [0.5 + 0.01 * Math.SQRT2]],
    [`beyond a branch end along its line`, jump_path, [0.52, 0, 0], [0.5]],
    [`the duplicated joint of continuous branches, once`, joint_path, [0.5, 0, 0], [0.5]],
    [`near the joint of continuous branches, once`, joint_path, [0.48, 0.01, 0], [0.48]],
    [`on the branch after the joint`, joint_path, [0.5, 0.2, 0], [0.7]],
  ])(`%s`, (_desc, band_struct, qpoint, expected) => {
    const xs = project_qpoints_onto_path(band_struct, recip, [qpoint], x_positions_of(band_struct))
    expect(xs.map(({ q_idx }) => q_idx)).toEqual(expected.map(() => 0))
    // exact arithmetic up to a few ulps of the path's ~1 x-span
    for (const [idx, { x }] of xs.entries()) expect(Math.abs(x - expected[idx])).toBeLessThan(1e-12)
  })

  test(`keeps q-point indices, skips unplotted branches and scales with rel_tol`, () => {
    const qpoints: Vec3[] = [
      [0.3, 0.1, 0],
      [0.2, 0, 0],
      [0.4, 0.4, 0],
    ]
    const x_positions = x_positions_of(jump_path)
    const [first_key] = Object.keys(x_positions)
    const project = (positions: Record<string, Vec2>, rel_tol?: number) =>
      project_qpoints_onto_path(jump_path, recip, qpoints, positions, rel_tol).map(
        ({ q_idx }) => q_idx,
      )
    expect(project(x_positions)).toEqual([1, 2])
    // 0.1 off Γ→X is 0.2 Cartesian, within 0.3 × the 0.707 median step (M→Γ stays 0.28 away)
    expect(project(x_positions, 0.3)).toEqual([0, 1, 2])
    expect(project({ [first_key]: x_positions[first_key] })).toEqual([1])
  })
})

describe(`normalize_mode_values`, () => {
  const valid = {
    label: `λ_qν`,
    qpoints: [
      [0, 0, 0],
      [0.5, 0, 0],
    ],
    frequencies: [
      [0, 1],
      [-0.5, 2],
    ],
    values: [
      [null, 0.3],
      [NaN, 0.1],
    ],
  }
  test(`accepts NaN and null (JSON's NaN) as no value, imaginary frequencies`, () => {
    const parsed = normalize_mode_values(valid)
    expect(parsed.values).toEqual([
      [NaN, 0.3],
      [NaN, 0.1],
    ])
    expect(parsed.frequencies).toEqual(valid.frequencies)
    // NaN values draw no marker
    const projections = [
      { q_idx: 0, x: 0 },
      { q_idx: 1, x: 0.5 },
    ]
    expect(mode_value_markers(parsed, projections)).toEqual([
      { x: 0, frequency: 1, value: 0.3, q_idx: 0, mode_idx: 1 },
      { x: 0.5, frequency: 2, value: 0.1, q_idx: 1, mode_idx: 1 },
    ])
  })
  // oxfmt-ignore
  test.each<[string, object, string]>([
    [`an unknown field`, { extra: 1 }, `extra: unknown field`],
    [`a numeric label`, { label: 1 }, `label must be a string`],
    [`a 2D q-point`, { qpoints: [[0, 0], [0.5, 0, 0]] }, `qpoints must be an array of 3 finite`],
    [`a q-point without frequencies`, { frequencies: [[0, 1]] }, `frequencies must have one row per q-point (2), got 1`],
    [`ragged frequencies`, { frequencies: [[0, 1], [2]] }, `frequencies[1] must be 2 finite numbers`],
    [`a NaN frequency`, { frequencies: [[0, 1], [NaN, 2]] }, `frequencies[1] must be 2 finite numbers`],
    [`values unlike frequencies`, { values: [[0.1, 0.3], [0.1]] }, `values[1] must be 2 numbers`],
    [`an infinite value`, { values: [[0.1, 0.3], [Infinity, 0.1]] }, `values[1] must be 2 numbers`],
    [`a string value`, { values: [[0.1, `0.3`], [0.1, 0.1]] }, `values[0] must be 2 numbers`],
    [`values missing`, { values: undefined }, `values must have one row per q-point (2), got undefined`],
  ])(`rejects %s`, (_desc, patch, message) => {
    expect(() => normalize_mode_values({ ...valid, ...patch })).toThrow(message)
  })
})

// a q mesh meeting the path every few pixels would fill the bands with triangles: each mode
// keeps its strongest marker per 1/MODE_MARKER_BINS of the path, so strong coupling stays
describe(`thin_mode_markers`, () => {
  const marker = (x: number, mode_idx: number, value: number) => ({
    x,
    frequency: mode_idx,
    value,
    q_idx: Math.round(x * 1000),
    mode_idx,
  })
  const bin = 1 / MODE_MARKER_BINS
  test(`keeps the strongest |value| per mode in each stretch of the path`, () => {
    const markers = [
      marker(0.1 * bin, 0, 0.2),
      marker(0.5 * bin, 0, -3), // the strongest in the first stretch, by |value|
      marker(0.9 * bin, 0, 1),
      marker(0.5 * bin, 1, 0.1), // another mode: kept on its own
      marker(1.5 * bin, 0, 0.1), // the next stretch
      marker(1, 0, 0.4), // the path's end falls in the last stretch
    ]
    expect(thin_mode_markers(markers, [0, 1])).toEqual([
      markers[1],
      markers[3],
      markers[4],
      markers[5],
    ])
  })
  test(`thins a dense mesh to one marker per mode and stretch`, () => {
    const dense = Array.from({ length: 1000 }, (_, idx) => marker(idx / 999, idx % 3, idx))
    expect(thin_mode_markers(dense, [0, 1])).toHaveLength(3 * MODE_MARKER_BINS)
  })
  test(`a path without extent keeps every marker`, () => {
    const markers = [marker(0, 0, 1), marker(0, 0, 2)]
    expect(thin_mode_markers(markers, [0, 0])).toEqual(markers)
  })
})
