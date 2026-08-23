import {
  basename_from_url,
  dropped_file_url,
  load_from_url,
  load_trajectory_from_url,
  type FileLoadMeta,
} from '$lib/io'
import { gzipSync, zipSync } from 'fflate'
import { beforeEach, describe, expect, test, vi } from 'vitest'

globalThis.fetch = vi.fn()

// Real gzip/zip payloads: the loader must inflate by magic bytes, so mocks would hide the
// very classification bugs these tests exist to catch
const gzip = (bytes: Uint8Array | string): ArrayBuffer =>
  gzipSync(typeof bytes === `string` ? new TextEncoder().encode(bytes) : bytes).buffer
const hdf5_bytes = new Uint8Array([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2])
const as_bytes = async (content: unknown): Promise<Uint8Array> =>
  new Uint8Array(
    content instanceof Blob ? await content.arrayBuffer() : (content as ArrayBuffer),
  )

describe(`load_trajectory_from_url`, () => {
  beforeEach(() => vi.mocked(fetch).mockReset())

  // HDF5 (by name, Content-Disposition or magic bytes; plain, gzipped or zipped) reaches the
  // callback as one Blob from a single fetch, named so h5wasm recognizes it
  const content_disposition = (name: string) => ({
    'content-disposition': `attachment; filename="${name}"`,
  })
  test.each([
    { url: `run.h5`, body: hdf5_bytes, headers: {}, filename: `run.h5`, source: `run.h5` },
    {
      url: `run.h5`,
      body: hdf5_bytes,
      headers: content_disposition(`download`), // generic response filename
      filename: `run.h5`,
      source: `download`,
    },
    {
      url: `download.bin`, // generic URL, header names the HDF5 file
      body: hdf5_bytes,
      headers: content_disposition(`run.h5`),
      filename: `run.h5`,
      source: `run.h5`,
    },
    {
      url: `download`, // neither URL nor header names it: magic bytes earn a .h5 suffix
      body: hdf5_bytes,
      headers: {
        'content-type': `application/octet-stream`,
        ...content_disposition(`download`),
      },
      filename: `download.h5`,
      source: `download`,
    },
    {
      url: `download.gz`, // gzip inflated by magic, HDF5 recognized from inflated bytes
      body: gzip(hdf5_bytes),
      headers: {},
      filename: `download.h5`,
      source: `download.gz`,
    },
    {
      url: `download`, // extensionless gzip, no filename header
      body: gzip(hdf5_bytes),
      headers: {},
      filename: `download.h5`,
      source: `download`,
    },
    {
      url: `download`, // extensionless gzip, HDF5 gzip filename header
      body: gzip(hdf5_bytes),
      headers: content_disposition(`run.h5.gz`),
      filename: `run.h5`,
      source: `run.h5.gz`,
    },
    {
      url: `run.h5.gz`, // Content-Disposition without extension must not lose the .h5 name
      body: gzip(hdf5_bytes),
      headers: content_disposition(`download`),
      filename: `run.h5`,
      source: `download`,
    },
    {
      url: `run.h5.zip`,
      body: zipSync({ 'run.h5': hdf5_bytes }),
      headers: {},
      filename: `run.h5`,
      source: `run.h5.zip`,
    },
  ])(
    `loads $url with headers $headers as Blob $filename`,
    async ({ url: basename, body, headers, filename, source }) => {
      const url = `https://example.com/${basename}`
      vi.mocked(fetch).mockResolvedValueOnce(new Response(body, { headers }))
      const callback = vi.fn()

      await load_trajectory_from_url(url, callback)

      expect(fetch).toHaveBeenCalledExactlyOnceWith(url, { signal: undefined })
      expect(callback).toHaveBeenCalledOnce()
      const [content, received_filename, metadata] = callback.mock.calls[0]
      expect(content).toBeInstanceOf(Blob)
      expect(await as_bytes(content)).toEqual(hdf5_bytes)
      expect([received_filename, metadata]).toEqual([
        filename,
        { source_filename: source, source_url: url },
      ])
    },
  )

  test(`rejects a failed generic response before classification`, async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(null, { status: 416, statusText: `Range Not Satisfiable` }),
    )

    await expect(
      load_trajectory_from_url(`https://example.com/download`, vi.fn()),
    ).rejects.toThrow(
      `Failed to fetch https://example.com/download: HTTP 416 Range Not Satisfiable`,
    )
    expect(fetch).toHaveBeenCalledOnce()
  })

  test(`rejects a header-named unsupported HDF5 wrapper`, async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(`bytes`, {
        headers: { 'content-disposition': `attachment; filename="run.h5.bz2"` },
      }),
    )
    await expect(
      load_trajectory_from_url(`https://example.com/download.bin`, vi.fn()),
    ).rejects.toThrow(
      `BZ2 decompression is not supported in the browser; extract https://example.com/download.bin first`,
    )
  })
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

