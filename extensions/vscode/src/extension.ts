// VS Code's webview postMessage API takes a single argument (no targetOrigin),
// so unicorn's require-post-message-target-origin is a false positive here.
// oxlint-disable eslint-plugin-unicorn/require-post-message-target-origin
import {
  is_auto_renderable_filename,
  is_matterviz_filename,
} from '#lib/file-viewer/eligibility.js'
import { plan_host_file_transfer } from '#lib/file-viewer/host-transfer.js'
import { text_encoding_of } from '#lib/io/decompress.js'
import type { HostTransferRejectReason } from '#lib/file-viewer/host-transfer.js'
import type {
  FileData,
  HostToWebviewMessage,
  WebviewBootstrapData,
  WebviewToHostMessage,
  WireFrame,
} from '#lib/file-viewer/host-protocol.js'
import {
  frame_to_wire,
  HostFileError,
  wire_frame_bytes,
} from '#lib/file-viewer/host-protocol.js'
import { format_bytes } from 'svelte-widgets/format'
import { is_plain_object, to_error } from 'svelte-widgets/utils'
import type { DefaultSettings, SettingType } from '#lib/settings.js'
import { is_valid_setting_value, merge, SETTINGS_CONFIG } from '#lib/settings.js'
import type { ThemeName } from '#lib/theme/index.js'
import { AUTO_THEME, COLOR_THEMES, is_valid_theme_mode, THEME_TYPE } from '#lib/theme/index.js'
// Deep imports: the #lib/trajectory barrel re-exports Svelte components and worker-backed
// modules, none of which belong in the Node host bundle
import { open_trajectory } from '#lib/trajectory/open.js'
import { create_warning_collector, post_new_warnings } from '#lib/trajectory/parse/shared.js'
import { index_xyz_file } from '#lib/trajectory/parse/xyz.js'
import { indexed_text_run } from '#lib/trajectory/runs/indexed-text.js'
import { summarize_run, type TrajectoryRun } from '#lib/trajectory/run.js'
import { encode_frame } from '#lib/trajectory/frame.js'
import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import * as file_system from 'node:fs'
import * as operating_system from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import * as vscode from 'vscode'
import {
  file_byte_source,
  MAX_STREAMING_FILE_SIZE,
  read_indexed_trajectory_file,
} from './node-io'

// Files above this many bytes are not copied into the webview; the host indexes them and
// serves frames over postMessage (see request_large_file below)
export const LARGE_FILE_THRESHOLD = 400 * 1024 * 1024
// In a remote window (Remote-SSH, WSL, containers) the extension host sits with the file and
// every inline byte crosses the network before anything renders, so indexable trajectories
// past this size stream frame by frame instead (see plan_host_file_transfer's stream_above)
export const REMOTE_STREAM_ABOVE_BYTES = 8 * 1024 * 1024
// Uncompressed files whose frames the host reads straight off disk (see open_file_run)
const DISK_RUN_REGEX = /\.(traj|xyz|extxyz)$/i
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
// The file each panel was opened on, the only one it may request: kept apart from watcher
// subscriptions so a failed watcher doesn't also lock the panel out of its own file
export const webview_file_paths = new Map<WebviewLike, string>()
// Host-indexed trajectory runs by file path, shared by its panels and serving request_frame.
// Stored as the loading promise, so concurrent requests share one read of the file and a file
// change (dispose_run) evicts a load still in flight instead of letting its stale run land.
export const active_runs = new Map<string, Promise<TrajectoryRun>>()
// Atomic numbers of each run's summary preview (frame 0): frames with the same ones omit them
// (WireFrame sites 'preview'), as the webview holds that preview
const run_preview_sites = new WeakMap<TrajectoryRun, Uint8Array>()
// Per webview, what stops forwarding its host-served run's rows and warnings (or cancels its
// load in flight): replaced when the webview requests a run again, called on panel close
export const webview_run_streams = new Map<WebviewLike, () => void>()
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
const log_info = (message: string): void => {
  output_channel ??= vscode.window.createOutputChannel(`MatterViz`, { log: true })
  output_channel.info(message)
}
// matterviz.telemetry: one `telemetry {json}` line per measurement in the MatterViz output
// channel (VS Code also writes it to the extension host's log folder, on the remote machine
// for Remote-SSH). Webview summaries carry their own kind; host-side records are added here.
const telemetry_enabled = (): boolean =>
  vscode.workspace.getConfiguration(`matterviz`).get(`telemetry`, false)
