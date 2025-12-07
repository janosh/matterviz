import { handle_url_drop, load_from_url } from '$lib/io'
import { beforeEach, describe, expect, test, vi } from 'vitest'

globalThis.fetch = vi.fn()

describe(`handle_url_drop`, () => {
  let callback: (
    content: string | ArrayBuffer,
    filename: string,
  ) => void | Promise<void>
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
    const create_mock_response = (content: string, headers: Record<string, string>) => {
      return new Response(content, { headers })
    }

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
    ])(`%s -> %s (%s)`, async (disposition, expected, _desc) => {
      const mock_response = create_mock_response(`content`, {
        'content-type': `text/plain`,
        'content-disposition': `attachment; ${disposition}`,
      })
      globalThis.fetch = vi.fn().mockResolvedValue(mock_response)

      let received_filename: string | null = null
      await load_from_url(`https://example.com/url-name.xyz`, (_, filename) => {
        received_filename = filename
      })

      expect(received_filename).toBe(expected)
    })

    test(`falls back to URL basename when Content-Disposition has no filename`, async () => {
      const mock_response = create_mock_response(`content`, {
        'content-type': `text/plain`,
        'content-disposition': `attachment`,
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
    const create_mock_response = (content: string) => {
      return new Response(content, { headers: { 'content-type': `text/plain` } })
    }

    test.each([
      [`POSCAR`, `POSCAR`],
      [`poscar`, `poscar`],
      [`XDATCAR`, `XDATCAR`],
      [`xdatcar`, `xdatcar`],
      [`CONTCAR`, `CONTCAR`],
      [`contcar`, `contcar`],
    ])(`recognizes VASP file %s as text`, async (basename, expected_filename) => {
      const mock_response = create_mock_response(`Si\n1.0\n5.43 0 0\n0 5.43 0\n0 0 5.43`)
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
    const create_mock_response = (content: string) => {
      return new Response(content, { headers: { 'content-type': `text/plain` } })
    }

    test(`awaits async callback`, async () => {
      const mock_response = create_mock_response(`content`)
      globalThis.fetch = vi.fn().mockResolvedValue(mock_response)

      const processed_files: string[] = []
      await load_from_url(
        `https://example.com/test.xyz`,
        async (_content, filename) => {
          // Simulate async processing
          await new Promise((resolve) => setTimeout(resolve, 10))
          processed_files.push(filename)
        },
      )

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
      await load_from_url(
        `https://example.com/data.npz`, // binary extension but with gzip content-encoding
        (content) => {
          received_content = content
        },
      )

      expect(typeof received_content).toBe(`string`)
    })
  })
})
