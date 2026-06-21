import {
  decompress_data,
  decompress_file,
  detect_compression_format,
} from '$lib/io/decompress'
import { describe, expect, test } from 'vitest'

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

describe(`decompress utility functions`, () => {
  describe(`detect_compression_format`, () => {
    test.each([
      [`test.json.gz`, `gzip`],
      [`structure.gzip`, `gzip`],
      [`data.deflate`, `deflate`],
      [`file.z`, `deflate-raw`],
      [`archive.zip`, `zip`],
      [`data.zip`, `zip`],
      [`test.json`, null], // no compression
      [`file.txt`, null],
      [``, null],
      [`file.gz.txt`, null], // extension not at end
      [`file.zip.txt`, null], // zip not at end
    ])(
      `should detect "%s" format for filename "%s"`,
      (filename: string, expected: string | null) => {
        expect(detect_compression_format(filename)).toBe(expected)
      },
    )
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

    test(`should throw error for ZIP format since browser doesn't support it`, async () => {
      await expect(decompress_data(new ArrayBuffer(0), `zip`)).rejects.toThrow(
        `ZIP decompression is not supported in the browser. Please extract the ZIP file first.`,
      )
    })

    test.each([[`gzip`], [`deflate`], [`deflate-raw`]] as const)(
      `should handle %s decompression errors gracefully`,
      async (format) => {
        if (!globalThis.DecompressionStream) return

        const invalid_data = new Uint8Array(10).fill(255).buffer
        await expect(decompress_data(invalid_data, format)).rejects.toThrow(
          `Failed to decompress ${format} file`,
        )
      },
    )

    test.each([[`gzip`], [`deflate`], [`deflate-raw`]] as const)(
      `should successfully decompress valid %s data`,
      async (format) => {
        if (!globalThis.CompressionStream || !globalThis.DecompressionStream) return

        const test_string = `{"test": "data", "format": "${format}"}`
        const compressed = await compress(new TextEncoder().encode(test_string), format)
        expect(await decompress_data(compressed, format)).toBe(test_string)
      },
    )
  })

  // decompress_file returns string | ArrayBuffer: text decodes to a string, binary payloads
  // (by extension or magic bytes) stay ArrayBuffer so a lossy UTF-8 decode can't corrupt them
  describe(`decompress_file`, () => {
    test.each([`structure.xyz`, `config.json`, `POSCAR`, `notes.md`, `greeting.txt`])(
      `decodes text file %s to a string`,
      async (filename) => {
        const text = `H 0 0 0\nO 1 1 1`
        const result = await decompress_file(new File([text], filename))
        expect(result).toEqual({ content: text, filename })
        expect(typeof result.content).toBe(`string`)
      },
    )

    test(`round-trips JSON file content`, async () => {
      const test_json = { message: `Hello, JSON!` }
      const json_string = JSON.stringify(test_json, null, 2)
      const result = await decompress_file(new File([json_string], `test.json`))

      expect(result.filename).toBe(`test.json`)
      if (typeof result.content !== `string`) throw new Error(`expected string content`)
      expect(JSON.parse(result.content)).toEqual(test_json)
    })

    test(`resolves empty (0-byte) files to empty content`, async () => {
      const result = await decompress_file(new File([], `empty.txt`))
      expect(result).toEqual({ content: ``, filename: `empty.txt` })
    })

    // supported compressed text → string, with the compression extension stripped
    test.each([
      [`gzip`, `gz`],
      [`deflate`, `deflate`],
      [`deflate-raw`, `z`],
    ] as const)(`decompresses %s text and strips the extension`, async (format, ext) => {
      if (!globalThis.CompressionStream || !globalThis.DecompressionStream) return
      const text = `{"compressed": true, "format": "${format}"}`
      const compressed = await compress(new TextEncoder().encode(text), format)
      const result = await decompress_file(new File([compressed], `test.json.${ext}`))
      expect(result.content).toBe(text)
      expect(result.filename).toBe(`test.json`) // extension removed
    })

    // unsupported compression (.bz2/.zip) is treated as uncompressed: extension kept
    test.each([`test.json.bz2`, `test.json.zip`])(
      `treats unsupported compression %s as uncompressed`,
      async (filename) => {
        const text = `fake compressed data`
        const result = await decompress_file(new File([text], filename))
        expect(result.content).toBe(text)
        expect(result.filename).toBe(filename) // extension not removed
      },
    )

    test(`rejects when a compressed file fails to decompress`, async () => {
      if (!globalThis.DecompressionStream) return
      const invalid = new Uint8Array(10).fill(255)
      await expect(decompress_file(new File([invalid], `test.json.gz`))).rejects.toThrow(
        `Failed to decompress gzip file`,
      )
    })

    // binary formats (by extension) stay ArrayBuffer; a lossy UTF-8 decode would corrupt
    // bytes >= 0x80 into U+FFFD and feed garbage to parsers
    test.each([`trajectory.h5`, `run.traj`, `model.npz`, `scan.raw`])(
      `keeps binary file %s as ArrayBuffer`,
      async (filename) => {
        const bytes = new Uint8Array([0x00, 0x80, 0xff, 0x12, 0x89, 0x48])
        const result = await decompress_file(new File([bytes], filename))
        expect(result.content).toBeInstanceOf(ArrayBuffer)
        expect(new Uint8Array(result.content as ArrayBuffer)).toEqual(bytes)
        expect(result.filename).toBe(filename)
      },
    )

    // magic-byte sniffing catches binary payloads that lack a known binary extension
    test.each([
      [`HDF5`, [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]],
      [`gzip`, [0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]],
      [`ZIP/PK`, [0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]],
      [`ASE Ulm`, [0x2d, 0x20, 0x6f, 0x66, 0x20, 0x55, 0x6c, 0x6d]],
    ])(`detects %s magic bytes without a binary extension`, async (_label, magic) => {
      const bytes = new Uint8Array(magic)
      const result = await decompress_file(new File([bytes], `payload.dump`))
      expect(result.content).toBeInstanceOf(ArrayBuffer)
      expect(new Uint8Array(result.content as ArrayBuffer)).toEqual(bytes)
    })

    // no binary extension and no real binary magic signature → decode to string.
    // "PK-..." guards the tightened matching: a leading "PK" alone is not a real ZIP signature
    test.each([
      { filename: `payload.dump`, text: `plain text payload` },
      { filename: `x.dump`, text: `PK-12 is a plastic, not a zip` },
    ])(`decodes non-magic text ($filename) to string`, async ({ filename, text }) => {
      const result = await decompress_file(new File([text], filename))
      expect(result.content).toBe(text)
    })

    // a compressed binary payload without a binary inner extension must still stay ArrayBuffer
    // via post-decompression magic-byte detection (else a text decode corrupts it)
    test(`keeps a gzipped binary payload (by magic) as ArrayBuffer`, async () => {
      if (!globalThis.CompressionStream || !globalThis.DecompressionStream) return
      const hdf5 = new Uint8Array([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02])
      const gz = await compress(hdf5)
      // payload.gz -> payload (no binary extension): only magic bytes can save it
      const result = await decompress_file(new File([gz], `payload.gz`))
      expect(result.content).toBeInstanceOf(ArrayBuffer)
      expect(new Uint8Array(result.content as ArrayBuffer)).toEqual(hdf5)
      expect(result.filename).toBe(`payload`)
    })
  })
})
