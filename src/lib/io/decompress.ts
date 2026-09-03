import {
  COMPRESSION_EXTENSIONS_REGEX,
  COMPRESSION_FORMATS,
  HDF5_EXT_REGEX,
} from '$lib/constants'
import { has_gzip_magic, has_hdf5_magic, is_binary_payload } from './is-binary'

// Strip every trailing compression extension (.gz, .zip, ...), repeatedly so `.chgcar.gz.zip`
// fully unwraps. Lowercases by default for the case-insensitive format probes most callers
// feed it to; pass `lowercase: false` when the result names a file a user sees.
export function strip_compression_extensions(
  filename: string,
  { lowercase = true }: { lowercase?: boolean } = {},
): string {
  let base_name = lowercase ? filename.toLowerCase() : filename
  while (COMPRESSION_EXTENSIONS_REGEX.test(base_name)) {
    base_name = base_name.replace(COMPRESSION_EXTENSIONS_REGEX, ``)
  }
  return base_name
}

type CompressionFormat = keyof typeof COMPRESSION_FORMATS
// Formats the platform DecompressionStream inflates natively
export type StreamCompressionFormat = Exclude<CompressionFormat, `zip` | `xz` | `bz2`>
// Formats this module can inflate in the browser: stream formats plus single-file ZIP
// archives (via fflate). xz and bz2 have no decoder.
type BrowserCompressionFormat = StreamCompressionFormat | `zip`

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

const unsupported_format_error = (
  format: CompressionFormat,
  source = `the ${format.toUpperCase()} file`,
): Error =>
  new Error(
    `${format.toUpperCase()} decompression is not supported in the browser; extract ${source} first`,
  )

// The compression wrapper named by the first of `names` that has one, rejecting wrappers the
// browser cannot inflate (xz, bz2) up front instead of handing a parser opaque archive bytes.
// `source` names the payload in that error, e.g. its URL.
export function compression_wrapper_of(
  names: string[],
  source = names[0],
): BrowserCompressionFormat | null {
  const format = names.map(detect_compression_format).find((fmt) => fmt !== null) ?? null
  if (format && !is_browser_decompressible_format(format)) {
    throw unsupported_format_error(format, source)
  }
  return format
}

// Decompress data and return as text string
export async function decompress_data(
  data: CompressedSource,
  format: CompressionFormat,
): Promise<string> {
  const buffer = await decompress_data_binary(data, format)
  return new TextDecoder().decode(buffer)
}

// Ceiling on the INFLATED payload; the compressed size bounds nothing, since gzip reaches
// 1029:1 on repetitive input (measured), so a 10 MiB upload inflates to 10 GB. 2 GiB is past
// anything downstream can consume (V8 strings ~512 MB, h5wasm heap ~2 GB, position
// accumulator 512 MB), so it only fires on a payload no parser could have read.
export const MAX_INFLATED_BYTES = 2 * 1024 * 1024 * 1024

const bomb_msg = (format: CompressionFormat, inflated: number, max_bytes: number) =>
  `${format.toUpperCase()} payload inflates to at least ${inflated} bytes, past the ` +
  `${max_bytes}-byte limit; extract it and open the parts you need`

// Aborts the inflate when the running output passes `max_bytes`, not after buffering it all
export const inflation_limiter = (
  format: CompressionFormat,
  max_bytes = MAX_INFLATED_BYTES,
): TransformStream<Uint8Array, Uint8Array> => {
  let inflated = 0
  return new TransformStream({
    transform(chunk, controller) {
      inflated += chunk.byteLength
      if (inflated > max_bytes) throw new Error(bomb_msg(format, inflated, max_bytes))
      controller.enqueue(chunk)
    },
  })
}

