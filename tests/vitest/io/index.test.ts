import { detect_structure_type, handle_url_drop, load_from_url } from '$lib/io'
import { beforeEach, describe, expect, test, vi } from 'vitest'

globalThis.fetch = vi.fn()

describe(`handle_url_drop`, () => {
  let callback: ReturnType<typeof vi.fn>
  let get_data: ReturnType<typeof vi.fn>
  let drag_event: DragEvent

  beforeEach(() => {
    callback = vi.fn()
    get_data = vi.fn()
    drag_event = { dataTransfer: { getData: get_data } } as unknown as DragEvent
    vi.clearAllMocks()
  })

  test(`no JSON data`, async () => {
    get_data.mockReturnValue(``)
    expect(await handle_url_drop(drag_event, callback)).toBe(false)
    expect(callback).not.toHaveBeenCalled()
  })

  test(`no URL in JSON`, async () => {
    get_data.mockReturnValue(JSON.stringify({ name: `test.json` }))
    expect(await handle_url_drop(drag_event, callback)).toBe(false)
    expect(callback).not.toHaveBeenCalled()
  })

  test(`valid JSON with URL`, async () => {
    get_data.mockReturnValue(
      JSON.stringify({ name: `test.json`, url: `https://example.com/test.json` }),
    )
    vi.mocked(fetch).mockResolvedValue(
      { ok: true, text: () => Promise.resolve(`data`) } as Response,
    )

    expect(await handle_url_drop(drag_event, callback)).toBe(true)
    expect(callback).toHaveBeenCalledWith(`data`, `test.json`)
  })

  test(`JSON parsing error`, async () => {
    get_data.mockReturnValue(`invalid`)
    await expect(handle_url_drop(drag_event, callback)).rejects.toThrow()
    expect(callback).not.toHaveBeenCalled()
  })
})

describe(`load_from_url`, () => {
  let callback: ReturnType<typeof vi.fn>

  beforeEach(() => {
    callback = vi.fn()
    vi.clearAllMocks()
  })

  test(`text content`, async () => {
    vi.mocked(fetch).mockResolvedValue(
      { ok: true, text: () => Promise.resolve(`data`) } as Response,
    )
    await load_from_url(`https://example.com/test.json`, callback)
    expect(fetch).toHaveBeenCalledWith(`https://example.com/test.json`)
    expect(callback).toHaveBeenCalledWith(`data`, `test.json`)
  })

  test.each([
    [`https://example.com/test.h5`, `test.h5`],
    [`https://example.com/trajectory.hdf5`, `trajectory.hdf5`],
    [`https://example.com/data.traj`, `data.traj`],
  ])(`binary files %s`, async (url, filename) => {
    const buffer = new ArrayBuffer(8)
    vi.mocked(fetch).mockResolvedValue(
      { ok: true, arrayBuffer: () => Promise.resolve(buffer) } as Response,
    )
    await load_from_url(url, callback)
    expect(callback).toHaveBeenCalledWith(buffer, filename)
  })

  test(`filename extraction`, async () => {
    vi.mocked(fetch).mockResolvedValue(
      { ok: true, text: () => Promise.resolve(`content`) } as Response,
    )
    await load_from_url(`https://example.com/path/to/structure.xyz`, callback)
    expect(callback).toHaveBeenCalledWith(`content`, `structure.xyz`)
  })

  test(`no path separator`, async () => {
    vi.mocked(fetch).mockResolvedValue(
      { ok: true, text: () => Promise.resolve(`content`) } as Response,
    )
    await load_from_url(`structure.xyz`, callback)
    expect(callback).toHaveBeenCalledWith(`content`, `structure.xyz`)
  })

  test(`fetch error`, async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 404 } as Response)
    await expect(load_from_url(`https://example.com/notfound.json`, callback)).rejects
      .toThrow(`Fetch failed: 404`)
  })
})

describe(`detect_structure_type`, () => {
  test.each([
    [`structure.json`, `{"lattice": {"a": 5.0}}`, `crystal`],
    [`molecule.json`, `{"sites": []}`, `molecule`],
    [`invalid.json`, `invalid`, `unknown`],
    [`file.cif`, `any`, `crystal`],
    [`POSCAR`, `any`, `crystal`],
    [`file.poscar`, `any`, `crystal`],
    [`file.yaml`, `phonopy:\n  version: 2.0`, `crystal`],
    [`file.yml`, `phono3py:\n  version: 2.0`, `crystal`],
    [`file.yaml`, `other: content`, `unknown`],
    [`file.xyz`, `3\nLattice="5.0 0.0 0.0"\nH 0.0 0.0 0.0`, `crystal`],
    [`file.xyz`, `3\nwater\nH 0.0 0.0 0.0`, `molecule`],
    [`file.ext`, `content`, `unknown`],
  ])(`%s -> %s`, (filename, content, expected) => {
    expect(detect_structure_type(filename, content)).toBe(expected)
  })

  test.each([
    [`STRUCTURE.CIF`, `crystal`],
    [`data.CIF`, `crystal`],
    [`PHONOPY.YAML`, `unknown`],
    [`test.YML`, `unknown`],
  ])(`case insensitive %s -> %s`, (filename, expected) => {
    expect(detect_structure_type(filename, `content`)).toBe(expected)
  })
})
