import { default_element_colors, get_d3_interpolator } from '$lib/colors'
import type { ElementSymbol } from '$lib/element'
import type { Matrix3x3, Vec3 } from '$lib/math'
import { create_cart_to_frac } from '$lib/math'
import { css_to_linear_rgb, parse_linear_rgb } from '$lib/scene/colors'
import { get_pbc_image_sites } from '$lib/structure/pbc'
import { make_supercell } from '$lib/structure/supercell'
import type {
  TrajectoryLineColorMode,
  TrajectoryLinesStats,
  TrajectoryLineWrapMode,
  TrajectoryTrailFrame,
} from '$lib/structure/trajectory-lines'
import {
  TIME_RAMP_SIZE,
  TrajectoryTrail,
  collected_frame_idx,
  trail_color_texels,
  trajectory_trail_anchors,
} from '$lib/structure/trajectory-lines'
import type { TrajectoryPositionStream } from '$lib/trajectory'
import { unwrapped_positions_of } from '$lib/trajectory/positions'
import { describe, expect, test } from 'vitest'
import { make_crystal, make_position_stream } from '../test-fixtures'

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

interface LineOptions {
  end_frame?: number
  trail_frames?: number | null
  frame_stride?: number
  elements?: readonly ElementSymbol[] | null
  color_mode?: TrajectoryLineColorMode
  element_colors?: Partial<Record<ElementSymbol, string>>
  wrap_mode?: TrajectoryLineWrapMode
  anchor_positions?: Float64Array | null
}

// One drawn segment: which atom and frames it joins, its endpoints and endpoint colors
interface DrawnSegment {
  atom_idx: number
  frames: [number, number]
  from: number[]
  to: number[]
  from_rgb: number[]
  to_rgb: number[]
}

const by_atom_then_frame = (left: DrawnSegment, right: DrawnSegment) =>
  left.atom_idx - right.atom_idx || left.frames[0] - right.frames[0]

// What the GPU draws for one window, resolved exactly as TrajectoryLines' shader does:
// vertex v is atom slot v % atom_count in vertex row floor(v / atom_count); its position is
// the stored f32 point plus the slot's f32 offset (one f32 add), its color the slot's texel
// or, in time mode, texel floor((frame - start) * 256 / (end - start)) in integers.
function drawn_segments(
  trail: TrajectoryTrail,
  frame: TrajectoryTrailFrame,
  color_texels: Float32Array,
  color_mode: TrajectoryLineColorMode,
): DrawnSegment[] {
  const { atom_idxs, n_grid, frame_stride, positions, offsets, indices } = trail
  const { start_frame, end_frame } = frame
  const vertex = (vertex_idx: number) => {
    const slot = vertex_idx % atom_idxs.length
    const row = Math.floor(vertex_idx / atom_idxs.length)
    const frame_idx =
      row < n_grid ? row * frame_stride : row === n_grid ? start_frame : end_frame
    const xyz = [0, 1, 2].map((axis) =>
      Math.fround(positions[vertex_idx * 3 + axis] + offsets[slot * 4 + axis]),
    )
    const ramp_step = Math.floor(
      ((frame_idx - start_frame) * TIME_RAMP_SIZE) / (end_frame - start_frame),
    )
    const texel = color_mode === `time` ? ramp_step : slot
    return {
      atom_idx: atom_idxs[slot],
      frame_idx,
      xyz,
      rgb: Array.from(color_texels.subarray(texel * 4, texel * 4 + 3)),
    }
  }
  const segments: DrawnSegment[] = []
  const ranges = [
    [frame.grid_start, frame.grid_count],
    [trail.ends_start, frame.ends_count],
  ]
  for (const [range_start, count] of ranges) {
    for (let idx = range_start; idx < range_start + count; idx += 2) {
      const from = vertex(indices[idx])
      const to = vertex(indices[idx + 1])
      expect(to.atom_idx).toBe(from.atom_idx)
      segments.push({
        atom_idx: from.atom_idx,
        frames: [from.frame_idx, to.frame_idx],
        from: from.xyz,
        to: to.xyz,
        from_rgb: from.rgb,
        to_rgb: to.rgb,
      })
    }
  }
  return segments.toSorted(by_atom_then_frame)
}

