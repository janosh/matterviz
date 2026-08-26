import { classify_payload, content_byte_size, decompress_trajectory_file } from '$lib/io'
import type { FileLoadMeta } from '$lib/io'
import {
  Hdf5GroupSelectionRequiredError,
  type ParseProgress,
  type TrajectorySource,
} from '$lib/trajectory'
import { basename_from_url, load_trajectory_from_url } from '$lib/io/url-drop'
import { parse_in_worker } from './parse-in-worker'
import type { ParseResult, TrajectoryLoadOptions } from './parse'
import { to_error } from '$lib/utils'

export interface MaterialPayload extends Partial<FileLoadMeta> {
  data: TrajectorySource
  filename: string
  is_base64?: boolean
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
  if (is_file(source)) {
    return { source_filename: source.name, file: source, file_size: source.size }
  }
  return {
    filename: source.filename,
    source_filename: source.source_filename ?? source.filename,
    source_url: source.source_url,
    file: source.file,
    file_size: content_byte_size(source.data),
  }
}

const load_url = async (url: string, signal?: AbortSignal): Promise<MaterialPayload> => {
  let payload: MaterialPayload | undefined
  await load_trajectory_from_url(
    url,
    (data, filename, metadata) => {
      payload = { data, filename, ...metadata }
    },
    signal,
  )
  if (!payload) throw new Error(`No content returned for ${url}`)
  return payload
}

export const acquire_material = async (
  source: MaterialSource,
  signal?: AbortSignal,
): Promise<MaterialPayload> => {
  if (typeof source === `string` || source instanceof URL) {
    return load_url(String(source), signal)
  }
  if (is_file(source)) {
    const { content: data, filename } = await decompress_trajectory_file(source, signal)
    return { data, filename, source_filename: source.name, file: source }
  }
  const { data, filename, is_base64, ...metadata } = source
  if (typeof data === `string` || is_base64) return source
  const blob = data instanceof Blob ? data : new Blob([data])
  const classified = await classify_payload(blob, [filename], {
    hdf5_as_blob: true,
    signal,
  })
  return { data: classified.content, filename: classified.filename, ...metadata }
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
    ...metadata
  } = payload
  const parse_provenance = {
    filename,
    source_filename,
    file_size: content_byte_size(data),
    ...metadata,
  }
  let result: ParseResult
  try {
    result = await parse_in_worker(data, filename, is_base64, {
      signal,
      on_progress,
      load_options,
      // acquire_material always hands back a buffer it allocated, and only Blob-backed HDF5
      // is ever re-parsed (the group picker), so an ArrayBuffer here is ours to give away
      owns_content: true,
    })
  } catch (error) {
    if (error instanceof Hdf5GroupSelectionRequiredError) throw error
    throw new MaterialOpenError(to_error(error).message, `parse`, parse_provenance, {
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
