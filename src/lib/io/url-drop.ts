import { classify_payload, compression_wrapper_of } from './decompress'
import { is_known_text_file } from './is-binary'
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

// Handle URL-based file drop data by fetching content lazily; false when the drop carried no URL
const url_drop_handler =
  <Callback>(load: (url: string, callback: Callback, signal?: AbortSignal) => Promise<void>) =>
  async (event: DragEvent, callback: Callback, signal?: AbortSignal): Promise<boolean> => {
    const url = dropped_file_url(event)
    if (!url) return false
    await load(url, callback, signal)
    return true
  }
export const handle_url_drop = url_drop_handler(load_from_url)
export const handle_trajectory_url_drop = url_drop_handler(load_trajectory_from_url)

// Fetch `url` and hand its payload to `callback`, classified the way a dropped File would be
// (see classify_payload); compressed payloads are inflated by their bytes, not their name.
async function load_url_content(
  url: string,
  callback: TrajectoryFileLoadCallback,
  hdf5_as_blob: boolean,
  signal?: AbortSignal,
): Promise<void> {
  // Strip query string/hash before basename/extension detection so pre-signed
  // URLs like traj.h5?X-Amz-Expires=300 still hit the right format path
  const url_basename = basename_from_url(url)
  // Reject wrappers the browser cannot inflate before spending a network round trip
  compression_wrapper_of([url_basename], url)

  const resp = await fetch(url, { signal })
  if (!resp.ok) {
    const status = [resp.status, resp.statusText].filter(Boolean).join(` `)
    throw new Error(`Failed to fetch ${url}: HTTP ${status}`)
  }
  const source_filename = extract_filename(resp.headers, url_basename)
  const emit = (content: string | ArrayBuffer | Blob, filename: string) =>
    callback(content, filename, { source_filename, source_url: url } satisfies FileLoadMeta)
  if (is_known_text_file(url_basename)) return emit(await resp.text(), source_filename)
  // Everything else is classified from one Blob so binary payloads never need a second fetch
  const { content, filename } = await classify_payload(
    await resp.blob(),
    [source_filename, url_basename],
    { hdf5_as_blob, gzip_by_magic: true, source: url, signal },
  )
  return emit(content, filename)
}
