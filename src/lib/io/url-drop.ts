import { load_binary_traj } from '$lib/trajectory/parse'
import {
  decompress_data_binary,
  decompress_data_blob,
  hdf5_compression_format,
  is_hdf5_filename,
  type CompressionFormat,
} from './decompress'
import {
  BINARY_EXTENSIONS,
  ext_of,
  has_binary_inner_ext,
  has_binary_magic,
  has_gzip_magic,
  has_hdf5_magic,
  is_known_text_file,
  magic_head,
  strip_gz_ext,
} from './is-binary'
import type {
  FileInfo,
  FileLoadCallback,
  FileLoadMeta,
  TrajectoryFileLoadCallback,
} from './types'

// Strip query/hash; last path segment (same basename load_from_url uses).
// Trailing-slash URLs yield an empty segment — fall back to the original URL.
export const basename_from_url = (url: string): string => {
  const basename = url.split(/[?#]/)[0].split(`/`).pop()
  return basename?.length ? basename : url
}

const hdf5_filename = (filename: string, url_basename: string): string =>
  [filename, url_basename].find(is_hdf5_filename) ?? `${filename || url_basename}.h5`

const sniff_binary_kind = (bytes: Uint8Array): `gzip` | `hdf5` | `binary` | null =>
  has_gzip_magic(bytes)
    ? `gzip`
    : has_hdf5_magic(bytes)
      ? `hdf5`
      : has_binary_magic(bytes)
        ? `binary`
        : null

// Extract filename from Content-Disposition header, falling back to url_basename.
function extract_filename(headers: Headers, fallback: string): string {
  const content_disposition_str = headers.get(`content-disposition`)
  if (!content_disposition_str) return fallback
  const star_match = /filename\*=(?<value>[^;]+)/i.exec(content_disposition_str)
  if (star_match?.[1]) {
    let raw = star_match[1].trim().replaceAll(/^"|"$/g, ``)
    // Strip any RFC 5987 charset'language' prefix; bare values pass through unchanged
    const ext_value_match = /^[\w!#$%&+^`{}~-]+'[\w-]*'(?<value>.*)$/.exec(raw)
    if (ext_value_match) raw = ext_value_match[1]
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  }
  const plain_match = /filename\s*=\s*"?(?<value>[^";]+)"?/i.exec(content_disposition_str)
  // truthiness check (not ??) so whitespace-only `filename=` values fall back too
  const name = plain_match?.[1]?.trim()
  if (!name) return fallback
  return name
}

// Gunzip a fetched payload → [content, filename] with .gz/.gzip stripped; content
// stays an ArrayBuffer for binary inner formats, decoded string otherwise
async function decompress_gz_payload(
  buffer: ArrayBuffer,
  filename: string,
  signal?: AbortSignal,
): Promise<[content: string | ArrayBuffer, filename: string]> {
  const decompressed = signal
    ? await decompress_data_binary(buffer, `gzip`, signal)
    : await decompress_data_binary(buffer, `gzip`)
  const content = has_binary_inner_ext(filename)
    ? decompressed
    : new TextDecoder().decode(decompressed)
  return [content, strip_gz_ext(filename)]
}

// Extract the URL of a FilePicker-style drop payload. Synchronous because
// DataTransfer.getData is only readable during drop-event dispatch — callers
// that defer processing (e.g. drop queues) must capture the URL up front.
export function dropped_file_url(drag_event: DragEvent): string | undefined {
  const json_data = drag_event.dataTransfer?.getData(`application/json`)
  if (!json_data) return undefined
  try {
    // Runtime-check instead of trusting the FileInfo cast: drop payloads are
    // external input and a truthy non-string url must not reach fetch()
    const { url } = JSON.parse(json_data) as Partial<FileInfo>
    return typeof url === `string` && url ? url : undefined
  } catch {
    return undefined
  }
}

// Handle URL-based file drop data by fetching content lazily
export async function handle_url_drop(
  drag_event: DragEvent,
  callback: FileLoadCallback,
  signal?: AbortSignal,
): Promise<boolean> {
  const url = dropped_file_url(drag_event)
  if (!url) return false
  await load_from_url(url, callback, signal)
  return true
}

export async function handle_trajectory_url_drop(
  event: DragEvent,
  callback: TrajectoryFileLoadCallback,
  signal?: AbortSignal,
): Promise<boolean> {
  const url = dropped_file_url(event)
  if (!url) return false
  await load_trajectory_from_url(url, callback, signal)
  return true
}

export const load_from_url = (
  url: string,
  callback: FileLoadCallback,
  signal?: AbortSignal,
): Promise<void> =>
  load_url_content(url, callback as TrajectoryFileLoadCallback, false, signal)

export const load_trajectory_from_url = (
  url: string,
  callback: TrajectoryFileLoadCallback,
  signal?: AbortSignal,
): Promise<void> => load_url_content(url, callback, true, signal)

async function load_url_content(
  url: string,
  callback: TrajectoryFileLoadCallback,
  hdf5_as_blob: boolean,
  signal?: AbortSignal,
): Promise<void> {
  const fetch_url = (request_url: string, init?: RequestInit): Promise<Response> =>
    signal
      ? fetch(request_url, { ...init, signal })
      : init
        ? fetch(request_url, init)
        : fetch(request_url)
  const decompress_blob = (blob: Blob): Promise<Blob> =>
    signal ? decompress_data_blob(blob, `gzip`, signal) : decompress_data_blob(blob, `gzip`)
  // Strip query string/hash before basename/extension detection so pre-signed
  // URLs like traj.h5?X-Amz-Expires=300 still hit the right format path
  const url_basename = basename_from_url(url)
  const ext = ext_of(url_basename)
  const hdf5_wrapper = hdf5_compression_format(url_basename)
  const assert_supported_hdf5_wrapper = (wrapper: CompressionFormat | null): void => {
    if (!hdf5_as_blob || !wrapper || wrapper === `gzip`) return
    throw new Error(
      `Compressed HDF5 ${wrapper.toUpperCase()} URLs are not supported in the browser; use .h5 or .h5.gz`,
    )
  }
  assert_supported_hdf5_wrapper(hdf5_wrapper)
  const emit_loaded = (
    content: string | ArrayBuffer | Blob,
    filename: string,
    source_filename = filename,
  ) =>
    callback(content, filename, {
      source_filename,
      source_url: url,
    } satisfies FileLoadMeta)
  const emit_hdf5 = (
    content: string | ArrayBuffer | Blob,
    source_filename: string,
    wrapper: CompressionFormat | null,
  ) =>
    emit_loaded(
      content,
      hdf5_filename(
        wrapper === `gzip` ? strip_gz_ext(source_filename) : source_filename,
        wrapper === `gzip` ? strip_gz_ext(url_basename) : url_basename,
      ),
      source_filename,
    )
  const response_file_info = (response: Response) => {
    const source_filename = extract_filename(response.headers, url_basename)
    const wrapper = hdf5_compression_format(source_filename) ?? hdf5_wrapper
    assert_supported_hdf5_wrapper(wrapper)
    return { source_filename, wrapper }
  }
  const emit_decompressed_blob = async (
    content: Blob,
    source_filename: string,
    wrapper_identifies_hdf5: boolean,
  ): Promise<void> => {
    if (
      wrapper_identifies_hdf5 ||
      has_hdf5_magic(new Uint8Array(await content.slice(0, 8).arrayBuffer()))
    ) {
      return emit_hdf5(content, source_filename, `gzip`)
    }
    const buffer = await content.arrayBuffer()
    return emit_loaded(
      has_binary_inner_ext(source_filename) ? buffer : new TextDecoder().decode(buffer),
      strip_gz_ext(source_filename),
      source_filename,
    )
  }

  if (BINARY_EXTENSIONS.has(ext)) {
    // Force binary mode for known binary files to handle GitHub Pages content-type issues
    const resp = await fetch_url(url)
    if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`)
    const { source_filename, wrapper: response_hdf5_wrapper } = response_file_info(resp)
    if (hdf5_as_blob && ext !== `gz` && ext !== `gzip` && response_hdf5_wrapper === `gzip`) {
      const blob = await resp.blob()
      const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer())
      const content = has_gzip_magic(head) ? await decompress_blob(blob) : blob
      return emit_decompressed_blob(content, source_filename, true)
    }
    if (hdf5_as_blob && ext !== `gz` && ext !== `gzip` && is_hdf5_filename(source_filename)) {
      return emit_hdf5(await resp.blob(), source_filename, response_hdf5_wrapper)
    }

    // Decide by the bytes, not the Content-Encoding header. A host serving a stored .gz with
    // `Content-Encoding: gzip` has already been un-gzipped by fetch (GitHub Pages-style), but
    // one that also applies transport gzip to that same file leaves a second layer behind and
    // sends the identical header. The magic bytes tell the two apart; the header cannot.
    if (ext === `gz` || ext === `gzip`) {
      if (hdf5_as_blob) {
        const blob = await resp.blob()
        const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer())
        const content = has_gzip_magic(head) ? await decompress_blob(blob) : blob
        return emit_decompressed_blob(
          content,
          source_filename,
          response_hdf5_wrapper === `gzip`,
        )
      }
      const buffer = await resp.arrayBuffer()
      if (has_gzip_magic(magic_head(buffer, 2))) {
        const [content, filename] = await decompress_gz_payload(
          buffer,
          source_filename,
          signal,
        )
        return emit_loaded(content, filename, source_filename)
      }
      // Already inflated: keep binary inner formats (.h5.gz, ...) as bytes
      return emit_loaded(
        has_binary_inner_ext(source_filename) ? buffer : new TextDecoder().decode(buffer),
        strip_gz_ext(source_filename),
        source_filename,
      )
    }

    // For H5 files, always load as binary regardless of signature
    // to handle files that have .h5/.hdf5 extensions but may not have the proper HDF5 signature
    if (ext === `h5` || ext === `hdf5`) {
      if (hdf5_as_blob) {
        return emit_hdf5(await resp.blob(), source_filename, response_hdf5_wrapper)
      }
      const result = await load_binary_traj(resp, `H5`, true)

      // Log warning if signature doesn't match (only for ArrayBuffer results)
      if (
        result instanceof ArrayBuffer &&
        result.byteLength >= 8 &&
        !has_hdf5_magic(magic_head(result))
      ) {
        console.warn(`File has .h5/.hdf5 extension but missing HDF5 signature`)
      }

      return emit_loaded(result, source_filename)
    }

    // For .traj files, ensure we always get ArrayBuffer for proper ASE parsing
    if (ext === `traj`) {
      const buffer = await load_binary_traj(resp, `.traj`)
      return emit_loaded(buffer, source_filename)
    }

    // Content-Encoding is transparent transport compression: fetch already
    // decompressed the body, so binary formats (npz, pkl, brml, ...) must still
    // be read as ArrayBuffer — .text() would corrupt them via lossy UTF-8 decode
    return emit_loaded(await resp.arrayBuffer(), source_filename)
  }

  // Skip Range requests for known text formats to avoid production server issues
  // Include VASP files that don't have extensions (POSCAR, XDATCAR, CONTCAR)
  if (!is_known_text_file(url_basename)) {
    // Only the Range sniff is guarded (failure → plain text fetch). Once magic bytes
    // commit to a binary format, download/decompress errors must propagate instead of
    // falling through to a text fetch that would parse the binary bytes as garbage.
    let sniffed: `gzip` | `hdf5` | `binary` | null = null
    let full_response: Response | null = null
    let full_blob: Blob | null = null
    try {
      // Check for magic bytes only for unknown formats (covers extensionless URLs
      // like blob: object URLs whose basenames are UUIDs)
      const head = await fetch_url(url, { headers: { Range: `bytes=0-15` } })
      const valid_partial =
        head.status === 206 && head.headers.get(`content-range`)?.startsWith(`bytes 0-`)
      if (valid_partial) {
        sniffed = sniff_binary_kind(new Uint8Array(await head.arrayBuffer()))
      } else if (head.status === 200) {
        full_response = head
        full_blob = await head.blob()
        sniffed = sniff_binary_kind(new Uint8Array(await full_blob.slice(0, 16).arrayBuffer()))
      }
    } catch {
      // Fall through to text fetch if the Range HEAD request fails
    }

    if (sniffed) {
      const resp = full_response ?? (await fetch_url(url))
      if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`)
      const { source_filename, wrapper: response_hdf5_wrapper } = response_file_info(resp)
      if (
        hdf5_as_blob &&
        (sniffed === `hdf5` ||
          is_hdf5_filename(source_filename) ||
          (response_hdf5_wrapper === `gzip` && sniffed !== `gzip`))
      ) {
        return emit_hdf5(
          full_blob ?? (await resp.blob()),
          source_filename,
          response_hdf5_wrapper,
        )
      }
      if (hdf5_as_blob && sniffed === `gzip`) {
        const compressed_blob = full_blob ?? (await resp.blob())
        const decompressed_blob = await decompress_blob(compressed_blob)
        return emit_decompressed_blob(decompressed_blob, source_filename, false)
      }
      const buffer = full_blob ? await full_blob.arrayBuffer() : await resp.arrayBuffer()
      // Gunzip sniffed gzip — downstream parsers can't handle raw gzip bytes
      if (sniffed === `gzip`) {
        const [content, filename] = await decompress_gz_payload(
          buffer,
          source_filename,
          signal,
        )
        return emit_loaded(content, filename, source_filename)
      }
      return emit_loaded(buffer, source_filename)
    }
    if (full_response && full_blob) {
      const { source_filename, wrapper: response_hdf5_wrapper } =
        response_file_info(full_response)
      if (
        hdf5_as_blob &&
        (response_hdf5_wrapper === `gzip` || is_hdf5_filename(source_filename))
      ) {
        return emit_hdf5(full_blob, source_filename, response_hdf5_wrapper)
      }
      return emit_loaded(await full_blob.text(), source_filename)
    }
  }

  const resp = await fetch_url(url)
  if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`)
  const source_filename = extract_filename(resp.headers, url_basename)
  if (hdf5_as_blob && !is_known_text_file(url_basename)) {
    const { wrapper: response_hdf5_wrapper } = response_file_info(resp)
    const blob = await resp.blob()
    const blob_head = new Uint8Array(await blob.slice(0, 16).arrayBuffer())
    if (has_gzip_magic(blob_head)) {
      const decompressed = await decompress_blob(blob)
      return emit_decompressed_blob(
        decompressed,
        source_filename,
        response_hdf5_wrapper === `gzip`,
      )
    }
    if (
      response_hdf5_wrapper === `gzip` ||
      is_hdf5_filename(source_filename) ||
      has_hdf5_magic(blob_head)
    ) {
      return emit_hdf5(blob, source_filename, response_hdf5_wrapper)
    }
    return emit_loaded(await blob.text(), source_filename)
  }
  return emit_loaded(await resp.text(), source_filename)
}
