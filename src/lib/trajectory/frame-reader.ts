// Unified frame loader for XYZ and ASE trajectories (large file indexing)
import * as math from '$lib/math'
import type { ElementSymbol } from '$lib/element'
import type { Matrix3x3 } from '$lib/math'
import type { Pbc } from '$lib/structure/index'
import type {
  FrameIndex,
  FrameLoader,
  ParseProgress,
  PositionStreamOptions,
  TrajectoryFrame,
  TrajectoryMetadata,
  TrajectoryPositionStream,
} from './index'
import {
  copy_numeric_fields,
  count_xyz_frames,
  iter_xyz_frames,
  validate_3x3_matrix,
} from './helpers'
import { indexed_trajectory_format } from '$lib/trajectory/format-detect'
import { ase_calculator_data, decode_ase_frame, read_ase_header } from './parse/ase'
import { build_xyz_frame, parse_xyz_comment_metadata } from './parse/xyz'

const MAX_METADATA_SIZE = 50 * 1024 * 1024 // 50MB limit for metadata

// Ceiling on a collected position buffer. 100k frames x 1k atoms x 3 x f64 is 2.4 TB,
// so a whole-trajectory sweep must refuse (with a workable frame_stride) rather than
// attempt the allocation.
export const DEFAULT_POSITION_STREAM_MAX_BYTES = 512 * 1024 * 1024

const BYTES_PER_FRAME_POSITION = 3 * Float64Array.BYTES_PER_ELEMENT

// Requested per-atom channels, resolved once so the budget arithmetic and the accumulator
// agree on what is being collected.
type StreamChannels = { scalar_keys: string[]; vector_keys: string[] }
const NO_CHANNELS: StreamChannels = { scalar_keys: [], vector_keys: [] }

// Per-atom, per-frame bytes: the xyz triple plus one double per scalar channel and three
// per vector channel. Channels are as real as positions, so leaving them out of the budget
// would make max_bytes under-report by a factor of (1 + channels/3).
const bytes_per_atom_frame = (channels: StreamChannels): number =>
  BYTES_PER_FRAME_POSITION +
  (channels.scalar_keys.length + 3 * channels.vector_keys.length) *
    Float64Array.BYTES_PER_ELEMENT

const missing_channel = (
  frame: number,
  atom_idx: number,
  kind: string,
  key: string,
  value: unknown,
): TypeError =>
  new TypeError(
    `Frame ${frame} site ${atom_idx} has no finite ${kind} property "${key}" (got ` +
      `${JSON.stringify(value)}); every collected frame must carry every requested channel`,
  )

// A minimum-image unwrap is only meaningful while a one-step displacement stays under half
// a cell, and real MD stays far below that. An unsorted dump instead pairs atom index i
// with an unrelated atom, whose folded separation is uniform over the cell, so 1 - 0.5^3 =
// 87.5% of atoms clear a quarter cell on at least one axis.
const FAR_STEP_FRACTIONAL = 0.25
const MAX_FAR_MOVING_FRACTION = 0.5

// Smallest stride that keeps `n_frames` frames of `n_atoms` atoms inside `max_bytes`,
// counting the extra per-atom channels the caller intends to collect
export function suggest_frame_stride(
  n_frames: number,
  n_atoms: number,
  max_bytes: number = DEFAULT_POSITION_STREAM_MAX_BYTES,
  channels: StreamChannels = NO_CHANNELS,
): number {
  if (n_frames < 1 || n_atoms < 1) return 1
  const frame_bytes = n_atoms * bytes_per_atom_frame(channels)
  const affordable_frames = Math.floor(max_bytes / frame_bytes)
  if (affordable_frames < 1) {
    throw new Error(
      `suggest_frame_stride: a single frame of ${n_atoms} atoms needs ` +
        `${frame_bytes} bytes, over the ${max_bytes} byte budget`,
    )
  }
  return Math.max(1, Math.ceil(n_frames / affordable_frames))
}

