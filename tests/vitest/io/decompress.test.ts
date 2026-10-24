import {
  classify_payload,
  decode_text_chunks,
  decompress_file,
  decompress_trajectory_file,
  detect_compression_format,
  inflation_limiter,
  is_empty_content,
  MAX_INFLATED_BYTES,
  MAX_STRING_CHARS,
  MAX_WRAPPER_LAYERS,
} from '#lib/io/decompress.js'
import { zipSync } from 'fflate'
import { describe, expect, test, vi } from 'vitest'

const compress = async (
  data: Uint8Array<ArrayBuffer>,
  format: `gzip` | `deflate` = `gzip`,
): Promise<ArrayBuffer> => {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream(format))
  return new Response(stream).arrayBuffer()
}

const hdf5_signature = new Uint8Array([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a])
const encode = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text)

test.each([
  [`test.json.gz`, `gzip`],
  [`structure.gzip`, `gzip`],
  [`data.deflate`, `deflate`],
  [`file.z`, `lzw`],
  [`archive.zip`, `zip`],
  [`test.json`, null], // no compression
  [``, null],
  [`file.gz.txt`, null], // extension not at end
])(`detect_compression_format(%s) = %s`, (filename: string, expected: string | null) => {
  expect(detect_compression_format(filename)).toBe(expected)
})

// one compression layer, named by the file extension
const inflate = async (data: BlobPart, filename: string) =>
  (await classify_payload(new Blob([data]), [filename])).content

describe(`classify_payload decompression`, () => {
  test(`throws when DecompressionStream is not supported`, async () => {
    const orig_decompression_stream = globalThis.DecompressionStream
    // @ts-expect-error - intentionally deleting for test
    delete globalThis.DecompressionStream
    await expect(inflate(``, `data.gz`)).rejects.toThrow(
      `Failed to decompress gzip file: ReferenceError: DecompressionStream is not defined`,
    )
    globalThis.DecompressionStream = orig_decompression_stream
  })

  test.each([`valid`, `unsupported compression`, `oversized metadata`] as const)(
    `unzips only the payload, skipping %s in ignored entries`,
    async (metadata) => {
      const zip = zipSync({
        '.DS_Store': new Uint8Array([2]),
        'dir/': new Uint8Array(),
        '__MACOSX/._a.cif': new Uint8Array([1]),
        'a.cif': encode(`data_a`),
      })
      const view = new DataView(zip.buffer)
      for (let offset = 0; offset < zip.length - 4; offset++) {
        if (view.getUint32(offset, true) !== 0x02014b50) continue
        // First central-directory entry is .DS_Store, never extracted, so its header can't matter
        if (metadata === `unsupported compression`) view.setUint16(offset + 10, 99, true)
        if (metadata === `oversized metadata`)
          view.setUint32(offset + 24, MAX_INFLATED_BYTES + 1, true)
        break
      }
      expect(await inflate(zip, `a.zip`)).toBe(`data_a`)
    },
  )

  test.each([
    [{}, `ZIP archive contains no files`],
    [
      { 'a.cif': new Uint8Array([1]), 'b.cif': new Uint8Array([2]) },
      `ZIP archive must contain exactly one file, found 2: a.cif, b.cif`,
    ],
  ])(`rejects ambiguous ZIP archives %o`, async (entries, message) => {
    await expect(inflate(zipSync(entries), `a.zip`)).rejects.toThrow(message)
  })
})

