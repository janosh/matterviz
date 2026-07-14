import { basename_from_url, handle_url_drop, load_from_url } from '$lib/io'
import { beforeEach, describe, expect, test, vi } from 'vitest'

globalThis.fetch = vi.fn()

// decompress helpers are static imports in url-drop.ts, so the gzip tests below can't mock them
// via a dynamic import. Mock them through the module registry (hoisted) instead, keeping the
// other real exports so unrelated decompress paths are unaffected.
const { mock_decompress, mock_decompress_binary } = vi.hoisted(() => ({
  mock_decompress: vi.fn(),
  mock_decompress_binary: vi.fn(),
}))
vi.mock(`$lib/io/decompress`, async (import_original) => {
  const actual = await import_original<Record<string, unknown>>()
  return {
    ...actual,
    decompress_data: mock_decompress,
    decompress_data_binary: mock_decompress_binary,
  }
})

describe(`basename_from_url`, () => {
  test.each([
    [`https://example.com/path/traj.xyz`, `traj.xyz`],
    [`/bad.xyz`, `bad.xyz`],
    [`traj.h5?X-Amz-Expires=300`, `traj.h5`],
    [`https://cdn.example/a/b.cif#frag`, `b.cif`],
    [`bare-name`, `bare-name`],
    [`https://example.com/dir/`, `https://example.com/dir/`],
  ])(`%s → %s`, (url, expected) => {
    expect(basename_from_url(url)).toBe(expected)
  })
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
    [`empty string URL`, JSON.stringify({ url: `` }), false],
    // Drop payloads are external input: truthy non-string urls must not reach fetch
    [`numeric URL`, JSON.stringify({ url: 123 }), false],
    [`object URL`, JSON.stringify({ url: { href: `https://x.com` } }), false],
  ])(`%s`, async (_, data, expected) => {
    get_data.mockReturnValue(data)
    expect(await handle_url_drop(drag_event, callback)).toBe(expected)
    expect(callback).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
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
    [`https://example.com/scan.raw`, `scan.raw`], // Bruker/Rigaku XRD binary
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
    const { received_content, received_filename } = await load_test_url(url, `text content`, {
      'content-type': `text/plain`,
    })
    expect(received_content).toBe(`text content`)
    expect(received_filename).toBe(expected_filename)
    // Known text formats skip the Range sniff and fetch directly, exactly once
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  // content-encoding gzip: browser already decompressed the stored .gz, so the body is
  // the inner file — text formats arrive as string, binary inner formats (.h5.gz) as
  // ArrayBuffer that a text decode would corrupt
  test.each([
    [`file.xyz.gz`, `decompressed content`],
    [`data.h5.gz`, new Uint8Array([0x89, 0x48, 0x44, 0x46]).buffer],
  ] as const)(`content-encoding gzip body passes through: %s`, async (name, body) => {
    const { received_content, received_filename } = await load_test_url(
      `https://example.com/${name}`,
      body,
      { 'content-encoding': `gzip` },
    )
    expect(received_content).toBe(body)
    expect(received_filename).toBe(name)
  })

  // No content-encoding: the .gz body is gunzipped manually, the .gz suffix stripped
  // from the filename, and binary inner formats (.h5.gz) stay ArrayBuffer
  test.each([
    [`file.xyz.gz`, `file.xyz`, `string`],
    [`x.h5.gz`, `x.h5`, `binary`],
  ] as const)(`manual gunzip: %s -> %s (%s)`, async (name, expected_name, kind) => {
    const inner = new TextEncoder().encode(`inner bytes`).buffer
    mock_decompress_binary.mockResolvedValue(inner)
    const { received_content, received_filename } = await load_test_url(
      `https://example.com/${name}`,
      new ArrayBuffer(8),
      { 'content-type': `application/octet-stream` },
    )
    expect(mock_decompress_binary).toHaveBeenCalledWith(new ArrayBuffer(8), `gzip`)
    expect(received_content).toBe(kind === `string` ? `inner bytes` : inner)
    expect(received_filename).toBe(expected_name)
  })

  test(`propagates decompress errors instead of falling through to a text fetch`, async () => {
    // Once magic bytes commit to gzip, a decompress failure must throw rather than be
    // swallowed and re-fetched as text (which would parse the binary bytes as garbage)
    mock_decompress_binary.mockRejectedValue(new Error(`corrupt gzip`))
    const gzip_header = new Uint8Array([0x1f, 0x8b, ...Array(14).fill(0)]).buffer
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(create_mock_response(gzip_header, {}))
      .mockResolvedValue(create_mock_response(new ArrayBuffer(8), {}))

    await expect(load_from_url(`https://example.com/blob-uuid`, () => {})).rejects.toThrow(
      `corrupt gzip`,
    )
  })

  test(`query string and hash are stripped before extension detection`, async () => {
    // Pre-signed URLs like traj.h5?X-Amz-Expires=300 must still hit the binary
    // path and not leak the query string into the callback filename
    const { received_content, received_filename } = await load_test_url(
      `https://example.com/data.h5?sig=abc`,
      new ArrayBuffer(8),
      { 'content-type': `application/octet-stream` },
    )
    expect(received_content).toBeInstanceOf(ArrayBuffer)
    expect(received_filename).toBe(`data.h5`)
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

  // Sniffed gzip magic on a URL without .gz extension is decompressed; a binary inner
  // extension from Content-Disposition (relax.traj.gz) keeps the payload an ArrayBuffer
  test.each([
    [`data.bin`, `string`, {}],
    [
      `relax.traj`,
      `binary`,
      { 'content-disposition': `attachment; filename="relax.traj.gz"` },
    ],
  ] as const)(`sniffed gzip -> %s (%s)`, async (expected_name, kind, headers) => {
    const inner = new TextEncoder().encode(`inner bytes`).buffer
    mock_decompress_binary.mockResolvedValue(inner)
    const gzip_header = new Uint8Array([0x1f, 0x8b, ...Array(14).fill(0)]).buffer
    const full_body = new ArrayBuffer(100)
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(create_mock_response(gzip_header, {}))
      .mockResolvedValueOnce(create_mock_response(full_body, headers))

    let received_content: string | ArrayBuffer | null = null
    let received_filename: string | null = null
    await load_from_url(`https://example.com/data.bin`, (content, filename) => {
      received_content = content
      received_filename = filename
    })

    expect(received_content).toBe(kind === `string` ? `inner bytes` : inner)
    expect(received_filename).toBe(expected_name)
    expect(mock_decompress_binary).toHaveBeenCalledWith(full_body, `gzip`)
  })

  test(`blob: object URL with text content passes UUID basename to callback`, async () => {
    const xyz_content = `3\ncomment\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH 0.0 1.0 0.0`
    const { received_content, received_filename } = await load_test_url(
      `blob:http://localhost:5173/8a3bf2c4-d1e2-4f5a-9b8c-7d6e5f4a3b2c`,
      xyz_content,
      {},
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

  describe(`Content-Disposition edge cases`, () => {
    test.each([
      // Quoted filename takes precedence over the URL basename
      [`filename="server-name.xyz"`, `server-name.xyz`, `quoted filename`],
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
      // RFC 5987 grammar is charset'language'value — strip the full prefix
      [
        `filename*=UTF-8'en'na%C3%AFve.cif`,
        `naïve.cif`,
        `RFC 5987 filename* with charset and language tag`,
      ],
      // Non-UTF-8 charset prefix must still be stripped; %FC is invalid UTF-8
      // so decodeURIComponent fails and the raw (prefix-stripped) value is kept
      [
        `filename*=iso-8859-1''f%FCr.txt`,
        `f%FCr.txt`,
        `RFC 5987 filename* with non-UTF-8 charset`,
      ],
      // No filename at all -> fall back to URL basename
      [``, `url-name.xyz`, `no filename falls back to URL basename`],
    ])(`%s -> %s (%s)`, async (disposition, expected, _desc) => {
      const { received_filename } = await load_test_url(
        `https://example.com/url-name.xyz`,
        `content`,
        {
          'content-type': `text/plain`,
          'content-disposition': `attachment${disposition ? `; ${disposition}` : ``}`,
        },
      )
      expect(received_filename).toBe(expected)
    })
  })

  test.each([`POSCAR`, `poscar`, `XDATCAR`, `xdatcar`, `CONTCAR`, `contcar`])(
    `recognizes extensionless VASP file %s as text`,
    async (basename) => {
      const poscar = `Si\n1.0\n5.43 0 0\n0 5.43 0\n0 0 5.43`
      const { received_content, received_filename } = await load_test_url(
        `https://example.com/${basename}`,
        poscar,
        { 'content-type': `text/plain` },
      )
      expect(received_content).toBe(poscar)
      expect(received_filename).toBe(basename)
      expect(globalThis.fetch).toHaveBeenCalledTimes(1) // No Range request for VASP files
    },
  )

  test(`awaits async callback`, async () => {
    const mock_response = new Response(`content`, {
      headers: { 'content-type': `text/plain` },
    })
    globalThis.fetch = vi.fn().mockResolvedValue(mock_response)

    const processed_files: string[] = []
    await load_from_url(`https://example.com/test.xyz`, async (_content, filename) => {
      await Promise.resolve()
      processed_files.push(filename)
    })

    expect(processed_files).toContain(`test.xyz`)
  })

  test(`gzip content-encoding on binary extension stays ArrayBuffer`, async () => {
    // Content-Encoding is transparent: fetch auto-decompresses, so the body is
    // the original binary and must not be lossily decoded to text
    const payload = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe, 0x00, 0x80])
    const { received_content, received_filename } = await load_test_url(
      `https://example.com/data.npz`,
      payload.buffer,
      { 'content-encoding': `gzip`, 'content-type': `application/octet-stream` },
    )
    expect(received_content).toBeInstanceOf(ArrayBuffer)
    expect(new Uint8Array(received_content as unknown as ArrayBuffer)).toEqual(payload)
    expect(received_filename).toBe(`data.npz`)
  })
})