const frame_lattice = (frame: TrajectoryFrame): Matrix3x3 | null =>
  `lattice` in frame.structure ? frame.structure.lattice.matrix : null

// Every sweep in this module reports progress as a percentage of a known frame count,
// so each binds the callback and the total once and then just names the stage.
const make_reporter =
  (on_progress: ((progress: ParseProgress) => void) | undefined, total: number) =>
  (done: number, stage: string): void =>
    on_progress?.({ current: (done / total) * 100, total: 100, stage })

// Accumulates frames into one flat Float64Array, checking the invariants MSD-style
// whole-trajectory analyses depend on: constant atom count and stable atom ordering.
// Only one TrajectoryFrame is alive at a time, so a 100k-frame sweep stays bounded.
class PositionAccumulator {
  private readonly positions: Float64Array
  // Same frame-major layout as `positions`: one double per atom for scalars, three for
  // vectors. Empty when the caller requested no channels.
  private readonly scalars: Record<string, Float64Array> = {}
  private readonly vectors: Record<string, Float64Array> = {}
  private readonly lattice_matrices: (Matrix3x3 | null)[] = []
  private readonly steps: number[] = []
  private elements: ElementSymbol[] | null = null
  private pbc: Pbc | null = null
  private coords_unwrapped: boolean | null = null
  private frame_count = 0

  // Frames already collected. Callers report progress against this rather than the source
  // frame number, which advances by frame_stride and would couple the interval to it.
  get collected_frames(): number {
    return this.frame_count
  }

  constructor(
    private readonly n_frames: number,
    private readonly n_atoms: number,
    max_bytes: number = DEFAULT_POSITION_STREAM_MAX_BYTES,
    private readonly frame_stride = 1,
    private readonly channels: StreamChannels = NO_CHANNELS,
  ) {
    if (n_frames < 1) throw new Error(`PositionAccumulator: n_frames must be >= 1`)
    if (n_atoms < 1) throw new Error(`PositionAccumulator: n_atoms must be >= 1`)
    const overlap = channels.scalar_keys.filter((key) => channels.vector_keys.includes(key))
    if (overlap.length > 0) {
      throw new Error(
        `PositionAccumulator: ${overlap.join(`, `)} requested as both a scalar and a ` +
          `vector channel; a site property is one or the other`,
      )
    }
    const needed_bytes = n_frames * n_atoms * bytes_per_atom_frame(channels)
    if (needed_bytes > max_bytes) {
      const stride = suggest_frame_stride(n_frames, n_atoms, max_bytes, channels)
      throw new Error(
        `Collecting ${n_frames} frames x ${n_atoms} atoms needs ${needed_bytes} bytes, ` +
          `over the ${max_bytes} byte budget. Use frame_stride >= ${stride} ` +
          `to sub-sample frames.`,
      )
    }
    this.positions = new Float64Array(n_frames * n_atoms * 3)
    for (const key of channels.scalar_keys) {
      this.scalars[key] = new Float64Array(n_frames * n_atoms)
    }
    for (const key of channels.vector_keys) {
      this.vectors[key] = new Float64Array(n_frames * n_atoms * 3)
    }
  }