// Text decodes to a string, binary stays ArrayBuffer; the trajectory loader keeps HDF5 a Blob
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

  // Formats the browser cannot inflate fail up front instead of reaching a parser as bytes
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

  // Text past one JS string stays a Blob for chunked trajectory readers; other loaders refuse it
  test(`keeps text past the string limit Blob-backed for trajectory loaders only`, async () => {
    const file = new File([`2\ncomment\nH 0 0 0\nH 1 0 0`], `huge.xyz`)
    Object.defineProperty(file, `size`, { value: MAX_STRING_CHARS + 1 })
    const { content, filename } = await decompress_trajectory_file(file)
    expect(content).toBe(file)
    expect(filename).toBe(`huge.xyz`)
    await expect(decompress_file(file)).rejects.toThrow(
      `exceeds the ${MAX_STRING_CHARS}-character JS string limit`,
    )
  })

  test.each([
    [`POSCAR`, `H 0 0 0\nO 1 1 1`, false], // extensionless VASP text
    [`empty.txt`, ``, false], // 0-byte file resolves to empty content
    [`payload.dump`, `plain text payload`, false], // unknown extension without binary magic
    // gzip bytes behind a wrong or missing extension reached the parsers as raw ArrayBuffers
    [`POSCAR`, `{"gzipped": "POSCAR"}`, true],
    [`test.json`, `{"gzipped": "test.json"}`, true],
  ])(`decodes text file %s to a string (gzipped=%s)`, async (filename, text, gzipped) => {
    const file = new File([gzipped ? await compress(encode(text)) : text], filename)
    expect(await decompress_file(file)).toEqual({ content: text, filename })
  })

  // Compressed bytes stream out of the File instead of being buffered
  test.each([
    [`gzip`, `gz`],
    [`deflate`, `deflate`],
  ] as const)(`decompresses %s text and strips the extension`, async (format, ext) => {
    const text = `{"compressed": true, "format": "${format}"}`
    const file = new File([await compress(encode(text), format)], `test.json.${ext}`)
    const array_buffer = vi.spyOn(file, `arrayBuffer`)
    expect(await decompress_file(file)).toEqual({ content: text, filename: `test.json` })
    expect(array_buffer).not.toHaveBeenCalled()
    // Unlike HTTP bodies, dropped files cannot have had a transport wrapper removed.
    await expect(decompress_file(new File([text], `test.json.${ext}`))).rejects.toThrow(
      `Failed to decompress ${format} file`,
    )
  })

  test.each([`gzip/gzip`, `zip/gzip`, `gzip/zip`, `zip/zip`, `gzip/deflate`] as const)(
    `decodes every layer of %s and retains the payload name`,
    async (layers) => {
      const text = `data_nested`
      let bytes = encode(text)
      let filename = `nested.cif`
      for (const layer of layers.split(`/`).toReversed()) {
        if (layer === `zip`) {
          bytes = zipSync({ [filename]: bytes })
          filename = `bundle.zip`
        } else {
          bytes = new Uint8Array(await compress(bytes, layer as `gzip` | `deflate`))
          filename += layer === `gzip` ? `.gz` : `.deflate`
        }
      }
      expect(await decompress_file(new File([bytes], filename))).toEqual({
        content: text,
        filename: `nested.cif`,
      })
      expect(
        await classify_payload(new Blob([bytes]), [filename], {
          wrappers_may_be_decoded: true,
        }),
      ).toEqual({ content: text, filename: `nested.cif` })
    },
  )

  // Self-reproducing archives (ZIP quine r.zip, gzip quines) used to unwrap forever
  test.each([MAX_WRAPPER_LAYERS, MAX_WRAPPER_LAYERS + 1])(
    `%i gzip layers decode up to MAX_WRAPPER_LAYERS and reject past it instead of looping`,
    async (n_layers) => {
      let bytes = encode(`data_deep`)
      for (let layer = 0; layer < n_layers; layer++)
        bytes = new Uint8Array(await compress(bytes))
      const result = classify_payload(new Blob([bytes]), [`deep.cif`], {
        wrappers_may_be_decoded: true,
      })
      if (n_layers === MAX_WRAPPER_LAYERS) {
        expect(await result).toEqual({ content: `data_deep`, filename: `deep.cif` })
        return
      }
      await expect(result).rejects.toThrow(
        `deep.cif nests more than ${MAX_WRAPPER_LAYERS} compression layers`,
      )
      // a ZIP entry named like a ZIP keeps unwrapping by name alone
      let zip = encode(`data_zip`)
      for (let layer = 0; layer <= MAX_WRAPPER_LAYERS; layer++) zip = zipSync({ 'r.zip': zip })
      await expect(decompress_file(new File([zip], `r.zip`))).rejects.toThrow(
        `nests more than ${MAX_WRAPPER_LAYERS} compression layers`,
      )
    },
  )

  // Stripping `.zip` named the CIF `bundle`; a sibling `.h5` URL basename forced it to bytes
  test(`names a ZIP payload after its entry, not the archive or a sibling name, and keeps a binary payload's own name authoritative`, async () => {
    const zip = zipSync({ 'nested/a.cif': encode(`data_zipped`) })
    const entry = { content: `data_zipped`, filename: `a.cif` }
    expect(await decompress_file(new File([zip], `bundle.zip`))).toEqual(entry)
    expect(await classify_payload(new Blob([zip]), [`bundle.zip`, `download.h5`])).toEqual(
      entry,
    )
    expect(
      await classify_payload(new Blob([zip]), [`bundle.zip`, `download.h5`], {
        hdf5_as_blob: true,
      }),
    ).toEqual(entry)
    // and a payload whose own name IS binary still comes back as bytes
    const traj = await classify_payload(new Blob([encode(`x`)]), [`run.traj`, `page.cif`])
    expect(traj.content).toBeInstanceOf(ArrayBuffer)
  })

  // Wrapping a caller's abort as a decompression failure hid its name and reason
  test(`propagates an abort instead of wrapping it as a decompression failure`, async () => {
    const controller = new AbortController()
    const reason = new DOMException(`Superseded by a newer load`, `AbortError`)
    controller.abort(reason)
    for (const filename of [`a.h5.gz`, `a.h5`, `a.cif`]) {
      const file = new File([new Uint8Array(8)], filename)
      await expect(decompress_trajectory_file(file, controller.signal)).rejects.toBe(reason)
    }
  })

  // Binary stays ArrayBuffer by extension or, lacking one (also after inflating), by magic
  // bytes; a UTF-8 decode would corrupt bytes >= 0x80. Signatures are in is-binary.test.ts
  test.each([
    [`binary extension`, `model.npz`, [0x00, 0x80, 0xff, 0x12, 0x89, 0x48]],
    [`ASE Ulm magic`, `payload.dump`, [0x2d, 0x20, 0x6f, 0x66, 0x20, 0x55, 0x6c, 0x6d]],
    [`gzipped HDF5 magic`, `payload.gz`, [...hdf5_signature, 0x01, 0x02]],
  ])(`keeps %s as ArrayBuffer`, async (_label, filename, byte_seq) => {
    const bytes = new Uint8Array(byte_seq)
    const gzipped = filename.endsWith(`.gz`)
    const file = new File([gzipped ? await compress(bytes) : bytes], filename)
    const result = await decompress_file(file)
    expect(result.content).toBeInstanceOf(ArrayBuffer)
    expect(new Uint8Array(result.content as ArrayBuffer)).toEqual(bytes)
    expect(result.filename).toBe(filename.replace(/\.gz$/, ``))
  })
})

