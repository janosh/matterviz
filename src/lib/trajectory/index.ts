// Utility functions for working with trajectory data
import type { ComponentProps } from 'svelte'
import type { ElementSymbol } from '$lib/element'
import type { FileLoadData } from '$lib/io/types'
import type { Matrix3x3 } from '$lib/math'
import type { AnyStructure, Pbc } from '$lib/structure/index'
import type Trajectory from './Trajectory.svelte'
import { is_supported_trajectory_signal_shape } from './helpers'

export * from './analysis'
export { default as Trajectory } from './Trajectory.svelte'
export { default as TrajectoryDataInspectorPane } from './TrajectoryDataInspectorPane.svelte'
export { default as TrajectoryError } from './TrajectoryError.svelte'
export { default as TrajectoryExportPane } from './TrajectoryExportPane.svelte'
export { default as TrajectoryInfoPane } from './TrajectoryInfoPane.svelte'
export {
  energy_data_extractor,
  force_stress_data_extractor,
  full_data_extractor,
  structural_data_extractor,
} from './extract'
export {
  collect_frame_property_rows,
  create_poscar_frame_range_zip,
  frame_rows_to_csv,
  frame_rows_to_json,
  serialize_extxyz_frame_range,
} from './file-export'
export type {
  TrajectoryFrameResolver,
  TrajectoryPropertyRow,
  TrajectoryPropertyTable,
} from './file-export'
export {
  available_x_quantities,
  build_x_map,
  FRAME_X_MAP,
  generate_axis_labels,
  generate_axis_scale_types,
  generate_plot_series,
  generate_streaming_plot_series,
  get_frame_step_samples,
  get_frame_time_step,
  should_hide_plot,
  X_QUANTITY_LABELS,
} from './plotting'
export type {
  FrameStepSamples,
  PlotSeriesOptions,
  TrajectoryXMap,
  TrajectoryXQuantity,
} from './plotting'

export type TrajectoryFormat = `hdf5` | `json` | `xyz` | `xdatcar` | `traj` | `unknown`

// Tabs of TrajectoryDataInspectorPane: per-frame scalars vs per-atom rows
export type TrajectoryInspectorTab = `frames` | `atoms`
export type { AtomTypeMapping } from './types'

// Splitting side by side halves the width but keeps the full height, so the
// panes come out twice as tall relative to their width as the container is.
// A nearly square container therefore yields tall narrow panes, which a
// step-series plot reads badly in - a ~900x800 viewer gave the plot 450x800.
// Only split side by side while that leaves panes no more than this much
// taller than they are wide.
const MAX_PANE_TALLNESS = 1.4

// Smallest pane the structure viewer and the plot both stay readable in: a
// scatter spends ~80px on its y-axis label and tick labels and its legend needs
// ~10em on top of that, and below ~180px of height the x-axis labels eat the
// data area the same way.
const MIN_PANE_SIZE = { width: 320, height: 180 }

// Which way to split a container into two equal panes. Absolute size comes
// first: when only one of the two splits clears MIN_PANE_SIZE, that one wins
// regardless of shape, which is what stacks a 490x500 chat sidebar card whose
// 245px-wide panes would leave a plot no room for its axes. When both fit (or
// neither does), pane shape decides.
export function pick_pane_orientation(
  width: number,
  height: number,
): `horizontal` | `vertical` {
  const side_by_side_fits = width / 2 >= MIN_PANE_SIZE.width
  const stacked_fits = height / 2 >= MIN_PANE_SIZE.height
  if (side_by_side_fits && !stacked_fits) return `horizontal`
  if (stacked_fits && !side_by_side_fits) return `vertical`
  // a side-by-side pane is half the width and the container's full height
  return height <= (width / 2) * MAX_PANE_TALLNESS ? `horizontal` : `vertical`
}

// Core trajectory types
export interface ParseProgress {
  current: number
  total: number
  stage: string
}

export interface TrajectoryFrame {
  structure: AnyStructure
  // MD/ionic step recorded in the file. A LAMMPS dump written every 500 steps counts
  // 0, 500, 1000, … so this is NOT the frame's position in the trajectory.
  step: number
  metadata?: Record<string, unknown>
}

export interface FrameIndex {
  frame_number: number
  byte_offset: number
  estimated_size: number
}

export interface TrajectoryMetadata {
  frame_number: number
  step: number
  properties: Record<string, number>
}

// Contiguous samples with an independent MD-step axis.
export interface TrajectorySignal {
  values: Float64Array
  sample_shape: number[]
  steps: number[]
  unit?: string
}