  add_frame(frame: TrajectoryFrame, source_frame_number: number): void {
    if (this.frame_count >= this.n_frames) {
      throw new Error(
        `PositionAccumulator: got more than the ${this.n_frames} frames it was sized for`,
      )
    }
    const { sites } = frame.structure
    if (sites.length !== this.n_atoms) {
      throw new Error(
        `Atom count changed at frame ${source_frame_number}: expected ${this.n_atoms} ` +
          `atoms, got ${sites.length}. Displacement analysis needs a constant atom count ` +
          `with stable ordering across every frame.`,
      )
    }

    const first_pass = this.elements === null
    if (first_pass) {
      this.pbc = `lattice` in frame.structure ? frame.structure.lattice.pbc : null
    }
    const elements = (this.elements ??= [])

    const base = this.frame_count * this.n_atoms * 3
    for (let atom_idx = 0; atom_idx < sites.length; atom_idx++) {
      const site = sites[atom_idx]
      const element = site.species[0]?.element
      if (!element) {
        throw new Error(
          `Frame ${source_frame_number} site ${atom_idx} has no species; cannot identify the atom`,
        )
      }
      if (first_pass) elements.push(element)
      else if (elements[atom_idx] !== element) {
        throw new Error(
          `Atom ordering changed at frame ${source_frame_number}: site ${atom_idx} was ` +
            `${elements[atom_idx]} in the first frame but is ${element} here. Displacement ` +
            `analysis tracks atoms by index, so the ordering must be stable. LAMMPS dumps ` +
            `are unsorted unless the run used "dump_modify <id> sort id".`,
        )
      }
      const off = base + atom_idx * 3
      this.positions[off] = site.xyz[0]
      this.positions[off + 1] = site.xyz[1]
      this.positions[off + 2] = site.xyz[2]
      this.add_channels(site.properties, atom_idx, source_frame_number)
    }

    // LAMMPS xu/yu/zu dumps are already unwrapped. A run that flips mid-way would make
    // "unwrap or not" ambiguous for the whole series, so refuse instead of picking one.
    const frame_unwrapped = frame.metadata?.coords_unwrapped === true
    if (this.coords_unwrapped === null) this.coords_unwrapped = frame_unwrapped
    else if (this.coords_unwrapped !== frame_unwrapped) {
      throw new Error(
        `coords_unwrapped flipped to ${frame_unwrapped} at frame ${source_frame_number}; ` +
          `a trajectory must be entirely wrapped or entirely unwrapped`,
      )
    }

    const lattice = frame_lattice(frame)
    this.check_step_plausibility(lattice, source_frame_number)
    this.lattice_matrices.push(lattice)
    this.steps.push(frame.step)
    this.frame_count++
  }

  // Write one site's requested channels. A frame that stops carrying a property mid-sweep
  // throws rather than padding NaN or zero: a channel silently going flat halfway through a
  // trajectory is indistinguishable from real data at the consumer, and this codebase
  // fails early instead. The message names the frame, site and key so the caller can find
  // the frame that dropped the column.
  private add_channels(
    properties: Record<string, unknown> | undefined,
    atom_idx: number,
    source_frame_number: number,
  ): void {
    const scalar_off = this.frame_count * this.n_atoms + atom_idx
    for (const key of this.channels.scalar_keys) {
      const value = properties?.[key]
      if (typeof value !== `number` || !Number.isFinite(value)) {
        throw missing_channel(source_frame_number, atom_idx, `scalar`, key, value)
      }
      this.scalars[key][scalar_off] = value
    }
    for (const key of this.channels.vector_keys) {
      const value = properties?.[key]
      if (
        !Array.isArray(value) ||
        value.length !== 3 ||
        !value.every((comp) => typeof comp === `number` && Number.isFinite(comp))
      ) {
        throw missing_channel(source_frame_number, atom_idx, `vec3`, key, value)
      }
      const off = scalar_off * 3
      this.vectors[key][off] = value[0]
      this.vectors[key][off + 1] = value[1]
      this.vectors[key][off + 2] = value[2]
    }
  }