const log_telemetry = (record: Record<string, unknown> & { kind: string }): void =>
  log_info(`telemetry ${JSON.stringify({ ...record, side: record.side ?? `host` })}`)
// Frames and bytes this host posted per file in the current window, including frames the
// webview superseded before they arrived (which its own summaries never see)
const posted_frames = new Map<string, { frames: number; bytes: number; since: number }>()
const TELEMETRY_WINDOW_MS = 2000
const count_posted_frame = (file_path: string, frame: WireFrame): void => {
  const now = performance.now()
  const window = posted_frames.get(file_path) ?? { frames: 0, bytes: 0, since: now }
  window.frames++
  window.bytes += wire_frame_bytes(frame)
  posted_frames.set(file_path, window)
  if (now - window.since < TELEMETRY_WINDOW_MS) return
  const window_s = (now - window.since) / 1000
  log_telemetry({
    kind: `host_frames`,
    file: path.basename(file_path),
    window_s: Number(window_s.toFixed(2)),
    frames_posted: window.frames,
    posted_mbit_s: Number(((window.bytes * 8) / 1e6 / window_s).toFixed(2)),
  })
  posted_frames.delete(file_path)
}

// What the webview build's manifest lists for its entry, read once: the stylesheet, the
// symmetry WASM and the scripts the page needs before it runs, i.e. the entry and every chunk
// it statically imports. Preloaded, those load together instead of each being requested once
// its importer arrived, a round trip to the remote host per level in a Remote-SSH window.
type ManifestChunk = { file: string; imports?: string[]; css?: string[]; assets?: string[] }
let webview_files: { scripts: string[]; css?: string; wasm?: string } | undefined
const get_webview_files = (ext_path: string): NonNullable<typeof webview_files> => {
  if (webview_files) return webview_files
  const manifest_path = path.join(ext_path, `dist`, `manifest.json`)
  const manifest = JSON.parse(file_system.readFileSync(manifest_path, `utf8`)) as Record<
    string,
    ManifestChunk & { isEntry?: boolean }
  >
  const entry = Object.values(manifest).find((chunk) => chunk.isEntry)
  if (!entry) throw new Error(`${manifest_path} lists no entry`)
  const scripts = new Set<string>()
  const add_script = ({ file, imports = [] }: ManifestChunk): void => {
    if (scripts.has(file)) return
    scripts.add(file)
    for (const key of imports) add_script(manifest[key])
  }
  add_script(entry)
  const wasm = entry.assets?.find((name) => /moyo_wasm_bg-.*\.wasm$/.test(name))
  return (webview_files = { scripts: [...scripts], css: entry.css?.[0], wasm })
}

