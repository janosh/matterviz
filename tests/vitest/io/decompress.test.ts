import { decompress_file } from '$lib/io/decompress'
import { expect, test } from 'vitest'

test(`decompress_file resolves empty (0-byte) files to empty content`, async () => {
  // FileReader returns '' for empty text files, which is falsy but valid
  const result = await decompress_file(new File([], `empty.txt`))
  expect(result).toEqual({ content: ``, filename: `empty.txt` })
})

test.each([`structure.xyz`, `config.json`, `POSCAR`, `notes.md`])(
  `decompress_file decodes %s to a string`,
  async (filename) => {
    const text = `H 0 0 0\nO 1 1 1`
    const result = await decompress_file(new File([text], filename))
    expect(result).toEqual({ content: text, filename })
    expect(typeof result.content).toBe(`string`)
  },
)

// Binary formats dropped uncompressed must stay ArrayBuffer; a lossy UTF-8 decode would
// corrupt bytes >= 0x80 into U+FFFD and feed garbage to parsers (the CRITICAL finding)
test.each([`trajectory.h5`, `run.traj`, `model.npz`, `scan.raw`])(
  `decompress_file keeps binary %s as ArrayBuffer`,
  async (filename) => {
    const bytes = new Uint8Array([0x00, 0x80, 0xff, 0x12, 0x89, 0x48])
    const result = await decompress_file(new File([bytes], filename))
    expect(result.content).toBeInstanceOf(ArrayBuffer)
    expect(new Uint8Array(result.content as ArrayBuffer)).toEqual(bytes)
    expect(result.filename).toBe(filename)
  },
)

// Magic-byte sniffing catches binary payloads that lack a known binary extension
test.each([
  [`HDF5`, [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]],
  [`gzip`, [0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]],
  [`ZIP/PK`, [0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]],
  [`ASE Ulm`, [0x2d, 0x20, 0x6f, 0x66, 0x20, 0x55, 0x6c, 0x6d]],
])(`decompress_file detects %s magic bytes without a binary extension`, async (_, magic) => {
  const bytes = new Uint8Array(magic)
  const result = await decompress_file(new File([bytes], `payload.dump`))
  expect(result.content).toBeInstanceOf(ArrayBuffer)
  expect(new Uint8Array(result.content as ArrayBuffer)).toEqual(bytes)
})

// No binary extension and no real binary magic signature → decode to string.
// "PK-..." guards the tightened matching: a leading "PK" alone is not a real ZIP signature.
test.each([
  { filename: `payload.dump`, text: `plain text payload` },
  { filename: `x.dump`, text: `PK-12 is a plastic, not a zip` },
])(
  `decompress_file decodes non-magic text ($filename) to string`,
  async ({ filename, text }) => {
    const result = await decompress_file(new File([text], filename))
    expect(result.content).toBe(text)
  },
)

const gzip_bytes = async (bytes: Uint8Array): Promise<ArrayBuffer> => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
  return new Response(stream.pipeThrough(new CompressionStream(`gzip`))).arrayBuffer()
}

// Compressed binary payloads without a binary inner extension must still stay ArrayBuffer
// via post-decompression magic-byte detection (else a text decode corrupts them)
test(`decompress_file keeps a gzipped binary payload (by magic) as ArrayBuffer`, async () => {
  if (!globalThis.CompressionStream || !globalThis.DecompressionStream) return
  const hdf5 = new Uint8Array([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02])
  const gz = await gzip_bytes(hdf5)
  // payload.gz -> payload (no binary extension): only magic bytes can save it
  const result = await decompress_file(new File([gz], `payload.gz`))
  expect(result.content).toBeInstanceOf(ArrayBuffer)
  expect(new Uint8Array(result.content as ArrayBuffer)).toEqual(hdf5)
  expect(result.filename).toBe(`payload`)
})

test(`decompress_file decodes a gzipped text payload to string`, async () => {
  if (!globalThis.CompressionStream || !globalThis.DecompressionStream) return
  const text = `element,count\nFe,2\nO,3`
  const gz = await gzip_bytes(new TextEncoder().encode(text))
  const result = await decompress_file(new File([gz], `data.csv.gz`))
  expect(result.content).toBe(text)
  expect(result.filename).toBe(`data.csv`)
})
