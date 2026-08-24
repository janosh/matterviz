// In-memory run: every frame materialised. Built by the eager parsers, from JSON payloads
// (anywidget / JupyterLab), by PhononModeExplorer and by tests.
import { first_non_increasing_index } from '$lib/math'
import { full_data_extractor } from '../extract'
import { is_supported_trajectory_signal_shape } from '../helpers'
import type {
  TrajectoryDataExtractor,
  TrajectoryFrame,
  TrajectoryMetadata,
  TrajectorySignal,
} from '../index'
import {
  assert_frame_idx,
  disposed_error,
  TrajectoryProperties,
  type TrajectoryProvenance,
  type TrajectoryRun,
} from '../run'
import { accumulate_positions } from './accumulate'

export interface MemoryRunExtras {
  provenance?: TrajectoryProvenance
  metadata?: Record<string, unknown>
  time_step?: { value: number; unit: string }
  atom_masses?: readonly number[]
  signals?: Record<string, TrajectorySignal>
  warnings?: readonly string[]
  // Pre-extracted per-frame rows; otherwise `data_extractor` runs over every frame
  properties?: TrajectoryMetadata[]
  data_extractor?: TrajectoryDataExtractor
}

const is_finite_number = (value: unknown): value is number =>
  typeof value === `number` && Number.isFinite(value)

// Structural invariants every consumer relies on: at least one frame, a constant atom count,
// finite steps and coordinates, masses and signals that match the atoms.
function validate_frames(
  frames: readonly TrajectoryFrame[],
  extras: Pick<MemoryRunExtras, `atom_masses` | `signals`> = {},
): void {
  if (frames.length === 0) throw new Error(`Trajectory must have at least one frame`)
  const reference = frames[0].structure?.sites
  if (!reference?.length) throw new Error(`Frame 0 has no sites`)
  const n_atoms = reference.length
  for (const [frame_idx, frame] of frames.entries()) {
    if (!is_finite_number(frame.step)) {
      throw new TypeError(`Frame ${frame_idx} has invalid step ${frame.step}`)
    }
    const sites = frame.structure?.sites
    if (sites?.length !== n_atoms) {
      throw new Error(
        `Frame ${frame_idx} has ${sites?.length ?? 0} atoms, expected ${n_atoms}`,
      )
    }
    for (const [atom_idx, site] of sites.entries()) {
      if (site.xyz.length !== 3 || !site.xyz.every(is_finite_number)) {
        throw new Error(
          `Frame ${frame_idx} atom ${atom_idx} has invalid Cartesian coordinates`,
        )
      }
    }
    if (
      `lattice` in frame.structure &&
      !frame.structure.lattice.matrix.flat().every(is_finite_number)
    ) {
      throw new Error(`Frame ${frame_idx} has an invalid lattice`)
    }
  }
  const { atom_masses, signals } = extras
  if (atom_masses !== undefined) {
    if (atom_masses.length !== n_atoms) {
      throw new Error(`atom_masses has ${atom_masses.length} entries for ${n_atoms} atoms`)
    }
    const bad_idx = atom_masses.findIndex((mass) => !is_finite_number(mass) || mass <= 0)
    if (bad_idx !== -1) {
      throw new Error(
        `atom_masses[${bad_idx}] must be finite and > 0, got ${atom_masses[bad_idx]}`,
      )
    }
  }
  for (const [key, signal] of Object.entries(signals ?? {})) {
    const { sample_shape, values, steps, unit } = signal
    if (!is_supported_trajectory_signal_shape(sample_shape, n_atoms)) {
      throw new Error(
        `signals.${key}.sample_shape must be scalar, [3], [3, 3], [n_atoms], or [n_atoms, 3], ` +
          `got ${JSON.stringify(sample_shape)}`,
      )
    }
    const sample_size = sample_shape.reduce((total, size) => total * size, 1)
    if (!(values instanceof Float64Array) || values.length !== steps.length * sample_size) {
      throw new Error(
        `signals.${key} needs a Float64Array of ${steps.length * sample_size} values for ` +
          `${steps.length} samples of shape [${sample_shape.join(`, `)}]`,
      )
    }
    if (!values.every(Number.isFinite))
      throw new Error(`signals.${key}.values are not all finite`)
    if (!steps.every(is_finite_number) || first_non_increasing_index(steps) !== null) {
      throw new Error(`signals.${key}.steps must be finite and strictly increasing`)
    }
    if (unit !== undefined && (typeof unit !== `string` || !unit.trim())) {
      throw new Error(`signals.${key}.unit must be a non-empty string when supplied`)
    }
  }
}

const rows_from_frames = (
  frames: readonly TrajectoryFrame[],
  data_extractor: TrajectoryDataExtractor = full_data_extractor,
): TrajectoryMetadata[] =>
  frames.map((frame, frame_idx) => ({
    frame_number: frame_idx,
    step: frame.step,
    properties: data_extractor(frame),
  }))

export function trajectory_from_frames(
  frames: TrajectoryFrame[],
  extras: MemoryRunExtras = {},
): TrajectoryRun {
  validate_frames(frames, extras)
  return trajectory_from_frame_source(frames.length, (frame_idx) => frames[frame_idx], {
    ...extras,
    properties: extras.properties ?? rows_from_frames(frames, extras.data_extractor),
  })
}

// Synchronous frame source that is not materialised up front (phonon mode animation builds
// each frame from a displacement pattern on read). Nothing is validated here: the caller
// guarantees a constant site count and supplies the property rows.
export function trajectory_from_frame_source(
  frame_count: number,
  read: (frame_idx: number) => TrajectoryFrame,
  extras: Omit<MemoryRunExtras, `data_extractor`> & { properties: TrajectoryMetadata[] },
): TrajectoryRun {
  if (!Number.isInteger(frame_count) || frame_count < 1) {
    throw new Error(`Trajectory must have at least one frame, got ${frame_count}`)
  }
  const {
    provenance = {},
    metadata = {},
    warnings = [],
    time_step,
    atom_masses,
    signals,
    properties,
  } = extras
  if (
    time_step &&
    !(Number.isFinite(time_step.value) && time_step.value > 0 && time_step.unit)
  ) {
    throw new Error(
      `time_step needs a positive value and a unit, got ${JSON.stringify(time_step)}`,
    )
  }
  let disposed = false
  const live = (): void => {
    if (disposed) throw disposed_error(`In-memory trajectory`)
  }
  const preview = read(0)
  return {
    frame_count,
    preview,
    provenance,
    properties: new TrajectoryProperties(properties, true),
    time_step,
    atom_masses,
    signals,
    metadata,
    warnings,
    read_frame: (frame_idx) => {
      live()
      assert_frame_idx({ frame_count }, frame_idx)
      return frame_idx === 0 ? preview : read(frame_idx)
    },
    collect_positions: async (options) => {
      live()
      return accumulate_positions(frame_count, read, options)
    },
    dispose: () => {
      disposed = true
    },
  }
}
