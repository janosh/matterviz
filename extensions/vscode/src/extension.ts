import { COMPRESSION_EXTENSIONS_REGEX } from '$lib/constants'
import { format_bytes } from '$lib/labels'
import { DEFAULTS, type DefaultSettings, merge } from '$lib/settings'
import { is_structure_file } from '$lib/structure/parse'
import { AUTO_THEME, COLOR_THEMES, is_valid_theme_mode, type ThemeName } from '$lib/theme'
import type { FrameLoader } from '$lib/trajectory'
import {
  create_frame_loader,
  is_trajectory_file,
  parse_trajectory_async,
} from '$lib/trajectory/parse'
import { Buffer } from 'node:buffer'
import * as fs from 'node:fs'
import * as path from 'path'
import * as vscode from 'vscode'
import pkg_json from '../package.json' with { type: 'json' }
import { stream_file_to_buffer } from './node-io'
import type { ViewType } from './types'

interface FrameLoaderData {
  loader: FrameLoader
  file_data: ArrayBuffer
  filename: string
}

// WebviewLike and ExtensionContextLike are unions to allow both real vscode types and mock types for testing
type WebviewLike = vscode.Webview | {
  cspSource: string
  asWebviewUri: (uri: { fsPath: string }) => string | { toString(): string }
  onDidReceiveMessage: (
    listener: (message: unknown) => void,
  ) => { dispose(): void } | void
  postMessage: (message: unknown) => Promise<boolean> | void
  html: string
}

type ExtensionContextLike = vscode.ExtensionContext | {
  extensionUri: { fsPath: string }
  subscriptions: { dispose(): void }[]
  workspaceState?: {
    get<T>(key: string): T | undefined
    update(key: string, value: unknown): Promise<void>
  }
  globalState?: {
    get<T>(key: string): T | undefined
    update(key: string, value: unknown): Promise<void>
  }
  extensionPath?: string
  storageUri?: { fsPath: string }
  globalStorageUri?: { fsPath: string }
  logUri?: { fsPath: string }
}

interface FileData {
  filename: string
  content: string
  is_base64: boolean // content is base64-encoded (binary or compressed)
}

interface WebviewData {
  type: ViewType
  data: FileData
  theme: ThemeName
  defaults?: DefaultSettings
}

export type IncomingCommand =
  | `info`
  | `error`
  | `request_large_file`
  | `request_frame`
  | `saveAs`
  | `startWatching`
  | `stopWatching`

export interface MessageData {
  command: IncomingCommand
  text?: string
  filename?: string
  file_size?: number
  content?: string
  is_binary?: boolean
  file_path?: string
  // Add frame loading support
  request_id?: string
  frame_index?: number
}

type WatcherMeta = { request_id?: string; filename?: string; frame_index?: number }

// Track active file watchers by file path
export const active_watchers = new Map<string, vscode.FileSystemWatcher>()
// Track active frame loaders by file path
export const active_frame_loaders = new Map<string, FrameLoaderData>()
// Track auto-render timers to clear them on deactivate
export const auto_render_timers = new Map<string, ReturnType<typeof setTimeout>>()
// Track active panels by URI to prevent duplicate opens
export const active_auto_render_panels = new Map<string, vscode.WebviewPanel>()

let wasm_filename_cache: string | null = null

function get_wasm_filename(ext_path: string): string | null {
  if (wasm_filename_cache) return wasm_filename_cache
  const assets_dir = path.join(ext_path, `dist`, `assets`)

  // In tests, the assets directory might not exist
  if (!fs.existsSync(assets_dir)) {
    console.warn(`Assets directory not found: ${assets_dir}`)
    return null
  }

  const wasm_file = fs.readdirSync(assets_dir).find((file) =>
    file.startsWith(`moyo_wasm_bg-`) && file.endsWith(`.wasm`)
  )
  if (!wasm_file) {
    console.warn(`moyo-wasm not found in ${assets_dir}`)
    return null
  }
  wasm_filename_cache = wasm_file
  return wasm_file
}

