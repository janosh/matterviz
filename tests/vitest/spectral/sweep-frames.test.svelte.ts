// Sweep frame cache (spectral/sweep-frames): loads on request, once per frame and loader,
// aborts loads that leave the window and evicts heavy data beyond it and the recent frames
import { descriptor_value } from '#lib/spectral/sweep.js'
import type {
  DescriptorSpec,
  Sweep,
  SweepFrame,
  SweepFrameLoader,
} from '#lib/spectral/sweep.js'
import { create_sweep_frames, RECENT_FRAMES } from '#lib/spectral/sweep-frames.svelte.js'
import type {
  BaseBandStructure,
  ElectronicDos,
  ModeValues,
  PhononDos,
} from '#lib/spectral/types.js'
import { flushSync } from 'svelte'
import { expect, onTestFinished, test, vi } from 'vitest'

const fermi_dos_spec: DescriptorSpec = {
  key: `fermi_dos`,
  label: `N(E_F)`,
  compute: `fermi_dos`,
}
const make_sweep = (load_frame?: SweepFrameLoader, n_frames = 3): Sweep => ({
  axis: { key: `pressure`, label: `Pressure`, unit: `GPa` },
  series: [
    { id: `fcc`, frames: Array.from({ length: n_frames }, (_, idx) => ({ value: 50 * idx })) },
  ],
  descriptors: [fermi_dos_spec],
  ...(load_frame && { load_frame }),
})
// A loader whose calls settle when the test says, recording which frames were asked for
function deferred_loader() {
  const calls: {
    args: [string, number]
    signal: AbortSignal
    resolve: (data: unknown) => void
    reject: (error: Error) => void
  }[] = []
  const load: SweepFrameLoader = vi.fn(
    (series_id: string, frame_idx: number, { signal }: { signal: AbortSignal }) =>
      new Promise<unknown>((resolve, reject) => {
        calls.push({ args: [series_id, frame_idx], signal, resolve, reject })
      }),
  )
  return { load, calls }
}
// The cache under a reactive root, its sweep $state the test can swap or edit in place
function setup(loader?: SweepFrameLoader, n_frames?: number) {
  const inputs = $state({ sweep: make_sweep(loader, n_frames) })
  const on_error = vi.fn()
  let frames: ReturnType<typeof create_sweep_frames> | undefined
  const cleanup = $effect.root(() => {
    frames = create_sweep_frames({ sweep: () => inputs.sweep, on_error })
  })
  flushSync() // the cache's abort effect runs, as after a component mounts
  onTestFinished(cleanup)
  if (!frames) throw new Error(`cache not created`)
  return { frames, inputs, on_error, cleanup }
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
const own_mode_values: ModeValues = {
  label: `λ_qν`,
  qpoints: [
    [0, 0, 0],
    [0.5, 0, 0],
  ],
  frequencies: [[1], [2]],
  values: [[0.1], [0.2]],
}
const loaded_mode_values: ModeValues = {
  ...own_mode_values,
  qpoints: [[0.25, 0, 0]],
  frequencies: [[3]],
  values: [[NaN]],
}
const electronic_dos: ElectronicDos = {
  type: `electronic`,
  energies: [0, 1],
  densities: [1, 1],
  spin_polarized: false,
}
const ids = (calls: { args: [string, number] }[]) => calls.map(({ args }) => args[1])

test(`without a loader every frame is ready as given and requests do nothing`, () => {
  const { frames, inputs } = setup()
  const series = inputs.sweep.series[0]
  frames.request([series, [0]])
  expect(frames.is_ready(series, 0)).toBe(true)
  expect(frames.is_loading(series, 0)).toBe(false)
  expect(frames.frame(series, 1)).toBe(series.frames[1])
})

test(`a requested frame loads once, every record merged key by key over its own, mode values whole`, async () => {
  const { load, calls } = deferred_loader()
  const { frames, inputs } = setup(load)
  const series = inputs.sweep.series[0]
  series.frames[1] = {
    value: 50,
    scalars: { volume: 9, tc: 1 },
    status: { note: `relaxed` },
    doses: { total: electronic_dos },
    phonon: { doses: { 'phonon DOS': phonon_dos }, mode_values: own_mode_values },
  }
  frames.request([series, [1]])
  frames.request([series, [1]]) // already loading
  expect(load).toHaveBeenCalledExactlyOnceWith(`fcc`, 1, { signal: calls[0].signal })
  expect([frames.is_loading(series, 1), frames.is_ready(series, 1)]).toEqual([true, false])
  // frames outside the series are ready (playback never waits on them) and never loaded
  frames.request([series, [1, 3, -1]])
  expect(frames.is_ready(series, 3)).toBe(true)
  expect(load).toHaveBeenCalledOnce()

  calls[0].resolve({
    label: `loaded`,
    scalars: { tc: 12 },
    status: { unstable: true },
    doses: { Cu: electronic_dos },
    phonon: {
      band_structs: { Cu: phonon_bands },
      a2f: { 'α²F': phonon_dos },
      mode_values: loaded_mode_values,
    },
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
      mode_values: loaded_mode_values, // replaced as one field, its q-points aligned with its rows
    },
  })
  frames.request([series, [1]]) // loaded
  expect(load).toHaveBeenCalledOnce()
})

