// JupyterLab file viewer for MatterViz. Registers the structure/trajectory file
// types MatterViz understands and document widget factories that render them, so
// double-clicking a .cif or .traj in the Lab file browser opens a live viewer.
//
// The heavy lifting is the same code path the VS Code webview uses: `parse_in_worker`
// turns filename + content into a typed result off the UI thread and `create_display`
// mounts the matching Svelte component. Only the host plumbing (reading bytes, theming,
// widget lifecycle) is JupyterLab-specific.

import { ILayoutRestorer } from '@jupyterlab/application'
import type { JupyterFrontEnd, JupyterFrontEndPlugin } from '@jupyterlab/application'
import { WidgetTracker } from '@jupyterlab/apputils'
import { PathExt } from '@jupyterlab/coreutils'
import { ABCWidgetFactory, Base64ModelFactory, DocumentWidget } from '@jupyterlab/docregistry'
import type { DocumentRegistry } from '@jupyterlab/docregistry'
import { LabIcon } from '@jupyterlab/ui-components'
import { Widget } from '@lumino/widgets'
import { format_bytes } from 'svelte-widgets/format'
import { BASE64_FILE_TYPES, type FileTypeSpec, TEXT_FILE_TYPES } from './file-types'
// Type-only, so it is erased at build time and pulls nothing into the entry chunk.
import type * as viewer_module from './viewer'
// oxlint-disable-next-line eslint-plugin-import/no-unassigned-import -- side-effect only
import './index.css'

// Loading the viewer on first open rather than at import time keeps JupyterLab's
// bootstrap — which imports every extension entry serially — fast.
let viewer_promise: Promise<typeof viewer_module> | null = null
const load_viewer = (): Promise<typeof viewer_module> =>
  (viewer_promise ??= import(`./viewer`))

// Caps parsing, not transfer: the document manager has already fetched and decoded
// the whole file by the time a widget factory runs. Past this size the browser tab
// is the wrong place to do the work, since the parser copies the bytes again into
// WASM memory on top of the string the model is already holding.
export const MAX_PARSE_BYTES = 100 * 1024 * 1024

const matterviz_icon = new LabIcon({
  name: `matterviz:file`,
  svgstr: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#616161" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="jp-icon3"><path d="M12 3 4 7.5v9L12 21l8-4.5v-9Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></svg>`,
})

const type_names = (specs: FileTypeSpec[]): string[] => specs.map((spec) => spec.name)

export class MatterVizViewer extends Widget {
  private mounted_app: viewer_module.MatterVizApp | null = null
  private readonly viewer_root: HTMLDivElement
  // Guards against an in-flight parse of a stale revision clobbering a newer one
  // when a watched file changes faster than it parses.
  private render_generation = 0
  // Aborting also terminates the parse worker, so a superseded parse stops burning CPU
  private parse_controller: AbortController | null = null

  constructor(private readonly context: DocumentRegistry.Context) {
    super()
    this.addClass(`mv-file-viewer`)
    this.viewer_root = document.createElement(`div`)
    this.node.append(this.viewer_root)

    void this.context.ready.then(
      () => {
        if (this.isDisposed) return
        void this.render()
        // Fires on initial load and on File > Reload from Disk, not on external
        // writes — JupyterLab has no filesystem watcher, so unlike the VS Code
        // extension a file changed by a kernel needs a manual reload.
        this.context.model.contentChanged.connect(this.on_content_changed, this)
      },
      // A failed fetch (deleted file, permissions, server error) would otherwise
      // leave an empty panel and an unhandled rejection in the console.
      (error: unknown) =>
        this.show_error(PathExt.basename(this.context.path), error, this.render_generation),
    )
  }

  // A newer render, or a dispose, won the race while we were awaiting.
  private is_stale(generation: number): boolean {
    return generation !== this.render_generation || this.isDisposed
  }

  // Unmount the current app and return whether this generation still owns the
  // node — both `render` and `show_error` need this after every await.
  private async clear_for(generation: number): Promise<boolean> {
    if (this.is_stale(generation)) return false
    await this.unmount_current()
    return !this.is_stale(generation)
  }

  // Arrow property rather than a method to keep the reference bound. Passing
  // `this` as the signal's thisArg makes the widget the receiver, so Lumino's
  // `Signal.clearData(this)` in `Widget.dispose` severs the connection even if
  // our explicit disconnect below is ever bypassed.
  private readonly on_content_changed = (): void => {
    void this.render()
  }

