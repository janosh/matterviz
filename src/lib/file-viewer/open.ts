import { classify_payload, content_byte_size, is_empty_content } from '#lib/io/decompress.js'
import type { FileLoadCallback, FileLoadMeta } from '#lib/io/index.js'
import type { ParseProgress, TrajectorySource } from '#lib/trajectory/index.js'
import { Hdf5GroupSelectionRequiredError } from '#lib/trajectory/parse/h5-utils.js'
import { basename_from_url, fetch_payload } from '#lib/io/url-drop.js'
import { parse_in_worker, ParseWorkerError } from './parse-in-worker'
import { HostFileError } from './host-protocol'
import type { ParseResult, TrajectoryLoadOptions } from './parse'
import { to_error } from 'svelte-widgets/utils'

export interface MaterialPayload extends Partial<FileLoadMeta> {
  data: TrajectorySource
  filename: string
  is_base64?: boolean
  // Size of `data` in bytes as loaded (inflated), so a string need not be re-encoded to be
  // measured; caller-built payloads may omit it
  byte_size?: number
}

export type MaterialSource = string | URL | File | MaterialPayload

export interface MaterialProvenance extends FileLoadMeta {
  filename: string
  file_size: number
}

// Intersected rather than extended: ParseResult is a union, and `X & Y` keeps discriminating
// on `type` so callers narrow an OpenedMaterial exactly like a ParseResult
export type OpenedMaterial = ParseResult & {
  provenance: Readonly<MaterialProvenance>
  dispose: () => void
}

export interface OpenMaterialOptions extends TrajectoryLoadOptions {
  signal?: AbortSignal
  on_progress?: (progress: ParseProgress) => void
  // Hands back the acquired (fetched/decompressed/classified) payload before it is parsed, so
  // a caller that must re-parse the same source (e.g. after an HDF5 group pick) can pass the
  // payload back in instead of downloading and inflating it a second time
  on_acquired?: (payload: MaterialPayload) => void
}

export class MaterialOpenError extends Error {
  constructor(
    message: string,
    readonly stage: `acquire` | `parse`,
    readonly provenance: Partial<MaterialProvenance>,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'MaterialOpenError'
  }
}

const is_file = (source: MaterialSource): source is File =>
  typeof File !== `undefined` && source instanceof File

// Everything a source says about itself before it has been fetched or parsed, so a failure at
// any stage still reports which payload it was
export const source_provenance = (source: MaterialSource): Partial<MaterialProvenance> => {
  if (typeof source === `string` || source instanceof URL) {
    const source_url = String(source)
    return { source_url, source_filename: basename_from_url(source_url) }
  }
  if (is_file(source))
    return { source_filename: source.name, file: source, file_size: source.size }
  return {
    filename: source.filename,
    source_filename: source.source_filename ?? source.filename,
    source_url: source.source_url,
    file: source.file,
    file_size: source.byte_size ?? content_byte_size(source.data),
  }
}

// `keep_blob` (see classify_payload) hands HDF5 and text over as Blobs for the parse worker
export const acquire_material = async (
  source: MaterialSource,
  signal?: AbortSignal,
  keep_blob = true,
): Promise<MaterialPayload> => {
  if (typeof source === `string` || source instanceof URL) {
    const { content: data, ...payload } = await fetch_payload(
      String(source),
      keep_blob,
      signal,
    )
    return { data, ...payload }
  }
  if (is_file(source)) {
    const { content: data, ...payload } = await classify_payload(source, [source.name], {
      keep_blob,
      signal,
    })
    return { data, ...payload, source_filename: source.name, file: source }
  }
  const { data, filename, is_base64, ...metadata } = source
  if (typeof data === `string` || is_base64) return source
  const blob = data instanceof Blob ? data : new Blob([data])
  const { content, ...classified } = await classify_payload(blob, [filename], {
    keep_blob,
    signal,
  })
  return { ...metadata, data: content, ...classified }
}

// Hand a source's fetched/decompressed bytes or text plus its identity to a reader of its own
// (a host's raw-file intercept `on_file_drop`, a plot's drop handler) instead of parsing it
export const deliver_raw_file = async (
  source: MaterialSource,
  on_file: FileLoadCallback,
  signal?: AbortSignal,
): Promise<void> => {
  // raw readers take text or bytes, not the Blobs the parse worker reads
  const { data, filename, source_filename, source_url, file } = await acquire_material(
    source,
    signal,
    false,
  )
  if (is_empty_content(data)) throw new Error(`file is empty`)
  const content = data instanceof Blob ? await data.arrayBuffer() : data
  if (signal?.aborted) return
  await on_file(content, filename, {
    source_filename: source_filename ?? filename,
    source_url,
    file,
  })
}

export async function open_material(
  source: MaterialSource,
  options: OpenMaterialOptions = {},
): Promise<OpenedMaterial> {
  const { signal, on_progress, on_acquired, ...load_options } = options
  signal?.throwIfAborted()
  let payload: MaterialPayload
  try {
    payload = await acquire_material(source, signal)
  } catch (error) {
    throw new MaterialOpenError(
      to_error(error).message,
      `acquire`,
      source_provenance(source),
      { cause: error },
    )
  }
  on_acquired?.(payload)
  const {
    data,
    filename,
    is_base64 = false,
    source_filename = filename,
    byte_size = content_byte_size(data),
    ...metadata
  } = payload
  const parse_provenance = { filename, source_filename, file_size: byte_size, ...metadata }
  let result: ParseResult
  try {
    result = await parse_in_worker(data, filename, is_base64, {
      signal,
      on_progress,
      load_options,
      // acquire_material always hands back a buffer it allocated, and only Blob payloads are
      // ever re-parsed (the HDF5 group picker), so an ArrayBuffer here is ours to give away
      owns_content: true,
    })
  } catch (error) {
    if (error instanceof Hdf5GroupSelectionRequiredError) throw error
    // Only a parser rejecting the content is a `parse` failure; a host or parse worker that
    // failed says nothing about the file
    const stage =
      error instanceof HostFileError
        ? error.stage
        : error instanceof ParseWorkerError
          ? `acquire`
          : `parse`
    throw new MaterialOpenError(to_error(error).message, stage, parse_provenance, {
      cause: error,
    })
  }
  const provenance = Object.freeze({ ...parse_provenance, filename: result.filename })
  let disposed = false
  return {
    ...result,
    provenance,
    dispose: () => {
      if (disposed) return
      disposed = true
      if (result.type === `trajectory`) result.data.dispose()
    },
  }
}
