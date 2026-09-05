// VS Code's webview postMessage API takes a single argument (no targetOrigin),
// so unicorn's require-post-message-target-origin is a false positive here.
// oxlint-disable eslint-plugin-unicorn/require-post-message-target-origin
import {
  is_auto_renderable_filename,
  is_matterviz_filename,
} from '$lib/file-viewer/eligibility'
import { plan_host_file_transfer } from '$lib/file-viewer/host-transfer'
import type { HostTransferRejectReason } from '$lib/file-viewer/host-transfer'
import type {
  FileData,
  HostToWebviewMessage,
  WebviewBootstrapData,
  WebviewToHostMessage,
} from '$lib/file-viewer/host-protocol'
import { is_plain_object, to_error } from '$lib/utils'
import { format_bytes } from 'svelte-widgets/format'
import type { DefaultSettings, SettingType } from '$lib/settings'
import { is_valid_setting_value, merge, SETTINGS_CONFIG } from '$lib/settings'
import {
  AUTO_THEME,
  COLOR_THEMES,
  is_valid_theme_mode,
  THEME_TYPE,
  type ThemeName,
} from '$lib/theme'
// Deep imports: the $lib/trajectory barrel re-exports Svelte components and worker-backed
// modules, none of which belong in the Node host bundle
import { open_trajectory } from '$lib/trajectory/open'
import { summarize_run, type TrajectoryRun } from '$lib/trajectory/run'
import { Buffer } from 'node:buffer'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vscode from 'vscode'
import {
  MAX_STREAMING_FILE_SIZE,
  MAX_TEXT_TRAJECTORY_SIZE,
  read_indexed_trajectory_file,
} from './node-io'

// Files above this many bytes are not copied into the webview; the host indexes them and
// serves frames over postMessage (see request_large_file below)
export const LARGE_FILE_THRESHOLD = 400 * 1024 * 1024
// Plot rows per plot_metadata_stream message
const PLOT_ROWS_PER_MESSAGE = 5000

// WebviewLike and ExtensionContextLike are unions to allow both real vscode types and mock types for testing
type WebviewLike =
  | vscode.Webview
  | {
      cspSource: string
      asWebviewUri: (uri: { fsPath: string }) => string | { toString(): string }
      onDidReceiveMessage: (
        listener: (message: unknown) => void,
      ) => { dispose(): void } | undefined
      postMessage: (message: HostToWebviewMessage) => Promise<boolean> | undefined
      html: string
    }

type ExtensionContextLike =
  | vscode.ExtensionContext
  | {
      extensionUri: { fsPath: string }
      subscriptions: { dispose(): void }[]
    }

// Track active file watchers by file path
export const active_watchers = new Map<string, vscode.FileSystemWatcher>()
// Track webviews subscribed to each watched file path
export const active_watcher_subscribers = new Map<string, Set<WebviewLike>>()
// Host-indexed trajectory runs by file path, serving request_frame until disposed
export const active_runs = new Map<string, TrajectoryRun>()
// Track auto-render timers to clear them on deactivate
export const auto_render_timers = new Map<string, ReturnType<typeof setTimeout>>()
// Track active panels by URI to prevent duplicate opens
export const active_auto_render_panels = new Map<string, vscode.WebviewPanel>()
// Set from context.extension.packageJSON on activation (importing ../package.json would embed
// the whole manifest in the bundle)
let extension_version = `unknown`
// "MatterViz" entry in the Output panel. Render confirmations land here rather than as toasts:
// with auto-save every keystroke re-renders, and a notification per render buried the editor
let output_channel: vscode.LogOutputChannel | undefined
export const log_info = (message: string): void => {
  output_channel ??= vscode.window.createOutputChannel(`MatterViz`, { log: true })
  output_channel.info(message)
}

// The hashed `<prefix>*<suffix>` file in dist/assets, if the build output is there (it is
// not in tests)
const find_asset = (ext_path: string, prefix: string, suffix: string): string | undefined => {
  const assets_dir = path.join(ext_path, `dist`, `assets`)
  if (!fs.existsSync(assets_dir)) return undefined
  return fs
    .readdirSync(assets_dir)
    .find((name: string) => name.startsWith(prefix) && name.endsWith(suffix))
}

let wasm_filename_cache: string | undefined

