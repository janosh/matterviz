// VS Code's webview postMessage API takes a single argument (no targetOrigin),
// so unicorn's require-post-message-target-origin is a false positive here.
// oxlint-disable eslint-plugin-unicorn/require-post-message-target-origin

// Import MatterViz parsing functions and components
// oxlint-disable-next-line eslint-plugin-import/no-unassigned-import -- side-effect only
import '$lib/app.css'
import ConvexHull from '$lib/convex-hull/ConvexHull.svelte'
import type { PhaseData } from '$lib/convex-hull/types'
import FermiSurface from '$lib/fermi-surface/FermiSurface.svelte'
import { is_fermi_surface_data } from '$lib/fermi-surface/types'
import type { VolumetricData } from '$lib/isosurface/types'
import IsobaricBinaryPhaseDiagram from '$lib/phase-diagram/IsobaricBinaryPhaseDiagram.svelte'
import type { PhaseDiagramData } from '$lib/phase-diagram/types'
import { legend_mode_to_prop } from '$lib/plot/core/utils/series-visibility'
import { merge, build_structure_props_from_settings as structure_props } from '$lib/settings'
import type { DefaultSettings } from '$lib/settings'
import type { DosInput } from '$lib/spectral'
import Bands from '$lib/spectral/Bands.svelte'
import BandsAndDos from '$lib/spectral/BandsAndDos.svelte'
import Dos from '$lib/spectral/Dos.svelte'
import type { AnyStructure } from '$lib/structure'
import Structure from '$lib/structure/Structure.svelte'
import { ensure_moyo_wasm_ready } from '$lib/symmetry'
import { apply_theme_to_dom, is_valid_theme_name } from '$lib/theme/index'
// oxlint-disable-next-line eslint-plugin-import/no-unassigned-import -- side-effect only
import '$lib/theme/themes.mjs'
import type { TrajectoryController, TrajectoryRun, TrajHandlerData } from '$lib/trajectory'
import type { VaspoutElectronicData } from '$lib/trajectory/parse/vaspout-electronic'
import Trajectory from '$lib/trajectory/Trajectory.svelte'
import { mount, unmount } from 'svelte'
import TrajectoryWithDos from './TrajectoryWithDos.svelte'
import type { VSCodeAPI } from './host-bridge'
import { get_vscode_api } from './host-bridge'
import type { FileChangeMessage, FileData, WebviewBootstrapData } from './host-protocol'
import JsonBrowser from './JsonBrowser.svelte'
import type { ParseResult } from './parse'
import { parse_in_worker } from './parse-in-worker'
import { escape_html, to_error } from '$lib/utils'

export type { VSCodeAPI } from './host-bridge'

type MatterVizData = WebviewBootstrapData

export type MatterVizApp = ReturnType<typeof mount>

// Host-provided options for create_display. Only the trajectory branch consumes
// them (viewer position restore across reloads); other result types ignore them.
interface DisplayOptions {
  // Initial frame to show. Out-of-range values (e.g. Number.MAX_SAFE_INTEGER)
  // are clamped by the Trajectory component to the last frame.
  initial_step_idx?: number
  // Reports every step change with the new index and the trajectory's frame count.
  on_step_change?: (step_idx: number, total_frames: number) => void
  // Exposes stable imperative navigation without reaching into component DOM.
  on_trajectory_controller?: (controller: TrajectoryController | null) => void
}

// Extend globalThis interface for MatterViz data
declare global {
  interface Window {
    matterviz_data?: MatterVizData
    initializeMatterViz?: () => Promise<MatterVizApp | null>
    cleanupMatterViz?: () => Promise<void>
    download?: (data: string | Blob, filename: string) => void
  }
  // Also declare as global var for direct access via globalThis.matterviz_data
  // Both are needed: Window.matterviz_data is set by extension.ts, accessed via globalThis
  var matterviz_data: MatterVizData | undefined
}

// host-bridge.ts owns the single acquireVsCodeApi() call; VS Code throws on a
// second one.
const vscode_api: VSCodeAPI | null = get_vscode_api()

