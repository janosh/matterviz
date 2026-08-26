// Shared file-drop handler composable for drag-and-drop file loading.
import { decompress_file, decompress_trajectory_file } from './decompress'
import { dropped_file_url, load_from_url, load_trajectory_from_url } from './url-drop'
import { plural } from '$lib/labels'
import { to_error } from '$lib/utils'
import type { Attachment } from 'svelte/attachments'
import { files_from_data_transfer } from 'svelte-widgets/file-drop'
import type { FileLoadCallback, TrajectoryFileLoadCallback } from './types'

export type FileDropOptions = {
  allow: () => boolean
  max_files?: number
  on_error?: (msg: string) => void
  set_loading?: (loading: boolean) => void
} & (
  | { hdf5_as_blob?: false; on_drop: FileLoadCallback }
  // Trajectory viewers keep HDF5 payloads as a Blob so h5wasm can read them lazily
  | { hdf5_as_blob: true; on_drop: TrajectoryFileLoadCallback }
)

// Drag-over visual-state handlers for file-drop zones; spread onto the drop target
// alongside `ondrop` from create_file_drop_handler
export const drag_over_handlers = (opts: {
  allow?: () => boolean
  set_dragover: (over: boolean) => void
}) => ({
  // preventDefault on dragover marks the element as a valid drop target; dragleave
  // has no default action to cancel, so it only clears the visual state
  ondragover: (event: DragEvent) => {
    event.preventDefault()
    opts.set_dragover(opts.allow?.() ?? true)
  },
  ondragleave: () => opts.set_dragover(false),
})

// One dropped item: a FilePicker URL or a file from the DataTransfer.
export type DropSource = string | File

export interface DropBatchOptions {
  allow: () => boolean
  max_files?: number
  on_error?: (msg: string) => void
  set_loading?: (loading: boolean) => void
  // Consume one dropped source. Throwing folds that item's failure into the batch report
  // and leaves the rest of the batch running.
  handle: (source: DropSource) => Promise<void> | void
}

const source_label = (source: DropSource): string =>
  typeof source === `string` ? `URL ${source}` : source.name

// Batch mechanics shared by both drop zones: read the DataTransfer during dispatch, enforce
// max_files, run the sources in drop order, and fold per-item failures into one report.
// Multiple dropped files are processed sequentially so e.g. several cube files can be
// imported at once. Overlapping drops are queued: a batch starting while a previous one is
// still processing would interleave handler state mutations (e.g. torn volume lists).
export const create_drop_batch_handler = (
  opts: DropBatchOptions,
): ((event: DragEvent) => Promise<void>) => {
  const { max_files } = opts
  if (max_files !== undefined && (!Number.isSafeInteger(max_files) || max_files < 0)) {
    throw new TypeError(`max_files must be a non-negative integer, got ${max_files}`)
  }

  async function process_batch(url: string | undefined, read: Promise<File[]>) {
    opts.set_loading?.(true)
    try {
      // rejects on a symlink cycle or an oversized tree, which the catch below reports
      const files = await read
      const sources: DropSource[] = [...(url ? [url] : []), ...files]
      if (max_files !== undefined && sources.length > max_files) {
        opts.on_error?.(
          `Drop at most ${plural(max_files, `file`)} at a time (received ${sources.length})`,
        )
        return
      }
      // One failing item must not abort the rest of the batch
      const failures: { label: string; message: string }[] = []
      for (const source of sources) {
        try {
          await opts.handle(source)
        } catch (exc) {
          failures.push({ label: source_label(source), message: to_error(exc).message })
        }
      }
      if (failures.length === 0) return
      // A lone URL is named by the report itself, so it does not repeat its own label
      if (url && sources.length === 1) {
        opts.on_error?.(`Failed to load from URL: ${failures[0].message}`)
        return
      }
      const report = failures.map(({ label, message }) => `${label}: ${message}`).join(`; `)
      opts.on_error?.(`Failed to load ${plural(failures.length, `file`)} — ${report}`)
    } catch (exc) {
      opts.on_error?.(`Failed to load file: ${to_error(exc).message}`)
    } finally {
      opts.set_loading?.(false)
    }
  }

  let queue: Promise<void> = Promise.resolve()
  return (event: DragEvent): Promise<void> => {
    event.preventDefault()
    if (!opts.allow()) return Promise.resolve()
    // DataTransfer is only readable during dispatch, and files_from_data_transfer reads
    // webkitGetAsEntry before its first await, so start it here to expand dropped folders
    // in time — DataTransfer.files alone reports a folder as one zero-byte file.
    const url = dropped_file_url(event)
    const read = event.dataTransfer
      ? files_from_data_transfer(event.dataTransfer)
      : Promise.resolve<File[]>([])
    read.catch(() => undefined) // stays unhandled until the queue gets to it otherwise
    queue = queue.then(() => process_batch(url, read)).catch(() => undefined)
    return queue
  }
}