// Transferable backing store for source-free, on-demand frames.
export interface TrajectoryFrameStore {
  positions: Float64Array
  elements: ElementSymbol[]
  // One static cell or flattened per-frame cells.
  lattice_matrix?: Matrix3x3
  lattice_matrices?: Float64Array
  pbc?: Pbc
  pbc_frames?: Pbc[]
  coords_unwrapped: boolean
  steps: number[]
  metadata: Record<string, unknown>[]
  plot_metadata: TrajectoryMetadata[]
  scalars?: Record<string, Float64Array>
  vectors?: Record<string, Float64Array>
  signals?: Record<string, TrajectorySignal>
}

// Trajectory type with streaming support
export interface TrajectoryType {
  frames: TrajectoryFrame[]
  metadata?: Record<string, unknown>
  // Simulation time per MD step.
  time_step?: number
  // Required unit for time_step.
  time_unit?: string
  // Static per-atom masses in atomic mass units, when recorded by the source.
  atom_masses?: number[]
  // Time-dependent properties with independent step axes.
  signals?: Record<string, TrajectorySignal>
  // Large file streaming properties
  total_frames?: number
  indexed_frames?: FrameIndex[]
  plot_metadata?: TrajectoryMetadata[]
  is_indexed?: boolean
  frame_loader?: FrameLoader
  frame_store?: TrajectoryFrameStore
}

// Unified handler data interface
export interface TrajHandlerData extends FileLoadData {
  trajectory?: TrajectoryType
  step_idx?: number
  frame_count?: number
  frame?: TrajectoryFrame
  file_size?: number
  total_atoms?: number
  error_msg?: string
  fps?: number
  mode?: ComponentProps<typeof Trajectory>[`display_mode`]
  fullscreen?: boolean
}

export interface TrajectoryController {
  set_step: (step_idx: number) => number
  state: () => { current_step_idx: number; total_frames: number }
}

// Function interfaces for extensibility
export type TrajectoryDataExtractor = (
  frame: TrajectoryFrame,
  trajectory: TrajectoryType,
) => Record<string, number>

// Flat frame-major Cartesian positions.
export interface TrajectoryPositionStream {
  positions: Float64Array
  n_frames: number
  n_atoms: number
  elements: ElementSymbol[]
  // One cell per frame; null if none exist.
  lattice_matrices: (Matrix3x3 | null)[] | null
  pbc: Pbc | null
  coords_unwrapped: boolean
  frame_stride: number
  steps: number[]
  // Opt-in site properties, parallel to positions.
  scalars?: Record<string, Float64Array>
  vectors?: Record<string, Float64Array>
  // Requested frame-level signals sampled on the same collected steps as positions.
  signals?: Record<string, TrajectorySignal>
}

export interface PositionStreamOptions {
  // Collect every Nth frame. Use `suggest_frame_stride` to stay inside a memory budget.
  frame_stride?: number
  // Hard ceiling on the allocated position buffer; the sweep throws (with the stride
  // that would fit) rather than attempting a multi-GB allocation.
  max_bytes?: number
  // Required per-atom scalar and vec3 properties.
  scalar_keys?: string[]
  vector_keys?: string[]
  // Frame metadata keys to collect as scalar, vec3, or 3x3 signals.
  signal_keys?: string[]
}

export interface FrameLoader {
  // False when the loader owns its data.
  requires_source?: boolean
  get_total_frames: (data: string | ArrayBuffer) => Promise<number>
  // Release worker ports, file handles, or other external resources owned by the loader.
  dispose?: () => void
  // Optional sequential position pass.
  stream_positions?: (
    data: string | ArrayBuffer,
    options?: PositionStreamOptions,
    on_progress?: (progress: ParseProgress) => void,
  ) => Promise<TrajectoryPositionStream>
  build_frame_index: (
    data: string | ArrayBuffer,
    sample_rate: number,
    on_progress?: (progress: ParseProgress) => void,
  ) => Promise<FrameIndex[]>
  load_frame: (
    data: string | ArrayBuffer,
    frame_number: number,
  ) => Promise<TrajectoryFrame | null>
  // Source-free packed stores support synchronous access.
  load_frame_sync?: (frame_number: number) => TrajectoryFrame | null
  extract_plot_metadata: (
    data: string | ArrayBuffer,
    options?: { sample_rate?: number; properties?: string[] },
    on_progress?: (progress: ParseProgress) => void,
  ) => Promise<TrajectoryMetadata[]>
}

