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
import { is_trajectory_file, parse_trajectory_data } from '$lib/trajectory/parse'
import Trajectory from '$lib/trajectory/Trajectory.svelte'
import { mount } from 'svelte'

interface FileData {
  filename: string
  content: string
  isCompressed: boolean
}

interface MatterVizData {
  type: `trajectory` | `structure`
  data: FileData
  theme: ThemeName
}

interface ParseResult {
  type: `trajectory` | `structure`
  data: unknown
  filename: string
}

interface MatterVizApp {
  destroy(): void
}

interface FileChangeMessage {
  command: `fileUpdated` | `fileDeleted`
  file_path?: string
  data?: FileData
  type?: `trajectory` | `structure`
  theme?: ThemeName
}

interface SaveMessage {
  command: `saveAs`
  content: string
  filename: string
  is_binary?: boolean
}

type VSCodeMessage = FileChangeMessage | SaveMessage | { command: string; text: string }

// VSCode webview API type (available globally in webview context)
interface WebviewApi {
  postMessage(message: VSCodeMessage): void
  setState(state: unknown): void
  getState(): unknown
}

declare global {
  interface Window {
    mattervizData?: MatterVizData
    MatterVizApp?: MatterVizApp
    initializeMatterViz?: () => Promise<MatterVizApp | null>
  }

  // VSCode webview API is available globally
  function acquireVsCodeApi(): WebviewApi
  const vscode: WebviewApi | undefined
}

// Global VSCode API instance
let vscode_api: WebviewApi | null = null
let current_app: MatterVizApp | null = null

// Initialize VSCode API once
const get_vscode_api = (): WebviewApi | null => {
  if (vscode_api) return vscode_api

  if (typeof acquireVsCodeApi !== `undefined`) {
    try {
      vscode_api = acquireVsCodeApi()
      return vscode_api
    } catch (error) {
      console.warn(`Failed to acquire VSCode API:`, error)
    }
  }

  return null
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
      const result = await parse_file_content(content, filename, isCompressed)

      // Update the display
      const container = document.getElementById(`matterviz-app`)
      if (container && current_app) {
        current_app.destroy()
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

// Parse file content and determine if it's a structure or trajectory
const parse_file_content = async (
  content: string,
  filename: string,
  is_compressed: boolean = false,
): Promise<ParseResult> => {
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

  // Check if it's a trajectory file AFTER decompression (with correct filename)
  const is_traj = is_trajectory_file(filename)

  // Try trajectory parsing first if it looks like a trajectory
  if (is_traj) {
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
  const props = is_trajectory
    ? { trajectory: result.data, show_fullscreen_button: false, layout: `horizontal` }
    : { structure: result.data, fullscreen_toggle: false }

  if (!is_trajectory) container.style.setProperty(`--struct-height`, `100vh`)

  const component = mount(Component, { target: container, props })

  const message = is_trajectory
    ? `Trajectory rendered: ${filename} (${result.data.frames.length} frames, ${
      result.data.frames[0]?.structure?.sites?.length || 0
    } sites)`
    : `Structure rendered: ${filename} (${result.data.sites.length} sites)`

  // Get VSCode API if available
  const vscode = get_vscode_api()
  vscode?.postMessage({ command: `info`, text: message })

  return {
    destroy: () => {
      component.$destroy?.()
      container.innerHTML = ``
    },
  }
}

// Initialize the MatterViz application
const initialize_app = async (): Promise<MatterVizApp> => {
  const matterviz_data = globalThis.mattervizData
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

  try {
    const result = await parse_file_content(content, filename, isCompressed)
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
    create_error_display(container, err, filename)
    // Get VSCode API if available
    const vscode = get_vscode_api()
    vscode?.postMessage({
      command: `error`,
      text: `Failed to render file: ${err.message}`,
    })
    throw error
  }
}

// Export initialization function to global scope
globalThis.initializeMatterViz = async (): Promise<MatterVizApp | null> => {
  if (!globalThis.mattervizData) {
    console.warn(`No mattervizData found on window`)
    return null
  }
  try {
    const app = await initialize_app()
    current_app = app
    return app
  } catch (error) {
    console.error(`MatterViz initialization error:`, error)
    return null
  }
}
