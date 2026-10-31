import {
  COMPRESSION_EXTENSIONS_REGEX,
  COMPRESSION_FORMATS,
  HDF5_EXT_REGEX,
} from '#lib/constants.js'
import { has_gzip_magic, has_hdf5_magic, is_binary_payload } from './is-binary'

// A file's own name (directories dropped: an `elfcar_runs/` or `build/` folder says nothing
// about the files in it) without its trailing compression extensions, stripped repeatedly so
// `.chgcar.gz.zip` fully unwraps. Lowercases by default; pass `lowercase: false` when the
// result names a file a user sees.
export function strip_compression_extensions(
  filename: string,
  { lowercase = true }: { lowercase?: boolean } = {},
): string {
  const own_name = filename.split(/[\\/]/).pop() ?? ``
  let base_name = lowercase ? own_name.toLowerCase() : own_name
  while (COMPRESSION_EXTENSIONS_REGEX.test(base_name)) {
    base_name = base_name.replace(COMPRESSION_EXTENSIONS_REGEX, ``)
  }
  return base_name
}

type CompressionFormat = keyof typeof COMPRESSION_FORMATS
// Formats the platform DecompressionStream inflates natively
export type StreamCompressionFormat = Exclude<CompressionFormat, `zip` | `xz` | `bz2` | `lzw`>
// Formats this module can inflate in the browser: stream formats plus single-file ZIP
// archives (via fflate). xz, bz2 and lzw have no decoder.
type BrowserCompressionFormat = StreamCompressionFormat | `zip`

export const is_stream_compression_format = (
  format: CompressionFormat | null,
): format is StreamCompressionFormat =>
  format !== null && ![`zip`, `xz`, `bz2`, `lzw`].includes(format)

export const is_browser_decompressible_format = (
  format: CompressionFormat | null,
): format is BrowserCompressionFormat =>
  format === `zip` || is_stream_compression_format(format)

export function detect_compression_format(filename: string): CompressionFormat | null {
  const lower = filename.toLowerCase()
  for (const [format, extensions] of Object.entries(COMPRESSION_FORMATS))
    if (extensions.some((ext) => lower.endsWith(ext))) return format as CompressionFormat
  return null
}

// The compression wrapper named by the first of `names` that has one, rejecting wrappers the
// browser cannot inflate (xz, bz2) up front instead of handing a parser opaque archive bytes.
// `source` names the payload in that error, e.g. its URL.
export function compression_wrapper_of(
  names: string[],
  source = names[0],
): BrowserCompressionFormat | null {
  const format = names.map(detect_compression_format).find((fmt) => fmt !== null) ?? null
  if (format && !is_browser_decompressible_format(format)) {
    throw new Error(
      `${format.toUpperCase()} decompression is not supported in the browser; extract ${source} first`,
    )
  }
  return format
}

// Ceiling on the INFLATED payload: the compressed size bounds nothing (gzip reaches 1029:1 on
// repetitive input) and 2 GiB is past anything downstream can consume (h5wasm heap ~2 GB)
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
  // Inspect the directory before allocating or inflating any entry. Ignored metadata may
  // dwarf the payload, and ambiguous archives must fail before decompressing their contents.
  const entries: { name: string; inflated: number }[] = []
  unzipSync(bytes, {
    filter: ({ name, originalSize, size }) => {
      if (!name.endsWith(`/`) && !name.startsWith(`__MACOSX/`) && !/(?:^|\/)\./.test(name))
        entries.push({ name, inflated: Math.max(originalSize, size) })
      return false
    },
  })
  if (entries.length !== 1) {
    const names = entries.map(({ name }) => name).join(`, `)
    throw new Error(
      entries.length === 0
        ? `ZIP archive contains no files`
        : `ZIP archive must contain exactly one file, found ${entries.length}: ${names}`,
    )
  }
  const { name, inflated } = entries[0]
  // fflate allocates from the declared size and bounds its writes to that buffer.
  if (inflated > MAX_INFLATED_BYTES)
    throw new Error(bomb_msg(`zip`, inflated, MAX_INFLATED_BYTES))
  const entry_bytes = unzipSync(bytes, { filter: (entry) => entry.name === name })[name]
  return { name: name.split(`/`).pop() ?? name, bytes: entry_bytes }
}

