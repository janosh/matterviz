// Drop handling on the Trajectory viewer: OS/IDE drags carry a File (often plus a text/plain
// path that must be ignored), FilePicker drags carry a URL, and ambiguous HDF5 files open a
// group picker whose pending choice must survive or yield to later drops correctly.
import Trajectory from '$lib/trajectory/Trajectory.svelte'
import * as parse_worker from '$lib/file-viewer/parse-in-worker'
import * as trajectory_parse from '$lib/trajectory/parse'
import { parse_hdf5_trajectory } from '$lib/trajectory/parse/hdf5'
import { mount, unmount, type ComponentProps } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import {
  create_drop_event,
  delay_file_read,
  gzip_bytes,
  hdf5_group_option,
  make_ambiguous_hdf5,
  MULTI_FRAME_XYZ,
} from '../setup'

const mounted: ReturnType<typeof mount>[] = []
let restore_hdf5_parse_worker: (() => void) | undefined

const stub_hdf5_parse_worker = (): void => {
  const worker_spy = vi
    .spyOn(parse_worker, `parse_trajectory_in_worker`)
    .mockImplementation(async (data, filename, _on_progress, options) => {
      if (!(data instanceof Blob || data instanceof ArrayBuffer)) {
        throw new Error(`Expected HDF5 worker source, got ${typeof data}`)
      }
      return parse_hdf5_trajectory(
        data instanceof Blob ? await data.arrayBuffer() : data,
        filename,
        options.hdf5_group_path,
      )
    })
  restore_hdf5_parse_worker = () => worker_spy.mockRestore()
}

const drop_file = (
  file: File,
  handlers: Partial<Pick<ComponentProps<typeof Trajectory>, `on_file_load` | `on_error`>>,
  text_plain = ``,
): HTMLElement => {
  mounted.push(
    mount(Trajectory, {
      target: document.body,
      props: { display_mode: `structure`, show_controls: `never`, ...handlers },
    }),
  )
  const viewer = document.querySelector<HTMLElement>(`.trajectory`)
  if (!viewer) throw new Error(`Trajectory root not found`)
  viewer.dispatchEvent(create_drop_event(file, { text_plain }))
  return viewer
}

const drop_ambiguous_hdf5 = async () => {
  const on_file_load = vi.fn()
  const on_error = vi.fn()
  const file = new File([await make_ambiguous_hdf5()], `ambiguous.h5`)
  stub_hdf5_parse_worker()
  const viewer = drop_file(file, { on_file_load, on_error })
  await vi.waitFor(() =>
    expect(document.querySelectorAll(`button[data-hdf5-group]`)).toHaveLength(8),
  )
  return { file, on_file_load, on_error, viewer }
}

afterEach(async () => {
  restore_hdf5_parse_worker?.()
  restore_hdf5_parse_worker = undefined
  for (const app of mounted.splice(0)) await unmount(app)
})

test.each([`test.xyz`, `test.xyz.gz`])(
  `loads %s with stable source identity`,
  async (source_filename) => {
    const on_file_load = vi.fn()
    const on_error = vi.fn()
    const content = source_filename.endsWith(`.gz`)
      ? await gzip_bytes(MULTI_FRAME_XYZ)
      : MULTI_FRAME_XYZ
    const file = new File([content], source_filename)
    // IDE/file-manager drags also set text/plain to the source path
    drop_file(file, { on_file_load, on_error }, `/home/user/${source_filename}`)

    await vi.waitFor(() =>
      expect(on_file_load).toHaveBeenCalledWith(
        expect.objectContaining({
          frame_count: 2,
          filename: `test.xyz`,
          source_filename,
        }),
      ),
    )
    expect(on_error).not.toHaveBeenCalled()
  },
)

test(`reports corrupt compressed files with stable source identity`, async () => {
  const on_error = vi.fn()
  const file = new File([`not gzip data`], `broken.xyz.gz`)
  drop_file(file, { on_error })

  await vi.waitFor(() =>
    expect(on_error).toHaveBeenCalledWith({
      error_msg: expect.stringContaining(`Failed to load file:`),
      filename: file.name,
      source_filename: file.name,
      file_size: file.size,
    }),
  )
})