// Symmetry analysis needs the WASM; its absence is worth a warning, a missing stylesheet is not
const get_wasm_filename = (ext_path: string): string | undefined => {
  wasm_filename_cache ??= find_asset(ext_path, `moyo_wasm_bg-`, `.wasm`)
  if (!wasm_filename_cache) console.warn(`moyo-wasm not found in ${ext_path}/dist/assets`)
  return wasm_filename_cache
}

// Update the shared VS Code context for files MatterViz can open/view
const update_supported_resource_context = (uri?: vscode.Uri): void => {
  // Prefer explicit URI; otherwise fall back to the active editor filename
  const file_path = uri?.fsPath || vscode.window.activeTextEditor?.document?.fileName || ``
  const is_supported = is_matterviz_filename(path.basename(file_path))
  vscode.commands.executeCommand(`setContext`, `matterviz.supported_resource`, is_supported)
}

const host_transfer_error = (
  reason: HostTransferRejectReason,
  filename: string,
  file_size: number,
  max_file_size: number = MAX_STREAMING_FILE_SIZE,
): Error => {
  if (reason === `file-too-large`) {
    return new Error(
      `File too large (${format_bytes(file_size)}). Maximum supported size: ${format_bytes(
        max_file_size,
      )}`,
    )
  }
  if (reason === `unsupported-compression`) {
    return new Error(`Large-file loading does not support this compression: ${filename}`)
  }
  return new Error(
    `Large-file loading currently supports trajectories only (XYZ, EXTXYZ, ASE .traj): ${filename} (${format_bytes(
      file_size,
    )})`,
  )
}

// Read file from filesystem using VSCode API (works with remote SSH)
export const read_file = async (file_path: string): Promise<FileData> => {
  const filename = path.basename(file_path)
  const uri = vscode.Uri.file(file_path)

  // Check file size to avoid loading huge files into memory
  let file_size: number
  try {
    file_size = (await vscode.workspace.fs.stat(uri)).size
  } catch (error) {
    throw new Error(`Failed to access file ${filename}: ${to_error(error).message}`, {
      cause: error,
    })
  }

  const transfer = plan_host_file_transfer({
    filename,
    file_path,
    file_size,
    large_file_threshold: LARGE_FILE_THRESHOLD,
    max_file_size: MAX_STREAMING_FILE_SIZE,
    max_text_file_size: MAX_TEXT_TRAJECTORY_SIZE,
  })
  if (transfer.kind === `reject`)
    throw host_transfer_error(transfer.reason, filename, file_size, transfer.max_file_size)
  if (transfer.kind === `marker`) {
    return { filename, content: transfer.content, is_base64: false }
  }

  // For normal-sized files, read using VSCode API
  try {
    const uint8array = await vscode.workspace.fs.readFile(uri)
    const content = transfer.is_base64
      ? Buffer.from(uint8array).toString(`base64`)
      : Buffer.from(uint8array).toString(`utf8`)
    return { filename, content, is_base64: transfer.is_base64 }
  } catch (error) {
    throw new Error(`Failed to read file ${filename}: ${to_error(error).message}`, {
      cause: error,
    })
  }
}

// Resolve the file a command should act on: explicit URI, then active editor, then active tab
const resolve_target_uri = (uri?: vscode.Uri): vscode.Uri | undefined => {
  if (uri) return uri
  if (vscode.window.activeTextEditor) return vscode.window.activeTextEditor.document.uri
  const tab_input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
  if (tab_input && typeof tab_input === `object` && `uri` in tab_input) {
    return (tab_input as { uri: vscode.Uri }).uri
  }
  return undefined
}

// Prefer the active editor buffer when it is the target so unsaved edits render
export const get_file = async (uri?: vscode.Uri): Promise<FileData> => {
  const editor = vscode.window.activeTextEditor
  if (editor && (!uri || editor.document.uri.fsPath === uri.fsPath)) {
    return {
      filename: path.basename(editor.document.fileName),
      content: editor.document.getText(),
      is_base64: false,
    }
  }
  const target = resolve_target_uri(uri)
  if (target) return read_file(target.fsPath)
  throw new Error(`No file selected. MatterViz needs an active editor to know what to render.`)
}

