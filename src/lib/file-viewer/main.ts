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
import { type DefaultSettings, merge } from '$lib/settings'
import type { DosInput } from '$lib/spectral'
import Bands from '$lib/spectral/Bands.svelte'
import BandsAndDos from '$lib/spectral/BandsAndDos.svelte'
import Dos from '$lib/spectral/Dos.svelte'
import type { AnyStructure } from '$lib/structure'
import Structure from '$lib/structure/Structure.svelte'
import { ensure_moyo_wasm_ready } from '$lib/symmetry'
import { apply_theme_to_dom, is_valid_theme_name, type ThemeName } from '$lib/theme/index'
// oxlint-disable-next-line eslint-plugin-import/no-unassigned-import -- side-effect only
import '$lib/theme/themes.mjs'
import type {
  FrameIndex,
  FrameLoader,
  TrajectoryFrame,
  TrajectoryMetadata,
  TrajectoryType,
  TrajHandlerData,
} from '$lib/trajectory'
import type { VaspoutElectronicData } from '$lib/trajectory/parse/vaspout-electronic'
import Trajectory from '$lib/trajectory/Trajectory.svelte'
import { mount, unmount } from 'svelte'
import TrajectoryWithDos from './TrajectoryWithDos.svelte'
import { structure_props } from './detect'
import JsonBrowser from './JsonBrowser.svelte'
import type { FileData, ParsedTrajectoryResponse, ParseResult } from './parse'
import { parse_file_content, set_large_file_requester } from './parse'
import { escape_html, to_error } from '$lib/utils'

export interface MatterVizData {
  data: FileData
  theme: ThemeName
  defaults?: DefaultSettings
  moyo_wasm_url?: string
}

export interface MatterVizApp {
  $on?(type: string, callback: (event: Event) => void): () => void
  $set?(props: Partial<Record<string, unknown>>): void
}

// Host-provided options for create_display. Only the trajectory branch consumes
// them (viewer position restore across reloads); other result types ignore them.
export interface DisplayOptions {
  // Initial frame to show. Out-of-range values (e.g. Number.MAX_SAFE_INTEGER)
  // are clamped by the Trajectory component to the last frame.
  initial_step_idx?: number
  // Reports every step change with the new index and the trajectory's frame count.
  on_step_change?: (step_idx: number, total_frames: number) => void
}

export interface FileChangeMessage {
  command: `fileUpdated` | `fileDeleted`
  file_path?: string
  data?: FileData
  theme?: ThemeName
}

// Shared postMessage request/response plumbing for talking to the extension
// host: tags the request with a UUID, forwards responses carrying that id to
// on_response (which returns true once it settled the promise), and rejects
// on timeout. Always removes the listener + timer once settled.
function post_request<T>(
  api: VSCodeAPI,
  message: Record<string, unknown>,
  timeout_ms: number,
  timeout_error: string,
  on_response: (
    data: Record<string, unknown>,
    resolve: (value: T) => void,
    reject: (error: Error) => void,
  ) => boolean,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request_id = crypto.randomUUID()
    const timer = setTimeout(() => {
      globalThis.removeEventListener(`message`, handler)
      reject(new Error(timeout_error))
    }, timeout_ms)
    const handler = (event: MessageEvent) => {
      if (event.data?.request_id !== request_id) return
      if (on_response(event.data, resolve, reject)) {
        globalThis.removeEventListener(`message`, handler)
        clearTimeout(timer)
      }
    }
    globalThis.addEventListener(`message`, handler)
    api.postMessage({ ...message, request_id })
  })
}

// VS Code Frame Loader - streams frames via extension communication
export class VSCodeFrameLoader implements FrameLoader {
  constructor(
    private readonly file_path: string,
    private readonly filename: string,
    private readonly vscode_api: VSCodeAPI,
  ) {}

  // Only implement the method we actually use
  async load_frame(
    _data: string | ArrayBuffer,
    frame_index: number,
    timeout: number = 10, // 10 seconds
  ): Promise<TrajectoryFrame | null> {
    const message = {
      command: `request_frame`,
      file_path: this.file_path,
      filename: this.filename,
      frame_index,
    }
    return post_request(
      this.vscode_api,
      message,
      timeout * 1000,
      `Frame ${frame_index} timeout after ${timeout}s`,
      (data, resolve, reject) => {
        if (data.command !== `frame_response`) return false
        if (data.error) reject(new Error(data.error as string))
        else resolve(data.frame as TrajectoryFrame | null)
        return true
      },
    )
  }

