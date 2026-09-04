// Frame-major position accumulation shared by every run that reads frames one at a time
// (memory, indexed text, worker-served). Budgets the buffer up front, validates atom identity
// across frames and folds optional per-site channels and frame-level signals into the sweep.
import type { ElementSymbol } from '$lib/element'
import { type Matrix3x3, reciprocal_lattice } from '$lib/math'
import type { Pbc } from '$lib/structure/index'
import { values_per_sample } from '../helpers'
import type {
  CollectPositionsOptions,
  FrameRange,
  ParseProgress,
  TrajectoryFrame,
  TrajectoryPositionStream,
  TrajectorySignal,
} from '../index'

export const DEFAULT_POSITION_STREAM_MAX_BYTES = 512 * 1024 * 1024

type StreamChannels = {
  vector_keys: string[]
  signal_keys: string[]
}
const NO_CHANNELS: StreamChannels = { vector_keys: [], signal_keys: [] }

const bytes_per_frame = (
  n_atoms: number,
  channels: StreamChannels,
  signal_values_per_frame = Math.max(9, 3 * n_atoms) * channels.signal_keys.length,
): number =>
  (n_atoms * (3 + 3 * channels.vector_keys.length) + signal_values_per_frame) *
  Float64Array.BYTES_PER_ELEMENT

const suggested_stride = (
  n_frames: number,
  frame_bytes: number,
  max_bytes: number,
  frame_label = `a single frame`,
): number => {
  if (!(max_bytes > 0)) {
    throw new Error(`max_bytes must be positive, got ${max_bytes}`)
  }
  if (max_bytes === Number.POSITIVE_INFINITY) return 1
  const affordable_frames = Math.floor(max_bytes / frame_bytes)
  if (affordable_frames < 1) {
    throw new Error(
      `${frame_label} needs ${frame_bytes} bytes, over the ${max_bytes} byte budget`,
    )
  }
  return Math.max(1, Math.ceil(n_frames / affordable_frames))
}

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

export function suggest_frame_stride(
  n_frames: number,
  n_atoms: number,
  max_bytes: number = DEFAULT_POSITION_STREAM_MAX_BYTES,
  channels: StreamChannels = NO_CHANNELS,
): number {
  if (n_frames < 1 || n_atoms < 1) return 1
  return suggested_stride(
    n_frames,
    bytes_per_frame(n_atoms, channels),
    max_bytes,
    `suggest_frame_stride: a single frame of ${n_atoms} atoms`,
  )
}

const frame_lattice = (frame: TrajectoryFrame): Matrix3x3 | null =>
  `lattice` in frame.structure ? frame.structure.lattice.matrix : null

const make_reporter =
  (on_progress: ((progress: ParseProgress) => void) | undefined, total: number) =>
  (done: number, stage: string): void =>
    on_progress?.({ current: (done / total) * 100, total: 100, stage })

class PositionAccumulator {
  private readonly positions: Float64Array
  private readonly vectors: Record<string, Float64Array> = {}
  private readonly signal_values: Record<string, Float64Array> = {}
  private readonly lattice_matrices: (Matrix3x3 | null)[] = []
  private readonly steps: number[] = []
  private readonly elements: ElementSymbol[] = []
  // Per-site `id` property of the first frame (LAMMPS dumps sorted by atom ID); null when the
  // format carries none. Catches a GCMC/deposition frame that swapped atoms without changing
  // the count, which the element check alone cannot see.
  private atom_ids: (number | null)[] | null = null
  private pbc: Pbc | null = null
  private coords_unwrapped = false
  private frame_count = 0
  // Reciprocal rows of the last lattice seen (frac_i = b_i · cart); a fixed cell hands back
  // the same matrix every frame, so only NPT runs rebuild the inverse
  private cached_lattice: Matrix3x3 | null = null
  private reciprocal: Matrix3x3 | null = null

  get collected_frames(): number {
    return this.frame_count
  }

