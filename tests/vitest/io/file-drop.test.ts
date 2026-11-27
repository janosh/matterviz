import type { FileDropOptions } from '#lib/io/file-drop'
import {
  create_file_drop_handler,
  file_drop_zone,
  raw_file_drop_zone,
} from '#lib/io/file-drop'
import type * as DecompressModule from '#lib/io/decompress'
import { decompress_file } from '#lib/io/decompress'
import type { FileLoadCallback, TrajectoryFileLoadCallback } from '#lib/io/types'
import { load_from_url, load_trajectory_from_url } from '#lib/io/url-drop'
import { beforeEach, describe, expect, onTestFinished, test, vi } from 'vite-plus/test'

// decompress_trajectory_file stays real so the keep_blob mode is exercised end to end
vi.mock(`#lib/io/decompress`, async (import_original) => ({
  ...(await import_original<typeof DecompressModule>()),
  decompress_file: vi.fn(),
}))
vi.mock(`#lib/io/url-drop`, () => ({
  load_from_url: vi.fn(),
  load_trajectory_from_url: vi.fn(),
}))

// The default (text/ArrayBuffer) branch of the FileDropOptions union
type TextDropOptions = Extract<FileDropOptions, { on_drop: FileLoadCallback }>

// A drag event carrying files (empty items: no entry API, so the flat list is used), or a
// FilePicker-style link drag when `url` is given
const drag = (
  type: string,
  files: File[] = [],
  { items = [] as unknown[], url = `` } = {},
) => {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent
  const types = url ? [`text/uri-list`] : [`Files`]
  const getData = (format: string) => (format === `text/uri-list` ? url : ``)
  Object.defineProperty(event, `dataTransfer`, { value: { types, files, items, getData } })
  return event
}
const URL_SRC = `https://example.com/f.cif`
// a local drop also carries the File itself, for size and webkitRelativePath; a URL drop
// has no File to carry
// what decompress_file resolves to
const loaded = (content: string | ArrayBuffer, filename: string) => ({
  content,
  filename,
  byte_size: 0,
})
const source_meta = (source_filename: string, source_url?: string) =>
  source_url
    ? { source_filename, source_url }
    : { source_filename, file: expect.any(File) as File }

