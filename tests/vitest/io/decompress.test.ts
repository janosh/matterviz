import {
  classify_payload,
  decompress_data,
  decompress_file,
  decompress_trajectory_file,
  detect_compression_format,
  inflation_limiter,
  MAX_INFLATED_BYTES,
} from '$lib/io/decompress'
import { zipSync } from 'fflate'
import { describe, expect, test, vi } from 'vitest'

// Compress bytes with the platform CompressionStream for round-trip tests
const compress = async (
  data: Uint8Array,
  format: `gzip` | `deflate` | `deflate-raw` = `gzip`,
): Promise<ArrayBuffer> => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(data)
      controller.close()
    },
  })
  return new Response(stream.pipeThrough(new CompressionStream(format))).arrayBuffer()
}

const hdf5_signature = new Uint8Array([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a])
const encode = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text)

describe(`detect_compression_format`, () => {
  test.each([
    [`test.json.gz`, `gzip`],
    [`structure.gzip`, `gzip`],
    [`data.deflate`, `deflate`],
    [`file.z`, `deflate-raw`],
    [`archive.zip`, `zip`],
    [`test.json`, null], // no compression
    [``, null],
    [`file.gz.txt`, null], // extension not at end
  ])(`%s -> %s`, (filename: string, expected: string | null) => {
    expect(detect_compression_format(filename)).toBe(expected)
  })
})

describe(`decompress_data`, () => {
  test(`should throw error when DecompressionStream is not supported`, async () => {
    const orig_decompression_stream = globalThis.DecompressionStream
    // @ts-expect-error - intentionally deleting for test
    delete globalThis.DecompressionStream

    await expect(decompress_data(new ArrayBuffer(0), `gzip`)).rejects.toThrow(
      `Failed to decompress gzip file: ReferenceError: DecompressionStream is not defined`,
    )

    globalThis.DecompressionStream = orig_decompression_stream
  })

  test.each([`bz2`, `xz`] as const)(`rejects %s (no browser decoder)`, async (format) => {
    await expect(decompress_data(new ArrayBuffer(0), format)).rejects.toThrow(
      `${format.toUpperCase()} decompression is not supported in the browser; extract the ${format.toUpperCase()} file first`,
    )
  })

  test(`unzips the single payload file of a ZIP archive, skipping junk entries`, async () => {
    const zip = zipSync({
      'dir/': new Uint8Array(),
      '__MACOSX/._a.cif': new Uint8Array([1]),
      '.DS_Store': new Uint8Array([2]),
      'a.cif': encode(`data_a`),
    })
    expect(await decompress_data(zip.buffer, `zip`)).toBe(`data_a`)
  })

  test.each([
    [{}, `ZIP archive contains no files`],
    [
      { 'a.cif': new Uint8Array([1]), 'b.cif': new Uint8Array([2]) },
      `ZIP archive must contain exactly one file, found 2: a.cif, b.cif`,
    ],
  ])(`rejects ambiguous ZIP archives %o`, async (entries, message) => {
    await expect(decompress_data(zipSync(entries).buffer, `zip`)).rejects.toThrow(message)
  })

  test(`wraps stream decompression errors with the format name`, async () => {
    const invalid_data = new Uint8Array(10).fill(255).buffer
    await expect(decompress_data(invalid_data, `gzip`)).rejects.toThrow(
      `Failed to decompress gzip file`,
    )
  })

  test.each([[`gzip`], [`deflate`], [`deflate-raw`]] as const)(
    `should successfully decompress valid %s data`,
    async (format) => {
      const test_string = `{"test": "data", "format": "${format}"}`
      const compressed = await compress(encode(test_string), format)
      expect(await decompress_data(compressed, format)).toBe(test_string)
    },
  )
})

