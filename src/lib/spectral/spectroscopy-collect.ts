import { is_finite_vec3_like } from '$lib/math'
import { collect_trajectory_positions } from '$lib/trajectory/analysis'
import type { CollectPositionsOptions, TrajectoryRun, TrajectorySignal } from '$lib/trajectory'
import {
  DEFAULT_POSITION_STREAM_MAX_BYTES,
  parse_frame_signal,
} from '$lib/trajectory/runs/accumulate'
import { SvelteSet } from 'svelte/reactivity'
import {
  standard_masses_for_elements,
  type InfraredSignal,
  type TrajectorySpectroscopyInput,
} from './trajectory-spectroscopy'

// Signal keys a trajectory may carry for each response; the first present is the default
export const INFRARED_SIGNAL_KEYS = [`dipole`, `polarization`, `current`] as const
export const RAMAN_SIGNAL_KEYS = [`polarizability`] as const

type SpectroscopyCollectOptions = Pick<
  CollectPositionsOptions,
  `frame_stride` | `max_bytes` | `on_progress` | `signal`
> & {
  velocity_key?: string | null
  infrared_key?: string | null
  infrared_kind?: InfraredSignal[`kind`]
  polarization_branch_continuous?: boolean
  raman_key?: string | null
  mass_source?: `auto` | `recorded` | `standard`
}

const has_site_velocities = (run: TrajectoryRun, key: string): boolean =>
  is_finite_vec3_like(run.preview.structure.sites[0]?.properties?.[key])

// Response-signal vocabulary for the IR/Raman candidate filter. Dipole and polarizability
// names vary freely across writers (`electronic_dipole`, `dipole_debye`, LAMMPS `c_dipole`,
// `polarizability_tensor`), so any key mentioning them counts; `current` stays anchored so
// `current_time` and other bookkeeping do not
const RESPONSE_SIGNAL_KEY = /dipole|polariz|^(?:total_)?current(?:_density)?$/i

export const infrared_kind_from_key = (key: string): InfraredSignal[`kind`] => {
  const normalized_key = key.toLowerCase()
  if (normalized_key.includes(`polarization`)) return `polarization`
  return normalized_key.includes(`current`) ? `current` : `dipole`
}

// Per-site vector and frame-signal channels a collect streams alongside positions, so the
// pane's memory budget (suggest_frame_stride) and the collector size the same buffers
export const spectroscopy_stream_channels = (
  run: TrajectoryRun,
  keys: {
    velocity_key?: string | null
    infrared_key: string | null
    raman_key: string | null
  },
): { vector_keys: string[]; signal_keys: string[] } => {
  const { velocity_key = `velocity`, infrared_key, raman_key } = keys
  const trajectory_velocity = velocity_key ? run.signals?.[velocity_key] : null
  const descriptor_velocity = velocity_key ? run.signal_descriptors?.[velocity_key] : null
  const signal_keys = [
    descriptor_velocity ? velocity_key : null,
    infrared_key,
    raman_key,
  ].filter((key): key is string => Boolean(key && !run.signals?.[key]))
  const vector_keys =
    velocity_key &&
    !trajectory_velocity &&
    !descriptor_velocity &&
    has_site_velocities(run, velocity_key)
      ? [velocity_key]
      : []
  return { vector_keys, signal_keys }
}

// Strided positions keep every Nth frame, but HDF5 signals are read on their native step
// axis, so rigid-motion removal and body-frame rotation would find samples with no position.
// Drop the skipped steps; at stride 1 independent cadences pass through untouched.
const align_signal_to_steps = (
  signal: TrajectorySignal,
  steps: number[],
): TrajectorySignal => {
  const kept_steps = new Set(steps)
  const kept_indices = signal.steps.flatMap((step, sample_idx) =>
    kept_steps.has(step) ? [sample_idx] : [],
  )
  if (kept_indices.length === signal.steps.length) return signal
  const sample_size = signal.sample_shape.reduce((product, size) => product * size, 1)
  const values = new Float64Array(kept_indices.length * sample_size)
  for (const [out_idx, sample_idx] of kept_indices.entries()) {
    const start = sample_idx * sample_size
    values.set(signal.values.subarray(start, start + sample_size), out_idx * sample_size)
  }
  return {
    ...signal,
    values,
    steps: kept_indices.map((sample_idx) => signal.steps[sample_idx]),
  }
}

const matching_shape = (shape: number[] | undefined, expected_shape: number[]): boolean =>
  shape?.length === expected_shape.length &&
  shape.every((size, idx) => size === expected_shape[idx])

export const trajectory_signal_keys = (
  run: TrajectoryRun | undefined,
  expected_shape?: number[],
): string[] => {
  if (!run) return []
  const declared_signals = {
    ...run.signal_descriptors,
    ...run.signals,
  }
  const declared_keys = Object.entries(declared_signals).flatMap(([key, { sample_shape }]) =>
    !expected_shape || matching_shape(sample_shape, expected_shape) ? [key] : [],
  )
  // Frame metadata is only a response signal when it is named like one: LAMMPS box origins
  // and other vec3 bookkeeping would otherwise show up as IR candidates
  const metadata = run.preview.metadata ?? {}
  const n_atoms = run.preview.structure.sites.length
  const metadata_keys = Object.entries(metadata).flatMap(([key, value]) =>
    RESPONSE_SIGNAL_KEY.test(key) &&
    (!expected_shape ||
      matching_shape(parse_frame_signal(value, key, n_atoms)?.sample_shape, expected_shape))
      ? [key]
      : [],
  )
  return [...new SvelteSet([...declared_keys, ...metadata_keys])].toSorted()
}

