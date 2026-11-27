import { type Matrix3x3, mulberry32, type Vec3 } from '#lib/math'
import type { Crystal } from '#lib/structure/index'
import { compute_structure_diff } from '#lib/structure-diff/compute'
import { trajectory_diffs } from '#lib/structure-diff/trajectory'
import { describe, expect, test } from 'vite-plus/test'
import { cubic_matrix, make_crystal, make_position_stream } from '../test-fixtures'

// Six frames of a 4-atom cell: a seeded random walk on top of a -0.3 Å/frame drift along x
// that carries atom 0 across the a face, positions wrapped into each frame's cell
const elements = [`Na`, `Cl`, `Na`, `Cl`] as const
const walk = (() => {
  const rand = mulberry32(3)
  let current: Vec3[] = [[0.2, 1, 1], [5, 5, 5], [2, 7, 3], [8, 2, 6]] // oxfmt-ignore
  return Array.from({ length: 6 }, () => {
    const frame = current
    current = current.map(
      (xyz) => xyz.map((val, axis) => val + (rand() - 0.5) * 0.4 - (axis ? 0 : 0.3)) as Vec3,
    )
    return frame
  })
})()
const trajectory = (matrices: Matrix3x3[]) => {
  const crystals: Crystal[] = walk.map((frame, frame_idx) => {
    const length = matrices[frame_idx][0][0]
    const sites = frame.map((xyz, idx) => ({
      element: elements[idx],
      xyz: xyz.map((val) => val - length * Math.floor(val / length)) as Vec3,
    }))
    return make_crystal(matrices[frame_idx], sites)
  })
  const positions = crystals.map(({ sites }) => sites.map(({ xyz }) => xyz))
  return {
    crystals,
    stream: make_position_stream(positions, [...elements], { lattice_matrices: matrices }),
  }
}
const cells = {
  fixed: walk.map(() => cubic_matrix(10)),
  // NPT-like: the cubic cell grows 1% per frame
  growing: walk.map((_, frame_idx) => cubic_matrix(10 * 1.01 ** frame_idx)),
}
const cases = Object.keys(cells).flatMap((cell) =>
  [false, true].map((remove_drift) => [cell as keyof typeof cells, remove_drift] as const),
)

describe(`trajectory_diffs`, () => {
  test.each(cases)(
    `%s cell, remove_drift %s: RMSD rows and first/previous frames match direct diffs`,
    (cell, remove_drift) => {
      const { crystals, stream } = trajectory(cells[cell])
      const template = structuredClone(crystals[0])
      const { rows, frame } = trajectory_diffs(stream, template, remove_drift)
      const options = { matching: `index`, remove_drift } as const
      const direct = (ref_idx: number, frame_idx: number) =>
        compute_structure_diff(crystals[ref_idx], crystals[frame_idx], options)
      expect(rows).toEqual(
        crystals.map((_, idx) => ({
          frame_number: idx,
          step: idx,
          properties: { rmsd: direct(0, idx).rmsd },
        })),
      )
      expect(frame(crystals[0], 0, `previous`)).toBe(`The first frame has no previous frame`)
      for (const frame_idx of crystals.keys()) {
        expect(frame(crystals[frame_idx], frame_idx, `first`)).toEqual({
          diff: direct(0, frame_idx),
          reference_frame: 0,
        })
        if (frame_idx === 0) continue
        expect(frame(crystals[frame_idx], frame_idx, `previous`)).toEqual({
          diff: direct(frame_idx - 1, frame_idx),
          reference_frame: frame_idx - 1,
        })
      }
      // the scratch structures are copies: the template keeps its positions
      expect(template).toEqual(crystals[0])
    },
  )

  test(`a strided stream compares against the latest collected frame`, () => {
    const { crystals } = trajectory(cells.fixed)
    const collected = [0, 2, 4].map((idx) => crystals[idx].sites.map(({ xyz }) => xyz))
    const stream = make_position_stream(collected, [...elements], {
      frame_stride: 2,
      steps: [0, 2, 4],
    })
    const { rows, frame } = trajectory_diffs(stream, crystals[0], true)
    expect([1, 2, 3, 5].map((idx) => frame(crystals[idx], idx, `previous`))).toMatchObject(
      [0, 0, 2, 4].map((reference_frame) => ({ reference_frame })),
    )
    expect(rows.map(({ frame_number }) => frame_number)).toEqual([0, 2, 4])
  })

  test(`a stream with a different atom count throws`, () => {
    const { crystals } = trajectory(cells.fixed)
    const stream = make_position_stream([[[0, 0, 0]]], [`Na`])
    expect(() => trajectory_diffs(stream, crystals[0], true)).toThrow(
      `Frame has 4 sites but the position stream 1 atoms`,
    )
  })
})
