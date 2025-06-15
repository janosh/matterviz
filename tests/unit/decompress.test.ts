import {
  type CompressionFormat,
  decompress_data,
  decompress_file,
  decompress_gzip,
  detect_compression_format,
  is_compressed_file,
  remove_compression_extension,
} from '$lib/io/decompress'
import { beforeEach, describe, expect, test, vi } from 'vitest'

describe(`decompress utility functions`, () => {
  describe(`is_compressed_file`, () => {
    test.each([
      [`test.json.gz`, true],
      [`test.json.gzip`, true],
      [`structure.poscar.gz`, true],
      [`data.xyz.gzip`, true],
      [`file.deflate`, true], // deflate format
      [`data.z`, true], // deflate-raw format
      [`test.json`, false],
      [`structure.poscar`, false],
      [`data.xyz`, false],
      [`file.txt`, false],
      [``, false],
      [`file.gz.txt`, false], // gz not at the end
      [`file.deflate.txt`, false], // deflate not at the end
    ])(
      `should return %s for filename "%s"`,
      (filename: string, expected: boolean) => {
        expect(is_compressed_file(filename)).toBe(expected)
      },
    )
  })

  describe(`remove_compression_extension`, () => {
    test.each([
      [`test.json.gz`, `test.json`],
      [`structure.poscar.gzip`, `structure.poscar`],
      [`data.xyz.gz`, `data.xyz`],
      [`file.cif.gzip`, `file.cif`],
      [`data.deflate`, `data`], // deflate format
      [`structure.z`, `structure`], // deflate-raw format
      [`test.json`, `test.json`], // no compression extension
      [`file.txt`, `file.txt`],
      [`multiple.gz.json.gz`, `multiple.gz.json`], // only removes last .gz
      [`file.gzip.txt`, `file.gzip.txt`], // gzip not at end
      [`file.deflate.txt`, `file.deflate.txt`], // deflate not at end
      [``, ``],
    ])(`should transform "%s" to "%s"`, (input: string, expected: string) => {
      expect(remove_compression_extension(input)).toBe(expected)
    })
  })

  describe(`detect_compression_format`, () => {
    test.each([
      [`test.json.gz`, `gzip`],
      [`structure.gzip`, `gzip`],
      [`data.deflate`, `deflate`],
      [`file.z`, `deflate-raw`],
      [`test.json`, null], // no compression
      [`file.txt`, null],
      [``, null],
      [`file.gz.txt`, null], // extension not at end
    ])(
      `should detect "%s" format for filename "%s"`,
      (filename: string, expected: string | null) => {
        expect(detect_compression_format(filename)).toBe(expected)
      },
    )
  })

  describe(`decompress_data`, () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    test(`should throw error when DecompressionStream is not supported`, async () => {
      const original_decompression_stream = globalThis.DecompressionStream
      // @ts-expect-error - intentionally deleting for test
      delete globalThis.DecompressionStream

      await expect(decompress_data(new ArrayBuffer(0), `gzip`)).rejects.toThrow(
        `DecompressionStream API not supported`,
      )

      globalThis.DecompressionStream = original_decompression_stream
    })

    test.each([[`gzip`], [`deflate`], [`deflate-raw`]])(
      `should handle %s decompression errors gracefully`,
      async (format: string) => {
        if (!globalThis.DecompressionStream) {
          return
        }

        const invalid_data = new ArrayBuffer(10)
        const view = new Uint8Array(invalid_data)
        view.fill(255)

        await expect(
          decompress_data(invalid_data, format as CompressionFormat),
        ).rejects.toThrow(`Failed to decompress ${format} file`)
      },
    )

    test.each([[`gzip`], [`deflate`], [`deflate-raw`]])(
      `should successfully decompress valid %s data`,
      async (format: string) => {
        if (!globalThis.CompressionStream || !globalThis.DecompressionStream) {
          return
        }

        const test_string = `{"test": "data", "format": "${format}"}`
        const encoder = new TextEncoder()
        const data = encoder.encode(test_string)

        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(data)
            controller.close()
          },
        })

        const compressed_stream = stream.pipeThrough(
          new CompressionStream(format as CompressionFormat),
        )
        const response = new Response(compressed_stream)
        const compressed_buffer = await response.arrayBuffer()

        const decompressed = await decompress_data(
          compressed_buffer,
          format as CompressionFormat,
        )
        expect(decompressed).toBe(test_string)
      },
    )
  })

  describe(`decompress_gzip`, () => {
    beforeEach(() => {
      // Reset any mocks before each test
      vi.clearAllMocks()
    })

    test(`should throw error when DecompressionStream is not supported`, async () => {
      // Mock missing DecompressionStream API
      const original_decompression_stream = globalThis.DecompressionStream
      // @ts-expect-error - intentionally deleting for test
      delete globalThis.DecompressionStream

      await expect(decompress_gzip(new ArrayBuffer(0))).rejects.toThrow(
        `DecompressionStream API not supported`,
      )

      // Restore original
      globalThis.DecompressionStream = original_decompression_stream
    })

    test(`should handle decompression errors gracefully`, async () => {
      // Skip if DecompressionStream is not available in test environment
      if (!globalThis.DecompressionStream) {
        return
      }

      // Create invalid gzip data (should cause decompression to fail)
      const invalid_gzip_data = new ArrayBuffer(10)
      const view = new Uint8Array(invalid_gzip_data)
      view.fill(255) // Fill with invalid data

      await expect(decompress_gzip(invalid_gzip_data)).rejects.toThrow(
        `Failed to decompress gzip file`,
      )
    })

    test(`should successfully decompress valid gzip data`, async () => {
      // Skip if APIs are not available in test environment
      if (!globalThis.CompressionStream || !globalThis.DecompressionStream) {
        return
      }

      const test_string = `{"test": "data", "compressed": true}`
      const encoder = new TextEncoder()
      const data = encoder.encode(test_string)

      // Compress the data first
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(data)
          controller.close()
        },
      })

      const compressed_stream = stream.pipeThrough(
        new CompressionStream(`gzip`),
      )
      const response = new Response(compressed_stream)
      const compressed_buffer = await response.arrayBuffer()

      // Now test decompression
      const decompressed = await decompress_gzip(compressed_buffer)
      expect(decompressed).toBe(test_string)
    })
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

    test.each([
      [`gzip`, `test.json.gz`],
      [`deflate`, `test.json.deflate`],
      [`deflate-raw`, `test.json.z`],
    ])(
      `should process %s compressed files and remove extension`,
      async (format: string, filename: string) => {
        if (!globalThis.CompressionStream || !globalThis.DecompressionStream) {
          return
        }

        const test_content = `{"compressed": true, "format": "${format}"}`
        const encoder = new TextEncoder()
        const data = encoder.encode(test_content)

        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(data)
            controller.close()
          },
        })

        const compressed_stream = stream.pipeThrough(
          new CompressionStream(format as CompressionFormat),
        )
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

    // Note: FileReader error handling tests are complex to mock in vitest
    // The main functionality (reading regular and compressed files) is tested above
    // Error handling would be better tested in integration tests
  })
})
