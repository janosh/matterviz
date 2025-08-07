// deno-lint-ignore-file require-await
// Import MatterViz parsing functions and components
import '$lib/app.css'
import {
  decompress_data,
  detect_compression_format,
  remove_compression_extension,
} from '$lib/io/decompress'
import { parse_structure_file } from '$lib/io/parse'
import Structure from '$lib/structure/Structure.svelte'
import { apply_theme_to_dom, is_valid_theme_name, type ThemeName } from '$lib/theme/index'
import '$lib/theme/themes'
import type { LoadingOptions } from '$lib/trajectory/parse'
import { is_trajectory_file, parse_trajectory_data } from '$lib/trajectory/parse'
// Add frame loader import
import { type DefaultSettings, merge } from '$lib/settings'
import type {
  FrameIndex,
  FrameLoader,
  TrajectoryFrame,
  TrajectoryMetadata,
} from '$lib/trajectory/index'
import Trajectory from '$lib/trajectory/Trajectory.svelte'
import { mount, unmount } from 'svelte'

interface FileData {
  filename: string
  content: string
  isCompressed: boolean
}

interface MatterVizData {
  type: `trajectory` | `structure`
  data: FileData
  theme: ThemeName
  defaults?: DefaultSettings
}

interface ParseResult {
  type: `trajectory` | `structure`
  data: unknown
  filename: string
  // For trajectories that support VS Code streaming
  streaming_info?: { supports_streaming: boolean; file_path: string }
}

interface MatterVizApp {
  $on?(type: string, callback: (event: Event) => void): () => void
  $set?(props: Partial<Record<string, unknown>>): void
}

interface FileChangeMessage {
  command: `fileUpdated` | `fileDeleted`
  file_path?: string
  data?: FileData
  type?: `trajectory` | `structure`
  theme?: ThemeName
}

// VS Code Frame Loader - streams frames via extension communication
class VSCodeFrameLoader implements FrameLoader {
  constructor(private file_path: string, private vscode_api: VSCodeAPI) {}