// VS Code serves the bundle from a resource origin (https://*.vscode-cdn.net) that differs
// from the webview document's origin, and `new Worker(cross_origin_url)` throws a
// SecurityError, so every worker (parsing, MSD, VACF, structure-id, isosurface geometry)
// would fail to construct. A same-origin blob module that imports the real script is what the
// webview CSP's `worker-src blob:` permits; the imported module keeps its own import.meta.url,
// so its nested asset URLs still resolve. The import must be dynamic: a static `import` inside
// the blob is blocked by the webview CSP (verified in Chromium). Same-origin URLs (Hive, the
// docs site) construct as-is.
const install_cross_origin_worker_shim = (): void => {
  if (typeof Worker === `undefined`) return
  const NativeWorker = Worker
  globalThis.Worker = class extends NativeWorker {
    constructor(script_url: string | URL, options?: WorkerOptions) {
      const href = String(script_url)
      const cross_origin =
        /^https?:/i.test(href) && new URL(href).origin !== globalThis.location.origin
      const blob_url = cross_origin
        ? URL.createObjectURL(
            new Blob([`await import(${JSON.stringify(href)})`], { type: `text/javascript` }),
          )
        : null
      super(blob_url ?? script_url, blob_url ? { ...options, type: `module` } : options)
      if (blob_url) URL.revokeObjectURL(blob_url)
    }
  }
}
if (vscode_api) install_cross_origin_worker_shim()
let current_app: MatterVizApp | null = null
let file_change_listener_registered = false
let file_change_generation = 0
let file_change_queue: Promise<void> = Promise.resolve()
let viewer_disposed = false
let viewer_lifecycle_generation = 0
let active_parse_controller: AbortController | null = null
const replace_parse_controller = (): AbortController => {
  active_parse_controller?.abort()
  return (active_parse_controller = new AbortController())
}
const global_window = globalThis as unknown as Window
const is_current_file_change = (generation: number): boolean =>
  !viewer_disposed && generation === file_change_generation
const is_current_lifecycle = (generation: number): boolean =>
  !viewer_disposed && generation === viewer_lifecycle_generation

// Set up VSCode-specific download override for file exports
export const setup_vscode_download = (): void => {
  if (!vscode_api) return
  global_window.download = (data: string | Blob, filename: string): void => {
    if (!filename?.trim()) {
      console.error(`Invalid filename provided to download`)
      return
    }

    const send_message = (content: string, is_binary: boolean) => {
      vscode_api?.postMessage({
        command: `saveAs`,
        content,
        filename,
        is_binary,
      })
    }

    try {
      if (typeof data === `string`) {
        send_message(data, false)
      } else {
        const reader = new FileReader()
        reader.addEventListener(`load`, () => send_message(reader.result as string, true))
        reader.addEventListener(`error`, () => {
          console.error(`Failed to read binary data for download`)
          vscode_api?.postMessage({
            command: `error`,
            text: `Failed to read binary data for download`,
          })
        })
        reader.readAsDataURL(data)
      }
    } catch (error) {
      console.error(`VSCode download failed:`, error)
      vscode_api?.postMessage({
        command: `error`,
        text: `Download failed: ${error}`,
      })
    }
  }
}

// Runs behind mounted trajectory displays: a worker-served run holds a worker and a port, a
// host-served one a message listener, so unmounting the display must dispose it too
const display_runs = new WeakMap<MatterVizApp, TrajectoryRun>()

export const unmount_display = async (app: MatterVizApp): Promise<void> => {
  display_runs.get(app)?.dispose()
  display_runs.delete(app)
  await unmount(app)
}

// Unmount the existing component before replacement to prevent memory leaks.
async function unmount_current_app(): Promise<void> {
  const app = current_app
  current_app = null
  if (app) await unmount_display(app)
}