// a $state sweep edited in place: the loaded data stays with its frame object
test(`loaded data follows its frame through inserts, in-place edits show at once`, async () => {
  const { load, calls } = deferred_loader()
  const { frames, inputs } = setup(load)
  const series = inputs.sweep.series[0]
  frames.request([series, [0]])
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
  frames.request([series, [2]])
  calls[0].reject(new Error(`cluster unreachable`))
  await settle()
  expect(on_error).toHaveBeenCalledExactlyOnceWith(
    `Loading frame 2 of series "fcc" failed: cluster unreachable`,
  )
  expect(frames.is_ready(series, 2)).toBe(true)
  frames.request([series, [2]])
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
  frames.request([series, [1]])
  calls[0].resolve(data)
  await settle()
  expect(on_error).toHaveBeenCalledOnce()
  expect(on_error.mock.calls[0][0]).toContain(`Loading frame 1 of series "fcc" failed`)
  expect(on_error.mock.calls[0][0]).toContain(`load_frame("fcc", 1)${problem}`)
  expect([frames.is_ready(series, 1), frames.frame(series, 1)]).toEqual([true, series.frames[1]])
})

test(`a new sweep starts a fresh cache, aborting loads still running for the old one`, async () => {
  const { load, calls } = deferred_loader()
  const { frames, inputs, on_error } = setup(load)
  const old_series = inputs.sweep.series[0]
  frames.request([old_series, [0, 1, 2]])
  const [, old_1, old_2] = calls
  calls[0].resolve({ label: `old 0` })
  await settle()
  expect(frames.frame(old_series, 0).label).toBe(`old 0`)

  inputs.sweep = make_sweep(load)
  flushSync()
  expect([old_1.signal.aborted, old_2.signal.aborted]).toEqual([true, true])
  const series = inputs.sweep.series[0]
  expect(frames.frame(series, 0).label).toBeUndefined() // dropped with the old cache
  old_1.resolve({ label: `old 1` }) // lands in the old cache
  old_2.reject(new Error(`old sweep's server gone`)) // no longer the caller's concern
  calls.length = 0
  await settle()
  expect(frames.frame(series, 1).label).toBeUndefined()
  frames.request([series, [0]]) // loads again for the new sweep
  expect(load).toHaveBeenCalledTimes(4)
  expect(calls[0].args).toEqual([`fcc`, 0])
  expect(on_error).not.toHaveBeenCalled()
})

test(`requests from an effect rerun it for a new loader, not as loads start and settle`, async () => {
  const { load, calls } = deferred_loader()
  const inputs = $state({ sweep: make_sweep(load) })
  const on_error = vi.fn()
  let runs = 0
  const cleanup = $effect.root(() => {
    const frames = create_sweep_frames({ sweep: () => inputs.sweep, on_error })
    $effect(() => {
      runs++
      frames.request([inputs.sweep.series[0], [0, 1]])
    })
  })
  onTestFinished(cleanup)
  flushSync()
  calls[0].resolve({ label: `loaded` })
  await settle()
  expect([runs, calls.length]).toEqual([1, 2])
  // a new loader on the same sweep starts a fresh cache: the window loads through it, the old
  // loader's running load is aborted and its failure ignored
  const next = deferred_loader()
  inputs.sweep.load_frame = next.load
  flushSync()
  expect([runs, next.calls.map(({ args }) => args)]).toEqual([
    2,
    [
      [`fcc`, 0],
      [`fcc`, 1],
    ],
  ])
  expect([calls[0].signal.aborted, calls[1].signal.aborted]).toEqual([false, true])
  calls[1].reject(new DOMException(`aborted`, `AbortError`))
  await settle()
  expect(on_error).not.toHaveBeenCalled()
  // unmounting aborts the new loader's loads
  cleanup()
  expect(next.calls.map(({ signal }) => signal.aborted)).toEqual([true, true])
})