// Inflate one browser-decompressible layer of `blob` (its bytes streamed, never buffered,
// except a ZIP archive's), reporting a ZIP's entry name
const decompress_blob = async (
  blob: Blob,
  format: BrowserCompressionFormat,
  signal?: AbortSignal,
  on_entry_name?: (name: string) => void,
): Promise<Blob> => {
  try {
    const stream = blob.stream()
    if (format === `zip`) {
      // fflate needs the whole archive: the identity transform lets an abort stop the buffering
      const zip_stream = stream.pipeThrough(new TransformStream(), { signal })
      const bytes = new Uint8Array(await new Response(zip_stream).arrayBuffer())
      signal?.throwIfAborted()
      const entry = await unzip_single_entry(bytes)
      on_entry_name?.(entry.name)
      // The archive is ArrayBuffer-backed; Blob snapshots the entry bytes.
      return new Blob([entry.bytes as Uint8Array<ArrayBuffer>])
    }
    const decompressed = stream
      .pipeThrough(new DecompressionStream(format), { signal })
      .pipeThrough(inflation_limiter(format))
    return await new Response(decompressed).blob()
  } catch (error) {
    // An abort is the caller's cancellation, not a corrupt archive
    signal?.throwIfAborted()
    if (error instanceof DOMException && error.name === `AbortError`) throw error
    throw new Error(`Failed to decompress ${format} file: ${error}`, { cause: error })
  }
}

// Encoding a text payload declares with its byte-order mark, else UTF-8. Windows PowerShell
// 5.1 redirection (`python make_traj.py > md.xyz`) writes UTF-16LE with a BOM.
export const text_encoding_of = (head: Uint8Array): `utf-8` | `utf-16le` | `utf-16be` =>
  head[0] === 0xff && head[1] === 0xfe
    ? `utf-16le`
    : head[0] === 0xfe && head[1] === 0xff
      ? `utf-16be`
      : `utf-8`

// Decode loaded content for parsers that only accept text.
export const as_text = (content: string | ArrayBuffer): string =>
  content instanceof ArrayBuffer
    ? new TextDecoder(text_encoding_of(new Uint8Array(content))).decode(content)
    : content

// V8's string length limit in UTF-16 units (Chrome, Node, VS Code); Firefox and Safari allow
// longer strings, so this is the size past which no text payload decodes into one string
export const MAX_STRING_CHARS = 0x1fffffe8

// End of the last whole `\n` in `bytes`, 0 when there is none. A 0x0A byte never sits inside a
// multi-byte UTF-8 sequence; a UTF-16 `\n` is a 2-byte unit at an even offset (chunks start
// on one), since 0x0A also occurs as half of other units (U+010A).
const newline_end = (bytes: Uint8Array, encoding: string): number => {
  if (encoding === `utf-8`) return bytes.lastIndexOf(10) + 1
  const [first, second] = encoding === `utf-16le` ? [10, 0] : [0, 10]
  for (let idx = bytes.length - 2 - (bytes.length % 2); idx >= 0; idx -= 2)
    if (bytes[idx] === first && bytes[idx + 1] === second) return idx + 2
  return 0
}

// Text of `source` (UTF-8, or UTF-16 by its BOM) as one string when it fits one, else as
// line-aligned chunks of `chunk_bytes` (a Blob is read one window at a time, so its bytes and
// text only coexist for one window). A line longer than a chunk widens it; every chunk but the
// last ends just after a `\n`, so no line spans two (see TextLines), and the chunks join to
// exactly what one decode returns (a leading BOM dropped, like blob.text()).
export const decode_text_chunks = async (
  source: ArrayBuffer | Blob,
  chunk_bytes?: number,
): Promise<string[]> => {
  const size = source instanceof Blob ? source.size : source.byteLength
  const window_bytes = chunk_bytes ?? (size > MAX_STRING_CHARS ? 64 * 1024 * 1024 : size)
  const read = async (from: number, to: number): Promise<Uint8Array> =>
    source instanceof Blob
      ? new Uint8Array(await source.slice(from, to).arrayBuffer())
      : new Uint8Array(source, from, to - from)
  const chunks: string[] = []
  const encoding = text_encoding_of(await read(0, Math.min(2, size)))
  // streamed, so only the first chunk drops a BOM (a later one is mid-text in one decode)
  const decoder = new TextDecoder(encoding)
  for (let from = 0, window = window_bytes; from < size;) {
    const to = Math.min(from + window, size)
    const bytes = await read(from, to)
    const cut = to === size ? bytes.length : newline_end(bytes, encoding)
    if (cut === 0) {
      window *= 2
      continue
    }
    chunks.push(decoder.decode(bytes.subarray(0, cut), { stream: to < size }))
    from += cut
    window = window_bytes
  }
  return chunks.length > 0 ? chunks : [``]
}

// A text payload as one string, or the Blob itself when it is past the string limit and the
// caller reads large text in chunks (the trajectory loaders, see decode_text_chunks)
export const text_or_blob = async (
  blob: Blob,
  keep_large: boolean,
): Promise<string | Blob> => {
  if (blob.size <= MAX_STRING_CHARS) {
    const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer())
    return text_encoding_of(head) === `utf-8`
      ? blob.text()
      : (await decode_text_chunks(blob))[0]
  }
  if (keep_large) return blob
  throw new Error(
    `Text payload of ${blob.size} bytes exceeds the ${MAX_STRING_CHARS}-character JS string limit; only XYZ/EXTXYZ, LAMMPS dump and XDATCAR trajectories open past it`,
  )
}