// File size thresholds for reading files via VSCode API (1GB for both text and binary)
const MAX_VSCODE_FILE_SIZE = 1024 * 1024 * 1024 // 1GB

// Filename patterns for specialized file types (shared between infer_view_type / should_auto_render)
const FERMI_FILE_RE = /\.(bxsf|frmsf)$/i
const VOLUMETRIC_EXT_RE = /\.cube$/i
const VOLUMETRIC_VASP_RE = /^(chgcar|aeccar[012]?|elfcar|locpot)/i

// Helper: determine view type using content when available
const infer_view_type = (file: FileData): ViewType => {
  // Strip compression extensions before matching (filename may still have .gz/.bz2)
  const name = file.filename.toLowerCase().replace(COMPRESSION_EXTENSIONS_REGEX, ``)
  if (FERMI_FILE_RE.test(name)) return `fermi_surface`
  if (VOLUMETRIC_EXT_RE.test(name) || VOLUMETRIC_VASP_RE.test(name)) return `isosurface`
  // Only pass content for text files; for binary (compressed) fall back to filename
  const content = file.is_base64 ? undefined : file.content
  if (is_trajectory_file(file.filename, content)) return `trajectory`
  return `structure`
}

// Check if a file should be auto-rendered
export const should_auto_render = (filename: string): boolean => {
  if (!filename || typeof filename !== `string`) return false
  // Strip compression extensions so .bxsf.gz / .cube.bz2 etc. are recognized
  const name = path.basename(filename).replace(COMPRESSION_EXTENSIONS_REGEX, ``)
  if (FERMI_FILE_RE.test(name)) return true
  if (VOLUMETRIC_EXT_RE.test(name) || VOLUMETRIC_VASP_RE.test(name)) return true
  // Structure and trajectory files (existing behavior)
  return is_structure_file(filename) || is_trajectory_file(filename)
}

// Update the shared VS Code context for supported resources
const update_supported_resource_context = (uri?: vscode.Uri): void => {
  // Prefer explicit URI; otherwise fall back to the active editor filename
  const filename = uri?.fsPath
    ? path.basename(uri.fsPath)
    : (vscode.window.activeTextEditor?.document?.fileName
      ? path.basename(vscode.window.activeTextEditor.document.fileName)
      : ``)
  const is_supported = should_auto_render(filename)
  vscode.commands.executeCommand(
    `setContext`,
    `matterviz.supported_resource`,
    is_supported,
  )
}

