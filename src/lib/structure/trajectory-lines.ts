// Per-atom trajectory trails — the path each atom traces over an MD run, the same thing
// OVITO calls "generate trajectory lines".
//
// Output is ONE indexed line-segment buffer for the whole scene, so a 500-atom x 5000-frame
// run is a single draw call rather than 500 objects. Indexed (not a flat LineSegments pair
// list) because each interior point is shared by two segments: indexing stores it once
// instead of twice, cutting the position+color upload by a third and letting the GPU's
// post-transform cache skip the duplicate vertex shader invocation.
//
// Everything here is a pure function of the position stream + options so it can be unit
// tested without a WebGPU context; TrajectoryLines.svelte only wraps the result in buffers.
import type { D3InterpolateName } from '$lib/colors'
import { default_element_colors, get_d3_interpolator } from '$lib/colors'
import type { ElementSymbol } from '$lib/element'
import type { Matrix3x3, Vec3 } from '$lib/math'
import { create_cart_to_frac } from '$lib/math'
import { unwrap_flat_positions } from '$lib/msd/calc-msd'
import { css_to_linear_rgb, parse_linear_rgb } from '$lib/scene/colors'
import type { TrajectoryPositionStream } from '$lib/trajectory'

// `element` paints each trail in its atom's color (matching the spheres in the scene),
// `time` runs a d3 ramp from the oldest sampled frame to the newest so the head of a
// comet tail is visually distinct from its tail.
export type TrajectoryLineColorMode = `element` | `time`

// `unwrap` accumulates minimum-image steps so an atom leaving the cell keeps going in a
// straight line (the default, and the only mode that shows real diffusion paths).
// `break` keeps wrapped coordinates and simply omits the segment where an atom jumped
// across the box, so trails stay inside the cell at the cost of visible gaps.
export type TrajectoryLineWrapMode = `unwrap` | `break`

export interface TrajectoryLinesOptions {
  // Newest collected-frame index the trail reaches. Defaults to the last collected frame.
  // This is an index into the STREAM's frames, which are already `stream.frame_stride`
  // apart in the source file.
  end_frame?: number
  // How many collected frames the trail spans back from `end_frame`. null/undefined draws
  // the whole run.
  trail_frames?: number | null
  // Keep only every Nth collected frame inside the window, on top of the stream's own
  // frame_stride. The grid is anchored at frame 0 so the sampled set does not shift as the
  // window slides; both window ends are always included, so a trail never degenerates and
  // its head stays glued to the atom.
  frame_stride?: number
  // Species to draw trails for. undefined/null means every atom; an EMPTY array means none
  // (so unchecking every box in a UI hides the layer rather than showing everything).
  elements?: readonly ElementSymbol[] | null
  color_mode?: TrajectoryLineColorMode
  // Per-element CSS colors, normally the scene's live `colors.element` map so trails match
  // their spheres. Defaults to the VESTA palette.
  element_colors?: Partial<Record<ElementSymbol, string>>
  // d3 ramp used by `time` color mode, sampled across the window
  color_scale?: D3InterpolateName
  wrap_mode?: TrajectoryLineWrapMode
  // Cartesian trail-head targets in stream atom order. Each whole polyline is translated
  // onto its anchor without changing its shape.
  anchor_positions?: Float64Array | null
}

export interface TrajectoryLinesGeometry {
  // 3 floats per sampled point, atom-major (every sampled frame of atom 0, then atom 1, …)
  positions: Float32Array
  // Linear-space rgb per point, matching `positions`
  colors: Float32Array
  // 2 point indices per drawn segment
  indices: Uint32Array
  point_count: number
  segment_count: number
  // Atoms that survived the element filter and contributed at least one point
  atom_count: number
  // Collected-frame indices sampled into the window, ascending
  frame_idxs: number[]
  // `break` mode only: segments omitted because the atom crossed a cell boundary
  dropped_segments: number
  // Longest drawn segment in Å. A correctly unwrapped path keeps this at the scale of the
  // real per-step displacement; a box-spanning artefact shows up here immediately.
  max_segment_length: number
}

// A build's counts without its buffers. This is what TrajectoryLines binds out for cost
// readouts: handing over the typed arrays instead would pin ~80 MB in the consumer for as
// long as it holds the object, outliving the geometry those arrays were disposed with.
export type TrajectoryLinesStats = Omit<
  TrajectoryLinesGeometry,
  `positions` | `colors` | `indices`
>

// Dropping the three buffers by rest, so a stat added to the geometry lands here too
export const trajectory_lines_stats = ({
  positions: _positions,
  colors: _colors,
  indices: _indices,
  ...stats
}: TrajectoryLinesGeometry): TrajectoryLinesStats => stats