// Build a trail and draw one window of it, as the component does on mount
function draw(stream: TrajectoryPositionStream, options: LineOptions = {}) {
  const { frame_stride, elements, wrap_mode, color_mode = `element`, element_colors } = options
  const trail = new TrajectoryTrail(stream, { frame_stride, elements, wrap_mode })
  const frame = trail.update(options)
  const color_texels = trail_color_texels(trail, color_mode, element_colors)
  return { ...frame.stats, segments: drawn_segments(trail, frame, color_texels, color_mode) }
}

// The from-scratch builder this module replaced (rebuild every point of every atom for each
// window, atom-major, in float64 then rounded to f32), kept as the equivalence oracle
function reference_draw(
  stream: TrajectoryPositionStream,
  options: LineOptions,
): { stats: TrajectoryLinesStats; segments: DrawnSegment[] } {
  const { n_frames, n_atoms, elements: atom_elements } = stream
  const {
    trail_frames = null,
    frame_stride = 1,
    elements: element_filter = null,
    color_mode = `element`,
    element_colors = default_element_colors,
    wrap_mode = `unwrap`,
    anchor_positions = null,
  } = options
  const end_frame = options.end_frame ?? n_frames - 1
  const empty = {
    stats: {
      point_count: 0,
      segment_count: 0,
      atom_count: 0,
      frame_idxs: [],
      dropped_segments: 0,
      max_segment_length: 0,
    },
    segments: [],
  }
  const atom_idxs = Array.from({ length: n_atoms }, (_, idx) => idx).filter(
    (idx) => !element_filter || element_filter.includes(atom_elements[idx]),
  )
  const start_frame = trail_frames === null ? 0 : Math.max(0, end_frame - trail_frames + 1)
  if (atom_idxs.length === 0 || end_frame <= start_frame) return empty
  const frame_idxs = [start_frame]
  const first_grid = Math.ceil((start_frame + 1) / frame_stride) * frame_stride
  for (let frame = first_grid; frame < end_frame; frame += frame_stride) frame_idxs.push(frame)
  frame_idxs.push(end_frame)

  const coords =
    wrap_mode === `break` ? stream.positions : unwrapped_positions_of(stream).coords
  const interpolate = get_d3_interpolator(`interpolateViridis`)
  const rgb_of = (atom_idx: number, frame_idx: number) =>
    Array.from(
      color_mode === `time`
        ? parse_linear_rgb(interpolate((frame_idx - start_frame) / (end_frame - start_frame)))
        : css_to_linear_rgb(element_colors[atom_elements[atom_idx]] ?? `#808080`),
      Math.fround,
    )
  const is_wrap_jump = (step: Vec3, frame_idx: number) => {
    const lattice = stream.lattice_matrices?.[frame_idx]
    if (wrap_mode !== `break` || !lattice) return false
    const frac = create_cart_to_frac(lattice)(step)
    const periodic = stream.pbc ?? [true, true, true]
    return [0, 1, 2].some((axis) => periodic[axis] && Math.abs(frac[axis]) > 0.5)
  }
  const segments: DrawnSegment[] = []
  let dropped_segments = 0
  let max_sq = 0
  for (const atom_idx of atom_idxs) {
    const head = (end_frame * n_atoms + atom_idx) * 3
    const shift = [0, 1, 2].map((axis) =>
      anchor_positions ? anchor_positions[atom_idx * 3 + axis] - coords[head + axis] : 0,
    )
    const point_at = (frame_idx: number) =>
      [0, 1, 2].map((axis) =>
        Math.fround(coords[(frame_idx * n_atoms + atom_idx) * 3 + axis] + shift[axis]),
      )
    for (let sample_idx = 1; sample_idx < frame_idxs.length; sample_idx++) {
      const [from_frame, to_frame] = [frame_idxs[sample_idx - 1], frame_idxs[sample_idx]]
      const [from, to] = [point_at(from_frame), point_at(to_frame)]
      const step: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]]
      if (is_wrap_jump(step, to_frame)) {
        dropped_segments++
        continue
      }
      max_sq = Math.max(max_sq, step[0] ** 2 + step[1] ** 2 + step[2] ** 2)
      segments.push({
        atom_idx,
        frames: [from_frame, to_frame],
        from,
        to,
        from_rgb: rgb_of(atom_idx, from_frame),
        to_rgb: rgb_of(atom_idx, to_frame),
      })
    }
  }
  const stats = {
    point_count: atom_idxs.length * frame_idxs.length,
    segment_count: segments.length,
    atom_count: atom_idxs.length,
    frame_idxs,
    dropped_segments,
    max_segment_length: Math.sqrt(max_sq),
  }
  return { stats, segments }
}

