// Acquisition shell around <Trajectory>: `src` as URL / File / bytes, drag-and-drop (OS drags
// carry a File plus a text/plain path to ignore, FilePicker drags a URL), worker parsing with
// progress, superseded loads, run ownership, the HDF5 group picker, errors and the empty state.
import * as parse_worker from '$lib/file-viewer/parse-in-worker'
import type { TrajectoryRun, TrajHandlerData } from '$lib/trajectory'
import { Hdf5GroupSelectionRequiredError, open_trajectory } from '$lib/trajectory'
import TrajectoryFileViewer from '$lib/trajectory/TrajectoryFileViewer.svelte'
import { type ComponentProps, createRawSnippet, flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import {
  bind_props,
  create_drop_event,
  doc_query,
  gzip_bytes,
  hdf5_group_option,
  make_ambiguous_hdf5,
  make_run as make_shared_run,
  MULTI_FRAME_XYZ,
  query,
  read_binary_test_file,
} from '../setup'

type Props = ComponentProps<typeof TrajectoryFileViewer>
type WorkerParse = typeof parse_worker.parse_trajectory_in_worker

const BLOB_URL = `blob:http://localhost:5173/8a3bf2c4-d1e2-4f5a-9b8c-7d6e5f4a3b2c`
const BLOB_FILENAME = BLOB_URL.split(`/`).at(-1) ?? BLOB_URL
const ASE_FIXTURE = `ase-LiMnO2-chgnet-relax.traj`

const make_run = (filename: string, frame_count = 3): TrajectoryRun =>
  make_shared_run(frame_count, {
    frame_metadata: (frame_idx) => ({ energy: -frame_idx }),
    provenance: { filename, format: `xyz` },
  })

const mounted: ReturnType<typeof mount>[] = []
afterEach(async () => {
  for (const component of mounted.splice(0)) await unmount(component)
  vi.restoreAllMocks()
})

// No spread of `props`: bind_props getters/setters and $state proxies must keep their identity
const mount_viewer = (props: Props = {}): HTMLElement => {
  if (!(`display_mode` in props)) props.display_mode = `structure`
  if (!(`show_controls` in props)) props.show_controls = `never`
  const target = document.createElement(`div`)
  document.body.append(target)
  mounted.push(mount(TrajectoryFileViewer, { target, props }))
  flushSync()
  return target
}
const drop = (target: ParentNode, file: File, text_plain = ``): void => {
  const zone = query(target, `.trajectory-file-viewer`)
  zone.dispatchEvent(create_drop_event(file, { text_plain }))
}

// Fresh response per fetch call because response bodies are single-use streams
const stub_fetch = (content: string, headers = new Headers()) =>
  vi
    .spyOn(globalThis, `fetch`)
    .mockImplementation(() => Promise.resolve(new Response(content, { headers })))
const stub_worker = (implementation: WorkerParse) =>
  vi
    .spyOn(parse_worker, `parse_in_worker`)
    .mockImplementation(async (data, filename, _is_base64, options = {}) => ({
      type: `trajectory`,
      filename,
      data: await implementation(data, filename, options.on_progress, options.load_options, {
        signal: options.signal,
      }),
    }))
// Parses on this thread what production would hand to the worker (Blob HDF5, large payloads)
const passthrough_worker = (): ReturnType<typeof stub_worker> =>
  stub_worker(async (data, filename, on_progress, options) =>
    open_trajectory(data instanceof Blob ? await data.arrayBuffer() : data, {
      ...options,
      filename,
      on_progress,
    }),
  )
// Worker stub whose results are released by hand, to order races deliberately
const deferred_worker = () => {
  const pending: {
    filename: string
    signal?: AbortSignal
    resolve: (run: TrajectoryRun) => void
  }[] = []
  stub_worker(
    (_data, filename, _on_progress, _options, client_options) =>
      new Promise<TrajectoryRun>((resolve) => {
        pending.push({ filename, signal: client_options?.signal, resolve })
      }),
  )
  return pending
}
// Every payload goes through the (stubbed) worker path
const WORKER_ALL = { index_above_bytes: 0 }
const cancel_button = (target: ParentNode): HTMLButtonElement => {
  const button = [
    ...target.querySelectorAll<HTMLButtonElement>(`.hdf5-group-picker button`),
  ].find((candidate) => candidate.textContent?.trim() === `Cancel`)
  if (!button) throw new Error(`HDF5 picker Cancel button not found`)
  return button
}

describe(`src`, () => {
  test(`file chooser loads once and the task cancel button disposes late results`, async () => {
    const pending = deferred_worker()
    const on_file_load = vi.fn()
    const target = mount_viewer({ loading_options: WORKER_ALL, on_file_load })
    const input = target.querySelector<HTMLInputElement>(`input[type="file"]`)
    if (!input) throw new Error(`Missing file picker`)
    Object.defineProperty(input, `files`, {
      value: [new File([MULTI_FRAME_XYZ], `picked.xyz`)],
    })
    input.dispatchEvent(new Event(`change`, { bubbles: true }))
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    target.querySelector<HTMLButtonElement>(`.task-status button`)?.click()
    await vi.waitFor(() => expect(pending[0].signal?.aborted).toBe(true))
    expect(target.querySelector(`.trajectory-empty-state`)).not.toBeNull()
    const late = make_run(`picked.xyz`)
    const dispose = vi.spyOn(late, `dispose`)
    pending[0].resolve(late)
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce())
    expect(on_file_load).not.toHaveBeenCalled()
  })

  test(`loads multi-frame XYZ from a blob: URL with a UUID basename`, async () => {
    stub_fetch(MULTI_FRAME_XYZ)
    const on_file_load = vi.fn<(data: TrajHandlerData) => void>()
    const on_error = vi.fn()
    const target = mount_viewer({ src: BLOB_URL, on_file_load, on_error })
    await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledOnce())
    expect(on_file_load.mock.calls[0][0]).toMatchObject({
      frame_count: 2,
      total_atoms: 2,
      filename: BLOB_FILENAME,
      source_filename: BLOB_FILENAME,
      source_url: BLOB_URL,
    })
    expect(on_file_load.mock.calls[0][0].trajectory?.provenance.format).toBe(`xyz`)
    expect(on_error).not.toHaveBeenCalled()
    expect(target.querySelector(`.trajectory`)).not.toBeNull()
    expect(target.querySelector(`.spinner`)).toBeNull()
  })

  // oxfmt-ignore
  test.each([
    [`blob URL`, BLOB_URL, new Headers(), BLOB_FILENAME],
    [`compressed URL`, `https://example.com/bad.xyz.gz`,
      new Headers({ 'content-encoding': `gzip` }), `bad.xyz.gz`],
  ] as const)(
    `reports source identity for unparsable $label content`,
    async (_label, url, headers, source_filename) => {
      stub_fetch(`not a trajectory in any format`, headers)
      const on_file_load = vi.fn()
      const on_error = vi.fn<(data: TrajHandlerData) => void>()
      mount_viewer({ src: url, on_file_load, on_error })
      await vi.waitFor(() => expect(on_error).toHaveBeenCalledOnce())
      expect(on_error.mock.calls[0][0]).toMatchObject({ source_filename, source_url: url })
      expect(on_file_load).not.toHaveBeenCalled()
    },
  )

  test(`a failed fetch surfaces the HTTP status`, async () => {
    vi.spyOn(globalThis, `fetch`).mockResolvedValue(
      new Response(null, { status: 404, statusText: `Not Found` }),
    )
    vi.spyOn(console, `error`).mockImplementation(() => {})
    const on_error = vi.fn<(data: TrajHandlerData) => void>()
    mount_viewer({ src: `https://example.com/missing.xyz`, on_error })
    await vi.waitFor(() => expect(on_error).toHaveBeenCalledOnce())
    expect(on_error.mock.calls[0][0]).toMatchObject({
      error_msg: expect.stringContaining(`HTTP 404 Not Found`),
      filename: `missing.xyz`,
      source_filename: `missing.xyz`,
      source_url: `https://example.com/missing.xyz`,
    })
    expect(doc_query(`h3`).textContent).toBe(`Error`)
  })

  test.each([``, null])(`src %j is no source, not a URL to fetch`, async (src) => {
    // notebook hosts clear a URL trait to "" / null; fetching that resolves to the page itself
    const fetch_spy = vi.spyOn(globalThis, `fetch`)
    const on_error = vi.fn<(data: TrajHandlerData) => void>()
    mount_viewer({ src, on_error })
    await tick()
    expect(fetch_spy).not.toHaveBeenCalled()
    expect(on_error).not.toHaveBeenCalled()
    // the empty-state prompt shows, not the error banner
    expect(doc_query(`h3`).textContent).not.toBe(`Error`)
  })

  test(`a File src carries its own name and identity`, async () => {
    const file = new File([MULTI_FRAME_XYZ], `dropped.xyz`)
    const on_file_load = vi.fn<(data: TrajHandlerData) => void>()
    mount_viewer({ src: file, on_file_load })
    await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledOnce())
    expect(on_file_load.mock.calls[0][0]).toMatchObject({
      frame_count: 2,
      filename: `dropped.xyz`,
      source_filename: `dropped.xyz`,
      file,
    })
  })

  // loading_options.atom_type_mapping is how hosts (the anywidget's trait, the VS Code
  // setting) name the bare integer types of a LAMMPS dump; string keys (JSON) must work too
  test.each([
    [{ '1': `Si`, '2': `O` }, [`Si`, `O`, `O`]],
    [undefined, [`H`, `He`, `He`]],
  ] as const)(`LAMMPS src with atom_type_mapping %o`, async (atom_type_mapping, elements) => {
    const dump = `ITEM: TIMESTEP\n0\nITEM: NUMBER OF ATOMS\n3\nITEM: BOX BOUNDS pp pp pp\n0 5\n0 5\n0 5
ITEM: ATOMS id type x y z\n1 1 0 0 0\n2 2 1 1 1\n3 2 2 2 2`
    const on_file_load = vi.fn<(data: TrajHandlerData) => void>()
    mount_viewer({
      src: new File([dump], `dump.lammpstrj`),
      loading_options: { atom_type_mapping },
      on_file_load,
    })
    await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledOnce())
    const run = on_file_load.mock.calls[0][0].trajectory
    expect(run?.preview.structure.sites.map((site) => site.species[0].element)).toEqual(
      elements,
    )
    expect(run?.warnings).toHaveLength(atom_type_mapping ? 0 : 1)
  })

  test(`binary src uses filename for detection and reports the full payload`, async () => {
    const bytes = read_binary_test_file(ASE_FIXTURE)
    const on_file_load = vi.fn<(data: TrajHandlerData) => void>()
    const target = mount_viewer({
      src: bytes,
      filename: ASE_FIXTURE,
      show_controls: `always`,
      on_file_load,
    })
    await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledOnce())
    const [payload] = on_file_load.mock.calls[0]
    expect(payload).toMatchObject({
      frame_count: 2,
      total_atoms: 8,
      filename: ASE_FIXTURE,
      source_filename: ASE_FIXTURE,
      file_size: bytes.byteLength,
    })
    expect(payload.trajectory?.provenance).toMatchObject({
      format: `ase`,
      filename: ASE_FIXTURE,
    })
    expect(target.querySelector(`.filename`)?.textContent).toContain(ASE_FIXTURE)
  })

  test(`parse errors render TrajectoryError with the on_error payload and dismiss`, async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer
    const on_error = vi.fn<(data: TrajHandlerData) => void>()
    const target = mount_viewer({ src: bytes, filename: `mystery.bin`, on_error })
    await vi.waitFor(() => expect(on_error).toHaveBeenCalledOnce())
    expect(on_error.mock.calls[0][0]).toMatchObject({
      error_msg: `🚫 Binary format not supported: mystery.bin`,
      filename: `mystery.bin`,
      file_size: 4,
      source_filename: `mystery.bin`,
    })
    expect(doc_query(`h3`).textContent).toBe(`Error`)
    expect(doc_query(`p`).textContent).toContain(`Binary format not supported: mystery.bin`)
    expect(target.querySelector(`.trajectory-empty-state`)).toBeNull()
    doc_query<HTMLButtonElement>(`button`).click()
    await tick()
    expect(target.querySelector(`h3`)?.textContent).toBe(`Load Trajectory`)
    expect(target.querySelector(`.trajectory-empty-state`)).not.toBeNull()
  })

  test(`error_snippet replaces the default error view`, async () => {
    type ErrorProps = { error_msg: string; on_dismiss: () => void }
    const error_snippet = createRawSnippet<[ErrorProps]>((get_props) => ({
      render: () =>
        `<div class="custom-error"><em></em><button type="button">ok</button></div>`,
      setup: (element) => {
        const em = element.querySelector(`em`)
        const button = element.querySelector(`button`)
        if (!em || !button) throw new Error(`custom error did not render`)
        em.textContent = get_props().error_msg
        button.addEventListener(`click`, () => get_props().on_dismiss())
      },
    }))
    // a string src is a URL: fail the fetch here rather than let it escape to the network
    vi.spyOn(globalThis, `fetch`).mockRejectedValue(new Error(`network down`))
    vi.spyOn(console, `error`).mockImplementation(() => {})
    const target = mount_viewer({ src: `https://example.com/x.bin`, error_snippet })
    await vi.waitFor(() => expect(target.querySelector(`.custom-error`)).not.toBeNull())
    expect(doc_query(`.custom-error em`).textContent).toContain(`network down`)
    expect(doc_query(`.custom-error em`).textContent).toMatch(/^Failed to load trajectory/)
    expect(target.querySelector(`h3`)).toBeNull()
    doc_query<HTMLButtonElement>(`.custom-error button`).click()
    await tick()
    expect(target.querySelector(`.custom-error`)).toBeNull()
    expect(target.querySelector(`.trajectory-empty-state`)).not.toBeNull()
  })

  test(`task status shows worker progress until the run arrives`, async () => {
    let release: ((run: TrajectoryRun) => void) | undefined
    stub_worker(
      (_data, filename, on_progress) =>
        new Promise<TrajectoryRun>((resolve) => {
          on_progress?.({ current: 42.4, total: 100, stage: `Indexing frames` })
          release = () => resolve(make_run(filename))
        }),
    )
    const target = mount_viewer({
      loading_options: WORKER_ALL,
      spinner_props: { title: `Parsing in a worker` },
    })
    drop(target, new File([MULTI_FRAME_XYZ], `big.xyz`))
    await vi.waitFor(() =>
      expect(doc_query(`.task-status [role="status"]`).textContent).toBe(
        `Indexing frames (42%)`,
      ),
    )
    expect(doc_query<HTMLProgressElement>(`progress`).value).toBe(42.4)
    expect(doc_query(`.spinner`).getAttribute(`title`)).toBe(`Parsing in a worker`)
    if (!release) throw new Error(`worker stub never ran`)
    release(make_run(`big.xyz`))
    await vi.waitFor(() => expect(target.querySelector(`.trajectory`)).not.toBeNull())
    expect(target.querySelector(`.spinner`)).toBeNull()
  })

  test(`changing src aborts the in-flight load and disposes its late result`, async () => {
    const pending = deferred_worker()
    const on_file_load = vi.fn<(data: TrajHandlerData) => void>()
    const props = $state<Props>({
      src: new File([MULTI_FRAME_XYZ], `first.xyz`),
      trajectory: undefined,
      loading_options: WORKER_ALL,
      on_file_load,
    })
    const target = mount_viewer(props)
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    expect(pending[0].signal?.aborted).toBe(false)

    props.src = new File([MULTI_FRAME_XYZ], `second.xyz`)
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    expect(pending[0].signal?.aborted).toBe(true)
    expect(pending[0].signal?.reason).toMatchObject({ name: `AbortError` })
    expect(target.querySelector(`.spinner`)).not.toBeNull()

    const second = make_run(`second.xyz`)
    pending[1].resolve(second)
    await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledOnce())
    expect(props.trajectory?.provenance.filename).toBe(`second.xyz`)

    // The stale result is disposed on arrival and never shown
    const first = make_run(`first.xyz`)
    const first_dispose = vi.spyOn(first, `dispose`)
    pending[0].resolve(first)
    await vi.waitFor(() => expect(first_dispose).toHaveBeenCalledOnce())
    expect(on_file_load).toHaveBeenCalledOnce()
    expect(props.trajectory?.provenance.filename).toBe(`second.xyz`)
    expect(vi.spyOn(second, `dispose`)).not.toHaveBeenCalled()
  })

  test(`a drop supersedes a pending src load`, async () => {
    const pending = deferred_worker()
    const on_file_load = vi.fn<(data: TrajHandlerData) => void>()
    const target = mount_viewer({
      src: new File([MULTI_FRAME_XYZ], `slow.xyz`),
      loading_options: WORKER_ALL,
      on_file_load,
    })
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    drop(target, new File([MULTI_FRAME_XYZ], `fast.xyz`))
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    expect(pending[0].signal?.aborted).toBe(true)
    pending[1].resolve(make_run(`fast.xyz`))
    await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledOnce())
    const slow = make_run(`slow.xyz`)
    const slow_dispose = vi.spyOn(slow, `dispose`)
    pending[0].resolve(slow)
    await vi.waitFor(() => expect(slow_dispose).toHaveBeenCalledOnce())
    expect(on_file_load.mock.calls[0][0].filename).toBe(`fast.xyz`)
  })
})

