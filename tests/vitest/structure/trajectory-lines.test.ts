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
const wrapping_stream = (n_frames = 15) =>
  make_position_stream(
    Array.from({ length: n_frames }, (_, frame_idx) => [[frame_idx % 10, 0, 0]]),
    [`Li`],
  )

const two_atom_stream = (n_frames = 3) =>
  make_position_stream(
    Array.from({ length: n_frames }, (_, frame_idx) => [
      [frame_idx, 0, 0],
      [0, frame_idx, 0],
    ]),
    [`Li`, `O`],
  )

type LineOptions = NonNullable<ConstructorParameters<typeof TrajectoryTrail>[1]> &
  NonNullable<Parameters<TrajectoryTrail[`update`]>[0]> & {
    color_mode?: TrajectoryLineColorMode
    element_colors?: Partial<Record<ElementSymbol, string>>
  }

// One drawn segment: which atom and frames it joins, its endpoints and endpoint colors
type Vertex = { frame_idx: number; xyz: number[]; rgb: number[] }
const segment_of = (atom_idx: number, from: Vertex, to: Vertex) => ({
  atom_idx,
  frames: [from.frame_idx, to.frame_idx],
  from: from.xyz,
  to: to.xyz,
  from_rgb: from.rgb,
  to_rgb: to.rgb,
})
type DrawnSegment = ReturnType<typeof segment_of>

// What the GPU draws for one window, resolved exactly as TrajectoryLines' shader does from
// `buffers` (the trail's arrays, or a mirror holding only what was uploaded): vertex v is
// atom slot v % atom_count in vertex row floor(v / atom_count); its position is the stored
// f32 point plus the slot's f32 offset (one f32 add), its color the slot's texel or, in time
// mode, texel floor((frame - start) * 256 / (end - start)) in integers.
function drawn_segments(
  trail: TrajectoryTrail,
  frame: TrajectoryTrailFrame,
  color_texels: Float32Array,
  color_mode: TrajectoryLineColorMode,
  buffers: Pick<TrajectoryTrail, `positions` | `offsets` | `indices`> = trail,
): DrawnSegment[] {
  const { atom_idxs, n_grid, frame_stride } = trail
  const { positions, offsets, indices } = buffers
  const { start_frame, end_frame } = frame
  const vertex = (vertex_idx: number) => {
    const slot = vertex_idx % atom_idxs.length
    const row = Math.floor(vertex_idx / atom_idxs.length)
    const frame_idx =
      row < n_grid ? row * frame_stride : row === n_grid ? start_frame : end_frame
    const ramp_step = Math.floor(
      ((frame_idx - start_frame) * TIME_RAMP_SIZE) / (end_frame - start_frame),
    )
    const texel = color_mode === `time` ? ramp_step : slot
    const xyz = [0, 1, 2].map((axis) =>
      Math.fround(positions[vertex_idx * 3 + axis] + offsets[slot * 4 + axis]),
    )
    const rgb = Array.from(color_texels.subarray(texel * 4, texel * 4 + 3))
    return { atom_idx: atom_idxs[slot], frame_idx, xyz, rgb }
  }
  const segments: DrawnSegment[] = []
  for (const [range_start, count] of [
    [frame.grid_start, frame.grid_count],
    [trail.ends_start, frame.ends_count],
  ]) {
    for (let idx = range_start; idx < range_start + count; idx += 2) {
      const [from, to] = [vertex(indices[idx]), vertex(indices[idx + 1])]
      expect(to.atom_idx).toBe(from.atom_idx)
      segments.push(segment_of(from.atom_idx, from, to))
    }
  }
  return segments.toSorted(
    (left, right) => left.atom_idx - right.atom_idx || left.frames[0] - right.frames[0],
  )
}

// Build a trail and draw one window of it, as the component does on mount
function draw(stream: TrajectoryPositionStream, options: LineOptions = {}) {
  const { frame_stride, elements, wrap_mode, color_mode = `element`, element_colors } = options
  const trail = new TrajectoryTrail(stream, { frame_stride, elements, wrap_mode })
  const frame = trail.update(options)
  const color_texels = trail_color_texels(trail, color_mode, element_colors)
  return { ...frame.stats, segments: drawn_segments(trail, frame, color_texels, color_mode) }
}