// The user's matterviz.theme, with `auto` resolved from VS Code's active color theme. The
// setting is an enum in package.json, so an invalid value only arrives through a hand-edited
// settings.json; surface it rather than silently rendering some other theme.
export const get_theme = (): ThemeName => {
  const theme_setting = vscode.workspace
    .getConfiguration(`matterviz`)
    .get<string>(`theme`, AUTO_THEME)
  // Same policy as read_explicit_overrides: a bad settings.json value is reported and the
  // default (follow VS Code's color theme) applies instead of breaking the viewer
  if (!is_valid_theme_mode(theme_setting)) {
    const allowed = [AUTO_THEME, ...Object.keys(COLOR_THEMES)].join(`, `)
    console.warn(
      `Ignoring invalid matterviz.theme = ${JSON.stringify(theme_setting)}; expected one of ${allowed}, following the VS Code theme`,
    )
    return get_system_theme()
  }
  return theme_setting === AUTO_THEME ? get_system_theme() : theme_setting
}

// Get system theme by mapping VSCode's current color theme kind to our theme names
const get_system_theme = (): ThemeName => {
  const theme_by_kind: Partial<Record<vscode.ColorThemeKind, ThemeName>> = {
    [vscode.ColorThemeKind.Dark]: COLOR_THEMES.dark,
    [vscode.ColorThemeKind.HighContrast]: COLOR_THEMES.black,
    [vscode.ColorThemeKind.HighContrastLight]: COLOR_THEMES.white,
  }
  return theme_by_kind[vscode.window.activeColorTheme.kind] ?? COLOR_THEMES.light
}

// A schema node is a leaf (one setting) when it carries a `value`, else a group to recurse into
const is_setting_leaf = (node: Record<string, unknown>): node is SettingType & typeof node =>
  `value` in node

// Collect user/workspace overrides via config.inspect() (ignores package defaults)
const read_explicit_overrides = (
  config: vscode.WorkspaceConfiguration,
  schema: unknown,
  prefix = ``,
): Record<string, unknown> => {
  if (!is_plain_object(schema)) return {}
  const overrides: Record<string, unknown> = {}
  for (const [key, setting] of Object.entries(schema)) {
    if (!is_plain_object(setting)) continue
    const full_key = prefix ? `${prefix}.${key}` : key
    if (!is_setting_leaf(setting)) {
      const nested = read_explicit_overrides(config, setting, full_key)
      if (Object.keys(nested).length > 0) overrides[key] = nested
      continue
    }
    const inspected = config.inspect(full_key)
    // Prefer more specific scope: folder > workspace > global
    const value = [
      inspected?.workspaceFolderValue,
      inspected?.workspaceValue,
      inspected?.globalValue,
    ].find((candidate) => candidate !== undefined)
    if (value === undefined) continue
    // Same admissibility rule as the persisted viewer state: an out-of-range or mistyped
    // settings.json value is reported and the schema default applies through merge()
    if (!is_valid_setting_value(value, setting)) {
      console.warn(
        `Ignoring invalid matterviz.${full_key} = ${JSON.stringify(value)}; using the default ${JSON.stringify(setting.value)}`,
      )
      continue
    }
    overrides[key] = value
  }
  return overrides
}

// Schema defaults overlaid with the user's explicit matterviz.* settings
export const get_defaults = (): DefaultSettings =>
  merge(
    read_explicit_overrides(vscode.workspace.getConfiguration(`matterviz`), SETTINGS_CONFIG),
  )