  // The ordering check above compares element SYMBOLS, so a permutation within a single
  // species — Al/Cu/Si self-diffusion, the core MSD use case — is invisible to it, and the
  // LAMMPS parser discards the `id` column, leaving no per-atom key to sort by. What is
  // still visible is the physics: unrelated atoms sit a cell apart, real MD steps do not.
  private check_step_plausibility(
    lattice: Matrix3x3 | null,
    source_frame_number: number,
  ): void {
    // A lone atom cannot be permuted, and without a cell there is no scale to compare to
    if (!lattice || this.frame_count < 1 || this.n_atoms < 2) return
    // Sub-sampled unwrapped coordinates carry no signal: their displacement is not folded
    // into the cell, so it grows as sqrt(stride) without bound and a clean diffusive run
    // trips the threshold on its own (a 20 A cell at stride 100 is enough). Nothing needs
    // unwrapping here either, so MSD stays exact — the check just has nothing left to say.
    if (this.coords_unwrapped && this.frame_stride > 1) return
    // cart_to_frac is linear, so it maps a Cartesian step straight to a fractional one
    const cart_to_frac = math.create_cart_to_frac(lattice)
    const pbc = this.pbc ?? [true, true, true]
    const prev_base = (this.frame_count - 1) * this.n_atoms * 3
    const base = this.frame_count * this.n_atoms * 3
    let far_atoms = 0
    for (let atom_idx = 0; atom_idx < this.n_atoms; atom_idx++) {
      const [prev_off, off] = [prev_base + atom_idx * 3, base + atom_idx * 3]
      const frac_step = cart_to_frac([
        this.positions[off] - this.positions[prev_off],
        this.positions[off + 1] - this.positions[prev_off + 1],
        this.positions[off + 2] - this.positions[prev_off + 2],
      ])
      // An aperiodic axis is never folded, and already-unwrapped steps are real as given
      const far = ([0, 1, 2] as const).some(
        (axis) =>
          pbc[axis] &&
          Math.abs(
            this.coords_unwrapped
              ? frac_step[axis]
              : frac_step[axis] - Math.round(frac_step[axis]),
          ) > FAR_STEP_FRACTIONAL,
      )
      if (far) far_atoms++
    }
    if (far_atoms <= MAX_FAR_MOVING_FRACTION * this.n_atoms) return
    throw new Error(
      `Frame ${source_frame_number}: ${far_atoms} of ${this.n_atoms} atoms moved more than a ` +
        `quarter of the cell since the previous collected frame. Displacement analysis tracks ` +
        `atoms by index, so either the ordering changed (LAMMPS dumps are unsorted unless the ` +
        `run used "dump_modify <id> sort id", and the id column is not preserved, so a ` +
        `permutation within one species is otherwise undetectable) or the collected frames ` +
        `are too far apart to unwrap. Re-dump sorted, or lower frame_stride.`,
    )
  }

  finish(frame_stride: number): TrajectoryPositionStream {
    if (this.frame_count === 0) throw new Error(`PositionAccumulator: no frames collected`)
    const has_lattice = this.lattice_matrices.some((matrix) => matrix != null)
    // Trim when fewer frames arrived than budgeted (e.g. a truncated payload)
    const trim = (buffer: Float64Array, per_atom: number): Float64Array =>
      this.frame_count === this.n_frames
        ? buffer
        : buffer.slice(0, this.frame_count * this.n_atoms * per_atom)
    const trim_all = (
      buffers: Record<string, Float64Array>,
      per_atom: number,
    ): Record<string, Float64Array> | undefined =>
      Object.keys(buffers).length === 0
        ? undefined
        : Object.fromEntries(
            Object.entries(buffers).map(([key, buffer]) => [key, trim(buffer, per_atom)]),
          )
    return {
      positions: trim(this.positions, 3),
      scalars: trim_all(this.scalars, 1),
      vectors: trim_all(this.vectors, 3),
      n_frames: this.frame_count,
      n_atoms: this.n_atoms,
      elements: this.elements ?? [],
      lattice_matrices: has_lattice ? this.lattice_matrices : null,
      pbc: this.pbc,
      coords_unwrapped: this.coords_unwrapped ?? false,
      frame_stride,
      steps: this.steps,
    }
  }
}

