// VS Code's webview postMessage API takes a single argument (no targetOrigin),
// so unicorn's require-post-message-target-origin is a false positive here.
// oxlint-disable eslint-plugin-unicorn/require-post-message-target-origin

// Import MatterViz parsing functions and components
// oxlint-disable-next-line eslint-plugin-import/no-unassigned-import -- side-effect only
import '$lib/app.css'
import type { PhaseData } from '$lib/convex-hull/types'
import { legend_mode_to_prop } from '$lib/plot/core/utils/series-visibility'
import { merge, build_structure_props_from_settings as structure_props } from '$lib/settings'
import type { DefaultSettings } from '$lib/settings'
import type { DosInput } from '$lib/spectral'
import Bands from '$lib/spectral/Bands.svelte'
import BandsAndDos from '$lib/spectral/BandsAndDos.svelte'
import Dos from '$lib/spectral/Dos.svelte'
import type { AnyStructure } from '$lib/structure'
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
import type {
  FileChangeMessage,
  FileData,
  SettingsChangedMessage,
  WebviewBootstrapData,
} from './host-protocol'
import JsonBrowser from './JsonBrowser.svelte'
import { mount_viewer, type ViewerMountType } from './mount-viewer'
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
// The parse result behind current_app: a host settings change remounts it with the new
// defaults instead of re-parsing (or the host re-reading the file from disk)
let current_result: ParseResult | null = null
// Set when the bootstrap parse/mount threw and the error display is on screen, so a later
// host settings change re-attempts the display instead of finding nothing to remount
let initial_display_failed = false
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
  current_result = null
  if (app) await unmount_display(app)
}

const mount_result = (container: HTMLElement, result: ParseResult): void => {
  current_app = create_display(container, result)
  current_result = result
}

// Re-apply theme and defaults from the host to the view already on screen. Only a defaults
// change remounts (theme is pure CSS), and the remount reuses the parsed result, so an
// unsaved editor buffer rendered via fileUpdated survives and a host-served run stays open.
const handle_settings_change = async (
  { theme, defaults }: SettingsChangedMessage,
  lifecycle_generation: number,
): Promise<void> => {
  if (!is_current_lifecycle(lifecycle_generation)) return
  const bootstrap = globalThis.matterviz_data
  if (is_valid_theme_name(theme)) {
    apply_theme_to_dom(theme)
    // initialize() re-reads the theme from the bootstrap on re-init
    if (bootstrap) bootstrap.theme = theme
  }
  // A message without defaults (a host that only pushes theme) must not reset to DEFAULTS
  const defaults_changed =
    bootstrap !== undefined &&
    defaults !== undefined &&
    JSON.stringify(bootstrap.defaults) !== JSON.stringify(defaults)
  if (defaults_changed) bootstrap.defaults = defaults
  const container = document.querySelector<HTMLElement>(`#matterviz-app`)
  // The bootstrap display failed (parse or mount threw) and its error is on screen: there is
  // nothing to remount, so re-attempt from the bootstrap payload the way the host's old
  // HTML rebuild did (the new defaults may be exactly what the parse needed)
  if (initial_display_failed) {
    if (container && bootstrap?.data) {
      await display_bootstrap_file(container, bootstrap.data, lifecycle_generation)
    }
    return
  }
  if (!defaults_changed) return
  const app = current_app
  const result = current_result
  if (!container || !app || !result) return
  current_app = null
  // Keep the run alive for the remount; once detached from display_runs, cleanup can no
  // longer dispose it, so a lifecycle that ends mid-remount must dispose it here
  const run = display_runs.get(app)
  display_runs.delete(app)
  await unmount(app)
  if (!is_current_lifecycle(lifecycle_generation)) {
    run?.dispose()
    return
  }
  // create_display re-registers the run in display_runs; if it throws, nothing else owns it
  try {
    mount_result(container, result)
  } catch (error) {
    run?.dispose()
    throw error
  }
}

