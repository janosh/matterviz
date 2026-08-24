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
import { TYPE_LABELS } from './detect'
import { mount_viewer } from './mount-viewer'
import type { ParseResult, TrajectoryLoadOptions } from './parse'
import { parse_in_worker } from './parse-in-worker'
import { escape_html, is_plain_object, to_error } from '$lib/utils'

export type { VSCodeAPI } from './host-bridge'

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

// The host's bootstrap script inlines `window.matterviz_data = ...` and calls the two
// lifecycle functions this module installs below
declare global {
  var matterviz_data: WebviewBootstrapData | undefined
  var initializeMatterViz: (() => Promise<MatterVizApp | null>) | undefined
  var cleanupMatterViz: (() => Promise<void>) | undefined
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
// Display state, with the invariant current_result ⇒ current_app ⇒ current_file:
// - current_file: the file the host last asked to show (bootstrap payload or a fileUpdated
//   body); null after fileDeleted/cleanup
// - current_result: its parsed form, kept so a host settings change remounts with the new
//   defaults instead of re-parsing (or the host re-reading the file from disk). Null from the
//   moment a new file or remount is requested until its mount succeeds, so after a failed parse
//   or mount a settings change re-parses current_file instead (the new defaults may be exactly
//   what the parse needed)
// - current_app: the mounted component; outlives current_result after a failed reload so the
//   previous file stays on screen
let current_app: MatterVizApp | null = null
let current_result: ParseResult | null = null
let current_file: FileData | null = null
// Bumped on init, cleanup and every host file change; in-flight work captures the value it
// started under and bails once superseded (a stale parse, a remount after cleanup, ...)
let generation = 0
// Host messages are handled one at a time so a settings remount never races a reload
let work_queue: Promise<void> = Promise.resolve()
let active_parse_controller: AbortController | null = null
// Removed on cleanup so no host message reaches a torn-down viewer
let message_listener: AbortController | null = null
const replace_parse_controller = (): AbortController => {
  active_parse_controller?.abort()
  return (active_parse_controller = new AbortController())
}
const is_current = (gen: number): boolean => gen === generation
const get_container = (): HTMLElement | null =>
  document.querySelector<HTMLElement>(`#matterviz-app`)
// Tell the host (VS Code shows `error` as a toast and logs `info` to its output channel); a
// no-op outside a host
const post_to_host = (command: `info` | `error`, text: string): void => {
  vscode_api?.postMessage({ command, text })
}

// Route `download` ($lib/io/fetch checks for this global override) through the host's save dialog
export const setup_vscode_download = (): void => {
  if (!vscode_api) return
  const download = (data: string | Blob, filename: string): void => {
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
          post_to_host(`error`, `Failed to read binary data for download`)
        })
        reader.readAsDataURL(data)
      }
    } catch (error) {
      console.error(`VSCode download failed:`, error)
      post_to_host(`error`, `Download failed: ${error}`)
    }
  }
  Object.assign(globalThis, { download })
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

// Run `task` after the queued host work, unless the viewer moved on in the meantime; a
// failure is reported to the host under `failure_label`
const enqueue = (gen: number, task: () => Promise<void>, failure_label: string): void => {
  work_queue = work_queue
    .then(() => (is_current(gen) ? task() : undefined))
    .catch((error: unknown) => {
      if (!is_current(gen)) return
      console.error(`${failure_label}:`, error)
      post_to_host(`error`, `${failure_label}: ${error}`)
    })
}

// Parse `file_data` and show it: the bootstrap render, host file reloads and the
// settings-change retry all go through here. On failure the previous display (if any) stays
// up, otherwise the error display replaces it; either way the host is told
const display_file = async (
  container: HTMLElement,
  file_data: FileData,
  gen: number,
  signal: AbortSignal,
): Promise<void> => {
  current_file = file_data
  current_result = null // whatever is on screen is no longer the host's file
  try {
    const result = await parse_file_data(file_data, signal)
    if (!is_current(gen)) return
    await unmount_current_app()
    if (!is_current(gen)) return
    mount_result(container, result)
  } catch (error) {
    if (is_current(gen)) report_display_error(container, to_error(error), file_data.filename)
  }
}