// Gate the open keybinding on the active editor only: background opens (git diffs, other
// extensions' reads) must not flip it under the editor the user sees
const update_supported_resource_context = (editor?: vscode.TextEditor): void => {
  const is_supported = is_matterviz_filename(path.basename(editor?.document.fileName ?? ``))
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
    // An uncompressed ASE .traj or XYZ file is read frame by frame off disk (open_file_run),
    // so its size is unbounded; anything else the host indexes is read into memory whole
    max_file_size: DISK_RUN_REGEX.test(filename) ? Infinity : MAX_STREAMING_FILE_SIZE,
    stream_above: vscode.env.remoteName ? REMOTE_STREAM_ABOVE_BYTES : undefined,
  })
  if (transfer.kind === `reject`)
    throw host_transfer_error(transfer.reason, filename, file_size, transfer.max_file_size)
  if (transfer.kind === `marker`) {
    return { filename, content: transfer.content, is_base64: false }
  }

  try {
    const read_start = performance.now()
    const bytes = await vscode.workspace.fs.readFile(uri)
    // Text by its byte-order mark: a UTF-16 file (Windows PowerShell redirection) read as
    // UTF-8 reached the parsers as NUL-interleaved garbage
    const content = transfer.is_base64
      ? Buffer.from(bytes).toString(`base64`)
      : new TextDecoder(text_encoding_of(bytes)).decode(bytes)
    // The whole content then rides in the webview's bootstrap HTML
    if (telemetry_enabled())
      log_telemetry({
        kind: `host_file_inline`,
        file: filename,
        file_bytes: file_size,
        payload_chars: content.length,
        read_ms: Math.round(performance.now() - read_start),
      })
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

const NO_FILE_SELECTED = `No file selected. MatterViz needs an active editor to know what to render.`

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
  throw new Error(NO_FILE_SELECTED)
}

// The user's matterviz.theme, with `auto` resolved from VS Code's active color theme. The
// setting is an enum in package.json, so an invalid value only arrives through a hand-edited
// settings.json: like read_explicit_overrides, it is reported and VS Code's theme applies.
export const get_theme = (): ThemeName => {
  const theme_setting = vscode.workspace
    .getConfiguration(`matterviz`)
    .get<string>(`theme`, AUTO_THEME)
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
  // 128 CSPRNG bits: the CSP nonce is all that keeps markup injected through file content from
  // running as script, so Math.random() (recoverable state) won't do
  const nonce = randomBytes(16).toString(`hex`)
  const ext_path = context.extensionUri.fsPath
  // Webview-loadable URL for a file under dist/
  const dist_uri = (file: string): string =>
    String(
      webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri as vscode.Uri, `dist`, file),
      ),
    )
  const { scripts, css, wasm } = get_webview_files(ext_path)
  // The WASM URL rides in the bootstrap data (enables symmetry analysis)
  const moyo_wasm_url = wasm && dist_uri(wasm)

  const webview_data = { ...data, moyo_wasm_url }
  // Escape every `<`, not just `</`: file content like `<!--<script>` would otherwise put the
  // HTML parser in double-escaped script state and swallow the rest of the page
  const bootstrap_json = JSON.stringify(webview_data).replaceAll(`<`, `\\u003c`)
  // color-scheme before main-*.css loads, or its light-dark() tokens flash light until JS
  // applies the theme. A style attribute, to outrank main-*.css's same-specificity `:root`
  // rule; THEME_TYPE (a Record over ThemeName) makes a new theme a type error here.
  const color_scheme = THEME_TYPE[data.theme]
  const root_style = `color-scheme: ${color_scheme}; background-color: var(--vscode-editor-background, Canvas);`

  return `<!DOCTYPE html>
<html style="${root_style}">
  <head>
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' 'unsafe-eval' 'wasm-unsafe-eval' ${webview.cspSource}; style-src 'unsafe-inline' ${webview.cspSource}; img-src ${webview.cspSource} data:; connect-src ${webview.cspSource}; worker-src blob:;">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${scripts.map((file) => `<link rel="modulepreload" href="${dist_uri(file)}">`).join(``)}
    ${css ? `<link rel="stylesheet" href="${dist_uri(css)}">` : ``}
    <script nonce="${nonce}">
      window.matterviz_data=${bootstrap_json};
    </script>
  </head>
  <body>
    <div id="matterviz-app"></div>
    <script nonce="${nonce}" type="module">
      await import(${JSON.stringify(dist_uri(scripts[0]))});
      window.initializeMatterViz?.();
    </script>
  </body>
</html>`
}

// Webviews may only read the file they were opened on, not any path they name
const assert_authorized = (file_path: string, webview: WebviewLike): void => {
  if (webview_file_paths.get(webview) !== file_path)
    throw new Error(`Refusing to serve ${file_path}: this panel was not opened on it`)
}