describe(`create_file_drop_handler`, () => {
  let on_drop: FileLoadCallback
  let on_error: FileDropOptions[`on_error`]
  let set_loading: FileDropOptions[`set_loading`]

  beforeEach(() => {
    vi.clearAllMocks()
    on_drop = vi.fn<FileLoadCallback>()
    on_error = vi.fn<NonNullable<FileDropOptions[`on_error`]>>()
    set_loading = vi.fn<NonNullable<FileDropOptions[`set_loading`]>>()
  })

  const run = (opts: Partial<TextDropOptions> = {}, sources: (File | string)[] = []) => {
    const defaults: TextDropOptions = { on_drop, on_error, set_loading }
    return create_file_drop_handler({ ...defaults, ...opts } as TextDropOptions)(sources)
  }

  test(`empty batch toggles loading, loads and reports nothing`, async () => {
    await run()
    expect(set_loading).toHaveBeenNthCalledWith(1, true)
    expect(set_loading).toHaveBeenLastCalledWith(false)
    expect(decompress_file).not.toHaveBeenCalled()
    expect(on_drop).not.toHaveBeenCalled()
    expect(on_error).not.toHaveBeenCalled()
  })

  test(`processes a URL and files sequentially when both are present`, async () => {
    vi.mocked(load_from_url).mockImplementation(async (_url, callback) => {
      await callback(`remote`, `f.cif`, source_meta(`f.cif`, `https://example.com/f.cif`))
    })
    const file = new File([`local`], `test.txt`)
    vi.mocked(decompress_file).mockResolvedValue(loaded(`local`, file.name))

    await run({}, [URL_SRC, file])

    expect(load_from_url).toHaveBeenCalledWith(
      `https://example.com/f.cif`,
      expect.any(Function),
    )
    expect(decompress_file).toHaveBeenCalledWith(file)
    expect(vi.mocked(on_drop).mock.calls).toEqual([
      [`remote`, `f.cif`, source_meta(`f.cif`, `https://example.com/f.cif`)],
      [`local`, `test.txt`, source_meta(`test.txt`)],
    ])
  })

  // a lone URL's report names no label (the message says "from URL"); next to files it is one
  // item of the batch report
  test.each([
    [[], `Failed to load from URL: 404`],
    [
      [new File([`y`], `b.cube.gz`)],
      `Failed to load 1 file — URL https://example.com/f.cif: 404`,
    ],
  ])(
    `a failed URL drop with %j still loads the files and reports %s`,
    async (files, error) => {
      vi.mocked(load_from_url).mockRejectedValue(new Error(`404`))
      vi.mocked(decompress_file).mockResolvedValue(loaded(`data`, `b.cube`))
      await run({}, [URL_SRC, ...files])
      expect(vi.mocked(on_drop).mock.calls).toEqual(
        files.length ? [[`data`, `b.cube`, source_meta(`b.cube.gz`)]] : [],
      )
      expect(on_error).toHaveBeenCalledExactlyOnceWith(error)
    },
  )

  // URL drops skipped the empty check files get, handing on_drop a 0-byte payload
  test.each([``, new ArrayBuffer(0)])(
    `an empty URL payload %j is reported`,
    async (content) => {
      vi.mocked(load_from_url).mockImplementation(async (_url, callback) => {
        await callback(content, `f.cif`, source_meta(`f.cif`, `https://example.com/f.cif`))
      })
      await run({}, [URL_SRC])
      expect(on_drop).not.toHaveBeenCalled()
      expect(on_error).toHaveBeenCalledExactlyOnceWith(
        `Failed to load from URL: file is empty`,
      )
    },
  )

  test.each([
    {
      rejection: new Error(`corrupt gzip`),
      expected: `corrupt gzip`,
      desc: `decompress Error`,
    },
    { rejection: `string error`, expected: `string error`, desc: `decompress string` },
    { rejection: new Error(`parse failed`), expected: `parse failed`, desc: `on_drop` },
    // empty decompressed content is a failure, not a silent skip
    { rejection: null, expected: `file is empty`, desc: `empty file` },
    // an empty binary payload is a truthy 0-byte ArrayBuffer
    { rejection: null, expected: `file is empty`, desc: `empty binary file` },
  ])(`formats on_error from a $desc rejection and clears loading`, async (row) => {
    const { rejection, expected, desc } = row
    const throwing_drop = vi.fn().mockRejectedValue(rejection)
    if (desc === `on_drop` || desc.startsWith(`empty`)) {
      const content =
        desc === `on_drop` ? `x` : desc === `empty file` ? `` : new ArrayBuffer(0)
      vi.mocked(decompress_file).mockResolvedValue(loaded(content, `f.txt`))
    } else vi.mocked(decompress_file).mockRejectedValue(rejection)
    await run({ on_drop: throwing_drop }, [new File([`x`], `f.txt`)])
    expect(on_error).toHaveBeenCalledWith(`Failed to load 1 file — f.txt: ${expected}`)
    expect(throwing_drop).toHaveBeenCalledTimes(desc === `on_drop` ? 1 : 0)
    expect(set_loading).toHaveBeenLastCalledWith(false)
  })

  test.each([
    [0, [new File([`x`], `a.yaml`)], `Drop at most 0 files at a time (received 1)`],
    [
      1,
      [new File([`x`], `a.yaml`), new File([`y`], `b.yaml`)],
      `Drop at most 1 file at a time (received 2)`,
    ],
  ] as const)(
    `rejects a batch larger than max_files=$max_files`,
    async (max_files, files, error) => {
      await run({ max_files }, [...files])
      expect(decompress_file).not.toHaveBeenCalled()
      expect(on_drop).not.toHaveBeenCalled()
      expect(on_error).toHaveBeenCalledWith(error)
    },
  )

  test.each([-1, 1.5, NaN, Infinity])(
    `rejects invalid max_files=%s when creating the handler`,
    (max_files) => {
      expect(() => create_file_drop_handler({ on_drop, max_files })).toThrow(
        `max_files must be a non-negative integer`,
      )
    },
  )

  // a drop whose every file fails has no batch
  test(`on_batch gets each drop's loaded files once, failures reported after it`, async () => {
    vi.mocked(load_from_url).mockImplementation(async (_url, callback) => {
      await callback(`remote`, `u.cif`, source_meta(`u.cif`, `https://example.com/u.cif`))
    })
    vi.mocked(decompress_file)
      .mockResolvedValueOnce(loaded(`first`, `a.cube`))
      .mockRejectedValueOnce(new Error(`corrupt`))
      .mockRejectedValueOnce(new Error(`bad`))
    const calls: unknown[] = []
    const handler = create_file_drop_handler({
      on_error: (msg) => calls.push(msg),
      on_batch: (files) => void calls.push(files),
    })
    const [file_a, file_b] = [`a`, `b`].map((name) => new File([name], `${name}.cube`))
    await handler([`https://example.com/u.cif`, file_a, file_b])
    await handler([new File([`d`], `d.cube`)])
    expect(calls).toEqual([
      [
        {
          content: `remote`,
          filename: `u.cif`,
          metadata: source_meta(`u.cif`, `https://example.com/u.cif`),
        },
        { content: `first`, filename: `a.cube`, metadata: source_meta(`a.cube`) },
      ],
      `Failed to load 1 file — b.cube: corrupt`,
      `Failed to load 1 file — d.cube: bad`,
    ])
  })

  // Files load sequentially in drop order; a failing file never aborts the rest and all
  // failures aggregate into one message
  const ok_a = loaded(`first`, `a.cube`)
  const ok_b = loaded(`second`, `b.cube`)
  test.each([
    [
      `both load`,
      [ok_a, ok_b],
      [
        [`first`, `a.cube`, source_meta(`a.cube.gz`)],
        [`second`, `b.cube`, source_meta(`b.cube.gz`)],
      ],
      undefined,
    ],
    [
      `first fails`,
      [new Error(`corrupt`), ok_b],
      [[`second`, `b.cube`, source_meta(`b.cube.gz`)]],
      `Failed to load 1 file — a.cube.gz: corrupt`,
    ],
    [
      `both fail`,
      [new Error(`corrupt`), new Error(`bad header`)],
      [],
      `Failed to load 2 files — a.cube.gz: corrupt; b.cube.gz: bad header`,
    ],
  ])(`two-file batch where %s`, async (_desc, outcomes, drops, error) => {
    for (const outcome of outcomes) {
      if (outcome instanceof Error) vi.mocked(decompress_file).mockRejectedValueOnce(outcome)
      else vi.mocked(decompress_file).mockResolvedValueOnce(outcome)
    }
    await run({}, [new File([`x`], `a.cube.gz`), new File([`y`], `b.cube.gz`)])
    expect(vi.mocked(on_drop).mock.calls).toEqual(drops)
    if (error) expect(on_error).toHaveBeenCalledExactlyOnceWith(error)
    else expect(on_error).not.toHaveBeenCalled()
    expect(set_loading).toHaveBeenLastCalledWith(false)
  })

  // Trajectory viewers keep HDF5 and text payloads Blob-backed: h5wasm reads HDF5 lazily
  // instead of materialising the whole file, and text decodes in the parse worker
  test(`keep_blob hands .h5 and text drops over as Blobs, URLs to the trajectory loader`, async () => {
    const trajectory_drop = vi.fn<TrajectoryFileLoadCallback>()
    const hdf5_signature = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]
    const h5_file = new File(
      [new Uint8Array([...hdf5_signature, ...Array(64).fill(0)])],
      `run.h5`,
    )
    const xyz_text = `2\nstep=0\nH 0 0 0\nH 0 0 0.74\n`
    const handler = create_file_drop_handler({
      keep_blob: true,
      on_drop: trajectory_drop,
      on_error,
    })
    await handler([`https://example.com/run.h5`, h5_file, new File([xyz_text], `h2.xyz`)])

    expect(load_trajectory_from_url).toHaveBeenCalledWith(
      `https://example.com/run.h5`,
      expect.any(Function),
    )
    expect(load_from_url).not.toHaveBeenCalled()
    expect(decompress_file).not.toHaveBeenCalled()
    expect(on_error).not.toHaveBeenCalled()
    const [[h5_content, h5_name, h5_meta], [xyz_content, xyz_name]] =
      trajectory_drop.mock.calls
    expect(h5_content).toBeInstanceOf(Blob)
    expect((h5_content as Blob).size).toBe(h5_file.size)
    expect(h5_name).toBe(`run.h5`)
    expect(h5_meta).toEqual({ source_filename: `run.h5`, file: h5_file })
    expect(xyz_name).toBe(`h2.xyz`)
    expect(await (xyz_content as Blob).text()).toBe(xyz_text)
  })
})

