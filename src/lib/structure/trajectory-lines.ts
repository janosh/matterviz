// Per-atom trajectory trails — the path each atom traces over an MD run, the same thing
// OVITO calls "generate trajectory lines".
//
// The trail window moves on every playback frame, so the layout makes moving it cheap.
// TrajectoryTrail samples the WHOLE run once onto the frame_stride grid in FRAME-MAJOR rows
// (vertex row k holds every atom at frame k * frame_stride), which makes the segments of any
// window of grid frames one contiguous index range: sliding the window is a draw-range change.
// Two extra rows hold the window's start and end frames, which usually fall between grid
// frames; their segments live in a small index block rewritten per window, O(atoms). Anchor
// translations and time-mode colors are applied in the shader (TrajectoryLines.svelte) from
// per-atom offsets and the window bounds, so no per-frame work scales with atoms x frames.
//
// Everything is one indexed line-segment buffer for the whole scene: a 500-atom x 5000-frame
// run is one draw call (two while an off-grid window end is drawn), not 500 objects. Indexed
// because each interior point is shared by two segments, so it is stored and shaded once.
// Plain typed arrays only, so this module is unit tested without a WebGPU context.
import { default_element_colors, get_d3_interpolator } from '$lib/colors'
import type { ElementSymbol } from '$lib/element'
import type { Matrix3x3, Vec3 } from '$lib/math'
import { clamp, create_cart_to_frac } from '$lib/math'
import { unwrapped_positions_of } from '$lib/trajectory/positions'
import { css_to_linear_rgb, parse_linear_rgb } from '$lib/scene/colors'
import type { TrajectoryPositionStream } from '$lib/trajectory'
import type { Site } from '$lib/structure'

// `element` paints each trail in its atom's color (matching the spheres in the scene),
// `time` runs a d3 ramp from the oldest sampled frame to the newest so the head of a
// comet tail is visually distinct from its tail.
export type TrajectoryLineColorMode = `element` | `time`

// `unwrap` accumulates minimum-image steps so an atom leaving the cell keeps going in a
// straight line (the default, and the only mode that shows real diffusion paths).
// `break` keeps wrapped coordinates and simply omits the segment where an atom jumped
// across the box, so trails stay inside the cell at the cost of visible gaps.
export type TrajectoryLineWrapMode = `unwrap` | `break`

// What a TrajectoryTrail is built for; changing any of these means a new trail
interface TrajectoryTrailOptions {
  // Keep only every Nth collected frame, on top of the stream's own frame_stride. The grid
  // is anchored at frame 0 so the sampled set does not shift as the window slides; both
  // window ends are always included, so a trail never degenerates and its head stays glued
  // to the atom.
  frame_stride?: number
  // Species to draw trails for. undefined/null means every atom; an EMPTY array means none
  // (so unchecking every box in a UI hides the layer rather than showing everything).
  elements?: readonly ElementSymbol[] | null
  wrap_mode?: TrajectoryLineWrapMode
}

// The part that moves during playback
interface TrajectoryTrailWindow {
  // Newest collected-frame index the trail reaches. Defaults to the last collected frame.
  // This is an index into the STREAM's frames, which are already `stream.frame_stride`
  // apart in the source file.
  end_frame?: number
  // How many collected frames the trail spans back from `end_frame`; null draws the whole run
  trail_frames?: number | null
  // Cartesian trail-head targets in stream atom order. Each whole polyline is translated
  // onto its anchor without changing its shape. Compared by identity: pass a new array for
  // new anchors (as a reactive prop does anyway).
  anchor_positions?: Float64Array | null
}

// What one window draws. TrajectoryLines binds this out for cost readouts.
export interface TrajectoryLinesStats {
  // Sampled points in the window: atom_count x frame_idxs.length
  point_count: number
  segment_count: number
  // Atoms that survived the element filter
  atom_count: number
  // Collected-frame indices sampled into the window, ascending
  frame_idxs: number[]
  // `break` mode only: segments omitted because the atom crossed a cell boundary
  dropped_segments: number
  // Longest drawn segment in Å. A correctly unwrapped path keeps this at the scale of the
  // real per-step displacement; a box-spanning artefact shows up here immediately.
  max_segment_length: number
}

// Where one window sits in a trail's buffers, and which of them the window rewrote
export interface TrajectoryTrailFrame {
  stats: TrajectoryLinesStats
  // Window bounds in collected frames; the shader's time ramp spans them
  start_frame: number
  end_frame: number
  // Index range of the window's grid segments
  grid_start: number
  grid_count: number
  // Indices of the off-grid window-end segments, written from `ends_start`
  ends_count: number
  // What this update rewrote, so the renderer re-uploads only that. `ends_changed` covers
  // the ends block and the two end vertex rows it joins (unused rows need no upload).
  ends_changed: boolean
  offsets_changed: boolean
  head_box_changed: boolean
}