// Read file from filesystem using VSCode API (works with remote SSH)
export const read_file = async (file_path: string): Promise<FileData> => {
  const filename = path.basename(file_path)
  const uri = vscode.Uri.file(file_path)

  // Files we serialize as base64 for the webview (compressed OR binary)
  const is_base64_payload = COMPRESSION_EXTENSIONS_REGEX.test(filename) ||
    /\.(traj|h5|hdf5)$/i.test(filename)

  // Check file size to avoid loading huge files into memory
  let file_size: number
  try {
    file_size = (await vscode.workspace.fs.stat(uri)).size
  } catch (error) {
    console.warn(`Failed to get file stats for ${filename}:`, error)
    throw new Error(
      `Failed to access file ${filename}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  const threshold = MAX_VSCODE_FILE_SIZE

  if (file_size > threshold) {
    return {
      filename,
      content: `LARGE_FILE:${file_path}:${file_size}`,
      is_base64: is_base64_payload, // NOTE: base64 payload (compressed or binary)
    }
  }

  // For normal-sized files, read using VSCode API
  try {
    const uint8array = await vscode.workspace.fs.readFile(uri)
    const content = is_base64_payload
      ? Buffer.from(uint8array).toString(`base64`)
      : Buffer.from(uint8array).toString(`utf8`)
    return { filename, content, is_base64: is_base64_payload }
  } catch (error) {
    throw new Error(
      `Failed to read file ${filename}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

// Get file data from URI or active editor
export const get_file = async (uri?: vscode.Uri): Promise<FileData> => {
  if (uri) return await read_file(uri.fsPath)

  if (vscode.window.activeTextEditor) {
    const filename = path.basename(vscode.window.activeTextEditor.document.fileName)
    const content = vscode.window.activeTextEditor.document.getText()
    return { filename, content, is_base64: false }
  }

  const active_tab = vscode.window.tabGroups.activeTabGroup.activeTab
  if (
    active_tab?.input && typeof active_tab.input === `object` &&
    active_tab.input !== null && `uri` in active_tab.input
  ) return await read_file(active_tab.input.uri.fsPath)

  throw new Error(
    `No file selected. MatterViz needs an active editor to know what to render.`,
  )
}

// Detect VSCode theme and user preference
export const get_theme = (): ThemeName => {
  const config = vscode.workspace.getConfiguration(`matterviz`)
  const theme_setting = config.get<string>(`theme`, AUTO_THEME)

  // Validate theme setting
  if (!is_valid_theme_mode(theme_setting)) {
    console.warn(
      `Invalid theme setting: ${theme_setting}, falling back to auto`,
    )
    return get_system_theme()
  }

  if (theme_setting !== AUTO_THEME) return theme_setting // Handle manual theme selection

  return get_system_theme() // Auto-detect from VSCode color theme
}

// Get system theme based on VSCode's current color theme
const get_system_theme = (): ThemeName => {
  const color_theme = vscode.window.activeColorTheme

  // Map VSCode theme kind to our theme names
  if (color_theme.kind === vscode.ColorThemeKind.Light) return COLOR_THEMES.light
  else if (color_theme.kind === vscode.ColorThemeKind.Dark) return COLOR_THEMES.dark
  else if (color_theme.kind === vscode.ColorThemeKind.HighContrast) {
    return COLOR_THEMES.black
  } else if (color_theme.kind === vscode.ColorThemeKind.HighContrastLight) {
    return COLOR_THEMES.white
  } else return COLOR_THEMES.light
}

// Settings reader with nested structure support and built-in error handling
export const get_defaults = (): DefaultSettings => {
  try {
    const config = vscode.workspace.getConfiguration(`matterviz`)
    const user_settings: Partial<DefaultSettings> = {}

    // Helper to read settings section
    const read_section = (
      section_key: keyof DefaultSettings,
      defaults_section: Record<string, unknown>,
    ) => {
      const settings: Record<string, unknown> = {}
      const section_config = config.get(section_key, {})
      for (const key of Object.keys(defaults_section)) {
        const value = section_config?.[key]
        if (value !== undefined) settings[key] = value
      }
      return Object.keys(settings).length > 0 ? settings : undefined
    }

    // Read all settings sections
    // Top-level simple keys
    const color_scheme_val = config.get(`color_scheme`)
    if (color_scheme_val !== undefined) {
      user_settings.color_scheme = color_scheme_val as DefaultSettings[`color_scheme`]
    }
    const bg_color_val = config.get(`background_color`)
    if (bg_color_val !== undefined) {
      user_settings.background_color = bg_color_val as DefaultSettings[`background_color`]
    }
    const bg_opacity_val = config.get(`background_opacity`)
    if (bg_opacity_val !== undefined) {
      user_settings.background_opacity =
        bg_opacity_val as DefaultSettings[`background_opacity`]
    }

    const structure_settings = read_section(`structure`, DEFAULTS.structure)
    if (structure_settings) {
      user_settings.structure = structure_settings as DefaultSettings[`structure`]
    }

    const trajectory_settings = read_section(`trajectory`, DEFAULTS.trajectory)
    if (trajectory_settings) {
      user_settings.trajectory = trajectory_settings as DefaultSettings[`trajectory`]
    }

    const composition_settings = read_section(`composition`, DEFAULTS.composition)
    if (composition_settings) {
      user_settings.composition = composition_settings as DefaultSettings[`composition`]
    }

    return merge(user_settings)
  } catch (error) {
    console.error(`Failed to get defaults:`, error)
    return DEFAULTS
  }
}

// Create HTML content for webview
export const create_html = (
  webview: WebviewLike,
  context: ExtensionContextLike,
  data: WebviewData,
): string => {
  const nonce = Math.random().toString(36).slice(2, 34)
  const webview_uri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, `dist`, `webview.js`),
  )
  const js_uri = typeof webview_uri === `string` ? webview_uri : webview_uri.toString()

  // Resolve WASM URI for webview (enables symmetry analysis)
  // Include in data object instead of global scope for cleaner functional approach
  const wasm_filename = get_wasm_filename(context.extensionUri.fsPath)
  let moyo_wasm_url: string | undefined
  if (wasm_filename) {
    const wasm_uri = webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, `dist`, `assets`, wasm_filename),
    )
    moyo_wasm_url = typeof wasm_uri === `string` ? wasm_uri : wasm_uri.toString()
  }

  const webview_data = { ...data, moyo_wasm_url }

  return `<!DOCTYPE html>
<html>
  <head>
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' 'unsafe-eval' 'wasm-unsafe-eval' ${webview.cspSource}; style-src 'unsafe-inline' ${webview.cspSource}; img-src ${webview.cspSource} data:; connect-src ${webview.cspSource}; worker-src blob:;">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script nonce="${nonce}">
      window.matterviz_data=${JSON.stringify(webview_data)};
    </script>
  </head>
  <body>
    <div id="matterviz-app"></div>
    <script nonce="${nonce}" src="${js_uri}"></script>
    <script nonce="${nonce}">
      window.initializeMatterViz?.();
    </script>
  </body>
</html>`
}