// Overlapping drops must serialize here too: the raw zone hands sources straight to
// open_material, whose commit mutates viewer state the same way the reading zone's does.
test(`raw_file_drop_zone queues overlapping drops`, async () => {
  const order: string[] = []
  const on_drop = vi.fn(async (source: string | File) => {
    const name = typeof source === `string` ? source : source.name
    order.push(`start ${name}`)
    await Promise.resolve() // yield so an interleaved drop could sneak in
    order.push(`end ${name}`)
  })
  const node = document.createElement(`div`)
  const detach = raw_file_drop_zone({ allow: () => true, on_drop })(node) as () => void
  // back to back, so the second lands while the first is still being read: neither is lost
  for (const name of [`a.cif`, `b.cif`])
    node.dispatchEvent(drag(`drop`, [new File([name], name)]))
  await vi.waitFor(() => expect(order).toHaveLength(4))
  expect(order).toEqual([`start a.cif`, `end a.cif`, `start b.cif`, `end b.cif`])
  detach()
})

test(`file_drop_zone hover state: no child-to-child flicker, allow is live, cleared on drop and detach`, async () => {
  vi.clearAllMocks()
  vi.mocked(decompress_file).mockResolvedValue(loaded(`ok`, `f.cif`))
  const node = document.createElement(`div`)
  const [child_a, child_b] = [document.createElement(`span`), document.createElement(`span`)]
  node.append(child_a, child_b)
  const [on_drop, on_dragover, set_loading] = [vi.fn(), vi.fn(), vi.fn()]
  let allowed = true
  const detach = file_drop_zone({ allow: () => allowed, on_drop, on_dragover, set_loading })(
    node,
  )
  const has_class = () => node.classList.contains(`dragover`)

  // moving between children fires the new child's dragenter before the old one's dragleave
  child_a.dispatchEvent(drag(`dragenter`))
  child_b.dispatchEvent(drag(`dragenter`))
  child_a.dispatchEvent(drag(`dragleave`))
  expect(has_class()).toBe(true)
  child_b.dispatchEvent(drag(`dragleave`))
  expect(has_class()).toBe(false)
  allowed = false
  node.dispatchEvent(drag(`dragenter`))
  expect(has_class()).toBe(false)
  const blocked = drag(`drop`, [new File([`x`], `x.cif`)])
  node.dispatchEvent(blocked)
  // left to an enclosing zone (a Trajectory around its drop-disabled Structure); on its own
  // the browser never fires it, since dragover reported dropEffect none
  expect(blocked.defaultPrevented).toBe(false)
  expect(on_drop).not.toHaveBeenCalled()
  allowed = true

  // a drop clears the hover state immediately (no dragleave follows) and reaches on_drop
  node.dispatchEvent(drag(`dragenter`))
  const drop_event = drag(`drop`, [new File([`ok`], `f.cif`)])
  node.dispatchEvent(drop_event)
  expect(drop_event.defaultPrevented).toBe(true)
  expect(has_class()).toBe(false)
  await vi.waitFor(() =>
    expect(on_drop).toHaveBeenCalledWith(`ok`, `f.cif`, source_meta(`f.cif`)),
  )
  expect(set_loading.mock.calls.map(([loading]) => loading)).toEqual([true, false])
  expect(on_dragover.mock.calls.map(([over]) => over)).toEqual([true, false, true, false])

  // an inner drop target that stops propagation (a pane reordering its own items) still
  // clears the class, which would otherwise stick and keep its border shifting the layout
  child_a.addEventListener(`drop`, (event) => event.stopPropagation())
  node.dispatchEvent(drag(`dragenter`))
  child_a.dispatchEvent(drag(`drop`, [new File([`x`], `x.cif`)]))
  expect(has_class()).toBe(false)
  expect(on_drop).toHaveBeenCalledOnce()

  detach?.()
  node.dispatchEvent(drag(`dragenter`))
  expect(has_class()).toBe(false)
})

