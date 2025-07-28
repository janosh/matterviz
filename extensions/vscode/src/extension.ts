import { is_structure_file } from '$lib/io/parse'
import type { ThemeName } from '$lib/theme'
import { is_trajectory_file } from '$lib/trajectory/parse'
import * as fs from 'fs'
import { Buffer } from 'node:buffer'
import * as path from 'path'
import * as vscode from 'vscode'
import { DEFAULTS, type DefaultSettings, merge } from '../../../src/lib/settings'

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
  subscriptions: Array<{ dispose(): void }>
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
  isCompressed: boolean
}

interface WebviewData {
  type: `trajectory` | `structure`
  data: FileData
  theme: ThemeName
  defaults?: DefaultSettings
}

export interface MessageData {
  command: string
  text?: string
  filename?: string
  file_size?: number
  content?: string
  is_binary?: boolean
  file_path?: string
}

// Theme constants (copied from $lib/theme to avoid import issues)
const AUTO_THEME = `auto` as const
const COLOR_THEMES = {
  light: `light`,
  dark: `dark`,
  white: `white`,
  black: `black`,
} as const

const is_valid_theme_mode = (value: string): value is ThemeName | typeof AUTO_THEME =>
  Object.keys(COLOR_THEMES).includes(value) || value === AUTO_THEME

// Track active file watchers by file path
const active_watchers = new Map<string, vscode.FileSystemWatcher>()

// Check if a file should be auto-rendered
export const should_auto_render = (filename: string): boolean => {
  if (!filename || typeof filename !== `string`) return false
  return is_structure_file(filename) || is_trajectory_file(filename)
}

// Update the shared VS Code context for supported resources
const update_supported_resource_context = (uri?: vscode.Uri): void => {
  const filename = uri?.fsPath ? path.basename(uri.fsPath) : ``
  const is_supported = should_auto_render(filename)
  vscode.commands.executeCommand(
    `setContext`,
    `matterviz.supportedResource`,
    is_supported,
  )
}

// Read file from filesystem
export const read_file = (file_path: string): FileData => {
  const filename = path.basename(file_path)
  // Binary files that should be read as base64
  const is_binary = /\.(gz|traj|h5|hdf5)$/.test(filename)

  const content = is_binary
    ? fs.readFileSync(file_path).toString(`base64`)
    : fs.readFileSync(file_path, `utf8`)
  return { filename, content, isCompressed: is_binary }
}