// Reads each dropped source before handing it on: URL drops fetch, files decompress, and
// `on_drop` receives content plus its source identity.
export const create_file_drop_handler = (
  opts: FileDropOptions,
): ((event: DragEvent) => Promise<void>) => {
  const on_drop = opts.on_drop as TrajectoryFileLoadCallback
  const load_url = opts.hdf5_as_blob ? load_trajectory_from_url : load_from_url
  const read_file = opts.hdf5_as_blob ? decompress_trajectory_file : decompress_file
  return create_drop_batch_handler({
    ...opts,
    handle: async (source) => {
      if (typeof source === `string`) return load_url(source, on_drop)
      const { content, filename } = await read_file(source)
      if (!content) throw new Error(`file is empty`)
      await on_drop(content, filename, { source_filename: source.name, file: source })
    },
  })
}

// Mirrors the hover state to the caller, e.g. for a bindable `dragover` prop
type DragoverOption = { on_dragover?: (over: boolean) => void }

// Wires `node` as a drop zone: it toggles the node's `dragover` class while an allowed drag
// hovers it (so the viewer's `.dragover` rule lights up), clears it on drop (browsers fire no
// dragleave then), and routes the drop through `handler`.
const drop_zone =
  (
    opts: { allow: () => boolean } & DragoverOption,
    handler: (event: DragEvent) => Promise<void>,
  ): Attachment<HTMLElement> =>
  (node) => {
    const set_dragover = (over: boolean) => {
      node.classList.toggle(`dragover`, over)
      opts.on_dragover?.(over)
    }
    const { ondragover, ondragleave } = drag_over_handlers({ allow: opts.allow, set_dragover })
    const ondrop = (event: DragEvent) => {
      set_dragover(false)
      void handler(event)
    }
    node.addEventListener(`dragover`, ondragover)
    node.addEventListener(`dragleave`, ondragleave)
    node.addEventListener(`drop`, ondrop)
    return () => {
      node.removeEventListener(`dragover`, ondragover)
      node.removeEventListener(`dragleave`, ondragleave)
      node.removeEventListener(`drop`, ondrop)
      set_dragover(false)
    }
  }

// Drop zone that reads each file before handing it on, for viewers with their own parsers:
//   <div {@attach file_drop_zone({ allow: () => allow_file_drop, on_drop, on_error })}>
export const file_drop_zone = (
  options: FileDropOptions & DragoverOption,
): Attachment<HTMLElement> => drop_zone(options, create_file_drop_handler(options))

// Drop zone that forwards untouched URLs and Files, for the open_material() components:
// acquisition and decompression stay in the material runtime.
export const raw_file_drop_zone = (
  options: Omit<DropBatchOptions, `handle`> &
    DragoverOption & { on_drop: (source: DropSource) => Promise<void> | void },
): Attachment<HTMLElement> =>
  drop_zone(options, create_drop_batch_handler({ ...options, handle: options.on_drop }))