const process_settings_change = (message: SettingsChangedMessage): void => {
  if (viewer_disposed) return
  const lifecycle_generation = viewer_lifecycle_generation
  // Serialized behind pending file changes so a remount never races a reload
  file_change_queue = file_change_queue
    .then(() => handle_settings_change(message, lifecycle_generation))
    .catch((error: unknown) => {
      console.error(`Failed to apply host settings:`, error)
      vscode_api?.postMessage({ command: `error`, text: `Failed to apply settings: ${error}` })
    })
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
      mount_result(container, result)
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

// Human-readable names for the single-viewer ParseResult types in the host info log
const VIEWER_LOG_LABELS: Record<Extract<ParseResult[`type`], ViewerMountType>, string> = {
  structure: `Structure`,
  fermi_surface: `Fermi surface`,
  isosurface: `Volumetric data`,
  convex_hull: `Convex hull`,
  phase_diagram: `Phase diagram`,
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
  } else if (result.type === `json_browser`) {
    app = mount(JsonBrowser, {
      target: container,
      props: { value: result.data, defaults, filename },
    })
    log_message = `JSON browser opened: ${filename}`
  } else {
    // Single-viewer results share the dispatch table with JsonBrowser panels
    app = mount_viewer(container, result.type, result.data, { defaults })
    const detail =
      result.type === `convex_hull`
        ? ` (${(result.data as PhaseData[]).length} entries)`
        : result.type === `structure`
          ? ` (${(result.data as AnyStructure).sites?.length ?? 0} sites)`
          : ``
    log_message = `${VIEWER_LOG_LABELS[result.type]} rendered: ${filename}${detail}`
  }

  vscode_api?.postMessage({ command: `info`, text: log_message })
  return app
}

// Map defaults to trajectory component props
const trajectory_props = (defaults: DefaultSettings) => {
  const { trajectory, plot, scatter, histogram } = defaults
  // Loading/UX settings belong to TrajectoryFileViewer, not the viewer mounted here; spreading
  // them would land on the wrapper div
  const {
    index_above_bytes: _index_above_bytes,
    allow_file_drop: _allow_file_drop,
    ...trajectory_component_props
  } = trajectory
  // Every key below is a declared ScatterPlot/Histogram prop; anything else would be spread
  // onto the plot's wrapper div as an unknown HTML attribute
  const { show_points, show_lines, point, line, symbol_type } = scatter
  return {
    ...trajectory_component_props,
    structure_props: { ...structure_props(defaults), persist_settings: false },
    scatter_props: {
      display: plot.display,
      // matterviz.scatter.symbol_type is the marker shape for every point without its own
      styles: { show_points, show_lines, point: { ...point, symbol_type }, line },
      show_legend: legend_mode_to_prop(scatter.show_legend),
    },
    histogram_props: {
      display: plot.display,
      bins: histogram.bin_count,
      normalize: histogram.normalize,
      mode: histogram.mode,
      bar: histogram.bar,
      show_legend: legend_mode_to_prop(histogram.show_legend),
    },
    property_labels: {},
  }
}

// Parse the bootstrap file and mount it; on failure show the error display, report it to the
// host and remember the failure so a later settings change can retry
const display_bootstrap_file = async (
  container: HTMLElement,
  file_data: FileData,
  lifecycle_generation: number,
): Promise<void> => {
  const controller = replace_parse_controller()
  try {
    const result = await parse_file_data(file_data, controller.signal)
    if (!is_current_lifecycle(lifecycle_generation)) return
    mount_result(container, result)
    initial_display_failed = false
  } catch (error) {
    if (!is_current_lifecycle(lifecycle_generation)) return
    report_display_error(container, to_error(error))
  }
}

const report_display_error = (container: HTMLElement | null, err: Error): void => {
  initial_display_failed = true
  const filename = globalThis.matterviz_data?.data?.filename
  const label = filename?.trim() ? filename : `Unknown file`
  if (container) create_error_display(container, err, label)
  vscode_api?.postMessage({
    command: `error`,
    text: `Error rendering ${label}: ${err.message}`,
  })
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

  await display_bootstrap_file(container, file_data, lifecycle_generation)
  if (!is_current_lifecycle(lifecycle_generation)) return null

  // Listen for file change and settings messages from the host
  if (vscode_api && !file_change_listener_registered) {
    globalThis.addEventListener(`message`, (event) => {
      const command = event.data?.command
      if ([`fileUpdated`, `fileDeleted`].includes(command)) process_file_change(event.data)
      else if (command === `settingsChanged`) process_settings_change(event.data)
    })
    file_change_listener_registered = true
  }

  return current_app
}

// Cleanup function to properly dispose of components
async function cleanup_matterviz(): Promise<void> {
  viewer_disposed = true
  active_parse_controller?.abort()
  active_parse_controller = null
  file_change_generation++
  viewer_lifecycle_generation++
  initial_display_failed = false
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
  initial_display_failed = false
  const lifecycle_generation = ++viewer_lifecycle_generation
  try {
    // initialize() already records the app in current_app
    return await initialize(lifecycle_generation)
  } catch (error) {
    if (!is_current_lifecycle(lifecycle_generation)) return null
    report_display_error(
      document.querySelector<HTMLElement>(`#matterviz-app`),
      to_error(error),
    )
    return null
  }
}
global_window.cleanupMatterViz = cleanup_matterviz
