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

  test.each([
    [`no JSON data`, ``, false],
    [`no URL in JSON`, JSON.stringify({ name: `test.json` }), false],
  ])(`%s`, async (_, data, expected) => {
    get_data.mockReturnValue(data)
    expect(await handle_url_drop(drag_event, callback)).toBe(expected)
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
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const create_mock_response = (content: string | ArrayBuffer, headers = {}) => {
    const response = new Response(content, { headers })
    if (content instanceof ArrayBuffer) {
      Object.defineProperty(response, `arrayBuffer`, {
        value: () => Promise.resolve(content),
        writable: true,
      })
      Object.defineProperty(response, `text`, {
        value: () => Promise.resolve(``),
        writable: true,
      })
    } else {
      Object.defineProperty(response, `text`, {
        value: () => Promise.resolve(content),
        writable: true,
      })
      Object.defineProperty(response, `arrayBuffer`, {
        value: () => Promise.resolve(new TextEncoder().encode(content).buffer),
        writable: true,
      })
    }
    return response
  }

  const test_url_loading = async (
    url: string,
    content: string | ArrayBuffer,
    headers: Record<string, string>,
    expected_content_type: `string` | `ArrayBuffer`,
    expected_filename?: string,
    expected_content: string | null = null,
  ) => {
    const mock_response = create_mock_response(content, headers)
    globalThis.fetch = vi.fn().mockResolvedValue(mock_response)

    let received_content: string | ArrayBuffer | null = null
    let received_filename: string | null = null

    await load_from_url(url, (content, filename) => {
      received_content = content
      received_filename = filename
    })

    if (expected_content_type === `string` && typeof expected_content === `string`) {
      expect(typeof received_content).toBe(`string`)
      expect(received_content).toBe(expected_content)
    } else if (expected_content_type === `ArrayBuffer`) {
      expect(received_content).toBeInstanceOf(ArrayBuffer)
    }
    if (expected_filename) expect(received_filename).toBe(expected_filename)
  }

  test(`text content`, async () => {
    await test_url_loading(
      `https://example.com/test.json`,
      `data`,
      { 'content-type': `text/plain` },
      `string`,
      `test.json`,
      `data`,
    )
    expect(fetch).toHaveBeenCalledWith(`https://example.com/test.json`)
  })

  test.each([
    [`https://example.com/test.h5`, `test.h5`],
    [`https://example.com/trajectory.hdf5`, `trajectory.hdf5`],
    [`https://example.com/data.traj`, `data.traj`],
    [`https://example.com/data.zip`, `data.zip`],
    [`https://example.com/backup.bz2`, `backup.bz2`],
    [`https://example.com/archive.xz`, `archive.xz`],
    [`https://example.com/model.npz`, `model.npz`],
    [`https://example.com/data.pkl`, `data.pkl`],
    [`https://example.com/output.dat`, `output.dat`],
  ])(`binary extensions %s`, async (url, expected_filename) => {
    await test_url_loading(
      url,
      new ArrayBuffer(8),
      { 'content-type': `application/octet-stream` },
      `ArrayBuffer`,
      expected_filename,
    )
  })

  test.each([
    [`https://example.com/data.txt`, `data.txt`],
    [`https://example.com/config.json`, `config.json`],
    [`https://example.com/README.md`, `README.md`],
    [`https://example.com/script.py`, `script.py`],
    [`https://example.com/style.css`, `style.css`],
  ])(`text files %s`, async (url, expected_filename) => {
    // Known text formats skip Range requests and fetch directly
    const mock_response = create_mock_response(`text content`, {
      'content-type': `text/plain`,
    })

    globalThis.fetch = vi.fn().mockResolvedValueOnce(mock_response)

    let received_content: string | ArrayBuffer | null = null
    let received_filename: string | null = null

    await load_from_url(url, (content, filename) => {
      received_content = content
      received_filename = filename
    })

    expect(typeof received_content).toBe(`string`)
    expect(received_content).toBe(`text content`)
    expect(received_filename).toBe(expected_filename)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1) // Only one fetch for known text formats
  })

  test(`gzip files with content-encoding are handled as text`, async () => {
    const mock_response = new Response(`decompressed content`, {
      headers: { 'content-encoding': `gzip` },
    })
    globalThis.fetch = vi.fn().mockResolvedValue(mock_response)

    let received_content: string | ArrayBuffer | null = null
    let received_filename: string | null = null

    await load_from_url(`https://example.com/file.xyz.gz`, (content, filename) => {
      received_content = content
      received_filename = filename
    })

    expect(typeof received_content).toBe(`string`)
    expect(received_content).toBe(`decompressed content`)
    expect(received_filename).toBe(`file.xyz.gz`)
  })

  test(`gzip files without content-encoding are decompressed`, async () => {
    // Mock the decompress module
    const mock_decompress = vi.fn().mockResolvedValue(`decompressed content`)
    vi.doMock(`$lib/io/decompress`, () => ({
      decompress_data: mock_decompress,
    }))

    const mock_response = create_mock_response(new ArrayBuffer(8), {
      'content-type': `application/octet-stream`,
    })
    globalThis.fetch = vi.fn().mockResolvedValue(mock_response)

    let received_content: string | ArrayBuffer | null = null
    let received_filename: string | null = null

    await load_from_url(`https://example.com/file.xyz.gz`, (content, filename) => {
      received_content = content
      received_filename = filename
    })

    expect(typeof received_content).toBe(`string`)
    expect(received_content).toBe(`decompressed content`)
    expect(received_filename).toBe(`file.xyz`)
    expect(mock_decompress).toHaveBeenCalledWith(new ArrayBuffer(8), `gzip`)
  })

  test.each([
    [`GZIP magic bytes`, [0x1f, 0x8b], `ArrayBuffer`],
    [`HDF5 magic bytes`, [0x89, 0x48, 0x44, 0x46], `ArrayBuffer`],
    [`unknown format`, [0x12, 0x34, 0x56, 0x78], `string`, `unknown format content`],
  ])(
    `magic bytes detection: %s`,
    async (_, magic_bytes, expected_type, expected_content = undefined) => {
      const header = new Uint8Array([
        ...magic_bytes,
        ...new Array(16 - magic_bytes.length).fill(0),
      ])
      const mock_head_response = create_mock_response(header.buffer, {
        'content-type': `application/octet-stream`,
      })
      const mock_full_response = create_mock_response(
        expected_content || new ArrayBuffer(100),
        { 'content-type': expected_content ? `text/plain` : `application/octet-stream` },
      )

      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(mock_head_response)
        .mockResolvedValueOnce(mock_full_response)

      let received_content: string | ArrayBuffer | null = null
      let received_filename: string | null = null

      await load_from_url(`https://example.com/data.bin`, (content, filename) => {
        received_content = content
        received_filename = filename
      })

      if (expected_type === `string`) {
        expect(typeof received_content).toBe(`string`)
        if (expected_content) expect(received_content).toBe(expected_content)
      } else {
        expect(received_content).toBeInstanceOf(ArrayBuffer)
      }
      expect(received_filename).toBe(`data.bin`)
      expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    },
  )

  test(`fetch error`, async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error(`Network error`))
    await expect(load_from_url(`https://example.com/data.txt`, () => {})).rejects
      .toThrow(`Network error`)
  })

  test(`HEAD request failure falls back to text`, async () => {
    const mock_full_response = create_mock_response(`fallback content`, {
      'content-type': `text/plain`,
    })
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(mock_full_response)

    let received_content: string | ArrayBuffer | null = null
    let received_filename: string | null = null

    // Use an unknown format that will trigger Range request
    await load_from_url(`https://example.com/data.unknown`, (content, filename) => {
      received_content = content
      received_filename = filename
    })

    expect(typeof received_content).toBe(`string`)
    expect(received_content).toBe(`fallback content`)
    expect(received_filename).toBe(`data.unknown`)
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })

  test.each([
    [`https://example.com/path/to/structure.xyz`, `structure.xyz`],
    [`structure.xyz`, `structure.xyz`],
  ])(`filename extraction: %s`, async (url, expected_filename) => {
    await test_url_loading(
      url,
      `content`,
      { 'content-type': `text/plain` },
      `string`,
      expected_filename,
      undefined,
    )
  })

  test(`fetch error with status`, async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 404 }),
    )

    await expect(
      load_from_url(`https://example.com/missing.json`, () => {}),
    ).rejects.toThrow(`Fetch failed: 404`)
  })

  test(`gzip files with content-encoding are handled as text`, async () => {
    const mock_response = new Response(`decompressed content`, {
      headers: { 'content-encoding': `gzip` },
    })
    globalThis.fetch = vi.fn().mockResolvedValue(mock_response)

    let received_content: string | ArrayBuffer | null = null
    let received_filename: string | null = null

    await load_from_url(`https://example.com/file.xyz.gz`, (content, filename) => {
      received_content = content
      received_filename = filename
    })

    expect(typeof received_content).toBe(`string`)
    expect(received_content).toBe(`decompressed content`)
    expect(received_filename).toBe(`file.xyz.gz`)
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
    [`STRUCTURE.CIF`, `content`, `crystal`],
    [`data.CIF`, `content`, `crystal`],
    [`PHONOPY.YAML`, `content`, `unknown`],
    [`test.YML`, `content`, `unknown`],
    // Test OPTIMADE JSON format
    [
      `optimade.json`,
      `{"data": {"attributes": {"lattice_vectors": [[1,0,0],[0,1,0],[0,0,1]]}}}`,
      `crystal`,
    ],
    [
      `optimade.json`,
      `{"data": {"attributes": {"dimension_types": [0,0,0]}}}`,
      `molecule`,
    ],
    [
      `optimade.json`,
      `{"data": {"attributes": {"dimension_types": [1,1,1]}}}`,
      `crystal`,
    ],
    [
      `optimade.json`,
      `{"data": {"attributes": {"nperiodic_dimensions": 0}}}`,
      `molecule`,
    ],
    [`optimade.json`, `{"data": {"attributes": {"nperiodic_dimensions": 3}}}`, `crystal`],
    [`molecule.json`, `{"data": {"attributes": {"species": []}}}`, `molecule`],
  ])(`%s -> %s`, (filename, content, expected) => {
    expect(detect_structure_type(filename, content)).toBe(expected)
  })
})
