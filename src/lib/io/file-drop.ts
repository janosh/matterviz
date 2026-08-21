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

// Handles URL drops (from FilePicker), direct file drops with decompression,
// loading state, and error reporting. Multiple dropped files are processed
// sequentially in drop order so e.g. several cube files can be imported at once.
// Overlapping drops are queued: a batch starting while a previous one is still
// processing would interleave on_drop state mutations (e.g. torn volume lists).
export const create_file_drop_handler = (
  opts: FileDropOptions,
): ((event: DragEvent) => Promise<void>) => {
  const { max_files } = opts
  if (max_files !== undefined && (!Number.isSafeInteger(max_files) || max_files < 0)) {
    throw new TypeError(`max_files must be a non-negative integer, got ${max_files}`)
  }
  const on_drop = opts.on_drop as TrajectoryFileLoadCallback
  const load_url = opts.hdf5_as_blob ? load_trajectory_from_url : load_from_url
  const read_file = opts.hdf5_as_blob ? decompress_trajectory_file : decompress_file

  async function process_batch(url: string | undefined, read: Promise<File[]>) {
    opts.set_loading?.(true)
    try {
      // One failing item must not abort the rest of the batch
      const failures: string[] = []
      // rejects on a symlink cycle or an oversized tree, which the catch below reports
      const files = await read
      const source_count = files.length + (url ? 1 : 0)
      if (max_files !== undefined && source_count > max_files) {
        opts.on_error?.(
          `Drop at most ${plural(max_files, `file`)} at a time (received ${source_count})`,
        )
        return
      }
      if (url) {
        try {
          await load_url(url, on_drop)
        } catch (exc) {
          // URL failed; if plain files were also dropped, still process them
          // and fold the URL failure into the aggregate report
          if (files.length === 0) {
            opts.on_error?.(`Failed to load from URL: ${to_error(exc).message}`)
            return
          }
          failures.push(`URL ${url}: ${to_error(exc).message}`)
        }
      }
      if (files.length === 0) return

      for (const file of files) {
        try {
          const { content, filename } = await read_file(file)
          if (content) {
            await on_drop(content, filename, { source_filename: file.name, file })
          } else failures.push(`${file.name}: file is empty`)
        } catch (exc) {
          failures.push(`${file.name}: ${to_error(exc).message}`)
        }
      }
      if (failures.length > 0) {
        opts.on_error?.(
          `Failed to load ${failures.length} file${failures.length > 1 ? `s` : ``} — ${failures.join(
            `; `,
          )}`,
        )
      }
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

type FileDropZoneOptions = FileDropOptions & {
  // Mirrors the hover state to the caller, e.g. for a bindable `dragover` prop
  on_dragover?: (over: boolean) => void
}

// Attachment that makes `node` a drop zone in one line:
//   <div {@attach file_drop_zone({ allow: () => allow_file_drop, on_drop, on_error, set_loading })}>
// It toggles the node's `dragover` class while an allowed drag hovers it (so the viewer's
// `.dragover` rule lights up), clears it on drop (browsers fire no dragleave then), and routes
// the drop through create_file_drop_handler (URL drops, decompression, batch errors, queueing).
export const file_drop_zone =
  (options: FileDropZoneOptions): Attachment<HTMLElement> =>
  (node) => {
    const set_dragover = (over: boolean) => {
      node.classList.toggle(`dragover`, over)
      options.on_dragover?.(over)
    }
    const { ondragover, ondragleave } = drag_over_handlers({
      allow: options.allow,
      set_dragover,
    })
    const handle_drop = create_file_drop_handler(options)
    const ondrop = (event: DragEvent) => {
      set_dragover(false)
      void handle_drop(event)
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
