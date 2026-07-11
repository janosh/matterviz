// Shared file-drop handler composable for drag-and-drop file loading.
import { decompress_file } from './decompress'
import { handle_url_drop } from './url-drop'
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
export const create_file_drop_handler =
  (opts: FileDropOptions): ((event: DragEvent) => Promise<void>) =>
  async (event: DragEvent) => {
    event.preventDefault()
    if (!opts.allow()) return

    opts.set_loading?.(true)

    try {
      let url_error: string | undefined
      const handled = await handle_url_drop(event, opts.on_drop).catch((exc) => {
        url_error = to_error(exc).message
        return false
      })
      if (handled) return

      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.length === 0) {
        if (url_error) opts.on_error?.(`Failed to load from URL: ${url_error}`)
        return
      }

      // One failing file must not abort the rest of the batch
      const failures: string[] = []
      for (const file of files) {
        try {
          const { content, filename } = await decompress_file(file)
          if (content) await opts.on_drop(content, filename)
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