// decompress_file returns string | ArrayBuffer: text decodes to a string, binary payloads
// (by extension or magic bytes) stay ArrayBuffer so a lossy UTF-8 decode can't corrupt them.
// decompress_trajectory_file additionally keeps HDF5 payloads Blob-backed for h5wasm.
describe(`decompress_file / decompress_trajectory_file`, () => {
  // Named or extensionless, plain or gzipped: HDF5 never round-trips through arrayBuffer()
  test.each([
    { filename: `trajectory.h5`, gzipped: false, expected_filename: `trajectory.h5` },
    { filename: `download`, gzipped: false, expected_filename: `download.h5` },
    { filename: `trajectory.h5.gz`, gzipped: true, expected_filename: `trajectory.h5` },
    { filename: `download.gz`, gzipped: true, expected_filename: `download.h5` },
  ])(
    `keeps HDF5 File $filename Blob-backed as $expected_filename`,
    async ({ filename, gzipped, expected_filename }) => {
      const bytes = new Uint8Array([...hdf5_signature, 1, 2])
      const file = new File([gzipped ? await compress(bytes) : bytes], filename)
      const array_buffer = vi.spyOn(file, `arrayBuffer`)
      const result = await decompress_trajectory_file(file)

      expect(array_buffer).not.toHaveBeenCalled()
      expect(result.filename).toBe(expected_filename)
      expect(result.content).toBeInstanceOf(Blob)
      if (!gzipped) expect(result.content).toBe(file)
      expect(new Uint8Array(await (result.content as Blob).arrayBuffer())).toEqual(bytes)
    },
  )

  // archive formats the browser cannot inflate fail up front with a clear message rather
  // than reaching a parser as opaque bytes
  test.each([
    [`test.json.bz2`, `BZ2`, decompress_file],
    [`trajectory.h5.xz`, `XZ`, decompress_trajectory_file],
  ])(`rejects unsupported compression %s`, async (filename, label, loader) => {
    await expect(loader(new File([`bytes`], filename))).rejects.toThrow(
      `${label} decompression is not supported in the browser; extract ${filename} first`,
    )
  })

  test.each([
    [`plain`, `structure.xyz`, false],
    [`gzipped`, `structure.xyz.gz`, true],
  ])(`decodes a %s non-HDF5 trajectory File to text`, async (_label, filename, gzipped) => {
    const text = `2\ncomment\nH 0 0 0\nH 1 0 0`
    const bytes = encode(text)
    const file = new File([gzipped ? await compress(bytes) : bytes], filename)
    expect(await decompress_trajectory_file(file)).toEqual({
      content: text,
      filename: `structure.xyz`,
    })
  })

  test.each([
    [`POSCAR`, `H 0 0 0\nO 1 1 1`], // extensionless VASP text
    [`empty.txt`, ``], // 0-byte file resolves to empty content
  ])(`decodes text file %s to a string`, async (filename, text) => {
    expect(await decompress_file(new File([text], filename))).toEqual({
      content: text,
      filename,
    })
  })

  // supported compressed text → string, with the compression extension stripped
  test.each([
    [`gzip`, `gz`],
    [`deflate`, `deflate`],
    [`deflate-raw`, `z`],
  ] as const)(`decompresses %s text and strips the extension`, async (format, ext) => {
    const text = `{"compressed": true, "format": "${format}"}`
    const compressed = await compress(encode(text), format)
    const result = await decompress_file(new File([compressed], `test.json.${ext}`))
    expect(result).toEqual({ content: text, filename: `test.json` })
  })

  test(`unzips a dropped .zip and strips the extension`, async () => {
    const zip = zipSync({ 'test.json': encode(`{"zipped": true}`) })
    expect(await decompress_file(new File([zip], `test.json.zip`))).toEqual({
      content: `{"zipped": true}`,
      filename: `test.json`,
    })
  })

  // Stripping `.zip` off `bundle.zip` named the CIF `bundle`, so every extension-keyed
  // dispatcher missed it. `names` also carries the URL basename after the dropped name, and
  // only the payload's OWN name may decide text vs binary: matching ANY candidate let the
  // `.h5` basename below force a plain CIF entry to ArrayBuffer.
  test(`names a ZIP payload after its entry, not the archive or a sibling name, and keeps a binary payload's own name authoritative`, async () => {
    const zip = zipSync({ 'nested/a.cif': encode(`data_zipped`) })
    const entry = { content: `data_zipped`, filename: `a.cif` }
    expect(await decompress_file(new File([zip], `bundle.zip`))).toEqual(entry)
    expect(await classify_payload(new Blob([zip]), [`bundle.zip`, `download.h5`])).toEqual(
      entry,
    )
    // and a payload whose own name IS binary still comes back as bytes
    const traj = await classify_payload(new Blob([encode(`x`)]), [`run.traj`, `page.cif`])
    expect(traj.content).toBeInstanceOf(ArrayBuffer)
  })

  // Wrapping a caller's abort as a decompression failure hid its name and reason
  test(`propagates an abort instead of wrapping it as a decompression failure`, async () => {
    const controller = new AbortController()
    const reason = new DOMException(`Superseded by a newer load`, `AbortError`)
    controller.abort(reason)
    const file = new File([new Uint8Array(8)], `a.h5.gz`)
    await expect(decompress_trajectory_file(file, controller.signal)).rejects.toBe(reason)
  })

  test(`streams compressed bytes out of the File instead of buffering them`, async () => {
    const text = `streamed`
    const file = new File([await compress(encode(text))], `a.json.gz`)
    const array_buffer = vi.spyOn(file, `arrayBuffer`)
    expect(await decompress_file(file)).toEqual({ content: text, filename: `a.json` })
    expect(array_buffer).not.toHaveBeenCalled()
  })

  test(`rejects when a compressed file fails to decompress`, async () => {
    const invalid = new Uint8Array(10).fill(255)
    await expect(decompress_file(new File([invalid], `test.json.gz`))).rejects.toThrow(
      `Failed to decompress gzip file`,
    )
  })

  // Binary stays ArrayBuffer whether flagged by extension or (for unknown extensions) by magic
  // bytes; a lossy UTF-8 decode would corrupt bytes >= 0x80 into U+FFFD. The individual
  // extension lists and magic signatures are unit-tested in io/is-binary.test.ts.
  test.each([
    [`binary extension`, `model.npz`, [0x00, 0x80, 0xff, 0x12, 0x89, 0x48]],
    [
      `ASE Ulm magic, unknown extension`,
      `payload.dump`,
      [0x2d, 0x20, 0x6f, 0x66, 0x20, 0x55, 0x6c, 0x6d],
    ],
  ])(`keeps %s as ArrayBuffer`, async (_label, filename, byte_seq) => {
    const bytes = new Uint8Array(byte_seq)
    const result = await decompress_file(new File([bytes], filename))
    expect(result.content).toBeInstanceOf(ArrayBuffer)
    expect(new Uint8Array(result.content as ArrayBuffer)).toEqual(bytes)
    expect(result.filename).toBe(filename)
  })

  test(`decodes an unknown-extension file without binary magic to string`, async () => {
    const text = `plain text payload`
    const result = await decompress_file(new File([text], `payload.dump`))
    expect(result.content).toBe(text)
  })

  // a compressed binary payload without a binary inner extension must still stay ArrayBuffer
  // via post-decompression magic-byte detection (else a text decode corrupts it)
  test(`keeps a gzipped binary payload (by magic) as ArrayBuffer`, async () => {
    const hdf5 = new Uint8Array([...hdf5_signature, 0x01, 0x02])
    const gz = await compress(hdf5)
    // payload.gz -> payload (no binary extension): only magic bytes can save it
    const result = await decompress_file(new File([gz], `payload.gz`))
    expect(result.content).toBeInstanceOf(ArrayBuffer)
    expect(new Uint8Array(result.content as ArrayBuffer)).toEqual(hdf5)
    expect(result.filename).toBe(`payload`)
  })
})