// DataTransfer.files reports a dropped folder as one zero-byte File named after it, so the
// zone goes through the entry API instead (svelte-widgets tests the expansion itself), and a
// FilePicker chip's link drag fetches its URL
test(`file_drop_zone expands dropped folders and fetches FilePicker link drops`, async () => {
  vi.clearAllMocks()
  const inner = new File([`a`], `a.cif`)
  vi.mocked(decompress_file).mockResolvedValue(loaded(`data`, inner.name))
  vi.mocked(load_from_url).mockImplementation(async (url, callback) => {
    await callback(`remote`, `f.cif`, source_meta(`f.cif`, url))
  })
  // splice drains it, which is how readEntries signals the end: an empty second batch
  const batch = [{ isFile: true, file: (valid: (arg: File) => void) => valid(inner) }]
  const entry = {
    isDirectory: true,
    createReader: () => ({
      readEntries: (resolve: (arg: unknown[]) => void) => resolve(batch.splice(0)),
    }),
  }
  const on_drop = vi.fn()
  const node = document.createElement(`div`)
  const detach = file_drop_zone({ allow: () => true, on_drop })(node)
  const items = [{ kind: `file`, webkitGetAsEntry: () => entry }]
  node.dispatchEvent(drag(`drop`, [new File([], `structures`)], { items }))
  await vi.waitFor(() => expect(on_drop).toHaveBeenCalledOnce())
  node.dispatchEvent(drag(`drop`, [], { url: URL_SRC }))
  await vi.waitFor(() => expect(on_drop).toHaveBeenCalledTimes(2))
  expect(on_drop.mock.calls).toEqual([
    [`data`, `a.cif`, source_meta(`a.cif`)],
    [`remote`, `f.cif`, source_meta(`f.cif`, URL_SRC)],
  ])
  detach?.()
})