// Handle messages from webview
export const handle_msg = async (
  msg: WebviewToHostMessage,
  webview: WebviewLike,
): Promise<void> => {
  if (msg.command === `info` && msg.text) {
    log_info(msg.text)
  } else if (msg.command === `telemetry`) {
    if (telemetry_enabled()) log_telemetry({ ...msg.record, side: `webview` })
  } else if (msg.command === `error` && msg.text) {
    vscode.window.showErrorMessage(msg.text)
  } else if (msg.command === `request_large_file` && msg.file_path) {
    // Index the file here (the payload never crosses into the webview), answer with the run
    // summary, then stream its per-frame plot rows as they are extracted
    const command = `large_file_response`
    try {
      const { request_id, file_path } = msg
      if (typeof request_id !== `string` || !request_id) throw new Error(`Invalid request_id`)
      assert_authorized(file_path, webview)
      // A newer request or panel close cancels this load: a stale run must not take its place
      webview_run_streams.get(webview)?.()
      let cancelled = false
      webview_run_streams.set(webview, () => (cancelled = true))
      // Panels on one file share its load (see active_runs), begun when the first one opened
      const run = await (active_runs.get(file_path) ?? load_run(file_path))
      if (cancelled) {
        const error = `Large-file request ${request_id} was superseded or its panel closed`
        webview.postMessage({ command, request_id, error })
        return
      }
      webview_run_streams.set(webview, stream_run_updates(run, request_id, webview))
      const { preview, ...run_summary } = summarize_run(run)
      const preview_frame = encode_frame(preview)
      if (preview_frame.sites instanceof Uint8Array)
        run_preview_sites.set(run, preview_frame.sites)
      webview.postMessage({
        command,
        request_id,
        run_summary,
        preview: frame_to_wire(preview_frame),
      })
    } catch (error) {
      const error_message = to_error(error).message
      console.error(`Failed to setup indexed parsing:`, error_message)
      webview.postMessage({
        command,
        request_id: msg.request_id,
        error: error_message,
        ...(error instanceof HostFileError && { error_stage: error.stage }),
      })
    }
  } else if (msg.command === `request_frame` && msg.file_path) {
    try {
      const { request_id, file_path, frame_index, channels } = msg
      if (typeof request_id !== `string` || !Number.isInteger(frame_index) || frame_index < 0)
        throw new Error(`Invalid request_id or frame_index`)
      assert_authorized(file_path, webview)
      const run = await active_runs.get(file_path)
      if (!run) throw new Error(`No indexed trajectory is open for file: ${file_path}`)
      const read_start = performance.now()
      const numeric = await run.read_frame(frame_index, undefined, channels)
      const encode_start = performance.now()
      const frame = frame_to_wire(numeric, channels?.precision, run_preview_sites.get(run))
      const timing = {
        read_ms: Number((encode_start - read_start).toFixed(2)),
        encode_ms: Number((performance.now() - encode_start).toFixed(2)),
      }
      webview.postMessage({
        command: `frame_response`,
        request_id,
        frame,
        frame_index,
        timing,
      })
      if (telemetry_enabled()) count_posted_frame(file_path, frame)
    } catch (error) {
      const error_message = to_error(error).message
      console.error(`Failed to load frame ${msg.frame_index + 1}:`, error_message)
      webview.postMessage({
        command: `frame_response`,
        request_id: msg.request_id,
        error: error_message,
        frame_index: msg.frame_index,
      })
    }
  } else if (msg.command === `saveAs` && msg.content) {
    try {
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(msg.filename),
        filters: { Files: [`*`] },
      })
      if (!uri) return
      const bytes =
        typeof msg.content === `string`
          ? new TextEncoder().encode(msg.content)
          : new Uint8Array(msg.content)
      await vscode.workspace.fs.writeFile(uri, bytes)
      vscode.window.showInformationMessage(`Saved: ${path.basename(uri.fsPath)}`)
    } catch (error: unknown) {
      const error_type = typeof msg.content === `string` ? `text file` : `binary data`
      vscode.window.showErrorMessage(
        `Failed to save ${error_type}: ${to_error(error).message}`,
      )
    }
  }
}

