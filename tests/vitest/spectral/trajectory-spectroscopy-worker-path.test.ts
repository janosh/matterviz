// Exercises the real spectroscopy Web Worker request path, including structured cloning
// of every typed-array signal and the nested finite-field geometry payload.
import type { compute_trajectory_spectroscopy_async as ComputeSpectroscopyAsync } from '$lib/spectral/trajectory-spectroscopy-async.svelte'
import {
  calc_trajectory_spectroscopy,
  type TrajectorySpectroscopyInput,
  type TrajectorySpectroscopyOptions,
} from '$lib/spectral/trajectory-spectroscopy'
import type { TrajectorySignal } from '$lib/trajectory'
import { SvelteMap } from 'svelte/reactivity'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

type WorkerMessage = {
  id: number
  input: TrajectorySpectroscopyInput
  options: TrajectorySpectroscopyOptions
}
type Listener = (event: {
  data: unknown
  message?: string
  preventDefault: () => void
}) => void

const signal = (
  n_samples: number,
  sample_shape: number[],
  sample: (sample_idx: number) => number[],
): TrajectorySignal => ({
  values: Float64Array.from(
    Array.from({ length: n_samples }, (_unused, sample_idx) => sample(sample_idx)).flat(),
  ),
  sample_shape,
  steps: Array.from({ length: n_samples }, (_unused, sample_idx) => sample_idx),
})

const make_input = (): TrajectorySpectroscopyInput => {
  const n_frames = 16
  const steps = Array.from({ length: n_frames }, (_unused, frame_idx) => frame_idx)
  const positions = Float64Array.from(
    steps.flatMap((step) => [-0.5 - 0.02 * Math.sin(step), 0, 0, 0.5, 0, 0]),
  )
  const velocities = signal(n_frames, [2, 3], (sample_idx) => [
    Math.cos((2 * Math.PI * sample_idx) / 4),
    0,
    0,
    0,
    0,
    0,
  ])
  const response = signal(n_frames, [3], (sample_idx) => [
    Math.sin((2 * Math.PI * sample_idx) / 4),
    0,
    0,
  ])
  const negative_response = {
    ...response,
    values: Float64Array.from(response.values, (value) => -value),
  }
  const geometry = (): TrajectorySignal => ({
    values: new Float64Array(positions),
    sample_shape: [2, 3],
    steps: [...steps],
    unit: `A`,
  })
  return {
    positions: {
      positions,
      n_frames,
      n_atoms: 2,
      elements: [`H`, `H`],
      lattice_matrices: null,
      pbc: [false, false, false],
      coords_unwrapped: true,
      frame_stride: 1,
      steps,
    },
    masses: Float64Array.from([1, 1]),
    velocities,
    infrared_signal: { kind: `dipole`, series: response },
    raman_signal: {
      kind: `field_response`,
      response: `dipole`,
      field_strength: 0.01,
      field_unit: `V/A`,
      plus: { x: response, y: response, z: response },
      minus: { x: negative_response, y: negative_response, z: negative_response },
      geometry: {
        plus: { x: geometry(), y: geometry(), z: geometry() },
        minus: { x: geometry(), y: geometry(), z: geometry() },
      },
    },
    time_step: 0.5,
    time_unit: `fs`,
    metadata: { model: `synthetic` },
  }
}

let construction_count = 0
let last_worker_url: string | undefined
let last_worker_options: WorkerOptions | undefined
let force_error: string | null = null
const posted: { message: WorkerMessage; transfer: Transferable[] }[] = []

class StubWorker {
  private readonly listeners = new SvelteMap<string, Listener[]>()

  constructor(url: URL | string, options?: WorkerOptions) {
    construction_count++
    last_worker_url = String(url)
    last_worker_options = options
  }

  addEventListener(type: string, handler: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler])
  }

  terminate(): void {}

  postMessage(message: WorkerMessage, transfer: Transferable[] = []): void {
    const cloned = structuredClone(message)
    posted.push({ message: cloned, transfer })
    queueMicrotask(() => {
      let data: { id: number; result: unknown; error: string | null }
      if (force_error) data = { id: cloned.id, result: null, error: force_error }
      else {
        data = {
          id: cloned.id,
          result: structuredClone(calc_trajectory_spectroscopy(cloned.input, cloned.options)),
          error: null,
        }
      }
      force_error = null
      for (const handler of this.listeners.get(`message`) ?? []) {
        handler({ data, preventDefault: () => {} })
      }
    })
  }
}

let compute_spectroscopy_async: typeof ComputeSpectroscopyAsync

beforeAll(async () => {
  vi.stubGlobal(`Worker`, StubWorker)
  ;({ compute_trajectory_spectroscopy_async: compute_spectroscopy_async } = await import(
    `$lib/spectral/trajectory-spectroscopy-async.svelte`
  ))
})

afterEach(() => {
  posted.length = 0
  force_error = null
})

describe(`trajectory spectroscopy worker code path`, () => {
  it(`round-trips the full signal payload and matches synchronous calculation`, async () => {
    const input = make_input()
    const options = {
      preprocessing: `raw`,
      frequency_unit: `THz`,
      window: `none`,
      zero_pad_factor: 1,
    } as const
    const result = await compute_spectroscopy_async(input, options)
    expect(result).toEqual(calc_trajectory_spectroscopy(input, options))
    expect(posted).toHaveLength(1)
    expect(posted[0].transfer).toHaveLength(0)
    expect(posted[0].message.input.positions.positions).toBeInstanceOf(Float64Array)
    expect(posted[0].message.input.positions.positions).not.toBe(input.positions.positions)
    const payload_raman = posted[0].message.input.raman_signal
    expect(payload_raman?.kind).toBe(`field_response`)
    if (payload_raman?.kind !== `field_response`) return
    expect(payload_raman.geometry.plus.x.values).toBeInstanceOf(Float64Array)
    expect(payload_raman.geometry.plus.x.values).not.toBe(
      input.raman_signal?.kind === `field_response`
        ? input.raman_signal.geometry.plus.x.values
        : undefined,
    )
  })

  it(`targets the spectroscopy worker module and reuses one module worker`, async () => {
    await compute_spectroscopy_async(make_input(), { preprocessing: `raw` })
    await compute_spectroscopy_async(make_input(), { preprocessing: `raw` })
    expect(construction_count).toBe(1)
    expect(last_worker_url).toMatch(
      /\/src\/lib\/spectral\/trajectory-spectroscopy-worker\.ts\?worker_file/,
    )
    expect(last_worker_options).toEqual({ type: `module` })
  })

  it(`rejects worker errors`, async () => {
    force_error = `synthetic spectroscopy worker failure`
    await expect(
      compute_spectroscopy_async(make_input(), { preprocessing: `raw` }),
    ).rejects.toThrow(/synthetic spectroscopy worker failure/)
  })
})