// One sweep over `total_frames` frames, pulling each in turn from `load_frame` and packing
// it into a PositionAccumulator. Shared by the in-memory and streaming collect paths so
// stride handling, budget enforcement and progress reporting have a single implementation.
export async function accumulate_positions(
  total_frames: number,
  load_frame: (
    frame_number: number,
  ) => TrajectoryFrame | null | Promise<TrajectoryFrame | null>,
  options: PositionStreamOptions = {},
  on_progress?: (progress: ParseProgress) => void,
): Promise<TrajectoryPositionStream> {
  const {
    frame_stride = 1,
    max_bytes = DEFAULT_POSITION_STREAM_MAX_BYTES,
    scalar_keys = [],
    vector_keys = [],
  } = options
  const channels: StreamChannels = { scalar_keys, vector_keys }
  if (!Number.isInteger(frame_stride) || frame_stride < 1) {
    throw new Error(
      `accumulate_positions: frame_stride must be a positive integer, got ${frame_stride}`,
    )
  }
  if (total_frames < 1) throw new Error(`accumulate_positions: payload contains no frames`)

  const report = make_reporter(on_progress, total_frames)
  const first_frame = await load_frame(0)
  if (!first_frame) throw new Error(`accumulate_positions: could not read frame 0`)
  const collected = Math.ceil(total_frames / frame_stride)
  const n_atoms = first_frame.structure.sites.length
  const accumulator = new PositionAccumulator(
    collected,
    n_atoms,
    max_bytes,
    frame_stride,
    channels,
  )
  accumulator.add_frame(first_frame, 0)

  for (
    let frame_number = frame_stride;
    frame_number < total_frames;
    frame_number += frame_stride
  ) {
    const frame = await load_frame(frame_number)
    // A null frame means the payload disagrees with the frame count — fail rather than
    // average over a silently shorter series.
    if (!frame) {
      throw new Error(
        `accumulate_positions: frame ${frame_number} of ${total_frames} could not be read`,
      )
    }
    accumulator.add_frame(frame, frame_number)

    if (accumulator.collected_frames % 500 === 0) {
      report(frame_number, `Reading positions: ${frame_number}/${total_frames}`)
    }
  }

  return accumulator.finish(frame_stride)
}

// Restrict frame metadata to the requested property keys (no-op when unset)
const filter_properties = (metadata: TrajectoryMetadata, properties?: string[]): void => {
  if (!properties) return
  metadata.properties = Object.fromEntries(
    Object.entries(metadata.properties).filter(([key]) => properties.includes(key)),
  )
}

export class TrajFrameReader implements FrameLoader {
  private readonly format: `xyz` | `ase`
  private global_numbers?: number[]
  // Split lines + per-frame start indices for the last XYZ payload, so repeat seeks are
  // O(1) lookup instead of re-splitting + rescanning from line 0 (was O(n²) over playback)
  private xyz_cache?: { data: string; lines: string[]; frame_starts: number[] }

  constructor(filename: string) {
    this.format = indexed_trajectory_format(filename)
  }

  async get_total_frames(data: string | ArrayBuffer): Promise<number> {
    if (this.format === `xyz`) {
      if (data instanceof ArrayBuffer) throw new Error(`XYZ loader requires text data`)
      return count_xyz_frames(data)
    }
    if (!(data instanceof ArrayBuffer)) throw new Error(`ASE loader requires binary data`)
    return read_ase_header(new DataView(data)).n_items
  }

  async build_frame_index(
    data: string | ArrayBuffer,
    sample_rate: number,
    on_progress?: (progress: ParseProgress) => void,
  ): Promise<FrameIndex[]> {
    const total_frames = await this.get_total_frames(data)
    const report = make_reporter(on_progress, total_frames)
    const frame_index: FrameIndex[] = []

    if (this.format === `xyz`) {
      const data_str = data as string
      const lines = data_str.trim().split(/\r?\n/)
      const encoder = new TextEncoder()
      const newline_sequence = data_str.includes(`\r\n`) ? `\r\n` : `\n`
      const newline_byte_len = encoder.encode(newline_sequence).length
      const line_bytes = (idx: number): number =>
        encoder.encode(lines[idx]).length + newline_byte_len

      // cursor = next line whose bytes haven't been added to byte_offset yet
      let [current_frame, cursor, byte_offset] = [0, 0, 0]

      for (const { start, num_atoms } of iter_xyz_frames(lines)) {
        if (current_frame >= total_frames) break

        // Accumulate bytes of blank/invalid lines skipped before this frame
        for (; cursor < start; cursor++) byte_offset += line_bytes(cursor)
        let frame_size = 0
        for (; cursor < start + num_atoms + 2; cursor++) frame_size += line_bytes(cursor)

        if (current_frame % sample_rate === 0) {
          frame_index.push({
            frame_number: current_frame,
            byte_offset,
            estimated_size: frame_size,
          })
        }

        byte_offset += frame_size
        current_frame++

        if (current_frame % 1000 === 0) report(current_frame, `Indexing: ${current_frame}`)
      }
    } else {
      const view = new DataView(data as ArrayBuffer)
      const { offsets_pos } = read_ase_header(view)

      for (let idx = 0; idx < total_frames; idx += sample_rate) {
        const frame_offset = Number(view.getBigInt64(offsets_pos + idx * 8, true))
        frame_index.push({
          frame_number: idx,
          byte_offset: frame_offset,
          estimated_size: 0,
        })

        if (idx % 10000 === 0) report(idx, `Indexing ASE: ${idx}`)
      }
    }

    return frame_index
  }