  // Unused methods - just throw errors
  async get_total_frames(): Promise<number> {
    throw new Error(`Not implemented`)
  }
  async build_frame_index(): Promise<FrameIndex[]> {
    throw new Error(`Not implemented`)
  }
  async extract_plot_metadata(): Promise<TrajectoryMetadata[]> {
    throw new Error(`Not implemented`)
  }
}

export interface VSCodeAPI {
  postMessage(message: unknown): void
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

  // VSCode webview API
  function acquireVsCodeApi(): VSCodeAPI
}

// Store VSCode API instance to avoid multiple acquisitions
let vscode_api: VSCodeAPI | null = null
let current_app: MatterVizApp | null = null
let file_change_listener_registered = false
let file_change_generation = 0
let file_change_queue: Promise<void> = Promise.resolve()
const global_window = globalThis as unknown as Window

// Initialize VSCode API at module level
try {
  vscode_api = globalThis.acquireVsCodeApi?.() ?? null
} catch (error) {
  console.warn(`VSCode API already acquired or not available:`, error)
  vscode_api = null
}

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

// Unmount the existing component before replacement to prevent memory leaks.
async function unmount_current_app(): Promise<void> {
  const app = current_app
  current_app = null
  if (app) await unmount(app)
}

// Handle file change events from extension
const handle_file_change = async (
  message: FileChangeMessage,
  generation: number,
): Promise<void> => {
  if (generation !== file_change_generation) return
  if (message.command === `fileDeleted`) {
    // File was deleted - show error message
    await unmount_current_app()
    if (generation !== file_change_generation) return
    const container = document.querySelector<HTMLElement>(`#matterviz-app`)
    if (container) {
      container.innerHTML = `
        <div style="padding: 2rem; text-align: center; color: var(--vscode-errorForeground);">
          <h2>File Deleted</h2>
          <p>The file "${escape_html(message.file_path ?? ``)}" has been deleted.</p>
        </div>
      `
    }
    return
  }

  if (!message.data) return
  try {
    if (message.theme && is_valid_theme_name(message.theme)) {
      apply_theme_to_dom(message.theme)
    }

    const { content, filename, is_base64 } = message.data
    const result = await parse_file_content(content, filename, is_base64)
    if (generation !== file_change_generation) return

    // Update the display
    const container = document.querySelector<HTMLElement>(`#matterviz-app`)
    if (container) {
      await unmount_current_app()
      if (generation !== file_change_generation) return
      current_app = create_display(container, result, result.filename)
    }

    vscode_api?.postMessage({ command: `info`, text: `File reloaded successfully` })
  } catch (error) {
    if (generation !== file_change_generation) return
    console.error(`Failed to reload file:`, error)
    vscode_api?.postMessage({
      command: `error`,
      text: `Failed to reload file: ${error}`,
    })
  }
}

const enqueue_file_change = (message: FileChangeMessage): void => {
  const generation = ++file_change_generation
  file_change_queue = file_change_queue
    .then(() => handle_file_change(message, generation))
    .catch((error) => {
      console.error(`Failed to process file change:`, error)
      vscode_api?.postMessage({
        command: `error`,
        text: `Failed to process file change: ${error}`,
      })
    })
}

// Request large file content from the extension using chunked streaming
function request_large_file_content(
  file_path: string,
  filename: string,
  is_base64: boolean,
  timeout: number = 120_000, // large host-side indexing can take longer than eager reads
): Promise<string | ParsedTrajectoryResponse> {
  if (!vscode_api) throw new Error(`VS Code API not available`)

  const message = { command: `request_large_file`, file_path, filename, is_base64 }
  return post_request(
    vscode_api,
    message,
    timeout,
    `Large file timeout`,
    (data, resolve, reject) => {
      if (data.command === `large_file_progress`) {
        // TODO maybe forward file load progress to UI
        console.info(`Progress: ${data.stage} - ${data.progress}%`)
        return false
      }
      if (data.command !== `large_file_response`) return false
      if (data.error) reject(new Error(data.error as string))
      else if (data.is_parsed && data.parsed_trajectory) {
        resolve({ trajectory: data.parsed_trajectory as TrajectoryType, file_path })
      } else resolve(data.content as string)
      return true
    },
  )
}

