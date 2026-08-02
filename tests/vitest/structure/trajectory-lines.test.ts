import type { ElementSymbol } from '$lib/element'
import type { Matrix3x3 } from '$lib/math'
import {
  build_trajectory_lines,
  unwrapped_stream_positions,
} from '$lib/structure/trajectory-lines'
import type { TrajectoryPositionStream } from '$lib/trajectory'
import { describe, expect, test } from 'vitest'

const CUBIC_10: Matrix3x3 = [
  [10, 0, 0],
  [0, 10, 0],
  [0, 0, 10],
]

// Positions are laid out frame-major: (frame * n_atoms + atom) * 3 + axis
function make_stream(
  frames: number[][][], // [frame][atom][axis]
  elements: ElementSymbol[],
  overrides: Partial<TrajectoryPositionStream> = {},
): TrajectoryPositionStream {
  const n_frames = frames.length
  const n_atoms = elements.length
  const positions = new Float64Array(n_frames * n_atoms * 3)
  for (const [frame_idx, frame] of frames.entries()) {
    for (const [atom_idx, xyz] of frame.entries()) {
      positions.set(xyz, (frame_idx * n_atoms + atom_idx) * 3)
    }
  }
  return {
    positions,
    n_frames,
    n_atoms,
    elements,
    lattice_matrices: Array.from({ length: n_frames }, () => CUBIC_10),
    pbc: [true, true, true],
    coords_unwrapped: false,
    frame_stride: 1,
    steps: Array.from({ length: n_frames }, (_, idx) => idx),
    ...overrides,
  }
}

// One atom drifting +1 Å along x per frame, wrapped into a 10 Å cell: 0,1,…,9,0,1,…
// The wrap between frames 9 and 10 is the artefact unwrapping must remove.
const wrapping_stream = (n_frames = 15, element: ElementSymbol = `Li`) =>
  make_stream(
    Array.from({ length: n_frames }, (_, frame_idx) => [[frame_idx % 10, 0, 0]]),
    [element],
  )

// Every drawn segment, as [from_xyz, to_xyz] pairs read back through the index buffer
function segments_of(
  built: ReturnType<typeof build_trajectory_lines>,
): [number[], number[]][] {
  const { positions, indices } = built
  const point_at = (point_idx: number) => [
    positions[point_idx * 3],
    positions[point_idx * 3 + 1],
    positions[point_idx * 3 + 2],
  ]
  return Array.from({ length: indices.length / 2 }, (_, seg_idx) => [
    point_at(indices[seg_idx * 2]),
    point_at(indices[seg_idx * 2 + 1]),
  ])
}

