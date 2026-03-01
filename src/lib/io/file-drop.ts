// Shared file-drop handler composable for drag-and-drop file loading.
import { decompress_file } from './decompress'
import { handle_url_drop } from './url-drop'

export interface FileDropOptions {
  allow: () => boolean
  on_drop: (content: string | ArrayBuffer, filename: string) => void | Promise<void>
  on_error?: (msg: string) => void
  set_loading?: (loading: boolean) => void
}

// Handles URL drops (from FilePicker), direct file drops with decompression,
// loading state, and error reporting.
export function create_file_drop_handler(
  opts: FileDropOptions,
): (event: DragEvent) => Promise<void> {
  return async (event: DragEvent) => {
    event.preventDefault()
    if (!opts.allow()) return

    opts.set_loading?.(true)

    let drop_filename = ``
    try {
      let url_error: string | undefined
      const handled = await handle_url_drop(event, opts.on_drop).catch((exc) => {
        url_error = exc instanceof Error ? exc.message : String(exc)
        return false
      })
      if (handled) return

      const file = event.dataTransfer?.files[0]
      if (!file) {
        if (url_error) opts.on_error?.(`Failed to load from URL: ${url_error}`)
        return
      }
      drop_filename = file.name

      const { content, filename } = await decompress_file(file)
      if (content) await opts.on_drop(content, filename)
    } catch (exc) {
      const detail = exc instanceof Error ? exc.message : String(exc)
      const msg = drop_filename
        ? `Failed to load file ${drop_filename}: ${detail}`
        : `Failed to load file: ${detail}`
      opts.on_error?.(msg)
    } finally {
      opts.set_loading?.(false)
    }
  }
}
