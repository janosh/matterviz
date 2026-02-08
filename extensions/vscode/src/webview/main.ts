// deno-lint-ignore-file require-await
// Import MatterViz parsing functions and components
import '$lib/app.css'
import { COMPRESSION_EXTENSIONS_REGEX } from '$lib/constants'
import ConvexHull from '$lib/convex-hull/ConvexHull.svelte'
import FermiSurface from '$lib/fermi-surface/FermiSurface.svelte'
import { parse_fermi_file } from '$lib/fermi-surface/parse'
import { is_fermi_surface_data } from '$lib/fermi-surface/types'
import { decompress_data, detect_compression_format } from '$lib/io/decompress'
import { parse_volumetric_file } from '$lib/isosurface/parse'
import IsobaricBinaryPhaseDiagram from '$lib/phase-diagram/IsobaricBinaryPhaseDiagram.svelte'
import { type DefaultSettings, merge } from '$lib/settings'
import type { Crystal } from '$lib/structure'
import { parse_structure_file } from '$lib/structure/parse'
import Structure from '$lib/structure/Structure.svelte'
import { ensure_moyo_wasm_ready } from '$lib/symmetry'
import { apply_theme_to_dom, is_valid_theme_name, type ThemeName } from '$lib/theme/index'
import '$lib/theme/themes'
import type {
  FrameIndex,
  FrameLoader,
  TrajectoryFrame,
  TrajectoryMetadata,
  TrajectoryType,
} from '$lib/trajectory'
import type { LoadingOptions } from '$lib/trajectory/parse'
import { is_trajectory_file, parse_trajectory_data } from '$lib/trajectory/parse'
import Trajectory from '$lib/trajectory/Trajectory.svelte'
import { mount, unmount } from 'svelte'
import { detect_view_type } from './detect'
import JsonBrowser from './JsonBrowser.svelte'

type ViewType =
  | `trajectory`
  | `structure`
  | `fermi_surface`
  | `isosurface`
  | `convex_hull`
  | `phase_diagram`
  | `json_browser`
export interface FileData {
  filename: string
  content: string
  is_base64: boolean
}

export interface MatterVizData {
  type: ViewType
  data: FileData
  theme: ThemeName
  defaults?: DefaultSettings
  moyo_wasm_url?: string
}

export interface ParseResult {
  type: ViewType
  data: unknown
  filename: string
  // For trajectories that support VS Code streaming
  streaming_info?: { supports_streaming: boolean; file_path: string }
}

export interface MatterVizApp {
  $on?(type: string, callback: (event: Event) => void): () => void
  $set?(props: Partial<Record<string, unknown>>): void
}

export interface FileChangeMessage {
  command: `fileUpdated` | `fileDeleted`
  file_path?: string
  data?: FileData
  type?: ViewType
  theme?: ThemeName
}

// VS Code Frame Loader - streams frames via extension communication
class VSCodeFrameLoader implements FrameLoader {
  constructor(private file_path: string, private vscode_api: VSCodeAPI) {}