// What a window must draw, straight from the definitions (the from-scratch builder this
// module replaced): both window ends plus the stride grid strictly between them, each atom
// joining consecutive samples unless `break` mode sees a wrap jump, lengths from float64
// coordinates, points moved by f32(anchor - head) in one f32 add as the shader does
function reference_draw(
  stream: TrajectoryPositionStream,
  options: LineOptions,
): { stats: TrajectoryLinesStats; segments: DrawnSegment[] } {
  const { n_frames, n_atoms, elements: atom_elements, pbc } = stream
  const { trail_frames = null, frame_stride = 1, elements = null, wrap_mode } = options
  const { color_mode = `element`, anchor_positions } = options
  const end_frame = options.end_frame ?? n_frames - 1
  const start_frame = trail_frames === null ? 0 : Math.max(0, end_frame - trail_frames + 1)
  const atom_idxs = [...atom_elements.keys()].filter(
    (idx) => !elements || elements.includes(atom_elements[idx]),
  )
  const frame_idxs: number[] = []
  if (atom_idxs.length && end_frame > start_frame) {
    frame_idxs.push(start_frame)
    const first_grid = (Math.floor(start_frame / frame_stride) + 1) * frame_stride
    for (let frame = first_grid; frame < end_frame; frame += frame_stride)
      frame_idxs.push(frame)
    frame_idxs.push(end_frame)
  }
  const coords =
    wrap_mode === `break` ? stream.positions : unwrapped_positions_of(stream).coords
  const at = (atom_idx: number, frame_idx: number): Vec3 => {
    const base = (frame_idx * n_atoms + atom_idx) * 3
    return [coords[base], coords[base + 1], coords[base + 2]]
  }
  const interpolate = get_d3_interpolator(`interpolateViridis`)
  const rgb_of = (atom_idx: number, frame_idx: number) =>
    Array.from(
      color_mode === `time`
        ? parse_linear_rgb(interpolate((frame_idx - start_frame) / (end_frame - start_frame)))
        : css_to_linear_rgb(default_element_colors[atom_elements[atom_idx]]),
      Math.fround,
    )
  const segments: DrawnSegment[] = []
  let [n_joins, max_sq] = [0, 0]
  for (const atom_idx of atom_idxs) {
    const offset = at(atom_idx, end_frame).map((head, axis) =>
      Math.fround((anchor_positions?.[atom_idx * 3 + axis] ?? head) - head),
    )
    const vertex = (frame_idx: number) => ({
      frame_idx,
      xyz: at(atom_idx, frame_idx).map((coord, axis) =>
        Math.fround(Math.fround(coord) + offset[axis]),
      ),
      rgb: rgb_of(atom_idx, frame_idx),
    })
    for (let idx = 1; idx < frame_idxs.length; idx++) {
      const [from_frame, to_frame] = [frame_idxs[idx - 1], frame_idxs[idx]]
      const from = at(atom_idx, from_frame)
      const step = at(atom_idx, to_frame).map((coord, axis) => coord - from[axis]) as Vec3
      const lattice = stream.lattice_matrices?.[to_frame]
      const frac = lattice ? create_cart_to_frac(lattice)(step) : [0, 0, 0]
      n_joins++
      const periodic = pbc ?? [true, true, true]
      const jump = frac.some((value, axis) => periodic[axis] && Math.abs(value) > 0.5)
      if (wrap_mode === `break` && jump) continue
      max_sq = Math.max(max_sq, step[0] * step[0] + step[1] * step[1] + step[2] * step[2])
      segments.push(segment_of(atom_idx, vertex(from_frame), vertex(to_frame)))
    }
  }
  const stats = {
    point_count: atom_idxs.length * frame_idxs.length,
    segment_count: segments.length,
    atom_count: frame_idxs.length ? atom_idxs.length : 0,
    frame_idxs,
    dropped_segments: n_joins - segments.length,
    max_segment_length: Math.sqrt(max_sq),
  }
  return { stats, segments }
}