const select_default_key = (keys: string[], preferred: readonly string[]): string | null =>
  preferred.find((key) => keys.includes(key)) ?? null

const recorded_masses = (run: TrajectoryRun): number[] | null => {
  const { sites } = run.preview.structure
  const masses = run.atom_masses ?? sites.map(({ properties }) => properties?.mass)
  if (masses.length !== sites.length) {
    throw new Error(
      `Recorded masses have ${masses.length} entries for ${sites.length} trajectory atoms`,
    )
  }
  if (masses.every((mass) => mass === undefined)) return null
  return masses.map((mass, atom_idx) => {
    if (typeof mass !== `number` || !Number.isFinite(mass) || mass <= 0) {
      throw new Error(`Recorded mass ${atom_idx} must be finite and > 0, got ${mass}`)
    }
    return mass
  })
}

// Collect positions plus selected response channels from a trajectory. HDF5 signals retain
// their independent step arrays; frame-backed formats are gathered in the same full sweep
// as positions so indexed trajectories cannot accidentally analyse only their preview frames.
export async function collect_trajectory_spectroscopy_input(
  run: TrajectoryRun,
  options: SpectroscopyCollectOptions = {},
): Promise<TrajectorySpectroscopyInput> {
  const {
    frame_stride = 1,
    max_bytes = DEFAULT_POSITION_STREAM_MAX_BYTES,
    on_progress,
    signal,
    velocity_key = `velocity`,
    mass_source = `auto`,
  } = options
  const available_keys = trajectory_signal_keys(run)
  const infrared_key =
    options.infrared_key === undefined
      ? select_default_key(available_keys, INFRARED_SIGNAL_KEYS)
      : options.infrared_key
  const raman_key =
    options.raman_key === undefined
      ? select_default_key(available_keys, RAMAN_SIGNAL_KEYS)
      : options.raman_key
  const trajectory_velocity = velocity_key ? run.signals?.[velocity_key] : null
  const { vector_keys, signal_keys } = spectroscopy_stream_channels(run, {
    velocity_key,
    infrared_key,
    raman_key,
  })
  const stream = await collect_trajectory_positions(run, {
    frame_stride,
    max_bytes,
    ...(vector_keys.length > 0 ? { vector_keys } : {}),
    ...(signal_keys.length > 0 ? { signal_keys } : {}),
    on_progress,
    signal,
    analysis_name: `Spectroscopy`,
  })
  // Frame-backed signals were gathered per collected frame already; only run-level signals
  // (HDF5 step axes) can carry samples at skipped steps
  const run_signal = (key: string): TrajectorySignal | undefined => {
    const series = run.signals?.[key]
    return series && frame_stride > 1 ? align_signal_to_steps(series, stream.steps) : series
  }

  const streamed_velocities = velocity_key ? stream.vectors?.[velocity_key] : null
  const streamed_velocity_signal = velocity_key ? stream.signals?.[velocity_key] : null
  const velocities =
    (velocity_key ? run_signal(velocity_key) : null) ??
    streamed_velocity_signal ??
    (streamed_velocities
      ? {
          values: streamed_velocities,
          sample_shape: [stream.n_atoms, 3],
          steps: [...stream.steps],
        }
      : null)
  // Provenance label for the metadata, distinct from calc_trajectory_spectroscopy's
  // `velocity_source` (stored vs central_difference)
  const velocity_provenance = trajectory_velocity
    ? velocity_key
    : streamed_velocity_signal
      ? `stream:${velocity_key}`
      : streamed_velocities
        ? `site:${velocity_key}`
        : null
  const mass_values = mass_source === `standard` ? null : recorded_masses(run)
  if (mass_source === `recorded` && !mass_values) {
    throw new Error(`Recorded masses were requested, but the trajectory carries none`)
  }
  const masses = mass_values
    ? Float64Array.from(mass_values)
    : standard_masses_for_elements(stream.elements)

  let infrared_signal: InfraredSignal | null = null
  if (infrared_key) {
    const series = run_signal(infrared_key) ?? stream.signals?.[infrared_key]
    if (!series) throw new Error(`No trajectory signal named '${infrared_key}'`)
    const kind = options.infrared_kind ?? infrared_kind_from_key(infrared_key)
    if (kind === `polarization` && options.polarization_branch_continuous !== true) {
      throw new Error(
        `Polarization signal '${infrared_key}' must be explicitly marked branch_continuous`,
      )
    }
    infrared_signal =
      kind === `polarization`
        ? {
            kind,
            series,
            branch_continuous: true,
          }
        : { kind, series }
  }

  let raman_signal: TrajectorySpectroscopyInput[`raman_signal`] = null
  if (raman_key) {
    const series = run_signal(raman_key) ?? stream.signals?.[raman_key]
    if (!series) throw new Error(`No trajectory signal named '${raman_key}'`)
    raman_signal = { kind: `polarizability`, series }
  }
  return {
    positions: stream,
    masses,
    velocities,
    infrared_signal,
    raman_signal,
    time_step: run.time_step?.value,
    time_unit: run.time_step?.unit,
    metadata: {
      ...run.metadata,
      mass_source: mass_values ? `recorded` : `standard`,
      signal_sources: {
        velocity: velocity_provenance,
        infrared: infrared_signal ? { key: infrared_key, kind: infrared_signal.kind } : null,
        raman: raman_signal ? { key: raman_key, kind: raman_signal.kind } : null,
      },
    },
  }
}
