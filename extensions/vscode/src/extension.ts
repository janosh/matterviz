import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'
import type { ThemeName } from '../../../src/lib/theme/index'
import {
  AUTO_THEME,
  COLOR_THEMES,
  is_valid_theme_mode,
} from '../../../src/lib/theme/index'
import { is_trajectory_file } from '../../../src/lib/trajectory/parse'
interface FileData {
  filename: string
  content: string
  isCompressed: boolean
}

interface WebviewData {
  type: `trajectory` | `structure`
  data: FileData
  theme: ThemeName
}

interface MessageData {
  command: string
  text?: string
  filename?: string
  content?: string
  file_path?: string
}

// Track active file watchers by file path
const active_watchers = new Map<string, vscode.FileSystemWatcher>()

// Read file from filesystem
export const read_file = (file_path: string): FileData => {
  const filename = path.basename(file_path)
  // Binary files that should be read as base64
  const is_binary = /\.(gz|traj|h5|hdf5)$/.test(filename)

  return {
    filename,
    content: is_binary
      ? fs.readFileSync(file_path).toString(`base64`)
      : fs.readFileSync(file_path, `utf8`),
    isCompressed: is_binary,
  }
}

// Get file data from URI or active editor
export const get_file = (uri?: vscode.Uri): FileData => {
  if (uri) return read_file(uri.fsPath)

  if (vscode.window.activeTextEditor) {
    return {
      filename: path.basename(vscode.window.activeTextEditor.document.fileName),
      content: vscode.window.activeTextEditor.document.getText(),
      isCompressed: false,
    }
  }

  const active_tab = vscode.window.tabGroups.activeTabGroup.activeTab
  if (
    active_tab?.input && typeof active_tab.input === `object` &&
    active_tab.input !== null && `uri` in active_tab.input
  ) {
    return read_file((active_tab.input as { uri: vscode.Uri }).uri.fsPath)
  }

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

  // Handle manual theme selection
  if (theme_setting !== AUTO_THEME) {
    return theme_setting as ThemeName
  }

  // Auto-detect from VSCode color theme
  return get_system_theme()
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

// Create HTML content for webview
export const create_html = (
  webview: vscode.Webview,
  context: vscode.ExtensionContext,
  data: WebviewData,
): string => {
  const nonce = Math.random().toString(36).slice(2, 34)
  const js_uri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, `dist`, `webview.js`),
  )
  const themes_uri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, `../../static`, `themes.js`),
  )

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' 'unsafe-eval' ${webview.cspSource}; style-src 'unsafe-inline' ${webview.cspSource}; img-src ${webview.cspSource} data:; connect-src ${webview.cspSource}; worker-src blob:;">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script nonce="${nonce}" src="${themes_uri}"></script>
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
  webview?: vscode.Webview,
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
        fs.writeFileSync(uri.fsPath, msg.content, `utf8`)
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
function start_watching_file(file_path: string, webview: vscode.Webview): void {
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
    console.log(`Started watching file: ${file_path}`)
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
  webview: vscode.Webview,
): void {
  console.log(`[MatterViz] File change detected:`, {
    file_path,
    event_type,
  })

  if (event_type === `delete`) {
    // File was deleted - send notification
    console.log(`[MatterViz] Sending fileDeleted message to webview`)
    try {
      webview.postMessage({
        command: `fileDeleted`,
        file_path,
      })
    } catch (error) {
      console.error(`[MatterViz] Failed to send fileDeleted message:`, error)
    }
    return
  }

  if (event_type === `change`) {
    // File was changed - send updated content
    try {
      console.log(`[MatterViz] Reading updated file content...`)
      const updated_file = read_file(file_path)
      const filename = path.basename(file_path)

      console.log(`[MatterViz] Sending fileUpdated message to webview:`, {
        filename,
        content_length: updated_file.content.length,
        isCompressed: updated_file.isCompressed,
      })

      webview.postMessage({
        command: `fileUpdated`,
        file_path,
        data: updated_file,
        type: is_trajectory_file(filename) ? `trajectory` : `structure`,
        theme: get_theme(),
      })
    } catch (error) {
      console.error(
        `[MatterViz] Failed to read updated file ${file_path}:`,
        error,
      )
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
    console.log(`Stopped watching file: ${file_path}`)
  }
}

// Enhanced render function with file watching
export const render = (context: vscode.ExtensionContext, uri?: vscode.Uri) => {
  try {
    const file = get_file(uri)
    const file_path = uri?.fsPath ||
      vscode.window.activeTextEditor?.document.fileName

    const panel = vscode.window.createWebviewPanel(
      `matterviz`,
      `MatterViz - ${file.filename}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, `dist`),
          vscode.Uri.joinPath(context.extensionUri, `../../static`),
        ],
      },
    )

    // Start watching the file if we have a file path
    if (file_path) {
      start_watching_file(file_path, panel.webview)
    }

    panel.webview.html = create_html(panel.webview, context, {
      type: is_trajectory_file(file.filename) ? `trajectory` : `structure`,
      data: file,
      theme: get_theme(),
    })

    panel.webview.onDidReceiveMessage(
      (msg: MessageData) => handle_msg(msg, panel.webview),
      undefined,
      context.subscriptions,
    )

    // Listen for theme changes and update webview
    const update_theme = () => {
      if (panel.visible) {
        const current_file = file_path ? read_file(file_path) : file
        panel.webview.html = create_html(panel.webview, context, {
          type: is_trajectory_file(file.filename) ? `trajectory` : `structure`,
          data: current_file,
          theme: get_theme(),
        })
      }
    }

    const theme_change_listener = vscode.window.onDidChangeActiveColorTheme(
      update_theme,
    )
    const config_change_listener = vscode.workspace.onDidChangeConfiguration(
      (event: vscode.ConfigurationChangeEvent) => {
        if (event.affectsConfiguration(`matterviz.theme`)) {
          update_theme()
        }
      },
    )

    // Dispose listeners when panel is closed
    panel.onDidDispose(() => {
      theme_change_listener.dispose()
      config_change_listener.dispose()

      // Clean up file watcher
      if (file_path) stop_watching_file(file_path)
    })
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
            },
          )
        }
      }

      const theme_change_listener = vscode.window.onDidChangeActiveColorTheme(
        update_theme,
      )
      const config_change_listener = vscode.workspace.onDidChangeConfiguration(
        (event: vscode.ConfigurationChangeEvent) => {
          if (event.affectsConfiguration(`matterviz.theme`)) {
            update_theme()
          }
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