// Create HTML content for webview
export const create_html = (
  webview: WebviewLike,
  context: ExtensionContextLike,
  data: WebviewBootstrapData,
): string => {
  const nonce = Math.random().toString(36).slice(2, 34)
  const ext_path = context.extensionUri.fsPath
  // Webview-loadable URL for a file under dist/
  const dist_uri = (...segments: string[]): string =>
    String(
      webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri as vscode.Uri, `dist`, ...segments),
      ),
    )
  const js_uri = dist_uri(`webview.js`)
  const css_file = find_asset(ext_path, `main-`, `.css`)
  const css_href = css_file && dist_uri(`assets`, css_file)
  // The WASM URL rides in the bootstrap data (enables symmetry analysis)
  const wasm_filename = get_wasm_filename(ext_path)
  const moyo_wasm_url = wasm_filename && dist_uri(`assets`, wasm_filename)

  const webview_data = { ...data, moyo_wasm_url }
  // Set color-scheme before main-*.css loads, or its light-dark() tokens flash white/light
  // until JS applies the theme. Must be a style attribute, not a <style> rule: it needs to
  // outrank main-*.css's own same-specificity `:root, :host { color-scheme: light dark }`.
  // THEME_TYPE, not a ternary: it is a Record over ThemeName, so a new theme is a type
  // error there rather than silently rendering light here.
  const color_scheme = THEME_TYPE[data.theme]
  const root_style = `color-scheme: ${color_scheme}; background-color: var(--vscode-editor-background, Canvas);`

  return `<!DOCTYPE html>
<html style="${root_style}">
  <head>
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' 'unsafe-eval' 'wasm-unsafe-eval' ${webview.cspSource}; style-src 'unsafe-inline' ${webview.cspSource}; img-src ${webview.cspSource} data:; connect-src ${webview.cspSource}; worker-src blob:;">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${css_href ? `<link rel="stylesheet" href="${css_href}">` : ``}
    <script nonce="${nonce}">
      window.matterviz_data=${JSON.stringify(webview_data).replaceAll(`</`, `<\\/`)};
    </script>
  </head>
  <body>
    <div id="matterviz-app"></div>
    <script nonce="${nonce}" type="module">
      await import(${JSON.stringify(js_uri)});
      window.initializeMatterViz?.();
    </script>
  </body>
</html>`
}

// Handle messages from webview
export const handle_msg = async (
  msg: WebviewToHostMessage,
  webview?: WebviewLike,
): Promise<void> => {
  if (msg.command === `info` && msg.text) {
    log_info(msg.text)
  } else if (msg.command === `error` && msg.text) {
    vscode.window.showErrorMessage(msg.text)
  } else if (msg.command === `request_large_file` && msg.file_path && webview) {
    // Index the file here (the payload never crosses into the webview), answer with the run
    // summary, then stream its per-frame plot rows as they are extracted
    const command = `large_file_response`
    try {
      const { request_id, file_path } = msg
      if (typeof request_id !== `string` || !request_id) throw new Error(`Invalid request_id`)
      const filename = path.basename(file_path)
      const indexed_file = await read_indexed_trajectory_file(file_path, filename)
      // index_above_bytes: 0 forces the lazily decoded run regardless of the user setting
      const run = await open_trajectory(indexed_file.data, {
        filename: indexed_file.filename,
        index_above_bytes: 0,
      })
      active_runs.get(file_path)?.dispose()
      active_runs.set(file_path, run)
      stream_plot_rows(run, file_path, webview)
      webview.postMessage({ command, request_id, run_summary: summarize_run(run) })
    } catch (error) {
      const error_message = to_error(error).message
      console.error(`Failed to setup indexed parsing:`, error_message)
      webview.postMessage({ command, request_id: msg.request_id, error: error_message })
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
      const run = active_runs.get(file_path)
      if (!run) throw new Error(`No indexed trajectory is open for file: ${file_path}`)
      const frame = await run.read_frame(frame_index)
      webview.postMessage({ command: `frame_response`, request_id, frame, frame_index })
    } catch (error) {
      const error_message = to_error(error).message
      console.error(`Failed to load frame ${msg.frame_index}:`, error_message)
      webview.postMessage({
        command: `frame_response`,
        request_id: msg.request_id,
        error: error_message,
        frame_index: msg.frame_index,
      })
    }
  } else if (msg.command === `saveAs` && msg.content) {
    let is_binary_save = false
    try {
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(msg.filename ?? `structure`),
        filters: { Files: [`*`] },
      })

      if (uri) {
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
      const message = to_error(error).message
      const error_type = is_binary_save ? `binary data` : `text file`
      vscode.window.showErrorMessage(`Failed to save ${error_type}: ${message}`)
    }
  }
}