describe(`TrajectoryTrail vertex counts`, () => {
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
      const drawn = draw(stream, { trail_frames, frame_stride })

      expect(drawn.frame_idxs).toHaveLength(expected_sampled)
      expect(drawn.atom_count).toBe(n_atoms)
      expect(drawn.point_count).toBe(n_atoms * expected_sampled)
      expect(drawn.segment_count).toBe(n_atoms * (expected_sampled - 1))
      expect(drawn.segments).toHaveLength(drawn.segment_count)
      // Each atom's segments chain its sampled frames in order, with no gap or repeat
      for (let atom_idx = 0; atom_idx < n_atoms; atom_idx++) {
        const chain = drawn.segments.filter((segment) => segment.atom_idx === atom_idx)
        expect(chain.map(({ frames }) => frames[0])).toEqual(drawn.frame_idxs.slice(0, -1))
        expect(chain.map(({ frames }) => frames[1])).toEqual(drawn.frame_idxs.slice(1))
      }
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
      const drawn = draw(wrapping_stream(40), { end_frame, trail_frames, frame_stride })
      expect(drawn.frame_idxs).toEqual(expected_frames)
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
    expect(() => draw(wrapping_stream(), options)).toThrow(message)
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
    expect(() => draw(stream, options)).toThrow(message)
  })
})

