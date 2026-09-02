import { get_d3_interpolator } from '$lib/colors'
import type { ElementSymbol } from '$lib/element'
import { parse_linear_rgb } from '$lib/scene/colors'
import { get_pbc_image_sites } from '$lib/structure/pbc'
import { make_supercell } from '$lib/structure/supercell'
import {
  build_trajectory_lines,
  collected_frame_idx,
  trajectory_trail_anchors,
} from '$lib/structure/trajectory-lines'
import { unwrapped_positions_of } from '$lib/trajectory/positions'
import { describe, expect, test } from 'vitest'
import { make_crystal, make_position_stream } from '../setup'

// One atom drifting +1 Å along x per frame, wrapped into a 10 Å cell: 0,1,…,9,0,1,…
// The wrap between frames 9 and 10 is the artefact unwrapping must remove.
const wrapping_stream = (n_frames = 15, element: ElementSymbol = `Li`) =>
  make_position_stream(
    Array.from({ length: n_frames }, (_, frame_idx) => [[frame_idx % 10, 0, 0]]),
    [element],
  )

const two_atom_stream = (n_frames = 3) =>
  make_position_stream(
    Array.from({ length: n_frames }, (_, frame_idx) => [
      [frame_idx, 0, 0],
      [0, frame_idx, 0],
    ]),
    [`Li`, `O`],
  )

const point_at = (positions: Float32Array, point_idx: number): number[] =>
  Array.from(positions.subarray(point_idx * 3, point_idx * 3 + 3))

// Every drawn segment, as [from_xyz, to_xyz] pairs read back through the index buffer
function segments_of(
  built: ReturnType<typeof build_trajectory_lines>,
): [number[], number[]][] {
  const { positions, indices } = built
  return Array.from({ length: indices.length / 2 }, (_, seg_idx) => [
    point_at(positions, indices[seg_idx * 2]),
    point_at(positions, indices[seg_idx * 2 + 1]),
  ])
}

const rgb_at = (colors: Float32Array, point_idx: number) =>
  colors.slice(point_idx * 3, point_idx * 3 + 3)

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
      const stream = make_position_stream(
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

  // Interior stride grid is anchored at frame 0, so it does not shift as the window slides:
  // cases end_frame 20 and 21 share interior points 12 and 16; only the moving ends differ.
  test.each([
    [12, 5, 1, [8, 9, 10, 11, 12]],
    [20, 13, 4, [8, 12, 16, 20]],
    [21, 13, 4, [9, 12, 16, 20, 21]],
  ])(
    `end_frame %i trail %i stride %i -> frames %j`,
    (end_frame, trail_frames, frame_stride, expected_frames) => {
      const built = build_trajectory_lines(wrapping_stream(40), {
        end_frame,
        trail_frames,
        frame_stride,
      })
      expect(built.frame_idxs).toEqual(expected_frames)
    },
  )

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

  test.each([
    [
      `too few element labels`,
      { ...two_atom_stream(), elements: [`Li`] as ElementSymbol[] },
      {},
      /got 1 element labels for 2 atoms/,
    ],
    [
      `mismatched anchor_positions`,
      two_atom_stream(),
      { anchor_positions: new Float64Array(3) },
      /anchor_positions has 3 entries but 2 atoms x 3 requires 6/,
    ],
  ])(`throws on %s`, (_label, stream, options, message) => {
    expect(() => build_trajectory_lines(stream, options)).toThrow(message)
  })
})

