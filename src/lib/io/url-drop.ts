import { COMPRESSION_EXTENSIONS_REGEX } from '$lib/constants'
import {
  decompress_data_blob,
  detect_compression_format,
  hdf5_compression_format,
  is_browser_decompressible_format,
  is_hdf5_filename,
} from './decompress'
import {
  ext_of,
  has_binary_magic,
  has_gzip_magic,
  has_hdf5_magic,
  is_binary_data_extension,
  is_known_text_file,
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

// Fetch `url` and hand its payload to `callback`, classified the way a dropped File would be:
// known text formats arrive as string, binary formats as ArrayBuffer and, for trajectory
// loads, HDF5 as a Blob so h5wasm can read it lazily. Compressed payloads are inflated by
// their bytes, not their name: a host serving a stored .gz with `Content-Encoding: gzip` has
// already been un-gzipped by fetch, while one that also transport-compresses the same file
// leaves a second layer behind under the identical header. The magic bytes tell them apart.
async function load_url_content(
  url: string,
  callback: TrajectoryFileLoadCallback,
  hdf5_as_blob: boolean,
  signal?: AbortSignal,
): Promise<void> {
  // Strip query string/hash before basename/extension detection so pre-signed
  // URLs like traj.h5?X-Amz-Expires=300 still hit the right format path
  const url_basename = basename_from_url(url)
  const assert_supported_hdf5_wrapper = (name: string): void => {
    const wrapper = hdf5_compression_format(name)
    if (!hdf5_as_blob || !wrapper || is_browser_decompressible_format(wrapper)) return
    throw new Error(
      `Compressed HDF5 ${wrapper.toUpperCase()} URLs are not supported in the browser; use .h5 or .h5.gz`,
    )
  }
  assert_supported_hdf5_wrapper(url_basename)

  const resp = await fetch(url, { signal })
  if (!resp.ok) {
    const status = [resp.status, resp.statusText].filter(Boolean).join(` `)
    throw new Error(`Failed to fetch ${url}: HTTP ${status}`)
  }
  const source_filename = extract_filename(resp.headers, url_basename)
  assert_supported_hdf5_wrapper(source_filename)
  const emit = (content: string | ArrayBuffer | Blob, filename: string) =>
    callback(content, filename, { source_filename, source_url: url } satisfies FileLoadMeta)
  if (is_known_text_file(url_basename)) return emit(await resp.text(), source_filename)

  // Everything else is classified from one Blob so binary payloads never need a second fetch
  let blob = await resp.blob()
  const head = async (count: number) =>
    new Uint8Array(await blob.slice(0, count).arrayBuffer())
  const wrapper =
    detect_compression_format(source_filename) ?? detect_compression_format(url_basename)
  if (has_gzip_magic(await head(2))) {
    blob = await decompress_data_blob(blob, `gzip`, signal)
  } else if (wrapper === `zip`) {
    blob = await decompress_data_blob(blob, `zip`, signal)
  } else if (wrapper && !is_browser_decompressible_format(wrapper)) {
    throw new Error(
      `${wrapper.toUpperCase()} decompression is not supported in the browser; extract ${url} first`,
    )
  }
  // A named wrapper whose bytes were not compressed was inflated in transit; either way the
  // payload is now the inner file, so name it accordingly
  const strip_wrapper = (name: string) =>
    wrapper ? name.replace(COMPRESSION_EXTENSIONS_REGEX, ``) : name
  const filename = strip_wrapper(source_filename)
  const url_name = strip_wrapper(url_basename)

  const payload_head = await head(16)
  const is_hdf5 =
    is_hdf5_filename(filename) || is_hdf5_filename(url_name) || has_hdf5_magic(payload_head)
  if (hdf5_as_blob && is_hdf5) return emit(blob, hdf5_filename(filename, url_name))
  const is_binary =
    is_binary_data_extension(ext_of(filename)) ||
    is_binary_data_extension(ext_of(url_name)) ||
    has_binary_magic(payload_head)
  return emit(is_binary ? await blob.arrayBuffer() : await blob.text(), filename)
}
