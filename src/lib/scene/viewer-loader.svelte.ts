// Shared acquisition wiring for the 3D viewer shells (BrillouinZone, FermiSurface): a
// `data_url` fetch, an optional inline string prop and drag-and-drop, all funnelled through one
// parse callback with race-safe loading/error state. Headless; the component keeps its
// bindable props and hands them over as accessors. Candidate for later consolidation with
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
  // Parse and commit `content`, calling `mark_owned(value)` in the same synchronous step as
  // the commit: the commit re-runs the data_url effect, which would otherwise read the new
  // value as caller-supplied and stop defending the URL. Implementations that yield (await)
  // must re-check `is_current()` before committing so a superseded load cannot clobber a
  // newer one. Parse errors are reported by the implementation.
  parse: (
    content: string | ArrayBuffer,
    filename: string,
    metadata: io.FileLoadMeta | undefined,
    ctx: ViewerParseContext<Value>,
  ) => Promise<void> | void
  // Transport / host-handler failures (parse failures are the parser's own business)
  report_error: (message: string, filename?: string) => void
}

export interface ViewerParseContext<Value> {
  // False once a newer data_url request superseded this load
  is_current: () => boolean
  // Attribute the committed value to the data_url (no-op for drops and inline strings)
  mark_owned: (value: Value) => void
}

const local_parse_context = <Value>(): ViewerParseContext<Value> => ({
  is_current: () => true,
  mark_owned: () => {},
})

export function create_viewer_loader<Value>(inputs: ViewerLoaderInputs<Value>) {
  const url_loader = io.create_data_url_loader<Value>()

  $effect(() =>
    url_loader.request({
      url: inputs.data_url(),
      current_value: inputs.current_value(),
      set_loading: inputs.set_loading,
      clear_error: () => inputs.set_error(undefined),
      // Without mark_owned the value this URL just produced reads as caller-supplied on the
      // next effect run, so the loader stops fetching and a second data_url never loads.
      on_load: async ({ content, filename, metadata, is_current, mark_owned }) => {
        const on_file_drop = inputs.on_file_drop()
        if (on_file_drop) {
          try {
            await on_file_drop(content, filename, metadata)
            if (is_current()) mark_owned()
          } catch (error) {
            if (is_current()) inputs.report_error(to_error(error).message, filename)
          }
          return
        }
        await inputs.parse(content, filename, metadata, { is_current, mark_owned })
      },
      on_error: (error, filename) => inputs.report_error(error.message, filename),
    }),
  )

  const { inline_string } = inputs
  if (inline_string) {
    $effect(() => {
      const text = inline_string()
      if (!text || inputs.data_url()) return
      inputs.set_loading(true)
      inputs.set_error(undefined)
      try {
        void inputs.parse(text, `string`, undefined, local_parse_context())
      } finally {
        inputs.set_loading(false)
      }
    })
  }

  const drop_zone: Attachment<HTMLElement> = io.file_drop_zone({
    allow: inputs.allow_file_drop,
    on_drop: async (content, filename, metadata) => {
      const on_file_drop = inputs.on_file_drop()
      if (on_file_drop) await on_file_drop(content, filename, metadata)
      else await inputs.parse(content, filename, metadata, local_parse_context())
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
    // defending it instead of reading the edited object as caller-supplied
    claim: (value: Value) => {
      if (url_loader.loaded_url) url_loader.claim(value)
    },
  }
}