describe(`periodic boundary handling`, () => {
  test(`unwraps a PBC-crossing path into a continuous line instead of a box-spanning segment`, () => {
    const stream = wrapping_stream(15)
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
    const stream = make_position_stream(frames, [`Li`], { coords_unwrapped: true })

    // Identity, not just equality: no copy is allocated for an already-unwrapped stream
    expect(unwrapped_positions_of(stream).coords).toBe(stream.positions)

    const built = build_trajectory_lines(stream, { wrap_mode: `unwrap` })
    expect(built.segment_count).toBe(4)
    for (const [[from_x], [to_x]] of segments_of(built)) {
      expect(to_x - from_x).toBeCloseTo(12, 4)
    }
    // `break` cannot distinguish real >L/2 drift from wrapping, so it drops every step here
    const broken = build_trajectory_lines(stream, { wrap_mode: `break` })
    expect(broken.dropped_segments).toBe(4)
  })

  test(`an aperiodic stream is used as-is, with no unwrap pass`, () => {
    const frames = Array.from({ length: 4 }, (_, frame_idx) => [[frame_idx, 0, 0]])
    const stream = make_position_stream(frames, [`C`], { lattice_matrices: null, pbc: null })
    expect(unwrapped_positions_of(stream).coords).toBe(stream.positions)
    expect(build_trajectory_lines(stream).max_segment_length).toBeCloseTo(1, 5)
  })

  test(`unwrapping is computed once per stream and reused`, () => {
    const stream = wrapping_stream(15)
    const first = unwrapped_positions_of(stream).coords
    expect(unwrapped_positions_of(stream).coords).toBe(first)
    // …and it is a distinct buffer from the wrapped source
    expect(first).not.toBe(stream.positions)
  })
})