// Handle file change events from extension
const handle_file_change = async (
  message: FileChangeMessage,
  generation: number,
  signal: AbortSignal,
): Promise<void> => {
  if (!is_current_file_change(generation)) return
  if (message.command === `fileDeleted`) {
    // File was deleted - show error message
    await unmount_current_app()
    if (!is_current_file_change(generation)) return
    const container = document.querySelector<HTMLElement>(`#matterviz-app`)
    if (container) {
      container.innerHTML = `
        <div style="padding: 2rem; text-align: center; color: var(--vscode-errorForeground);">
          <h2>File Deleted</h2>
          <p>The file "${escape_html(message.file_path)}" has been deleted.</p>
        </div>
      `
    }
    return
  }

  try {
    if (message.theme && is_valid_theme_name(message.theme)) {
      apply_theme_to_dom(message.theme)
    }

    const result = await parse_file_data(message.data, signal)
    if (!is_current_file_change(generation)) return

    const container = document.querySelector<HTMLElement>(`#matterviz-app`)
    if (container) {
      await unmount_current_app()
      if (!is_current_file_change(generation)) return
      current_app = create_display(container, result)
    }

    vscode_api?.postMessage({ command: `info`, text: `File reloaded successfully` })
  } catch (error) {
    if (!is_current_file_change(generation)) return
    console.error(`Failed to reload file:`, error)
    vscode_api?.postMessage({
      command: `error`,
      text: `Failed to reload file: ${error}`,
    })
  }
}

const process_file_change = (message: FileChangeMessage): void => {
  if (viewer_disposed) return
  const generation = ++file_change_generation
  const controller = replace_parse_controller()
  file_change_queue = file_change_queue
    .then(() => handle_file_change(message, generation, controller.signal))
    .catch((error: unknown) => {
      if (!is_current_file_change(generation)) return
      console.error(`Failed to process file change:`, error)
      vscode_api?.postMessage({
        command: `error`,
        text: `Failed to process file change: ${error}`,
      })
    })
}

// Host settings (VS Code matterviz.trajectory.*) reach the parser here; everything else about
// loading is decided by open_trajectory from DEFAULTS
const parse_file_data = (
  { content, filename, is_base64 }: FileData,
  signal: AbortSignal,
): Promise<ParseResult> => {
  const { index_above_bytes } = merge(globalThis.matterviz_data?.defaults).trajectory
  return parse_in_worker(content, filename, is_base64, {
    signal,
    load_options: { index_above_bytes },
  })
}

// Create error display in container
const create_error_display = (
  container: HTMLElement,
  error: Error,
  filename: string,
): void => {
  // Fall back to MatterViz theme tokens (not VS Code dark hex): Hive and other
  // non-VS Code hosts apply --page-bg/--text-color and leave --vscode-* unset.
  container.innerHTML = `
    <div style="padding: 20px; text-align: center;
                background: var(--vscode-editor-background, var(--page-bg, Canvas));
                color: var(--vscode-editor-foreground, var(--text-color, CanvasText));
                height: 100%;
                display: flex; flex-direction: column; justify-content: center; align-items: center;">
      <div style="font-size: 48px; margin-bottom: 20px;">❌</div>
      <h2 style="margin: 0 0 15px 0; color: var(--error-color, var(--vscode-errorForeground, #f85149));">Failed to Parse File</h2>
      <div style="background: color-mix(in srgb, currentColor 8%, transparent); padding: 20px; border-radius: 8px; max-width: 600px;">
        <p style="margin: 0 0 10px 0;"><strong>File:</strong> ${escape_html(filename)}</p>
        <p style="margin: 0 0 10px 0;"><strong>Error:</strong> ${escape_html(error.message)}</p>
        <p style="margin: 0; font-size: 14px; opacity: 0.8;">
          Supported formats: XYZ, CIF, JSON, POSCAR, trajectory files (.traj, .h5, .extxyz), etc.
        </p>
      </div>
    </div>`
}

