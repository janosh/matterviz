import { is_finite_vec3_like } from '$lib/math'
import type { AnalysisStreamOptions } from '$lib/trajectory/analysis'
import { collect_trajectory_positions } from '$lib/trajectory/analysis'
import { values_per_sample } from '$lib/trajectory/helpers'
import type { TrajectoryRun, TrajectorySignal } from '$lib/trajectory'
import { is_loaded_signal, is_signal_descriptor } from '$lib/trajectory/run'
import { parse_frame_signal } from '$lib/trajectory/runs/accumulate'
import { SvelteSet } from 'svelte/reactivity'
import type {
  InfraredSignal,
  SpectroscopyPreprocessing,
  TrajectorySpectroscopyInput,
} from './trajectory-spectroscopy'
import { arrays_equal, standard_masses_for_elements } from './trajectory-spectroscopy'

// Signal keys a trajectory may carry for each response; the first present is the default
export const INFRARED_SIGNAL_KEYS = [`dipole`, `polarization`, `current`] as const
export const RAMAN_SIGNAL_KEYS = [`polarizability`] as const

type SpectroscopyCollectOptions = AnalysisStreamOptions & {
  velocity_key?: string | null
  infrared_key?: string | null
  infrared_kind?: InfraredSignal[`kind`]
  polarization_branch_continuous?: boolean
  raman_key?: string | null
  mass_source?: `auto` | `recorded` | `standard`
  // The preprocessing the calculation will run with; decides which strided signals must be
  // aligned to the kept position steps (see `signal_of`)
  preprocessing?: SpectroscopyPreprocessing
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

// How a collect streams the run's velocity: a loaded run signal needs no channel; site
// properties and a lazy per-atom [n_atoms, 3] descriptor the parser marked `frame_aligned`
// (one sample per frame on the geometry's steps) stream strided beside positions
// (`vector_keys`); a descriptor on its own cadence is a native-cadence `signal_keys` read.
// Equal sample counts alone don't make the step axes match (velocities on steps [1, 2, 3, 4]
// beside frames on [0, 1, 2, 3]), and a `vector_keys` read of such a signal throws in the
// HDF5 parser
const velocity_channel = (run: TrajectoryRun, key: string): `vector` | `signal` | null => {
  const signal = run.signals?.[key]
  if (!signal) return has_site_velocities(run, key) ? `vector` : null
  if (is_loaded_signal(signal)) return null
  const n_atoms = run.preview.structure.sites.length
  return signal.frame_aligned && arrays_equal(signal.sample_shape, [n_atoms, 3])
    ? `vector`
    : `signal`
}

// Per-site vector and frame-signal channels a collect streams alongside positions, so the
// pane's memory budget (suggest_frame_stride) and the collector size the same buffers. A
// loaded run signal needs no channel; a descriptor or frame-metadata key is streamed.
export const spectroscopy_stream_channels = (
  run: TrajectoryRun,
  keys: {
    velocity_key?: string | null
    infrared_key: string | null
    raman_key: string | null
  },
): { vector_keys: string[]; signal_keys: string[] } => {
  const { velocity_key = `velocity`, infrared_key, raman_key } = keys
  const channel = velocity_key ? velocity_channel(run, velocity_key) : null
  const response_keys = [infrared_key, raman_key].filter((key): key is string => {
    const signal = key ? run.signals?.[key] : undefined
    return Boolean(key) && (signal === undefined || is_signal_descriptor(signal))
  })
  return {
    vector_keys: velocity_key && channel === `vector` ? [velocity_key] : [],
    signal_keys: [
      ...(velocity_key && channel === `signal` ? [velocity_key] : []),
      ...response_keys,
    ],
  }
}

// Strided positions keep every Nth frame, but run-level and HDF5-streamed signals arrive on
// their native step axis, so rigid-motion removal and body-frame rotation would find samples
// with no position. Drop the skipped steps; a signal already on the kept steps (frame-backed
// metadata) passes through by identity.
const align_signal_to_steps = (
  signal: TrajectorySignal,
  steps: number[],
  key: string,
  frame_stride: number,
): TrajectorySignal => {
  const kept_steps = new Set(steps)
  const kept_indices = signal.steps.flatMap((step, sample_idx) =>
    kept_steps.has(step) ? [sample_idx] : [],
  )
  if (kept_indices.length === signal.steps.length) return signal
  // A signal on its own cadence (a dipole every step beside positions every 20) is decimated
  // by the stride; one fully off the kept steps would silently become an empty spectrum
  if (kept_indices.length < 2) {
    throw new Error(
      `Signal '${key}' has no samples on the strided position steps (frame_stride=${frame_stride}); use stride 1`,
    )
  }
  const sample_size = values_per_sample(signal.sample_shape)
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

export const trajectory_signal_keys = (
  run: TrajectoryRun | undefined,
  expected_shape?: number[],
): string[] => {
  if (!run) return []
  const declared_keys = Object.entries(run.signals ?? {}).flatMap(([key, { sample_shape }]) =>
    !expected_shape || arrays_equal(sample_shape, expected_shape) ? [key] : [],
  )
  // Frame metadata is only a response signal when it is named like one: LAMMPS box origins
  // and other vec3 bookkeeping would otherwise show up as IR candidates
  const metadata = run.preview.metadata ?? {}
  const n_atoms = run.preview.structure.sites.length
  const metadata_keys = Object.entries(metadata).flatMap(([key, value]) =>
    RESPONSE_SIGNAL_KEY.test(key) &&
    (!expected_shape ||
      arrays_equal(parse_frame_signal(value, key, n_atoms)?.sample_shape, expected_shape))
      ? [key]
      : [],
  )
  return [...new SvelteSet([...declared_keys, ...metadata_keys])].toSorted()
}

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
    max_bytes,
    on_progress,
    signal,
    velocity_key = `velocity`,
    mass_source = `auto`,
    preprocessing,
  } = options
  const available_keys = trajectory_signal_keys(run)
  // an explicit null key means "no signal"; only `undefined` falls back to the first default
  const resolve_key = (key: string | null | undefined, preferred: readonly string[]) =>
    key === undefined ? (preferred.find((pref) => available_keys.includes(pref)) ?? null) : key
  const infrared_key = resolve_key(options.infrared_key, INFRARED_SIGNAL_KEYS)
  const raman_key = resolve_key(options.raman_key, RAMAN_SIGNAL_KEYS)
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
  // A named signal, eager on the run or streamed by the collect. Only a stride can leave
  // samples at skipped steps, and only analyses that look a signal step up in the positions
  // care: rigid-motion removal for velocities, body-frame rotation for IR/Raman. Every other
  // signal keeps its native cadence, so a dipole sampled every step beside positions kept
  // every 20th is not decimated or emptied by the stride
  const signal_of = (key: string, align: boolean): TrajectorySignal | undefined => {
    const declared = run.signals?.[key]
    const series = declared && is_loaded_signal(declared) ? declared : stream.signals?.[key]
    return series && align && frame_stride > 1
      ? align_signal_to_steps(series, stream.steps, key, frame_stride)
      : series
  }
  const require_signal = (key: string, align: boolean): TrajectorySignal => {
    const series = signal_of(key, align)
    if (!series) throw new Error(`No trajectory signal named '${key}'`)
    return series
  }
  const align_responses = preprocessing === `body_fixed`

  const declared_velocity = velocity_key ? run.signals?.[velocity_key] : undefined
  const velocity_signal = velocity_key ? signal_of(velocity_key, true) : undefined
  // Strided per-atom velocities: site properties, or a descriptor streamed via vector_keys
  const site_velocities = velocity_key ? stream.vectors?.[velocity_key] : undefined
  const velocities =
    velocity_signal ??
    (site_velocities
      ? {
          values: site_velocities,
          sample_shape: [stream.n_atoms, 3],
          steps: [...stream.steps],
          ...(declared_velocity?.unit ? { unit: declared_velocity.unit } : {}),
        }
      : null)
  // Provenance label for the metadata, distinct from calc_trajectory_spectroscopy's
  // `velocity_source` (stored vs central_difference)
  const velocity_provenance =
    !velocity_key || !velocities
      ? null
      : !declared_velocity
        ? `site:${velocity_key}`
        : is_loaded_signal(declared_velocity)
          ? velocity_key
          : `stream:${velocity_key}`
  const mass_values = mass_source === `standard` ? null : recorded_masses(run)
  if (mass_source === `recorded` && !mass_values) {
    throw new Error(`Recorded masses were requested, but the trajectory carries none`)
  }
  const masses = mass_values
    ? Float64Array.from(mass_values)
    : standard_masses_for_elements(stream.elements)

  let infrared_signal: InfraredSignal | null = null
  if (infrared_key) {
    const series = require_signal(infrared_key, align_responses)
    const kind = options.infrared_kind ?? infrared_kind_from_key(infrared_key)
    if (kind === `polarization` && options.polarization_branch_continuous !== true) {
      throw new Error(
        `Polarization signal '${infrared_key}' must be explicitly marked branch_continuous`,
      )
    }
    infrared_signal =
      kind === `polarization` ? { kind, series, branch_continuous: true } : { kind, series }
  }
  const raman_signal: TrajectorySpectroscopyInput[`raman_signal`] = raman_key
    ? { kind: `polarizability`, series: require_signal(raman_key, align_responses) }
    : null
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