// Forward the run's plot rows to the webview in batches (rows extracted before the summary
// went out are in the summary itself, later ones arrive as plot_metadata_stream messages) and
// the warnings its later frame reads add. Returns what stops both.
function stream_run_updates(
  run: TrajectoryRun,
  request_id: string,
  webview: WebviewLike,
): () => void {
  const post = (rows: TrajectoryRun[`properties`][`rows`], complete: boolean): void =>
    post_to_webview(webview, {
      command: `plot_metadata_stream`,
      request_id,
      rows: [...rows],
      complete,
    })
  const unsubscribe_warnings = post_new_warnings(run, (warnings) =>
    post_to_webview(webview, { command: `trajectory_warnings`, request_id, warnings }),
  )
  let pending: TrajectoryRun[`properties`][`rows`] = []
  const unsubscribe_rows = run.properties.complete
    ? () => {}
    : run.properties.subscribe((batch, complete) => {
        pending = [...pending, ...batch]
        if (!complete && pending.length < PLOT_ROWS_PER_MESSAGE) return
        post(pending, complete)
        pending = []
        if (complete) unsubscribe_rows()
      })
  return () => {
    unsubscribe_rows()
    unsubscribe_warnings?.()
  }
}

// Start watching a file using VS Code's built-in file system watcher
function start_watching_file(file_path: string, webview: WebviewLike): void {
  try {
    const subscribers = active_watcher_subscribers.get(file_path) ?? new Set<WebviewLike>()
    subscribers.add(webview)
    active_watcher_subscribers.set(file_path, subscribers)
    if (active_watchers.has(file_path)) return // reuse the existing shared watcher

    // The file itself as the base with `*` watches exactly it: a basename used as the pattern
    // is a glob, so names like Si_{111}.cif or run[1].xyz never matched their own file
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(file_path), `*`),
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
        post_to_webview(subscriber, { command: `fileDeleted`, file_path })
      }
      stop_watching_file(file_path)
    })

    active_watchers.set(file_path, watcher)
  } catch (error) {
    active_watcher_subscribers.delete(file_path)
    console.error(`Failed to start watching file ${file_path}:`, error)
    // Shown here, not posted into the webview: the webview has no error surface of its own
    // (it reports errors TO the host for exactly this treatment)
    vscode.window.showErrorMessage(`MatterViz: failed to start watching file: ${error}`)
  }
}

function post_to_webview(webview: WebviewLike, message: HostToWebviewMessage): void {
  try {
    webview.postMessage(message)
  } catch (error) {
    console.error(`[MatterViz] Failed to send ${message.command} message:`, error)
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
      post_to_webview(webview, { command: `fileUpdated`, file_path, data, theme })
    }
    // the last panel may have closed during the read, leaving nothing to dispose the run
    if (active_watcher_subscribers.get(file_path)?.size) prewarm_run(file_path, data)
  } catch (error) {
    console.error(`[MatterViz] Failed to read updated file ${file_path}:`, error)
    // once per failure, not per subscriber; shown, as in start_watching_file
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
  active_watchers.get(file_path)?.dispose()
  active_watchers.delete(file_path)
  dispose_run(file_path)
}

const dispose_run = (file_path: string): void => {
  // a failed load already reported its error to the requesting webview
  active_runs.get(file_path)?.then(
    (run) => run.dispose(),
    () => {},
  )
  active_runs.delete(file_path)
}

// A run the host decodes straight off the open file, frame by frame, at any size: an
// uncompressed ASE .traj (ULM magic) or an XYZ file index_xyz_file can walk, else null
const open_file_run = (file_path: string): TrajectoryRun | null => {
  const filename = path.basename(file_path)
  if (!DISK_RUN_REGEX.test(filename)) return null
  const source = file_byte_source(file_path)
  const provenance = { filename, source_bytes: source.byte_length }
  try {
    const is_xyz = !/traj$/i.test(filename)
    const offsets = is_xyz && index_xyz_file(source)
    const magic =
      !is_xyz && source.byte_length >= 8 && new TextDecoder().decode(source.read(0, 8))
    const data = offsets ? { source, offsets } : magic === `- of Ulm` && source
    const format = is_xyz ? `xyz` : `ase`
    if (data) return indexed_text_run(data, format, provenance, create_warning_collector())
  } catch (error) {
    source.release?.()
    throw new HostFileError(to_error(error).message, `parse`)
  }
  source.release?.()
  return null
}