// Texels per row of the per-atom data textures (anchor offsets, colors). A constant the
// shader bakes in; 1024 keeps even 8M atoms inside WebGPU's guaranteed 8192-row limit.
export const TRAIL_TEXEL_ROW = 1024
// d3's viridis is a 256-step ramp sampled at floor(t * 256): the shader repeats that in
// integer math and reads the step from TIME_RAMP_SIZE + 1 color texels (t = 1 lands on step
// 256, which d3 clamps to its last color)
export const TIME_RAMP_SIZE = 256

// rgba float storage for `count` texels, padded to whole texture rows
const texel_buffer = (count: number): Float32Array =>
  new Float32Array(Math.max(1, Math.ceil(count / TRAIL_TEXEL_ROW)) * TRAIL_TEXEL_ROW * 4)

const fail = (message: string): never => {
  throw new Error(`TrajectoryTrail: ${message}`)
}

// `break` mode's whole definition of a boundary crossing: a step past half a cell along a
// periodic axis can only be a wrap-around at sane sampling rates. (At large frame_stride
// genuine diffusion can also exceed it; use `unwrap` there.) A frame with no cell never
// breaks. The Cartesian→fractional converter is rebuilt only when the cell changes, so a
// fixed cell pays for one inverse and NPT pays per distinct matrix.
function make_wrap_jump_test(
  stream: TrajectoryPositionStream,
): (step: Vec3, frame_idx: number) => boolean {
  const periodic = stream.pbc ?? [true, true, true]
  const frac_step: Vec3 = [0, 0, 0]
  let cached: {
    lattice: Matrix3x3
    cart_to_frac: ReturnType<typeof create_cart_to_frac>
  } | null = null
  return (step, frame_idx) => {
    const lattice = stream.lattice_matrices?.[frame_idx]
    if (!lattice) return false
    if (cached?.lattice !== lattice) {
      cached = { lattice, cart_to_frac: create_cart_to_frac(lattice) }
    }
    cached.cart_to_frac(step, frac_step)
    return (
      (periodic[0] && Math.abs(frac_step[0]) > 0.5) ||
      (periodic[1] && Math.abs(frac_step[1]) > 0.5) ||
      (periodic[2] && Math.abs(frac_step[2]) > 0.5)
    )
  }
}

// Convert a source-file frame index to the collected stream, clamped if collection stopped.
export const collected_frame_idx = (
  stream: Pick<TrajectoryPositionStream, `n_frames` | `frame_stride`>,
  source_idx: number,
): number => clamp(Math.floor(source_idx / stream.frame_stride), 0, stream.n_frames - 1)

// Longest segment and drop count of one batch of segments
interface SegmentTally {
  dropped: number
  max_sq: number
}

// A whole run's trail polylines, built once per stream and options; update() then moves the
// window. Vertex v is atom slot v % atom_count at vertex row floor(v / atom_count): rows
// [0, n_grid) hold grid frame row * frame_stride, row n_grid the window's start frame and
// row n_grid + 1 its end frame.
export class TrajectoryTrail {
  // Atoms drawn, in stream order; slot i is column i of every vertex row
  readonly atom_idxs: number[]
  readonly frame_stride: number
  readonly n_grid: number
  // xyz per vertex, frame-major
  readonly positions: Float32Array
  // Grid segments in row order, then the window-ends block from `ends_start`
  readonly indices: Uint32Array
  readonly ends_start: number
  // Per-atom translation onto the anchors, as rgba texels (TRAIL_TEXEL_ROW per row)
  readonly offsets: Float32Array
  // Box around the drawn trail heads: the depth-sort key against other translucent layers.
  // The shader moves the stored points onto their anchors, so a box over `positions` would
  // not say where the trail is drawn.
  readonly head_box: { min: Vec3; max: Vec3 } = { min: [0, 0, 0], max: [0, 0, 0] }
  readonly stream: TrajectoryPositionStream
  private readonly coords: Float64Array
  private readonly is_wrap_jump: ((step: Vec3, frame_idx: number) => boolean) | null
  // Per grid row: index count through its incoming segments, drops through it, and its
  // longest incoming segment squared
  private readonly row_ends: Uint32Array
  private readonly dropped_through: Uint32Array
  private readonly row_max_sq: Float64Array
  private readonly step: Vec3 = [0, 0, 0]
  // The window the ends block was written for, and its tally
  private ends_window = { start: -1, end: -1, count: 0 }
  private readonly ends_tally: SegmentTally = { dropped: 0, max_sq: 0 }
  // The anchors and end frame the heads were placed for
  private heads_for: { anchors: Float64Array | null; end_frame: number } = {
    anchors: null,
    end_frame: -1,
  }