// Fresh buffers prevent one consumer from mutating later empty results.
const empty_geometry = (): TrajectoryLinesGeometry => ({
  positions: new Float32Array(0),
  colors: new Float32Array(0),
  indices: new Uint32Array(0),
  point_count: 0,
  segment_count: 0,
  atom_count: 0,
  frame_idxs: [],
  dropped_segments: 0,
  max_segment_length: 0,
})

const fail = (message: string): never => {
  throw new Error(`build_trajectory_lines: ${message}`)
}

// Unwrapping allocates a second copy of the whole trajectory, so it must not rerun every
// time the playhead moves. Keyed on the stream object: a new stream (new file, new stride)
// gets a fresh unwrap and the old buffer becomes collectable with its stream.
const unwrap_cache = new WeakMap<TrajectoryPositionStream, Float64Array>()

// Cartesian coordinates to draw trails through: minimum-image unwrapped when the source
// stored wrapped coordinates, otherwise the stream's own buffer BY IDENTITY.
//
// Already-unwrapped sources (LAMMPS xu/yu/zu) are returned untouched on purpose:
// re-applying the minimum image convention to them silently truncates any real displacement
// beyond half a box, which is exactly the diffusion a trajectory line is drawn to show
// (see the comment at calc-msd.ts:211-220).
export function unwrapped_stream_positions(stream: TrajectoryPositionStream): Float64Array {
  const { positions, coords_unwrapped, lattice_matrices, n_frames, n_atoms, pbc } = stream
  if (coords_unwrapped) return positions
  // No cell means nothing was ever folded, so there is nothing to undo
  if (!lattice_matrices?.some((matrix) => matrix != null)) return positions
  const cached = unwrap_cache.get(stream)
  if (cached) return cached
  const unwrapped = unwrap_flat_positions(
    positions,
    n_frames,
    n_atoms,
    lattice_matrices,
    pbc ?? [true, true, true],
  )
  unwrap_cache.set(stream, unwrapped)
  return unwrapped
}

// Collected-frame indices to draw, ascending. Interior points sit on a stride grid anchored
// at frame 0 (stable as the window slides) and both window ends are always included.
function sample_window_frames(
  start_frame: number,
  end_frame: number,
  frame_stride: number,
): number[] {
  if (end_frame <= start_frame) return [start_frame]
  const frames = [start_frame]
  const first_grid = Math.ceil((start_frame + 1) / frame_stride) * frame_stride
  for (let frame = first_grid; frame < end_frame; frame += frame_stride) frames.push(frame)
  frames.push(end_frame)
  return frames
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
  let cached_lattice: Matrix3x3 | null = null
  let cart_to_frac: ((cart: Vec3) => Vec3) | null = null
  return (step, frame_idx) => {
    const lattice = stream.lattice_matrices?.[frame_idx] ?? null
    if (!lattice) return false
    if (lattice !== cached_lattice) {
      cached_lattice = lattice
      cart_to_frac = create_cart_to_frac(lattice)
    }
    if (!cart_to_frac) return false
    const frac_step = cart_to_frac(step)
    return [0, 1, 2].some((axis) => periodic[axis] && Math.abs(frac_step[axis]) > 0.5)
  }
}

// Convert a source-file frame index to the collected stream, clamped if collection stopped.
export const collected_frame_idx = (
  stream: Pick<TrajectoryPositionStream, `n_frames` | `frame_stride`>,
  source_idx: number,
): number =>
  Math.max(0, Math.min(stream.n_frames - 1, Math.floor(source_idx / stream.frame_stride)))