describe(`periodic boundary handling`, () => {
  test(`unwraps a PBC-crossing path into a continuous line instead of a box-spanning segment`, () => {
    const drawn = draw(wrapping_stream(15), { wrap_mode: `unwrap` })
    expect(drawn.segment_count).toBe(14)
    // Every step is the true 1 Å drift — no segment anywhere near the 10 Å box
    for (const { from, to } of drawn.segments) expect(to[0] - from[0]).toBeCloseTo(1, 5)
    // Documented continuity threshold: half the shortest cell vector. Anything longer
    // could only be a minimum-image artefact, since a real step past L/2 is unresolvable.
    expect(drawn.max_segment_length).toBeLessThan(5)
    expect(drawn.max_segment_length).toBeCloseTo(1, 5)
    // The unwrapped path keeps going past the cell rather than folding back
    expect(drawn.segments.at(-1)?.to[0]).toBeCloseTo(14, 4)
  })

  test(`break mode keeps wrapped coordinates and omits only the crossing segments`, () => {
    const drawn = draw(wrapping_stream(25), { wrap_mode: `break` })
    // 24 steps, two of which (9->10 and 19->20) wrap
    expect(drawn.dropped_segments).toBe(2)
    expect(drawn.segment_count).toBe(22)
    expect(drawn.max_segment_length).toBeCloseTo(1, 5)
    // Points stay inside the 10 Å cell
    for (const { from, to } of drawn.segments) {
      expect(from[0]).toBeLessThan(10)
      expect(to[0]).toBeLessThan(10)
    }
  })

  test(`coords_unwrapped input is passed through untouched`, () => {
    // 12 Å of drift per step: re-applying the minimum image to a 10 Å cell would fold this
    // to -8 Å and silently destroy the displacement (LAMMPS xu/yu/zu are already unwrapped)
    const frames = Array.from({ length: 5 }, (_, frame_idx) => [[frame_idx * 12, 0, 0]])
    const stream = make_position_stream(frames, [`Li`], { coords_unwrapped: true })

    // Identity, not just equality: no copy is allocated for an already-unwrapped stream
    expect(unwrapped_positions_of(stream).coords).toBe(stream.positions)

    const drawn = draw(stream, { wrap_mode: `unwrap` })
    expect(drawn.segment_count).toBe(4)
    for (const { from, to } of drawn.segments) expect(to[0] - from[0]).toBeCloseTo(12, 4)
    // `break` cannot distinguish real >L/2 drift from wrapping, so it drops every step here
    expect(draw(stream, { wrap_mode: `break` }).dropped_segments).toBe(4)
  })

  test(`an aperiodic stream is used as-is, with no unwrap pass`, () => {
    const frames = Array.from({ length: 4 }, (_, frame_idx) => [[frame_idx, 0, 0]])
    const stream = make_position_stream(frames, [`C`], { lattice_matrices: null, pbc: null })
    expect(unwrapped_positions_of(stream).coords).toBe(stream.positions)
    expect(draw(stream).max_segment_length).toBeCloseTo(1, 5)
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
    const drawn = draw(mixed_stream(), { elements })
    expect(drawn.atom_count).toBe(expected_atoms)
    expect(drawn.segment_count).toBe(expected_segments)
    expect(drawn.segments).toHaveLength(expected_segments)
  })

  test(`selects the vertices of the filtered atoms, not the first N`, () => {
    // Li sits at atom indices 0 and 2; O (atom 1) moves along y and must not appear
    const drawn = draw(mixed_stream(), { elements: [`Li`] }).segments
    expect(drawn).toHaveLength(10)
    expect(new Set(drawn.map(({ atom_idx }) => atom_idx))).toEqual(new Set([0, 2]))
    // Atom 0 walks along x, atom 2 along z; neither ever leaves y = 0
    expect(drawn.every(({ from, to }) => from[1] === 0 && to[1] === 0)).toBe(true)
    expect(drawn.filter(({ to }) => to[0] > 0)).toHaveLength(5)
    expect(drawn.filter(({ to }) => to[2] > 0)).toHaveLength(5)
  })

  test(`empty results do not share mutable state`, () => {
    const first = draw(mixed_stream(), { elements: [] })
    const second = draw(mixed_stream(), { elements: [`Fe`] })
    first.frame_idxs.push(99)
    expect(second.frame_idxs).toEqual([])
  })
})

describe(`coloring`, () => {
  test(`element mode paints each atom's whole path in one color`, () => {
    const { segments } = draw(two_atom_stream(4), {
      color_mode: `element`,
      element_colors: { Li: `#ff0000`, O: `#0000ff` },
    })
    for (const atom_idx of [0, 1]) {
      const colors = segments
        .filter((segment) => segment.atom_idx === atom_idx)
        .flatMap(({ from_rgb, to_rgb }) => [from_rgb, to_rgb])
      expect(colors).toHaveLength(6)
      for (const rgb of colors) expect(rgb).toEqual(colors[0])
    }
    // Pure red vs pure blue in linear space: red channel high for Li, blue high for O
    const [li_rgb, o_rgb] = [segments[0].from_rgb, segments[3].from_rgb]
    expect(li_rgb[0]).toBeGreaterThan(0.9)
    expect(li_rgb[2]).toBe(0)
    expect(o_rgb[2]).toBeGreaterThan(0.9)
    expect(o_rgb[0]).toBe(0)
  })

  // Covers both "same ramp per atom" and "color by elapsed frames, not sample ordinal"
  test(`time mode ramps on elapsed frames and repeats the ramp per atom`, () => {
    const drawn = draw(two_atom_stream(22), {
      color_mode: `time`,
      end_frame: 21,
      trail_frames: 13,
      frame_stride: 4,
    })
    expect(drawn.frame_idxs).toEqual([9, 12, 16, 20, 21])
    expect(drawn.point_count).toBe(10)
    const interpolate = get_d3_interpolator(`interpolateViridis`)
    const expected_rgb = (frame_idx: number) =>
      Array.from(parse_linear_rgb(interpolate((frame_idx - 9) / 12)), Math.fround)
    // Both atoms get the same elapsed-frame ramp, bit for bit
    expect(drawn.segments).toHaveLength(8)
    for (const { frames, from_rgb, to_rgb } of drawn.segments) {
      expect(from_rgb).toEqual(expected_rgb(frames[0]))
      expect(to_rgb).toEqual(expected_rgb(frames[1]))
    }
  })
})

