// Shared file-drop handler composable for drag-and-drop file loading.
import { decompress_file } from './decompress'
import { dropped_file_url, load_from_url } from './url-drop'
import { to_error } from '$lib/utils'
import { files_from_data_transfer } from 'svelte-widgets/file-drop'
import type { FileLoadCallback } from './types'

export interface FileDropOptions {
  allow: () => boolean
  on_drop: FileLoadCallback
  max_files?: number
  on_error?: (msg: string) => void
  set_loading?: (loading: boolean) => void
}

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
    if (opts.allow && !opts.allow()) return
    opts.set_dragover(true)
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
          `Drop at most ${max_files} file${max_files === 1 ? `` : `s`} at a time (received ${source_count})`,
        )
        return
      }
      if (url) {
        try {
          await load_from_url(url, opts.on_drop)
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
          const { content, filename } = await decompress_file(file)
          if (content) {
            await opts.on_drop(content, filename, { source_filename: file.name, file })
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