  constructor(
    private readonly n_frames: number,
    private readonly n_atoms: number,
    max_bytes: number = DEFAULT_POSITION_STREAM_MAX_BYTES,
    private readonly frame_stride = 1,
    private readonly channels: StreamChannels = NO_CHANNELS,
    private readonly signal_shapes: Record<string, number[]> = {},
  ) {
    if (n_frames < 1) throw new Error(`PositionAccumulator: n_frames must be >= 1`)
    if (n_atoms < 1) throw new Error(`PositionAccumulator: n_atoms must be >= 1`)
    const signal_values_per_frame = Object.values(signal_shapes).reduce(
      (total, sample_shape) => total + values_per_sample(sample_shape),
      0,
    )
    const frame_bytes = bytes_per_frame(n_atoms, channels, signal_values_per_frame)
    const needed_bytes = n_frames * frame_bytes
    if (needed_bytes > max_bytes) {
      const stride = suggested_stride(n_frames, frame_bytes, max_bytes)
      throw new Error(
        `Collecting ${n_frames} frames x ${n_atoms} atoms needs ${needed_bytes} bytes, ` +
          `over the ${max_bytes} byte budget. Use frame_stride >= ${stride} ` +
          `to sub-sample frames.`,
      )
    }
    this.positions = new Float64Array(n_frames * n_atoms * 3)
    for (const key of channels.vector_keys) {
      this.vectors[key] = new Float64Array(n_frames * n_atoms * 3)
    }
    for (const key of channels.signal_keys) {
      const sample_shape = signal_shapes[key]
      if (!sample_shape) {
        throw new Error(`PositionAccumulator: signal "${key}" has no initial shape`)
      }
      this.signal_values[key] = new Float64Array(n_frames * values_per_sample(sample_shape))
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

    const is_first_frame = this.frame_count === 0
    if (is_first_frame) {
      this.pbc = `lattice` in frame.structure ? frame.structure.lattice.pbc : null
    }

    const base = this.frame_count * this.n_atoms * 3
    for (let atom_idx = 0; atom_idx < sites.length; atom_idx++) {
      const site = sites[atom_idx]
      const element = site.species[0]?.element
      if (!element) {
        throw new Error(
          `Frame ${source_frame_number} site ${atom_idx} has no species; cannot identify the atom`,
        )
      }
      const atom_id = site.properties?.id
      const id = typeof atom_id === `number` ? atom_id : null
      if (is_first_frame) {
        this.elements.push(element)
        if (atom_idx === 0) this.atom_ids = id === null ? null : []
        this.atom_ids?.push(id)
      } else if (this.elements[atom_idx] !== element) {
        throw new Error(
          `Atom ordering changed at frame ${source_frame_number}: site ${atom_idx} was ` +
            `${this.elements[atom_idx]} in the first frame but is ${element} here. Displacement ` +
            `analysis tracks atoms by index, so the ordering must be stable. LAMMPS dumps ` +
            `are unsorted unless the run used "dump_modify <id> sort id".`,
        )
      } else if (this.atom_ids && this.atom_ids[atom_idx] !== id) {
        throw new Error(
          `Atom identity changed at frame ${source_frame_number}: site ${atom_idx} had ` +
            `atom ID ${this.atom_ids[atom_idx]} in the first frame but ${id} here. The atom ` +
            `set changed (GCMC, deposition), so displacement analysis cannot pair atoms ` +
            `across frames.`,
        )
      }
      const off = base + atom_idx * 3
      this.positions[off] = site.xyz[0]
      this.positions[off + 1] = site.xyz[1]
      this.positions[off + 2] = site.xyz[2]
      this.add_channels(site.properties, atom_idx, source_frame_number)
    }
    this.add_signals(frame.metadata, source_frame_number)

    const frame_unwrapped = frame.metadata?.coords_unwrapped === true
    if (is_first_frame) this.coords_unwrapped = frame_unwrapped
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

  private add_signals(
    metadata: Record<string, unknown> | undefined,
    source_frame_number: number,
  ): void {
    for (const key of this.channels.signal_keys) {
      const parsed = parse_frame_signal(metadata?.[key], key, this.n_atoms)
      if (!parsed) {
        throw new TypeError(
          `Frame ${source_frame_number} has no supported finite numeric metadata ` +
            `signal "${key}" (got ${JSON.stringify(metadata?.[key])})`,
        )
      }
      const expected_shape = this.signal_shapes[key]
      if (expected_shape.join(`,`) !== parsed.sample_shape.join(`,`)) {
        throw new Error(
          `Frame ${source_frame_number} signal "${key}" changed shape from ` +
            `[${expected_shape.join(`, `)}] to [${parsed.sample_shape.join(`, `)}]`,
        )
      }
      this.signal_values[key].set(parsed.values, this.frame_count * parsed.values.length)
    }
  }

  private add_channels(
    properties: Record<string, unknown> | undefined,
    atom_idx: number,
    source_frame_number: number,
  ): void {
    for (const key of this.channels.vector_keys) {
      const value = properties?.[key]
      if (
        !Array.isArray(value) ||
        value.length !== 3 ||
        !value.every((comp) => typeof comp === `number` && Number.isFinite(comp))
      ) {
        throw missing_channel(source_frame_number, atom_idx, `vec3`, key, value)
      }
      const off = (this.frame_count * this.n_atoms + atom_idx) * 3
      this.vectors[key][off] = value[0]
      this.vectors[key][off + 1] = value[1]
      this.vectors[key][off + 2] = value[2]
    }
  }

  private check_step_plausibility(
    lattice: Matrix3x3 | null,
    source_frame_number: number,
  ): void {
    if (!lattice || this.frame_count < 1 || this.n_atoms < 2) return
    // A stride weakens the displacement bound for already-unwrapped coordinates.
    if (this.coords_unwrapped && this.frame_stride > 1) return
    if (lattice !== this.cached_lattice || !this.reciprocal) {
      this.cached_lattice = lattice
      this.reciprocal = reciprocal_lattice(lattice)
    }
    // Scalar arithmetic throughout: this runs per atom per frame, so no Vec3 is allocated
    const { reciprocal, positions } = this
    const pbc = this.pbc ?? [true, true, true]
    const prev_base = (this.frame_count - 1) * this.n_atoms * 3
    const base = this.frame_count * this.n_atoms * 3
    let far_atoms = 0
    for (let atom_idx = 0; atom_idx < this.n_atoms; atom_idx++) {
      const prev_off = prev_base + atom_idx * 3
      const off = base + atom_idx * 3
      const step_x = positions[off] - positions[prev_off]
      const step_y = positions[off + 1] - positions[prev_off + 1]
      const step_z = positions[off + 2] - positions[prev_off + 2]
      let far = false
      for (let axis = 0; axis < 3 && !far; axis++) {
        if (!pbc[axis]) continue
        const [b_x, b_y, b_z] = reciprocal[axis]
        const frac = b_x * step_x + b_y * step_y + b_z * step_z
        const component = this.coords_unwrapped ? frac : frac - Math.round(frac)
        far = Math.abs(component) > FAR_STEP_FRACTIONAL
      }
      if (far) far_atoms++
    }
    if (far_atoms <= MAX_FAR_MOVING_FRACTION * this.n_atoms) return
    throw new Error(
      `Frame ${source_frame_number}: ${far_atoms} of ${this.n_atoms} atoms moved more than a ` +
        `quarter of the cell since the previous collected frame. Displacement analysis tracks ` +
        `atoms by index, so either the ordering changed (LAMMPS dumps are unsorted unless the ` +
        `run used "dump_modify <id> sort id"; preserved IDs are not checked here) or collected ` +
        `frames are too far apart to unwrap. Re-dump sorted, or lower frame_stride.`,
    )
  }

  finish(): TrajectoryPositionStream {
    if (this.frame_count === 0) throw new Error(`PositionAccumulator: no frames collected`)
    const has_lattice = this.lattice_matrices.some((matrix) => matrix != null)
    const trim = (buffer: Float64Array, values_per_frame: number): Float64Array =>
      this.frame_count === this.n_frames
        ? buffer
        : buffer.slice(0, this.frame_count * values_per_frame)
    const vectors = Object.fromEntries(
      Object.entries(this.vectors).map(([key, buffer]) => [
        key,
        trim(buffer, this.n_atoms * 3),
      ]),
    )
    const signals = Object.fromEntries(
      Object.entries(this.signal_values).map(([key, values]) => {
        const sample_shape = this.signal_shapes[key]
        const sample_size = values_per_sample(sample_shape)
        return [
          key,
          {
            values: trim(values, sample_size),
            sample_shape,
            steps: [...this.steps],
          } satisfies TrajectorySignal,
        ]
      }),
    )
    return {
      positions: trim(this.positions, this.n_atoms * 3),
      vectors: Object.keys(vectors).length > 0 ? vectors : undefined,
      signals: Object.keys(signals).length > 0 ? signals : undefined,
      n_frames: this.frame_count,
      n_atoms: this.n_atoms,
      elements: this.elements,
      lattice_matrices: has_lattice ? this.lattice_matrices : null,
      pbc: this.pbc,
      coords_unwrapped: this.coords_unwrapped,
      frame_stride: this.frame_stride,
      steps: this.steps,
    }
  }
}

export const parse_frame_signal = (
  value: unknown,
  key: string,
  n_atoms: number,
): { values: number[]; sample_shape: number[] } | null => {
  if (typeof value === `number` && Number.isFinite(value)) {
    return { values: [value], sample_shape: [] }
  }
  const flat_values = ArrayBuffer.isView(value)
    ? Array.from(value as unknown as ArrayLike<number>)
    : Array.isArray(value) && value.every((entry) => typeof entry === `number`)
      ? value
      : null
  const tensor_key = /polarizability|tensor/i.test(key)
  const response_key = /dipole|polarization|current/i.test(key)
  const per_atom_key = /mass|charge|atom|site/i.test(key)
  if (flat_values) {
    const values = flat_values
    if (!values.every(Number.isFinite)) return null
    if (values.length === 9 && (n_atoms !== 3 || tensor_key)) {
      return { values, sample_shape: [3, 3] }
    }
    if (values.length === n_atoms * 3 && !response_key) {
      return { values, sample_shape: [n_atoms, 3] }
    }
    if (values.length === n_atoms && (values.length !== 3 || per_atom_key)) {
      return { values, sample_shape: [n_atoms] }
    }
    return values.length === 3 ? { values, sample_shape: [3] } : null
  }
  if (!Array.isArray(value)) return null
  const vector_rows = value.every(
    (row) =>
      Array.isArray(row) &&
      row.length === 3 &&
      row.every((entry) => typeof entry === `number` && Number.isFinite(entry)),
  )
  if (!vector_rows) return null
  if (value.length === 3 && (n_atoms !== 3 || tensor_key)) {
    return { values: (value as number[][]).flat(), sample_shape: [3, 3] }
  }
  if (value.length === n_atoms) {
    return {
      values: (value as number[][]).flat(),
      sample_shape: [n_atoms, 3],
    }
  }
  return null
}

export function resolve_frame_range(
  total_frames: number,
  { start_frame = 0, end_frame = total_frames }: FrameRange = {},
): { start_frame: number; end_frame: number } {
  if (
    !Number.isInteger(start_frame) ||
    !Number.isInteger(end_frame) ||
    start_frame < 0 ||
    end_frame > total_frames ||
    start_frame >= end_frame
  ) {
    throw new Error(
      `Frame range [${start_frame}, ${end_frame}) must be nonempty and inside [0, ${total_frames})`,
    )
  }
  return { start_frame, end_frame }
}

export async function accumulate_positions(
  total_frames: number,
  load_frame: (
    frame_number: number,
  ) => TrajectoryFrame | null | Promise<TrajectoryFrame | null>,
  options: CollectPositionsOptions = {},
): Promise<TrajectoryPositionStream> {
  const {
    frame_stride = 1,
    max_bytes = DEFAULT_POSITION_STREAM_MAX_BYTES,
    vector_keys = [],
    signal_keys = [],
    on_progress,
    signal,
  } = options
  signal?.throwIfAborted()
  const channels: StreamChannels = {
    vector_keys: [...new Set(vector_keys)],
    signal_keys: [...new Set(signal_keys)],
  }
  if (!Number.isInteger(frame_stride) || frame_stride < 1) {
    throw new Error(
      `accumulate_positions: frame_stride must be a positive integer, got ${frame_stride}`,
    )
  }
  if (total_frames < 1) throw new Error(`accumulate_positions: payload contains no frames`)

  const { start_frame, end_frame } = resolve_frame_range(total_frames, options)
  const selected_frames = end_frame - start_frame
  const report = make_reporter(on_progress, selected_frames)
  const first_frame = await load_frame(start_frame)
  signal?.throwIfAborted()
  if (!first_frame)
    throw new Error(`accumulate_positions: could not read frame ${start_frame}`)
  const collected = Math.ceil(selected_frames / frame_stride)
  const n_atoms = first_frame.structure.sites.length
  const signal_shapes = Object.fromEntries(
    channels.signal_keys.map((key) => {
      const parsed = parse_frame_signal(first_frame.metadata?.[key], key, n_atoms)
      if (!parsed) {
        throw new TypeError(
          `Frame ${start_frame} has no supported finite numeric metadata signal "${key}" (got ` +
            `${JSON.stringify(first_frame.metadata?.[key])})`,
        )
      }
      return [key, parsed.sample_shape]
    }),
  )
  const accumulator = new PositionAccumulator(
    collected,
    n_atoms,
    max_bytes,
    frame_stride,
    channels,
    signal_shapes,
  )
  accumulator.add_frame(first_frame, start_frame)

  for (
    let frame_number = start_frame + frame_stride;
    frame_number < end_frame;
    frame_number += frame_stride
  ) {
    signal?.throwIfAborted()
    const frame = await load_frame(frame_number)
    if (!frame) {
      throw new Error(
        `accumulate_positions: frame ${frame_number} of ${total_frames} could not be read`,
      )
    }
    signal?.throwIfAborted()
    accumulator.add_frame(frame, frame_number)

    if (accumulator.collected_frames % 500 === 0) {
      report(
        frame_number - start_frame,
        `Reading positions: ${frame_number - start_frame}/${selected_frames}`,
      )
    }
  }

  return accumulator.finish()
}