export function validate_trajectory(trajectory: TrajectoryType): string[] {
  const errors: string[] = []
  const { frames, total_frames, indexed_frames, plot_metadata, is_indexed, frame_store } =
    trajectory

  if (!frames?.length) return [`Trajectory must have at least one frame`]

  let first_symbols: string[] | null = null
  for (const [frame_idx, frame] of frames.entries()) {
    const sites = frame.structure?.sites
    if (!sites?.length) {
      errors.push(`Frame ${frame_idx} missing structure or sites`)
    }
    if (!Number.isFinite(frame.step)) {
      errors.push(`Frame ${frame_idx} missing or invalid step number`)
    } else if (frame_idx > 0 && !(frame.step > frames[frame_idx - 1].step)) {
      errors.push(`Frame ${frame_idx} step (${frame.step}) must be strictly increasing`)
    }
    if (!sites?.length) continue
    const symbols = sites.map(({ species }) => species[0]?.element ?? `unknown`)
    const reference_symbols = (first_symbols ??= symbols)
    if (
      symbols.length !== reference_symbols.length ||
      symbols.some((symbol, atom_idx) => symbol !== reference_symbols[atom_idx])
    ) {
      errors.push(`Frame ${frame_idx} changes atom count or ordering`)
    }
  }

  const atom_masses: unknown = trajectory.atom_masses
  if (atom_masses !== undefined) {
    if (!Array.isArray(atom_masses)) {
      errors.push(`atom_masses must be an array`)
    } else {
      if (first_symbols && atom_masses.length !== first_symbols.length) {
        errors.push(
          `atom_masses has ${atom_masses.length} entries for ${first_symbols.length} atoms`,
        )
      }
      atom_masses.forEach((mass: unknown, atom_idx) => {
        if (typeof mass !== `number` || !Number.isFinite(mass) || mass <= 0) {
          errors.push(`atom_masses[${atom_idx}] must be finite and > 0, got ${mass}`)
        }
      })
    }
  }

  const signals: unknown = trajectory.signals
  if (
    signals !== undefined &&
    (signals === null ||
      typeof signals !== `object` ||
      Array.isArray(signals) ||
      ArrayBuffer.isView(signals))
  ) {
    errors.push(`signals must be an object`)
  } else if (signals !== undefined) {
    for (const [key, signal] of Object.entries(signals)) {
      if (signal === null || typeof signal !== `object` || Array.isArray(signal)) {
        errors.push(`signals.${key} must be an object`)
        continue
      }
      const signal_record = signal as Record<string, unknown>
      const { sample_shape, values, steps, unit } = signal_record
      const numeric_sample_shape = Array.isArray(sample_shape)
        ? sample_shape.filter(
            (size: unknown): size is number =>
              typeof size === `number` && Number.isInteger(size) && size >= 1,
          )
        : []
      const valid_sample_shape =
        Array.isArray(sample_shape) &&
        numeric_sample_shape.length === sample_shape.length &&
        is_supported_trajectory_signal_shape(numeric_sample_shape, first_symbols?.length ?? 0)
      if (!valid_sample_shape) {
        errors.push(
          `signals.${key}.sample_shape must be scalar, [3], [3, 3], [n_atoms], or ` +
            `[n_atoms, 3], got ${JSON.stringify(sample_shape)}`,
        )
      }
      if (!(values instanceof Float64Array)) {
        errors.push(`signals.${key}.values must be a Float64Array`)
      }
      if (!Array.isArray(steps)) {
        errors.push(`signals.${key}.steps must be an array`)
      }
      if (unit !== undefined && (typeof unit !== `string` || !unit.trim())) {
        errors.push(`signals.${key}.unit must be a non-empty string when supplied`)
      }
      if (!valid_sample_shape || !(values instanceof Float64Array) || !Array.isArray(steps)) {
        continue
      }
      const sample_size = numeric_sample_shape.reduce(
        (total: number, value: number) => total * value,
        1,
      )
      if (values.length !== steps.length * sample_size) {
        errors.push(
          `signals.${key} has ${values.length} values for ${steps.length} samples ` +
            `of shape [${numeric_sample_shape.join(`, `)}]`,
        )
      }
      const bad_value_idx = values.findIndex((value) => !Number.isFinite(value))
      if (bad_value_idx !== -1) {
        errors.push(`signals.${key}.values[${bad_value_idx}] is not finite`)
      }
      steps.forEach((step: unknown, step_idx) => {
        if (typeof step !== `number` || !Number.isFinite(step)) {
          errors.push(`signals.${key}.steps[${step_idx}] is not finite`)
        } else if (step_idx > 0 && !(step > steps[step_idx - 1])) {
          errors.push(`signals.${key}.steps must be strictly increasing`)
        }
      })
    }
  }

  // Validate streaming-related properties
  if (total_frames !== undefined) {
    if (typeof total_frames !== `number` || total_frames < 1) {
      errors.push(`total_frames must be a positive number, got ${total_frames}`)
    } else if (indexed_frames?.length) {
      const last_indexed_frame = indexed_frames.at(-1)
      if (last_indexed_frame && last_indexed_frame.frame_number >= total_frames) {
        errors.push(`indexed_frames contains frame_number >= total_frames (${total_frames})`)
      }
    }
  }

  if (is_indexed === true && !indexed_frames?.length && !frame_store) {
    errors.push(
      `is_indexed is true but indexed_frames is missing or empty and frame_store is absent`,
    )
  }

  if (indexed_frames) {
    if (!Array.isArray(indexed_frames)) {
      errors.push(`indexed_frames must be an array`)
    } else {
      indexed_frames.forEach((frame_idx, idx) => {
        if (typeof frame_idx.frame_number !== `number`) {
          errors.push(`indexed_frames[${idx}] missing or invalid frame_number`)
        } else if (frame_idx.frame_number < 0) {
          errors.push(
            `indexed_frames[${idx}] frame_number (${frame_idx.frame_number}) must be non-negative`,
          )
        } else if (idx > 0 && frame_idx.frame_number <= indexed_frames[idx - 1].frame_number) {
          errors.push(
            `indexed_frames[${idx}] frame_number (${frame_idx.frame_number}) must be strictly increasing`,
          )
        }
        if (typeof frame_idx.byte_offset !== `number`) {
          errors.push(`indexed_frames[${idx}] missing or invalid byte_offset`)
        }
        if (typeof frame_idx.estimated_size !== `number`) {
          errors.push(`indexed_frames[${idx}] missing or invalid estimated_size`)
        }
      })
    }
  }

  if (plot_metadata) {
    if (!Array.isArray(plot_metadata)) {
      errors.push(`plot_metadata must be an array`)
    } else {
      plot_metadata.forEach((meta, idx) => {
        if (typeof meta.frame_number !== `number`) {
          errors.push(`plot_metadata[${idx}] missing or invalid frame_number`)
        }
        if (typeof meta.step !== `number`) {
          errors.push(`plot_metadata[${idx}] missing or invalid step`)
        }
        if (!meta.properties || typeof meta.properties !== `object`) {
          errors.push(`plot_metadata[${idx}] missing or invalid properties object`)
        }
      })
    }
  }

  return errors
}

