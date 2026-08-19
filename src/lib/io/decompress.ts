import type { COMPRESSION_EXTENSIONS } from '$lib/constants'
import { COMPRESSION_EXTENSIONS_REGEX, COMPRESSION_FORMATS } from '$lib/constants'
import { has_hdf5_magic, is_binary_payload } from './is-binary'

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
export type BrowserCompressionFormat = Exclude<CompressionFormat, `zip` | `xz` | `bz2`>

export const is_browser_decompressible_format = (
  format: CompressionFormat | null,
): format is BrowserCompressionFormat =>
  format !== null && format !== `zip` && format !== `xz` && format !== `bz2`

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

const consume_decompressed = async <Result>(
  data: ArrayBuffer | Blob | ReadableStream<Uint8Array> | null,
  format: CompressionFormat,
  consume: (response: Response) => Promise<Result>,
  signal?: AbortSignal,
): Promise<Result> => {
  try {
    if (!is_browser_decompressible_format(format)) {
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
        : data instanceof Blob
          ? data.stream()
          : data
    if (!stream) throw new Error(`Invalid data stream`)
    const decompressed = stream.pipeThrough(new DecompressionStream(format), { signal })
    return await consume(new Response(decompressed))
  } catch (error) {
    throw new Error(`Failed to decompress ${format} file: ${error}`, { cause: error })
  }
}

// Decompress data and return as ArrayBuffer (for binary files like .brml.gz)
export const decompress_data_binary = (
  data: ArrayBuffer | ReadableStream<Uint8Array> | null,
  format: CompressionFormat,
  signal?: AbortSignal,
): Promise<ArrayBuffer> =>
  consume_decompressed(data, format, (response) => response.arrayBuffer(), signal)

export const decompress_data_blob = (
  data: Blob | ReadableStream<Uint8Array>,
  format: CompressionFormat,
  signal?: AbortSignal,
): Promise<Blob> => consume_decompressed(data, format, (response) => response.blob(), signal)

const to_content = (filename: string, buffer: ArrayBuffer): string | ArrayBuffer =>
  is_binary_payload(filename, buffer) ? buffer : new TextDecoder().decode(buffer)

// === consumers of the string | ArrayBuffer content union produced above ===

// Decode loaded content for parsers that only accept text.
export const as_text = (content: string | ArrayBuffer): string =>
  content instanceof ArrayBuffer ? new TextDecoder().decode(content) : content

// Byte size of loaded content, for the file-size readout in info panes. Strings are measured
// as UTF-8 (what they were decoded from), not as UTF-16 code units.
export const content_byte_size = (content: string | ArrayBuffer | Blob): number =>
  content instanceof Blob
    ? content.size
    : content instanceof ArrayBuffer
      ? content.byteLength
      : new Blob([content]).size

// Read a dropped file, decompressing supported formats. Binary payloads (by extension or
// magic bytes) return as ArrayBuffer so parsers get raw bytes; text decodes to string.
export async function decompress_file(
  file: File,
): Promise<{ content: string | ArrayBuffer; filename: string }> {
  const format = detect_compression_format(file.name)
  // zip/xz/bz2 are handled by their own code paths; null = not compressed
  const decompressible = is_browser_decompressible_format(format) ? format : null
  const buffer = await file.arrayBuffer()

  if (decompressible) {
    const filename = file.name.replace(COMPRESSION_EXTENSIONS_REGEX, ``)
    const decompressed = await decompress_data_binary(buffer, decompressible)
    return { content: to_content(filename, decompressed), filename }
  }
  return { content: to_content(file.name, buffer), filename: file.name }
}

export const is_hdf5_filename = (filename: string): boolean => /\.(?:h5|hdf5)$/i.test(filename)

export const hdf5_compression_format = (filename: string): CompressionFormat | null => {
  const clean_filename = filename.split(/[?#]/)[0]
  const format = detect_compression_format(clean_filename)
  return format && is_hdf5_filename(strip_compression_extensions(clean_filename))
    ? format
    : null
}

export async function decompress_trajectory_file(
  file: File,
  signal?: AbortSignal,
): Promise<{ content: string | ArrayBuffer | Blob; filename: string }> {
  const format = detect_compression_format(file.name)
  const source_filename = format
    ? file.name.replace(COMPRESSION_EXTENSIONS_REGEX, ``)
    : file.name
  const hdf5_by_name = is_hdf5_filename(source_filename)
  const hdf5_by_magic =
    format === null && has_hdf5_magic(new Uint8Array(await file.slice(0, 8).arrayBuffer()))
  if (format !== null && format !== `gzip` && hdf5_by_name) {
    throw new Error(
      `Compressed HDF5 ${format.toUpperCase()} files are not supported in the browser; use .h5 or .h5.gz`,
    )
  }
  if (format === null) {
    if (!hdf5_by_name && !hdf5_by_magic) return decompress_file(file)
    return {
      content: file,
      filename: hdf5_by_name ? source_filename : `${source_filename}.h5`,
    }
  }
  if (format !== `gzip`) return decompress_file(file)

  const decompressed = await decompress_data_blob(file, format, signal)
  const hdf5_by_decompressed_magic = has_hdf5_magic(
    new Uint8Array(await decompressed.slice(0, 8).arrayBuffer()),
  )
  if (hdf5_by_name || hdf5_by_decompressed_magic) {
    return {
      content: decompressed,
      filename: hdf5_by_name ? source_filename : `${source_filename}.h5`,
    }
  }
  const buffer = await decompressed.arrayBuffer()
  return { content: to_content(source_filename, buffer), filename: source_filename }
}