describe(`TrajectoryTrail sampling`, () => {
  // Three atoms at f32-exact points, distinct per atom and frame
  const stream = make_position_stream(
    Array.from({ length: 40 }, (_, frame_idx) =>
      [0, 1, 2].map((atom_idx) => [frame_idx * 0.25, atom_idx, 0]),
    ),
    [`Li`, `Li`, `Li`],
  )
  // The interior stride grid is anchored at frame 0, so it does not shift as the window
  // slides: end frames 20 and 21 share interior points 12 and 16, only the moving ends differ.
  test.each([
    [9, null, 1, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]],
    [9, 4, 1, [6, 7, 8, 9]],
    // stride 3 over the full 0..9 window: both ends plus the interior grid points 3, 6
    [9, null, 3, [0, 3, 6, 9]],
    // a window shorter than the stride still yields its two end anchors, never a bare point
    [9, 3, 10, [7, 9]],
    [12, 5, 1, [8, 9, 10, 11, 12]],
    [20, 13, 4, [8, 12, 16, 20]],
    [21, 13, 4, [9, 12, 16, 20, 21]],
  ])(
    `end_frame %i trail %s stride %i -> frames %j`,
    (end_frame, trail_frames, frame_stride, expected_frames) => {
      const drawn = draw(stream, { end_frame, trail_frames, frame_stride })
      const n_sampled = expected_frames.length
      expect(drawn).toMatchObject({
        frame_idxs: expected_frames,
        atom_count: 3,
        point_count: 3 * n_sampled,
        segment_count: 3 * (n_sampled - 1),
      })
      // Each atom's segments chain its sampled frames in order between its own points there
      expect(
        drawn.segments.map(({ atom_idx, frames, from, to }) => [atom_idx, frames, from, to]),
      ).toEqual(
        [0, 1, 2].flatMap((atom_idx) =>
          expected_frames.slice(1).map((to_frame, idx) => {
            const frames = [expected_frames[idx], to_frame]
            const [from, to] = frames.map((frame_idx) => [frame_idx * 0.25, atom_idx, 0])
            return [atom_idx, frames, from, to]
          }),
        ),
      )
    },
  )

  test.each([
    [`end_frame out of range`, { end_frame: 99 }, /end_frame must be an integer in \[0, 2\]/],
    [`frame_stride 0`, { frame_stride: 0 }, /frame_stride must be a positive integer/],
    [`frame_stride 1.5`, { frame_stride: 1.5 }, /frame_stride must be a positive integer/],
    [`trail_frames 0`, { trail_frames: 0 }, /trail_frames must be null or a positive/],
    [`short anchors`, { anchor_positions: new Float64Array(3) }, /has 3 entries but 2 atoms/],
    [`too few element labels`, {}, /got 1 element labels for 2 atoms/, [`Li`]],
  ] as [string, LineOptions, RegExp, ElementSymbol[]?][])(
    `throws on %s`,
    (_label, options, message, elements = [`Li`, `O`]) => {
      expect(() => draw({ ...two_atom_stream(), elements }, options)).toThrow(message)
    },
  )
})