  async load_frame(
    data: string | ArrayBuffer,
    frame_number: number,
  ): Promise<TrajectoryFrame | null> {
    const actual_data_type = data instanceof ArrayBuffer ? `ArrayBuffer` : typeof data

    if (this.format === `xyz`) {
      if (typeof data !== `string`) {
        throw new TypeError(
          `load_frame expected string data for xyz format, received ${actual_data_type}`,
        )
      }
      return this.load_xyz_frame(data, frame_number)
    }
    if (!(data instanceof ArrayBuffer)) {
      throw new TypeError(
        `load_frame expected ArrayBuffer data for ase format, received ${actual_data_type}`,
      )
    }
    return this.load_ase_frame(data, frame_number)
  }

  async extract_plot_metadata(
    data: string | ArrayBuffer,
    options?: { sample_rate?: number; properties?: string[] },
    on_progress?: (progress: ParseProgress) => void,
  ): Promise<TrajectoryMetadata[]> {
    const { sample_rate = 1, properties } = options ?? {}
    const metadata_list: TrajectoryMetadata[] = []
    const total_frames = await this.get_total_frames(data)
    const report = make_reporter(on_progress, total_frames)

    if (this.format === `xyz`) {
      const lines = (data as string).trim().split(/\r?\n/)
      let current_frame = 0

      for (const { comment } of iter_xyz_frames(lines)) {
        if (current_frame >= total_frames) break

        if (current_frame % sample_rate === 0) {
          // parse_xyz_comment_metadata is pure regex/parseFloat and never throws
          const { step, properties: props } = parse_xyz_comment_metadata(comment)
          const frame_metadata: TrajectoryMetadata = {
            frame_number: current_frame,
            step: step ?? current_frame,
            properties: props,
          }
          filter_properties(frame_metadata, properties)
          metadata_list.push(frame_metadata)
        }

        current_frame++

        if (current_frame % 5000 === 0) report(current_frame, `Extracting: ${current_frame}`)
      }
    } else if (this.format === `ase`) {
      const view = new DataView(data as ArrayBuffer)
      const { n_items, offsets_pos } = read_ase_header(view)

      for (let idx = 0; idx < n_items; idx += sample_rate) {
        try {
          const frame_offset = Number(view.getBigInt64(offsets_pos + idx * 8, true))
          const json_length = Number(view.getBigInt64(frame_offset, true))

          if (json_length > MAX_METADATA_SIZE) {
            console.warn(
              `Skipping large frame ${idx}: ${Math.round(json_length / 1024 / 1024)}MB`,
            )
            continue
          }

          const frame_data = JSON.parse(
            new TextDecoder().decode(
              new Uint8Array(data as ArrayBuffer, frame_offset + 8, json_length),
            ),
          )

          const frame_metadata = this.parse_ase_metadata(frame_data, idx)
          filter_properties(frame_metadata, properties)
          metadata_list.push(frame_metadata)

          // total_frames is read_ase_header(...).n_items, so the bound total matches
          if (idx % 5000 === 0) report(idx, `Extracting ASE: ${idx}/${n_items}`)
        } catch (error) {
          console.warn(`Failed to extract metadata from ASE frame ${idx}:`, error)
        }
      }
    }

    return metadata_list
  }