  constructor(stream: TrajectoryPositionStream, options: TrajectoryTrailOptions = {}) {
    const { n_frames, n_atoms, elements: atom_elements } = stream
    const { frame_stride = 1, elements: element_filter = null, wrap_mode = `unwrap` } = options
    if (n_frames < 1) fail(`stream has no frames`)
    if (n_atoms < 1) fail(`stream has no atoms`)
    const expected_length = n_frames * n_atoms * 3
    if (stream.positions.length !== expected_length) {
      fail(
        `positions has ${stream.positions.length} entries but ${n_frames} frames x ` +
          `${n_atoms} atoms x 3 requires ${expected_length}`,
      )
    }
    if (atom_elements.length !== n_atoms) {
      fail(
        `got ${atom_elements.length} element labels for ${n_atoms} atoms; atom order is the ` +
          `atom identity and must be one label per atom`,
      )
    }
    if (!Number.isInteger(frame_stride) || frame_stride < 1) {
      fail(`frame_stride must be a positive integer, got ${frame_stride}`)
    }

    const wanted = element_filter ? new Set(element_filter) : null
    this.atom_idxs = []
    for (let atom_idx = 0; atom_idx < n_atoms; atom_idx++) {
      if (!wanted || wanted.has(atom_elements[atom_idx])) this.atom_idxs.push(atom_idx)
    }
    this.stream = stream
    this.frame_stride = frame_stride
    this.n_grid = Math.floor((n_frames - 1) / frame_stride) + 1
    // `break` mode is the only consumer of wrapped coordinates — it exists precisely to show
    // where the wrapping happened, so unwrapping first would leave it nothing to break on.
    this.coords =
      wrap_mode === `break` ? stream.positions : unwrapped_positions_of(stream).coords
    this.is_wrap_jump = wrap_mode === `break` ? make_wrap_jump_test(stream) : null

    const atom_count = this.atom_idxs.length
    const { n_grid } = this
    this.positions = new Float32Array((n_grid + 2) * atom_count * 3)
    // Grid segments at most one per atom per row step, plus two per atom at the window ends
    this.indices = new Uint32Array(((n_grid - 1) * 2 + 4) * atom_count)
    this.offsets = texel_buffer(atom_count)
    this.row_ends = new Uint32Array(n_grid)
    this.dropped_through = new Uint32Array(n_grid)
    this.row_max_sq = new Float64Array(n_grid)
    this.write_row(0, 0)
    let cursor = 0
    const tally: SegmentTally = { dropped: 0, max_sq: 0 }
    for (let row = 1; row < n_grid; row++) {
      this.write_row(row, row * frame_stride)
      tally.dropped = 0
      tally.max_sq = 0
      cursor = this.join_rows(
        row - 1,
        row,
        (row - 1) * frame_stride,
        row * frame_stride,
        cursor,
        tally,
      )
      this.row_ends[row] = cursor
      this.dropped_through[row] = this.dropped_through[row - 1] + tally.dropped
      this.row_max_sq[row] = tally.max_sq
    }
    this.ends_start = cursor
  }

  // Copy every drawn atom's coordinates at `frame_idx` into vertex row `row`
  private write_row(row: number, frame_idx: number): void {
    const { atom_idxs, coords, positions } = this
    const frame_base = frame_idx * this.stream.n_atoms * 3
    const row_base = row * atom_idxs.length * 3
    for (let slot = 0; slot < atom_idxs.length; slot++) {
      const source = frame_base + atom_idxs[slot] * 3
      const target = row_base + slot * 3
      positions[target] = coords[source]
      positions[target + 1] = coords[source + 1]
      positions[target + 2] = coords[source + 2]
    }
  }