// Get file data from URI or active editor
export const get_file = (uri?: vscode.Uri): FileData => {
  if (uri) return read_file(uri.fsPath)

  if (vscode.window.activeTextEditor) {
    const filename = path.basename(vscode.window.activeTextEditor.document.fileName)
    const content = vscode.window.activeTextEditor.document.getText()
    return { filename, content, isCompressed: false }
  }

  const active_tab = vscode.window.tabGroups.activeTabGroup.activeTab
  if (
    active_tab?.input && typeof active_tab.input === `object` &&
    active_tab.input !== null && `uri` in active_tab.input
  ) return read_file(active_tab.input.uri.fsPath)

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

// Settings reader with nested structure support
export const get_defaults = (): DefaultSettings => {
  const config = vscode.workspace.getConfiguration(`matterviz`)
  const defaults_config = config.get(`defaults`, {})
  const user_settings: Partial<DefaultSettings> = {}

  // Helper to read settings section
  const read_section = (
    section_key: keyof DefaultSettings,
    defaults_section: Record<string, unknown>,
  ) => {
    const settings: Record<string, unknown> = {}
    for (const key of Object.keys(defaults_section)) {
      const value = section_key === `structure` || section_key === `trajectory` ||
          section_key === `composition`
        ? defaults_config[section_key]?.[key]
        : defaults_config[key]
      if (value !== undefined) settings[key] = value
    }
    return Object.keys(settings).length > 0 ? settings : undefined
  }

  // Read all settings sections
  const general_keys = [
    `color_scheme`,
    `background_color`,
    `background_opacity`,
    `show_image_atoms`,
    `show_gizmo`,
  ] as const
  for (const key of general_keys) {
    if (defaults_config[key] !== undefined) {
      user_settings[key] = defaults_config[key]
    }
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

  return `<!DOCTYPE html>
<html>
  <head>
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' 'unsafe-eval' ${webview.cspSource}; style-src 'unsafe-inline' ${webview.cspSource}; img-src ${webview.cspSource} data:; connect-src ${webview.cspSource}; worker-src blob:;">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script nonce="${nonce}">window.mattervizData=${JSON.stringify(data)}</script>
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
  } else if (msg.command === `saveAs` && msg.content) {
    try {
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(msg.filename || `structure`),
        filters: { 'Files': [`*`] },
      })

      if (uri && msg.content) {
        if (msg.is_binary) {
          // Handle binary data (PNG images) - extract base64 from data URL
          try {
            const base64_data = msg.content.replace(/^data:[^;]+;base64,/, ``)
            if (!base64_data) {
              throw new Error(`Invalid data URL: missing base64 data`)
            }
            const buffer = Buffer.from(base64_data, `base64`)
            fs.writeFileSync(uri.fsPath, buffer)
          } catch (error) {
            const error_message = error instanceof Error ? error.message : String(error)
            vscode.window.showErrorMessage(`Failed to save binary data: ${error_message}`)
            return
          }
        } else {
          // Handle text data (JSON, XYZ)
          fs.writeFileSync(uri.fsPath, msg.content, `utf8`)
        }
        vscode.window.showInformationMessage(
          `Saved: ${path.basename(uri.fsPath)}`,
        )
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      vscode.window.showErrorMessage(`Save failed: ${message}`)
    }
  } else if (msg.command === `startWatching` && msg.file_path && webview) {
    // Handle request to start watching a file
    start_watching_file(msg.file_path, webview)
  } else if (msg.command === `stopWatching` && msg.file_path) {
    // Handle request to stop watching a file
    stop_watching_file(msg.file_path)
  }
}

// Start watching a file using VS Code's built-in file system watcher
function start_watching_file(file_path: string, webview: WebviewLike): void {
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
      handle_file_change(`change`, file_path, webview)
    })

    // Listen for file deletion
    watcher.onDidDelete(() => {
      handle_file_change(`delete`, file_path, webview)
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
function handle_file_change(
  event_type: `change` | `delete`,
  file_path: string,
  webview: WebviewLike,
): void {
  if (event_type === `delete`) {
    try { // File was deleted - send notification
      webview.postMessage({ command: `fileDeleted`, file_path })
    } catch (error) {
      console.error(`[MatterViz] Failed to send fileDeleted message:`, error)
    }
    return
  }

  if (event_type === `change`) {
    // File was changed - send updated content
    try {
      const updated_file = read_file(file_path)
      const filename = path.basename(file_path)

      webview.postMessage({
        command: `fileUpdated`,
        file_path,
        data: updated_file,
        type: is_trajectory_file(filename) ? `trajectory` : `structure`,
        theme: get_theme(),
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
    type: is_trajectory_file(file_data.filename) ? `trajectory` : `structure`,
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
  const update_theme = () => {
    if (panel.visible) {
      const current_file = file_path ? read_file(file_path) : file_data
      panel.webview.html = create_html(panel.webview, context, {
        type: is_trajectory_file(file_data.filename) ? `trajectory` : `structure`,
        data: current_file,
        theme: get_theme(),
        defaults: get_defaults(),
      })
    }
  }

  const theme_listener = vscode.window.onDidChangeActiveColorTheme(update_theme)
  const config_listener = vscode.workspace.onDidChangeConfiguration(
    (event: vscode.ConfigurationChangeEvent) => {
      if (
        event.affectsConfiguration(`matterviz.theme`) ||
        event.affectsConfiguration(`matterviz.defaults`)
      ) update_theme()
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
export const render = (context: vscode.ExtensionContext, uri?: vscode.Uri) => {
  try {
    const file = get_file(uri)
    const file_path = uri?.fsPath ||
      vscode.window.activeTextEditor?.document.fileName

    create_webview_panel(context, file, file_path)
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

  resolveCustomEditor(
    document: vscode.CustomDocument,
    webview_panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ) {
    try {
      const filename = path.basename(document.uri.fsPath)
      const file_path = document.uri.fsPath

      webview_panel.webview.options = {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, `dist`),
          vscode.Uri.joinPath(this.context.extensionUri, `../../static`),
        ],
      }
      webview_panel.webview.html = create_html(
        webview_panel.webview,
        this.context,
        {
          type: is_trajectory_file(filename) ? `trajectory` : `structure`,
          data: read_file(document.uri.fsPath),
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
      const update_theme = () => {
        if (webview_panel.visible) {
          webview_panel.webview.html = create_html(
            webview_panel.webview,
            this.context,
            {
              type: is_trajectory_file(filename) ? `trajectory` : `structure`,
              data: read_file(document.uri.fsPath),
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
          if (
            event.affectsConfiguration(`matterviz.theme`) ||
            event.affectsConfiguration(`matterviz.defaults`)
          ) update_theme()
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
export const activate = (context: vscode.ExtensionContext): void => {
  // Set initial context for currently active editor
  update_supported_resource_context(vscode.window.activeTextEditor?.document.uri)

  context.subscriptions.push(
    vscode.commands.registerCommand(
      `matterviz.renderStructure`,
      (uri?: vscode.Uri) => render(context, uri),
    ),
    vscode.window.registerCustomEditorProvider(
      `matterviz.viewer`,
      new Provider(context),
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.workspace.onDidOpenTextDocument((document: vscode.TextDocument) => {
      if (
        document.uri.scheme === `file` &&
        should_auto_render(path.basename(document.uri.fsPath))
      ) {
        setTimeout(() => {
          try {
            if (
              !vscode.workspace.getConfiguration(`matterviz`).get<boolean>(
                `autoRender`,
                true,
              )
            ) return
            const file_data = read_file(document.uri.fsPath)
            create_webview_panel(
              context,
              file_data,
              document.uri.fsPath,
              vscode.ViewColumn.One,
            )
          } catch (error: unknown) {
            console.error(`Error auto-rendering file:`, error)
            vscode.window.showErrorMessage(`MatterViz auto-render failed: ${error}`)
          }
        }, 100) // Small delay to allow VS Code to finish opening the document
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((editor: vscode.TextEditor | undefined) => {
      update_supported_resource_context(editor?.document.uri)
    }),
  )
}

// Deactivate extension
export const deactivate = (): void => {
  // Clean up all active file watchers
  for (const watcher of active_watchers.values()) {
    watcher.dispose()
  }
  active_watchers.clear()
}
