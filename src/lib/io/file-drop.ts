// Drop zones for drag-and-drop file loading. svelte-widgets' file_drop owns the drag wiring
// (hover state without child-to-child flicker, folder expansion, FilePicker link drops); this
// module turns each drop into one batch of sources and reads them.
import { decompress_file, decompress_trajectory_file, is_empty_content } from './decompress'
import { load_from_url, load_trajectory_from_url } from './url-drop'
import { plural } from '#lib/labels'
import { file_drop } from 'svelte-widgets/attachments'
import { to_error } from 'svelte-widgets/utils'
import type { Attachment } from 'svelte/attachments'
import type { FileLoadCallback, FileLoadMeta, TrajectoryFileLoadCallback } from './types'

type DroppedFile = { content: string | ArrayBuffer; filename: string; metadata: FileLoadMeta }

export type FileDropOptions = {
  max_files?: number
  on_error?: (msg: string) => void
  set_loading?: (loading: boolean) => void
} & (
  | { keep_blob?: false; on_drop: FileLoadCallback }
  // All files of one drop in one call, for files that only mean something together
  | { keep_blob?: false; on_batch: (files: DroppedFile[]) => Promise<void> | void }
  // Trajectory viewers keep HDF5 and text payloads as Blobs (see classify_payload's keep_blob)
  | { keep_blob: true; on_drop: TrajectoryFileLoadCallback }
)

// One dropped item: a FilePicker URL or a file from the DataTransfer.
export type DropSource = string | File

export interface DropBatchOptions<Handled = void> {
  max_files?: number
  on_error?: (msg: string) => void
  set_loading?: (loading: boolean) => void
  // Consume one dropped source. Throwing folds that item's failure into the batch report
  // and leaves the rest of the batch running.
  handle: (source: DropSource) => Promise<Handled> | Handled
  // Once per drop with the results of the sources that did not throw, in drop order (skipped
  // when none succeeded), before item failures are reported
  on_batch?: (handled: Handled[]) => Promise<void> | void
}

const source_label = (source: DropSource): string =>
  typeof source === `string` ? `URL ${source}` : source.name

// Batch mechanics shared by both drop zones: enforce max_files, run the sources in drop
// order, and fold per-item failures into one report. Multiple dropped files are processed
// sequentially so e.g. several cube files can be imported at once.
const create_drop_batch_handler = <Handled = void>(
  opts: DropBatchOptions<Handled>,
): ((sources: DropSource[]) => Promise<void>) => {
  const { max_files } = opts
  if (max_files !== undefined && (!Number.isSafeInteger(max_files) || max_files < 0))
    throw new TypeError(`max_files must be a non-negative integer, got ${max_files}`)

  return async (sources: DropSource[]): Promise<void> => {
    opts.set_loading?.(true)
    try {
      if (max_files !== undefined && sources.length > max_files) {
        opts.on_error?.(
          `Drop at most ${plural(max_files, `file`)} at a time (received ${sources.length})`,
        )
        return
      }
      // One failing item must not abort the rest of the batch
      const failures: { label: string; message: string }[] = []
      const handled: Handled[] = []
      for (const source of sources) {
        try {
          handled.push(await opts.handle(source))
        } catch (exc) {
          failures.push({ label: source_label(source), message: to_error(exc).message })
        }
      }
      if (handled.length > 0) await opts.on_batch?.(handled)
      if (failures.length === 0) return
      // A lone URL is named by the report itself, so it does not repeat its own label
      if (sources.length === 1 && typeof sources[0] === `string`) {
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
}

// Reads each dropped source before handing it on: URL drops fetch, files decompress, and
// `on_drop` receives content plus its source identity. Empty content is an error either way
// (as in deliver_raw_file), not a silent no-op.
export const create_file_drop_handler = (
  opts: FileDropOptions,
): ((sources: DropSource[]) => Promise<void>) => {
  const load_url = opts.keep_blob ? load_trajectory_from_url : load_from_url
  const read_file = opts.keep_blob ? decompress_trajectory_file : decompress_file
  const read = async (source: DropSource, on_file: TrajectoryFileLoadCallback) => {
    // byte size, not truthiness: an empty binary payload is a 0-byte ArrayBuffer or Blob
    const emit: TrajectoryFileLoadCallback = (content, filename, metadata) => {
      if (is_empty_content(content)) throw new Error(`file is empty`)
      return on_file(content, filename, metadata)
    }
    if (typeof source === `string`) return load_url(source, emit)
    const { content, filename } = await read_file(source)
    await emit(content, filename, { source_filename: source.name, file: source })
  }
  if (!(`on_batch` in opts)) {
    const on_drop = opts.on_drop as TrajectoryFileLoadCallback
    return create_drop_batch_handler({ ...opts, handle: (source) => read(source, on_drop) })
  }
  const { on_batch } = opts
  return create_drop_batch_handler({
    ...opts,
    handle: async (source) => {
      const files: DroppedFile[] = []
      // content is never a Blob here: on_batch excludes keep_blob
      await read(source, (content, filename, metadata) => {
        files.push({ content: content as string | ArrayBuffer, filename, metadata })
      })
      return files
    },
    on_batch: (handled) => on_batch(handled.flat()),
  })
}

// `allow` is read on every drag event; on_dragover mirrors the hover state to the caller,
// e.g. for a bindable `dragover` prop
type ZoneOptions = { allow: () => boolean; on_dragover?: (over: boolean) => void }

// Wires `node` as a drop zone: it toggles the node's `dragover` class while an allowed drag
// hovers it (so the viewer's `.dragover` rule lights up) and routes each drop's files, or a
// FilePicker chip's URL, through `run`. A drop an inner target or capture handler already
// default-prevented (a pane reordering its own items, a page claiming a built-in entry) is
// left to it.
const drop_zone =
  (
    opts: ZoneOptions & { on_error?: (msg: string) => void },
    run: (sources: DropSource[]) => Promise<void>,
  ): Attachment<HTMLElement> =>
  (node) =>
    file_drop({
      multiple: true, // max_files reports oversized drops instead of truncating them
      // a batch starting while the previous one still runs would interleave handler state
      // mutations (e.g. torn volume lists), and a newer drop must not discard an older one
      queue: true,
      get disabled() {
        return !opts.allow()
      },
      on_files: run,
      on_urls: run,
      on_drag_active: (over) => {
        node.classList.toggle(`dragover`, over)
        opts.on_dragover?.(over)
      },
      // folder expansion rejects on a symlink cycle or an oversized tree
      on_error: (error) => opts.on_error?.(`Failed to load file: ${to_error(error).message}`),
    })(node)

// Drop zone that reads each file before handing it on, for viewers with their own parsers:
//   <div {@attach file_drop_zone({ allow: () => allow_file_drop, on_drop, on_error })}>
export const file_drop_zone = (
  options: FileDropOptions & ZoneOptions,
): Attachment<HTMLElement> => drop_zone(options, create_file_drop_handler(options))

// Drop zone that forwards untouched URLs and Files, for the open_material() components:
// acquisition and decompression stay in the material runtime.
export const raw_file_drop_zone = (
  options: Omit<DropBatchOptions, `handle`> &
    ZoneOptions & { on_drop: (source: DropSource) => Promise<void> | void },
): Attachment<HTMLElement> =>
  drop_zone(options, create_drop_batch_handler({ ...options, handle: options.on_drop }))