  private async render(): Promise<void> {
    const generation = ++this.render_generation
    this.parse_controller?.abort()
    this.parse_controller = new AbortController()
    const { signal } = this.parse_controller
    const filename = PathExt.basename(this.context.path)
    const is_base64 = this.context.contentsModel?.format === `base64`
    const content = this.context.model.toString()
    // Measured off the loaded content because JupyterLab omits `size` from
    // contentsModel; base64 carries three bytes per four characters.
    const byte_size = is_base64 ? Math.floor((content.length * 3) / 4) : content.length

    if (byte_size > MAX_PARSE_BYTES) {
      const message = `File is ${format_bytes(byte_size)}, above the ${format_bytes(MAX_PARSE_BYTES)} viewer limit. Open it from a notebook instead, where the kernel parses it in Python rather than holding every byte in the browser.`
      await this.show_error(filename, message, generation)
      return
    }

    try {
      const { create_display, parse_in_worker } = await load_viewer()
      const result = await parse_in_worker(content, filename, is_base64, { signal })
      if (!(await this.clear_for(generation))) return
      this.mounted_app = create_display(this.viewer_root, result)
    } catch (error) {
      await this.show_error(filename, error, generation)
    }
  }

  private async show_error(
    filename: string,
    error: unknown,
    generation: number,
  ): Promise<void> {
    if (!(await this.clear_for(generation))) return
    // Fixed literal, no interpolation; the untrusted strings go in via textContent.
    this.viewer_root.innerHTML = `<div class="mv-file-viewer-error"><h2></h2><p></p></div>`
    const [heading, detail] = this.viewer_root.querySelectorAll(`h2, p`)
    heading.textContent = `Cannot display ${filename}`
    detail.textContent = error instanceof Error ? error.message : String(error)
  }

  private async unmount_current(): Promise<void> {
    const app = this.mounted_app
    this.mounted_app = null
    // A mounted app implies the viewer chunk resolved, so this is a cache hit.
    if (app) await (await load_viewer()).unmount(app)
  }

  dispose(): void {
    if (this.isDisposed) return
    // Bump the generation so a parse still in flight discards its result instead
    // of mounting into a detached node.
    this.render_generation++
    this.parse_controller?.abort()
    this.context.model.contentChanged.disconnect(this.on_content_changed, this)
    void this.unmount_current()
    super.dispose()
  }
}

class MatterVizFactory extends ABCWidgetFactory<DocumentWidget<MatterVizViewer>> {
  protected createNewWidget(
    context: DocumentRegistry.Context,
  ): DocumentWidget<MatterVizViewer> {
    const widget = new DocumentWidget({ content: new MatterVizViewer(context), context })
    widget.title.icon = matterviz_icon
    return widget
  }
}

// A widget factory is bound to one model factory, and the model factory — not the
// file type — decides whether the contents API returns text or base64 (see
// docregistry's Context, which requests `this._factory.fileFormat`). So text and
// binary formats need one factory each.
const register_factory = (
  app: JupyterFrontEnd,
  restorer: ILayoutRestorer | null,
  {
    name,
    model_name,
    default_names,
    additional_file_types = [],
  }: {
    name: string
    model_name: `text` | `base64`
    default_names: string[]
    // Types we appear under in "Open With" without displacing the existing default
    additional_file_types?: string[]
  },
): void => {
  const factory = new MatterVizFactory({
    name,
    // Shown in the file browser's "Open With" menu. Both factories share the label:
    // a given file only ever matches one, so the duplicate is never visible.
    label: `MatterViz`,
    modelName: model_name,
    fileTypes: [...default_names, ...additional_file_types],
    defaultFor: default_names,
    readOnly: true,
  })
  app.docRegistry.addWidgetFactory(factory)

  const tracker = new WidgetTracker<DocumentWidget<MatterVizViewer>>({ namespace: name })
  factory.widgetCreated.connect((_sender, widget) => {
    void tracker.add(widget)
    widget.context.pathChanged.connect(() => void tracker.save(widget))
  })
  void restorer?.restore(tracker, {
    command: `docmanager:open`,
    args: (widget) => ({ path: widget.context.path, factory: name }),
    name: (widget) => widget.context.path,
  })
}

const plugin: JupyterFrontEndPlugin<void> = {
  id: `matterviz-jupyterlab:plugin`,
  description: `Open crystal structures, MD trajectories and volumetric data from the JupyterLab file browser`,
  autoStart: true,
  optional: [ILayoutRestorer],
  activate: (app: JupyterFrontEnd, restorer: ILayoutRestorer | null): void => {
    for (const spec of [...TEXT_FILE_TYPES, ...BASE64_FILE_TYPES]) {
      app.docRegistry.addFileType({ ...spec, icon: matterviz_icon })
    }

    // Only the `text` model factory ships with DocumentRegistry; `base64` is added
    // by whichever extension needs it first (usually the image viewer), and
    // registering it twice logs a warning.
    if (!app.docRegistry.getModelFactory(`base64`)) {
      app.docRegistry.addModelFactory(new Base64ModelFactory())
    }

    register_factory(app, restorer, {
      name: `MatterViz`,
      model_name: `text`,
      default_names: type_names(TEXT_FILE_TYPES),
      // MatterViz renders pymatgen/ASE JSON, but must not displace Lab's own JSON
      // viewer, so JSON stays an opt-in "Open With" entry.
      additional_file_types: [`json`],
    })
    register_factory(app, restorer, {
      name: `MatterViz (binary)`,
      model_name: `base64`,
      default_names: type_names(BASE64_FILE_TYPES),
    })
  },
}

export default plugin
