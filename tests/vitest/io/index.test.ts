import { handle_url_drop, load_from_url } from '$lib/io'
import { beforeEach, describe, expect, test, vi } from 'vitest'

globalThis.fetch = vi.fn()

// decompress_data is a static import in url-drop.ts, so the gzip test below can't mock it via a
// dynamic import. Mock it through the module registry (hoisted) instead, keeping the other real
// exports so unrelated decompress paths are unaffected.
const { mock_decompress } = vi.hoisted(() => ({ mock_decompress: vi.fn() }))
vi.mock(`$lib/io/decompress`, async (import_original) => {
  const actual = await import_original<Record<string, unknown>>()
  return { ...actual, decompress_data: mock_decompress }
})

describe(`handle_url_drop`, () => {
  let callback: (content: string | ArrayBuffer, filename: string) => void | Promise<void>
  let get_data: ReturnType<typeof vi.fn>
  let drag_event: DragEvent

  beforeEach(() => {
    callback = vi.fn()
    get_data = vi.fn()
    drag_event = { dataTransfer: { getData: get_data } } as unknown as DragEvent
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
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(`data`),
    } as Response)

    expect(await handle_url_drop(drag_event, callback)).toBe(true)
    expect(callback).toHaveBeenCalledWith(`data`, `test.json`)
  })

  test(`returns false for malformed JSON`, async () => {
    get_data.mockReturnValue(`invalid`)
    expect(await handle_url_drop(drag_event, callback)).toBe(false)
    expect(callback).not.toHaveBeenCalled()
  })
})