// oxfmt-ignore
test.each([
  [`resolves anyway`, (call: { resolve: (data: unknown) => void }) => call.resolve({ label: `late` })],
  [`rejects`, (call: { reject: (error: Error) => void }) => call.reject(new DOMException(`aborted`, `AbortError`))],
])(`a load leaving the window is aborted, its result neither cached nor reported when it %s, and loads again`, async (_desc, finish) => {
  const { load, calls } = deferred_loader()
  const { frames, inputs, on_error } = setup(load)
  const series = inputs.sweep.series[0]
  frames.request([series, [0, 1]])
  frames.request([series, [1, 2]]) // frame 0 leaves the window
  expect([ids(calls), calls.map(({ signal }) => signal.aborted)]).toEqual([
    [0, 1, 2],
    [true, false, false],
  ])
  expect([frames.is_loading(series, 0), frames.is_ready(series, 0)]).toEqual([false, false])
  finish(calls[0])
  await settle()
  expect(frames.frame(series, 0)).toBe(series.frames[0])
  expect(on_error).not.toHaveBeenCalled()
  frames.request([series, [0]])
  expect([ids(calls), calls[3].signal.aborted]).toEqual([[0, 1, 2, 0], false])
  calls[3].resolve({ label: `again` })
  await settle()
  expect([frames.frame(series, 0).label, frames.is_ready(series, 0)]).toEqual([`again`, true])
  expect(load).toHaveBeenCalledTimes(4)
})

test(`frames beyond the window and the recently shown ones keep only their light fields`, async () => {
  const { load, calls } = deferred_loader()
  const { frames, inputs } = setup(load, RECENT_FRAMES + 3)
  const series = inputs.sweep.series[0]
  const data = (idx: number) => ({
    label: `frame ${idx}`,
    scalars: { tc: idx },
    status: { note: `relaxed` },
    doses: { total: { ...electronic_dos, efermi: 0.5 } },
  })
  // show frames 0 to RECENT_FRAMES one by one, each prefetching its next frame
  const frame_0_states: SweepFrame[] = []
  for (let idx = 0; idx <= RECENT_FRAMES; idx++) {
    frames.request([series, [idx, idx + 1]])
    for (const call of calls) call.resolve(data(call.args[1]))
    await settle()
    frame_0_states.push(frames.frame(series, 0))
  }
  const has_dos = frame_0_states.map(({ doses }) => doses !== undefined)
  expect(has_dos).toEqual([...Array(RECENT_FRAMES).fill(true), false])
  // frame 0 dropped out of the recent frames: its DOS is gone, its trends point stays
  const evicted = frames.frame(series, 0)
  const point = (frame: SweepFrame) => descriptor_value(frame, fermi_dos_spec)
  expect([point(frame_0_states[0]), point(evicted)]).toEqual([1, 1])
  expect(evicted).toEqual({
    value: 0,
    label: `frame 0`,
    scalars: { tc: 0, fermi_dos: 1 },
    status: { note: `relaxed` },
  })
  expect(frames.is_ready(series, 0)).toBe(false)
  // the recent frames and the prefetched one keep their DOS
  const kept = series.frames.map((_frame, idx) => frames.is_ready(series, idx))
  const expected_kept = series.frames.map((_frame, idx) => idx > 0 && idx <= RECENT_FRAMES + 1)
  expect(kept).toEqual(expected_kept)
  // a prefetched frame that was never shown is evicted once the window moves past it
  frames.request([series, [RECENT_FRAMES + 2]])
  expect(frames.frame(series, RECENT_FRAMES + 1).doses).toBeUndefined()
  // an evicted frame shows its light fields while it loads again, then all of them
  frames.request([series, [0]])
  expect([frames.is_loading(series, 0), frames.frame(series, 0)]).toEqual([true, evicted])
  calls.at(-1)?.resolve(data(0))
  await settle()
  expect(frames.frame(series, 0).doses).toEqual(data(0).doses)
  expect(ids(calls).filter((idx) => idx === 0)).toHaveLength(2)
})

test(`one request windows two series: shown frames load first, both stay until dropped`, async () => {
  const { load, calls } = deferred_loader()
  const { frames, inputs } = setup(load)
  inputs.sweep.series.push({ id: `bcc`, frames: [{ value: 25 }, { value: 75 }] })
  const [fcc, bcc] = inputs.sweep.series
  frames.request([fcc, [1, 2, 0]], [bcc, [0, 1]])
  expect(calls.map(({ args }) => args)).toEqual([
    [`fcc`, 1],
    [`bcc`, 0],
    [`fcc`, 2],
    [`bcc`, 1],
    [`fcc`, 0],
  ])
  for (const call of calls) call.resolve({ label: call.args.join(` `) })
  await settle()
  expect([frames.frame(bcc, 0).label, frames.is_ready(bcc, 0)]).toEqual([`bcc 0`, true])
  // the compared series' window is left: its prefetched frame drops its data, the shown one
  // stays among the recent frames
  frames.request([fcc, [1, 2, 0]])
  expect([frames.is_ready(bcc, 0), frames.is_ready(bcc, 1)]).toEqual([true, false])
  expect(load).toHaveBeenCalledTimes(5)
})