export function get_trajectory_stats(trajectory: TrajectoryType): Record<string, unknown> {
  const { frames, total_frames, indexed_frames, plot_metadata } = trajectory
  const frame_count = total_frames ?? frames.length
  const stats: Record<string, unknown> = {
    frame_count,
    is_indexed: trajectory.is_indexed ?? false,
  }

  if (frames.length > 0) {
    const [first_frame, last_frame] = [frames[0], frames.at(-1) ?? frames[0]]
    const max_sample = 100

    const sampled =
      frames.length <= max_sample
        ? frames
        : (() => {
            const interval = Math.floor(frames.length / max_sample)
            const result = [first_frame]
            for (let idx = interval; idx < frames.length - 1; idx += interval) {
              result.push(frames[idx])
            }
            if (result.at(-1) !== last_frame) result.push(last_frame)
            return result
          })()

    const counts = sampled.map((frame) => frame.structure.sites.length)
    const constant = counts.every((count) => count === counts[0])
    const all_counts = constant
      ? [first_frame.structure.sites.length]
      : frames.map((frame) => frame.structure.sites.length)

    stats.steps = frames.map((frame) => frame.step)
    stats.step_range = [first_frame.step, last_frame.step]
    stats.constant_atom_count = constant
    if (constant) stats.total_atoms = first_frame.structure.sites.length
    else stats.atom_count_range = [Math.min(...all_counts), Math.max(...all_counts)]
  } else stats.steps = [] // empty trajectory

  // Additional metadata for large files
  if (indexed_frames) stats.indexed_frame_count = indexed_frames.length
  if (plot_metadata) stats.plot_metadata_count = plot_metadata.length
  return stats
}
