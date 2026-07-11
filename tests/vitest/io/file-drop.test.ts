import type { FileDropOptions } from '$lib/io/file-drop'
import { create_file_drop_handler, drag_over_handlers } from '$lib/io/file-drop'
import { decompress_file } from '$lib/io/decompress'
import { dropped_file_url, load_from_url } from '$lib/io/url-drop'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock(`$lib/io/decompress`, () => ({ decompress_file: vi.fn() }))
vi.mock(`$lib/io/url-drop`, () => ({
  dropped_file_url: vi.fn(),
  load_from_url: vi.fn(),
}))

const make_event = (files: File[] = []) =>
  ({
    preventDefault: vi.fn(),
    dataTransfer: { files, getData: vi.fn() },
  }) as unknown as DragEvent

describe(`create_file_drop_handler`, () => {
  let on_drop: FileDropOptions[`on_drop`]
  let on_error: FileDropOptions[`on_error`]
  let set_loading: FileDropOptions[`set_loading`]

  beforeEach(() => {
    vi.clearAllMocks()
    on_drop = vi.fn<FileDropOptions[`on_drop`]>()
    on_error = vi.fn<NonNullable<FileDropOptions[`on_error`]>>()
    set_loading = vi.fn<NonNullable<FileDropOptions[`set_loading`]>>()
    vi.mocked(dropped_file_url).mockReturnValue(undefined)
  })

  const run = async (opts: Partial<FileDropOptions> = {}, files: File[] = []) => {
    const event = make_event(files)
    const defaults: FileDropOptions = {
      allow: () => true,
      on_drop,
      on_error,
      set_loading,
    }
    await create_file_drop_handler({ ...defaults, ...opts })(event)
    return event
  }

  test(`blocks drop when allow returns false`, async () => {
    const event = await run({ allow: () => false })
    expect(event.preventDefault).toHaveBeenCalled()
    expect(on_drop).not.toHaveBeenCalled()
    expect(load_from_url).not.toHaveBeenCalled()
    expect(set_loading).not.toHaveBeenCalled()
  })

  test(`calls preventDefault and sets loading true then false`, async () => {
    const event = await run()
    expect(event.preventDefault).toHaveBeenCalled()
    expect(set_loading).toHaveBeenCalledWith(true)
    expect(set_loading).toHaveBeenLastCalledWith(false)
  })

  test(`delegates to URL loading first when a URL payload is present`, async () => {
    vi.mocked(dropped_file_url).mockReturnValue(`https://example.com/f.cif`)
    vi.mocked(load_from_url).mockResolvedValue(undefined)
    await run({}, [new File([`x`], `test.txt`)])
    expect(load_from_url).toHaveBeenCalledWith(`https://example.com/f.cif`, on_drop)
    expect(decompress_file).not.toHaveBeenCalled()
  })

  test(`URL failure with files present still processes files and reports both`, async () => {
    vi.mocked(dropped_file_url).mockReturnValue(`https://example.com/f.cif`)
    vi.mocked(load_from_url).mockRejectedValue(new Error(`404`))
    vi.mocked(decompress_file).mockResolvedValue({ content: `data`, filename: `b.cube` })
    await run({}, [new File([`y`], `b.cube.gz`)])
    expect(on_drop).toHaveBeenCalledWith(`data`, `b.cube`)
    expect(on_error).toHaveBeenCalledWith(
      `Failed to load 1 file — URL https://example.com/f.cif: 404`,
    )
  })

  test(`decompresses file and calls on_drop`, async () => {
    vi.mocked(decompress_file).mockResolvedValue({ content: `data`, filename: `f.cif` })
    const file = new File([`data`], `f.cif.gz`)
    await run({}, [file])
    expect(decompress_file).toHaveBeenCalledWith(file)
    expect(on_drop).toHaveBeenCalledWith(`data`, `f.cif`)
  })

  test(`does nothing when no files and no URL error`, async () => {
    await run()
    expect(decompress_file).not.toHaveBeenCalled()
    expect(on_drop).not.toHaveBeenCalled()
    expect(on_error).not.toHaveBeenCalled()
  })

  test(`reports URL error when URL drop fails and no files present`, async () => {
    vi.mocked(dropped_file_url).mockReturnValue(`https://example.com/f.cif`)
    vi.mocked(load_from_url).mockRejectedValue(new Error(`fetch failed`))
    await run()
    expect(on_error).toHaveBeenCalledWith(`Failed to load from URL: fetch failed`)
    expect(on_drop).not.toHaveBeenCalled()
  })

  test(`reports empty decompressed content as a failure instead of silently skipping`, async () => {
    vi.mocked(decompress_file).mockResolvedValue({ content: ``, filename: `f.txt` })
    await run({}, [new File([``], `f.txt`)])
    expect(decompress_file).toHaveBeenCalled()
    expect(on_drop).not.toHaveBeenCalled()
    expect(on_error).toHaveBeenCalledWith(`Failed to load 1 file — f.txt: file is empty`)
  })

  test.each([
    { rejection: new Error(`corrupt gzip`), expected: `corrupt gzip`, desc: `Error` },
    { rejection: `string error`, expected: `string error`, desc: `string` },
  ])(`formats on_error from $desc`, async ({ rejection, expected }) => {
    vi.mocked(decompress_file).mockRejectedValue(rejection)
    await run({}, [new File([`x`], `f.txt`)])
    expect(on_error).toHaveBeenCalledWith(`Failed to load 1 file — f.txt: ${expected}`)
    expect(on_drop).not.toHaveBeenCalled()
    expect(set_loading).toHaveBeenLastCalledWith(false)
  })

  test(`sets loading false even when on_drop throws`, async () => {
    vi.mocked(decompress_file).mockResolvedValue({ content: `x`, filename: `f.txt` })
    const throwing_drop = vi.fn().mockRejectedValue(new Error(`parse failed`))
    await run({ on_drop: throwing_drop }, [new File([`x`], `f.txt`)])
    expect(set_loading).toHaveBeenLastCalledWith(false)
    expect(on_error).toHaveBeenCalledWith(`Failed to load 1 file — f.txt: parse failed`)
  })

  test(`processes all dropped files sequentially in drop order`, async () => {
    vi.mocked(decompress_file)
      .mockResolvedValueOnce({ content: `first`, filename: `a.cube` })
      .mockResolvedValueOnce({ content: `second`, filename: `b.cube` })
    await run({}, [new File([`x`], `a.cube.gz`), new File([`y`], `b.cube.gz`)])
    expect(on_drop).toHaveBeenCalledTimes(2)
    expect(vi.mocked(on_drop).mock.calls).toEqual([
      [`first`, `a.cube`],
      [`second`, `b.cube`],
    ])
  })

  test(`one failing file does not abort the rest of the batch`, async () => {
    vi.mocked(decompress_file)
      .mockRejectedValueOnce(new Error(`corrupt`))
      .mockResolvedValueOnce({ content: `ok`, filename: `b.cube` })
    await run({}, [new File([`x`], `a.cube.gz`), new File([`y`], `b.cube.gz`)])
    expect(on_drop).toHaveBeenCalledWith(`ok`, `b.cube`)
    expect(on_error).toHaveBeenCalledWith(`Failed to load 1 file — a.cube.gz: corrupt`)
    expect(set_loading).toHaveBeenLastCalledWith(false)
  })

  test(`aggregates multiple failures into one plural message`, async () => {
    vi.mocked(decompress_file)
      .mockRejectedValueOnce(new Error(`corrupt`))
      .mockRejectedValueOnce(new Error(`bad header`))
    await run({}, [new File([`x`], `a.cube.gz`), new File([`y`], `b.cube.gz`)])
    expect(on_error).toHaveBeenCalledWith(
      `Failed to load 2 files — a.cube.gz: corrupt; b.cube.gz: bad header`,
    )
  })

  test(`overlapping drops are processed sequentially, not interleaved`, async () => {
    const order: string[] = []
    vi.mocked(decompress_file).mockImplementation((file: File) =>
      Promise.resolve({ content: `data`, filename: file.name }),
    )
    const slow_drop = vi.fn(async (_content: string | ArrayBuffer, filename: string) => {
      order.push(`start ${filename}`)
      await new Promise((resolve) => setTimeout(resolve, 5))
      order.push(`end ${filename}`)
    })
    const handler = create_file_drop_handler({ allow: () => true, on_drop: slow_drop })
    // Fire the second drop while the first batch is still processing
    const first = handler(make_event([new File([`x`], `a.cube`)]))
    const second = handler(make_event([new File([`y`], `b.cube`)]))
    await Promise.all([first, second])
    expect(order).toEqual([`start a.cube`, `end a.cube`, `start b.cube`, `end b.cube`])
  })

  test(`works without optional callbacks`, async () => {
    vi.mocked(decompress_file).mockResolvedValue({ content: `ok`, filename: `f.cif` })
    await run({ on_error: undefined, set_loading: undefined }, [new File([`ok`], `f.cif`)])
    expect(on_drop).toHaveBeenCalledWith(`ok`, `f.cif`)
  })
})

describe(`drag_over_handlers`, () => {
  test.each([
    { desc: `sets dragover when allowed`, allow: () => true, expected: [true] },
    { desc: `respects allow guard`, allow: () => false, expected: [] },
    { desc: `defaults to allowed when no guard given`, allow: undefined, expected: [true] },
  ])(`ondragover $desc`, ({ allow, expected }) => {
    const set_dragover = vi.fn()
    const handlers = drag_over_handlers({ allow, set_dragover })
    const event = make_event()
    handlers.ondragover(event)
    expect(event.preventDefault).toHaveBeenCalledOnce() // always, even when not allowed
    expect(set_dragover.mock.calls.map(([over]) => over)).toEqual(expected)
  })

  test(`ondragleave always clears dragover state`, () => {
    const set_dragover = vi.fn()
    const handlers = drag_over_handlers({ allow: () => false, set_dragover })
    handlers.ondragleave()
    expect(set_dragover).toHaveBeenCalledWith(false)
  })
})