// Mount Svelte component and create display
export const create_display = (
  container: HTMLElement,
  result: ParseResult,
  display_options?: DisplayOptions,
): MatterVizApp => {
  const { filename } = result
  // Prefer VS Code tokens when present; otherwise MatterViz theme vars so Hive
  // light mode is not stuck on the old dark hex fallbacks.
  Object.assign(container.style, {
    width: `100%`,
    height: `100%`,
    position: `absolute`,
    top: `0`,
    left: `0`,
    right: `0`,
    bottom: `0`,
    background: `var(--vscode-editor-background, var(--page-bg, var(--surface-bg, Canvas)))`,
    color: `var(--vscode-editor-foreground, var(--text-color, CanvasText))`,
    overflow: `hidden`,
  })
  container.innerHTML = ``

  // Get defaults and create props
  const defaults = merge(globalThis.matterviz_data?.defaults)
  const common_props = { style: `height: 100%; border-radius: 0`, fullscreen_toggle: false }
  // Only viewers with a drop zone declare allow_file_drop; elsewhere it would land on the div
  const no_file_drop = { ...common_props, allow_file_drop: false }
  const embedded_structure_props = {
    ...structure_props(defaults),
    ...no_file_drop,
    persist_settings: false,
  }

  let app: MatterVizApp
  let log_message: string

  if (result.type === `trajectory`) {
    const final_trajectory = result.data as TrajectoryRun

    const { initial_step_idx, on_step_change, on_trajectory_controller } =
      display_options ?? {}
    const trajectory_mount_props = {
      trajectory: final_trajectory,
      ...trajectory_props(defaults),
      ...common_props,
      ...(initial_step_idx !== undefined && { current_step_idx: initial_step_idx }),
      ...(on_step_change && {
        on_step_change: (data: TrajHandlerData) =>
          on_step_change(data.step_idx ?? 0, data.frame_count ?? 0),
      }),
      on_controller: on_trajectory_controller,
    }
    // vaspout.h5 files carrying results/electron_dos get a DOS panel below the trajectory
    const traj_electronic = final_trajectory.metadata?.electronic as
      | VaspoutElectronicData
      | undefined
    if (traj_electronic?.dos) {
      app = mount(TrajectoryWithDos, {
        target: container,
        props: { dos: traj_electronic.dos, trajectory_props: trajectory_mount_props },
      })
    } else {
      app = mount(Trajectory, { target: container, props: trajectory_mount_props })
    }
    display_runs.set(app, final_trajectory)
    log_message = `Trajectory rendered: ${filename} (${final_trajectory.frame_count} frames)`
  } else if (result.type === `vaspout_electronic`) {
    const { dos, bands } = result.data as VaspoutElectronicData
    const spectral_props = { style: `height: 100%`, class: `vaspout-electronic` }
    if (bands && dos) {
      app = mount(BandsAndDos, {
        target: container,
        props: {
          band_structs: bands,
          doses: dos,
          bands_props: { band_type: `electronic` as const },
          ...spectral_props,
        },
      })
    } else if (bands) {
      app = mount(Bands, {
        target: container,
        props: { band_structs: bands, band_type: `electronic` as const, ...spectral_props },
      })
    } else {
      app = mount(Dos, {
        target: container,
        props: { doses: dos as DosInput, ...spectral_props },
      })
    }
    const parts = [bands ? `bands` : null, dos ? `DOS` : null].filter(Boolean).join(` + `)
    log_message = `Electronic structure rendered: ${filename} (${parts})`
  } else if (result.type === `fermi_surface`) {
    const props: Record<string, unknown> = { ...no_file_drop }
    if (is_fermi_surface_data(result.data as Parameters<typeof is_fermi_surface_data>[0])) {
      props.fermi_data = result.data
    } else props.band_data = result.data
    app = mount(FermiSurface, { target: container, props })
    log_message = `Fermi surface rendered: ${filename}`
  } else if (result.type === `isosurface`) {
    // VolumetricFileData has structure + volumes; render via Structure with volumetric_data
    const vol_file = result.data as { structure: AnyStructure; volumes: VolumetricData[] }
    app = mount(Structure, {
      target: container,
      props: {
        structure: vol_file.structure,
        volumetric_data: vol_file.volumes,
        ...embedded_structure_props,
      },
    })
    log_message = `Volumetric data rendered: ${filename}`
  } else if (result.type === `convex_hull`) {
    const entries = result.data as PhaseData[]
    app = mount(ConvexHull, { target: container, props: { entries, ...no_file_drop } })
    log_message = `Convex hull rendered: ${filename} (${entries.length} entries)`
  } else if (result.type === `phase_diagram`) {
    app = mount(IsobaricBinaryPhaseDiagram, {
      target: container,
      props: { data: result.data as PhaseDiagramData, ...common_props },
    })
    log_message = `Phase diagram rendered: ${filename}`
  } else if (result.type === `json_browser`) {
    app = mount(JsonBrowser, {
      target: container,
      props: { value: result.data, defaults, filename },
    })
    log_message = `JSON browser opened: ${filename}`
  } else {
    // Default: structure
    const structure = result.data as AnyStructure
    app = mount(Structure, {
      target: container,
      props: { structure, ...embedded_structure_props },
    })
    log_message = `Structure rendered: ${filename} (${structure.sites?.length ?? 0} sites)`
  }

  vscode_api?.postMessage({ command: `info`, text: log_message })
  return app
}

