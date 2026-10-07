// Per-atom trajectory trails — the path each atom traces over an MD run, the same thing
// OVITO calls "generate trajectory lines".
//
// TrajectoryTrail samples the WHOLE run once onto the frame_stride grid in frame-major vertex
// rows (row k holds every drawn atom at frame k * frame_stride), so the segments of any window
// of grid frames are one contiguous index range and sliding the window moves a draw range. Two
// extra rows hold the window's start and end when they fall between grid frames; their
// segments live in a small index block rewritten per window, O(atoms). Anchor translations and
// time colors are applied in the shader (TrajectoryLines.svelte) from per-atom offsets and the
// window bounds, so no per-window work scales with atoms x frames.
//
// One indexed line-segment buffer serves the whole scene (one draw call, two while an off-grid
// end is drawn, not one object per atom); indexed because each interior point is shared by two
// segments. Plain typed arrays only, so this module is unit tested without a WebGPU context.
import { default_element_colors, get_d3_interpolator } from '#lib/colors/index.js'
import type { ElementSymbol } from '#lib/element/index.js'
import type { Matrix3x3, Vec3 } from '#lib/math.js'
import { clamp, create_cart_to_frac } from '#lib/math.js'
import { unwrapped_positions_of } from '#lib/trajectory/positions.js'
import { css_to_linear_rgb, parse_linear_rgb } from '#lib/scene/colors.js'
import type { TrajectoryPositionStream } from '#lib/trajectory/index.js'
import type { Site } from '#lib/structure/index.js'

// `element` paints each trail in its atom's color (matching the spheres in the scene),
// `time` runs a d3 ramp from the oldest sampled frame to the newest so the head of a
// comet tail is visually distinct from its tail.
export type TrajectoryLineColorMode = `element` | `time`
// The d3 interpolator of the time ramp: viridis for trajectories; a host run's short trails
// over atoms use a ramp without viridis's near-black start, which vanishes on dark viewers.
export type TrajectoryLineTimeScheme = `interpolateViridis` | `interpolateCool`

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
  // Newest collected-frame index the trail reaches, defaulting to the last. This indexes the
  // STREAM's frames, which are already `stream.frame_stride` apart in the source file.
  end_frame?: number
  // How many collected frames the trail spans back from `end_frame`; null draws the whole run
  trail_frames?: number | null
  // Cartesian trail-head targets in stream atom order. Each whole polyline is translated
  // onto its anchor without changing its shape.
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

// Where one window sits in a trail's buffers
export interface TrajectoryTrailFrame {
  stats: TrajectoryLinesStats
  // Window bounds in collected frames; the shader's time ramp spans them
  start_frame: number
  end_frame: number
  // Index ranges of the window's grid segments and of its off-grid ends (from `ends_start`)
  grid_start: number
  grid_count: number
  ends_count: number
  // What the renderer must re-upload: a rewritten ends block (and its two vertex rows), and
  // offsets unless they were and stay zero without anchors
  ends_changed: boolean
  offsets_changed: boolean
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

// A whole run's trail polylines, built once per stream and options; update() then moves the
// window. Vertex v is atom slot v % atom_count in vertex row floor(v / atom_count): rows
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
  // Box around the drawn trail heads, the depth-sort key against other translucent layers
  // (a box over `positions` would miss the shader's anchor translation)
  readonly head_box: { min: Vec3; max: Vec3 } = { min: [0, 0, 0], max: [0, 0, 0] }
  readonly stream: TrajectoryPositionStream
  private readonly coords: Float64Array
  private readonly is_wrap_jump: ((step: Vec3, frame_idx: number) => boolean) | null
  // Per grid row: index count through its incoming segments and the longest of them squared
  private readonly row_ends: Uint32Array
  private readonly row_max_sq: Float64Array
  private readonly step: Vec3 = [0, 0, 0]
  // The window's off-grid start and end frames (rows n_grid and n_grid + 1), -1 when on-grid
  private tail_frame = -1
  private head_frame = -1
  // join() state: the next index slot and the longest segment squared since the last reset
  private cursor = 0
  private max_sq = 0
  // Whether the offsets hold an anchor translation rather than zeros
  private anchored = false

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
    // `break` mode shows where the wrapping happened, so it keeps the wrapped coordinates
    const break_mode = wrap_mode === `break`
    this.coords = break_mode ? stream.positions : unwrapped_positions_of(stream).coords
    this.is_wrap_jump = break_mode ? make_wrap_jump_test(stream) : null

