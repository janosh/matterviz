// JupyterLab file viewer for MatterViz. Registers the structure/trajectory file
// types MatterViz understands and document widget factories that render them, so
// double-clicking a .cif or .traj in the Lab file browser opens a live viewer.
//
// The heavy lifting is the same code path the VS Code extension uses:
// `parse_file_content` turns filename + content into a typed result and
// `create_display` mounts the matching Svelte component. Only the host plumbing
// (reading bytes, theming, widget lifecycle) is JupyterLab-specific.

import type { JupyterFrontEnd, JupyterFrontEndPlugin } from '@jupyterlab/application'
import { ILayoutRestorer } from '@jupyterlab/application'
import { WidgetTracker } from '@jupyterlab/apputils'
import { PathExt } from '@jupyterlab/coreutils'
import type { DocumentRegistry } from '@jupyterlab/docregistry'
import { ABCWidgetFactory, Base64ModelFactory, DocumentWidget } from '@jupyterlab/docregistry'
import { LabIcon } from '@jupyterlab/ui-components'
import { Widget } from '@lumino/widgets'
// Type-only, so it is erased at build time and pulls nothing into the entry chunk.
import type * as viewer_module from './viewer'
// oxlint-disable-next-line eslint-plugin-import/no-unassigned-import -- side-effect only
import './index.css'

// Loading the viewer on first open rather than at import time keeps JupyterLab's
// bootstrap — which imports every extension entry serially — fast.
let viewer_promise: Promise<typeof viewer_module> | null = null
const load_viewer = (): Promise<typeof viewer_module> =>
  (viewer_promise ??= import(`./viewer`))

// Everything the browser can decode from a UTF-8 string.
const TEXT_EXTENSIONS = [
  `cif`,
  `mcif`,
  `mmcif`,
  `xyz`,
  `extxyz`,
  `poscar`,
  `vasp`,
  `cube`,
  `pdb`,
  `mol`,
  `mol2`,
  `sdf`,
  `lmp`,
  `dump`,
  `lammpstrj`,
  `bxsf`,
  `frmsf`,
]

// Binary containers that must reach the parser as bytes, not text. These are the
// formats gated behind the lazily loaded HDF5/binary decoders.
const BINARY_EXTENSIONS = [`traj`, `h5`, `hdf5`, `xtc`, `trr`, `dcd`]

// Files above this size are refused rather than pulled through the contents API,
// which delivers them as a single JSON response (base64-inflated for binary) and
// then holds the bytes twice while the parser copies them into WASM memory.
const MAX_FILE_BYTES = 100 * 1024 * 1024

const matterviz_icon = new LabIcon({
  name: `matterviz:file`,
  svgstr: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#616161" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="jp-icon3"><path d="M12 3 4 7.5v9L12 21l8-4.5v-9Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></svg>`,
})

const make_file_types = (
  extensions: string[],
  file_format: `text` | `base64`,
): DocumentRegistry.IFileType[] =>
  extensions.map((ext) => ({
    name: `matterviz-${ext.replaceAll(`.`, `-`)}`,
    displayName: ext.toUpperCase(),
    extensions: [`.${ext}`],
    mimeTypes: [`application/octet-stream`],
    contentType: `file`,
    fileFormat: file_format,
    icon: matterviz_icon,
  }))

// VASP's canonical filenames carry no extension at all.
const VASP_NAMED_FILE_TYPE: DocumentRegistry.IFileType = {
  name: `matterviz-vasp-named`,
  displayName: `VASP structure`,
  extensions: [],
  pattern: `^(?:.*[._-])?(?:POSCAR|CONTCAR|XDATCAR|poscar|contcar|xdatcar)(?:[._-].*)?$`,
  mimeTypes: [`text/plain`],
  contentType: `file`,
  fileFormat: `text`,
  icon: matterviz_icon,
}

const TEXT_FILE_TYPES = [...make_file_types(TEXT_EXTENSIONS, `text`), VASP_NAMED_FILE_TYPE]

