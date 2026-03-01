import type { FileDropOptions } from '$lib/io/file-drop'
import { create_file_drop_handler } from '$lib/io/file-drop'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock(`$lib/io/decompress`, () => ({ decompress_file: vi.fn() }))
vi.mock(`$lib/io/url-drop`, () => ({ handle_url_drop: vi.fn() }))

import { decompress_file } from '$lib/io/decompress'
import { handle_url_drop } from '$lib/io/url-drop'

const make_event = (files: File[] = []) =>
  ({
    preventDefault: vi.fn(),
    dataTransfer: { files, getData: vi.fn() },
  }) as unknown as DragEvent

describe(`create_file_drop_handler`, () => {
  let on_drop: ReturnType<typeof vi.fn>
  let on_error: ReturnType<typeof vi.fn>
  let set_loading: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    on_drop = vi.fn()
    on_error = vi.fn()
    set_loading = vi.fn()
    vi.mocked(handle_url_drop).mockResolvedValue(false)
  })

  // Helper: create handler with defaults, run against event
  const run = async (
    opts: Partial<FileDropOptions> = {},
    files: File[] = [],
  ) => {
    const event = make_event(files)
    const handler = create_file_drop_handler({
      allow: () => true,
      on_drop: on_drop as FileDropOptions[`on_drop`],
      on_error: on_error as FileDropOptions[`on_error`],
      set_loading: set_loading as FileDropOptions[`set_loading`],
      ...opts,
    })
    await handler(event)
    return event
  }

  test(`blocks drop when allow returns false`, async () => {
    const event = await run({ allow: () => false })
    expect(event.preventDefault).toHaveBeenCalled()
    expect(on_drop).not.toHaveBeenCalled()
    expect(handle_url_drop).not.toHaveBeenCalled()
  })

  test(`calls preventDefault and sets loading true then false`, async () => {
    const event = await run()
    expect(event.preventDefault).toHaveBeenCalled()
    expect(set_loading).toHaveBeenCalledWith(true)
    expect(set_loading).toHaveBeenLastCalledWith(false)
  })

  test(`delegates to handle_url_drop first`, async () => {
    vi.mocked(handle_url_drop).mockResolvedValue(true)
    await run({}, [new File([`x`], `test.txt`)])
    expect(handle_url_drop).toHaveBeenCalled()
    expect(decompress_file).not.toHaveBeenCalled()
  })

  test(`decompresses file and calls on_drop`, async () => {
    vi.mocked(decompress_file).mockResolvedValue({ content: `data`, filename: `f.cif` })
    const file = new File([`data`], `f.cif.gz`)
    await run({}, [file])
    expect(decompress_file).toHaveBeenCalledWith(file)
    expect(on_drop).toHaveBeenCalledWith(`data`, `f.cif`)
  })

  test(`does nothing when no files in dataTransfer`, async () => {
    await run()
    expect(decompress_file).not.toHaveBeenCalled()
    expect(on_drop).not.toHaveBeenCalled()
  })

  test(`skips on_drop when decompress returns empty content`, async () => {
    vi.mocked(decompress_file).mockResolvedValue({ content: ``, filename: `f.txt` })
    await run({}, [new File([``], `f.txt`)])
    expect(decompress_file).toHaveBeenCalled()
    expect(on_drop).not.toHaveBeenCalled()
  })

  test.each([
    { rejection: new Error(`corrupt gzip`), expected: `corrupt gzip`, desc: `Error` },
    { rejection: `string error`, expected: `string error`, desc: `string` },
  ])(`formats on_error from $desc`, async ({ rejection, expected }) => {
    vi.mocked(decompress_file).mockRejectedValue(rejection)
    await run({}, [new File([`x`], `f.txt`)])
    expect(on_error).toHaveBeenCalledWith(`Failed to load file f.txt: ${expected}`)
    expect(on_drop).not.toHaveBeenCalled()
    expect(set_loading).toHaveBeenLastCalledWith(false)
  })

  test(`sets loading false even when on_drop throws`, async () => {
    vi.mocked(decompress_file).mockResolvedValue({ content: `x`, filename: `f.txt` })
    on_drop.mockRejectedValue(new Error(`parse failed`))
    await run({}, [new File([`x`], `f.txt`)])
    expect(set_loading).toHaveBeenLastCalledWith(false)
    expect(on_error).toHaveBeenCalledWith(`Failed to load file f.txt: parse failed`)
  })

  test(`works without optional callbacks`, async () => {
    vi.mocked(decompress_file).mockResolvedValue({ content: `ok`, filename: `f.cif` })
    await run({ on_error: undefined, set_loading: undefined }, [
      new File([`ok`], `f.cif`),
    ])
    expect(on_drop).toHaveBeenCalledWith(`ok`, `f.cif`)
  })
})