// Rebuild the display from the parsed result under the current defaults, without re-parsing,
// so an unsaved editor buffer rendered via fileUpdated survives and a host-served run stays open
const remount_current = async (container: HTMLElement, gen: number): Promise<void> => {
  const app = current_app
  const result = current_result
  if (!app || !result) return
  // Detached until mount_result re-registers them for the new app: the run behind a trajectory
  // display must outlive the unmount, and until then nothing else owns it
  current_app = null
  current_result = null
  const run = display_runs.get(app)
  display_runs.delete(app)
  await unmount(app)
  if (!is_current(gen)) {
    run?.dispose()
    return
  }
  try {
    mount_result(container, result)
  } catch (error) {
    run?.dispose()
    report_display_error(container, to_error(error), result.filename)
  }
}

// Theme and defaults apply immediately (a queued reload then mounts with them); only the
// display update waits its turn. Only a defaults change touches the display (theme is pure
// CSS and cannot affect a parse either), and a message without defaults (a host that only
// pushes theme) must not reset to DEFAULTS
const process_settings_change = ({ theme, defaults }: SettingsChangedMessage): void => {
  const bootstrap = globalThis.matterviz_data
  if (is_valid_theme_name(theme)) {
    apply_theme_to_dom(theme)
    // initialize() re-reads the theme from the bootstrap on re-init
    if (bootstrap) bootstrap.theme = theme
  }
  const defaults_changed =
    bootstrap !== undefined &&
    defaults !== undefined &&
    JSON.stringify(bootstrap.defaults) !== JSON.stringify(defaults)
  if (!defaults_changed) return
  bootstrap.defaults = defaults
  const gen = generation
  enqueue(
    gen,
    async () => {
      const container = get_container()
      if (!container) return
      if (current_result) await remount_current(container, gen)
      else if (current_file) {
        await display_file(container, current_file, gen, replace_parse_controller().signal)
      }
    },
    `Failed to apply settings`,
  )
}

// A newer file change supersedes any pending one: its parse is aborted and its handler bails
const process_file_change = (message: FileChangeMessage): void => {
  const gen = ++generation
  const { signal } = replace_parse_controller()
  enqueue(
    gen,
    async () => {
      const container = get_container()
      if (message.command === `fileDeleted`) {
        current_file = null
        await unmount_current_app()
        if (!is_current(gen) || !container) return
        container.innerHTML = `
          <div style="padding: 2rem; text-align: center; color: var(--vscode-errorForeground);">
            <h2>File Deleted</h2>
            <p>The file "${escape_html(message.file_path)}" has been deleted.</p>
          </div>
        `
        return
      }
      if (message.theme && is_valid_theme_name(message.theme))
        apply_theme_to_dom(message.theme)
      if (container) await display_file(container, message.data, gen, signal)
    },
    `Failed to process file change`,
  )
}

// Host settings (VS Code matterviz.trajectory.*) reach the parser here; everything else about
// loading is decided by open_trajectory from DEFAULTS
const parse_file_data = (
  { content, filename, is_base64 }: FileData,
  signal: AbortSignal,
): Promise<ParseResult> => {
  const { index_above_bytes, atom_type_mapping } = merge(
    globalThis.matterviz_data?.defaults,
  ).trajectory
  // An empty map (or a settings.json `null`, which merge() passes through) is "not
  // configured": the LAMMPS reader then guesses and warns as usual
  const load_options: TrajectoryLoadOptions = { index_above_bytes }
  if (is_plain_object(atom_type_mapping) && Object.keys(atom_type_mapping).length > 0) {
    load_options.atom_type_mapping = atom_type_mapping
  }
  return parse_in_worker(content, filename, is_base64, { signal, load_options })
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
    // isosurface is the mounted form of the `volumetric` JSON shape
    const label = TYPE_LABELS[result.type === `isosurface` ? `volumetric` : result.type]
    log_message = `${label} rendered: ${filename}${detail}`
  }

  post_to_host(`info`, log_message)
  return app
}

