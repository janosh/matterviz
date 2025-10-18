import {
  decompress_data,
  decompress_file,
  detect_compression_format,
} from '$lib/io/decompress'
import { describe, expect, test } from 'vitest'

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

        const invalid_data = new ArrayBuffer(10)
        const view = new Uint8Array(invalid_data)
        view.fill(255)

        await expect(
          decompress_data(invalid_data, format),
        ).rejects.toThrow(`Failed to decompress ${format} file`)
      },
    )

    test.each([[`gzip`], [`deflate`], [`deflate-raw`]] as const)(
      `should successfully decompress valid %s data`,
      async (format) => {
        if (!globalThis.CompressionStream || !globalThis.DecompressionStream) return

        const test_string = `{"test": "data", "format": "${format}"}`
        const encoder = new TextEncoder()
        const data = encoder.encode(test_string)

        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(data)
            controller.close()
          },
        })

        const compressed_stream = stream.pipeThrough(new CompressionStream(format))
        const response = new Response(compressed_stream)
        const compressed_buffer = await response.arrayBuffer()

        const decompressed = await decompress_data(compressed_buffer, format)
        expect(decompressed).toBe(test_string)
      },
    )
  })

  describe(`decompress_file`, () => {
    test(`should handle regular (uncompressed) text files`, async () => {
      const test_content = `Hello, world!`
      const file = new File([test_content], `test.txt`, { type: `text/plain` })

      const result = await decompress_file(file)

      expect(result.content).toBe(test_content)
      expect(result.filename).toBe(`test.txt`)
    })

    test(`should handle JSON files`, async () => {
      const test_json = { message: `Hello, JSON!` }
      const json_string = JSON.stringify(test_json, null, 2)
      const file = new File([json_string], `test.json`, {
        type: `application/json`,
      })

      const result = await decompress_file(file)

      expect(result.content).toBe(json_string)
      expect(result.filename).toBe(`test.json`)
      expect(JSON.parse(result.content)).toEqual(test_json)
    })

    test.each(
      [
        [`gzip`, `test.json.gz`],
        [`deflate`, `test.json.deflate`],
        [`deflate-raw`, `test.json.z`],
      ] as const,
    )(
      `should process %s compressed files and remove extension`,
      async (format, filename) => {
        if (!globalThis.CompressionStream || !globalThis.DecompressionStream) return

        const test_content = `{"compressed": true, "format": "${format}"}`
        const encoder = new TextEncoder()
        const data = encoder.encode(test_content)

        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(data)
            controller.close()
          },
        })

        const compressed_stream = stream.pipeThrough(new CompressionStream(format))
        const response = new Response(compressed_stream)
        const compressed_buffer = await response.arrayBuffer()

        const compressed_file = new File([compressed_buffer], filename, {
          type: `application/octet-stream`,
        })

        const result = await decompress_file(compressed_file)

        expect(result.content).toBe(test_content)
        expect(result.filename).toBe(`test.json`) // Extension removed
      },
    )

    test(`should handle unsupported compression formats`, async () => {
      // Create a file with unsupported extension
      const test_content = `fake compressed data`
      const file = new File([test_content], `test.json.bz2`, {
        type: `application/octet-stream`,
      })

      // Since .bz2 is not supported, this should be treated as uncompressed
      const result = await decompress_file(file)
      expect(result.content).toBe(test_content)
      expect(result.filename).toBe(`test.json.bz2`) // Extension not removed
    })

    test(`should handle ZIP files as unsupported compression format`, async () => {
      // Create a file with ZIP extension
      const test_content = `fake zip data`
      const file = new File([test_content], `test.json.zip`, {
        type: `application/octet-stream`,
      })

      // Since ZIP decompression is not supported in browser, this should be treated as uncompressed
      const result = await decompress_file(file)
      expect(result.content).toBe(test_content)
      expect(result.filename).toBe(`test.json.zip`) // Extension not removed
    })

    // The main functionality (reading regular and compressed files) is tested above
    // Error handling is better tested in integration tests
  })
})
