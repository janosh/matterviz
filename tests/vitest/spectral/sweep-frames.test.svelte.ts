// Sweep frame cache (spectral/sweep-frames): loads on request, once per frame and loader
import type { Sweep, SweepFrameLoader } from '#lib/spectral/sweep.js'
import { create_sweep_frames } from '#lib/spectral/sweep-frames.svelte.js'
import type { BaseBandStructure, ElectronicDos, PhononDos } from '#lib/spectral/types.js'
import { flushSync } from 'svelte'
import { expect, onTestFinished, test, vi } from 'vitest'

const make_sweep = (load_frame?: SweepFrameLoader): Sweep => ({
  axis: { key: `pressure`, label: `Pressure`, unit: `GPa` },
  series: [{ id: `fcc`, frames: [{ value: 0 }, { value: 50 }, { value: 100 }] }],
  ...(load_frame && { load_frame }),
})
// A loader whose calls settle when the test says, recording which frames were asked for
function deferred_loader() {
  const calls: {
    args: [string, number]
    resolve: (data: unknown) => void
    reject: (error: Error) => void
  }[] = []
  const load: SweepFrameLoader = vi.fn(
    (series_id: string, frame_idx: number) =>
      new Promise<unknown>((resolve, reject) => {
        calls.push({ args: [series_id, frame_idx], resolve, reject })
      }),
  )
  return { load, calls }
}
// The cache under a reactive root, its sweep $state the test can swap or edit in place
function setup(loader?: SweepFrameLoader) {
  const inputs = $state({ sweep: make_sweep(loader) })
  const on_error = vi.fn()
  let frames: ReturnType<typeof create_sweep_frames> | undefined
  const cleanup = $effect.root(() => {
    frames = create_sweep_frames({ sweep: () => inputs.sweep, on_error })
  })
  onTestFinished(cleanup)
  if (!frames) throw new Error(`cache not created`)
  return { frames, inputs, on_error }
}
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  flushSync()
}
const phonon_bands: BaseBandStructure = {
  type: `phonon`,
  qpoints: [{ label: `GAMMA`, frac_coords: [0, 0, 0], distance: 0 }],
  branches: [],
  labels_dict: {},
  distance: [0],
  nb_bands: 1,
  bands: [[0]],
}
const phonon_dos: PhononDos = { type: `phonon`, frequencies: [0, 1], densities: [0, 1] }
const electronic_dos: ElectronicDos = {
  type: `electronic`,
  energies: [0, 1],
  densities: [1, 1],
  spin_polarized: false,
}

test(`without a loader every frame is ready as given and requests do nothing`, () => {
  const { frames, inputs } = setup()
  const series = inputs.sweep.series[0]
  frames.request(series, 0)
  expect(frames.is_ready(series, 0)).toBe(true)
  expect(frames.is_loading(series, 0)).toBe(false)
  expect(frames.frame(series, 1)).toBe(series.frames[1])
})

test(`a requested frame loads once, every record merged key by key over its own`, async () => {
  const { load, calls } = deferred_loader()
  const { frames, inputs } = setup(load)
  const series = inputs.sweep.series[0]
  series.frames[1] = {
    value: 50,
    scalars: { volume: 9, tc: 1 },
    status: { note: `relaxed` },
    doses: { total: electronic_dos },
    phonon: { doses: { 'phonon DOS': phonon_dos } },
  }
  frames.request(series, 1)
  frames.request(series, 1) // already loading
  expect(load).toHaveBeenCalledExactlyOnceWith(`fcc`, 1)
  expect([frames.is_loading(series, 1), frames.is_ready(series, 1)]).toEqual([true, false])
  // frames outside the series are ready (playback never waits on them) and never loaded
  frames.request(series, 3)
  expect(frames.is_ready(series, 3)).toBe(true)
  expect(load).toHaveBeenCalledOnce()

  calls[0].resolve({
    label: `loaded`,
    scalars: { tc: 12 },
    status: { unstable: true },
    doses: { Cu: electronic_dos },
    phonon: { band_structs: { Cu: phonon_bands }, a2f: { 'α²F': phonon_dos } },
  })
  await settle()
  expect([frames.is_loading(series, 1), frames.is_ready(series, 1)]).toEqual([false, true])
  expect(frames.frame(series, 1)).toEqual({
    value: 50,
    label: `loaded`,
    scalars: { volume: 9, tc: 12 },
    status: { note: `relaxed`, unstable: true },
    doses: { total: electronic_dos, Cu: electronic_dos }, // the frame's total stays
    phonon: {
      doses: { 'phonon DOS': phonon_dos },
      band_structs: { Cu: phonon_bands },
      a2f: { 'α²F': phonon_dos },
    },
  })
  frames.request(series, 1) // loaded
  expect(load).toHaveBeenCalledOnce()
})