    const atom_count = this.atom_idxs.length
    const { n_grid } = this
    this.positions = new Float32Array((n_grid + 2) * atom_count * 3)
    // Grid segments at most one per atom per row step, plus two per atom at the window ends
    this.indices = new Uint32Array(((n_grid - 1) * 2 + 4) * atom_count)
    this.offsets = texel_buffer(atom_count)
    this.row_ends = new Uint32Array(n_grid)
    this.row_max_sq = new Float64Array(n_grid)
    this.write_row(0)
    for (let row = 1; row < n_grid; row++) {
      this.write_row(row * frame_stride)
      this.max_sq = 0
      this.join((row - 1) * frame_stride, row * frame_stride)
      this.row_ends[row] = this.cursor
      this.row_max_sq[row] = this.max_sq
    }
    // join() state now describes an empty ends block, matching the on-grid initial ends
    this.ends_start = this.cursor
    this.max_sq = 0
  }

  // Vertex row of a sampled frame: its grid row, or the row of an off-grid window end
  private row_of(frame_idx: number): number {
    if (frame_idx === this.tail_frame) return this.n_grid
    return frame_idx === this.head_frame ? this.n_grid + 1 : frame_idx / this.frame_stride
  }

  // Copy every drawn atom's coordinates at `frame_idx` into that frame's vertex row
  private write_row(frame_idx: number): void {
    const { atom_idxs, coords, positions } = this
    const frame_base = frame_idx * this.stream.n_atoms * 3
    const row_base = this.row_of(frame_idx) * atom_idxs.length * 3
    for (let slot = 0; slot < atom_idxs.length; slot++) {
      const source = frame_base + atom_idxs[slot] * 3
      const target = row_base + slot * 3
      positions[target] = coords[source]
      positions[target + 1] = coords[source + 1]
      positions[target + 2] = coords[source + 2]
    }
  }

  // Write the segments joining each atom's points at two sampled frames, skipping `break`-mode
  // wrap jumps. Lengths come from the float64 source coordinates, which anchors never change.
  private join(from_frame: number, to_frame: number): void {
    const { atom_idxs, coords, indices, step, is_wrap_jump } = this
    const atom_count = atom_idxs.length
    const { n_atoms } = this.stream
    const from_vertex = this.row_of(from_frame) * atom_count
    const to_vertex = this.row_of(to_frame) * atom_count
    let { cursor, max_sq } = this
    for (let slot = 0; slot < atom_count; slot++) {
      const from = (from_frame * n_atoms + atom_idxs[slot]) * 3
      const to = (to_frame * n_atoms + atom_idxs[slot]) * 3
      step[0] = coords[to] - coords[from]
      step[1] = coords[to + 1] - coords[from + 1]
      step[2] = coords[to + 2] - coords[from + 2]
      if (is_wrap_jump?.(step, to_frame)) continue
      const length_sq = step[0] * step[0] + step[1] * step[1] + step[2] * step[2]
      if (length_sq > max_sq) max_sq = length_sq
      indices[cursor++] = from_vertex + slot
      indices[cursor++] = to_vertex + slot
    }
    this.cursor = cursor
    this.max_sq = max_sq
  }

  // Point the trail at a new window: O(1) for its grid part, O(atoms) for its off-grid ends
  // and trail heads
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
    }
    // A single sampled point has no segment; an explicit empty filter is a legitimate UI state
    if (atom_count === 0 || end_frame <= start_frame) return frame

    const { frame_stride, row_ends, row_max_sq } = this
    const first_row = Math.ceil(start_frame / frame_stride)
    const last_row = Math.floor(end_frame / frame_stride)
    const tail_frame = start_frame % frame_stride ? start_frame : -1
    const head_frame = end_frame % frame_stride ? end_frame : -1
    const { frame_idxs } = frame.stats
    if (tail_frame >= 0) frame_idxs.push(start_frame)
    for (let row = first_row; row <= last_row; row++) frame_idxs.push(row * frame_stride)
    if (head_frame >= 0) frame_idxs.push(end_frame)
    const last = frame_idxs.length - 1

    let grid_max_sq = 0
    if (first_row < last_row) {
      frame.grid_start = row_ends[first_row]
      frame.grid_count = row_ends[last_row] - frame.grid_start
      for (let row = first_row + 1; row <= last_row; row++) {
        grid_max_sq = Math.max(grid_max_sq, row_max_sq[row])
      }
    }
    // The ends block depends only on the off-grid end frames, so it is rewritten (with its
    // vertex rows) only when they move. Each joins its grid neighbour, or the other end when
    // no grid row lies between. cursor and max_sq then hold the block's extent until next time.
    if (tail_frame !== this.tail_frame || head_frame !== this.head_frame) {
      this.tail_frame = tail_frame
      this.head_frame = head_frame
      this.cursor = this.ends_start
      this.max_sq = 0
      if (tail_frame >= 0) {
        this.write_row(start_frame)
        this.join(start_frame, frame_idxs[1])
      }
      if (head_frame >= 0) {
        this.write_row(end_frame)
        if (tail_frame < 0 || last > 1) this.join(frame_idxs[last - 1], end_frame)
      }
      frame.ends_changed = this.cursor > this.ends_start
    }
    frame.ends_count = this.cursor - this.ends_start
    frame.offsets_changed = this.place_heads(anchor_positions, end_frame)

    const segment_count = (frame.grid_count + frame.ends_count) / 2
    Object.assign(frame.stats, {
      point_count: atom_count * frame_idxs.length,
      segment_count,
      atom_count,
      // Consecutive sampled frames join every atom once, unless `break` mode dropped it
      dropped_segments: atom_count * last - segment_count,
      max_segment_length: Math.sqrt(Math.max(grid_max_sq, this.max_sq)),
    })
    return frame
  }

  // Put each trail head (its point at `end_frame`) on its anchor, or leave it in place
  // without anchors: writes the per-atom offsets and the box around the drawn heads, and
  // returns whether the offsets changed
  private place_heads(anchors: Float64Array | null, end_frame: number): boolean {
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
    const changed = Boolean(anchors) || this.anchored
    this.anchored = Boolean(anchors)
    return changed
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
  time_scheme: TrajectoryLineTimeScheme = `interpolateViridis`,
): Float32Array {
  if (color_mode === `time`) {
    const interpolate = get_d3_interpolator(time_scheme)
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

// A trail window's segments as start/end point pairs with their colors, the vertex layout
// three's fat lines (LineSegments2) take: what the 1-pixel shader computes per vertex (anchor
// offset by atom slot, color by slot or by the frame's place on the time ramp), done once per
// window on the CPU. For trails thick enough to see next to atoms, which WebGPU's native lines
// (always 1 device pixel) are not; sized for host runs' small trails, not whole trajectories.
export function trail_segments(
  trail: TrajectoryTrail,
  shown: TrajectoryTrailFrame,
  color_texels: Float32Array,
  time_colors: boolean,
): { positions: Float32Array; colors: Float32Array } {
  const ranges: [number, number][] = [
    [shown.grid_start, shown.grid_count],
    [trail.ends_start, shown.ends_count],
  ]
  const n_vertices = shown.grid_count + shown.ends_count
  const positions = new Float32Array(n_vertices * 3)
  const colors = new Float32Array(n_vertices * 3)
  const atoms_per_row = Math.max(1, trail.atom_idxs.length)
  const { start_frame, end_frame } = shown
  let out = 0
  for (const [first, count] of ranges) {
    for (let idx = first; idx < first + count; idx++) {
      const vertex = trail.indices[idx]
      const slot = vertex % atoms_per_row
      const row = Math.floor(vertex / atoms_per_row)
      const frame =
        row < trail.n_grid
          ? row * trail.frame_stride
          : row === trail.n_grid
            ? start_frame
            : end_frame
      const color_idx = time_colors
        ? Math.floor(((frame - start_frame) * TIME_RAMP_SIZE) / (end_frame - start_frame))
        : slot
      for (let axis = 0; axis < 3; axis++) {
        positions[out * 3 + axis] =
          trail.positions[vertex * 3 + axis] + trail.offsets[slot * 4 + axis]
        colors[out * 3 + axis] = color_texels[color_idx * 4 + axis]
      }
      out++
    }
  }
  return { positions, colors }
}