describe(`dropped_file_url`, () => {
  const drag_event = (data: string) =>
    ({ dataTransfer: { getData: () => data } }) as unknown as DragEvent

  test.each([
    [`no JSON data`, ``],
    [`no URL in JSON`, JSON.stringify({ name: `test.json` })],
    [`empty string URL`, JSON.stringify({ url: `` })],
    // Drop payloads are external input: truthy non-string urls must not reach fetch
    [`numeric URL`, JSON.stringify({ url: 123 })],
    [`object URL`, JSON.stringify({ url: { href: `https://x.com` } })],
    [`malformed JSON`, `invalid`],
  ])(`%s → undefined`, (_, data) => {
    expect(dropped_file_url(drag_event(data))).toBeUndefined()
  })

  test(`valid JSON with URL`, () => {
    const data = JSON.stringify({ name: `test.json`, url: `https://example.com/test.json` })
    expect(dropped_file_url(drag_event(data))).toBe(`https://example.com/test.json`)
  })
})

describe(`load_from_url`, () => {
  const create_mock_response = (content: string | ArrayBuffer, headers = {}) =>
    new Response(content, { headers })

  const load_test_url = async (
    url: string,
    content: string | ArrayBuffer,
    headers: Record<string, string> = {},
  ): Promise<{
    received_content: string | ArrayBuffer | null
    received_filename: string | null
    received_metadata: FileLoadMeta | null
  }> => {
    const mock_response = create_mock_response(content, headers)
    globalThis.fetch = vi.fn().mockResolvedValue(mock_response)

    let received_content: string | ArrayBuffer | null = null
    let received_filename: string | null = null
    let received_metadata: FileLoadMeta | null = null

    await load_from_url(url, (loaded_content, filename, metadata) => {
      received_content = loaded_content
      received_filename = filename
      received_metadata = metadata
    })

    return { received_content, received_filename, received_metadata }
  }

  test(`text content`, async () => {
    const { received_content, received_filename, received_metadata } = await load_test_url(
      `https://example.com/test.json`,
      `data`,
      { 'content-type': `text/plain` },
    )
    expect(received_content).toBe(`data`)
    expect(received_filename).toBe(`test.json`)
    expect(received_metadata).toEqual({
      source_filename: `test.json`,
      source_url: `https://example.com/test.json`,
    })
    expect(fetch).toHaveBeenCalledWith(`https://example.com/test.json`, { signal: undefined })
  })

  // extension lists are unit-tested in io/is-binary.test.ts; .raw is Bruker/Rigaku XRD binary
  test.each([`test.h5`, `scan.raw`])(`binary extension %s`, async (filename) => {
    const { received_content, received_filename } = await load_test_url(
      `https://example.com/${filename}`,
      new ArrayBuffer(8),
      { 'content-type': `application/octet-stream` },
    )
    expect(received_content).toBeInstanceOf(ArrayBuffer)
    expect(received_filename).toBe(filename)
  })

  test.each([
    [`backup.bz2`, `BZ2`],
    [`archive.xz`, `XZ`],
  ])(
    `rejects %s before fetching instead of handing a parser archive bytes`,
    async (name, label) => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(new ArrayBuffer(8)))
      await expect(load_from_url(`https://example.com/${name}`, () => {})).rejects.toThrow(
        `${label} decompression is not supported in the browser; extract https://example.com/${name} first`,
      )
      expect(globalThis.fetch).not.toHaveBeenCalled()
    },
  )

  test(`unzips a single-file ZIP URL and strips the extension`, async () => {
    const zip = zipSync({ 'structure.cif': new TextEncoder().encode(`data_zip`) })
    const { received_content, received_filename } = await load_test_url(
      `https://example.com/structure.cif.zip`,
      zip.buffer,
    )
    expect(received_content).toBe(`data_zip`)
    expect(received_filename).toBe(`structure.cif`)
  })

  // Body already inflated (fetch transparently decoded a Content-Encoding: gzip response, the
  // GitHub Pages way of serving a stored .gz). Text formats arrive as string, binary inner
  // formats (.h5.gz) as ArrayBuffer that a text decode would corrupt.
  test.each([
    [`file.xyz.gz`, `decompressed content`, `string`],
    [`data.h5.gz`, new Uint8Array([0x89, 0x48, 0x44, 0x46]).buffer, `binary`],
  ] as const)(`inflated gzip body passes through: %s`, async (name, body, kind) => {
    const { received_content, received_filename, received_metadata } = await load_test_url(
      `https://example.com/${name}`,
      body,
      { 'content-encoding': `gzip` },
    )
    if (kind === `binary`) expect(received_content).toEqual(body)
    else expect(received_content).toBe(`decompressed content`)
    expect(received_filename).toBe(name.replace(/\.gz$/, ``))
    expect(received_metadata?.source_filename).toBe(name)
  })

  // A body that still starts with the gzip magic is gunzipped here, the .gz suffix stripped
  // from the filename, and binary inner formats (.h5.gz) stay ArrayBuffer. The header is
  // deliberately varied: a host can send Content-Encoding: gzip for a stored .gz it ALSO
  // transport-compressed, leaving one layer for us after fetch strips the other. Trusting the
  // header there hands raw gzip to TextDecoder and yields mojibake.
  test.each([
    [`file.xyz.gz`, `file.xyz`, `string`, {}],
    [`x.h5.gz`, `x.h5`, `binary`, {}],
    [`file.xyz.gz`, `file.xyz`, `string`, { 'content-encoding': `gzip` }],
    [`x.h5.gz`, `x.h5`, `binary`, { 'content-encoding': `gzip` }],
  ] as const)(
    `gunzips a still-compressed body: %s -> %s (%s) %j`,
    async (name, expected_name, kind, headers) => {
      const { received_content, received_filename, received_metadata } = await load_test_url(
        `https://example.com/${name}`,
        gzip(`inner bytes`),
        { 'content-type': `application/octet-stream`, ...headers },
      )
      if (kind === `string`) expect(received_content).toBe(`inner bytes`)
      else
        expect(new TextDecoder().decode(await as_bytes(received_content))).toBe(`inner bytes`)
      expect(received_filename).toBe(expected_name)
      expect(received_metadata?.source_filename).toBe(name)
    },
  )

  test(`propagates corrupt gzip errors`, async () => {
    // Once magic bytes identify gzip, corrupt compressed content must fail explicitly.
    const gzip_body = new Uint8Array([0x1f, 0x8b, ...Array(14).fill(0)]).buffer
    globalThis.fetch = vi.fn().mockResolvedValueOnce(create_mock_response(gzip_body))

    await expect(load_from_url(`https://example.com/blob-uuid`, () => {})).rejects.toThrow(
      `Failed to decompress gzip file`,
    )
    expect(globalThis.fetch).toHaveBeenCalledOnce()
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
      const response_body =
        expected_content ??
        new Uint8Array([...header, ...Array(100 - header.length).fill(0)]).buffer
      const mock_response = create_mock_response(response_body, {
        'content-type': expected_content ? `text/plain` : `application/octet-stream`,
      })

      globalThis.fetch = vi.fn().mockResolvedValueOnce(mock_response)

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
        expect(globalThis.fetch).toHaveBeenCalledOnce()
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
      expect(globalThis.fetch).toHaveBeenCalledOnce()
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
    const { received_content, received_filename } = await load_test_url(
      `https://example.com/data.bin`,
      gzip(`inner bytes`),
      headers,
    )

    if (kind === `string`) expect(received_content).toBe(`inner bytes`)
    else expect(new TextDecoder().decode(await as_bytes(received_content))).toBe(`inner bytes`)
    expect(received_filename).toBe(expected_name)
    expect(globalThis.fetch).toHaveBeenCalledOnce()
  })

  test(`blob: object URL with text content passes UUID basename to callback`, async () => {
    const xyz_content = `3\ncomment\nH 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH 0.0 1.0 0.0`
    const { received_content, received_filename } = await load_test_url(
      `blob:http://localhost:5173/8a3bf2c4-d1e2-4f5a-9b8c-7d6e5f4a3b2c`,
      xyz_content,
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

  test(`fetch error with status`, async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }))

    await expect(load_from_url(`https://example.com/missing.json`, () => {})).rejects.toThrow(
      `Failed to fetch https://example.com/missing.json: HTTP 404`,
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

  test.each([`POSCAR`, `xdatcar`])(
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
      expect(globalThis.fetch).toHaveBeenCalledOnce()
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