  // Single sequential sweep of the payload emitting flat positions. Sequential XYZ seeks
  // hit the memoised line/offset cache and ASE seeks go through the header offsets table,
  // so a full pass is O(1) per frame. Frames are decoded one at a time and dropped, so
  // memory is bounded by the position buffer rather than by n_frames frame objects.
  async stream_positions(
    data: string | ArrayBuffer,
    options?: PositionStreamOptions,
    on_progress?: (progress: ParseProgress) => void,
  ): Promise<TrajectoryPositionStream> {
    const total_frames = await this.get_total_frames(data)
    const load = (frame_number: number) => this.load_frame(data, frame_number)
    return accumulate_positions(total_frames, load, options, on_progress)
  }

  // Build + cache the line array and per-frame start indices once per payload
  private get_xyz_cache(data: string): { lines: string[]; frame_starts: number[] } {
    if (this.xyz_cache?.data === data) return this.xyz_cache
    const lines = data.trim().split(/\r?\n/)
    const frame_starts = Array.from(iter_xyz_frames(lines), ({ start }) => start)
    this.xyz_cache = { data, lines, frame_starts }
    return this.xyz_cache
  }

  private load_xyz_frame(data: string, frame_number: number): TrajectoryFrame | null {
    const { lines, frame_starts } = this.get_xyz_cache(data)
    const start = frame_starts[frame_number]
    if (start === undefined) return null // out-of-range frame

    const num_atoms = Math.trunc(Number(lines[start]?.trim()))
    const comment = lines[start + 1] ?? ``
    return build_xyz_frame(
      lines,
      { start, num_atoms, comment },
      {
        frame_label: `indexed frame ${frame_number}`,
        default_step: frame_number,
      },
    )
  }

  private load_ase_frame(data: ArrayBuffer, frame_number: number): TrajectoryFrame | null {
    try {
      const view = new DataView(data)
      const { n_items, offsets_pos } = read_ase_header(view)

      if (frame_number >= n_items) return null

      const frame_offset = Number(view.getBigInt64(offsets_pos + frame_number * 8, true))
      const { frame, numbers } = decode_ase_frame(view, data, frame_offset, frame_number, {
        fallback_numbers: this.global_numbers,
      })
      this.global_numbers = numbers
      return frame
    } catch (error) {
      console.warn(`Failed to load ASE frame ${frame_number}:`, error)
      return null
    }
  }

  private parse_ase_metadata(
    frame_data: Record<string, unknown>,
    frame_number: number,
  ): TrajectoryMetadata {
    const properties: Record<string, number> = {}
    const step = frame_number

    // ASE puts computed results in the calculator and user-set values in `info`, but
    // which scalar lands where is up to whoever wrote the file, so both sections get
    // every alias. Reading one from a single section drops it from the other exactly
    // as silently as the dotted-key bug did.
    for (const section of [ase_calculator_data(frame_data), frame_data.info]) {
      if (!section || typeof section !== `object`) continue
      copy_numeric_fields(properties, section as Record<string, unknown>, [
        `energy`,
        `potential_energy`,
        `kinetic_energy`,
        `total_energy`,
        `force_max`,
        `force_norm`,
        `stress_max`,
        `stress_frobenius`,
        `pressure`,
        `temperature`,
        `bandgap`,
      ])
    }

    if (frame_data.cell && Array.isArray(frame_data.cell)) {
      try {
        const validated_cell = validate_3x3_matrix(frame_data.cell)
        properties.volume = Math.abs(math.det_3x3(validated_cell))
      } catch (error) {
        console.warn(`Failed to calculate volume for ASE frame ${frame_number}:`, error)
      }
    }

    return { frame_number, step, properties }
  }
}