// Map defaults to trajectory component props
const trajectory_props = (defaults: DefaultSettings) => {
  const { trajectory, plot, scatter, histogram } = defaults
  // Loading/UX settings belong to TrajectoryFileViewer, not the viewer mounted here; spreading
  // them would land on the wrapper div
  const {
    index_above_bytes: _index_above_bytes,
    atom_type_mapping: _atom_type_mapping,
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

// Tell the host; a failed reload keeps the previous display, otherwise the error replaces it
const report_display_error = (
  container: HTMLElement | null,
  err: Error,
  filename: string | undefined,
): void => {
  const label = filename?.trim() ? filename : `Unknown file`
  if (container && !current_app) create_error_display(container, err, label)
  post_to_host(`error`, `Error rendering ${label}: ${err.message}`)
}

// Host file-change and settings messages go through the work queue like the bootstrap display,
// so none of them can race it. Registered before anything that can fail, so a bootstrap that
// throws (no data, no container) still leaves a webview the host can reload into
const listen_to_host = (): void => {
  if (!vscode_api || message_listener) return
  message_listener = new AbortController()
  globalThis.addEventListener(
    `message`,
    (event) => {
      const command = event.data?.command
      if ([`fileUpdated`, `fileDeleted`].includes(command)) process_file_change(event.data)
      else if (command === `settingsChanged`) process_settings_change(event.data)
    },
    { signal: message_listener.signal },
  )
}

// Initialize the MatterViz application from data passed by the extension
async function initialize(gen: number): Promise<MatterVizApp | null> {
  listen_to_host()
  const file_data = globalThis.matterviz_data?.data
  const theme = globalThis.matterviz_data?.theme
  const moyo_wasm_url = globalThis.matterviz_data?.moyo_wasm_url
  if (!file_data?.content || !file_data.filename) {
    throw new Error(`No data provided to MatterViz app`)
  }

  // Initialize WASM early with URL from extension (for symmetry analysis)
  if (moyo_wasm_url) await ensure_moyo_wasm_ready(moyo_wasm_url)
  if (!is_current(gen)) return null

  setup_vscode_download()
  if (theme) apply_theme_to_dom(theme)

  const container = get_container()
  if (!container) throw new Error(`Target container not found in DOM`)

  // Queued so a settings change arriving mid-parse waits for the mount (and then remounts it)
  // instead of starting a second parse that aborts this one
  enqueue(
    gen,
    () => display_file(container, file_data, gen, replace_parse_controller().signal),
    `Failed to display file`,
  )
  await work_queue
  return is_current(gen) ? current_app : null
}

// Cleanup function to properly dispose of components
async function cleanup_matterviz(): Promise<void> {
  generation++
  message_listener?.abort()
  message_listener = null
  active_parse_controller?.abort()
  active_parse_controller = null
  work_queue = Promise.resolve()
  current_file = null
  await unmount_current_app()
}

globalThis.initializeMatterViz = async (): Promise<MatterVizApp | null> => {
  if (!globalThis.matterviz_data) {
    console.warn(`No matterviz_data found on window`)
    return null
  }

  const gen = ++generation
  try {
    // initialize() already records the app in current_app
    return await initialize(gen)
  } catch (error) {
    if (!is_current(gen)) return null
    report_display_error(
      get_container(),
      to_error(error),
      globalThis.matterviz_data.data?.filename,
    )
    return null
  }
}
globalThis.cleanupMatterViz = cleanup_matterviz
