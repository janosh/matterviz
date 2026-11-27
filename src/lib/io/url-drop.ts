import type { LoadedPayload } from './decompress'
import { classify_payload, compression_wrapper_of } from './decompress'
import { whole_percent_reporter } from '#lib/utils'
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

export const load_from_url = (url: string, callback: FileLoadCallback): Promise<void> =>
  load_url_content(url, callback as TrajectoryFileLoadCallback, false)

export const load_trajectory_from_url = (
  url: string,
  callback: TrajectoryFileLoadCallback,
  signal?: AbortSignal,
): Promise<void> => load_url_content(url, callback, true, signal)

// Hand a fetched payload to `callback` with its source identity
async function load_url_content(
  url: string,
  callback: TrajectoryFileLoadCallback,
  keep_blob: boolean,
  signal?: AbortSignal,
): Promise<void> {
  const { content, filename, source_filename } = await fetch_payload(url, keep_blob, signal)
  return callback(content, filename, { source_filename, source_url: url })
}

// Pass a response's body through a byte counter reporting whole download percents. Body
// chunks only stream through (no copies held here), so .blob() keeps the browser's own large-
// blob storage. Without a Content-Length there is nothing to divide by, and a content-encoded
// body streams decoded bytes against its encoded length, so neither reports.
const with_download_progress = (resp: Response, on_percent: (percent: number) => void) => {
  const total = Number(resp.headers.get(`content-length`))
  const encoding = resp.headers.get(`content-encoding`) ?? `identity`
  if (!total || !resp.body || encoding !== `identity`) return resp
  const report = whole_percent_reporter(on_percent)
  let loaded = 0
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      report((loaded += chunk.byteLength) / total)
      controller.enqueue(chunk)
    },
  })
  return new Response(resp.body.pipeThrough(counter), { headers: resp.headers })
}

// Fetch `url` and classify its payload the way a dropped File would be (see
// classify_payload); compressed payloads are inflated by their bytes, not their name.
export async function fetch_payload(
  url: string,
  keep_blob: boolean,
  signal?: AbortSignal,
  on_download_percent?: (percent: number) => void,
): Promise<LoadedPayload<string | ArrayBuffer | Blob> & FileLoadMeta> {
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
  // Classified from one Blob so binary payloads never need a second fetch, and like a dropped
  // file a gzip body behind a text name (POSCAR, run.xyz) inflates by its magic bytes
  const body = on_download_percent ? with_download_progress(resp, on_download_percent) : resp
  const payload = await classify_payload(await body.blob(), [source_filename, url_basename], {
    keep_blob,
    wrappers_may_be_decoded: true,
    source: url,
    signal,
  })
  return { ...payload, source_filename, source_url: url }
}