describe(`run ownership`, () => {
  test(`a caller-supplied trajectory is shown and never disposed`, async () => {
    const run = make_run(`mine.xyz`)
    const dispose = vi.spyOn(run, `dispose`)
    const target = document.createElement(`div`)
    document.body.append(target)
    const component = mount(TrajectoryFileViewer, {
      target,
      props: { trajectory: run, display_mode: `structure`, show_controls: `always` },
    })
    flushSync()
    expect(target.querySelector(`.filename`)?.textContent).toContain(`mine.xyz`)
    expect(target.querySelector(`.trajectory-empty-state`)).toBeNull()
    await unmount(component)
    expect(dispose).not.toHaveBeenCalled()
  })

  test(`a run opened here stays live while shown and is disposed on unmount`, async () => {
    const on_file_load = vi.fn<(data: TrajHandlerData) => void>()
    const target = document.createElement(`div`)
    document.body.append(target)
    // `trajectory` deliberately unbound: the viewer owns the run outright
    const component = mount(TrajectoryFileViewer, {
      target,
      props: {
        src: new File([MULTI_FRAME_XYZ], `owned.xyz`),
        display_mode: `structure`,
        show_controls: `always`,
        on_file_load,
      },
    })
    await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledOnce())
    const run = on_file_load.mock.calls[0][0].trajectory
    if (!run) throw new Error(`on_file_load carried no run`)
    const dispose = vi.spyOn(run, `dispose`)
    await tick()
    // stepping reads frame 1 from the run, which would surface an error if it were disposed
    target.querySelector<HTMLButtonElement>(`[aria-label="Next step"]`)?.click()
    await tick()
    expect(target.querySelector(`.status-message.error`)).toBeNull()
    expect(doc_query<HTMLInputElement>(`.step-input`).value).toBe(`1`)
    await unmount(component)
    expect(dispose).toHaveBeenCalledOnce()
  })

  test(`a replaced run is disposed only after the new one is adopted`, async () => {
    const state: { trajectory: TrajectoryRun | undefined } = { trajectory: undefined }
    const on_file_load = vi.fn<(data: TrajHandlerData) => void>()
    const target = mount_viewer(
      bind_props({ src: new File([MULTI_FRAME_XYZ], `first.xyz`), on_file_load }, state),
    )
    await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledOnce())
    const first = state.trajectory
    if (!first) throw new Error(`first run not adopted`)
    const shown_at_dispose: (string | undefined)[] = []
    vi.spyOn(first, `dispose`).mockImplementation(() => {
      shown_at_dispose.push(state.trajectory?.provenance.filename)
    })

    drop(target, new File([MULTI_FRAME_XYZ], `second.xyz`))
    await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledTimes(2))
    expect(state.trajectory?.provenance.filename).toBe(`second.xyz`)
    expect(shown_at_dispose).toEqual([`second.xyz`])
  })

  test(`a caller swapping in its own run through bind:trajectory releases the owned one`, async () => {
    const on_file_load = vi.fn<(data: TrajHandlerData) => void>()
    const props = $state<Props>({
      src: new File([MULTI_FRAME_XYZ], `owned.xyz`),
      trajectory: undefined,
      on_file_load,
    })
    const target = mount_viewer(props)
    await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledOnce())
    const owned = on_file_load.mock.calls[0][0].trajectory
    if (!owned) throw new Error(`on_file_load carried no run`)
    const owned_dispose = vi.spyOn(owned, `dispose`)
    const mine = make_run(`mine.xyz`)
    const mine_dispose = vi.spyOn(mine, `dispose`)
    props.trajectory = mine
    await tick()
    expect(owned_dispose).toHaveBeenCalledOnce()
    expect(target.querySelector(`.trajectory`)).not.toBeNull()
    for (const component of mounted.splice(0)) await unmount(component)
    expect(mine_dispose).not.toHaveBeenCalled()
  })
})