describe(`anchoring trails to the displayed atoms`, () => {
  test(`puts each head on its anchor without changing the path shape`, () => {
    const stream = wrapping_stream(15)
    const plain = draw(stream)
    const anchor = new Float64Array([4, -2, 7])
    const anchored = draw(stream, { anchor_positions: anchor })

    const plain_head = plain.segments.at(-1)?.to ?? []
    const anchored_head = anchored.segments.at(-1)?.to ?? []
    expect(anchored_head).toEqual(Array.from(anchor, Math.fround))
    // f32 positions can shift lengths by ~1 ULP (~1e-7); five digits is measured headroom.
    expect(anchored.max_segment_length).toBeCloseTo(plain.max_segment_length, 5)
    const shift = anchored_head.map((coord, axis) => coord - plain_head[axis])
    for (const [seg_idx, { from, to }] of anchored.segments.entries()) {
      const plain_segment = plain.segments[seg_idx]
      for (const axis of [0, 1, 2]) {
        expect(from[axis] - plain_segment.from[axis]).toBeCloseTo(shift[axis], 5)
        expect(to[axis] - plain_segment.to[axis]).toBeCloseTo(shift[axis], 5)
      }
    }
  })

  const nacl = make_crystal(5, [
    [`Na`, [0, 0, 0]],
    [`Cl`, [0.5, 0.5, 0.5]],
  ])

  // What StructureScene feeds `anchor_positions`: image atoms are appended after the base
  // sites (show_image_atoms defaults to on), so keying on an exact site count left every
  // periodic structure unanchored and drew each trail a lattice vector off its sphere.
  test(`derives anchors from the base sites of a structure carrying PBC image atoms`, () => {
    const imaged = get_pbc_image_sites(nacl)
    expect(imaged.sites.length).toBeGreaterThan(nacl.sites.length)

    const anchors = trajectory_trail_anchors(imaged.sites, nacl.sites.length)
    expect(anchors).toEqual(new Float64Array([0, 0, 0, 2.5, 2.5, 2.5]))
    for (const site of imaged.sites)
      site.properties = { orig_site_idx: 0, orig_unit_cell_idx: 0, completion_image: true }
    expect(trajectory_trail_anchors(imaged.sites, nacl.sites.length)).toEqual(anchors)
  })

  test.each([
    // [case, sites, n_atoms] -> null: nothing here can be matched to the stream's atom order
    [`fewer displayed sites than stream atoms`, make_crystal(5, [[`Na`, [0, 0, 0]]]).sites, 2],
    [`a supercell, which renumbers every atom`, make_supercell(nacl, [2, 1, 1]).sites, 2],
  ])(`returns null for %s`, (_case, sites, n_atoms) => {
    expect(trajectory_trail_anchors(sites, n_atoms)).toBeNull()
  })

  test(`anchors each atom independently`, () => {
    const { segments } = draw(two_atom_stream(), {
      anchor_positions: new Float64Array([100, 0, 0, 0, 200, 0]),
    })
    // Sorted by atom then frame: segment 1 ends at Li's head, segment 3 at O's
    expect(segments[1].to).toEqual([100, 0, 0])
    expect(segments[3].to).toEqual([0, 200, 0])
  })
})