test(`chooses an HDF5 trajectory group before loading it`, async () => {
  const { on_file_load, on_error } = await drop_ambiguous_hdf5()

  expect(
    [...document.querySelectorAll(`.hdf5-path-trunk`)].map((trunk) => trunk.textContent),
  ).toEqual([`/molecules/h2o/replicas`, `/molecules/nh3/replicas`])
  expect(
    [...document.querySelectorAll(`.hdf5-path-group`)].map((group) =>
      [...group.querySelectorAll(`button[data-hdf5-group]`)].map(
        (option) => option.textContent,
      ),
    ),
  ).toEqual([
    [`0`, `1`, `2`, `10`],
    [`0`, `1`, `2`, `10`],
  ])
  expect(document.querySelector(`select[aria-label="HDF5 trajectory group"]`)).toBeNull()
  const group_options = document.querySelector<HTMLElement>(`.hdf5-group-options`)
  if (!group_options) throw new Error(`HDF5 group options not rendered`)
  expect(group_options.style.flex).toBe(`initial`)
  expect(
    document.querySelector<HTMLButtonElement>(`.hdf5-group-options + button`)?.style.marginTop,
  ).toBe(`0.5rem`)
  hdf5_group_option(document, `/molecules/nh3/replicas/0`).click()

  await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledOnce())
  expect(document.querySelector(`button[data-hdf5-group]`)).toBeNull()
  expect(on_file_load.mock.calls[0][0].trajectory?.frames[0].structure.sites[0]).toMatchObject(
    {
      xyz: [9, 0, 0],
      species: [{ element: `H` }],
    },
  )
  expect(on_error).not.toHaveBeenCalled()
})

test(`locks HDF5 group choices while reading the chosen local file`, async () => {
  const { file, on_file_load, on_error } = await drop_ambiguous_hdf5()

  const delayed_read = await delay_file_read(file)
  try {
    hdf5_group_option(document, `/molecules/h2o/replicas/0`).click()
    hdf5_group_option(document, `/molecules/nh3/replicas/0`).click()
    delayed_read.release()

    await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledOnce())
    expect(
      on_file_load.mock.calls[0][0].trajectory?.frames[0].structure.sites[0],
    ).toMatchObject({
      xyz: [1, 0, 0],
      species: [{ element: `Au` }],
    })
    expect(on_error).not.toHaveBeenCalled()
  } finally {
    delayed_read.restore()
  }
})

test(`does not replace a newer drop when a chosen HDF5 group finishes late`, async () => {
  const { file, on_file_load, on_error, viewer } = await drop_ambiguous_hdf5()

  const delayed_read = await delay_file_read(file)
  const parse_spy = vi.spyOn(trajectory_parse, `parse_trajectory_async`)
  try {
    hdf5_group_option(document, `/molecules/h2o/replicas/0`).click()
    viewer.dispatchEvent(create_drop_event(new File([MULTI_FRAME_XYZ], `replacement.xyz`)))
    await vi.waitFor(() =>
      expect(on_file_load).toHaveBeenCalledWith(
        expect.objectContaining({ filename: `replacement.xyz`, frame_count: 2 }),
      ),
    )
    delayed_read.release()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(on_file_load).toHaveBeenCalledOnce()
    expect(on_error).not.toHaveBeenCalled()
    expect(parse_spy.mock.calls.map(([, filename]) => filename)).toEqual([`replacement.xyz`])
  } finally {
    delayed_read.restore()
    parse_spy.mockRestore()
  }
})

test(`replaces a pending HDF5 group selection with a new drop`, async () => {
  const { on_file_load, on_error, viewer } = await drop_ambiguous_hdf5()

  viewer.dispatchEvent(create_drop_event(new File([MULTI_FRAME_XYZ], `replacement.xyz`)))
  await vi.waitFor(() =>
    expect(on_file_load).toHaveBeenCalledWith(
      expect.objectContaining({ filename: `replacement.xyz`, frame_count: 2 }),
    ),
  )
  expect(document.querySelector(`button[data-hdf5-group]`)).toBeNull()
  expect(on_error).not.toHaveBeenCalled()
})