// Byte size of loaded content, for the file-size readout in info panes. Strings are measured
// as UTF-8 (what they were decoded from), not as UTF-16 code units.
export const content_byte_size = (content: string | ArrayBuffer | Blob): number =>
  content instanceof Blob
    ? content.size
    : content instanceof ArrayBuffer
      ? content.byteLength
      : new Blob([content]).size

// Whether loaded content holds no bytes, without encoding a string the way content_byte_size
// does (a 300 MB text payload would allocate ~900 MB just to be measured)
export const is_empty_content = (content: string | ArrayBuffer | Blob): boolean =>
  (typeof content === `string`
    ? content.length
    : content instanceof Blob
      ? content.size
      : content.byteLength) === 0

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
  // instead of materializing the whole file, and likewise text past one JS string, which the
  // indexed text readers decode in chunks (trajectory viewers)
  hdf5_as_blob?: boolean
  // Fetch can remove named gzip/deflate wrappers, even when CORS hides Content-Encoding, so
  // HTTP payloads skip a named layer their bytes no longer carry; dropped files must hold the
  // wrappers they declare. Either way gzip bytes inflate whatever the name says.
  wrappers_may_be_decoded?: boolean
  // Names the payload in error messages (defaults to the first of `names`)
  source?: string
  signal?: AbortSignal
}

// `byte_size` is the payload's own (inflated) size, so text is not re-encoded to measure it
export type LoadedPayload<Content> = { content: Content; filename: string; byte_size: number }

// Real payloads nest 2-3 wrappers deep; the cap stops self-reproducing archives (ZIP or gzip
// quines) from unwrapping forever
export const MAX_WRAPPER_LAYERS = 8

// Every loader funnels here: inflate each browser-decompressible wrapper (the compressed bytes
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
  const { hdf5_as_blob = false, wrappers_may_be_decoded = false, source, signal } = options
  const head = (count: number) => blob.slice(0, count).arrayBuffer()
  let payload_names = [...names]
  let wrappers_optional = wrappers_may_be_decoded
  for (let layer = 0; ; layer++) {
    signal?.throwIfAborted()
    // a gzip payload behind a wrong or missing extension (`POSCAR`, `run.xyz`) still inflates
    const gzip_magic = has_gzip_magic(new Uint8Array(await head(2)))
    const format = gzip_magic ? `gzip` : compression_wrapper_of(payload_names, source)
    if (!format) break
    // Strip only the layer being consumed. Sniffed gzip can wrap a named ZIP, and ZIP
    // entries can themselves be compressed; stripping every suffix lost those layers.
    payload_names = payload_names.map((name) =>
      detect_compression_format(name) === format
        ? name.replace(COMPRESSION_EXTENSIONS_REGEX, ``)
        : name,
    )
    // Fetch may already have removed a named layer via Content-Encoding.
    if (wrappers_optional && format === `gzip` && !gzip_magic) continue
    if (wrappers_optional && format === `deflate`) {
      const bytes = new Uint8Array(await head(2))
      // RFC 1950: DEFLATE method, window <= 32 KiB, and the zlib header checksum.
      const has_zlib_header =
        bytes.length === 2 &&
        (bytes[0] & 0x0f) === 8 &&
        bytes[0] >>> 4 <= 7 &&
        ((bytes[0] << 8) | bytes[1]) % 31 === 0
      if (!has_zlib_header) continue
    }
    if (layer >= MAX_WRAPPER_LAYERS) {
      throw new Error(
        `${source ?? names[0]} nests more than ${MAX_WRAPPER_LAYERS} compression layers`,
      )
    }
    blob = await decompress_blob(blob, format, signal, (name) => {
      // An archive's entry is authoritative; URL/header aliases describe its container.
      payload_names = [name]
      wrappers_optional = false
    })
  }
  signal?.throwIfAborted()
  const magic = await head(8)
  if (
    hdf5_as_blob &&
    (payload_names.some(is_hdf5_filename) || has_hdf5_magic(new Uint8Array(magic)))
  ) {
    const filename =
      payload_names.find(is_hdf5_filename) ?? `${payload_names.find(Boolean) ?? ``}.h5`
    return { content: blob, filename, byte_size: blob.size }
  }
  // Only the payload's OWN name decides (ZIP entry above, else the
  // dropped name): matching any candidate let a URL basename force a text entry to ArrayBuffer
  const is_binary = is_binary_payload(payload_names[0] ?? ``, magic)
  return {
    content: is_binary ? await blob.arrayBuffer() : await text_or_blob(blob, hdf5_as_blob),
    filename: payload_names[0],
    byte_size: blob.size,
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