// Forward the run's plot rows to the webview in batches: rows extracted before the summary
// went out are in the summary itself, later ones arrive as plot_metadata_stream messages
function stream_plot_rows(run: TrajectoryRun, file_path: string, webview: WebviewLike): void {
  const post = (rows: TrajectoryRun[`properties`][`rows`], complete: boolean): void =>
    post_to_webview(
      webview,
      { command: `plot_metadata_stream`, file_path, rows: [...rows], complete },
      `plot_metadata_stream`,
    )
  if (run.properties.complete) return
  let pending: TrajectoryRun[`properties`][`rows`] = []
  const unsubscribe = run.properties.subscribe((batch, complete) => {
    pending = [...pending, ...batch]
    if (!complete && pending.length < PLOT_ROWS_PER_MESSAGE) return
    post(pending, complete)
    pending = []
    if (complete) unsubscribe()
  })
}

// Start watching a file using VS Code's built-in file system watcher
function start_watching_file(file_path: string, webview: WebviewLike): void {
  try {
    const subscribers = active_watcher_subscribers.get(file_path) ?? new Set<WebviewLike>()
    subscribers.add(webview)
    active_watcher_subscribers.set(file_path, subscribers)
    if (active_watchers.has(file_path)) return // reuse the existing shared watcher

    // Create a new file system watcher for this specific file
    const file_dir = vscode.Uri.file(path.dirname(file_path))
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(file_dir, path.basename(file_path)),
    )

    // Read once on change, then fan out to every subscribed panel
    watcher.onDidChange(() => {
      const change_subscribers = [...(active_watcher_subscribers.get(file_path) ?? [])]
      if (change_subscribers.length > 0) {
        void broadcast_file_updated(file_path, change_subscribers)
      }
    })

    watcher.onDidDelete(() => {
      for (const subscriber of active_watcher_subscribers.get(file_path) ?? []) {
        post_to_webview(subscriber, { command: `fileDeleted`, file_path }, `fileDeleted`)
      }
      stop_watching_file(file_path)
    })

    active_watchers.set(file_path, watcher)
  } catch (error) {
    active_watcher_subscribers.delete(file_path)
    console.error(`Failed to start watching file ${file_path}:`, error)
    // Shown here, not posted into the webview: the webview has no error surface of its own -
    // it reports errors TO the host for exactly this treatment - so a posted one was dropped
    // and the user was told nothing while the view silently stopped following the file.
    vscode.window.showErrorMessage(`MatterViz: failed to start watching file: ${error}`)
  }
}

function post_to_webview(
  webview: WebviewLike,
  message: HostToWebviewMessage,
  label: string,
): void {
  try {
    webview.postMessage(message)
  } catch (error) {
    console.error(`[MatterViz] Failed to send ${label} message:`, error)
  }
}

async function broadcast_file_updated(
  file_path: string,
  subscribers: WebviewLike[],
): Promise<void> {
  try {
    dispose_run(file_path)
    const data = await read_file(file_path)
    const theme = get_theme()
    for (const webview of subscribers) {
      post_to_webview(
        webview,
        { command: `fileUpdated`, file_path, data, theme },
        `fileUpdated`,
      )
    }
  } catch (error) {
    console.error(`[MatterViz] Failed to read updated file ${file_path}:`, error)
    // Once per failure, not once per subscriber, and shown rather than posted: the webview
    // never read a host `error` message, so this left every view on a stale render in silence.
    vscode.window.showErrorMessage(`MatterViz: failed to read updated file: ${error}`)
  }
}

// Stop watching a file and dispose the watcher
function stop_watching_file(file_path: string, webview?: WebviewLike): void {
  const subscribers = active_watcher_subscribers.get(file_path)
  if (webview && subscribers) {
    subscribers.delete(webview)
    if (subscribers.size > 0) return
  }

  active_watcher_subscribers.delete(file_path)

  const watcher = active_watchers.get(file_path)
  if (watcher) {
    watcher.dispose()
    active_watchers.delete(file_path)
  }

  dispose_run(file_path)
}

const dispose_run = (file_path: string): void => {
  active_runs.get(file_path)?.dispose()
  active_runs.delete(file_path)
}

// Resolve which ViewColumn to use based on user settings and explicit override
function get_view_column(explicit?: vscode.ViewColumn): vscode.ViewColumn {
  if (explicit !== undefined) return explicit
  const open_beside = vscode.workspace.getConfiguration(`matterviz`).get(`open_beside`, false)
  return open_beside ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active
}

