import {
  frame_loader_data,
  has_all_frames_in_memory,
  trajectory_total_frames,
} from '$lib/trajectory/analysis'
import type { ParseProgress, TrajectoryPositionStream, TrajectoryType } from '$lib/trajectory'
import {
  accumulate_positions,
  DEFAULT_POSITION_STREAM_MAX_BYTES,
  parse_frame_signal,
} from '$lib/trajectory/frame-reader'
import { SvelteSet } from 'svelte/reactivity'
import {
  standard_masses_for_elements,
  type InfraredSignal,
  type RamanSignal,
  type TrajectorySpectroscopyInput,
} from './trajectory-spectroscopy'

export interface SpectroscopyCollectOptions {
  raw_data?: string | ArrayBuffer | null
  frame_stride?: number
  max_bytes?: number
  on_progress?: (progress: ParseProgress) => void
  velocity_key?: string | null
  infrared_key?: string | null
  infrared_kind?: InfraredSignal[`kind`]
  polarization_branch_continuous?: boolean
  raman_key?: string | null
  raman_signal?: RamanSignal | null
  mass_source?: `auto` | `recorded` | `standard`
}

const is_vec3 = (value: unknown): boolean =>
  Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)

const has_site_velocities = (trajectory: TrajectoryType, key: string): boolean =>
  is_vec3(trajectory.frames[0]?.structure.sites[0]?.properties?.[key])

export const infrared_kind_from_key = (key: string): InfraredSignal[`kind`] => {
  const normalized_key = key.toLowerCase()
  if (normalized_key.includes(`polarization`)) return `polarization`
  return normalized_key.includes(`current`) ? `current` : `dipole`
}

const matching_shape = (shape: number[] | undefined, expected_shape: number[]): boolean =>
  shape?.length === expected_shape.length &&
  shape.every((size, idx) => size === expected_shape[idx])

export const trajectory_signal_keys = (
  trajectory: TrajectoryType | undefined,
  expected_shape?: number[],
): string[] => {
  if (!trajectory) return []
  const signal_keys = Object.entries(trajectory.signals ?? {}).flatMap(
    ([key, { sample_shape }]) =>
      !expected_shape || matching_shape(sample_shape, expected_shape) ? [key] : [],
  )
  const metadata = trajectory.frames[0]?.metadata ?? {}
  const n_atoms = trajectory.frames[0]?.structure.sites.length ?? 0
  const metadata_keys = Object.entries(metadata).flatMap(([key, value]) =>
    !expected_shape ||
    matching_shape(parse_frame_signal(value, key, n_atoms)?.sample_shape, expected_shape)
      ? [key]
      : [],
  )
  return [...new SvelteSet([...signal_keys, ...metadata_keys])].toSorted()
}

const select_default_key = (keys: string[], preferred: string[]): string | null =>
  preferred.find((key) => keys.includes(key)) ?? null

const recorded_masses = (trajectory: TrajectoryType): number[] | null => {
  const sites = trajectory.frames[0]?.structure.sites ?? []
  const masses = trajectory.atom_masses ?? sites.map(({ properties }) => properties?.mass)
  if (masses.length !== sites.length) {
    throw new Error(
      `Recorded masses have ${masses.length} entries for ${sites.length} trajectory atoms`,
    )
  }
  if (masses.every((mass) => mass === undefined)) return null
  const validated_masses: number[] = []
  for (const [atom_idx, mass] of masses.entries()) {
    if (typeof mass !== `number` || !Number.isFinite(mass) || mass <= 0) {
      throw new Error(`Recorded mass ${atom_idx} must be finite and > 0, got ${mass}`)
    }
    validated_masses.push(mass)
  }
  return validated_masses
}

