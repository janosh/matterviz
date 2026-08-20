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
// Formats the platform DecompressionStream inflates natively
export type StreamCompressionFormat = Exclude<CompressionFormat, `zip` | `xz` | `bz2`>
// Formats this module can inflate in the browser: stream formats plus single-file ZIP
// archives (via fflate). xz and bz2 have no decoder.
export type BrowserCompressionFormat = StreamCompressionFormat | `zip`

export const is_stream_compression_format = (
  format: CompressionFormat | null,
): format is StreamCompressionFormat =>
  format !== null && format !== `zip` && format !== `xz` && format !== `bz2`

export const is_browser_decompressible_format = (
  format: CompressionFormat | null,
): format is BrowserCompressionFormat =>
  format === `zip` || is_stream_compression_format(format)

export function detect_compression_format(filename: string): CompressionFormat | null {
  const lower = filename.toLowerCase()
  for (const [format, extensions] of Object.entries(COMPRESSION_FORMATS)) {
    if (extensions.some((ext) => lower.endsWith(ext))) return format as CompressionFormat
  }
  return null
}

type CompressedSource = ArrayBuffer | Blob | ReadableStream<Uint8Array<ArrayBuffer>>

const unsupported_format_error = (format: CompressionFormat): Error =>
  new Error(
    `${format.toUpperCase()} decompression is not supported in the browser. ` +
      `Please extract the ${format.toUpperCase()} file first.`,
  )

// Decompress data and return as text string
export async function decompress_data(
  data: CompressedSource,
  format: CompressionFormat,
): Promise<string> {
  const buffer = await decompress_data_binary(data, format)
  return new TextDecoder().decode(buffer)
}

// The one payload file of a ZIP archive. Directory entries, macOS resource forks and
// dotfiles are ignored; anything else ambiguous is an error rather than a silent pick.
const unzip_single_entry = async (bytes: Uint8Array): Promise<Uint8Array> => {
  const { unzipSync } = await import(`fflate`)
  const entries = Object.entries(unzipSync(bytes)).filter(
    ([name]) =>
      !name.endsWith(`/`) && !name.startsWith(`__MACOSX/`) && !/(?:^|\/)\./.test(name),
  )
  if (entries.length !== 1) {
    const names = entries.map(([name]) => name).join(`, `)
    throw new Error(
      entries.length === 0
        ? `ZIP archive contains no files`
        : `ZIP archive must contain exactly one file, found ${entries.length}: ${names}`,
    )
  }
  return entries[0][1]
}

const consume_decompressed = async <Result>(
  data: CompressedSource,
  format: CompressionFormat,
  consume: (response: Response) => Promise<Result>,
  signal?: AbortSignal,
): Promise<Result> => {
  try {
    if (!is_browser_decompressible_format(format)) throw unsupported_format_error(format)
    // Blobs and streams are piped through without buffering the compressed bytes first
    const stream =
      data instanceof ArrayBuffer
        ? new Blob([data]).stream()
        : data instanceof Blob
          ? data.stream()
          : data
    if (format === `zip`) {
      const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
      signal?.throwIfAborted()
      // copy: fflate may hand back a view into its own scratch buffer
      const entry = new Uint8Array(await unzip_single_entry(bytes))
      return await consume(new Response(entry))
    }
    const decompressed = stream.pipeThrough(new DecompressionStream(format), { signal })
    return await consume(new Response(decompressed))
  } catch (error) {
    throw new Error(`Failed to decompress ${format} file: ${error}`, { cause: error })
  }
}

// Decompress data and return as ArrayBuffer (for binary files like .brml.gz)
export const decompress_data_binary = (
  data: CompressedSource,
  format: CompressionFormat,
  signal?: AbortSignal,
): Promise<ArrayBuffer> =>
  consume_decompressed(data, format, (response) => response.arrayBuffer(), signal)

export const decompress_data_blob = (
  data: CompressedSource,
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

// Read a dropped file, decompressing supported formats (the compressed bytes are streamed
// straight out of the File, never buffered). Binary payloads (by extension or magic bytes)
// return as ArrayBuffer so parsers get raw bytes; text decodes to string. Archive formats
// the browser cannot inflate (zip/xz/bz2) are rejected up front instead of being handed to
// a parser as opaque bytes.
export async function decompress_file(
  file: File,
): Promise<{ content: string | ArrayBuffer; filename: string }> {
  const format = detect_compression_format(file.name)
  if (format === null) {
    return { content: to_content(file.name, await file.arrayBuffer()), filename: file.name }
  }
  if (!is_browser_decompressible_format(format)) throw unsupported_format_error(format)
  const filename = file.name.replace(COMPRESSION_EXTENSIONS_REGEX, ``)
  const decompressed = await decompress_data_binary(file, format)
  return { content: to_content(filename, decompressed), filename }
}

export const is_hdf5_filename = (filename: string): boolean => /\.(?:h5|hdf5)$/i.test(filename)

export const hdf5_compression_format = (filename: string): CompressionFormat | null => {
  const clean_filename = filename.split(/[?#]/)[0]
  const format = detect_compression_format(clean_filename)
  return format && is_hdf5_filename(strip_compression_extensions(clean_filename))
    ? format
    : null
}

// Like decompress_file, but keeps HDF5 payloads (by name or magic bytes) as a Blob so h5wasm
// can read them lazily instead of materializing the whole file.
export async function decompress_trajectory_file(
  file: File,
  signal?: AbortSignal,
): Promise<{ content: string | ArrayBuffer | Blob; filename: string }> {
  const format = detect_compression_format(file.name)
  const source_filename = format
    ? file.name.replace(COMPRESSION_EXTENSIONS_REGEX, ``)
    : file.name
  const hdf5_by_name = is_hdf5_filename(source_filename)
  const has_hdf5_head = async (blob: Blob) =>
    has_hdf5_magic(new Uint8Array(await blob.slice(0, 8).arrayBuffer()))
  if (format && !is_browser_decompressible_format(format) && hdf5_by_name) {
    throw new Error(
      `Compressed HDF5 ${format.toUpperCase()} files are not supported in the browser; use .h5 or .h5.gz`,
    )
  }
  if (format === null) {
    if (!hdf5_by_name && !(await has_hdf5_head(file))) return decompress_file(file)
    return {
      content: file,
      filename: hdf5_by_name ? source_filename : `${source_filename}.h5`,
    }
  }
  const decompressed = await decompress_data_blob(file, format, signal)
  if (hdf5_by_name || (await has_hdf5_head(decompressed))) {
    return {
      content: decompressed,
      filename: hdf5_by_name ? source_filename : `${source_filename}.h5`,
    }
  }
  const buffer = await decompressed.arrayBuffer()
  return { content: to_content(source_filename, buffer), filename: source_filename }
}
