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
  const {
    provenance = {},
    metadata = {},
    warnings = [],
    time_step,
    atom_masses,
    signals,
  } = extras
  let disposed = false
  const live_frames = (): TrajectoryFrame[] => {
    if (disposed) throw disposed_error(`In-memory trajectory`)
    return frames
  }
  return {
    frame_count: frames.length,
    preview: frames[0],
    provenance,
    properties: new TrajectoryProperties(
      extras.properties ?? rows_from_frames(frames, extras.data_extractor),
      true,
    ),
    ...(time_step ? { time_step } : {}),
    ...(atom_masses ? { atom_masses } : {}),
    ...(signals ? { signals } : {}),
    metadata,
    warnings,
    read_frame: (frame_idx) => {
      const all = live_frames()
      assert_frame_idx({ frame_count: all.length }, frame_idx)
      return all[frame_idx]
    },
    collect_positions: async (options) => {
      const all = live_frames()
      return accumulate_positions(all.length, (idx) => all[idx], options)
    },
    dispose: () => {
      disposed = true
    },
  }
}