describe(`drops`, () => {
  test.each([`test.xyz`, `test.xyz.gz`])(
    `loads %s with stable source identity`,
    async (source_filename) => {
      const on_file_load = vi.fn<(data: TrajHandlerData) => void>()
      const on_error = vi.fn()
      const content = source_filename.endsWith(`.gz`)
        ? await gzip_bytes(MULTI_FRAME_XYZ)
        : MULTI_FRAME_XYZ
      const target = mount_viewer({ on_file_load, on_error })
      // IDE/file-manager drags also set text/plain to the source path
      drop(target, new File([content], source_filename), `/home/user/${source_filename}`)
      await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledOnce())
      expect(on_file_load.mock.calls[0][0]).toMatchObject({
        frame_count: 2,
        filename: `test.xyz`,
        source_filename,
      })
      expect(on_error).not.toHaveBeenCalled()
    },
  )

  test(`reports corrupt compressed files with stable source identity`, async () => {
    const on_error = vi.fn<(data: TrajHandlerData) => void>()
    const target = mount_viewer({ on_error })
    drop(target, new File([`not gzip data`], `broken.xyz.gz`))
    await vi.waitFor(() =>
      expect(on_error).toHaveBeenCalledWith(
        expect.objectContaining({
          error_msg: expect.stringContaining(`broken.xyz.gz: Failed to decompress gzip file`),
        }),
      ),
    )
    expect(doc_query(`p`).textContent).toContain(`broken.xyz.gz`)
  })

  test(`allow_file_drop=false ignores drops`, async () => {
    const on_file_load = vi.fn()
    const on_error = vi.fn()
    const target = mount_viewer({ allow_file_drop: false, on_file_load, on_error })
    drop(target, new File([MULTI_FRAME_XYZ], `ignored.xyz`))
    await tick()
    await tick()
    expect(target.querySelector(`.trajectory-empty-state`)).not.toBeNull()
    expect(target.querySelector(`.spinner`)).toBeNull()
    expect(on_file_load).not.toHaveBeenCalled()
    expect(on_error).not.toHaveBeenCalled()
  })
})

