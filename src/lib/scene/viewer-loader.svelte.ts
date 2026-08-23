// Shared acquisition wiring for the 3D viewer shells (BrillouinZone, FermiSurface): a
// `data_url` fetch, an optional inline string prop and drag-and-drop, all funnelled through one
// pure parser with race-safe loading/error state. Headless; the component keeps its bindable
// props and hands them over as accessors. Candidate for later consolidation with
// structure/loader.svelte.ts (Structure/Trajectory), which carries volumetric-merge logic on
// top of the same skeleton.
import * as io from '$lib/io'
import { to_error } from '$lib/utils'
import type { Attachment } from 'svelte/attachments'

export interface ViewerLoaderInputs<Value> {
  data_url: () => string | undefined
  // Inline content prop (e.g. `structure_string`); parsed whenever it changes and no data_url
  // is set. Omit for viewers without one.
  inline_string?: () => string | undefined
  // The value the viewer currently holds, so a caller-supplied one is not overwritten by a
  // data_url fetch
  current_value: () => Value | undefined
  allow_file_drop: () => boolean
  // Host takes over dropped/fetched content instead of the built-in parser
  on_file_drop: () => io.FileLoadCallback | undefined
  set_loading: (loading: boolean) => void
  set_error: (message: string | undefined) => void
  set_dragover?: (over: boolean) => void
  // Pure: turn file content into the viewer's value or throw a descriptive error. May yield
  // (e.g. to let a spinner paint); the loader drops the result if a newer load superseded it.
  parse: (content: string | ArrayBuffer, filename: string) => Value | Promise<Value>
  // Store a freshly parsed value in the viewer's props (and notify `on_file_load`)
  commit: (
    value: Value,
    filename: string,
    metadata: io.FileLoadMeta | undefined,
    file_size: number,
  ) => void
  // Parse, transport and host-handler failures
  report_error: (message: string, filename?: string, metadata?: io.FileLoadMeta) => void
}

export function create_viewer_loader<Value>(inputs: ViewerLoaderInputs<Value>) {
  const url_loader = io.create_data_url_loader<Value>()

  // `is_current` is false once a newer data_url request superseded this load, so a slow URL A
  // can neither overwrite URL B's value nor report its parse error over B's. `mark_owned`
  // attributes the value the viewer holds after the commit to the URL, in the same synchronous
  // step: the commit re-runs the data_url effect, which would otherwise read the new value as
  // caller-supplied and stop defending the URL (and never fetch a second URL). It is the value
  // read back through the prop, not the parsed object, since a bindable hands back a proxy.
  async function load(
    content: string | ArrayBuffer,
    filename: string,
    metadata: io.FileLoadMeta | undefined,
    is_current: () => boolean = () => true,
    mark_owned: (value: Value | undefined) => void = () => {},
  ): Promise<void> {
    let value: Value
    try {
      value = await inputs.parse(content, filename)
    } catch (err) {
      if (is_current()) {
        inputs.report_error(
          `Failed to parse ${filename}: ${to_error(err).message}`,
          filename,
          metadata,
        )
      }
      return
    }
    if (!is_current()) return
    // Only the parser's failures are parse errors. The commit stores the value before it
    // notifies the host, so a throwing `on_file_load` leaves a loaded value that still belongs
    // to the URL; it is reported as the host's failure and ownership is recorded regardless.
    try {
      inputs.commit(value, filename, metadata, io.content_byte_size(content))
    } catch (err) {
      inputs.report_error(
        `on_file_load failed for ${filename}: ${to_error(err).message}`,
        filename,
        metadata,
      )
    }
    mark_owned(inputs.current_value())
  }

  $effect(() =>
    url_loader.request({
      url: inputs.data_url(),
      // A host on_file_drop owns the value; its presence is not a caller-supplied cancel
      current_value: inputs.on_file_drop() ? undefined : inputs.current_value(),
      set_loading: inputs.set_loading,
      clear_error: () => inputs.set_error(undefined),
      on_load: async ({ content, filename, metadata, is_current, mark_owned }) => {
        const on_file_drop = inputs.on_file_drop()
        if (!on_file_drop) return load(content, filename, metadata, is_current, mark_owned)
        try {
          await on_file_drop(content, filename, metadata)
          if (is_current()) mark_owned()
        } catch (error) {
          if (is_current()) inputs.report_error(to_error(error).message, filename)
        }
      },
      on_error: (error, filename) => inputs.report_error(error.message, filename),
    }),
  )

  const { inline_string } = inputs
  if (inline_string) {
    $effect(() => {
      const text = inline_string()
      if (!text || inputs.data_url()) return
      inputs.set_error(undefined)
      // Parsing yields at least once (the parser may await), so the spinner covers it
      inputs.set_loading(true)
      void load(text, `string`, undefined).finally(() => inputs.set_loading(false))
    })
  }

  const drop_zone: Attachment<HTMLElement> = io.file_drop_zone({
    allow: inputs.allow_file_drop,
    on_drop: async (content, filename, metadata) => {
      const on_file_drop = inputs.on_file_drop()
      if (on_file_drop) await on_file_drop(content, filename, metadata)
      else await load(content, filename, metadata)
    },
    on_error: (message) => inputs.report_error(message),
    set_loading: (loading) => {
      inputs.set_loading(loading)
      if (loading) inputs.set_error(undefined)
    },
    on_dragover: inputs.set_dragover,
  })

  return {
    drop_zone,
    // Re-attribute an in-place edit of the URL-loaded value to its URL, so the loader keeps
    // defending it instead of reading the edited object as caller-supplied. Call after storing
    // the edit in the prop: like `mark_owned`, it claims the value read back through the prop
    // (a bindable hands back a proxy), not the object the component assigned.
    claim: () => {
      const value = inputs.current_value()
      if (url_loader.loaded_url && value !== undefined) url_loader.claim(value)
    },
  }
}