// Handle messages from webview
export const handle_msg = async (
  msg: MessageData,
  webview?: WebviewLike,
): Promise<void> => {
  if (msg.command === `info` && msg.text) {
    vscode.window.showInformationMessage(msg.text)
  } else if (msg.command === `error` && msg.text) {
    vscode.window.showErrorMessage(msg.text)
  } else if (msg.command === `request_large_file` && msg.file_path && webview) {
    // Handle large file by parsing with indexing and setting up frame loader
    const command = `large_file_response`
    try {
      const { request_id, file_path } = msg
      const filename = path.basename(file_path)
      const array_buffer = await stream_file_to_buffer(file_path, (progress_data) => {
        webview.postMessage({
          command: `large_file_progress`,
          request_id,
          stage: `Reading file`,
          progress: Math.round(progress_data.progress * 100),
        })
      })

      // Parse with indexing and create frame loader
      const parsed_trajectory = await parse_trajectory_async(
        array_buffer,
        filename,
        undefined,
        { use_indexing: true, extract_plot_metadata: true },
      )

      active_frame_loaders.set(file_path, {
        loader: create_frame_loader(filename),
        file_data: array_buffer,
        filename,
      })

      webview.postMessage({
        command,
        request_id,
        parsed_trajectory,
        is_parsed: true,
        supports_frame_streaming: true,
        file_path,
      })
    } catch (error) {
      const error_message = error instanceof Error ? error.message : String(error)
      console.error(`Failed to setup indexed parsing:`, error_message)
      const { request_id } = msg
      webview.postMessage({ command, request_id, error: error_message })
    }
  } else if (msg.command === `request_frame` && msg.file_path && webview) {
    try {
      const { request_id, file_path, frame_index } = msg
      if (
        typeof request_id !== `string` ||
        frame_index === undefined ||
        !Number.isInteger(frame_index) ||
        frame_index < 0
      ) {
        throw new Error(`Invalid request_id or frame_index`)
      }
      const loader_data = active_frame_loaders.get(file_path)
      if (!loader_data) throw new Error(`No frame loader found for file: ${file_path}`)

      const frame = await loader_data.loader.load_frame(
        loader_data.file_data,
        frame_index,
      )
      const command = `frame_response`
      webview.postMessage({ command, request_id, frame, frame_index })
    } catch (error) {
      const error_message = error instanceof Error ? error.message : String(error)
      console.error(`Failed to load frame ${msg.frame_index}:`, error_message)
      webview.postMessage({
        command: `frame_response`,
        request_id: msg.request_id ?? ``,
        error: error_message,
        frame_index: msg.frame_index,
      })
    }
  } else if (msg.command === `saveAs` && msg.content) {
    let is_binary_save = false
    try {
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(msg.filename || `structure`),
        filters: { 'Files': [`*`] },
      })

      if (uri && msg.content) {
        if (msg.is_binary) {
          is_binary_save = true
          const base64_data = msg.content.replace(/^data:[^;]+;base64,/, ``)
          if (!base64_data) throw new Error(`Invalid data URL: missing base64 data`)
          await vscode.workspace.fs.writeFile(
            uri,
            Uint8Array.from(Buffer.from(base64_data, `base64`)),
          )
        } else {
          await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(msg.content))
        }
        vscode.window.showInformationMessage(`Saved: ${path.basename(uri.fsPath)}`)
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      const error_type = is_binary_save ? `binary data` : `text file`
      vscode.window.showErrorMessage(`Failed to save ${error_type}: ${message}`)
    }
  } else if (
    msg.command === `startWatching` &&
    webview &&
    typeof msg.file_path === `string` &&
    path.isAbsolute(msg.file_path)
  ) {
    // Handle request to start watching a file
    start_watching_file(
      msg.file_path,
      webview,
      {
        request_id: msg.request_id,
        filename: msg.filename,
        frame_index: msg.frame_index,
      },
    )
  } else if (msg.command === `stopWatching` && msg.file_path) {
    // Handle request to stop watching a file
    stop_watching_file(msg.file_path)
  }
}