// Collect positions plus selected response channels from a trajectory. HDF5 signals retain
// their independent step arrays; frame-backed formats are gathered in the same full sweep
// as positions so indexed trajectories cannot accidentally analyse only their preview frames.
export async function collect_trajectory_spectroscopy_input(
  trajectory: TrajectoryType,
  options: SpectroscopyCollectOptions = {},
): Promise<TrajectorySpectroscopyInput> {
  const {
    raw_data = null,
    frame_stride = 1,
    max_bytes = DEFAULT_POSITION_STREAM_MAX_BYTES,
    on_progress,
    velocity_key = `velocity`,
    mass_source = `auto`,
  } = options
  const available_keys = trajectory_signal_keys(trajectory)
  const infrared_key =
    options.infrared_key === undefined
      ? select_default_key(available_keys, [`dipole`, `polarization`, `current`])
      : options.infrared_key
  const raman_key =
    options.raman_key === undefined
      ? select_default_key(available_keys, [`polarizability`])
      : options.raman_key
  const trajectory_velocity = velocity_key ? trajectory.signals?.[velocity_key] : null
  const frame_signal_keys = [infrared_key, options.raman_signal ? null : raman_key].filter(
    (key): key is string => Boolean(key && !trajectory.signals?.[key]),
  )
  const collect_options = {
    frame_stride,
    max_bytes,
    ...(velocity_key && !trajectory_velocity && has_site_velocities(trajectory, velocity_key)
      ? { vector_keys: [velocity_key] }
      : {}),
    ...(frame_signal_keys.length > 0 ? { signal_keys: frame_signal_keys } : {}),
  }
  let stream: TrajectoryPositionStream
  if (has_all_frames_in_memory(trajectory)) {
    stream = await accumulate_positions(
      trajectory.frames.length,
      (frame_number) => trajectory.frames[frame_number] ?? null,
      collect_options,
      on_progress,
    )
  } else {
    const total = trajectory_total_frames(trajectory)
    const loader = trajectory.frame_loader
    if (!loader?.stream_positions) {
      throw new Error(
        `Trajectory has ${trajectory.frames.length} of ${total} frames in memory and its ` +
          `frame loader cannot stream positions`,
      )
    }
    const loader_data = frame_loader_data(loader, raw_data)
    if (loader_data === null) {
      throw new Error(`Indexed trajectory spectroscopy requires the original raw_data payload`)
    }
    stream = await loader.stream_positions(loader_data, collect_options, on_progress)
  }

  const streamed_velocities = velocity_key ? stream.vectors?.[velocity_key] : null
  const velocities =
    trajectory_velocity ??
    (streamed_velocities
      ? {
          values: streamed_velocities,
          sample_shape: [stream.n_atoms, 3],
          steps: [...stream.steps],
        }
      : null)
  const mass_values = mass_source === `standard` ? null : recorded_masses(trajectory)
  if (mass_source === `recorded` && !mass_values) {
    throw new Error(`Recorded masses were requested, but the trajectory carries none`)
  }
  const masses = mass_values
    ? Float64Array.from(mass_values)
    : standard_masses_for_elements(stream.elements)

  let infrared_signal: InfraredSignal | null = null
  if (infrared_key) {
    const series = trajectory.signals?.[infrared_key] ?? stream.signals?.[infrared_key]
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

  let raman_signal = options.raman_signal ?? null
  const raman_source_key = raman_signal ? null : raman_key
  if (!raman_signal && raman_key) {
    const series = trajectory.signals?.[raman_key] ?? stream.signals?.[raman_key]
    if (!series) throw new Error(`No trajectory signal named '${raman_key}'`)
    raman_signal = { kind: `polarizability`, series }
  }
  return {
    positions: stream,
    masses,
    velocities,
    infrared_signal,
    raman_signal,
    time_step: trajectory.time_step,
    time_unit: trajectory.time_unit,
    metadata: {
      ...trajectory.metadata,
      mass_source: mass_values ? `recorded` : `standard`,
      signal_sources: {
        velocity: velocities
          ? trajectory_velocity
            ? velocity_key
            : `site:${velocity_key}`
          : null,
        infrared: infrared_signal ? { key: infrared_key, kind: infrared_signal.kind } : null,
        raman: raman_signal
          ? {
              key: raman_source_key,
              kind: raman_signal.kind,
            }
          : null,
      },
    },
  }
}