  // Only implement the method we actually use
  async load_frame(
    _data: string | ArrayBuffer,
    frame_index: number,
  ): Promise<TrajectoryFrame | null> {
    return new Promise((resolve, reject) => {
      const request_id = globalThis.crypto?.randomUUID?.() ??
        Math.random().toString(36).slice(2, 15)

      const handler = (event: MessageEvent) => {
        const { command, request_id: id, error, frame } = event.data
        if (command === `frame_response` && id === request_id) {
          globalThis.removeEventListener(`message`, handler)
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

      setTimeout(() => {
        globalThis.removeEventListener(`message`, handler)
        reject(new Error(`Frame ${frame_index} timeout`))
      }, 30000)
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

interface TrajectoryData {
  frames?: Array<{ structure?: { sites?: unknown[] } }>
}

interface StructureData {
  sites?: unknown[]
}

interface VSCodeAPI {
  postMessage(message: unknown): void
}

// Extend globalThis interface for MatterViz data
declare global {
  interface Window {
    mattervizData?: MatterVizData
    initializeMatterViz?: () => void
  }
  var mattervizData: MatterVizData | undefined

  // VSCode webview API
  function acquireVsCodeApi(): VSCodeAPI
}

// Store VSCode API instance to avoid multiple acquisitions
let vscode_api: VSCodeAPI | null = null
let current_app: MatterVizApp | null = null

const get_matterviz_data = (): MatterVizData | undefined =>
  (globalThis as unknown as { mattervizData?: MatterVizData }).mattervizData

function get_vscode_api(): VSCodeAPI | null {
  if (!vscode_api) {
    try {
      vscode_api = globalThis.acquireVsCodeApi?.()
    } catch (error) {
      console.warn(`VSCode API already acquired or not available:`, error)
    }
  }
  return vscode_api
}

// Set up VSCode-specific download override for file exports
export const setup_vscode_download = (): void => {
  const vscode = get_vscode_api()
  if (!vscode) {
    console.debug(`VSCode API not available, skipping download override setup`)
    return
  }
  ;(globalThis as Record<string, unknown>).download = (
    data: string | Blob,
    filename: string,
  ): void => {
    if (!filename || filename.trim() === ``) {
      console.error(`Invalid filename=${filename} provided to download`)
      return
    }

    try {
      if (typeof data === `string`) {
        vscode.postMessage({
          command: `saveAs`,
          content: data,
          filename,
          is_binary: false,
        })
      } else {
        // Handle binary data (like PNG images)
        const reader = new FileReader()
        reader.onload = () => {
          vscode.postMessage({
            command: `saveAs`,
            content: reader.result as string,
            filename,
            is_binary: true,
          })
        }
        reader.onerror = () => {
          const msg = `Failed to read binary data for download`
          console.error(msg)
          vscode.postMessage({ command: `error`, text: msg })
        }
        reader.readAsDataURL(data)
      }
    } catch (error) {
      console.error(`VSCode download failed:`, error)
      vscode.postMessage({
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

      const { content, filename, isCompressed } = message.data
      const result = await parse_file_content(content, filename, undefined, isCompressed)

      // Update the display
      const container = document.getElementById(`matterviz-app`)
      if (container && current_app) {
        await unmount(current_app) // unmount the existing component to prevent memory leaks
        current_app = create_display(container, result, result.filename)
      }

      const vscode = get_vscode_api()
      if (vscode) {
        const text = `File reloaded successfully`
        vscode.postMessage({ command: `info`, text })
      }
    } catch (error) {
      console.error(`Failed to reload file:`, error)
      const vscode = get_vscode_api()
      if (vscode) {
        const text = `Failed to reload file: ${error}`
        vscode.postMessage({ command: `error`, text })
      }
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

// Request large file content from the extension using chunked streaming
function request_large_file_content(
  file_path: string,
  filename: string,
  is_compressed: boolean,
  timeout: number = 30_000, // 30 seconds
): Promise<
  string | ArrayBuffer | {
    trajectory: TrajectoryData
    supports_streaming: boolean
    file_path: string
  }
> {
  const vscode = get_vscode_api()
  if (!vscode) throw new Error(`VS Code API not available`)

  return new Promise((resolve, reject) => {
    const request_id = Math.random().toString(36).slice(2, 15)

    const handler = (event: MessageEvent) => {
      const { command, request_id: id, error, parsed_trajectory, is_parsed } = event.data
      if (command === `largefile_response` && id === request_id) {
        globalThis.removeEventListener(`message`, handler)
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
    vscode.postMessage({
      command: `request_large_file`,
      request_id,
      file_path,
      filename,
      is_compressed,
    })

    setTimeout(() => {
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
    if (/\.h5|\.hdf5$/i.test(filename)) {
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
      try {
        content = await decompress_data(buffer, format)
        filename = remove_compression_extension(filename)
      } catch (error) {
        console.warn(`Failed to decompress file ${filename}:`, error)
      }
    }
  }

  // Try trajectory parsing first if it looks like a trajectory
  if (is_trajectory_file(filename)) {
    try {
      const data = await parse_trajectory_data(content, filename)
      return { type: `trajectory`, data, filename }
    } catch (error) {
      console.warn(
        `Trajectory parsing failed despite expected type, falling back to structure:`,
        error,
      )
    }
  }

  // Parse as structure
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

  const is_trajectory = result.type === `trajectory`
  const Component = is_trajectory ? Trajectory : Structure

  // Get defaults and create props
  const matterviz_data = get_matterviz_data()
  const defaults = merge(matterviz_data?.defaults)

  // Prepare trajectory data for VS Code streaming if supported
  let final_trajectory_data = result.data

  if (is_trajectory && result.streaming_info?.supports_streaming) {
    const vscode = get_vscode_api()
    const trajectory_data = result.data as TrajectoryData

    if (vscode && result.streaming_info.file_path) {
      // Create trajectory with frame loader for streaming
      final_trajectory_data = {
        ...trajectory_data,
        is_indexed: true, // Mark as indexed so component uses frame loading logic
        // Keep existing frames for initial display
        frames: trajectory_data.frames || [],
        // Attach frame loader directly to trajectory
        frame_loader: new VSCodeFrameLoader(result.streaming_info.file_path, vscode),
      }
    }
  }

  // Create component props by mapping defaults to component props
  const props = {
    ...(is_trajectory
      ? {
        trajectory: final_trajectory_data as TrajectoryData,
        ...trajectory_props(defaults),
      }
      : { structure: result.data as StructureData, ...structure_props(defaults) }),
    allow_file_drop: false,
    style: `height: 100%; border-radius: 0`,
    enable_tips: false,
  }

  const app = mount(Component, { target: container, props })

  // VSCode message logging
  try {
    const vs_code_api = get_vscode_api()
    const trajectory_data = final_trajectory_data as TrajectoryData & {
      total_frames?: number
    }
    const structure_data = result.data as StructureData
    const message = is_trajectory
      ? `Trajectory rendered: ${filename} (${
        trajectory_data.frames?.length || NaN
      } initial frames, ${trajectory_data?.total_frames || NaN} total)`
      : `Structure rendered: ${filename} (${structure_data.sites?.length || 0} sites)`

    vs_code_api?.postMessage({ command: `log`, text: message })
  } catch (error) {
    console.warn(`VSCode API messaging failed:`, error)
  }

  return app
}

// Map defaults in settings.ts to structure component props
// TIGHT COUPLING WARNING: settings-to-props mapping functions create a direct dependency between the centralized settings schema
// (src/lib/settings.ts) and component prop interfaces. Changes to either side
// require manual updates here.
const structure_props = (defaults: DefaultSettings) => {
  const { structure } = defaults
  return {
    scene_props: {
      ...structure,
      camera_projection: structure.projection,
      force_vector_scale: structure.force_scale,
      force_vector_color: structure.force_color,
      gizmo: defaults.show_gizmo,
    },
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
    show_image_atoms: defaults.show_image_atoms,
  }
}

// Map defaults to trajectory component props
const trajectory_props = (defaults: DefaultSettings) => {
  const { trajectory } = defaults
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
      line_width: trajectory.scatter_line_width,
      point_size: trajectory.scatter_point_size,
      show_legend: trajectory.scatter_show_legend,
      enable_zoom: trajectory.enable_plot_zoom,
      zoom_factor: trajectory.plot_zoom_factor,
      auto_fit_range: trajectory.auto_fit_plot_range,
      show_grid: trajectory.plot_grid_lines,
      show_axis_labels: trajectory.plot_axis_labels,
      animation_duration: trajectory.plot_animation_duration,
      legend: { show: trajectory.scatter_show_legend },
    },
    histogram_props: {
      mode: trajectory.histogram_mode,
      show_legend: trajectory.histogram_show_legend,
      bin_count: trajectory.histogram_bin_count,
      enable_zoom: trajectory.enable_plot_zoom,
      zoom_factor: trajectory.plot_zoom_factor,
      auto_fit_range: trajectory.auto_fit_plot_range,
      show_grid: trajectory.plot_grid_lines,
      show_axis_labels: trajectory.plot_axis_labels,
      animation_duration: trajectory.plot_animation_duration,
      legend: { show: trajectory.histogram_show_legend },
    },
    spinner_props: { show_progress: trajectory.show_parsing_progress },
    property_labels: {},
  }
}

// Initialize the MatterViz application
async function initialize() {
  try {
    // Get MatterViz data passed from extension
    const matterviz_data = get_matterviz_data()
    const { content, filename, isCompressed } = matterviz_data?.data || {}
    const theme = matterviz_data?.theme
    if (!content || !filename) {
      throw new Error(`No data provided to MatterViz app`)
    }

    // Set up VSCode-specific download override
    setup_vscode_download()

    // Apply theme early
    if (theme) apply_theme_to_dom(theme)

    const container = document.getElementById(`matterviz-app`)
    if (!container) throw new Error(`Target container not found in DOM`)

    const result = await parse_file_content(content, filename, undefined, isCompressed)
    const app = create_display(container, result, result.filename)

    // Store the app instance for file watching
    current_app = app

    // Set up file change monitoring
    const vscode = get_vscode_api()
    if (vscode) {
      // Listen for file change messages from extension
      globalThis.addEventListener(`message`, (event) => {
        if ([`fileUpdated`, `fileDeleted`].includes(event.data.command)) {
          handle_file_change(event.data)
        }
      })
    } else {
      console.warn(`VSCode API not available - file watching disabled`)
    }

    return app
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    const container = document.getElementById(`matterviz-app`)
    if (container) {
      create_error_display(
        container,
        err,
        get_matterviz_data()?.data?.filename || `Unknown file`,
      )
    }
    // Get VSCode API if available
    const vscode = get_vscode_api()
    if (vscode) {
      const filename = get_matterviz_data()?.data?.filename || `Unknown file`
      const text = `Error rendering ${filename}: ${err.message}`
      vscode.postMessage({ command: `error`, text })
    }
    throw error
  }
} // Cleanup function to properly dispose of components
async function cleanup_matterviz(): Promise<void> {
  if (current_app) {
    try {
      await unmount(current_app)
      current_app = null
    } catch (error) {
      console.error(`Error unmounting MatterViz component:`, error)
    }
  }
} // Export initialization and cleanup functions to global scope

;(globalThis as unknown as {
  initializeMatterViz?: () => Promise<MatterVizApp | null>
  cleanupMatterViz?: () => Promise<void>
}).initializeMatterViz = async (): Promise<MatterVizApp | null> => {
  if (!get_matterviz_data()) {
    console.warn(`No mattervizData found on window`)
    return null
  }
  try {
    const app = await initialize()
    current_app = app
    return app
  } catch (error) {
    console.error(`MatterViz initialization error:`, error)
    return null
  }
}
;(globalThis as unknown as { cleanupMatterViz?: () => Promise<void> })
  .cleanupMatterViz = cleanup_matterviz