// Measured by length/size, never by encoding a string into a Blob (300 MB of text cost ~900 MB)
test.each([
  [``, true],
  [` `, false],
  [new ArrayBuffer(0), true],
  [new ArrayBuffer(1), false],
  [new Blob([]), true],
  [new Blob([`x`]), false],
])(`is_empty_content(%o) = %s`, (content, expected) => {
  expect(is_empty_content(content)).toBe(expected)
  if (typeof content !== `string`) return
  const blob_ctor = vi.spyOn(globalThis, `Blob`)
  is_empty_content(content)
  expect(blob_ctor).not.toHaveBeenCalled()
  blob_ctor.mockRestore()
})

// Cuts land just after a newline, so chunks join to one decode's text: multi-byte UTF-8, CRLF,
// a leading BOM (dropped) or later one (kept), lines longer than a chunk (which widen it)
test.each([
  ``,
  `a`,
  `\n`,
  `x\ny\n`,
  `\uFEFFH 0 0 0\r\nÅ 1 1 1\n`,
  `x\n\uFEFFy\n`,
  `漢字 🎉 é\nlong line ${`z`.repeat(40)}\nend`,
  `no newline at all ${`q`.repeat(30)}`,
])(`decode_text_chunks chunks %j at every size and source type`, async (text) => {
  const bytes = encode(text)
  const expected = new TextDecoder().decode(bytes)
  const longest_line = Math.max(...text.split(`\n`).map((line) => encode(line).length + 1))
  for (const source of [bytes.buffer, new Blob([bytes])]) {
    // by default, text that fits one string decodes to one
    expect(await decode_text_chunks(source)).toEqual([expected])
    for (const chunk_bytes of [1, 2, 3, 7, 16, 1000]) {
      const chunks = await decode_text_chunks(source, chunk_bytes)
      expect(chunks.join(``)).toBe(expected)
      expect(chunks.slice(0, -1).every((chunk) => chunk.endsWith(`\n`))).toBe(true)
      if (longest_line <= chunk_bytes)
        expect(chunks.every((chunk) => encode(chunk).length <= chunk_bytes)).toBe(true)
    }
  }
})

// gzip reaches 1029:1 on repetitive input (measured), so the compressed size bounds nothing:
// a 10 MiB upload expands to 10 GB with no error until the tab dies
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

test(`inflation_limiter aborts mid-stream once the inflated payload passes the cap`, async () => {
  const limited = source().pipeThrough(inflation_limiter(`gzip`, 256 * 1024))
  await expect(new Response(limited).arrayBuffer()).rejects.toThrow(
    /GZIP payload inflates to at least \d+ bytes, past the 262144-byte limit/,
  )
  expect(emitted).toBeLessThan(1024 * 1024) // stopped early, not after the whole 4 MiB
  // and the real cap does not clip an ordinary payload
  const passed = source().pipeThrough(inflation_limiter(`gzip`, MAX_INFLATED_BYTES))
  expect((await new Response(passed).arrayBuffer()).byteLength).toBe(4 * 1024 * 1024)
})
