// Import MatterViz parsing functions and components
import { is_trajectory_file, parse_structure_file } from '$lib/io/parse'
import Structure from '$lib/structure/Structure.svelte'
import { parse_trajectory_data } from '$lib/trajectory/parse'
import Trajectory from '$lib/trajectory/Trajectory.svelte'
import { mount } from 'svelte'
import '../../../../src/app.css'
import type { ThemeName } from '../../../../src/lib/theme/index'

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

// VSCode webview API type (available globally in webview context)
interface WebviewApi {
  postMessage(message: { command: string; text: string }): void
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
      return null
    }
  }

  return null
}

// Handle file change events from extension
const handle_file_change = async (message: FileChangeMessage): Promise<void> => {
  console.log(`File change message:`, message)

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
      // Apply updated theme
      if (message.theme) {
        apply_theme(message.theme as ThemeName)
      }

      // Parse updated file content
      const { content, filename, isCompressed } = message.data
      const result = await parse_file_content(content, filename, isCompressed)

      // Update the display
      const container = document.getElementById(`matterviz-app`)
      if (container && current_app) {
        current_app.destroy()
        current_app = create_display(container, result, result.filename) as MatterVizApp
      }

      const api = get_vscode_api()
      if (api) {
        api.postMessage({
          command: `info`,
          text: `File reloaded successfully`,
        })
      }
    } catch (error) {
      console.error(`Failed to reload file:`, error)
      const api = get_vscode_api()
      if (api) {
        api.postMessage({
          command: `error`,
          text: `Failed to reload file: ${error}`,
        })
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

// Apply theme to the webview DOM
const apply_theme = (theme: ThemeName): void => {
  const root = document.documentElement

  // Set the data-theme attribute
  root.setAttribute(`data-theme`, theme)

  // Apply MatterViz theme if available
  if (typeof globalThis !== `undefined` && globalThis.MATTERVIZ_THEMES) {
    const matterviz_theme = globalThis.MATTERVIZ_THEMES[theme]
    const css_map = globalThis.MATTERVIZ_CSS_MAP || {}

    if (matterviz_theme) {
      for (const [key, value] of Object.entries(matterviz_theme)) {
        const css_var = css_map[key as keyof typeof css_map]
        if (css_var && value) {
          root.style.setProperty(css_var, value as string)
        }
      }
    }
  }

  // Set color-scheme CSS property for better browser integration
  root.style.setProperty(
    `color-scheme`,
    theme === `light` || theme === `white` ? `light` : `dark`,
  )

  // VSCode-specific variables are now included in the centralized theme system
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

    // For .gz files, decompress first
    if (filename.endsWith(`.gz`)) {
      const { decompress_data } = await import(`$lib/io/decompress`)
      content = await decompress_data(buffer, `gzip`)
      // Remove .gz extension to get the original filename for parsing
      filename = filename.slice(0, -3)
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
    ? {
      trajectory: result.data,
      show_fullscreen_button: false,
      layout: `horizontal`,
    }
    : { structure: result.data, fullscreen_toggle: false }

  if (!is_trajectory) {
    container.style.setProperty(`--struct-height`, `100vh`)
  }

  const component = mount(Component, { target: container, props })

  const message = is_trajectory
    ? `Trajectory rendered: ${filename} (${result.data.frames.length} frames, ${
      result.data.frames[0]?.structure?.sites?.length || 0
    } atoms)`
    : `Structure rendered: ${filename} (${result.data.sites.length} atoms)`

  // Get VSCode API if available
  const api = get_vscode_api()
  api?.postMessage({ command: `info`, text: message })

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

  // Apply theme early
  if (theme) apply_theme(theme)

  const container = document.getElementById(`matterviz-app`)
  if (!container) throw new Error(`Target container not found in DOM`)

  try {
    const result = await parse_file_content(content, filename, isCompressed)
    const app = create_display(container, result, result.filename)

    // Store the app instance for file watching
    current_app = app

    // Set up file change monitoring
    const api = get_vscode_api()
    if (api) {
      console.log(`[MatterViz Webview] Setting up file change listener`)
      // Listen for file change messages from extension
      globalThis.addEventListener(`message`, (event) => {
        const message = event.data as FileChangeMessage
        console.log(`[MatterViz Webview] Received message:`, message)
        if (
          message.command === `fileUpdated` || message.command === `fileDeleted`
        ) {
          console.log(
            `[MatterViz Webview] Handling file change:`,
            message.command,
          )
          handle_file_change(message)
        }
      })
    } else {
      console.log(
        `[MatterViz Webview] VSCode API not available - file watching disabled`,
      )
    }

    return app
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    create_error_display(container, err, filename)
    // Get VSCode API if available
    const api = get_vscode_api()
    api?.postMessage({
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