const webview_resource_roots = (context: vscode.ExtensionContext): vscode.Uri[] => [
  vscode.Uri.joinPath(context.extensionUri, `dist`),
]

// Shared panel wiring: html, message handling, file watching, theme/config refresh,
// and cleanup on dispose. Used by both render() panels and the custom editor provider.
function setup_webview_panel(
  context: vscode.ExtensionContext,
  panel: vscode.WebviewPanel,
  file_data: FileData,
  file_path?: string,
): void {
  if (file_path) start_watching_file(file_path, panel.webview)

  panel.webview.html = create_html(panel.webview, context, {
    data: file_data,
    theme: get_theme(),
    defaults: get_defaults(),
  })

  const message_listener = panel.webview.onDidReceiveMessage(
    (msg: WebviewToHostMessage) => handle_msg(msg, panel.webview),
    undefined,
  )

  // Push fresh theme/settings into the live webview. Rebuilding the HTML instead would
  // re-read the file from disk (discarding an unsaved editor buffer) and re-parse it.
  const post_settings = () =>
    post_to_webview(
      panel.webview,
      { command: `settingsChanged`, theme: get_theme(), defaults: get_defaults() },
      `settingsChanged`,
    )

  const theme_listener = vscode.window.onDidChangeActiveColorTheme(post_settings)
  const config_listener = vscode.workspace.onDidChangeConfiguration(
    (event: vscode.ConfigurationChangeEvent) => {
      if (event.affectsConfiguration(`matterviz`)) post_settings()
    },
  )

  panel.onDidDispose(() => {
    message_listener.dispose()
    theme_listener.dispose()
    config_listener.dispose()
    if (file_path) stop_watching_file(file_path, panel.webview)
  })
}

// Create webview panel with common setup
function create_webview_panel(
  context: vscode.ExtensionContext,
  file_data: FileData,
  file_path?: string,
  view_column?: vscode.ViewColumn,
): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    `matterviz`,
    `MatterViz - ${file_data.filename}`,
    get_view_column(view_column),
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: webview_resource_roots(context),
    },
  )
  setup_webview_panel(context, panel, file_data, file_path)
  return panel
}

// Enhanced render function with file watching
export const render = async (
  context: vscode.ExtensionContext,
  uri?: vscode.Uri,
): Promise<void> => {
  try {
    const target = resolve_target_uri(uri)
    const file = await get_file(uri)
    // Use the same resolved path as get_file so active-tab fallbacks still get a watcher
    create_webview_panel(context, file, target?.fsPath)
  } catch (error: unknown) {
    vscode.window.showErrorMessage(`Failed: ${to_error(error).message}`)
  }
}

const open_resource = async (
  context: vscode.ExtensionContext,
  uri?: vscode.Uri,
): Promise<void> => {
  const target = resolve_target_uri(uri)
  if (!target) {
    vscode.window.showErrorMessage(
      `No file selected. MatterViz needs an active editor to know what to render.`,
    )
    return
  }

  const filename = path.basename(target.fsPath)
  if (!is_matterviz_filename(filename)) {
    vscode.window.showErrorMessage(
      `MatterViz cannot open ${filename} because it is not a supported structure or trajectory file.`,
    )
    return
  }

  await render(context, target)
}

// Custom editor provider for MatterViz files
class Provider implements vscode.CustomReadonlyEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

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
        localResourceRoots: webview_resource_roots(this.context),
      }
      setup_webview_panel(this.context, webview_panel, await read_file(file_path), file_path)
      // Note: webview_panel disposal is managed by VSCode for custom editors
    } catch (error: unknown) {
      vscode.window.showErrorMessage(`Failed: ${to_error(error).message}`)
    }
  }
}