describe(`build_trajectory_lines vertex counts`, () => {
  test.each([
    // [n_frames, n_atoms, trail_frames, frame_stride, expected_sampled_frames]
    [10, 3, null, 1, 10],
    [10, 3, 4, 1, 4],
    // stride 3 over the full 0..9 window: both ends plus the interior grid points 3, 6
    [10, 1, null, 3, 4],
    // a window shorter than the stride still yields its two end anchors, never a bare point
    [10, 1, 3, 10, 2],
  ])(
    `%i frames x %i atoms, trail %s stride %i -> %i sampled frames`,
    (n_frames, n_atoms, trail_frames, frame_stride, expected_sampled) => {
      const elements: ElementSymbol[] = Array.from({ length: n_atoms }, () => `Li`)
      const stream = make_stream(
        Array.from({ length: n_frames }, (_frame, frame_idx) =>
          Array.from({ length: n_atoms }, (_atom, atom_idx) => [frame_idx * 0.1, atom_idx, 0]),
        ),
        elements,
      )
      const built = build_trajectory_lines(stream, { trail_frames, frame_stride })

      expect(built.frame_idxs).toHaveLength(expected_sampled)
      expect(built.atom_count).toBe(n_atoms)
      expect(built.point_count).toBe(n_atoms * expected_sampled)
      expect(built.positions).toHaveLength(n_atoms * expected_sampled * 3)
      expect(built.colors).toHaveLength(n_atoms * expected_sampled * 3)
      expect(built.segment_count).toBe(n_atoms * (expected_sampled - 1))
      expect(built.indices).toHaveLength(n_atoms * (expected_sampled - 1) * 2)
      // No index may point past the end of the position buffer
      expect(Math.max(...built.indices)).toBe(built.point_count - 1)
    },
  )

  test(`sampled window ends at end_frame and spans exactly trail_frames`, () => {
    const stream = wrapping_stream(20)
    const built = build_trajectory_lines(stream, { end_frame: 12, trail_frames: 5 })
    expect(built.frame_idxs).toEqual([8, 9, 10, 11, 12])
  })

  test(`interior stride grid is anchored at frame 0, so it does not shift as the window slides`, () => {
    const stream = wrapping_stream(40)
    const at_20 = build_trajectory_lines(stream, {
      end_frame: 20,
      trail_frames: 13,
      frame_stride: 4,
    })
    const at_21 = build_trajectory_lines(stream, {
      end_frame: 21,
      trail_frames: 13,
      frame_stride: 4,
    })
    expect(at_20.frame_idxs).toEqual([8, 12, 16, 20])
    // Interior points 12 and 16 stay put; only the two moving ends differ
    expect(at_21.frame_idxs).toEqual([9, 12, 16, 20, 21])
  })

  test.each([
    [`end_frame out of range`, { end_frame: 99 }, /end_frame must be an integer in \[0, 14\]/],
    [`zero frame_stride`, { frame_stride: 0 }, /frame_stride must be a positive integer/],
    [
      `fractional frame_stride`,
      { frame_stride: 1.5 },
      /frame_stride must be a positive integer/,
    ],
    [`zero trail_frames`, { trail_frames: 0 }, /trail_frames must be null or a positive/],
  ])(`throws on %s`, (_label, options, message) => {
    expect(() => build_trajectory_lines(wrapping_stream(), options)).toThrow(message)
  })

  test(`throws when the element labels do not cover every atom`, () => {
    const stream = make_stream(
      [
        [
          [0, 0, 0],
          [1, 0, 0],
        ],
        [
          [0, 0, 1],
          [1, 0, 1],
        ],
      ],
      [`Li`, `O`],
    )
    expect(() => build_trajectory_lines({ ...stream, elements: [`Li`] })).toThrow(
      /got 1 element labels for 2 atoms/,
    )
  })
})