// Start watching a file using VS Code's built-in file system watcher
function start_watching_file(
  file_path: string,
  webview: WebviewLike,
  meta?: WatcherMeta,
): void {
  try {
    // Stop existing watcher for this file if any
    stop_watching_file(file_path)

    // Create a new file system watcher for this specific file
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.file(path.dirname(file_path)),
        path.basename(file_path),
      ),
    )

    // Listen for file changes
    watcher.onDidChange(() => {
      handle_file_change(`change`, file_path, webview, meta)
    })

    // Listen for file deletion
    watcher.onDidDelete(() => {
      handle_file_change(`delete`, file_path, webview, meta)
      stop_watching_file(file_path) // Clean up watcher
    })

    active_watchers.set(file_path, watcher)
  } catch (error) {
    console.error(`Failed to start watching file ${file_path}:`, error)
    webview.postMessage({
      command: `error`,
      text: `Failed to start watching file: ${error}`,
    })
  }
}

// Handle file change events from VS Code file system watcher
async function handle_file_change(
  event_type: `change` | `delete`,
  file_path: string,
  webview: WebviewLike,
  meta?: WatcherMeta,
): Promise<void> {
  if (event_type === `delete`) {
    try { // File was deleted - send notification
      webview.postMessage({ command: `fileDeleted`, file_path, ...(meta || {}) })
    } catch (error) {
      console.error(`[MatterViz] Failed to send fileDeleted message:`, error)
    }
    return
  }

  if (event_type === `change`) {
    // File was changed - send updated content
    try {
      const updated_file = await read_file(file_path)

      webview.postMessage({
        command: `fileUpdated`,
        file_path,
        data: updated_file,
        type: infer_view_type(updated_file),
        theme: get_theme(),
        ...(meta || {}),
      })
    } catch (error) {
      console.error(`[MatterViz] Failed to read updated file ${file_path}:`, error)
      try {
        webview.postMessage({
          command: `error`,
          text: `Failed to read updated file: ${error}`,
        })
      } catch (msgError) {
        console.error(`[MatterViz] Failed to send error message:`, msgError)
      }
    }
  }
}

// Stop watching a file and dispose the watcher
function stop_watching_file(file_path: string): void {
  const watcher = active_watchers.get(file_path)
  if (watcher) {
    watcher.dispose()
    active_watchers.delete(file_path)
  }

  // Also clean up frame loader for this file
  if (active_frame_loaders.has(file_path)) {
    active_frame_loaders.delete(file_path)
  }
}

