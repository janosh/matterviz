// Import MatterViz parsing functions and components
import { is_trajectory_file, parse_structure_file } from '$lib/io/parse'
import Structure from '$lib/structure/Structure.svelte'
import { parse_trajectory_data } from '$lib/trajectory/parse'
import Trajectory from '$lib/trajectory/Trajectory.svelte'
import { mount } from 'svelte'
import '../../../../src/app.css'

interface FileData {
  filename: string
  content: string
  isCompressed: boolean
}

interface MatterVizData {
  type: `trajectory` | `structure`
  data: FileData
}

interface ParseResult {
  type: `trajectory` | `structure`
  data: unknown
  filename: string
}

interface MatterVizApp {
  destroy(): void
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
): unknown => {
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
  const vscode_api = typeof acquireVsCodeApi !== `undefined` ? acquireVsCodeApi() : null
  vscode_api?.postMessage({ command: `info`, text: message })
  return component
}

// Initialize the MatterViz application
const initialize_app = async (): Promise<MatterVizApp> => {
  const { content, filename, isCompressed } = globalThis.mattervizData?.data ||
    {}
  if (!content || !filename) {
    throw new Error(`No data provided to MatterViz app`)
  }

  const container = document.getElementById(`matterviz-app`)
  if (!container) throw new Error(`Target container not found in DOM`)

  try {
    const result = await parse_file_content(content, filename, isCompressed)
    create_display(container, result, result.filename)
    return globalThis.MatterVizApp = {
      destroy: () => container.innerHTML = ``,
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    create_error_display(container, err, filename)
    // Get VSCode API if available
    const vscode_api = typeof acquireVsCodeApi !== `undefined` ? acquireVsCodeApi() : null
    vscode_api?.postMessage({
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
    return await initialize_app()
  } catch (error) {
    console.error(`MatterViz initialization error:`, error)
    return null
  }
}