describe(`periodic boundary handling`, () => {
  test(`unwraps a PBC-crossing path into a continuous line instead of a box-spanning segment`, () => {
    const stream = wrapping_stream(15)
    // Raw coordinates contain the artefact: frame 9 -> 10 jumps 9 Å back across the cell
    const raw = segments_of(build_trajectory_lines(stream, { wrap_mode: `break` }))
    expect(raw).toHaveLength(13) // 14 steps, the wrap-around omitted

    const built = build_trajectory_lines(stream, { wrap_mode: `unwrap` })
    expect(built.segment_count).toBe(14)
    // Every step is the true 1 Å drift — no segment anywhere near the 10 Å box
    for (const [[from_x], [to_x]] of segments_of(built)) {
      expect(to_x - from_x).toBeCloseTo(1, 5)
    }
    // Documented continuity threshold: half the shortest cell vector. Anything longer
    // could only be a minimum-image artefact, since a real step past L/2 is unresolvable.
    expect(built.max_segment_length).toBeLessThan(5)
    expect(built.max_segment_length).toBeCloseTo(1, 5)
    // The unwrapped path keeps going past the cell rather than folding back
    const last_point = built.point_count - 1
    expect(built.positions[last_point * 3]).toBeCloseTo(14, 4)
  })

  test(`break mode keeps wrapped coordinates and omits only the crossing segments`, () => {
    const built = build_trajectory_lines(wrapping_stream(25), { wrap_mode: `break` })
    // 24 steps, two of which (9->10 and 19->20) wrap
    expect(built.dropped_segments).toBe(2)
    expect(built.segment_count).toBe(22)
    expect(built.max_segment_length).toBeCloseTo(1, 5)
    // Points stay inside the 10 Å cell
    for (let point_idx = 0; point_idx < built.point_count; point_idx++) {
      expect(built.positions[point_idx * 3]).toBeLessThan(10)
    }
  })

  test(`coords_unwrapped input is passed through untouched`, () => {
    // 12 Å of drift per step: re-applying the minimum image to a 10 Å cell would fold this
    // to -8 Å and silently destroy the displacement (LAMMPS xu/yu/zu are already unwrapped)
    const frames = Array.from({ length: 5 }, (_, frame_idx) => [[frame_idx * 12, 0, 0]])
    const stream = make_stream(frames, [`Li`], { coords_unwrapped: true })

    // Identity, not just equality: no copy is allocated for an already-unwrapped stream
    expect(unwrapped_stream_positions(stream)).toBe(stream.positions)

    const built = build_trajectory_lines(stream, { wrap_mode: `unwrap` })
    expect(built.segment_count).toBe(4)
    for (const [[from_x], [to_x]] of segments_of(built)) {
      expect(to_x - from_x).toBeCloseTo(12, 4)
    }
    // Same buffer feeds `break` mode, whose crossing test must not fire on real drift here…
    const broken = build_trajectory_lines(stream, { wrap_mode: `break` })
    expect(broken.dropped_segments).toBe(4)
  })

  test(`an aperiodic stream is used as-is, with no unwrap pass`, () => {
    const frames = Array.from({ length: 4 }, (_, frame_idx) => [[frame_idx, 0, 0]])
    const stream = make_stream(frames, [`C`], { lattice_matrices: null, pbc: null })
    expect(unwrapped_stream_positions(stream)).toBe(stream.positions)
    expect(build_trajectory_lines(stream).max_segment_length).toBeCloseTo(1, 5)
  })

  test(`unwrapping is computed once per stream and reused`, () => {
    const stream = wrapping_stream(15)
    const first = unwrapped_stream_positions(stream)
    expect(unwrapped_stream_positions(stream)).toBe(first)
    // …and it is a distinct buffer from the wrapped source
    expect(first).not.toBe(stream.positions)
  })
})

describe(`element filter`, () => {
  const mixed_stream = () =>
    make_stream(
      Array.from({ length: 6 }, (_, frame_idx) => [
        [frame_idx, 0, 0],
        [0, frame_idx, 0],
        [0, 0, frame_idx],
      ]),
      [`Li`, `O`, `Li`],
    )

  const filter_cases: [string, ElementSymbol[] | null, number, number][] = [
    [`null draws every species`, null, 3, 15],
    [`a single species picks its atoms`, [`Li`], 2, 10],
    [`an unrelated species matches nothing`, [`Fe`], 0, 0],
    [`an empty filter draws nothing`, [], 0, 0],
  ]
  test.each(filter_cases)(`%s`, (_label, elements, expected_atoms, expected_segments) => {
    const built = build_trajectory_lines(mixed_stream(), { elements })
    expect(built.atom_count).toBe(expected_atoms)
    expect(built.segment_count).toBe(expected_segments)
  })

  test(`selects the vertices of the filtered atoms, not the first N`, () => {
    // Li sits at atom indices 0 and 2; O (atom 1) moves along y and must not appear
    const built = build_trajectory_lines(mixed_stream(), { elements: [`Li`] })
    const drawn = segments_of(built)
    expect(drawn).toHaveLength(10)
    // Atom 0 walks along x, atom 2 along z; neither ever leaves y = 0
    expect(drawn.every(([from, to]) => from[1] === 0 && to[1] === 0)).toBe(true)
    expect(drawn.filter(([, to]) => to[0] > 0)).toHaveLength(5)
    expect(drawn.filter(([, to]) => to[2] > 0)).toHaveLength(5)
  })
})