// Wire the parse path's LARGE_FILE handling to this webview's host transport.
// Registered unconditionally: request_large_file_content itself throws when no
// VS Code API is available, matching the pre-split behavior.
set_large_file_requester(request_large_file_content)

// Create error display in container
const create_error_display = (
  container: HTMLElement,
  error: Error,
  filename: string,
): void => {
  container.innerHTML = `
    <div style="padding: 20px; text-align: center; color: var(--vscode-errorForeground, #f85149);
                background: var(--vscode-editor-background, #1e1e1e); height: 100%;
                display: flex; flex-direction: column; justify-content: center; align-items: center;">
      <div style="font-size: 48px; margin-bottom: 20px;">❌</div>
      <h2 style="margin: 0 0 15px 0;">Failed to Parse File</h2>
      <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px; max-width: 600px;">
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
  filename: string,
  display_options?: DisplayOptions,
): MatterVizApp => {
  Object.assign(container.style, {
    width: `100%`,
    height: `100%`,
    position: `absolute`,
    top: `0`,
    left: `0`,
    right: `0`,
    bottom: `0`,
    background: `var(--vscode-editor-background, #1e1e1e)`,
    color: `var(--vscode-editor-foreground, #d4d4d4)`,
    overflow: `hidden`,
  })
  container.innerHTML = ``

  // Get defaults and create props
  const defaults = merge(globalThis.matterviz_data?.defaults)
  const common_props = {
    allow_file_drop: false,
    style: `height: 100%; border-radius: 0`,
    enable_tips: false,
    fullscreen_toggle: false,
  }

  let app: MatterVizApp
  let log_message: string

  if (result.type === `trajectory`) {
    // Type for trajectory with optional frame loader for streaming
    type StreamingTrajectory = TrajectoryType & { frame_loader?: FrameLoader }

    // Prepare trajectory data for VS Code streaming if supported
    let final_trajectory: TrajectoryType | StreamingTrajectory = result.data as TrajectoryType

    if (vscode_api && result.streaming_info?.file_path) {
      const trajectory = result.data as TrajectoryType
      final_trajectory = {
        ...trajectory,
        is_indexed: true,
        frames: trajectory.frames || [],
        frame_loader: new VSCodeFrameLoader(
          result.streaming_info.file_path,
          filename,
          vscode_api,
        ),
      }
    }

    const { initial_step_idx, on_step_change } = display_options ?? {}
    const trajectory_mount_props = {
      trajectory: final_trajectory,
      ...trajectory_props(defaults),
      ...common_props,
      ...(initial_step_idx !== undefined && { current_step_idx: initial_step_idx }),
      ...(on_step_change && {
        on_step_change: (data: TrajHandlerData) =>
          on_step_change(data.step_idx ?? 0, data.frame_count ?? 0),
      }),
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
    log_message = `Trajectory rendered: ${filename} (${
      final_trajectory.frames?.length ?? 0
    } initial frames, ${final_trajectory.total_frames ?? `unknown`} total)`
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
    const fermi_props: Record<string, unknown> = { ...common_props }
    if (is_fermi_surface_data(result.data as Parameters<typeof is_fermi_surface_data>[0])) {
      fermi_props.fermi_data = result.data
    } else {
      fermi_props.band_data = result.data
    }
    app = mount(FermiSurface, { target: container, props: fermi_props })
    log_message = `Fermi surface rendered: ${filename}`
  } else if (result.type === `isosurface`) {
    // VolumetricFileData has structure + volumes; render via Structure with volumetric_data
    const vol_file = result.data as { structure: AnyStructure; volumes: VolumetricData[] }
    app = mount(Structure, {
      target: container,
      props: {
        structure: vol_file.structure,
        volumetric_data: vol_file.volumes,
        ...structure_props(defaults),
        ...common_props,
      },
    })
    log_message = `Volumetric data rendered: ${filename}`
  } else if (result.type === `convex_hull`) {
    const entries = result.data as PhaseData[]
    app = mount(ConvexHull, {
      target: container,
      props: { entries, ...common_props },
    })
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
      props: {
        structure,
        ...structure_props(defaults),
        ...common_props,
      },
    })
    log_message = `Structure rendered: ${filename} (${structure.sites?.length ?? 0} sites)`
  }

  vscode_api?.postMessage({ command: `info`, text: log_message })
  return app
}