  // Only implement the method we actually use
  async load_frame(
    _data: string | ArrayBuffer,
    frame_index: number,
    timeout: number = 10, // 10 seconds
  ): Promise<TrajectoryFrame | null> {
    return new Promise((resolve, reject) => {
      const request_id = crypto.randomUUID()
      let timer: ReturnType<typeof setTimeout> | null = null
      const handler = (event: MessageEvent) => {
        const { command, request_id: id, error, frame } = event.data
        if (command === `frame_response` && id === request_id) {
          globalThis.removeEventListener(`message`, handler)
          if (timer) clearTimeout(timer)
          if (error) reject(new Error(error))
          else resolve(frame)
        }
      }

      globalThis.addEventListener(`message`, handler)
      this.vscode_api.postMessage({
        command: `request_frame`,
        request_id,
        file_path: this.file_path,
        frame_index,
      })

      timer = setTimeout(() => {
        globalThis.removeEventListener(`message`, handler)
        reject(new Error(`Frame ${frame_index} timeout after ${timeout}ms`))
      }, timeout * 1000)
    })
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
  ;(globalThis as unknown as Window).download = (
    data: string | Blob,
    filename: string,
  ): void => {
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
        reader.onload = () => send_message(reader.result as string, true)
        reader.onerror = () => {
          console.error(`Failed to read binary data for download`)
          vscode_api?.postMessage({
            command: `error`,
            text: `Failed to read binary data for download`,
          })
        }
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

// Handle file change events from extension
const handle_file_change = async (message: FileChangeMessage): Promise<void> => {
  if (message.command === `fileDeleted`) {
    // File was deleted - show error message
    const container = document.getElementById(`matterviz-app`)
    if (container) {
      container.innerHTML = `
        <div style="padding: 2rem; text-align: center; color: var(--vscode-errorForeground);">
          <h2>File Deleted</h2>
          <p>The file "${message.file_path}" has been deleted.</p>
        </div>
      `
    }
    return
  }

  if (message.command === `fileUpdated` && message.data) {
    try {
      if (message.theme && is_valid_theme_name(message.theme)) {
        apply_theme_to_dom(message.theme)
      }

      const { content, filename, is_base64 } = message.data
      const result = await parse_file_content(content, filename, undefined, is_base64)

      // Update the display
      const container = document.getElementById(`matterviz-app`)
      if (container && current_app) {
        await unmount(current_app) // unmount the existing component to prevent memory leaks
        current_app = create_display(container, result, result.filename)
      }

      vscode_api?.postMessage({ command: `info`, text: `File reloaded successfully` })
    } catch (error) {
      console.error(`Failed to reload file:`, error)
      vscode_api?.postMessage({
        command: `error`,
        text: `Failed to reload file: ${error}`,
      })
    }
  }
}

// Convert base64 to ArrayBuffer for binary files
export function base64_to_array_buffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let idx = 0; idx < binary.length; idx++) {
    bytes[idx] = binary.charCodeAt(idx)
  }
  return bytes.buffer
}

// Type for parsed trajectory response from large file requests
type ParsedTrajectoryResponse = {
  trajectory: TrajectoryType
  supports_streaming: boolean
  file_path: string
}

// Request large file content from the extension using chunked streaming
function request_large_file_content(
  file_path: string,
  filename: string,
  is_compressed: boolean,
  timeout: number = 30_000, // 30 seconds
): Promise<string | ParsedTrajectoryResponse> {
  if (!vscode_api) throw new Error(`VS Code API not available`)

  return new Promise((resolve, reject) => {
    const request_id = crypto.randomUUID()

    let timer: ReturnType<typeof setTimeout> | null = null
    const handler = (event: MessageEvent) => {
      const { command, request_id: id, error, parsed_trajectory } = event.data
      const { is_parsed, stage, progress } = event.data
      if (command === `large_file_progress` && id === request_id) {
        // TODO maybe forward file load progress to UI
        console.log(`Progress: ${stage} - ${progress}%`)
        return
      }
      if (command === `large_file_response` && id === request_id) {
        globalThis.removeEventListener(`message`, handler)
        if (timer) clearTimeout(timer)
        if (error) return reject(new Error(error))
        if (is_parsed && parsed_trajectory) {
          return resolve({
            trajectory: parsed_trajectory,
            supports_streaming: true,
            file_path,
          })
        }
        resolve(event.data.content)
      }
    }

    globalThis.addEventListener(`message`, handler)
    const command = `request_large_file`
    vscode_api.postMessage({ command, request_id, file_path, filename, is_compressed })

    timer = setTimeout(() => {
      globalThis.removeEventListener(`message`, handler)
      reject(new Error(`Large file timeout`))
    }, timeout)
  })
}

// Parse file content and determine if it's a structure or trajectory
const parse_file_content = async (
  content: string,
  filename: string,
  loading_options?: LoadingOptions,
  is_compressed: boolean = false,
  recursion_depth: number = 0,
): Promise<ParseResult> => {
  if (recursion_depth > 2) {
    throw new Error(
      `parse_file_content exceeded max recursion depth=2 while parsing file ${filename}`,
    )
  }

  // Check if this is a large file marker from the extension
  if (content.startsWith(`LARGE_FILE:`)) {
    const [, file_path, file_size_str] = content.split(`:`)
    const file_size = parseInt(file_size_str, 10)

    console.log(
      `Handling large file: ${filename} (${Math.round(file_size / 1024 / 1024)}MB)`,
    )

    const parsed_trajectory = await request_large_file_content(
      file_path,
      filename,
      is_compressed,
    )

    // Check if we received a pre-parsed trajectory with VS Code streaming support
    if (
      parsed_trajectory && typeof parsed_trajectory === `object` &&
      `trajectory` in parsed_trajectory && `supports_streaming` in parsed_trajectory
    ) {
      const { trajectory, supports_streaming, file_path } = parsed_trajectory
      const streaming_info = { supports_streaming, file_path }
      return { type: `trajectory`, data: trajectory, filename, streaming_info }
    }

    // Fallback: if not pre-parsed, treat as raw content
    return parse_file_content(
      parsed_trajectory as string,
      filename,
      loading_options,
      is_compressed,
      recursion_depth + 1,
    )
  }

  // Handle compressed/binary files by converting from base64 first
  if (is_compressed) {
    const buffer = base64_to_array_buffer(content)

    // For HDF5 files, pass buffer directly to trajectory parser
    if (/\.(h5|hdf5)$/i.test(filename)) {
      const data = await parse_trajectory_data(buffer, filename)
      return { type: `trajectory`, filename, data }
    }

    // For ASE .traj files, pass buffer directly to trajectory parser
    if (/\.traj$/i.test(filename)) {
      const data = await parse_trajectory_data(buffer, filename)
      return { type: `trajectory`, filename, data }
    }

    // Unified handling for all supported compression formats
    const format = detect_compression_format(filename)
    if (format && format !== `zip`) { // Skip ZIP as it's not supported in browser
      content = await decompress_data(buffer, format)
      filename = filename.replace(COMPRESSION_EXTENSIONS_REGEX, ``)
    }
  }

  // Try trajectory parsing first if it looks like a trajectory
  if (is_trajectory_file(filename, content)) {
    const data = await parse_trajectory_data(content, filename)
    return { type: `trajectory`, data, filename }
  }

  // Fermi surface files (.bxsf, .frmsf)
  if (/\.(bxsf|frmsf)$/i.test(filename)) {
    const data = parse_fermi_file(content, filename)
    if (data) return { type: `fermi_surface`, data, filename }
    throw new Error(`Failed to parse Fermi surface file: ${filename}`)
  }

  // Volumetric data files (.cube, CHGCAR, AECCAR*, ELFCAR, LOCPOT)
  if (
    /\.cube$/i.test(filename) || /^(CHGCAR|AECCAR[012]?|ELFCAR|LOCPOT)/i.test(filename)
  ) {
    const data = parse_volumetric_file(content, filename)
    if (data) return { type: `isosurface`, data, filename }
    throw new Error(`Failed to parse volumetric file: ${filename}`)
  }

  // JSON files: use smart detection + JSON browser
  if (/\.json$/i.test(filename)) {
    try {
      const parsed = JSON.parse(content)
      // Check if the top-level value matches a known visualization type
      const detected = detect_view_type(parsed)
      if (detected) {
        // Structure JSON needs normalization (OPTIMADE, fractional coords, etc.)
        if (detected === `structure`) {
          const structure = parse_structure_file(content, filename)
          if (structure?.sites) {
            return {
              type: `structure`,
              data: { ...structure, id: filename.replace(/\.[^/.]+$/, ``) },
              filename,
            }
          }
        }
        // Volumetric JSON needs wrapping in { structure, volumes } for the isosurface renderer
        if (detected === `volumetric`) {
          const vol = parsed as { lattice?: unknown }
          return {
            type: `isosurface`,
            data: { structure: { sites: [], lattice: vol.lattice }, volumes: [parsed] },
            filename,
          }
        }
        // Map detection types to ViewType for direct rendering.
        // Types not listed here (band_structure, dos) intentionally fall through
        // to json_browser -- they render inside the JsonBrowser's split-panel UI.
        const type_map: Record<string, ViewType> = {
          fermi_surface: `fermi_surface`,
          band_grid: `fermi_surface`,
          convex_hull: `convex_hull`,
          phase_diagram: `phase_diagram`,
        }
        return { type: type_map[detected] ?? `json_browser`, data: parsed, filename }
      }
      // No top-level match -- show JSON browser for navigation
      return { type: `json_browser`, data: parsed, filename }
    } catch {
      // JSON parse failed, fall through to structure parser
    }
  }

  // Parse as structure (CIF, POSCAR, XYZ, etc.)
  const structure = parse_structure_file(content, filename)
  if (!structure?.sites) {
    throw new Error(`Failed to parse file or no atoms found`)
  }

  const data = { ...structure, id: filename.replace(/\.[^/.]+$/, ``) }
  return { type: `structure`, data, filename }
}

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
        <p style="margin: 0 0 10px 0;"><strong>File:</strong> ${filename}</p>
        <p style="margin: 0 0 10px 0;"><strong>Error:</strong> ${error.message}</p>
        <p style="margin: 0; font-size: 14px; opacity: 0.8;">
          Supported formats: XYZ, CIF, JSON, POSCAR, trajectory files (.traj, .h5, .extxyz), etc.
        </p>
      </div>
    </div>`
}

// Mount Svelte component and create display
const create_display = (
  container: HTMLElement,
  result: ParseResult,
  filename: string,
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
    let final_trajectory: TrajectoryType | StreamingTrajectory = result
      .data as TrajectoryType

    if (result.streaming_info?.supports_streaming) {
      const trajectory = result.data as TrajectoryType
      if (vscode_api && result.streaming_info.file_path) {
        final_trajectory = {
          ...trajectory,
          is_indexed: true,
          frames: trajectory.frames || [],
          frame_loader: new VSCodeFrameLoader(
            result.streaming_info.file_path,
            vscode_api,
          ),
        }
      }
    }

    app = mount(Trajectory, {
      target: container,
      props: {
        trajectory: final_trajectory,
        ...trajectory_props(defaults),
        ...common_props,
      },
    })
    log_message = `Trajectory rendered: ${filename} (${
      final_trajectory.frames?.length ?? 0
    } initial frames, ${final_trajectory.total_frames ?? `unknown`} total)`
  } else if (result.type === `fermi_surface`) {
    const fermi_props: Record<string, unknown> = { ...common_props }
    if (
      is_fermi_surface_data(result.data as Parameters<typeof is_fermi_surface_data>[0])
    ) {
      fermi_props.fermi_data = result.data
    } else {
      fermi_props.band_data = result.data
    }
    app = mount(FermiSurface, { target: container, props: fermi_props })
    log_message = `Fermi surface rendered: ${filename}`
  } else if (result.type === `isosurface`) {
    // VolumetricFileData has structure + volumes; render via Structure with volumetric_data
    const vol_file = result.data as { structure: unknown; volumes: unknown[] }
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
    app = mount(ConvexHull, {
      target: container,
      props: { entries: result.data as unknown[], ...common_props },
    })
    log_message = `Convex hull rendered: ${filename} (${
      (result.data as unknown[]).length
    } entries)`
  } else if (result.type === `phase_diagram`) {
    app = mount(IsobaricBinaryPhaseDiagram, {
      target: container,
      props: { data: result.data, ...common_props },
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
    app = mount(Structure, {
      target: container,
      props: {
        structure: result.data,
        ...structure_props(defaults),
        ...common_props,
      },
    })
    log_message = `Structure rendered: ${filename} (${
      (result.data as Crystal).sites?.length ?? 0
    } sites)`
  }

  vscode_api?.postMessage({ command: `log`, text: log_message })
  return app
}

// Map defaults in settings.ts to structure component props
// TIGHT COUPLING WARNING: settings-to-props mapping functions create a direct dependency between the centralized settings schema
// (src/lib/settings.ts) and component prop interfaces. Changes to either side
// require manual updates here.
const structure_props = (defaults: DefaultSettings) => {
  const { structure } = defaults
  return {
    scene_props: { ...structure, gizmo: structure.show_gizmo },
    lattice_props: {
      show_cell_vectors: structure.show_cell_vectors,
      cell_edge_opacity: structure.cell_edge_opacity,
      cell_surface_opacity: structure.cell_surface_opacity,
      cell_edge_color: structure.cell_edge_color,
      cell_surface_color: structure.cell_surface_color,
    },
    color_scheme: defaults.color_scheme,
    background_color: defaults.background_color,
    background_opacity: defaults.background_opacity,
    show_image_atoms: structure.show_image_atoms,
  }
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
  const { content, filename, is_base64 } = globalThis.matterviz_data?.data || {}
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

  const container = document.getElementById(`matterviz-app`)
  if (!container) throw new Error(`Target container not found in DOM`)

  const result = await parse_file_content(content, filename, undefined, is_base64)
  const app = create_display(container, result, result.filename)

  // Store the app instance for file watching
  current_app = app

  // Set up file change monitoring
  if (vscode_api) {
    // Listen for file change messages from extension
    globalThis.addEventListener(`message`, (event) => {
      if ([`fileUpdated`, `fileDeleted`].includes(event.data.command)) {
        handle_file_change(event.data)
      }
    })
  }

  return app
}

// Cleanup function to properly dispose of components
async function cleanup_matterviz(): Promise<void> {
  if (current_app) {
    await unmount(current_app)
    current_app = null
  }
} // Export initialization and cleanup functions to global scope
// Export initialization and cleanup functions to global scope

;(globalThis as unknown as {
  initializeMatterViz?: () => Promise<MatterVizApp | null>
  cleanupMatterViz?: () => Promise<void>
}).initializeMatterViz = async (): Promise<MatterVizApp | null> => {
  if (!globalThis.matterviz_data) {
    console.warn(`No matterviz_data found on window`)
    return null
  }

  try {
    const app = await initialize()
    current_app = app
    return app
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    const container = document.getElementById(`matterviz-app`)
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
;(globalThis as unknown as { cleanupMatterViz?: () => Promise<void> })
  .cleanupMatterViz = cleanup_matterviz