export function build_trajectory_lines(
  stream: TrajectoryPositionStream,
  options: TrajectoryLinesOptions = {},
): TrajectoryLinesGeometry {
  const { n_frames, n_atoms, elements: atom_elements } = stream
  const {
    trail_frames = null,
    frame_stride = 1,
    elements: element_filter = null,
    color_mode = `element`,
    element_colors = default_element_colors,
    color_scale = `interpolateViridis`,
    wrap_mode = `unwrap`,
    anchor_positions = null,
  } = options
  const end_frame = options.end_frame ?? n_frames - 1

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
  if (!Number.isInteger(end_frame) || end_frame < 0 || end_frame >= n_frames) {
    fail(`end_frame must be an integer in [0, ${n_frames - 1}], got ${end_frame}`)
  }
  if (!Number.isInteger(frame_stride) || frame_stride < 1) {
    fail(`frame_stride must be a positive integer, got ${frame_stride}`)
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

  // An explicit empty filter means "no species selected", which is a legitimate UI state
  if (element_filter?.length === 0) return empty_geometry()

  const wanted = element_filter ? new Set(element_filter) : null
  const atom_idxs: number[] = []
  for (let atom_idx = 0; atom_idx < n_atoms; atom_idx++) {
    if (!wanted || wanted.has(atom_elements[atom_idx])) atom_idxs.push(atom_idx)
  }
  if (atom_idxs.length === 0) return empty_geometry()

  const start_frame = trail_frames === null ? 0 : Math.max(0, end_frame - trail_frames + 1)
  const frame_idxs = sample_window_frames(start_frame, end_frame, frame_stride)
  const n_sampled = frame_idxs.length
  if (n_sampled < 2) return empty_geometry()

  // `break` mode is the only consumer of wrapped coordinates — it exists precisely to show
  // where the wrapping happened, so unwrapping first would leave it nothing to break on.
  const coords = wrap_mode === `break` ? stream.positions : unwrapped_stream_positions(stream)

  const point_count = atom_idxs.length * n_sampled
  const positions = new Float32Array(point_count * 3)
  const colors = new Float32Array(point_count * 3)
  // Upper bound; sliced to the drawn count below because `break` mode omits segments
  const indices = new Uint32Array(atom_idxs.length * (n_sampled - 1) * 2)

  // Both color modes resolve to one table read as `rgb_table[rgb_base + sample_idx *
  // rgb_stride]`, so the vertex loop has a single unconditional color write: `time` is one
  // ramp shared by every atom (stride 3, base 0), `element` is one color held for a whole
  // path (stride 0, base = the atom's slot). The ramp uses parse_linear_rgb rather than the
  // memoized css_to_linear_rgb because a continuous scale mints a distinct string per sample
  // and would evict the element colors from that cache.
  const time_mode = color_mode === `time`
  const rgb_stride = time_mode ? 3 : 0
  const rgb_table = new Float32Array((time_mode ? n_sampled : atom_idxs.length) * 3)
  if (time_mode) {
    const interpolate = get_d3_interpolator(color_scale)
    // End anchoring can make samples uneven, so color by elapsed frames, not sample ordinal.
    const frame_span = end_frame - start_frame
    for (let sample_idx = 0; sample_idx < n_sampled; sample_idx++) {
      const elapsed = (frame_idxs[sample_idx] - start_frame) / frame_span
      rgb_table.set(parse_linear_rgb(interpolate(elapsed)), sample_idx * 3)
    }
  } else {
    for (const [atom_slot, atom_idx] of atom_idxs.entries()) {
      const element_rgb = css_to_linear_rgb(
        element_colors[atom_elements[atom_idx]] ?? `#808080`,
      )
      rgb_table.set(element_rgb, atom_slot * 3)
    }
  }

  // `break` needs the cell to tell a real step from a wrap-around; `unwrap` never breaks
  const is_wrap_jump = wrap_mode === `break` ? make_wrap_jump_test(stream) : null

  let index_offset = 0
  let dropped_segments = 0
  let max_segment_length = 0
  const step: Vec3 = [0, 0, 0]
  // Reused across atoms; each atom gets either its anchor translation or zeros
  const shift: Vec3 = [0, 0, 0]

  for (const [atom_slot, atom_idx] of atom_idxs.entries()) {
    const point_base = atom_slot * n_sampled
    const rgb_base = time_mode ? 0 : atom_slot * 3
    // Constant per atom, so the polyline moves rigidly and every segment keeps its length
    const head = (end_frame * n_atoms + atom_idx) * 3
    for (let axis_idx = 0; axis_idx < 3; axis_idx++) {
      const anchor = anchor_positions?.[atom_idx * 3 + axis_idx]
      shift[axis_idx] = anchor === undefined ? 0 : anchor - coords[head + axis_idx]
    }

    for (const [sample_idx, frame_idx] of frame_idxs.entries()) {
      const source = (frame_idx * n_atoms + atom_idx) * 3
      const target = (point_base + sample_idx) * 3
      positions[target] = coords[source] + shift[0]
      positions[target + 1] = coords[source + 1] + shift[1]
      positions[target + 2] = coords[source + 2] + shift[2]
      const rgb_offset = rgb_base + sample_idx * rgb_stride
      colors[target] = rgb_table[rgb_offset]
      colors[target + 1] = rgb_table[rgb_offset + 1]
      colors[target + 2] = rgb_table[rgb_offset + 2]

      if (sample_idx === 0) continue
      const from = (point_base + sample_idx - 1) * 3
      step[0] = positions[target] - positions[from]
      step[1] = positions[target + 1] - positions[from + 1]
      step[2] = positions[target + 2] - positions[from + 2]

      if (is_wrap_jump?.(step, frame_idx)) {
        dropped_segments++
        continue
      }

      const length = Math.hypot(step[0], step[1], step[2])
      if (length > max_segment_length) max_segment_length = length
      indices[index_offset++] = point_base + sample_idx - 1
      indices[index_offset++] = point_base + sample_idx
    }
  }

  return {
    positions,
    colors,
    indices: index_offset === indices.length ? indices : indices.slice(0, index_offset),
    point_count,
    segment_count: index_offset / 2,
    atom_count: atom_idxs.length,
    frame_idxs,
    dropped_segments,
    max_segment_length,
  }
}