test.each([`set_loading`, `on_error`] as const)(
  `file_drop_zone keeps loading later drops after %s throws`,
  async (failure_source) => {
    vi.clearAllMocks()
    const report_error = vi.fn()
    vi.stubGlobal(`reportError`, report_error)
    onTestFinished(() => void vi.unstubAllGlobals())
    let fail_loading = failure_source === `set_loading`
    const set_loading = (loading: boolean) => {
      if (loading && fail_loading) {
        fail_loading = false
        throw new Error(`loading callback failed`)
      }
    }
    const throwing_error = () => {
      throw new Error(`error callback failed`)
    }
    vi.mocked(decompress_file).mockResolvedValue(loaded(`second`, `second.cube`))
    if (failure_source === `on_error`)
      vi.mocked(decompress_file).mockRejectedValueOnce(new Error(`corrupt`))
    const on_drop = vi.fn<FileLoadCallback>()
    const node = document.createElement(`div`)
    const detach = file_drop_zone({
      allow: () => true,
      on_drop,
      on_error: failure_source === `on_error` ? throwing_error : undefined,
      set_loading: failure_source === `set_loading` ? set_loading : undefined,
    })(node)
    const second_file = new File([`second`], `second.cube`)
    node.dispatchEvent(drag(`drop`, [new File([`first`], `first.cube`)]))
    node.dispatchEvent(drag(`drop`, [second_file]))
    await vi.waitFor(() =>
      expect(on_drop).toHaveBeenCalledExactlyOnceWith(`second`, `second.cube`, {
        source_filename: `second.cube`,
        file: second_file,
      }),
    )
    detach?.()
  },
)