// Map defaults to trajectory component props
const trajectory_props = (defaults: DefaultSettings) => {
  const { trajectory, plot, scatter, histogram } = defaults
  // Settings every plot kind honours, so adding one does not have to be remembered twice
  const shared_plot_props = {
    show_grid: plot.grid_lines,
    show_axis_labels: plot.axis_labels,
  }
  // Loading/UX settings belong to TrajectoryFileViewer, not the viewer mounted here; spreading
  // them would land on the wrapper div
  const {
    index_above_bytes: _index_above_bytes,
    allow_file_drop: _allow_file_drop,
    ...trajectory_component_props
  } = trajectory
  return {
    ...trajectory_component_props,
    structure_props: { ...structure_props(defaults), persist_settings: false },
    scatter_props: {
      markers: scatter.symbol_type,
      line_width: scatter.line.width,
      point_size: scatter.point.size,
      show_legend: legend_mode_to_prop(scatter.show_legend),
      ...shared_plot_props,
    },
    histogram_props: {
      mode: histogram.mode,
      show_legend: legend_mode_to_prop(histogram.show_legend),
      bin_count: histogram.bin_count,
      ...shared_plot_props,
    },
    property_labels: {},
  }
}

// Initialize the MatterViz application from data passed by the extension
async function initialize(lifecycle_generation: number): Promise<MatterVizApp | null> {
  const file_data = globalThis.matterviz_data?.data
  const theme = globalThis.matterviz_data?.theme
  const moyo_wasm_url = globalThis.matterviz_data?.moyo_wasm_url
  if (!file_data?.content || !file_data.filename) {
    throw new Error(`No data provided to MatterViz app`)
  }

  // Initialize WASM early with URL from extension (for symmetry analysis)
  if (moyo_wasm_url) await ensure_moyo_wasm_ready(moyo_wasm_url)
  if (!is_current_lifecycle(lifecycle_generation)) return null

  setup_vscode_download()
  if (theme) apply_theme_to_dom(theme)

  const container = document.querySelector<HTMLElement>(`#matterviz-app`)
  if (!container) throw new Error(`Target container not found in DOM`)

  const controller = replace_parse_controller()
  const result = await parse_file_data(file_data, controller.signal)
  if (!is_current_lifecycle(lifecycle_generation)) return null
  const app = create_display(container, result)

  // Store the app instance for file watching
  current_app = app

  // Listen for file change messages from extension
  if (vscode_api && !file_change_listener_registered) {
    globalThis.addEventListener(`message`, (event) => {
      if ([`fileUpdated`, `fileDeleted`].includes(event.data.command)) {
        process_file_change(event.data)
      }
    })
    file_change_listener_registered = true
  }

  return app
}

// Cleanup function to properly dispose of components
async function cleanup_matterviz(): Promise<void> {
  viewer_disposed = true
  active_parse_controller?.abort()
  active_parse_controller = null
  file_change_generation++
  viewer_lifecycle_generation++
  file_change_queue = Promise.resolve()
  await unmount_current_app()
}

// Export initialization and cleanup functions to global scope
global_window.initializeMatterViz = async (): Promise<MatterVizApp | null> => {
  if (!globalThis.matterviz_data) {
    console.warn(`No matterviz_data found on window`)
    return null
  }

  viewer_disposed = false
  const lifecycle_generation = ++viewer_lifecycle_generation
  try {
    // initialize() already records the app in current_app
    return await initialize(lifecycle_generation)
  } catch (error) {
    if (!is_current_lifecycle(lifecycle_generation)) return null
    const err = to_error(error)
    const container = document.querySelector<HTMLElement>(`#matterviz-app`)
    if (container) {
      create_error_display(
        container,
        err,
        globalThis.matterviz_data?.data?.filename || `Unknown file`,
      )
    }
    vscode_api?.postMessage({
      command: `error`,
      text: `Error rendering ${
        globalThis.matterviz_data?.data?.filename || `Unknown file`
      }: ${err.message}`,
    })
    return null
  }
}
global_window.cleanupMatterViz = cleanup_matterviz
