import { download, type DownloadData } from './fetch'
import { to_error } from '$lib/utils'

export type FileSaver = (
  data: DownloadData,
  filename: string,
  mime: string,
) => void | Promise<void>

export interface FileExportContext {
  filename: string
  save: FileSaver
  prepare: (
    filename: string,
    signal?: AbortSignal,
  ) => Promise<(data: DownloadData, mime: string) => Promise<void>>
}

// One destination per export UI, shared by all its formats. Native handles stay in memory.
export class FileExportState {
  filename = $derived.by(() => this.default_filename())
  directory = $state.raw<FileSystemDirectoryHandle | null>(null)
  busy = $state(false)
  error = $state(``)
  filename_error = $derived(
    !this.filename.trim() || /^[.]+$/.test(this.filename)
      ? `Enter a file name.`
      : /[/\\\p{Cc}]/u.test(this.filename)
        ? `Enter a name without path separators; choose the folder below.`
        : ``,
  )

  constructor(private readonly default_filename: () => string) {}

  async run(task: (context: FileExportContext) => unknown) {
    if (this.busy) return
    this.error = ``
    this.busy = true
    try {
      if (this.filename_error) throw new Error(this.filename_error)
      const directory = this.directory
      const prepare = async (filename: string, signal?: AbortSignal) => {
        if (directory) {
          let existing: FileSystemFileHandle | undefined
          try {
            existing = await directory.getFileHandle(filename)
          } catch (error) {
            if (!(error instanceof DOMException && error.name === `NotFoundError`)) throw error
          }
          if (existing)
            throw new Error(
              `${directory.name}/${filename} already exists. Choose another name.`,
            )
        }
        signal?.throwIfAborted()
        return async (data: DownloadData, mime: string) => {
          signal?.throwIfAborted()
          if (!directory) return download(data, filename, mime)
          const handle = await directory.getFileHandle(filename, { create: true })
          signal?.throwIfAborted()
          const writable = await handle.createWritable()
          await new Blob([data], { type: mime }).stream().pipeTo(writable, { signal })
        }
      }
      await task({
        filename: this.filename.trim(),
        prepare,
        save: async (data, filename, mime) => (await prepare(filename))(data, mime),
      })
    } catch (error) {
      this.error = to_error(error).message
      console.error(`Export ${this.filename} failed:`, error)
    } finally {
      this.busy = false
    }
  }
}