// a $state sweep edited in place: the loaded data stays with its frame object
test(`loaded data follows its frame through inserts, in-place edits show at once`, async () => {
  const { load, calls } = deferred_loader()
  const { frames, inputs } = setup(load)
  const series = inputs.sweep.series[0]
  frames.request(series, 0)
  calls[0].resolve({ scalars: { tc: 5 } })
  await settle()
  series.frames[0].scalars = { tc: 1, lambda: 0.5 } // the loaded tc still wins
  expect(frames.frame(series, 0).scalars).toEqual({ tc: 5, lambda: 0.5 })
  series.frames.splice(0, 0, { value: -10 })
  flushSync()
  expect(frames.frame(series, 0).scalars).toBeUndefined()
  expect(frames.frame(series, 1)).toMatchObject({ value: 0, scalars: { tc: 5, lambda: 0.5 } })
  expect([frames.is_ready(series, 0), frames.is_ready(series, 1)]).toEqual([false, true])
})

test(`a failed load is reported once with its 0-based index, counts as ready, no retry`, async () => {
  const { load, calls } = deferred_loader()
  const { frames, inputs, on_error } = setup(load)
  const series = inputs.sweep.series[0]
  frames.request(series, 2)
  calls[0].reject(new Error(`cluster unreachable`))
  await settle()
  expect(on_error).toHaveBeenCalledExactlyOnceWith(
    `Loading frame 2 of series "fcc" failed: cluster unreachable`,
  )
  expect(frames.is_ready(series, 2)).toBe(true)
  frames.request(series, 2)
  expect(load).toHaveBeenCalledOnce()
  expect(frames.frame(series, 2)).toBe(series.frames[2])
})

// oxfmt-ignore
test.each([
  [`an electronic DOS among the phonons`, { phonon: { doses: { x: electronic_dos } } }, `.phonon.doses.x: must be phonon data, got electronic`],
  [`a structure without lattice`, { structure: { sites: [{ species: [{ element: `Cu`, occu: 1 }], xyz: [0, 0, 0] }] } }, `.structure: needs a periodic structure`],
  [`a frame value`, { value: 3 }, `.value: unknown field`],
  [`no object`, [], `: must be an object`],
])(`loaded data with %s fails the frame, naming the field`, async (_desc, data, problem) => {
  const { load, calls } = deferred_loader()
  const { frames, inputs, on_error } = setup(load)
  const series = inputs.sweep.series[0]
  frames.request(series, 1)
  calls[0].resolve(data)
  await settle()
  expect(on_error).toHaveBeenCalledOnce()
  expect(on_error.mock.calls[0][0]).toContain(`Loading frame 1 of series "fcc" failed`)
  expect(on_error.mock.calls[0][0]).toContain(`load_frame("fcc", 1)${problem}`)
  expect([frames.is_ready(series, 1), frames.frame(series, 1)]).toEqual([true, series.frames[1]])
})

test(`a new sweep starts a fresh cache, ignoring loads still running for the old one`, async () => {
  const { load, calls } = deferred_loader()
  const { frames, inputs, on_error } = setup(load)
  const old_series = inputs.sweep.series[0]
  for (const idx of [0, 1, 2]) frames.request(old_series, idx)
  const [, old_1, old_2] = calls
  calls[0].resolve({ label: `old 0` })
  await settle()
  expect(frames.frame(old_series, 0).label).toBe(`old 0`)

  inputs.sweep = make_sweep(load)
  flushSync()
  const series = inputs.sweep.series[0]
  expect(frames.frame(series, 0).label).toBeUndefined() // dropped with the old cache
  old_1.resolve({ label: `old 1` }) // lands in the old cache
  old_2.reject(new Error(`old sweep's server gone`)) // no longer the caller's concern
  calls.length = 0
  await settle()
  expect(frames.frame(series, 1).label).toBeUndefined()
  frames.request(series, 0) // loads again for the new sweep
  expect(load).toHaveBeenCalledTimes(4)
  expect(calls[0].args).toEqual([`fcc`, 0])
  expect(on_error).not.toHaveBeenCalled()
})

test(`requests from an effect rerun it for a new loader, not as loads start and settle`, async () => {
  const { load, calls } = deferred_loader()
  const inputs = $state({ sweep: make_sweep(load) })
  let runs = 0
  const cleanup = $effect.root(() => {
    const frames = create_sweep_frames({ sweep: () => inputs.sweep, on_error: vi.fn() })
    $effect(() => {
      runs++
      frames.request(inputs.sweep.series[0], 0)
    })
  })
  onTestFinished(cleanup)
  flushSync()
  calls[0].resolve({ label: `loaded` })
  await settle()
  expect([runs, calls.length]).toEqual([1, 1])
  // a new loader on the same sweep starts a fresh cache: the shown frame loads through it
  const next = deferred_loader()
  inputs.sweep.load_frame = next.load
  flushSync()
  expect([runs, next.calls.map(({ args }) => args)]).toEqual([2, [[`fcc`, 0]]])
})