// Map defaults to trajectory component props
const trajectory_props = (defaults: DefaultSettings) => {
  const { trajectory, plot, scatter, histogram } = defaults
  return {
    ...trajectory,
    structure_props: structure_props(defaults),
    loading_options: {
      bin_file_threshold: trajectory.bin_file_threshold,
      text_file_threshold: trajectory.text_file_threshold,
      use_indexing: trajectory.use_indexing,
      chunk_size: trajectory.chunk_size,
      max_frames_in_memory: trajectory.max_frames_in_memory,
      enable_performance_monitoring: trajectory.enable_performance_monitoring,
      prefetch_frames: trajectory.prefetch_frames,
      cache_parsed_data: trajectory.cache_parsed_data,
    },
    scatter_props: {
      markers: scatter.symbol_type,
      line_width: scatter.line.width,
      point_size: scatter.point.size,
      show_legend: scatter.show_legend,
      enable_zoom: plot.enable_zoom,
      zoom_factor: plot.zoom_factor,
      auto_fit_range: plot.auto_fit_range,
      show_grid: plot.grid_lines,
      show_axis_labels: plot.axis_labels,
      animation_duration: plot.animation_duration,
      legend: { show: scatter.show_legend },
    },
    histogram_props: {
      mode: histogram.mode,
      show_legend: histogram.show_legend,
      bin_count: histogram.bin_count,
      enable_zoom: plot.enable_zoom,
      zoom_factor: plot.zoom_factor,
      auto_fit_range: plot.auto_fit_range,
      show_grid: plot.grid_lines,
      show_axis_labels: plot.axis_labels,
      animation_duration: plot.animation_duration,
      legend: { show: histogram.show_legend },
    },
    spinner_props: { show_progress: trajectory.show_parsing_progress },
    ELEM_PROPERTY_LABELS: {},
  }
}

// Initialize the MatterViz application
async function initialize() {
  // Get MatterViz data passed from extension
  const { content, filename, is_base64 } = globalThis.matterviz_data?.data ?? {}
  const theme = globalThis.matterviz_data?.theme
  const moyo_wasm_url = globalThis.matterviz_data?.moyo_wasm_url
  if (!content || !filename) {
    throw new Error(`No data provided to MatterViz app`)
  }

  // Initialize WASM early with URL from extension (for symmetry analysis)
  if (moyo_wasm_url) await ensure_moyo_wasm_ready(moyo_wasm_url)

  // Set up VSCode-specific download override
  setup_vscode_download()

  // Apply theme early
  if (theme) apply_theme_to_dom(theme)

  const container = document.querySelector<HTMLElement>(`#matterviz-app`)
  if (!container) throw new Error(`Target container not found in DOM`)

  const result = await parse_file_content(content, filename, is_base64)
  const app = create_display(container, result, result.filename)

  // Store the app instance for file watching
  current_app = app

  // Set up file change monitoring
  if (vscode_api && !file_change_listener_registered) {
    // Listen for file change messages from extension
    globalThis.addEventListener(`message`, (event) => {
      if ([`fileUpdated`, `fileDeleted`].includes(event.data.command)) {
        enqueue_file_change(event.data)
      }
    })
    file_change_listener_registered = true
  }

  return app
}

// Cleanup function to properly dispose of components
async function cleanup_matterviz(): Promise<void> {
  file_change_generation++
  await file_change_queue
  await unmount_current_app()
} // Export initialization and cleanup functions to global scope
global_window.initializeMatterViz = async (): Promise<MatterVizApp | null> => {
  if (!globalThis.matterviz_data) {
    console.warn(`No matterviz_data found on window`)
    return null
  }

  try {
    // initialize() already records the app in current_app
    return await initialize()
  } catch (error) {
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
