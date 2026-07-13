// Shared file-drop handler composable for drag-and-drop file loading.
import { decompress_file } from './decompress'
import { dropped_file_url, load_from_url } from './url-drop'
import { to_error } from '$lib/utils'

export interface FileDropOptions {
  allow: () => boolean
  on_drop: (content: string | ArrayBuffer, filename: string) => void | Promise<void>
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
  async function process_batch(url: string | undefined, files: File[]) {
    opts.set_loading?.(true)
    try {
      // One failing item must not abort the rest of the batch
      const failures: string[] = []
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
          if (content) await opts.on_drop(content, filename)
          else failures.push(`${file.name}: file is empty`)
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
    // DataTransfer contents are only readable during drop-event dispatch, so
    // capture them before deferring to the queue
    const url = dropped_file_url(event)
    const files = Array.from(event.dataTransfer?.files ?? [])
    queue = queue.then(() => process_batch(url, files)).catch(() => undefined)
    return queue
  }
}
