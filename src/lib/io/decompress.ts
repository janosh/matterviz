import type { COMPRESSION_EXTENSIONS } from '$lib/constants'
import { COMPRESSION_EXTENSIONS_REGEX, COMPRESSION_FORMATS } from '$lib/constants'
import { is_binary_payload } from './is-binary'

// Lowercase a filename and strip all trailing compression extensions (.gz, .zip, ...)
export function strip_compression_extensions(filename: string): string {
  let base_name = filename.toLowerCase()
  while (COMPRESSION_EXTENSIONS_REGEX.test(base_name)) {
    base_name = base_name.replace(COMPRESSION_EXTENSIONS_REGEX, ``)
  }
  return base_name
}

export type CompressionFormat = keyof typeof COMPRESSION_FORMATS
export type CompressionExtension = (typeof COMPRESSION_EXTENSIONS)[number]

export function detect_compression_format(filename: string): CompressionFormat | null {
  const lower = filename.toLowerCase()
  for (const [format, extensions] of Object.entries(COMPRESSION_FORMATS)) {
    if (extensions.some((ext) => lower.endsWith(ext))) return format as CompressionFormat
  }
  return null
}

// Decompress data and return as text string
export async function decompress_data(
  data: ArrayBuffer | ReadableStream<Uint8Array> | null,
  format: CompressionFormat,
): Promise<string> {
  const buffer = await decompress_data_binary(data, format)
  return new TextDecoder().decode(buffer)
}

// Decompress data and return as ArrayBuffer (for binary files like .brml.gz)
export async function decompress_data_binary(
  data: ArrayBuffer | ReadableStream<Uint8Array> | null,
  format: CompressionFormat,
): Promise<ArrayBuffer> {
  try {
    if (format === `zip` || format === `xz` || format === `bz2`) {
      throw new Error(
        `${format.toUpperCase()} decompression is not supported in the browser. ` +
          `Please extract the ${format.toUpperCase()} file first.`,
      )
    }

    const stream =
      data instanceof ArrayBuffer
        ? new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(data))
              controller.close()
            },
          })
        : data
    if (!stream) throw new Error(`Invalid data stream`)
    const unzip = new DecompressionStream(format)
    return await new Response(stream.pipeThrough(unzip)).arrayBuffer()
  } catch (error) {
    throw new Error(`Failed to decompress ${format} file: ${error}`, { cause: error })
  }
}

const to_content = (filename: string, buffer: ArrayBuffer): string | ArrayBuffer =>
  is_binary_payload(filename, buffer) ? buffer : new TextDecoder().decode(buffer)

// Read a dropped file, decompressing supported formats. Binary payloads (by extension or
// magic bytes) return as ArrayBuffer so parsers get raw bytes; text decodes to string.
export async function decompress_file(
  file: File,
): Promise<{ content: string | ArrayBuffer; filename: string }> {
  const format = detect_compression_format(file.name)
  const is_supported_compression =
    format !== null && format !== `zip` && format !== `xz` && format !== `bz2`
  const buffer = await file.arrayBuffer()

  if (is_supported_compression && format) {
    const filename = file.name.replace(COMPRESSION_EXTENSIONS_REGEX, ``)
    const decompressed = await decompress_data_binary(buffer, format)
    return { content: to_content(filename, decompressed), filename }
  }
  return { content: to_content(file.name, buffer), filename: file.name }
}