  // Write the segments joining each atom's point in vertex row `from_row` (frame
  // `from_frame`) to row `to_row` (frame `to_frame`) at `cursor`, skipping `break`-mode wrap
  // jumps; returns the cursor after them. Lengths come from the float64 source coordinates,
  // which no anchor translation can change.
  private join_rows(
    from_row: number,
    to_row: number,
    from_frame: number,
    to_frame: number,
    cursor: number,
    tally: SegmentTally,
  ): number {
    const { atom_idxs, coords, indices, step, is_wrap_jump } = this
    const atom_count = atom_idxs.length
    const { n_atoms } = this.stream
    for (let slot = 0; slot < atom_count; slot++) {
      const from = (from_frame * n_atoms + atom_idxs[slot]) * 3
      const to = (to_frame * n_atoms + atom_idxs[slot]) * 3
      step[0] = coords[to] - coords[from]
      step[1] = coords[to + 1] - coords[from + 1]
      step[2] = coords[to + 2] - coords[from + 2]
      if (is_wrap_jump?.(step, to_frame)) {
        tally.dropped++
        continue
      }
      const length_sq = step[0] * step[0] + step[1] * step[1] + step[2] * step[2]
      if (length_sq > tally.max_sq) tally.max_sq = length_sq
      indices[cursor++] = from_row * atom_count + slot
      indices[cursor++] = to_row * atom_count + slot
    }
    return cursor
  }

  // Point the trail at a new window. O(1) for its grid part, O(atoms) for an off-grid end or
  // new anchors, and nothing is rewritten that the previous window already left in place.
  update(window: TrajectoryTrailWindow = {}): TrajectoryTrailFrame {
    const { n_frames, n_atoms } = this.stream
    const { trail_frames = null, anchor_positions = null } = window
    const end_frame = window.end_frame ?? n_frames - 1
    if (!Number.isInteger(end_frame) || end_frame < 0 || end_frame >= n_frames) {
      fail(`end_frame must be an integer in [0, ${n_frames - 1}], got ${end_frame}`)
    }
    if (trail_frames !== null && (!Number.isInteger(trail_frames) || trail_frames < 1)) {
      fail(`trail_frames must be null or a positive integer, got ${trail_frames}`)
    }
    if (anchor_positions && anchor_positions.length !== n_atoms * 3) {
      fail(
        `anchor_positions has ${anchor_positions.length} entries but ${n_atoms} atoms x 3 ` +
          `requires ${n_atoms * 3}; anchors are indexed by the stream's atom order`,
      )
    }
    const start_frame = trail_frames === null ? 0 : Math.max(0, end_frame - trail_frames + 1)
    const atom_count = this.atom_idxs.length
    const frame: TrajectoryTrailFrame = {
      stats: {
        point_count: 0,
        segment_count: 0,
        atom_count: 0,
        frame_idxs: [],
        dropped_segments: 0,
        max_segment_length: 0,
      },
      start_frame,
      end_frame,
      grid_start: 0,
      grid_count: 0,
      ends_count: 0,
      ends_changed: false,
      offsets_changed: false,
      head_box_changed: false,
    }
    // A single sampled point has no segment; an explicit empty filter is a legitimate UI state
    if (atom_count === 0 || end_frame <= start_frame) return frame

    // Grid rows inside the window; the ends join it through rows n_grid and n_grid + 1
    const { frame_stride, n_grid } = this
    const first_row = Math.ceil(start_frame / frame_stride)
    const last_row = Math.floor(end_frame / frame_stride)
    const tail = start_frame % frame_stride !== 0
    const head = end_frame % frame_stride !== 0
    const { frame_idxs } = frame.stats
    if (tail) frame_idxs.push(start_frame)
    for (let row = first_row; row <= last_row; row++) frame_idxs.push(row * frame_stride)
    if (head) frame_idxs.push(end_frame)

    let dropped = 0
    let max_sq = 0
    if (first_row < last_row) {
      frame.grid_start = this.row_ends[first_row]
      frame.grid_count = this.row_ends[last_row] - frame.grid_start
      dropped = this.dropped_through[last_row] - this.dropped_through[first_row]
      for (let row = first_row + 1; row <= last_row; row++) {
        max_sq = Math.max(max_sq, this.row_max_sq[row])
      }
    }

    const { ends_window, ends_tally } = this
    if (ends_window.start !== start_frame || ends_window.end !== end_frame) {
      ends_tally.dropped = 0
      ends_tally.max_sq = 0
      let cursor = this.ends_start
      if (tail) this.write_row(n_grid, start_frame)
      if (head) this.write_row(n_grid + 1, end_frame)
      if (first_row > last_row) {
        // No grid frame inside the window: one segment straight from start to end
        cursor = this.join_rows(n_grid, n_grid + 1, start_frame, end_frame, cursor, ends_tally)
      } else {
        const [first_grid, last_grid] = [first_row * frame_stride, last_row * frame_stride]
        if (tail) {
          cursor = this.join_rows(
            n_grid,
            first_row,
            start_frame,
            first_grid,
            cursor,
            ends_tally,
          )
        }
        if (head) {
          cursor = this.join_rows(
            last_row,
            n_grid + 1,
            last_grid,
            end_frame,
            cursor,
            ends_tally,
          )
        }
      }
      this.ends_window = {
        start: start_frame,
        end: end_frame,
        count: cursor - this.ends_start,
      }
      frame.ends_changed = cursor > this.ends_start
    }
    frame.ends_count = this.ends_window.count

    const heads = this.write_heads(anchor_positions, end_frame)
    frame.offsets_changed = heads.offsets
    frame.head_box_changed = heads.box
    Object.assign(frame.stats, {
      point_count: atom_count * frame_idxs.length,
      segment_count: (frame.grid_count + frame.ends_count) / 2,
      atom_count,
      dropped_segments: dropped + ends_tally.dropped,
      max_segment_length: Math.sqrt(Math.max(max_sq, ends_tally.max_sq)),
    })
    return frame
  }