// Create webview panel with common setup
function create_webview_panel(
  context: vscode.ExtensionContext,
  file_data: FileData,
  file_path?: string,
  view_column: vscode.ViewColumn = vscode.ViewColumn.Beside,
): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    `matterviz`,
    `MatterViz - ${file_data.filename}`,
    view_column,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, `dist`),
        vscode.Uri.joinPath(context.extensionUri, `../../static`),
      ],
    },
  )

  if (file_path) start_watching_file(file_path, panel.webview)

  panel.webview.html = create_html(panel.webview, context, {
    type: infer_view_type(file_data),
    data: file_data,
    theme: get_theme(),
    defaults: get_defaults(),
  })

  panel.webview.onDidReceiveMessage(
    (msg: MessageData) => handle_msg(msg, panel.webview),
    undefined,
    context.subscriptions,
  )

  // Theme change handling
  const update_theme = async () => {
    if (panel.visible) {
      const current_file = file_path ? await read_file(file_path) : file_data
      panel.webview.html = create_html(panel.webview, context, {
        type: infer_view_type(current_file),
        data: current_file,
        theme: get_theme(),
        defaults: get_defaults(),
      })
    }
  }

  const theme_listener = vscode.window.onDidChangeActiveColorTheme(update_theme)
  const config_listener = vscode.workspace.onDidChangeConfiguration(
    (event: vscode.ConfigurationChangeEvent) => {
      if (event.affectsConfiguration(`matterviz`)) update_theme()
    },
  )

  panel.onDidDispose(() => {
    theme_listener.dispose()
    config_listener.dispose()
    if (file_path) stop_watching_file(file_path)
  })

  return panel
}

// Enhanced render function with file watching
export const render = async (
  context: vscode.ExtensionContext,
  uri?: vscode.Uri,
): Promise<void> => {
  try {
    const file = await get_file(uri)
    const file_path = uri?.fsPath ||
      vscode.window.activeTextEditor?.document.fileName

    await create_webview_panel(context, file, file_path)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    vscode.window.showErrorMessage(`Failed: ${message}`)
  }
}

// Custom editor provider for MatterViz files
class Provider implements vscode.CustomReadonlyEditorProvider<vscode.CustomDocument> {
  constructor(private context: vscode.ExtensionContext) {}

  openCustomDocument(
    uri: vscode.Uri,
    _open_context: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken,
  ): vscode.CustomDocument {
    return {
      uri,
      dispose: () => {},
    }
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    webview_panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    try {
      const file_path = document.uri.fsPath

      webview_panel.webview.options = {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, `dist`),
          vscode.Uri.joinPath(this.context.extensionUri, `../../static`),
        ],
      }
      const current = await read_file(document.uri.fsPath)
      webview_panel.webview.html = create_html(
        webview_panel.webview,
        this.context,
        {
          type: infer_view_type(current),
          data: current,
          theme: get_theme(),
          defaults: get_defaults(),
        },
      )
      webview_panel.webview.onDidReceiveMessage(
        (msg: MessageData) => handle_msg(msg, webview_panel.webview),
        undefined,
        this.context.subscriptions,
      )

      // Start watching the file immediately
      start_watching_file(file_path, webview_panel.webview)

      // Listen for theme changes and update webview
      const update_theme = async () => {
        if (webview_panel.visible) {
          const current = await read_file(document.uri.fsPath)
          webview_panel.webview.html = create_html(
            webview_panel.webview,
            this.context,
            {
              type: infer_view_type(current),
              data: current,
              theme: get_theme(),
              defaults: get_defaults(),
            },
          )
        }
      }

      const theme_change_listener = vscode.window.onDidChangeActiveColorTheme(
        update_theme,
      )
      const config_change_listener = vscode.workspace.onDidChangeConfiguration(
        (event: vscode.ConfigurationChangeEvent) => {
          if (event.affectsConfiguration(`matterviz`)) update_theme()
        },
      )

      // Dispose listeners when panel is closed
      webview_panel.onDidDispose(() => {
        theme_change_listener.dispose()
        config_change_listener.dispose()

        stop_watching_file(file_path) // Clean up file watcher
      })
      // Note: webview_panel disposal is managed by VSCode for custom editors
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      vscode.window.showErrorMessage(`Failed: ${message}`)
    }
  }
}

