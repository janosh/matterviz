// Shared acquisition wiring for the viewer shells (Structure, BrillouinZone, FermiSurface): a
// `data_url` fetch, an optional inline string prop and drag-and-drop, all funnelled through one
// parser with race-safe loading/error state. Headless; the component keeps its bindable props
// and hands them over as accessors.
import * as io from '$lib/io'
import { to_error } from '$lib/utils'
import { untrack } from 'svelte'
import type { Attachment } from 'svelte/attachments'

// `Value` is what the viewer holds and the loader defends against a data_url fetch; `Parsed` is
// what one payload yields (defaults to `Value`; Structure parses a whole document of structure
// plus volumes around it).
export interface ViewerLoaderInputs<Value, Parsed = Value> {
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
  // Turn file content into the viewer's next value or throw a descriptive error. May yield
  // (e.g. to let a spinner paint); the loader drops the result if a newer load superseded it.
  // Runs untracked, so it may read the viewer's current state (e.g. to merge volumes into the
  // cell on screen) without subscribing the inline-string effect to it.
  parse: (
    content: string | ArrayBuffer,
    filename: string,
    metadata: io.FileLoadMeta | undefined,
  ) => Parsed | Promise<Parsed>
  // Store a freshly parsed value in the viewer's props (and notify `on_file_load`)
  commit: (
    value: Parsed,
    filename: string,
    metadata: io.FileLoadMeta | undefined,
    file_size: number,
  ) => void
  // Parse, transport and host-handler failures. Wording is the loader's: `Failed to parse
  // <filename>: …` for the parser, `on_file_load failed for <filename>: …` for the commit,
  // the raw message for transport and host `on_file_drop` failures, and the drop zone's
  // per-batch `Failed to load N files — …` report for dropped files.
  report_error: (message: string, filename?: string, metadata?: io.FileLoadMeta) => void
}

export function create_viewer_loader<Value, Parsed = Value>(
  inputs: ViewerLoaderInputs<Value, Parsed>,
) {
  const url_loader = io.create_data_url_loader<Value>()

  // `is_current` is false once a newer data_url request superseded this load, so a slow URL A
  // can neither overwrite URL B's value nor report its parse error over B's. `mark_owned`
  // attributes the value the viewer holds after the commit to the URL, in the same synchronous
  // step: the commit re-runs the data_url effect, which would otherwise read the new value as
  // caller-supplied and stop defending the URL (and never fetch a second URL). It is the value
  // read back through the prop, not the parsed object, since a bindable hands back a proxy.
  // Drops and inline strings have no URL to race or own.
  type LoadContext = { is_current: () => boolean; mark_owned: (value?: Value) => void }
  const unowned: LoadContext = { is_current: () => true, mark_owned: () => {} }

  // Parse failures propagate: the drop zone folds each file's into its per-batch report, the
  // URL and inline paths report them through `load_reporting`
  async function load(
    content: string | ArrayBuffer,
    filename: string,
    metadata: io.FileLoadMeta | undefined,
    { is_current, mark_owned }: LoadContext = unowned,
  ): Promise<void> {
    const value = await inputs.parse(content, filename, metadata)
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

  async function load_reporting(
    content: string | ArrayBuffer,
    filename: string,
    metadata: io.FileLoadMeta | undefined,
    ctx: LoadContext = unowned,
  ): Promise<void> {
    try {
      await load(content, filename, metadata, ctx)
    } catch (err) {
      if (ctx.is_current()) {
        inputs.report_error(
          `Failed to parse ${filename}: ${to_error(err).message}`,
          filename,
          metadata,
        )
      }
    }
  }

  $effect(() =>
    url_loader.request({
      url: inputs.data_url(),
      // A host on_file_drop owns the value; its presence is not a caller-supplied cancel
      current_value: inputs.on_file_drop() ? undefined : inputs.current_value(),
      set_loading: inputs.set_loading,
      clear_error: () => inputs.set_error(undefined),
      on_load: async (ctx) => {
        const { content, filename, metadata, is_current, mark_owned } = ctx
        const on_file_drop = inputs.on_file_drop()
        if (!on_file_drop) return load_reporting(content, filename, metadata, ctx)
        try {
          await on_file_drop(content, filename, metadata)
          if (is_current()) mark_owned()
        } catch (error) {
          if (is_current()) inputs.report_error(to_error(error).message, filename, metadata)
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
      // Parsing yields at least once (the parser may await), so the spinner covers it. Untracked
      // so a parser that reads the current value does not re-run this effect on every change.
      inputs.set_loading(true)
      void untrack(() =>
        load_reporting(text, `string`, undefined).finally(() => inputs.set_loading(false)),
      )
    })
  }

  const drop_zone: Attachment<HTMLElement> = io.file_drop_zone({
    allow: inputs.allow_file_drop,
    on_drop: (content, filename, metadata) =>
      (inputs.on_file_drop() ?? load)(content, filename, metadata),
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