// Gzipped variants are registered explicitly rather than claiming bare `.gz`,
// which would hijack every compressed file in the browser. Compressed payloads
// always travel as base64 — the parser peels one layer before dispatching on the
// inner name.
const GZIP_EXTENSIONS = [...TEXT_EXTENSIONS, ...BINARY_EXTENSIONS].map((ext) => `${ext}.gz`)
const BASE64_FILE_TYPES = make_file_types([...BINARY_EXTENSIONS, ...GZIP_EXTENSIONS], `base64`)

const format_bytes = (bytes: number): string =>
  bytes >= 2 ** 30 ? `${(bytes / 2 ** 30).toFixed(1)} GB` : `${Math.round(bytes / 2 ** 20)} MB`

class MatterVizViewer extends Widget {
  private mounted_app: viewer_module.MatterVizApp | null = null
  private readonly viewer_root: HTMLDivElement
  // Guards against an in-flight parse of a stale revision clobbering a newer one
  // when a watched file changes faster than it parses.
  private render_generation = 0

  constructor(private readonly context: DocumentRegistry.Context) {
    super()
    this.addClass(`mv-file-viewer`)
    this.viewer_root = document.createElement(`div`)
    this.node.append(this.viewer_root)

    void this.context.ready.then(() => {
      if (this.isDisposed) return
      void this.render()
      // Mirrors the VS Code extension's file watching: re-render on disk changes.
      this.context.model.contentChanged.connect(this.on_content_changed, this)
    })
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
    const filename = PathExt.basename(this.context.path)
    const { size = 0, format } = this.context.contentsModel ?? {}

    if (size > MAX_FILE_BYTES) {
      const message = `File is ${format_bytes(size)}, above the ${format_bytes(MAX_FILE_BYTES)} viewer limit. Open it from a notebook instead, where the kernel parses it in Python rather than shipping every byte to the browser.`
      this.show_error(filename, new Error(message))
      return
    }

    try {
      const { create_display, parse_file_content } = await load_viewer()
      const result = await parse_file_content(
        this.context.model.toString(),
        filename,
        format === `base64`,
      )
      // A newer render (or a dispose) won the race while we were parsing.
      if (generation !== this.render_generation || this.isDisposed) return
      await this.unmount_current()
      this.mounted_app = create_display(this.viewer_root, result)
    } catch (error) {
      if (generation !== this.render_generation || this.isDisposed) return
      this.show_error(filename, error instanceof Error ? error : new Error(String(error)))
    }
  }

  private show_error(filename: string, error: Error): void {
    void this.unmount_current()
    // Fixed literal, no interpolation; the untrusted strings go in via textContent.
    this.viewer_root.innerHTML = `<div class="mv-file-viewer-error"><h2></h2><p></p></div>`
    const [heading, detail] = this.viewer_root.querySelectorAll(`h2, p`)
    heading.textContent = `Cannot display ${filename}`
    detail.textContent = error.message
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
  options: {
    name: string
    model_name: `text` | `base64`
    default_for: DocumentRegistry.IFileType[]
    // Types we appear under in "Open With" without displacing the existing default
    additional_file_types?: string[]
  },
): void => {
  const { name, model_name, default_for, additional_file_types = [] } = options
  const default_names = default_for.map((file_type) => file_type.name)

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
    for (const file_type of [...TEXT_FILE_TYPES, ...BASE64_FILE_TYPES]) {
      app.docRegistry.addFileType(file_type)
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
      default_for: TEXT_FILE_TYPES,
      // MatterViz renders pymatgen/ASE JSON, but must not displace Lab's own JSON
      // viewer, so JSON stays an opt-in "Open With" entry.
      additional_file_types: [`json`],
    })
    register_factory(app, restorer, {
      name: `MatterViz (binary)`,
      model_name: `base64`,
      default_for: BASE64_FILE_TYPES,
    })
  },
}

export default plugin