// Each group choice mounts the full <Trajectory> viewer (~0.4 s cold for the first 3D mount
// in a worker, 5-10x that under CPU contention) and the first test does so three times, so
// the describe gets more than the 5 s default. Parsing a group itself takes ~5 ms.
describe(`HDF5 group picker`, { timeout: 20_000 }, () => {
  // Writing the fixture loads and initialises h5wasm (the same instance the passthrough
  // parse then reuses). That WASM compile is the one slow step here: ~0.7 s alone, several
  // seconds under CPU contention, so it runs once up front under its own timeout instead
  // of inside the first test's budget.
  let ambiguous_bytes: ArrayBuffer
  beforeAll(async () => {
    ambiguous_bytes = await make_ambiguous_hdf5()
  }, 60_000)

  const drop_ambiguous = async (props: Props = {}) => {
    passthrough_worker()
    const on_file_load = vi.fn<(data: TrajHandlerData) => void>()
    const on_error = vi.fn<(data: TrajHandlerData) => void>()
    const target = mount_viewer({ on_file_load, on_error, ...props })
    drop(target, new File([ambiguous_bytes], `ambiguous.h5`))
    await vi.waitFor(() =>
      expect(target.querySelectorAll(`button[data-hdf5-group]`)).toHaveLength(8),
    )
    return { target, on_file_load, on_error }
  }

  test(`an ambiguous file opens the picker; a choice loads that group`, async () => {
    const { target, on_file_load, on_error } = await drop_ambiguous({
      show_controls: `always`,
    })
    const picker = doc_query(`.hdf5-group-picker`)
    expect(picker.getAttribute(`role`)).toBe(`dialog`)
    // an inline panel, not an overlay: nothing else on the page is inert while it shows
    expect(picker.hasAttribute(`aria-modal`)).toBe(false)
    expect(picker.textContent).toContain(`ambiguous.h5`)
    expect(
      [...target.querySelectorAll(`.hdf5-path-trunk`)].map((trunk) => trunk.textContent),
    ).toEqual([`/molecules/h2o/replicas`, `/molecules/nh3/replicas`])
    expect(
      [...target.querySelectorAll(`.hdf5-path-group`)].map((group) =>
        [...group.querySelectorAll(`button[data-hdf5-group]`)].map(
          (option) => option.textContent,
        ),
      ),
    ).toEqual([
      [`0`, `1`, `2`, `10`],
      [`0`, `1`, `2`, `10`],
    ])
    expect(target.querySelector(`.spinner`)).toBeNull()

    hdf5_group_option(target, `/molecules/nh3/replicas/0`).click()
    await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledOnce())
    expect(target.querySelector(`button[data-hdf5-group]`)).toBeNull()
    const run = on_file_load.mock.calls[0][0].trajectory
    expect(run?.provenance).toMatchObject({
      filename: `ambiguous.h5`,
      hdf5_group: `/molecules/nh3/replicas/0`,
    })
    expect(run?.preview.structure.sites[0]).toMatchObject({
      xyz: [9, 0, 0],
      species: [{ element: `H` }],
    })
    expect(on_error).not.toHaveBeenCalled()

    // The back button reopens the picker over the loaded run; Cancel returns to it
    doc_query<HTMLButtonElement>(`[data-hdf5-group-picker-back]`).click()
    await tick()
    expect(target.querySelectorAll(`button[data-hdf5-group]`)).toHaveLength(8)
    cancel_button(target).click()
    await tick()
    expect(target.querySelector(`button[data-hdf5-group]`)).toBeNull()
    expect(target.querySelector(`.filename`)?.textContent).toContain(`ambiguous.h5`)

    // Picking another group swaps the run and disposes the previous one
    const first_dispose = run ? vi.spyOn(run, `dispose`) : undefined
    doc_query<HTMLButtonElement>(`[data-hdf5-group-picker-back]`).click()
    await tick()
    hdf5_group_option(target, `/molecules/h2o/replicas/10`).click()
    await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledTimes(2))
    expect(on_file_load.mock.calls[1][0].trajectory?.provenance.hdf5_group).toBe(
      `/molecules/h2o/replicas/10`,
    )
    expect(first_dispose).toHaveBeenCalledOnce()
  })

  // Picking a group re-parses the payload already in hand: re-fetching (and re-inflating) a
  // multi-GB HDF5 just to read a different group would double the wait
  test(`a group pick reuses the fetched payload instead of downloading again`, async () => {
    passthrough_worker()
    const gz = await new Response(
      new Blob([ambiguous_bytes]).stream().pipeThrough(new CompressionStream(`gzip`)),
    ).arrayBuffer()
    const fetch_spy = vi
      .spyOn(globalThis, `fetch`)
      .mockImplementation(() => Promise.resolve(new Response(gz)))
    const on_file_load = vi.fn<(data: TrajHandlerData) => void>()
    const target = mount_viewer({ src: `https://example.com/ambiguous.h5.gz`, on_file_load })
    await vi.waitFor(() =>
      expect(target.querySelectorAll(`button[data-hdf5-group]`)).toHaveLength(8),
    )
    expect(fetch_spy).toHaveBeenCalledOnce()

    hdf5_group_option(target, `/molecules/nh3/replicas/0`).click()
    await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledOnce())
    expect(fetch_spy).toHaveBeenCalledOnce()
    expect(on_file_load.mock.calls[0][0].trajectory?.provenance).toMatchObject({
      hdf5_group: `/molecules/nh3/replicas/0`,
    })
  })

  test(`Cancel without a loaded run returns to the empty state`, async () => {
    const { target, on_file_load } = await drop_ambiguous()
    cancel_button(target).click()
    await tick()
    expect(target.querySelector(`.trajectory-empty-state`)).not.toBeNull()
    expect(target.querySelector(`[data-hdf5-group-picker-back]`)).toBeNull()
    expect(on_file_load).not.toHaveBeenCalled()
  })

  test(`replaces a pending HDF5 group selection with a new drop`, async () => {
    const { target, on_file_load, on_error } = await drop_ambiguous()
    drop(target, new File([MULTI_FRAME_XYZ], `replacement.xyz`))
    await vi.waitFor(() =>
      expect(on_file_load).toHaveBeenCalledWith(
        expect.objectContaining({ filename: `replacement.xyz`, frame_count: 2 }),
      ),
    )
    expect(target.querySelector(`button[data-hdf5-group]`)).toBeNull()
    expect(target.querySelector(`[data-hdf5-group-picker-back]`)).toBeNull()
    expect(on_error).not.toHaveBeenCalled()
  })

  test(`a failing group choice shows the error inside the picker and keeps the shown run`, async () => {
    const run_0 = make_run(`groups.h5`)
    const run_0_dispose = vi.spyOn(run_0, `dispose`)
    stub_worker(async (_data, _filename, _on_progress, options) => {
      if (!options?.hdf5_group_path) {
        throw new Hdf5GroupSelectionRequiredError([`/run/0`, `/run/1`])
      }
      if (options.hdf5_group_path === `/run/1`) throw new Error(`broken group /run/1`)
      return run_0
    })
    const on_file_load = vi.fn<(data: TrajHandlerData) => void>()
    const on_error = vi.fn<(data: TrajHandlerData) => void>()
    const target = mount_viewer({ show_controls: `always`, on_file_load, on_error })
    drop(target, new File([new Uint8Array(8)], `groups.h5`))
    await vi.waitFor(() =>
      expect(hdf5_group_option(target, `/run/0`)).toBeInstanceOf(HTMLElement),
    )
    expect(doc_query(`.hdf5-path-trunk`).textContent).toBe(`/run`)

    hdf5_group_option(target, `/run/1`).click()
    await vi.waitFor(() =>
      expect(
        target.querySelector(`.hdf5-group-picker .status-message.error`)?.textContent,
      ).toContain(`broken group /run/1`),
    )
    expect(target.querySelectorAll(`button[data-hdf5-group]`)).toHaveLength(2)
    expect(on_error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        error_msg: `Failed to parse trajectory: groups.h5: broken group /run/1`,
        filename: `groups.h5`,
      }),
    )

    hdf5_group_option(target, `/run/0`).click()
    await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledOnce())
    expect(target.querySelector(`.status-message.error`)).toBeNull()
    expect(target.querySelector(`.filename`)?.textContent).toContain(`groups.h5`)

    // Failing again from the back button leaves the loaded run in place
    doc_query<HTMLButtonElement>(`[data-hdf5-group-picker-back]`).click()
    await tick()
    hdf5_group_option(target, `/run/1`).click()
    await vi.waitFor(() =>
      expect(target.querySelector(`.hdf5-group-picker .status-message.error`)).not.toBeNull(),
    )
    cancel_button(target).click()
    await tick()
    expect(target.querySelector(`.status-message.error`)).toBeNull()
    expect(target.querySelector(`.filename`)?.textContent).toContain(`groups.h5`)
    expect(target.querySelector(`[data-hdf5-group-picker-back]`)).not.toBeNull()
    expect(run_0_dispose).not.toHaveBeenCalled()
    expect(on_file_load).toHaveBeenCalledOnce()
  })
})