describe(`sliding the window of one trail`, () => {
  // Seeded random walk of 7 mixed-species atoms folded into a sheared periodic cell, so both
  // unwrapping and `break` mode see real boundary crossings from every direction
  const lattice: Matrix3x3 = [
    [6, 0, 0],
    [1.5, 5, 0],
    [0.5, -1, 5.5],
  ]
  const walk_stream = (n_frames: number): TrajectoryPositionStream => {
    let seed = 7
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 2 ** 32
    }
    const elements: ElementSymbol[] = [`Li`, `O`, `Fe`, `Li`, `O`, `Li`, `Fe`]
    const frac = elements.map(() => [rand(), rand(), rand()])
    const frames = Array.from({ length: n_frames }, () =>
      frac.map((atom_frac) => {
        for (const axis of [0, 1, 2]) atom_frac[axis] += (rand() - 0.5) * 0.3
        const wrapped = atom_frac.map((value) => value - Math.floor(value))
        return [0, 1, 2].map((axis) =>
          wrapped.reduce((sum, value, row) => sum + value * lattice[row][axis], 0),
        )
      }),
    )
    return make_position_stream(frames, elements, {
      lattice_matrices: Array.from({ length: n_frames }, () => lattice),
    })
  }
  const stream = walk_stream(40)
  // Forward playback, a backward stretch, then scrub jumps (including the first/last frame)
  const end_frames = [
    ...Array.from({ length: 40 }, (_, idx) => idx),
    ...Array.from({ length: 12 }, (_, idx) => 30 - idx),
    5,
    37,
    0,
    39,
    22,
    22,
    13,
    1,
  ]
  // Anchors as StructureScene derives them: the displayed (wrapped) frame, a fresh array
  // each frame, nudged so the translation is not a whole lattice vector
  const anchors_at = (frame_idx: number) =>
    Float64Array.from(
      stream.positions.subarray(frame_idx * 7 * 3, (frame_idx + 1) * 7 * 3),
      (coord, idx) => coord + 0.01 * ((idx % 5) - 2),
    )

  // Every build-time option against every window option, over one long-lived trail each
  const trail_cases = [1, 3, 7].flatMap((frame_stride) =>
    ([`unwrap`, `break`] as const).flatMap((wrap_mode) =>
      [null, [`Li`, `Fe`] as ElementSymbol[]].map((elements) => ({
        frame_stride,
        wrap_mode,
        elements,
      })),
    ),
  )
  const window_cases = ([`element`, `time`] as const).flatMap((color_mode) =>
    [false, true].flatMap((anchored) =>
      [null, 1, 2, 5, 12].map((trail_frames) => ({ color_mode, anchored, trail_frames })),
    ),
  )

  test.each(trail_cases)(
    `stride $frame_stride, $wrap_mode, elements $elements: every window draws what a fresh build does`,
    ({ frame_stride, wrap_mode, elements }) => {
      let max_anchored_error = 0
      let max_length_error = 0
      let n_compared = 0
      // One trail for every window, as the component keeps it across playback and slider moves
      const trail = new TrajectoryTrail(stream, { frame_stride, elements, wrap_mode })
      for (const { color_mode, anchored, trail_frames } of window_cases) {
        const color_texels = trail_color_texels(trail, color_mode)
        for (const end_frame of end_frames) {
          const options: LineOptions = {
            end_frame,
            trail_frames,
            frame_stride,
            elements,
            color_mode,
            wrap_mode,
            anchor_positions: anchored ? anchors_at(end_frame) : null,
          }
          const frame = trail.update(options)
          const drawn = drawn_segments(trail, frame, color_texels, color_mode)
          const expected = reference_draw(stream, options)
          const { max_segment_length, ...counts } = frame.stats
          const { max_segment_length: expected_length, ...expected_counts } = expected.stats
          expect(counts).toEqual(expected_counts)
          max_length_error = Math.max(
            max_length_error,
            Math.abs(max_segment_length - expected_length),
          )
          expect(drawn.map(({ atom_idx, frames }) => [atom_idx, ...frames])).toEqual(
            expected.segments.map(({ atom_idx, frames }) => [atom_idx, ...frames]),
          )
          for (const [seg_idx, segment] of drawn.entries()) {
            const reference = expected.segments[seg_idx]
            // Colors are the same f32 texels either way: bit-identical
            expect([segment.from_rgb, segment.to_rgb]).toEqual([
              reference.from_rgb,
              reference.to_rgb,
            ])
            // Unanchored points are the same f32 roundings of the same float64 coordinates
            if (!anchored)
              expect([segment.from, segment.to]).toEqual([reference.from, reference.to])
            for (const axis of [0, 1, 2]) {
              max_anchored_error = Math.max(
                max_anchored_error,
                Math.abs(segment.from[axis] - reference.from[axis]),
                Math.abs(segment.to[axis] - reference.to[axis]),
              )
            }
          }
          n_compared += drawn.length
        }
      }
      expect(n_compared).toBeGreaterThan(1000)
      // Rounding bounds: every value either side rounds to f32 (unwrapped points, anchors,
      // offsets = anchor - point, and their sums) stays below `magnitude`, so each rounding
      // is off by at most half an f32 spacing there
      const max_abs = (values: Float64Array) =>
        values.reduce((max, value) => Math.max(max, Math.abs(value)), 0)
      const magnitude =
        2 * max_abs(unwrapped_positions_of(stream).coords) + max_abs(stream.positions) + 0.02
      const spacing = 2 ** (Math.ceil(Math.log2(magnitude)) - 24)
      // Anchored points: the shader rounds point and offset to f32 and rounds their sum,
      // the oracle rounds the float64 sum once: four half-spacing roundings at most
      expect(max_anchored_error).toBeLessThanOrEqual(2 * spacing)
      // Lengths: float64 coordinates here vs the oracle's f32 endpoints, each coordinate off
      // by half a spacing, so a step component by one spacing and its length by sqrt(3)
      expect(max_length_error).toBeLessThanOrEqual(Math.sqrt(3) * spacing)
    },
  )

  // Per-axis bounds of a flat xyz array
  const box_of = (xyz: Float64Array) => {
    const axes = [0, 1, 2].map((axis) => xyz.filter((_, idx) => idx % 3 === axis))
    return {
      min: axes.map((vals) => Math.min(...vals)),
      max: axes.map((vals) => Math.max(...vals)),
    }
  }

  test(`rewrites only what a window change touches`, () => {
    const trail = new TrajectoryTrail(stream, { frame_stride: 4 })
    const anchors = anchors_at(21)
    // Off-grid start (18) and end (21): the ends (block and rows) and offsets all written
    let frame = trail.update({ end_frame: 21, trail_frames: 4, anchor_positions: anchors })
    expect(frame).toMatchObject({
      ends_changed: true,
      offsets_changed: true,
      head_box_changed: true,
    })
    expect(frame.ends_count).toBe(2 * 2 * 7)
    // The heads sit on their anchors, so the depth-sort box spans the anchors
    expect(trail.head_box).toEqual(box_of(anchors))
    // The same window and anchors again: nothing to re-upload
    frame = trail.update({ end_frame: 21, trail_frames: 4, anchor_positions: anchors })
    expect(frame).toMatchObject({
      ends_changed: false,
      offsets_changed: false,
      head_box_changed: false,
    })
    // Both ends on the grid (16..20 at stride 4): only the contiguous grid range is drawn
    frame = trail.update({ end_frame: 20, trail_frames: 5, anchor_positions: anchors })
    expect(frame).toMatchObject({ ends_count: 0, offsets_changed: true })
    expect(frame.grid_count).toBe(2 * 7)
    // Dropping the anchors zeroes the offsets once, then leaves them alone
    expect(trail.update({ end_frame: 20, trail_frames: 5 }).offsets_changed).toBe(true)
    expect(trail.offsets.every((value) => value === 0)).toBe(true)
    frame = trail.update({ end_frame: 24, trail_frames: 9 })
    expect(frame).toMatchObject({ offsets_changed: false, head_box_changed: true })
    // Unanchored heads stay at the trail's own frame-24 points
    const unwrapped = unwrapped_positions_of(stream).coords
    expect(trail.head_box).toEqual(box_of(unwrapped.subarray(24 * 7 * 3, 25 * 7 * 3)))
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