describe(`coloring`, () => {
  test(`element mode paints each atom's whole path in one color`, () => {
    const stream = make_stream(
      Array.from({ length: 4 }, (_, frame_idx) => [
        [frame_idx, 0, 0],
        [0, frame_idx, 0],
      ]),
      [`Li`, `O`],
    )
    const { colors } = build_trajectory_lines(stream, {
      color_mode: `element`,
      element_colors: { Li: `#ff0000`, O: `#0000ff` },
    })
    // Atom-major layout: points 0-3 are Li, points 4-7 are O
    const rgb_at = (point_idx: number) => colors.slice(point_idx * 3, point_idx * 3 + 3)
    for (let point_idx = 1; point_idx < 4; point_idx++) {
      expect(rgb_at(point_idx)).toEqual(rgb_at(0))
    }
    // Pure red vs pure blue in linear space: red channel high for Li, blue high for O
    expect(rgb_at(0)[0]).toBeGreaterThan(0.9)
    expect(rgb_at(0)[2]).toBe(0)
    expect(rgb_at(4)[2]).toBeGreaterThan(0.9)
    expect(rgb_at(4)[0]).toBe(0)
  })

  test(`time mode ramps along the window and repeats the ramp per atom`, () => {
    const stream = make_stream(
      Array.from({ length: 5 }, (_, frame_idx) => [
        [frame_idx, 0, 0],
        [0, frame_idx, 0],
      ]),
      [`Li`, `O`],
    )
    const { colors, point_count } = build_trajectory_lines(stream, { color_mode: `time` })
    expect(point_count).toBe(10)
    const rgb_at = (point_idx: number) => colors.slice(point_idx * 3, point_idx * 3 + 3)
    // Both atoms share one ramp, so their nth points match
    for (let sample_idx = 0; sample_idx < 5; sample_idx++) {
      expect(rgb_at(sample_idx)).toEqual(rgb_at(5 + sample_idx))
    }
    // …and the ramp actually varies along the path
    expect(rgb_at(0)).not.toEqual(rgb_at(4))
  })
})

describe(`realistic scale`, () => {
  // 500 atoms x 5000 frames is the scale the layer is designed for. Assert the geometry
  // is one draw call's worth of buffers with the exact vertex count, not a per-atom pile.
  test(`500 atoms x 5000 frames yields one buffer set of the expected size`, () => {
    const [n_atoms, n_frames] = [500, 5000]
    const positions = new Float64Array(n_frames * n_atoms * 3)
    // Cheap deterministic drift; magnitudes stay well inside the 10 Å cell per step
    for (let frame_idx = 0; frame_idx < n_frames; frame_idx++) {
      for (let atom_idx = 0; atom_idx < n_atoms; atom_idx++) {
        const offset = (frame_idx * n_atoms + atom_idx) * 3
        positions[offset] = (atom_idx * 0.02 + frame_idx * 0.01) % 10
        positions[offset + 1] = (atom_idx * 0.03) % 10
        positions[offset + 2] = (frame_idx * 0.005) % 10
      }
    }
    const stream: TrajectoryPositionStream = {
      positions,
      n_frames,
      n_atoms,
      elements: Array.from({ length: n_atoms }, () => `Li`),
      lattice_matrices: Array.from({ length: n_frames }, () => CUBIC_10),
      pbc: [true, true, true],
      coords_unwrapped: false,
      frame_stride: 1,
      steps: Array.from({ length: n_frames }, (_, idx) => idx),
    }

    const built = build_trajectory_lines(stream)
    expect(built.point_count).toBe(n_atoms * n_frames)
    expect(built.segment_count).toBe(n_atoms * (n_frames - 1))
    expect(built.positions).toHaveLength(n_atoms * n_frames * 3)
    expect(built.indices).toHaveLength(n_atoms * (n_frames - 1) * 2)

    // Frame stride is the escape hatch for runs this long: 10x fewer vertices
    const strided = build_trajectory_lines(stream, { frame_stride: 10 })
    expect(strided.frame_idxs).toHaveLength(n_frames / 10 + 1)
    expect(strided.point_count).toBeLessThan(built.point_count / 9)
  })
})