describe(`bindable re-exposure`, () => {
  test(`current_step_idx, display_mode, active_pane and trajectory round-trip`, async () => {
    const on_file_load = vi.fn<(data: TrajHandlerData) => void>()
    const props = $state<Props>({
      src: new File([MULTI_FRAME_XYZ], `bound.xyz`),
      trajectory: undefined,
      current_step_idx: 0,
      display_mode: `structure`,
      active_pane: null,
      show_controls: `always`,
      on_file_load,
    })
    const target = mount_viewer(props)
    await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledOnce())
    expect(props.trajectory?.provenance.filename).toBe(`bound.xyz`)
    expect(props.trajectory?.frame_count).toBe(2)

    props.current_step_idx = 1
    await tick()
    expect(doc_query<HTMLInputElement>(`.step-input`).value).toBe(`1`)
    target.querySelector<HTMLButtonElement>(`[aria-label="Previous step"]`)?.click()
    await tick()
    expect(props.current_step_idx).toBe(0)

    props.display_mode = `scatter`
    await tick()
    expect(target.querySelector(`.structure`)).toBeNull()

    doc_query<HTMLButtonElement>(`.trajectory-info-toggle`).click()
    await tick()
    expect(props.active_pane).toBe(`info`)
    props.active_pane = null
    await tick()
    expect(target.querySelector(`.viewer-pane-open`)).toBeNull()
  })
})