// gzip reaches 1029:1 on repetitive input (measured), so the compressed size bounds nothing:
// a 10 MiB upload expands to 10 GB with no error until the tab dies
describe(`inflated size limit`, () => {
  // 4 MiB fed 64 KiB at a time; `emitted` records how much was pulled before an abort
  let emitted = 0
  const source = () => {
    emitted = 0
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        emitted += 64 * 1024
        controller.enqueue(new Uint8Array(64 * 1024).fill(7))
        if (emitted >= 4 * 1024 * 1024) controller.close()
      },
    })
  }

  test(`aborts mid-stream once the inflated payload passes the cap`, async () => {
    const limited = source().pipeThrough(inflation_limiter(`gzip`, 256 * 1024))
    await expect(new Response(limited).arrayBuffer()).rejects.toThrow(
      /GZIP payload inflates to at least \d+ bytes, past the 262144-byte limit/,
    )
    expect(emitted).toBeLessThan(1024 * 1024) // stopped early, not after the whole 4 MiB
    // and the real cap does not clip an ordinary payload
    const passed = source().pipeThrough(inflation_limiter(`gzip`, MAX_INFLATED_BYTES))
    expect((await new Response(passed).arrayBuffer()).byteLength).toBe(4 * 1024 * 1024)
  })
})