describe(`periodic boundary handling`, () => {
  test(`unwraps a PBC-crossing path into a continuous line instead of a box-spanning segment`, () => {
    const stream = wrapping_stream(15)
    const drawn = draw(stream, { wrap_mode: `unwrap` })
    expect(drawn.segment_count).toBe(14)
    // Every step is the true 1 Å drift — no segment anywhere near the 10 Å box
    for (const { from, to } of drawn.segments) expect(to[0] - from[0]).toBeCloseTo(1, 5)
    // A real step past half the shortest cell vector is unresolvable, so a longer segment
    // could only be a minimum-image artefact
    expect(drawn.max_segment_length).toBeCloseTo(1, 5)
    // The unwrapped path keeps going past the cell rather than folding back
    expect(drawn.segments.at(-1)?.to[0]).toBeCloseTo(14, 4)
    // Unwrapping is computed once per stream, into a buffer distinct from the wrapped source
    const { coords } = unwrapped_positions_of(stream)
    expect(unwrapped_positions_of(stream).coords).toBe(coords)
    expect(coords).not.toBe(stream.positions)
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

  // Coordinates never folded into a cell are used as-is (by identity: no copy), since
  // re-applying the minimum image would destroy real drift, e.g. LAMMPS xu/yu/zu moving 12 Å
  // per step in a 10 Å cell. `break` cannot tell that drift from wrapping and drops every
  // step; with no cell at all it never breaks.
  test.each([
    [`coords_unwrapped`, 12, { coords_unwrapped: true }, 4],
    [`aperiodic`, 1, { lattice_matrices: null, pbc: null }, 0],
  ])(`a %s stream is used as-is`, (_label, step, overrides, break_drops) => {
    const frames = Array.from({ length: 5 }, (_, frame_idx) => [[frame_idx * step, 0, 0]])
    const stream = make_position_stream(frames, [`Li`], overrides)
    expect(unwrapped_positions_of(stream).coords).toBe(stream.positions)
    const drawn = draw(stream)
    expect(drawn.segment_count).toBe(4)
    for (const { from, to } of drawn.segments) expect(to[0] - from[0]).toBeCloseTo(step, 4)
    expect(drawn.max_segment_length).toBeCloseTo(step, 5)
    expect(draw(stream, { wrap_mode: `break` }).dropped_segments).toBe(break_drops)
  })
})

describe(`element filter`, () => {
  // Li atoms 0 and 2 walk along x and z, O (atom 1) along y
  const mixed_stream = make_position_stream(
    Array.from({ length: 6 }, (_, frame_idx) => [
      [frame_idx, 0, 0],
      [0, frame_idx, 0],
      [0, 0, frame_idx],
    ]),
    [`Li`, `O`, `Li`],
  )

  test.each([
    [`null draws every species`, null, [0, 1, 2]],
    [`a single species picks its atoms, not the first N`, [`Li`], [0, 2]],
    [`an unrelated species matches nothing`, [`Fe`], []],
    [`an empty filter draws nothing`, [], []],
  ] as [string, ElementSymbol[] | null, number[]][])(
    `%s`,
    (_label, elements, expected_atoms) => {
      const drawn = draw(mixed_stream, { elements })
      expect(drawn.atom_count).toBe(expected_atoms.length)
      expect(drawn.segment_count).toBe(5 * expected_atoms.length)
      expect(drawn.segments.map(({ atom_idx }) => atom_idx)).toEqual(
        expected_atoms.flatMap((atom_idx) => Array(5).fill(atom_idx)),
      )
      // Every drawn point is its own atom's position, not another slot's
      for (const { atom_idx, frames, to } of drawn.segments) {
        expect(to).toEqual([0, 1, 2].map((axis) => (axis === atom_idx ? frames[1] : 0)))
      }
      // Each window gets fresh stats, so mutating one result cannot leak into the next
      drawn.frame_idxs.push(99)
      expect(draw(mixed_stream, { elements }).frame_idxs).not.toContain(99)
    },
  )
})

test(`element mode paints each atom's whole path in its palette color`, () => {
  const element_colors = { Li: `#ff0000`, O: `#0000ff` }
  const { segments } = draw(two_atom_stream(4), { element_colors })
  // Pure red Li and pure blue O in linear rgb, at both ends of each atom's three segments
  const path_of = (rgb: number[]) => Array.from({ length: 3 }, () => [rgb, rgb])
  expect(segments.map(({ from_rgb, to_rgb }) => [from_rgb, to_rgb])).toEqual([
    ...path_of([1, 0, 0]),
    ...path_of([0, 0, 1]),
  ])
})

describe(`anchoring trails to the displayed atoms`, () => {
  test(`puts each head on its own anchor without changing the path shape`, () => {
    const plain = draw(two_atom_stream())
    const anchored = draw(two_atom_stream(), {
      anchor_positions: new Float64Array([100, 0, 0, 0, 200, 0]),
    })
    // Each whole polyline moves rigidly by its own anchor - head, so the heads at frame 2
    // ([2, 0, 0] and [0, 2, 0]) land exactly on their anchors
    const shifts = [
      [98, 0, 0],
      [0, 198, 0],
    ]
    const shifted = plain.segments.map(({ atom_idx, from, to }) =>
      [from, to].map((xyz) => xyz.map((coord, axis) => coord + shifts[atom_idx][axis])),
    )
    expect(anchored.segments.map(({ from, to }) => [from, to])).toEqual(shifted)
    expect(anchored.max_segment_length).toBe(plain.max_segment_length)
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
})

describe(`sliding the window of one trail`, () => {
  // Seeded random walk of 7 mixed-species atoms folded into a sheared cell, so unwrapping and
  // `break` mode see real crossings through both periodic faces and the aperiodic b face
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
    const lattice_matrices = Array.from({ length: n_frames }, () => lattice)
    return make_position_stream(frames, elements, {
      lattice_matrices,
      pbc: [true, false, true],
    })
  }
  const stream = walk_stream(40)
  // Forward playback, a backward stretch, then scrub jumps (including the first/last frame)
  const end_frames = [
    ...Array.from({ length: 40 }, (_, idx) => idx),
    ...Array.from({ length: 12 }, (_, idx) => 30 - idx),
  ].concat(5, 37, 0, 39, 22, 22, 13, 1)
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
    `stride $frame_stride, $wrap_mode, elements $elements: every window draws its definition`,
    (trail_case) => {
      // One trail for every window, as the component keeps it across playback and slider
      // moves, drawn from a GPU mirror that receives only what each frame flags for upload
      const trail = new TrajectoryTrail(stream, trail_case)
      const { positions, offsets, indices, ends_start } = trail
      const gpu = structuredClone({ positions, offsets, indices })
      const rows_start = trail.n_grid * trail.atom_idxs.length * 3
      let n_compared = 0
      for (const { anchored, ...window_case } of window_cases) {
        const color_texels = trail_color_texels(trail, window_case.color_mode)
        for (const end_frame of end_frames) {
          const anchor_positions = anchored ? anchors_at(end_frame) : null
          const options = { ...trail_case, ...window_case, end_frame, anchor_positions }
          const frame = trail.update(options)
          if (frame.ends_changed) {
            gpu.positions.set(positions.subarray(rows_start), rows_start)
            gpu.indices.set(
              indices.subarray(ends_start, ends_start + frame.ends_count),
              ends_start,
            )
          }
          if (frame.offsets_changed) gpu.offsets.set(offsets)
          const expected = reference_draw(stream, options)
          expect(frame.stats).toEqual(expected.stats)
          const drawn = drawn_segments(trail, frame, color_texels, window_case.color_mode, gpu)
          expect(drawn).toEqual(expected.segments)
          n_compared += drawn.length
        }
      }
      expect(n_compared).toBeGreaterThan(1000)
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
      ends_count: 2 * 2 * 7,
      ends_changed: true,
      offsets_changed: true,
    })
    // The heads sit on their anchors, so the depth-sort box spans the anchors
    expect(trail.head_box).toEqual(box_of(anchors))
    // New anchors for the same window (a source frame between collected ones): offsets only
    frame = trail.update({ end_frame: 21, trail_frames: 4, anchor_positions: anchors_at(22) })
    expect(frame).toMatchObject({ ends_changed: false, offsets_changed: true })
    // Both ends on the grid (16..20 at stride 4): only the contiguous grid range is drawn
    frame = trail.update({ end_frame: 20, trail_frames: 5, anchor_positions: anchors })
    expect(frame).toMatchObject({ grid_count: 2 * 7, ends_count: 0, ends_changed: false })
    // Dropping the anchors zeroes the offsets once, then leaves them alone
    expect(trail.update({ end_frame: 20, trail_frames: 5 }).offsets_changed).toBe(true)
    expect(trail.offsets.every((value) => value === 0)).toBe(true)
    expect(trail.update({ end_frame: 24, trail_frames: 9 }).offsets_changed).toBe(false)
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
