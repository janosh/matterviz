// Shared Svelte wiring for viewer convenience inputs. Acquisition and parsing stay in
// open_material; viewers only validate and commit the typed result they understand.
import type { FileLoadCallback } from '$lib/io'
import { raw_file_drop_zone } from '$lib/io'
import { to_error } from '$lib/utils'
import { untrack } from 'svelte'
import type { Attachment } from 'svelte/attachments'
import {
  acquire_material,
  MaterialOpenError,
  open_material,
  source_provenance,
  type MaterialPayload,
  type MaterialSource,
  type OpenedMaterial,
} from './open'

export interface MaterialLoaderInputs<Value> {
  data_url?: () => string | undefined
  inline_source?: () => MaterialPayload | undefined
  current_value: () => Value | undefined
  allow_file_drop: () => boolean
  on_file_drop?: () => FileLoadCallback | undefined
  set_loading?: (loading: boolean) => void
  set_error: (message: string | undefined) => void
  set_dragover?: (over: boolean) => void
  commit: (opened: OpenedMaterial) => void
  report_error: (message: string, metadata?: Partial<OpenedMaterial[`provenance`]>) => void
}

// `url` marks a data_url load, so its completion claims ownership of the URL
type LoadOptions = { url?: string; drop?: boolean }

class MaterialCommitError extends Error {
  constructor(
    message: string,
    readonly provenance: OpenedMaterial[`provenance`],
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'MaterialCommitError'
  }
}

export function create_material_loader<Value>(
  inputs: MaterialLoaderInputs<Value>,
): Attachment<HTMLElement> {
  let active_controller: AbortController | undefined
  let loaded_url: string | undefined
  // Set once this loader has produced a value, so the viewer's own edits to it (and the proxy
  // a bindable hands back) still read as ours. Only a value present before we produced one
  // belongs to the caller and cancels the fetch.
  let loader_owns_value = false

  const cancel_load = (): void => {
    active_controller?.abort()
    active_controller = undefined
    inputs.set_loading?.(false)
  }

  // The drop zone owns loading indicators and error reporting across its whole batch.
  const load = async (source: MaterialSource, opts: LoadOptions = {}): Promise<void> => {
    const { url, drop = false } = opts
    active_controller?.abort()
    const controller = new AbortController()
    active_controller = controller
    if (!drop) inputs.set_loading?.(true)
    inputs.set_error(undefined)
    try {
      const on_file_drop = inputs.on_file_drop?.()
      if (on_file_drop) {
        const payload = await acquire_material(source, controller.signal)
        if (controller !== active_controller) return
        const content =
          payload.data instanceof Blob ? await payload.data.arrayBuffer() : payload.data
        await on_file_drop(content, payload.filename, {
          source_filename: payload.source_filename ?? payload.filename,
          source_url: payload.source_url,
          file: payload.file,
        })
      } else {
        const opened = await open_material(source, { signal: controller.signal })
        if (controller !== active_controller) return opened.dispose()
        try {
          inputs.commit(opened)
        } catch (error) {
          // The value is stored before the host is notified, so a throwing on_file_load is the
          // host's failure: keep the value and let the URL go on owning it
          loader_owns_value = true
          if (url) loaded_url = url
          throw new MaterialCommitError(
            `on_file_load failed for ${opened.filename}: ${to_error(error).message}`,
            opened.provenance,
            { cause: error },
          )
        } finally {
          opened.dispose()
        }
        loader_owns_value = true
      }
      if (url) loaded_url = url
    } catch (error) {
      if (controller !== active_controller || controller.signal.aborted) return
      // Before a payload is parsed it has no logical filename, so fall back to what the source
      // says about itself: on_error must always name the payload that failed
      const metadata =
        error instanceof MaterialOpenError || error instanceof MaterialCommitError
          ? error.provenance
          : source_provenance(source)
      const filename = metadata.filename ?? metadata.source_filename
      const message =
        error instanceof MaterialOpenError && error.stage === `parse`
          ? `Failed to parse ${filename ?? `material`}: ${error.message}`
          : to_error(error).message
      if (!drop) return inputs.report_error(message, { ...metadata, filename })
      throw error instanceof MaterialOpenError
        ? new Error(error.message, { cause: error })
        : error
    } finally {
      if (controller === active_controller) {
        if (!drop) inputs.set_loading?.(false)
        if (controller === active_controller) active_controller = undefined
      }
    }
  }

  $effect(() => {
    const url = inputs.data_url?.()
    if (!url) {
      cancel_load()
      loaded_url = undefined
      loader_owns_value = false
      return
    }
    // A host on_file_drop owns the value, so it is neither read (reading it would subscribe
    // this effect to every host write and refetch the same URL) nor treated as a cancel
    if (
      !inputs.on_file_drop?.() &&
      inputs.current_value() !== undefined &&
      !loader_owns_value
    ) {
      cancel_load()
      return
    }
    if (loaded_url === url) return
    void untrack(() => load(url, { url }))
  })

  $effect(() => {
    const source = inputs.inline_source?.()
    if (!source || inputs.data_url?.()) return
    void untrack(() => load(source))
  })

  $effect(() => cancel_load)

  return raw_file_drop_zone({
    allow: inputs.allow_file_drop,
    on_drop: (source) => load(source, { drop: true }),
    on_error: (message) => inputs.report_error(message),
    on_dragover: inputs.set_dragover,
    set_loading: inputs.set_loading,
  })
}