describe(`element filter`, () => {
  const mixed_stream = () =>
    make_position_stream(
      Array.from({ length: 6 }, (_, frame_idx) => [
        [frame_idx, 0, 0],
        [0, frame_idx, 0],
        [0, 0, frame_idx],
      ]),
      [`Li`, `O`, `Li`],
    )

  test.each([
    [`null draws every species`, null, 3, 15],
    [`a single species picks its atoms`, [`Li`] as ElementSymbol[], 2, 10],
    [`an unrelated species matches nothing`, [`Fe`] as ElementSymbol[], 0, 0],
    [`an empty filter draws nothing`, [] as ElementSymbol[], 0, 0],
  ])(`%s`, (_label, elements, expected_atoms, expected_segments) => {
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

  test(`empty results do not share mutable state`, () => {
    const first = build_trajectory_lines(mixed_stream(), { elements: [] })
    const second = build_trajectory_lines(mixed_stream(), { elements: [`Fe`] })

    expect(first).not.toBe(second)
    expect(first.positions).not.toBe(second.positions)
    first.frame_idxs.push(99)
    expect(second.frame_idxs).toEqual([])
  })
})

describe(`coloring`, () => {
  test(`element mode paints each atom's whole path in one color`, () => {
    const { colors } = build_trajectory_lines(two_atom_stream(4), {
      color_mode: `element`,
      element_colors: { Li: `#ff0000`, O: `#0000ff` },
    })
    // Atom-major layout: points 0-3 are Li, points 4-7 are O
    for (let point_idx = 1; point_idx < 4; point_idx++) {
      expect(rgb_at(colors, point_idx)).toEqual(rgb_at(colors, 0))
    }
    // Pure red vs pure blue in linear space: red channel high for Li, blue high for O
    expect(rgb_at(colors, 0)[0]).toBeGreaterThan(0.9)
    expect(rgb_at(colors, 0)[2]).toBe(0)
    expect(rgb_at(colors, 4)[2]).toBeGreaterThan(0.9)
    expect(rgb_at(colors, 4)[0]).toBe(0)
  })

  // Covers both "same ramp per atom" and "color by elapsed frames, not sample ordinal"
  test(`time mode ramps on elapsed frames and repeats the ramp per atom`, () => {
    const stream = two_atom_stream(22)
    const built = build_trajectory_lines(stream, {
      color_mode: `time`,
      end_frame: 21,
      trail_frames: 13,
      frame_stride: 4,
    })
    expect(built.frame_idxs).toEqual([9, 12, 16, 20, 21])
    expect(built.point_count).toBe(10)
    const interpolate = get_d3_interpolator(`interpolateViridis`)
    const expected = built.frame_idxs.flatMap((frame_idx) =>
      parse_linear_rgb(interpolate((frame_idx - 9) / 12)).map(Math.fround),
    )
    // Atom-major layout: both atoms get the same elapsed-frame ramp
    expect([...built.colors]).toEqual([...expected, ...expected])
  })
})

describe(`anchoring trails to the displayed atoms`, () => {
  test(`puts each head on its anchor without changing the path shape`, () => {
    const stream = wrapping_stream(15)
    const plain = build_trajectory_lines(stream)
    const anchor = new Float64Array([4, -2, 7])
    const anchored = build_trajectory_lines(stream, { anchor_positions: anchor })

    const plain_head = point_at(plain.positions, plain.point_count - 1)
    const anchored_head = point_at(anchored.positions, anchored.point_count - 1)
    expect(anchored_head).toEqual(Array.from(anchor, Math.fround))
    // f32 positions can shift lengths by ~1 ULP (~1e-7); five digits is measured headroom.
    expect(anchored.max_segment_length).toBeCloseTo(plain.max_segment_length, 5)
    const shift = anchored_head.map((coord, axis) => coord - plain_head[axis])
    for (let point_idx = 0; point_idx < plain.point_count; point_idx++) {
      for (const axis of [0, 1, 2]) {
        const offset = point_idx * 3 + axis
        expect(anchored.positions[offset] - plain.positions[offset]).toBeCloseTo(
          shift[axis],
          5,
        )
      }
    }
  })

  // What StructureScene feeds `anchor_positions`: image atoms are appended after the base
  // sites (show_image_atoms defaults to on), so keying on an exact site count left every
  // periodic structure unanchored and drew each trail a lattice vector off its sphere.
  test(`derives anchors from the base sites of a structure carrying PBC image atoms`, () => {
    const structure = make_crystal(5, [
      [`Na`, [0, 0, 0]],
      [`Cl`, [0.5, 0.5, 0.5]],
    ])
    const imaged = get_pbc_image_sites(structure)
    expect(imaged.sites.length).toBeGreaterThan(structure.sites.length)

    const anchors = trajectory_trail_anchors(imaged.sites, structure.sites.length)
    expect(anchors).toEqual(new Float64Array([0, 0, 0, 2.5, 2.5, 2.5]))
  })

  test.each([
    // [case, sites, n_atoms] -> null: nothing here can be matched to the stream's atom order
    [`fewer displayed sites than stream atoms`, make_crystal(5, [[`Na`, [0, 0, 0]]]).sites, 2],
    [
      `a supercell, which renumbers every atom`,
      make_supercell(
        make_crystal(5, [
          [`Na`, [0, 0, 0]],
          [`Cl`, [0.5, 0.5, 0.5]],
        ]),
        [2, 1, 1],
      ).sites,
      2,
    ],
  ])(`returns null for %s`, (_case, sites, n_atoms) => {
    expect(trajectory_trail_anchors(sites, n_atoms)).toBeNull()
  })

  test(`anchors each atom independently`, () => {
    const built = build_trajectory_lines(two_atom_stream(), {
      anchor_positions: new Float64Array([100, 0, 0, 0, 200, 0]),
    })
    // Atom-major: points 0-2 are Li (head at index 2), points 3-5 are O (head at index 5)
    expect(point_at(built.positions, 2)).toEqual([100, 0, 0])
    expect(point_at(built.positions, 5)).toEqual([0, 200, 0])
  })
})

describe(`collected_frame_idx`, () => {
  // The playhead counts source frames; the layer counts collected ones. A stream that kept
  // every 5th frame turns source frame 37 into collected frame 7, not 37.
  test.each([
    [1, 0, 0],
    [1, 9, 9],
    [5, 37, 7],
    // past the end of a stream that stopped short, and a negative from a clamped playhead
    [5, 999, 9],
    [5, -3, 0],
  ])(`stride %i maps source frame %i to collected %i`, (stride, source, expected) => {
    expect(collected_frame_idx({ n_frames: 10, frame_stride: stride }, source)).toBe(expected)
  })
})