// Activate extension
export const activate = (context: vscode.ExtensionContext) => {
  console.log(`MatterViz extension activated (v${pkg_json.version})`)

  // Set initial context for currently active editor
  update_supported_resource_context(vscode.window.activeTextEditor?.document.uri)

  context.subscriptions.push(
    vscode.commands.registerCommand(
      `matterviz.open`,
      (uri?: vscode.Uri) => render(context, uri),
    ),
    vscode.commands.registerCommand(
      `matterviz.report_bug`,
      report_bug,
    ),
    vscode.window.registerCustomEditorProvider(
      `matterviz.viewer`,
      new Provider(context),
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.workspace.onDidOpenTextDocument((document: vscode.TextDocument) => {
      // Update context on any document open
      update_supported_resource_context(document.uri)
      if (
        document.uri.scheme === `file` &&
        should_auto_render(path.basename(document.uri.fsPath))
      ) {
        const file_path = document.uri.fsPath

        // Clear existing timer and reveal existing panel if present
        const existing_timer = auto_render_timers.get(file_path)
        if (existing_timer) {
          clearTimeout(existing_timer)
          auto_render_timers.delete(file_path)
        }
        if (active_auto_render_panels.has(file_path)) {
          active_auto_render_panels.get(file_path)?.reveal(vscode.ViewColumn.One)
          return
        }

        const timer = setTimeout(async () => {
          try {
            if (
              !vscode.workspace.getConfiguration(`matterviz`).get(`auto_render`, true)
            ) return
            const panel = await create_webview_panel(
              context,
              await read_file(file_path),
              file_path,
              vscode.ViewColumn.One,
            )
            active_auto_render_panels.set(file_path, panel)
            panel.onDidDispose(() => active_auto_render_panels.delete(file_path))
          } catch (error: unknown) {
            console.error(`Error auto-rendering file:`, error)
            vscode.window.showErrorMessage(`MatterViz auto-render failed: ${error}`)
          } finally {
            auto_render_timers.delete(file_path)
          }
        }, 100) // Small delay to allow VS Code to finish opening the document

        auto_render_timers.set(file_path, timer)
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((editor: vscode.TextEditor | undefined) => {
      update_supported_resource_context(editor?.document?.uri)
    }),
  )
}

// Collect debug information for bug reporting
async function collect_debug_info(): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require(`os`) // Cursor is still using CommonJS, module-scoped ESM import broke this function on 2025-10-23

  // Check if running remotely
  const remote_name = vscode.env.remoteName
  const is_remote = !!remote_name
  const ui_kind = vscode.env.uiKind === vscode.UIKind.Desktop ? `Desktop` : `Web`

  // Get information about active files being rendered
  const active_files: {
    filename: string
    file_path: string
    file_size?: number
    has_watcher: boolean
    has_frame_loader: boolean
  }[] = []

  // Collect file stats asynchronously in parallel
  const file_stat_promises = Array.from(active_watchers.keys()).map(async (file_path) => {
    const filename = path.basename(file_path)
    let file_size: number | undefined
    try {
      const uri = vscode.Uri.file(file_path)
      file_size = (await vscode.workspace.fs.stat(uri)).size
    } catch {
      // File might not exist anymore
    }
    const has_frame_loader = active_frame_loaders.has(file_path)
    return { filename, file_path, file_size, has_watcher: true, has_frame_loader }
  })

  active_files.push(...await Promise.all(file_stat_promises))

  // Get memory usage if available (use global process object)
  const memory_usage = globalThis.process?.memoryUsage() ?? {
    rss: 0,
    heapUsed: 0,
    heapTotal: 0,
    external: 0,
    arrayBuffers: 0,
  }

  // Build debug report
  let report = `### Environment\n\n`
  report += `- **Editor**: ${vscode.env.appName}\n`
  report += `- **Editor Version**: ${vscode.version}\n`
  report += `- **MatterViz Version**: ${pkg_json.version}\n`
  report += `- **OS**: ${os.type()} ${os.platform()} ${os.arch()}\n`
  report += `- **OS Version**: ${os.release()}\n`
  report += `- **UI Kind**: ${ui_kind}\n`
  report += `- **Remote Session**: ${
    is_remote ? `Yes (${remote_name})` : `No (Local)`
  }\n\n`

  report += `### System Resources\n\n`
  report += `- **Total Memory**: ${format_bytes(os.totalmem())}\n`
  report += `- **Free Memory**: ${format_bytes(os.freemem())}\n`
  report += `- **Process RSS**: ${format_bytes(memory_usage.rss)}\n`
  report += `- **Process Heap Used**: ${format_bytes(memory_usage.heapUsed)}\n`
  report += `- **Process Heap Total**: ${format_bytes(memory_usage.heapTotal)}\n\n`

  report += `### Active Files & Extension State\n\n`
  report += `- **Active Watchers**: ${active_watchers.size}\n`
  report += `- **Active Frame Loaders**: ${active_frame_loaders.size}\n`
  report += `- **Auto-Render Timers**: ${auto_render_timers.size}\n`
  report += `- **Active Auto-Render Panels**: ${active_auto_render_panels.size}\n\n`

  if (active_files.length === 0) {
    report += `No files currently being watched/rendered.\n\n`
  } else {
    report += `Currently watching/rendering ${active_files.length} file(s):\n\n`
    for (const file_info of active_files) {
      report += `**${file_info.filename}**\n`
      report += `- **Path**: \`${file_info.file_path}\`\n`
      report += `- **Size**: ${format_bytes(file_info.file_size)}\n`
      report += `- **Has Watcher**: ${file_info.has_watcher}\n`
      report += `- **Has Frame Loader**: ${file_info.has_frame_loader}\n\n`
    }
  }

  report += `### Console Logs\n\n`
  report += `**Please check for console errors/warnings:**\n\n`
  report += `1. Open Developer Tools:\n`
  report += `   - Cursor/VSCode: Help → Toggle Developer Tools (or Cmd/Ctrl+Shift+I)\n`
  report += `2. Go to the "Console" tab\n`
  report +=
    `3. Look for any errors or warnings related to MatterViz (especially in red)\n`
  report += `4. Copy and paste any relevant error messages into your GitHub issue\n\n`
  report +=
    `Tip: You can filter console messages by typing "matterviz" in the filter box.\n\n`

  report += `---\n\n`
  report += `**Generated**: ${new Date().toISOString()}\n\n`
  report += `Please include this information when reporting bugs at:\n`
  report += `https://github.com/janosh/matterviz/issues\n`

  return report
}

// Command to report a bug with debug information
async function report_bug(): Promise<void> {
  try {
    // Collect debug information
    const debug_info = await collect_debug_info()

    // Create a new untitled document with the debug info
    const doc = await vscode.workspace.openTextDocument({
      content: debug_info,
      language: `markdown`,
    })

    await vscode.window.showTextDocument(doc, { preview: false })

    // Show a message with instructions
    const action = await vscode.window.showInformationMessage(
      `Debug information collected. Please copy this information and include it when reporting a bug on GitHub.`,
      `Copy to Clipboard`,
      `Open GitHub Issues`,
    )

    if (action === `Copy to Clipboard`) {
      await vscode.env.clipboard.writeText(debug_info)
      vscode.window.showInformationMessage(`Debug information copied to clipboard!`)
    } else if (action === `Open GitHub Issues`) {
      vscode.env.openExternal(
        vscode.Uri.parse(`https://github.com/janosh/matterviz/issues/new`),
      )
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    vscode.window.showErrorMessage(`Failed to collect debug information: ${message}`)
  }
}

// Deactivate extension and clean up resources
export const deactivate = (): void => {
  auto_render_timers.forEach(clearTimeout)
  auto_render_timers.clear()
  active_watchers.forEach((watcher) => watcher.dispose())
  active_watchers.clear()
  active_frame_loaders.clear()
  active_auto_render_panels.clear()
}