// Index a host-served file while its webview boots (or reloads after a file change): its
// request_large_file then finds the run ready, or at least under way, instead of starting it.
// Called once the webview's HTML (or fileUpdated) is on its way, see load_run.
const prewarm_run = (file_path: string, { content }: FileData): void => {
  if (content.startsWith(`LARGE_FILE:${file_path}:`) && !active_runs.has(file_path))
    void load_run(file_path)
}

const load_run = (file_path: string): Promise<TrajectoryRun> => {
  const open = async (): Promise<TrajectoryRun> => {
    // A timer turn first: indexing blocks this thread, and what the host just posted (a
    // prewarmed panel's HTML) should reach the webview before that, not after
    await new Promise((resolve) => setTimeout(resolve))
    const file_run = open_file_run(file_path)
    if (file_run) return file_run
    // a read failure goes out without a stage, which the webview takes as `acquire`
    const indexed = await read_indexed_trajectory_file(file_path, path.basename(file_path))
    // index_above_bytes: 0 forces the lazily decoded run regardless of the user setting
    return open_trajectory(indexed.data, {
      filename: indexed.filename,
      index_above_bytes: 0,
    }).catch((error: unknown) => {
      throw new HostFileError(to_error(error).message, `parse`)
    })
  }
  const load_start = performance.now()
  const loading = open().then((run) => {
    if (telemetry_enabled())
      log_telemetry({
        kind: `host_run_load`,
        file: path.basename(file_path),
        load_ms: Math.round(performance.now() - load_start),
        frame_count: run.frame_count,
        source_bytes: run.provenance.source_bytes,
        rss_mb: Math.round(process.memoryUsage().rss / 1e6),
      })
    return run
  })
  active_runs.set(file_path, loading)
  // Forget a failed load so the next request retries, unless a file change replaced it
  void loading.catch(
    () => active_runs.get(file_path) === loading && active_runs.delete(file_path),
  )
  return loading
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
  if (file_path) {
    webview_file_paths.set(panel.webview, file_path)
    start_watching_file(file_path, panel.webview)
  }

  panel.webview.html = create_html(panel.webview, context, {
    data: file_data,
    theme: get_theme(),
    defaults: get_defaults(),
    ...(telemetry_enabled() && { telemetry: true }),
  })
  if (file_path) prewarm_run(file_path, file_data)

  const message_listener = panel.webview.onDidReceiveMessage((msg: WebviewToHostMessage) =>
    handle_msg(msg, panel.webview),
  )

  // Push fresh theme/settings into the live webview. Rebuilding the HTML instead would
  // re-read the file from disk (discarding an unsaved editor buffer) and re-parse it.
  const post_settings = () =>
    post_to_webview(panel.webview, {
      command: `settingsChanged`,
      theme: get_theme(),
      defaults: get_defaults(),
    })

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
    webview_run_streams.get(panel.webview)?.()
    webview_run_streams.delete(panel.webview)
    webview_file_paths.delete(panel.webview)
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
    vscode.window.showErrorMessage(NO_FILE_SELECTED)
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

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => {} }
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

  update_supported_resource_context(vscode.window.activeTextEditor)

  context.subscriptions.push(
    vscode.commands.registerCommand(`matterviz.open`, (uri?: vscode.Uri) =>
      open_resource(context, uri),
    ),
    vscode.commands.registerCommand(`matterviz.report_bug`, report_bug),
    vscode.window.registerCustomEditorProvider(`matterviz.viewer`, new Provider(context), {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.workspace.onDidOpenTextDocument((document: vscode.TextDocument) => {
      // Auto-open only unambiguous structure/trajectory files (not JSON/YAML keyword matches)
      const file_path = document.uri.fsPath
      if (
        document.uri.scheme !== `file` ||
        !is_auto_renderable_filename(path.basename(file_path))
      )
        return

      clearTimeout(auto_render_timers.get(file_path))
      auto_render_timers.delete(file_path)
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
    }),
    vscode.window.onDidChangeActiveTextEditor(update_supported_resource_context),
  )
}

// Collect debug information for bug reporting
async function collect_debug_info(): Promise<string> {
  const { remoteName: remote_name } = vscode.env
  const ui_kind = vscode.env.uiKind === vscode.UIKind.Desktop ? `Desktop` : `Web`

  // Actively watched/rendered files, stats fetched in parallel
  const file_sections = await Promise.all(
    Array.from(active_watchers.keys()).map(async (file_path) => {
      let file_size: number | undefined // stays undefined (Unknown) for a deleted file
      try {
        file_size = (await vscode.workspace.fs.stat(vscode.Uri.file(file_path))).size
      } catch {}
      return [
        `**${path.basename(file_path)}**`,
        `- **Path**: \`${file_path}\``,
        `- **Size**: ${format_bytes(file_size)}`,
        `- **Has Watcher**: true`,
        `- **Has Trajectory Run**: ${active_runs.has(file_path)}\n\n`,
      ].join(`\n`)
    }),
  )
  const memory_usage = process.memoryUsage()

  return `### Environment

- **Editor**: ${vscode.env.appName}
- **Editor Version**: ${vscode.version}
- **MatterViz Version**: ${extension_version}
- **OS**: ${operating_system.type()} ${operating_system.platform()} ${operating_system.arch()}
- **OS Version**: ${operating_system.release()}
- **UI Kind**: ${ui_kind}
- **Remote Session**: ${remote_name ? `Yes (${remote_name})` : `No (Local)`}

### System Resources

- **Total Memory**: ${format_bytes(operating_system.totalmem())}
- **Free Memory**: ${format_bytes(operating_system.freemem())}
- **Process RSS**: ${format_bytes(memory_usage.rss)}
- **Process Heap Used**: ${format_bytes(memory_usage.heapUsed)}
- **Process Heap Total**: ${format_bytes(memory_usage.heapTotal)}

### Active Files & Extension State

- **Active Watchers**: ${active_watchers.size}
- **Active Trajectory Runs**: ${active_runs.size}
- **Auto-Render Timers**: ${auto_render_timers.size}
- **Active Auto-Render Panels**: ${active_auto_render_panels.size}

${
  file_sections.length === 0
    ? `No files currently being watched/rendered.\n\n`
    : `Currently watching/rendering ${file_sections.length} file(s):\n\n${file_sections.join(``)}`
}### Console Logs

**Please check for console errors/warnings:**

1. Open Developer Tools:
   - Cursor/VSCode: Help → Toggle Developer Tools (or Cmd/Ctrl+Shift+I)
2. Go to the "Console" tab
3. Look for any errors or warnings related to MatterViz (especially in red)
4. Copy and paste any relevant error messages into your GitHub issue

Tip: You can filter console messages by typing "matterviz" in the filter box.

---

**Generated**: ${new Date().toISOString()}

Please include this information when reporting bugs at:
https://github.com/janosh/matterviz/issues
`
}

// Command to report a bug with debug information
async function report_bug(): Promise<void> {
  try {
    const debug_info = await collect_debug_info()
    const doc = await vscode.workspace.openTextDocument({
      content: debug_info,
      language: `markdown`,
    })
    await vscode.window.showTextDocument(doc, { preview: false })

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
  webview_file_paths.clear()
  webview_run_streams.forEach((stop) => stop())
  webview_run_streams.clear()
  for (const file_path of [...active_runs.keys()]) dispose_run(file_path)
  active_auto_render_panels.clear()
  output_channel?.dispose()
  output_channel = undefined
}