// Activate extension
export const activate = (context: vscode.ExtensionContext) => {
  extension_version = String(context.extension.packageJSON.version)
  log_info(`MatterViz extension activated (v${extension_version})`)

  // Set initial context for currently active editor
  update_supported_resource_context(vscode.window.activeTextEditor?.document.uri)

  context.subscriptions.push(
    vscode.commands.registerCommand(`matterviz.open`, (uri?: vscode.Uri) =>
      open_resource(context, uri),
    ),
    vscode.commands.registerCommand(`matterviz.report_bug`, report_bug),
    vscode.window.registerCustomEditorProvider(`matterviz.viewer`, new Provider(context), {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.workspace.onDidOpenTextDocument((document: vscode.TextDocument) => {
      // Update context on any document open
      update_supported_resource_context(document.uri)
      // Auto-open only unambiguous structure/trajectory files (not JSON/YAML keyword matches)
      if (
        document.uri.scheme === `file` &&
        is_auto_renderable_filename(path.basename(document.uri.fsPath))
      ) {
        const file_path = document.uri.fsPath

        // Clear existing timer and reveal existing panel if present
        const existing_timer = auto_render_timers.get(file_path)
        if (existing_timer) {
          clearTimeout(existing_timer)
          auto_render_timers.delete(file_path)
        }
        const existing_panel = active_auto_render_panels.get(file_path)
        if (existing_panel) {
          existing_panel.reveal(vscode.ViewColumn.One)
          return
        }

        const timer = setTimeout(() => {
          void (async () => {
            try {
              if (!vscode.workspace.getConfiguration(`matterviz`).get(`auto_render`, true))
                return
              const panel = create_webview_panel(
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
          })()
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
  // Check if running remotely
  const remote_name = vscode.env.remoteName
  const is_remote = Boolean(remote_name)
  const ui_kind = vscode.env.uiKind === vscode.UIKind.Desktop ? `Desktop` : `Web`

  // Collect info about actively watched/rendered files (stats fetched in parallel)
  const active_files = await Promise.all(
    Array.from(active_watchers.keys()).map(async (file_path) => {
      const filename = path.basename(file_path)
      let file_size: number | undefined
      try {
        file_size = (await vscode.workspace.fs.stat(vscode.Uri.file(file_path))).size
      } catch {
        // File might not exist anymore
      }
      const has_trajectory_run = active_runs.has(file_path)
      return { filename, file_path, file_size, has_watcher: true, has_trajectory_run }
    }),
  )

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
  report += `- **MatterViz Version**: ${extension_version}\n`
  report += `- **OS**: ${os.type()} ${os.platform()} ${os.arch()}\n`
  report += `- **OS Version**: ${os.release()}\n`
  report += `- **UI Kind**: ${ui_kind}\n`
  report += `- **Remote Session**: ${is_remote ? `Yes (${remote_name})` : `No (Local)`}\n\n`

  report += `### System Resources\n\n`
  report += `- **Total Memory**: ${format_bytes(os.totalmem())}\n`
  report += `- **Free Memory**: ${format_bytes(os.freemem())}\n`
  report += `- **Process RSS**: ${format_bytes(memory_usage.rss)}\n`
  report += `- **Process Heap Used**: ${format_bytes(memory_usage.heapUsed)}\n`
  report += `- **Process Heap Total**: ${format_bytes(memory_usage.heapTotal)}\n\n`

  report += `### Active Files & Extension State\n\n`
  report += `- **Active Watchers**: ${active_watchers.size}\n`
  report += `- **Active Trajectory Runs**: ${active_runs.size}\n`
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
      report += `- **Has Trajectory Run**: ${file_info.has_trajectory_run}\n\n`
    }
  }

  report += `### Console Logs\n\n`
  report += `**Please check for console errors/warnings:**\n\n`
  report += `1. Open Developer Tools:\n`
  report += `   - Cursor/VSCode: Help → Toggle Developer Tools (or Cmd/Ctrl+Shift+I)\n`
  report += `2. Go to the "Console" tab\n`
  report += `3. Look for any errors or warnings related to MatterViz (especially in red)\n`
  report += `4. Copy and paste any relevant error messages into your GitHub issue\n\n`
  report += `Tip: You can filter console messages by typing "matterviz" in the filter box.\n\n`

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
    vscode.window.showErrorMessage(
      `Failed to collect debug information: ${to_error(error).message}`,
    )
  }
}

// Deactivate extension and clean up resources
export const deactivate = (): void => {
  auto_render_timers.forEach(clearTimeout)
  auto_render_timers.clear()
  active_watchers.forEach((watcher) => watcher.dispose())
  active_watchers.clear()
  active_watcher_subscribers.clear()
  for (const run of active_runs.values()) run.dispose()
  active_runs.clear()
  active_auto_render_panels.clear()
  output_channel?.dispose()
  output_channel = undefined
}