  // Where each atom's trail head (its point at `end_frame`) is drawn: on its anchor, or in
  // place without anchors. Writes the per-atom offsets that put it there and the box around
  // the heads. The box follows every new end frame; the offsets only change with anchors.
  private write_heads(
    anchors: Float64Array | null,
    end_frame: number,
  ): { offsets: boolean; box: boolean } {
    const previous = this.heads_for
    if (anchors === previous.anchors && end_frame === previous.end_frame) {
      return { offsets: false, box: false }
    }
    this.heads_for = { anchors, end_frame }
    const { atom_idxs, coords, offsets } = this
    const { min, max } = this.head_box
    min.fill(Infinity)
    max.fill(-Infinity)
    const head_base = end_frame * this.stream.n_atoms * 3
    for (let slot = 0; slot < atom_idxs.length; slot++) {
      const atom = atom_idxs[slot] * 3
      for (let axis = 0; axis < 3; axis++) {
        const head = coords[head_base + atom + axis]
        const drawn = anchors ? anchors[atom + axis] : head
        offsets[slot * 4 + axis] = drawn - head
        if (drawn < min[axis]) min[axis] = drawn
        if (drawn > max[axis]) max[axis] = drawn
      }
    }
    // Unanchored offsets stay zero, so only anchors (or dropping them) need a re-upload
    return { offsets: Boolean(anchors ?? previous.anchors), box: true }
  }
}

// Color texels the trail shader reads: one per drawn atom in `element` mode, the viridis
// ramp in `time` mode (the shader picks the step from the window position). The ramp is
// parsed with parse_linear_rgb rather than the memoized css_to_linear_rgb so its 256 strings
// do not evict the element colors from that cache.
export function trail_color_texels(
  trail: TrajectoryTrail,
  color_mode: TrajectoryLineColorMode,
  element_colors: Partial<Record<ElementSymbol, string>> = default_element_colors,
): Float32Array {
  if (color_mode === `time`) {
    const interpolate = get_d3_interpolator(`interpolateViridis`)
    const texels = texel_buffer(TIME_RAMP_SIZE + 1)
    // step / 256 lands exactly on step `step` of d3's floor(t * 256)
    for (let step = 0; step <= TIME_RAMP_SIZE; step++) {
      texels.set(parse_linear_rgb(interpolate(step / TIME_RAMP_SIZE)), step * 4)
    }
    return texels
  }
  const { atom_idxs, stream } = trail
  const texels = texel_buffer(atom_idxs.length)
  for (let slot = 0; slot < atom_idxs.length; slot++) {
    const element = stream.elements[atom_idxs[slot]]
    texels.set(css_to_linear_rgb(element_colors[element] ?? `#808080`), slot * 4)
  }
  return texels
}

// Cartesian trail-head targets in the position stream's atom order, or null when the
// displayed sites cannot be matched to the stream's atoms one for one. Trails are built from
// raw (unwrapped) stream coordinates while the spheres are drawn from the displayed
// structure, so without these anchors a trail head sits whole lattice vectors from its atom.
// get_pbc_image_sites keeps the base sites at [0, n_atoms) in stream order and appends the
// image copies, so those leading sites still anchor. A supercell instead renumbers every
// atom (every site carries unit-cell provenance), leaving nothing to anchor one-to-one.
export function trajectory_trail_anchors(
  sites: readonly Site[] | undefined,
  n_atoms: number | undefined,
): Float64Array | null {
  if (!sites || !n_atoms || sites.length < n_atoms) return null
  const anchors = new Float64Array(n_atoms * 3)
  for (let site_idx = 0; site_idx < n_atoms; site_idx++) {
    const site = sites[site_idx]
    const { image_of, unit_cell_idx } = site.provenance ?? {}
    if (image_of !== undefined || unit_cell_idx !== undefined) return null
    anchors.set(site.xyz, site_idx * 3)
  }
  return anchors
}