// The one payload file of a ZIP archive. Directory entries, macOS resource forks and
// dotfiles are ignored; anything else ambiguous is an error rather than a silent pick.
const unzip_single_entry = async (
  bytes: Uint8Array,
): Promise<{ name: string; bytes: Uint8Array }> => {
  const { unzipSync } = await import(`fflate`)
  // fflate has no streaming budget, but it sizes each entry's output buffer from the central
  // directory before inflating and never overruns it, so gating there bounds the allocation
  // even when the header lies. `size` covers method-0 entries, copied out verbatim.
  const entries = Object.entries(
    unzipSync(bytes, {
      filter: ({ originalSize, size }) => {
        const inflated = Math.max(originalSize, size)
        if (inflated > MAX_INFLATED_BYTES) {
          throw new Error(bomb_msg(`zip`, inflated, MAX_INFLATED_BYTES))
        }
        return true
      },
    }),
  ).filter(
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
  const [name, entry_bytes] = entries[0]
  return { name: name.split(`/`).pop() ?? name, bytes: entry_bytes }
}

const consume_decompressed = async <Result>(
  data: CompressedSource,
  format: CompressionFormat,
  consume: (response: Response) => Promise<Result>,
  signal?: AbortSignal,
  on_entry_name?: (name: string) => void,
): Promise<Result> => {
  if (!is_browser_decompressible_format(format)) throw unsupported_format_error(format)
  try {
    // Blobs and streams are piped through without buffering the compressed bytes first
    const stream =
      data instanceof ArrayBuffer
        ? new Blob([data]).stream()
        : data instanceof Blob
          ? data.stream()
          : data
    if (format === `zip`) {
      // fflate needs the whole archive, so this buffers; pipe it through an identity
      // transform first so an abort stops the buffering instead of being noticed after it
      const zip_stream = stream.pipeThrough(new TransformStream(), { signal })
      const bytes = new Uint8Array(await new Response(zip_stream).arrayBuffer())
      signal?.throwIfAborted()
      const entry = await unzip_single_entry(bytes)
      on_entry_name?.(entry.name)
      // copy: fflate may hand back a view into its own scratch buffer
      return await consume(new Response(new Uint8Array(entry.bytes)))
    }
    const decompressed = stream
      .pipeThrough(new DecompressionStream(format), { signal })
      .pipeThrough(inflation_limiter(format))
    return await consume(new Response(decompressed))
  } catch (error) {
    // An abort is the caller's cancellation, not a corrupt archive; wrapping it hid both the
    // AbortError name and the reason the caller passed
    signal?.throwIfAborted()
    if (error instanceof DOMException && error.name === `AbortError`) throw error
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

const is_hdf5_filename = (filename: string): boolean => HDF5_EXT_REGEX.test(filename)

export const hdf5_compression_format = (filename: string): CompressionFormat | null => {
  const clean_filename = filename.split(/[?#]/)[0]
  const format = detect_compression_format(clean_filename)
  return format && is_hdf5_filename(strip_compression_extensions(clean_filename))
    ? format
    : null
}

interface ClassifyPayloadOptions {
  // Keep HDF5 payloads (by name or magic bytes) as a Blob so h5wasm can read them lazily
  // instead of materializing the whole file (trajectory viewers)
  hdf5_as_blob?: boolean
  // Decide gzip by the bytes rather than the name: a host serving a stored .gz with
  // `Content-Encoding: gzip` has already been un-gzipped by fetch, while one that also
  // transport-compresses the same file leaves a second layer behind under the identical
  // header. A dropped File is always exactly what its name says, so there the name rules.
  gzip_by_magic?: boolean
  // Names the payload in error messages (defaults to the first of `names`)
  source?: string
  signal?: AbortSignal
}

type LoadedPayload<Content> = { content: Content; filename: string }

// Every loader funnels here: inflate a browser-decompressible wrapper (the compressed bytes
// stream straight out of the Blob, never buffered), then classify the payload the way parsers
// expect: HDF5 as a Blob when asked, known binary formats as ArrayBuffer so a lossy UTF-8
// decode cannot corrupt them, everything else as text. `names` are candidate filenames
// (dropped/header name first, URL basename after); the first, stripped of its wrapper
// extension, names the result.
export async function classify_payload(
  blob: Blob,
  names: string[],
  options: ClassifyPayloadOptions = {},
): Promise<LoadedPayload<string | ArrayBuffer | Blob>> {
  const { hdf5_as_blob = false, gzip_by_magic = false, source, signal } = options
  const head = (count: number) => blob.slice(0, count).arrayBuffer()
  const gzip_magic = gzip_by_magic && has_gzip_magic(new Uint8Array(await head(2)))
  const format = gzip_magic ? `gzip` : compression_wrapper_of(names, source)
  // Either way the payload is now the inner file, so name it accordingly
  const stripped = names.map((name) =>
    strip_compression_extensions(name, { lowercase: false }),
  )
  // In by-magic mode a named gzip/deflate wrapper without gzip bytes was inflated in transit,
  // so only ZIP is still decompressed by name there
  if (format && (!gzip_by_magic || gzip_magic || format === `zip`)) {
    // A ZIP entry names itself, the only way `bundle.zip` holding `a.cif` reads as a CIF
    blob = await consume_decompressed(
      blob,
      format,
      (resp) => resp.blob(),
      signal,
      (name) => stripped.unshift(name),
    )
  }
  const magic = await head(8)
  if (
    hdf5_as_blob &&
    (stripped.some(is_hdf5_filename) || has_hdf5_magic(new Uint8Array(magic)))
  ) {
    const filename = stripped.find(is_hdf5_filename) ?? `${stripped.find(Boolean) ?? ``}.h5`
    return { content: blob, filename }
  }
  // Only the payload's OWN name decides (the ZIP entry, unshifted to the front above, or the
  // dropped name): matching any candidate let a URL or archive basename force a text entry's
  // bytes to ArrayBuffer
  const is_binary = is_binary_payload(stripped[0] ?? ``, magic)
  return {
    content: is_binary ? await blob.arrayBuffer() : await blob.text(),
    filename: stripped[0],
  }
}

// Read a dropped File; text decodes to string, binary payloads stay ArrayBuffer
export const decompress_file = (file: File): Promise<LoadedPayload<string | ArrayBuffer>> =>
  classify_payload(file, [file.name]) as Promise<LoadedPayload<string | ArrayBuffer>>

// Like decompress_file, but HDF5 payloads stay Blob-backed for h5wasm
export const decompress_trajectory_file = (
  file: File,
  signal?: AbortSignal,
): Promise<LoadedPayload<string | ArrayBuffer | Blob>> =>
  classify_payload(file, [file.name], { hdf5_as_blob: true, signal })