describe(`load_from_url`, () => {
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

  const load_test_url = async (
    url: string,
    content: string | ArrayBuffer,
    headers: Record<string, string>,
  ) => {
    const mock_response = create_mock_response(content, headers)
    globalThis.fetch = vi.fn().mockResolvedValue(mock_response)

    let received_content: string | ArrayBuffer | null = null
    let received_filename: string | null = null

    await load_from_url(url, (loaded_content, filename) => {
      received_content = loaded_content
      received_filename = filename
    })

    return { received_content, received_filename }
  }

  test(`text content`, async () => {
    const { received_content, received_filename } = await load_test_url(
      `https://example.com/test.json`,
      `data`,
      { 'content-type': `text/plain` },
    )
    expect(received_content).toBe(`data`)
    expect(received_filename).toBe(`test.json`)
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
    const { received_content, received_filename } = await load_test_url(
      url,
      new ArrayBuffer(8),
      { 'content-type': `application/octet-stream` },
    )
    expect(received_content).toBeInstanceOf(ArrayBuffer)
    expect(received_filename).toBe(expected_filename)
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
    mock_decompress.mockResolvedValue(`decompressed content`)

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
    [
      `HDF5 magic bytes with callback rejection`,
      [0x89, 0x48, 0x44, 0x46],
      `ArrayBuffer`,
      undefined,
      `callback failed`,
    ],
    [`HDF5 magic bytes`, [0x89, 0x48, 0x44, 0x46], `ArrayBuffer`, undefined, undefined],
    [
      `ASE Ulm magic bytes`,
      [0x2d, 0x20, 0x6f, 0x66, 0x20, 0x55, 0x6c, 0x6d],
      `ArrayBuffer`,
      undefined,
      undefined,
    ],
    [
      `unknown format`,
      [0x12, 0x34, 0x56, 0x78],
      `string`,
      `unknown format content`,
      undefined,
    ],
  ] as const)(
    `magic bytes detection: %s`,
    async (_, magic_bytes, expected_type, expected_content, callback_error) => {
      const header = new Uint8Array([
        ...magic_bytes,
        ...Array(16 - magic_bytes.length).fill(0),
      ])
      const mock_head_response = create_mock_response(header.buffer, {
        'content-type': `application/octet-stream`,
      })
      const mock_full_response = create_mock_response(
        expected_content ?? new ArrayBuffer(100),
        {
          'content-type': expected_content ? `text/plain` : `application/octet-stream`,
        },
      )

      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(mock_head_response)
        .mockResolvedValueOnce(mock_full_response)

      let received_content: string | ArrayBuffer | null = null
      let received_filename: string | null = null

      const callback = async (content: string | ArrayBuffer, filename: string) => {
        received_content = content
        received_filename = filename
        if (callback_error && content instanceof ArrayBuffer) {
          throw new TypeError(callback_error)
        }
      }

      if (callback_error) {
        await expect(load_from_url(`https://example.com/data.bin`, callback)).rejects.toThrow(
          callback_error,
        )
        expect(globalThis.fetch).toHaveBeenCalledTimes(2)
        return
      }

      await load_from_url(`https://example.com/data.bin`, callback)

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

  test(`sniffed gzip without .gz extension is decompressed`, async () => {
    mock_decompress.mockResolvedValue(`decompressed content`)
    const header = new Uint8Array([0x1f, 0x8b, ...Array(14).fill(0)])
    const full_body = new ArrayBuffer(100)
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(create_mock_response(header.buffer, {}))
      .mockResolvedValueOnce(create_mock_response(full_body, {}))

    let received_content: string | ArrayBuffer | null = null
    let received_filename: string | null = null
    await load_from_url(`https://example.com/data.bin`, (content, filename) => {
      received_content = content
      received_filename = filename
    })

    expect(received_content).toBe(`decompressed content`)
    expect(received_filename).toBe(`data.bin`)
    expect(mock_decompress).toHaveBeenCalledWith(full_body, `gzip`)
  })

  test(`blob: object URL with text content passes UUID basename to callback`, async () => {
    const xyz_content = `3\ncomment\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH 0.0 1.0 0.0`
    const mock_response = create_mock_response(xyz_content, {})
    globalThis.fetch = vi.fn().mockResolvedValue(mock_response)

    let received_content: string | ArrayBuffer | null = null
    let received_filename: string | null = null
    await load_from_url(
      `blob:http://localhost:5173/8a3bf2c4-d1e2-4f5a-9b8c-7d6e5f4a3b2c`,
      (content, filename) => {
        received_content = content
        received_filename = filename
      },
    )

    expect(received_content).toBe(xyz_content)
    expect(received_filename).toBe(`8a3bf2c4-d1e2-4f5a-9b8c-7d6e5f4a3b2c`)
  })

  test(`fetch error`, async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error(`Network error`))
    await expect(load_from_url(`https://example.com/data.txt`, () => {})).rejects.toThrow(
      `Network error`,
    )
  })

  test(`HEAD request failure falls back to text`, async () => {
    const mock_full_response = create_mock_response(`fallback content`, {
      'content-type': `text/plain`,
    })
    globalThis.fetch = vi
      .fn()
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
    const { received_content, received_filename } = await load_test_url(url, `content`, {
      'content-type': `text/plain`,
    })
    expect(received_content).toBe(`content`)
    expect(received_filename).toBe(expected_filename)
  })

  test(`fetch error with status`, async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }))

    await expect(load_from_url(`https://example.com/missing.json`, () => {})).rejects.toThrow(
      `Fetch failed: 404`,
    )
  })

  test(`Content-Disposition filename is respected`, async () => {
    const mock_response = new Response(`some content`, {
      headers: {
        'content-type': `text/plain`,
        'content-disposition': `attachment; filename="server-name.xyz"`,
      },
    })
    globalThis.fetch = vi.fn().mockResolvedValue(mock_response)

    let received_filename: string | null = null
    await load_from_url(`https://example.com/ignored-name.xyz`, (_, filename) => {
      received_filename = filename
    })

    expect(received_filename).toBe(`server-name.xyz`)
  })

  describe(`Content-Disposition edge cases`, () => {
    test.each([
      // filename* with UTF-8 encoding
      [
        `filename*=UTF-8''structure%20data.xyz`,
        `structure data.xyz`,
        `RFC 5987 filename* with UTF-8 encoding`,
      ],
      // filename* without explicit encoding
      [
        `filename*=structure%20file.cif`,
        `structure file.cif`,
        `filename* without explicit encoding`,
      ],
      // Plain filename without quotes
      [`filename=simple.xyz`, `simple.xyz`, `filename without quotes`],
      // filename* takes precedence over filename
      [
        `filename="fallback.xyz"; filename*=UTF-8''preferred.xyz`,
        `preferred.xyz`,
        `filename* takes precedence`,
      ],
      // Invalid percent-encoding falls back to raw value
      [
        `filename*=UTF-8''invalid%ZZencoding.xyz`,
        `invalid%ZZencoding.xyz`,
        `invalid percent-encoding returns raw value`,
      ],
    ])(`%s -> %s (%s)`, async (disposition, expected, _desc) => {
      const mock_response = new Response(`content`, {
        headers: {
          'content-type': `text/plain`,
          'content-disposition': `attachment; ${disposition}`,
        },
      })
      globalThis.fetch = vi.fn().mockResolvedValue(mock_response)

      let received_filename: string | null = null
      await load_from_url(`https://example.com/url-name.xyz`, (_, filename) => {
        received_filename = filename
      })

      expect(received_filename).toBe(expected)
    })

    test(`falls back to URL basename when Content-Disposition has no filename`, async () => {
      const mock_response = new Response(`content`, {
        headers: {
          'content-type': `text/plain`,
          'content-disposition': `attachment`,
        },
      })
      globalThis.fetch = vi.fn().mockResolvedValue(mock_response)

      let received_filename: string | null = null
      await load_from_url(`https://example.com/fallback.xyz`, (_, filename) => {
        received_filename = filename
      })

      expect(received_filename).toBe(`fallback.xyz`)
    })
  })

  describe(`VASP file detection`, () => {
    test.each([
      [`POSCAR`, `POSCAR`],
      [`poscar`, `poscar`],
      [`XDATCAR`, `XDATCAR`],
      [`xdatcar`, `xdatcar`],
      [`CONTCAR`, `CONTCAR`],
      [`contcar`, `contcar`],
    ])(`recognizes VASP file %s as text`, async (basename, expected_filename) => {
      const mock_response = new Response(`Si\n1.0\n5.43 0 0\n0 5.43 0\n0 0 5.43`, {
        headers: { 'content-type': `text/plain` },
      })
      globalThis.fetch = vi.fn().mockResolvedValueOnce(mock_response)

      let received_content: string | ArrayBuffer | null = null
      let received_filename: string | null = null

      await load_from_url(`https://example.com/${basename}`, (content, filename) => {
        received_content = content
        received_filename = filename
      })

      expect(typeof received_content).toBe(`string`)
      expect(received_filename).toBe(expected_filename)
      expect(globalThis.fetch).toHaveBeenCalledTimes(1) // No Range request for VASP files
    })
  })

  describe(`async callback support`, () => {
    test(`awaits async callback`, async () => {
      const mock_response = new Response(`content`, {
        headers: { 'content-type': `text/plain` },
      })
      globalThis.fetch = vi.fn().mockResolvedValue(mock_response)

      const processed_files: string[] = []
      await load_from_url(`https://example.com/test.xyz`, async (_content, filename) => {
        // Async callback with zero delay - still tests await behavior
        await Promise.resolve()
        processed_files.push(filename)
      })

      expect(processed_files).toContain(`test.xyz`)
    })
  })

  describe(`non-gzip binary files with content-encoding`, () => {
    test(`gzip content-encoding on non-.gz URL returns text`, async () => {
      const mock_response = new Response(`decompressed content`, {
        headers: {
          'content-encoding': `gzip`,
          'content-type': `text/plain`,
        },
      })
      globalThis.fetch = vi.fn().mockResolvedValue(mock_response)

      let received_content: string | ArrayBuffer | null = null
      let received_filename: string | null = null
      await load_from_url(
        `https://example.com/data.npz`, // binary extension but with gzip content-encoding
        (content, filename) => {
          received_content = content
          received_filename = filename
        },
      )

      expect(typeof received_content).toBe(`string`)
      expect(received_filename).toBe(`data.npz`)
    })
  })
})
