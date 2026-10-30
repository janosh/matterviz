import {
  BINARY_VIEWER_EXTENSIONS,
  TEXT_VIEWER_EXTENSIONS,
  TRAJ_EXTENSIONS,
  TRAJ_KEYWORDS,
  VASP_VIEWER_STEMS,
} from '#lib/constants.js'
import { DEFAULTS } from '#lib/settings.js'
import type { ThemeName } from '#lib/theme/index.js'
import { Buffer } from 'node:buffer'
import type * as node_path from 'node:path'
import { gzipSync } from 'node:zlib'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ExtensionContext, Tab, TextEditor, Uri, WebviewOptions } from 'vscode'
import pkg_json from '../package.json' with { type: 'json' }
import type { WebviewToHostMessage } from '#lib/file-viewer/host-protocol.js'
import type { FrameChannels } from '#lib/trajectory/frame.js'
import {
  activate,
  active_auto_render_panels,
  active_runs,
  active_watcher_subscribers,
  active_watchers,
  auto_render_timers,
  create_html,
  deactivate,
  get_defaults,
  get_file,
  get_theme,
  handle_msg,
  LARGE_FILE_THRESHOLD,
  read_file,
  render,
} from '../src/extension'

// Mock modules (extension.ts only touches fs.existsSync + fs.readdirSync;
// file contents come through the mocked vscode.workspace.fs API)
const mock_fs = vi.hoisted(() => ({
  existsSync: vi.fn().mockReturnValue(true),
  readdirSync: vi.fn().mockReturnValue([]),
}))

vi.mock(`node:fs`, () => mock_fs)
vi.mock(`node:path`, async (importOriginal) => {
  const actual = await importOriginal<typeof node_path>()
  return {
    ...actual,
    basename: vi.fn((point_value: string) => point_value.split(`/`).pop() ?? ``),
    join: vi.fn((...paths: string[]) => paths.join(`/`)),
  }
})

// the protocol requires `filename` even though the VS Code host re-derives it from file_path
const basename_of = (file_path: string) => file_path.split(`/`).pop() ?? file_path
const large_file_msg = (file_path: string, request_id: string): WebviewToHostMessage => ({
  command: `request_large_file`,
  request_id,
  file_path,
  filename: basename_of(file_path),
})
const frame_msg = (
  file_path: string,
  frame_index: number,
  channels?: FrameChannels,
): WebviewToHostMessage => ({
  command: `request_frame`,
  request_id: `frame-request`,
  file_path,
  filename: basename_of(file_path),
  frame_index,
  channels,
})
type CommandCallback = (uri?: Uri) => Promise<void> | void

// Swap in a capturing registerCommand mock and hand back the registry activate() fills
const capture_commands = (): Map<string, CommandCallback> => {
  const commands = new Map<string, CommandCallback>()
  mock_vscode.commands.registerCommand = vi.fn((name: string, callback: CommandCallback) => {
    commands.set(name, callback)
    return { dispose: vi.fn() }
  })
  return commands
}

// One shared log channel: extension.ts creates it lazily and keeps it for the session
const mock_output_channel = vi.hoisted(() => ({ info: vi.fn(), dispose: vi.fn() }))
const mock_vscode = vi.hoisted(() => ({
  window: {
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    createOutputChannel: vi.fn(() => mock_output_channel),
    showTextDocument: vi.fn(),
    showSaveDialog: vi.fn(),
    createWebviewPanel: vi.fn(),
    activeTextEditor: null as TextEditor | null,
    tabGroups: { activeTabGroup: { activeTab: null as Tab | null } },
    registerCustomEditorProvider: vi.fn(),
    activeColorTheme: { kind: 1 }, // Light theme by default
    onDidChangeActiveColorTheme: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((_key: string, default_val: string) => default_val),
      inspect: vi.fn((_key: string) => undefined),
    })),
    onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
    openTextDocument: vi.fn(),
    onDidOpenTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    createFileSystemWatcher: vi.fn(() => ({
      onDidChange: vi.fn(),
      onDidDelete: vi.fn(),
      dispose: vi.fn(),
    })),
    fs: { stat: vi.fn(), readFile: vi.fn(), writeFile: vi.fn() },
  },
  commands: { registerCommand: vi.fn(), executeCommand: vi.fn() },
  Uri: {
    file: vi.fn((point_value: string) => ({ fsPath: point_value })),
    joinPath: vi.fn((_base: unknown, ...paths: string[]) => ({
      fsPath: paths.join(`/`),
    })),
    parse: vi.fn((url: string) => ({ toString: () => url })),
  },
  ViewColumn: { Active: 1, Beside: 2 },
  ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
  UIKind: { Desktop: 1, Web: 2 },
  RelativePattern: class {
    constructor(
      public base: unknown,
      public pattern: string,
    ) {}
  },
  version: `1.99.0`,
  env: {
    appName: `VSCode`,
    remoteName: undefined as string | undefined,
    uiKind: 1, // Desktop
    clipboard: {
      writeText: vi.fn(() => Promise.resolve()),
      readText: vi.fn(() => Promise.resolve(``)),
    },
    openExternal: vi.fn((_uri: { toString: () => string }) => Promise.resolve(true)),
  },
}))

vi.mock(`vscode`, () => mock_vscode)

describe(`MatterViz Extension`, () => {
  let mock_file_system_watcher: ReturnType<
    typeof mock_vscode.workspace.createFileSystemWatcher
  >
  beforeEach(() => {
    vi.clearAllMocks()
    // clearAllMocks keeps implementations, so stubbed configs would leak into later tests
    mock_vscode.workspace.getConfiguration.mockReset().mockImplementation(() => ({
      get: vi.fn((_key: string, default_val: string) => default_val),
      inspect: vi.fn((_key: string) => undefined),
    }))

    for (const loading of active_runs.values()) void loading.then((run) => run.dispose())
    for (const state of [
      active_watchers,
      active_watcher_subscribers,
      active_runs,
      auto_render_timers,
      active_auto_render_panels,
    ])
      state.clear()

    mock_fs.existsSync.mockReturnValue(true)
    mock_fs.readdirSync.mockReturnValue([])
    mock_vscode.window.activeTextEditor = null
    mock_vscode.window.activeColorTheme = { kind: 1 } // Light
    mock_file_system_watcher = { onDidChange: vi.fn(), onDidDelete: vi.fn(), dispose: vi.fn() }
    mock_vscode.workspace.createFileSystemWatcher.mockReturnValue(mock_file_system_watcher)
    mock_vscode.workspace.fs.stat.mockResolvedValue({ size: 1000, type: 1 })
    mock_vscode.workspace.fs.readFile.mockResolvedValue(
      new Uint8Array(Buffer.from(`mock content`)),
    )
  })

  test(`package.json runs on the workspace host and pins @types/vscode to the min engine`, () => {
    // workspace extensionKind works locally and over remote SSH (janosh/matterviz#129)
    expect(pkg_json.extensionKind).toEqual([`workspace`])
    expect(pkg_json.devDependencies[`@types/vscode`]).toBe(
      pkg_json.engines.vscode.replace(/^\^/, `~`),
    )
  })

  describe(`Custom Editor File Patterns`, () => {
    const custom_editors = pkg_json.contributes.customEditors
    const matterviz_editor = custom_editors.find(
      (editor) => editor.viewType === `matterviz.viewer`,
    )
    const patterns = matterviz_editor?.selector.map((sel) => sel.filenamePattern) ?? []

    // simplified glob matching
    const matches_any_pattern = (filename: string): boolean =>
      patterns.some((pattern) => {
        const regex_str = pattern
          .replaceAll(`.`, `\\.`) // escape dots
          .replaceAll(`*`, `.*`) // * → .*
          .replaceAll(/\{(?<braced>[^}]+)\}/g, (_, group) => `(${group.split(`,`).join(`|`)})`) // {a,b} → (a|b)
        return new RegExp(`^${regex_str}$`, `i`).test(filename)
      })

    const named_files = `vasprun.xml vasprun.xml.gz vasprun_relax.xml run1.vasprun.xml.gz dynamics.dcd run.trr`
    // selectors are generated by scripts/sync-config.ts from #lib/constants, so every shared
    // viewer extension and VASP stem must be claimed (bare, gzipped, prefixed)
    test.each([
      ...TRAJ_EXTENSIONS.map((ext) => `test${ext}`),
      ...[...TEXT_VIEWER_EXTENSIONS, ...BINARY_VIEWER_EXTENSIONS].flatMap((ext) => [
        `sample.${ext}`,
        `sample.${ext}.gz`,
      ]),
      ...VASP_VIEWER_STEMS.map((stem) => stem.toUpperCase()).flatMap((stem) => [
        stem,
        `${stem}.gz`,
        `Si_${stem}`,
      ]),
      ...TRAJ_KEYWORDS.map((keyword) => `${keyword}_output.dat`),
      ...named_files.split(` `),
      ...[`CHGCAR.BAND_1`, `run_CHGCAR_001`, `PARCHG.BAND_1`, `run_PARCHG_001`].flatMap(
        (name) => [name, `${name}.gz`],
      ),
    ])(`pattern matches %s`, (filename) => {
      expect(matches_any_pattern(filename)).toBe(true)
    })

    // structure stems must end the filename, so source files (write_poscar.py, …) stay excluded
    const near_misses = `INCAR notvasprun.xml myCHGCARfile prefixPARCHGsuffix notes_ELFCARbackup
      report-AECCARnotes density.cube.bz2 structure.cif.bz2 write_poscar.py contcar_reader.rs
      test_xdatcar.ipynb poscar_writer.py`
    test.each(near_misses.split(/\s+/))(`pattern does not match near miss "%s"`, (filename) =>
      expect(matches_any_pattern(filename)).toBe(false),
    )

    test(`trajectory keyword selector rejects bare md but keeps delimited md tokens`, () => {
      const trajectory_keyword_pattern = patterns.find(
        (pattern) => pattern.includes(`trajectory`) && pattern.includes(`simulation`),
      )
      expect(trajectory_keyword_pattern).toBeDefined()
      const keywords =
        trajectory_keyword_pattern
          ?.match(/\{(?<keywords>[^}]+)\}/)
          ?.groups?.keywords?.split(`,`) ?? []
      expect(keywords).not.toContain(`md`)
      expect(keywords).toEqual(expect.arrayContaining([`md_`, `_md`, `-md`, `md-`, `md.`]))
    })
  })

  describe(`Explorer open command`, () => {
    test(`explorer menu command is not gated by active-editor support context`, () => {
      const explorer_menu = pkg_json.contributes.menus[`explorer/context`]
      const open_menu_item = explorer_menu.find((item) => item.command === `matterviz.open`)
      expect(open_menu_item).toBeDefined()
      expect(open_menu_item).not.toEqual(
        expect.objectContaining({
          when: expect.stringContaining(`matterviz.supported_resource`),
        }),
      )
    })

    test(`rejects unsupported active-editor fallback without a URI`, async () => {
      const commands = capture_commands()
      set_active_editor(`/test/README.md`, `notes`)

      activate(mock_context)
      await commands.get(`matterviz.open`)?.()

      expect(mock_vscode.window.createWebviewPanel).not.toHaveBeenCalled()
      expect(mock_vscode.window.showErrorMessage).toHaveBeenCalledWith(
        `MatterViz cannot open README.md because it is not a supported structure or trajectory file.`,
      )
    })

    // regression: background opens (git diffs) disabled the open keybinding for the active file
    test(`supported_resource context follows the active editor, not background opens`, () => {
      set_active_editor(`/test/structure.cif`)
      activate(mock_context)
      const context_values = () =>
        mock_vscode.commands.executeCommand.mock.calls
          .filter((args: unknown[]) => args[0] === `setContext`)
          .map((args: unknown[]) => args[2])
      fire_event(mock_vscode.workspace.onDidOpenTextDocument, {
        uri: { scheme: `git`, fsPath: `/test/notes.md` },
        fileName: `/test/notes.md`,
      })
      expect(context_values()).toEqual([true])
      fire_event(mock_vscode.window.onDidChangeActiveTextEditor, {
        document: { fileName: `/test/notes.md` },
      })
      fire_event(mock_vscode.window.onDidChangeActiveTextEditor, undefined)
      expect(context_values()).toEqual([true, false, false])
    })
  })

  const mock_webview = {
    cspSource: `vscode-webview:`,
    asWebviewUri: vi.fn(
      (uri: { fsPath: string }) =>
        `vscode-webview://unit-test${encodeURIComponent(uri.fsPath)}`,
    ),
    onDidReceiveMessage: vi.fn(),
    postMessage: vi.fn(),
    html: ``,
  }
  // per-panel postMessage spy (to tell fan-out apart) and disposable message listener
  const make_webview = (dispose: () => void = vi.fn()) => ({
    ...mock_webview,
    postMessage: vi.fn(),
    onDidReceiveMessage: vi.fn(() => ({ dispose })),
    options: undefined as WebviewOptions | undefined,
  })
  const mock_context = {
    extensionUri: { fsPath: `/test` },
    subscriptions: [],
    extension: { packageJSON: { version: pkg_json.version } },
  } as unknown as ExtensionContext

  const set_active_editor = (file_path?: string, content = `content`): void => {
    mock_vscode.window.activeTextEditor = file_path
      ? ({
          document: {
            fileName: file_path,
            uri: { fsPath: file_path },
            getText: () => content,
          },
        } as TextEditor)
      : null
  }

  const make_panel = (dispose?: () => void) => ({
    webview: make_webview(dispose),
    onDidDispose: vi.fn(),
  })

  const render_file = async (file_path: string, content = `content`) => {
    const panel = make_panel()
    mock_vscode.window.createWebviewPanel.mockReturnValueOnce(panel)
    set_active_editor(file_path, content)
    await render(mock_context)
    return panel
  }

  // The bootstrap payload create_html inlines into the webview HTML
  const bootstrap_data_of = (html: string) =>
    JSON.parse(/matterviz_data=(?<json>\{[\s\S]*?\});/.exec(html)?.[1] ?? `{}`)

  // invoke the callback registered on a VS Code event mock
  const fire_event = (
    listener: { mock: { calls: unknown[][] } },
    event: unknown = undefined,
  ): void => (listener.mock.calls[0][0] as (event: unknown) => void)(event)

  test.each([
    [`test.gz`, true],
    [`test.h5`, true],
    [`test.traj`, true], // ASE binary
    [`test.hdf5`, true],
    [`test.cif`, false],
    [`test.xyz`, false],
    [`test.json`, false],
    [``, false],
  ])(`file reading: "%s" → base64:%s`, async (filename, is_base64) => {
    const content = is_base64 ? Buffer.from(`mock content`).toString(`base64`) : `mock content`
    expect(await read_file(`/test/${filename}`)).toEqual({ filename, is_base64, content })
  })

  test.each([`large-trajectory.traj`, `large.extxyz`])(
    `file reading: large trajectory %s returns an indexed marker`,
    async (filename) => {
      const large_file_size = LARGE_FILE_THRESHOLD + 1
      const file_path = `/test/${filename}`
      mock_vscode.workspace.fs.stat.mockResolvedValue({ size: large_file_size, type: 1 })
      expect(await read_file(file_path)).toEqual({
        filename,
        content: `LARGE_FILE:${file_path}:${large_file_size}`,
        is_base64: false,
      })
      expect(mock_vscode.workspace.fs.readFile).not.toHaveBeenCalled()
    },
  )

  test.each([
    [`large-structure.cif`, LARGE_FILE_THRESHOLD + 1, `supports trajectories only`],
    [`huge.extxyz`, 1024 ** 3 + 1, `Maximum supported size: 1.00 GiB`],
    [`large-trajectory.traj`, 1024 ** 3 + 1, `Maximum supported size`],
  ])(`file reading: rejects unsupported large file %s`, async (filename, file_size, error) => {
    mock_vscode.workspace.fs.stat.mockResolvedValue({ size: file_size, type: 1 })
    await expect(read_file(`/test/${filename}`)).rejects.toThrow(error)
    expect(mock_vscode.workspace.fs.readFile).not.toHaveBeenCalled()
  })

  test(`large compressed EXTXYZ request opens an indexed run, streams plot rows and serves frames`, async () => {
    const file_path = `/test/movie.extxyz.gz`
    // Exceed the host's 5000-row flush plus a 2000-row scan chunk, leaving a final tail.
    const n_frames = 7100
    const trajectory = Array.from(
      { length: n_frames },
      (_unused, idx) =>
        `1\nProperties=species:S:1:pos:R:3:forces:R:3 frame=${idx} energy=${-idx}\nH ${idx} 0 0 0 0 1`,
    ).join(`\n`)
    const compressed = new Uint8Array(gzipSync(`${trajectory}\n`))
    mock_vscode.workspace.fs.stat.mockResolvedValue({ size: compressed.byteLength, type: 1 })
    mock_vscode.workspace.fs.readFile.mockResolvedValue(compressed)

    await handle_msg(large_file_msg(file_path, `large-request`), mock_webview)
    const loading = active_runs.get(file_path)
    // a second panel on the same file shares the run instead of re-reading the file
    const webview_b = make_webview()
    await handle_msg(large_file_msg(file_path, `request-b`), webview_b)
    expect(active_runs.get(file_path)).toBe(loading)
    expect(mock_vscode.workspace.fs.readFile).toHaveBeenCalledOnce()
    const run = await loading
    expect(run?.frame_count).toBe(n_frames)
    expect(run?.provenance.format).toBe(`xyz`)
    type Row = { frame_number: number; properties: Record<string, number> }
    const response = mock_webview.postMessage.mock.calls.find(
      ([message]) => (message as { command: string }).command === `large_file_response`,
    )?.[0] as {
      request_id: string
      run_summary: {
        frame_count: number
        preview: object
        properties: { rows: Row[]; complete: boolean }
      }
    }
    expect(response.request_id).toBe(`large-request`)
    expect(response.run_summary.frame_count).toBe(n_frames)
    expect(response.run_summary.preview).toHaveProperty(`structure`)
    expect(response.run_summary.properties).toMatchObject({ complete: false, rows: [] })
    // every summary field must survive structured cloning into the webview
    expect(() => structuredClone(response.run_summary)).not.toThrow()
    await run?.properties.done
    type StreamMessage = { command: string; file_path: string; rows: Row[]; complete: boolean }
    // each panel gets every row exactly once: the summary's rows, then its own stream
    for (const webview of [mock_webview, webview_b]) {
      const messages = webview.postMessage.mock.calls.map(([message]) => message)
      const stream_calls = (messages as StreamMessage[]).filter(
        (message) => message.command === `plot_metadata_stream`,
      )
      expect(stream_calls.length).toBeGreaterThan(webview === mock_webview ? 1 : 0)
      expect(stream_calls.at(-1)).toMatchObject({ file_path, complete: true })
      expect(stream_calls.every((message) => message.file_path === file_path)).toBe(true)
      expect(
        stream_calls.slice(0, -1).every(({ rows, complete }) => rows.length > 0 && !complete),
      ).toBe(true)
      const summary = messages.find(
        (message) => (message as { command: string }).command === `large_file_response`,
      ) as typeof response
      const streamed_rows = stream_calls.flatMap(({ rows }) => rows)
      const all_rows = [...summary.run_summary.properties.rows, ...streamed_rows]
      expect(all_rows.map((row) => [row.frame_number, row.properties.energy])).toEqual(
        Array.from({ length: n_frames }, (_unused, idx) => [idx, idx === 0 ? 0 : -idx]),
      )
    }

    // numeric, its coordinates an ArrayBuffer that VS Code's postMessage carries as such,
    // with only the vector channels asked for
    for (const [channels, vector_keys] of [
      [undefined, [`force`]],
      [{ vectors: [] }, []],
    ] as const) {
      await handle_msg(frame_msg(file_path, 1, channels), mock_webview)
      expect(mock_webview.postMessage).toHaveBeenLastCalledWith({
        command: `frame_response`,
        request_id: `frame-request`,
        frame: expect.objectContaining({
          header: expect.objectContaining({ step: 1 }),
          coordinates: expect.any(ArrayBuffer),
          vector_keys,
        }),
        frame_index: 1,
      })
    }
    await handle_msg(frame_msg(file_path, n_frames), mock_webview)
    expect(mock_webview.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        command: `frame_response`,
        error: expect.stringContaining(`outside 0..${n_frames - 1}`),
      }),
    )
  })

  // Simultaneous opens share one read. A file change while it loads evicts the load, so the
  // re-request after fileUpdated indexes the new bytes instead of receiving the stale run
  test(`concurrent large-file requests share one load that a file change evicts`, async () => {
    const file_path = `/test/live.extxyz`
    const frames = (count: number) =>
      new TextEncoder().encode(`1\nframe=0\nH 0 0 0\n1\nframe=1\nH 1 0 0\n`.repeat(count))
    const size = LARGE_FILE_THRESHOLD + 1 // so the fileUpdated re-read only sends a marker
    mock_vscode.workspace.fs.stat.mockResolvedValue({ size, type: 1 })
    const panels = [await render_file(file_path), await render_file(file_path)]
    const loads: ((bytes: Uint8Array) => void)[] = []
    mock_vscode.workspace.fs.readFile.mockImplementation(
      () => new Promise((resolve) => loads.push(resolve)),
    )
    const old_requests = panels.map(({ webview }) =>
      handle_msg(large_file_msg(file_path, `old`), webview),
    )
    await vi.waitFor(() => expect(loads).toHaveLength(1))
    fire_event(mock_file_system_watcher.onDidChange) // evicts the load before fileUpdated goes out
    const new_request = handle_msg(large_file_msg(file_path, `new`), panels[0].webview)
    await vi.waitFor(() => expect(loads).toHaveLength(2))
    loads[0](frames(1))
    loads[1](frames(2))
    await Promise.all([...old_requests, new_request])
    const frame_count_of = (request_id: string) =>
      panels[0].webview.postMessage.mock.calls
        .map(([message]) => message)
        .find((message) => message.request_id === request_id && message.run_summary)
        ?.run_summary.frame_count
    expect([frame_count_of(`old`), frame_count_of(`new`)]).toEqual([2, 4])
    expect(mock_vscode.workspace.fs.readFile).toHaveBeenCalledTimes(2)
    await handle_msg(frame_msg(file_path, 3), panels[1].webview)
    expect(panels[1].webview.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ frame: expect.any(Object), frame_index: 3 }),
    )
  })

  // a failed load is reported and forgotten, so the next request retries the read
  test(`a failed large-file load is reported, then retried on the next request`, async () => {
    const file_path = `/test/flaky.extxyz`
    vi.spyOn(console, `error`).mockImplementation(() => {})
    mock_vscode.workspace.fs.readFile.mockRejectedValueOnce(new Error(`disk hiccup`))
    await handle_msg(large_file_msg(file_path, `first`), mock_webview)
    expect(mock_webview.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ request_id: `first`, error: `disk hiccup` }),
    )
    expect(active_runs.has(file_path)).toBe(false)
    mock_vscode.workspace.fs.readFile.mockResolvedValueOnce(
      new TextEncoder().encode(`1\n\nH 0 0 0\n`),
    )
    await handle_msg(large_file_msg(file_path, `retry`), mock_webview)
    expect(mock_webview.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ request_id: `retry`, run_summary: expect.any(Object) }),
    )
  })

  test(`large-file requests reject invalid request IDs before reading`, async () => {
    await handle_msg(large_file_msg(`/test/movie.extxyz`, ``), mock_webview)
    expect(mock_vscode.workspace.fs.stat).not.toHaveBeenCalled()
    expect(mock_webview.postMessage).toHaveBeenLastCalledWith({
      command: `large_file_response`,
      request_id: ``,
      error: `Invalid request_id`,
    })
  })

  test.each([
    [`negative frame index`, `/test/movie.extxyz`, -1, `Invalid request_id or frame_index`],
    [`missing run`, `/test/missing.extxyz`, 0, `No indexed trajectory is open`],
  ])(`request_frame reports %s`, async (_label, file_path, frame_index, error) => {
    const console_error = vi.spyOn(console, `error`).mockImplementation(() => {})
    await handle_msg(frame_msg(file_path, frame_index), mock_webview)
    // the log numbers frames from 1 like the step input
    expect(console_error).toHaveBeenCalledWith(
      `Failed to load frame ${frame_index + 1}:`,
      expect.stringContaining(error),
    )
    expect(mock_webview.postMessage).toHaveBeenLastCalledWith({
      command: `frame_response`,
      request_id: `frame-request`,
      error: expect.stringContaining(error),
      frame_index,
    })
  })

  test.each([
    {
      label: `explicit URI`,
      uri: `/test/file.cif`,
      expect_filename: `file.cif`,
      from_disk: true,
    },
    // unsaved editor buffers must win over the on-disk copy
    {
      label: `active editor buffer`,
      editor: `/test/active.cif`,
      expect_filename: `active.cif`,
    },
    {
      label: `URI matching active editor`,
      uri: `/test/active.cif`,
      editor: `/test/active.cif`,
      expect_filename: `active.cif`,
    },
    {
      label: `URI different from active editor`,
      uri: `/test/other.cif`,
      editor: `/test/active.cif`,
      expect_filename: `other.cif`,
      from_disk: true,
    },
    { label: `active tab`, tab: `/test/tab.cif`, expect_filename: `tab.cif`, from_disk: true },
    {
      label: `no target`,
      error: `No file selected. MatterViz needs an active editor to know what to render.`,
    },
  ])(`get_file ($label)`, async ({ uri, editor, tab, expect_filename, from_disk, error }) => {
    const content = `unsaved`
    set_active_editor(editor, content)
    mock_vscode.window.tabGroups.activeTabGroup.activeTab = tab
      ? ({ input: { uri: { fsPath: tab } } } as unknown as Tab)
      : null
    mock_vscode.workspace.fs.readFile.mockClear()

    if (error) {
      await expect(get_file()).rejects.toThrow(error)
      return
    }

    const result = await get_file(uri ? ({ fsPath: uri } as Uri) : undefined)
    expect(result.filename).toBe(expect_filename)
    expect(mock_vscode.workspace.fs.readFile).toHaveBeenCalledTimes(from_disk ? 1 : 0)
    if (!from_disk)
      expect(result).toEqual({ filename: expect_filename, content, is_base64: false })
  })

  // The bootstrap JSON must round-trip any file content, including script-breaking payloads
  test.each([
    { filename: `test.traj`, content: `YmluYXJ5`, is_base64: true },
    { filename: `test"quotes.cif`, content: `content`, is_base64: false },
    { filename: `test.cif`, content: ``, is_base64: false },
    { filename: `large.cif`, content: `x`.repeat(100_000), is_base64: false },
    ...[
      `<script>alert("XSS")</script>`,
      `<img src="x" onerror="alert(1)">`,
      `javascript:alert(1)`,
      `"><script>alert(1)</script>`,
      `';alert(1);//`,
      `</script><script>alert(document.cookie)</script>`,
      // `<!--` then `<script` enters double-escaped script state, where `</script>` ends nothing
      `<!--<script>`,
    ].map((content) => ({ filename: `test.cif`, content, is_base64: false })),
  ])(`HTML generation embeds $filename content safely`, (data) => {
    const webview_data = { data, theme: `light` } as const
    const html = create_html(mock_webview, mock_context, webview_data)
    expect(html).toContain(`<!DOCTYPE html>`)
    expect(html).toContain(`Content-Security-Policy`)
    expect(html).toContain(`default-src 'none'`)
    expect(html).toContain(`script-src 'nonce-`)
    expect(html).toMatch(/nonce="[a-zA-Z0-9]{8,32}"/)
    expect(html).toContain(`matterviz-app`)
    expect(html).toContain(JSON.stringify(webview_data).replaceAll(`<`, `\\u003c`))
    // no raw `<` inside the JSON data can end or re-enter the script tag
    expect(/window\.matterviz_data=(?<json>.*);\n/.exec(html)?.[1]).not.toContain(`<`)
    expect(bootstrap_data_of(html)).toEqual(webview_data)
  })

  // white-flash regression: color-scheme goes in a style attribute before the CSS link
  test.each([
    [`dark`, `dark`],
    [`black`, `dark`],
    [`light`, `light`],
    [`white`, `light`],
  ] as const)(`HTML declares color-scheme before CSS loads: theme=%s`, (theme, scheme) => {
    const html = create_html(mock_webview, mock_context, {
      data: { filename: `test.cif`, content: `content`, is_base64: false },
      theme,
    })
    expect(html).toMatch(/^<!DOCTYPE html>\s*<html style="/)
    expect(html).toContain(`color-scheme: ${scheme};`)
    expect(html).toContain(`background-color: var(--vscode-editor-background, Canvas);`)
  })

  test(`error messages toast and do not log`, async () => {
    await handle_msg({ command: `error`, text: `Error message` }, mock_webview)
    expect(mock_vscode.window.showErrorMessage).toHaveBeenCalledWith(`Error message`)
    expect(mock_output_channel.info).not.toHaveBeenCalled()
  })

  // one info per successful render (every auto-save) goes to the output channel, not a toast
  test(`info messages log to one lazily created channel instead of toasting`, async () => {
    deactivate() // drop a channel an earlier test created so lazy creation is observable
    mock_output_channel.dispose.mockClear()
    const message = { command: `info`, text: `Structure rendered: a.cif (8 sites)` } as const
    await handle_msg(message, mock_webview)
    await handle_msg(message, mock_webview)
    expect(mock_output_channel.info).toHaveBeenCalledTimes(2)
    expect(mock_output_channel.info).toHaveBeenCalledWith(message.text)
    expect(mock_vscode.window.showInformationMessage).not.toHaveBeenCalled()
    expect(mock_vscode.window.createOutputChannel).toHaveBeenCalledExactlyOnceWith(
      `MatterViz`,
      { log: true },
    )
    deactivate()
    expect(mock_output_channel.dispose).toHaveBeenCalledTimes(1)
  })

  test.each([
    [
      `save.cif`,
      `<script>alert("XSS")</script>`,
      false,
      (text: string) => new TextEncoder().encode(text),
    ],
    [`save.png`, `data:image/png;base64,/wCA`, true, () => Uint8Array.from([255, 0, 128])],
  ])(`saveAs %s writes the decoded bytes`, async (filename, content, is_binary, to_bytes) => {
    mock_vscode.window.showSaveDialog.mockResolvedValue({ fsPath: `/test/${filename}` })
    await handle_msg({ command: `saveAs`, content, filename, is_binary }, mock_webview)
    expect(mock_vscode.workspace.fs.writeFile).toHaveBeenCalledWith(
      { fsPath: `/test/${filename}` },
      to_bytes(content),
    )
    expect(mock_vscode.window.showInformationMessage).toHaveBeenCalledWith(
      `Saved: ${filename}`,
    )
  })

  test.each([
    {
      label: `write failure`,
      dialog: { fsPath: `/test/save.cif` },
      write_error: `Write failed`,
      content: `content`,
      is_binary: false,
      error: `Failed to save text file: Write failed`,
    },
    { label: `user cancellation`, dialog: undefined, content: `content`, is_binary: false },
    {
      label: `empty base64`,
      dialog: { fsPath: `/test/test.png` },
      content: `data:image/png;base64,`,
      is_binary: true,
      error: `Failed to save binary data: Invalid data URL: missing base64 data`,
    },
  ])(`saveAs $label`, async ({ dialog, write_error, content, is_binary, error }) => {
    mock_vscode.window.showSaveDialog.mockResolvedValue(dialog)
    if (write_error)
      mock_vscode.workspace.fs.writeFile.mockRejectedValue(new Error(write_error))
    await handle_msg({ command: `saveAs`, content, filename: `test`, is_binary }, mock_webview)
    if (error) expect(mock_vscode.window.showErrorMessage).toHaveBeenCalledWith(error)
    expect(mock_vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(write_error ? 1 : 0)
  })

  // messages missing their payload (text/content) or with an unknown command are ignored
  test.each([{ command: `info` }, { command: `saveAs` }, { command: `unknown` }])(
    `malformed message handling: $command`,
    async (msg) => {
      const placeholders = { filename: `f`, request_id: `r`, file_path: `p` }
      await handle_msg(
        { ...msg, ...placeholders } as unknown as WebviewToHostMessage,
        mock_webview,
      )
      expect(mock_output_channel.info).not.toHaveBeenCalled()
      expect(mock_vscode.window.showSaveDialog).not.toHaveBeenCalled()
      expect(mock_vscode.window.showErrorMessage).not.toHaveBeenCalled()
    },
  )

  test.each([
    [`active editor`, `/test/active.cif`, true],
    // glob characters in the name must not turn the watched path into a pattern
    [`active tab`, `/test/Si_{111}[1].cif`, false],
  ] as const)(
    `render from %s creates a panel and watches the file`,
    async (_source, file_path, use_editor) => {
      set_active_editor(use_editor ? file_path : undefined)
      mock_vscode.window.tabGroups.activeTabGroup.activeTab = use_editor
        ? null
        : ({ input: { uri: { fsPath: file_path } } } as unknown as Tab)
      mock_vscode.window.createWebviewPanel.mockReturnValue(make_panel())
      await render(mock_context)
      expect(mock_vscode.window.createWebviewPanel).toHaveBeenCalledWith(
        `matterviz`,
        `MatterViz - ${basename_of(file_path)}`,
        mock_vscode.ViewColumn.Active,
        expect.any(Object),
      )
      expect(mock_vscode.workspace.createFileSystemWatcher).toHaveBeenCalledWith(
        expect.objectContaining({ base: { fsPath: file_path }, pattern: `*` }),
      )
      expect(active_watchers.has(file_path)).toBe(true)
    },
  )

  test(`render handles errors`, async () => {
    mock_vscode.window.activeTextEditor = null
    mock_vscode.window.tabGroups.activeTabGroup.activeTab = null
    await render(mock_context)
    expect(mock_vscode.window.showErrorMessage).toHaveBeenCalledWith(
      `Failed: No file selected. MatterViz needs an active editor to know what to render.`,
    )
  })

  describe(`Bug Reporting`, () => {
    let mock_opened_document: { content: string; language: string } | null = null
    let report_bug_command: CommandCallback | null = null
    const mock_env = mock_vscode.env

    // every mock has to be in place before activate() registers the command
    beforeEach(() => {
      mock_opened_document = null
      mock_env.appName = `Cursor`
      mock_env.remoteName = undefined
      const command_registry = capture_commands()
      mock_vscode.workspace.openTextDocument = vi.fn(
        (options: { content: string; language: string }) => {
          mock_opened_document = { content: options.content, language: options.language }
          return Promise.resolve({
            uri: { fsPath: `/tmp/bug-report.md` },
            getText: () => options.content,
          })
        },
      )
      mock_vscode.window.showTextDocument = vi.fn(() => Promise.resolve())
      // no follow-up action chosen by default
      mock_vscode.window.showInformationMessage = vi.fn(() => Promise.resolve(undefined))
      activate(mock_context)
      report_bug_command = command_registry.get(`matterviz.report_bug`) ?? null
    })

    const run_report_bug = async (): Promise<string> => {
      expect(report_bug_command).not.toBeNull()
      await report_bug_command?.()
      return mock_opened_document?.content ?? ``
    }

    // rendering a file registers its watcher, which populates the report
    const start_watching = (filename: string) => render_file(`/test/${filename}`)

    test(`should generate bug report with environment information`, async () => {
      const content = await run_report_bug()
      expect(mock_opened_document?.language).toBe(`markdown`)
      for (const snippet of [
        `### Environment`,
        `### System Resources`,
        `### Active Files & Extension State`,
        `### Console Logs`,
        `- **Editor**: Cursor`,
        `- **MatterViz Version**: ${pkg_json.version}`,
        `- **UI Kind**: Desktop`,
        `- **Remote Session**: No (Local)`,
        `- **Total Memory**:`,
        `- **Free Memory**:`,
        `- **Process RSS**:`,
        `- **Process Heap Used**:`,
        `- **Process Heap Total**:`,
        `**Please check for console errors/warnings:**`,
        `Toggle Developer Tools`,
        `Tip: You can filter console messages`,
        `No files currently being watched/rendered.`,
        `https://github.com/janosh/matterviz/issues`,
      ]) {
        expect(content).toContain(snippet)
      }
      expect(content).toMatch(/\*\*Generated\*\*: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)

      mock_env.remoteName = `ssh-remote`
      expect(await run_report_bug()).toContain(`- **Remote Session**: Yes (ssh-remote)`)
    })

    test(`should include active files and extension state counters in report`, async () => {
      await start_watching(`structure.cif`)
      await start_watching(`trajectory.traj`)

      const content = await run_report_bug()
      for (const name of [`structure.cif`, `trajectory.traj`])
        expect(content).toContain(`**${name}**\n- **Path**: \`/test/${name}\``)
      expect(content).toContain(`- **Has Watcher**: true`)
      expect(content).toContain(`- **Active Watchers**: 2`)
      for (const counter of [
        `Active Trajectory Runs`,
        `Auto-Render Timers`,
        `Active Auto-Render Panels`,
      ])
        expect(content).toMatch(new RegExp(`- \\*\\*${counter}\\*\\*: \\d+`))
    })

    test(`follow-up actions copy the report or open GitHub issues`, async () => {
      mock_vscode.window.showInformationMessage = vi.fn(() =>
        Promise.resolve(`Copy to Clipboard`),
      )
      const content = await run_report_bug()
      expect(mock_env.clipboard.writeText).toHaveBeenCalledWith(content)
      expect(mock_vscode.window.showInformationMessage).toHaveBeenCalledWith(
        `Debug information copied to clipboard!`,
      )
      mock_vscode.window.showInformationMessage = vi.fn(() =>
        Promise.resolve(`Open GitHub Issues`),
      )
      await run_report_bug()
      expect(mock_env.openExternal.mock.calls[0][0].toString()).toContain(
        `https://github.com/janosh/matterviz/issues/new`,
      )
    })

    test(`should format file sizes correctly`, async () => {
      const size_cases = [
        { size: 1024, expected: `1.00 KiB` },
        { size: 1024 * 1024, expected: `1.00 MiB` },
        { size: 1024 * 1024 * 1024, expected: `1.00 GiB` },
      ]
      const file_sizes = new Map(
        size_cases.map(({ size }) => [`/test/file_${size}.cif`, size]),
      )
      mock_vscode.workspace.fs.stat.mockImplementation((uri) =>
        Promise.resolve({ size: file_sizes.get(uri.fsPath) ?? 1000, type: 1 }),
      )
      await Promise.all(size_cases.map(({ size }) => start_watching(`file_${size}.cif`)))

      const content = await run_report_bug()
      for (const { expected } of size_cases) expect(content).toContain(expected)
    })

    test(`should handle file stat errors gracefully`, async () => {
      await start_watching(`error-file.cif`)
      mock_vscode.workspace.fs.stat.mockRejectedValue(new Error(`File not found`))

      const content = await run_report_bug()
      expect(content).toContain(`**error-file.cif**`)
      expect(content).toContain(`- **Size**: Unknown`)
    })

    test(`should handle errors during report generation`, async () => {
      mock_vscode.workspace.openTextDocument = vi.fn(() =>
        Promise.reject(new Error(`Failed to create document`)),
      )
      await run_report_bug()
      expect(mock_vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining(`Failed to collect debug information`),
      )
    })
  })

  test(`nonce uniqueness`, () => {
    const data = {
      data: { filename: `a.cif`, content: ``, is_base64: false },
      theme: `light`,
    } as const
    const nonce_of = () =>
      /nonce="(?<nonce>[a-zA-Z0-9]+)"/.exec(create_html(mock_webview, mock_context, data))?.[1]
    expect(new Set(Array.from({ length: 1000 }, nonce_of)).size).toBe(1000)
  })

  describe(`Theme functionality`, () => {
    const stub_theme_config = (theme_value: string) => {
      mock_vscode.workspace.getConfiguration.mockImplementation(() => ({
        get: vi.fn((key: string, default_value: string) =>
          key === `theme` ? theme_value : default_value,
        ),
        inspect: vi.fn((_key: string) => undefined),
      }))
    }

    test.each<[number, string, ThemeName]>([
      // the `auto` setting maps each VSCode color theme kind onto one of our themes
      [mock_vscode.ColorThemeKind.Light, `auto`, `light`],
      [mock_vscode.ColorThemeKind.Dark, `auto`, `dark`],
      [mock_vscode.ColorThemeKind.HighContrast, `auto`, `black`],
      [mock_vscode.ColorThemeKind.HighContrastLight, `auto`, `white`],
      // an explicit setting wins over whatever color theme VSCode is using
      ...[mock_vscode.ColorThemeKind.Light, mock_vscode.ColorThemeKind.Dark].flatMap((kind) =>
        ([`light`, `dark`, `white`, `black`] as const).map(
          (theme): [number, string, ThemeName] => [kind, theme, theme],
        ),
      ),
    ])(
      `theme detection: VSCode theme %i, setting '%s' → '%s'`,
      (vscode_theme_kind: number, setting: string, expected: ThemeName) => {
        stub_theme_config(setting)
        mock_vscode.window.activeColorTheme = { kind: vscode_theme_kind }
        expect(get_theme()).toBe(expected)
      },
    )

    test(`invalid theme setting warns and follows the VS Code theme`, () => {
      const warn = vi.spyOn(console, `warn`).mockImplementation(() => undefined)
      stub_theme_config(`invalid-theme`)
      mock_vscode.window.activeColorTheme = { kind: mock_vscode.ColorThemeKind.Dark }
      expect(get_theme()).toBe(`dark`)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`invalid-theme`))
    })
  })

  describe(`Panel listener cleanup`, () => {
    const setup_panel = () => {
      const mock_dispose = vi.fn()
      const mock_panel = make_panel(mock_dispose)
      mock_vscode.window.createWebviewPanel.mockReturnValue(mock_panel)
      mock_vscode.window.onDidChangeActiveColorTheme.mockReturnValue({ dispose: mock_dispose })
      mock_vscode.workspace.onDidChangeConfiguration.mockReturnValue({ dispose: mock_dispose })
      set_active_editor(`/test/active.cif`)
      return { mock_dispose, mock_panel }
    }

    // rebuilding the HTML would re-read the file, discarding the unsaved editor buffer
    test.each([
      [`color theme`, () => mock_vscode.window.onDidChangeActiveColorTheme],
      [`matterviz config`, () => mock_vscode.workspace.onDidChangeConfiguration],
    ])(
      `%s change posts settingsChanged without rebuilding the webview`,
      async (_label, listener) => {
        const { mock_panel } = setup_panel()
        await render(mock_context)
        const initial_html = mock_panel.webview.html
        mock_vscode.workspace.fs.readFile.mockClear()
        mock_vscode.window.activeColorTheme = { kind: mock_vscode.ColorThemeKind.Dark }
        fire_event(listener(), {
          affectsConfiguration: (section: string) => section === `matterviz`,
        })

        expect(mock_panel.webview.postMessage).toHaveBeenCalledWith({
          command: `settingsChanged`,
          theme: `dark`,
          defaults: expect.objectContaining({ structure: expect.any(Object) }),
        })
        expect(mock_panel.webview.html).toBe(initial_html)
        expect(mock_vscode.workspace.fs.readFile).not.toHaveBeenCalled()
      },
    )

    test(`config changes outside matterviz are ignored`, async () => {
      const { mock_panel } = setup_panel()
      await render(mock_context)
      fire_event(mock_vscode.workspace.onDidChangeConfiguration, {
        affectsConfiguration: () => false,
      })
      expect(mock_panel.webview.postMessage).not.toHaveBeenCalled()
    })

    test(`multiple panels dispose independently`, async () => {
      const dispose1 = vi.fn()
      const dispose2 = vi.fn()
      const panel1 = make_panel(dispose1)
      const panel2 = make_panel(dispose2)
      mock_vscode.window.createWebviewPanel
        .mockReturnValueOnce(panel1)
        .mockReturnValueOnce(panel2)
      for (const listener of [
        mock_vscode.window.onDidChangeActiveColorTheme,
        mock_vscode.workspace.onDidChangeConfiguration,
      ])
        listener
          .mockReturnValueOnce({ dispose: dispose1 })
          .mockReturnValueOnce({ dispose: dispose2 })
      set_active_editor(`/test/active.cif`)
      await render(mock_context)
      await render(mock_context)
      fire_event(panel1.onDidDispose)
      expect(dispose1).toHaveBeenCalledTimes(3)
      expect(dispose2).not.toHaveBeenCalled()
    })
    describe(`Custom editor provider`, () => {
      interface ProviderLike {
        openCustomDocument: (uri: unknown, ctx: unknown, token: unknown) => { uri: Uri }
        resolveCustomEditor: (
          document: unknown,
          panel: unknown,
          token: unknown,
        ) => Promise<void>
      }

      const get_provider = (): ProviderLike => {
        activate(mock_context)
        const [[view_type, provider]] = mock_vscode.window.registerCustomEditorProvider.mock
          .calls as unknown as [string, ProviderLike][]
        expect(view_type).toBe(`matterviz.viewer`)
        return provider
      }

      test(`resolveCustomEditor wires webview options, html, watcher, and cleanup`, async () => {
        const provider = get_provider()
        const { mock_dispose, mock_panel: panel } = setup_panel()

        const file_path = `/test/custom-editor.cif`
        const document = provider.openCustomDocument({ fsPath: file_path }, {}, {})
        await provider.resolveCustomEditor(document, panel, {})
        expect(panel.webview.options).toMatchObject({ enableScripts: true })
        expect(
          (panel.webview.options as { localResourceRoots: unknown[] }).localResourceRoots,
        ).toHaveLength(1)
        expect(panel.webview.html).toContain(`custom-editor.cif`)
        expect(panel.webview.onDidReceiveMessage).toHaveBeenCalledWith(expect.any(Function))
        expect(active_watchers.has(file_path)).toBe(true)
        // dispose tears down message/theme/config listeners and the file watcher
        fire_event(panel.onDidDispose)
        expect(mock_dispose).toHaveBeenCalledTimes(3)
        expect(active_watchers.has(file_path)).toBe(false)
      })

      test(`resolveCustomEditor surfaces file read errors via showErrorMessage`, async () => {
        const provider = get_provider()
        mock_vscode.workspace.fs.readFile.mockRejectedValue(new Error(`disk on fire`))

        const document = provider.openCustomDocument({ fsPath: `/test/broken.cif` }, {}, {})
        await provider.resolveCustomEditor(document, setup_panel().mock_panel, {})
        expect(mock_vscode.window.showErrorMessage).toHaveBeenCalledWith(
          expect.stringContaining(`Failed:`),
        )
      })
    })
  })

  describe(`File Watching`, () => {
    test(`shares one file watcher across same-file panels until the final panel closes`, async () => {
      const file_path = `/test/file.cif`
      const panel1 = await render_file(file_path)
      const panel2 = await render_file(file_path)
      expect(mock_vscode.workspace.createFileSystemWatcher).toHaveBeenCalledTimes(1)
      mock_vscode.workspace.fs.readFile.mockClear()
      fire_event(mock_file_system_watcher.onDidChange)

      await vi.waitFor(() => {
        for (const { webview } of [panel1, panel2]) {
          expect(webview.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ command: `fileUpdated`, file_path }),
          )
        }
      })
      // one shared read fans out to both panels rather than one read per panel
      expect(mock_vscode.workspace.fs.readFile).toHaveBeenCalledTimes(1)

      fire_event(panel1.onDidDispose)
      expect(mock_file_system_watcher.dispose).not.toHaveBeenCalled()
      fire_event(panel2.onDidDispose)
      expect(mock_file_system_watcher.dispose).toHaveBeenCalledTimes(1)
    })

    describe(`file change notifications`, () => {
      test.each([
        {
          label: `change`,
          register: `onDidChange` as const,
          expected: {
            command: `fileUpdated`,
            data: expect.objectContaining({
              filename: `file.cif`,
              content: `mock content`,
              is_base64: false,
            }),
            file_path: `/test/file.cif`,
            theme: `light`,
          },
        },
        {
          label: `delete`,
          register: `onDidDelete` as const,
          expected: expect.objectContaining({
            command: `fileDeleted`,
            file_path: `/test/file.cif`,
          }),
        },
      ])(`notifies webview on file $label`, async ({ register, expected }) => {
        const panel = await render_file(`/test/file.cif`)
        fire_event(mock_file_system_watcher[register])

        await vi.waitFor(() => {
          expect(panel.webview.postMessage).toHaveBeenCalledWith(expected)
        })
      })

      // the webview has no error surface, so a posted `error` message left it silently stale
      test(`shows watcher creation failures in VS Code`, async () => {
        mock_vscode.workspace.createFileSystemWatcher.mockImplementation(() => {
          throw new Error(`File system watcher creation failed`)
        })
        const panel = await render_file(`/test/large-file.cif`)
        expect(mock_vscode.window.showErrorMessage).toHaveBeenCalledWith(
          expect.stringContaining(`failed to start watching file`),
        )
        expect(panel.webview.postMessage).not.toHaveBeenCalledWith(
          expect.objectContaining({ command: `error` }),
        )
      })
    })
  })

  describe(`Auto-Render Functionality`, () => {
    const stub_auto_render = (enabled: boolean | string): void => {
      mock_vscode.workspace.getConfiguration.mockReturnValue({
        get: vi.fn((key: string, default_val: string) =>
          key === `auto_render` ? enabled : default_val,
        ),
      } as unknown as ReturnType<typeof mock_vscode.workspace.getConfiguration>)
    }

    const get_open_document_callback = (): ((doc: unknown) => void) => {
      activate({
        subscriptions: { push: vi.fn() },
        extension: mock_context.extension,
      } as unknown as ExtensionContext)
      const callback = (
        mock_vscode.workspace.onDidOpenTextDocument.mock.calls as unknown[][]
      )[0]?.[0] as ((doc: unknown) => void) | undefined
      expect(callback).toBeDefined()
      return callback as (doc: unknown) => void
    }

    test.each([
      [`non-file URIs`, { scheme: `untitled` }, true],
      [
        `auto_render disabled in config`,
        { scheme: `file`, fsPath: `/test/structure.cif` },
        false,
      ],
    ])(`document-open callback is a no-op for %s`, async (_label, uri, auto_render) => {
      // an eligible name still schedules the 100ms timer that reads the config, so advance past it
      vi.useFakeTimers()
      try {
        stub_auto_render(auto_render)
        get_open_document_callback()({ uri })
        await vi.advanceTimersByTimeAsync(200)
        expect(mock_vscode.window.createWebviewPanel).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    test(`should use basenames for auto-render eligibility and report read errors`, async () => {
      mock_vscode.workspace.fs.stat.mockRejectedValue(new Error(`File not found`))
      stub_auto_render(`true`)
      // nested path checks that eligibility uses the basename, not the full path
      const mock_document = { uri: { scheme: `file`, fsPath: `/test/dist/structure.cif` } }

      get_open_document_callback()(mock_document)
      await vi.waitFor(() => {
        expect(mock_vscode.window.showErrorMessage).toHaveBeenCalledWith(
          expect.stringContaining(`MatterViz auto-render failed:`),
        )
      })
    })
  })

  describe(`Default Settings`, () => {
    const apply_config = (config: unknown) => {
      // @ts-expect-error: Mock type override needed for testing
      mock_vscode.workspace.getConfiguration.mockReturnValue(config)
    }

    const apply_overrides = (overrides: Record<string, unknown>) =>
      apply_config({
        get: vi.fn(),
        inspect: vi.fn((key: string) =>
          key in overrides ? { key, workspaceValue: overrides[key] } : undefined,
        ),
      })

    test(`merges representative overrides and keeps unset keys at DEFAULTS`, () => {
      apply_overrides({
        'structure.atom_radius': 1.5,
        'structure.show_bonds': `always`,
        'structure.vector_configs': { force: { visible: true } },
        'trajectory.auto_play': true,
        'trajectory.show_controls': false,
        'trajectory.atom_type_mapping': { '1': `Si`, '2': `O` },
        'scatter.point.size': 7,
        background_color: `#111111`,
      })
      expect(get_defaults()).toMatchObject({
        structure: {
          atom_radius: 1.5,
          show_bonds: `always`,
          same_size_atoms: DEFAULTS.structure.same_size_atoms,
          vector_configs: { force: { visible: true } },
        },
        trajectory: {
          auto_play: true,
          show_controls: false,
          atom_type_mapping: { '1': `Si`, '2': `O` },
        },
        scatter: { point: { size: 7 } },
        background_color: `#111111`,
      })
    })

    test(`ignores package defaultValue from inspect()`, () => {
      apply_config({
        get: vi.fn(() => ({ atom_radius: 1.5 })),
        inspect: vi.fn(() => ({ key: `structure.atom_radius`, defaultValue: 1.5 })),
      })
      expect(get_defaults().structure.atom_radius).toBe(DEFAULTS.structure.atom_radius)
    })

    // out-of-range, off-enum and mistyped values warn once and fall back to the schema
    // default (is_valid_setting_value)
    test.each([
      [`bond_thickness`, 0.2, 0.2, 0],
      [`site_label_padding`, -1, DEFAULTS.structure.site_label_padding, 1],
      [`rotation_damping`, 1, DEFAULTS.structure.rotation_damping, 1],
      [`show_bonds`, `sometimes`, DEFAULTS.structure.show_bonds, 1],
      [`show_atoms`, `yes`, DEFAULTS.structure.show_atoms, 1],
    ] as const)(
      `structure.%s override %s resolves to %s`,
      (key, value, expected, n_warnings) => {
        const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
        apply_overrides({ [`structure.${key}`]: value })
        expect(get_defaults().structure[key]).toBe(expected)
        expect(warn).toHaveBeenCalledTimes(n_warnings)
      },
    )

    test(`missing inspect yields the schema defaults`, () => {
      apply_config({ get: vi.fn(), inspect: vi.fn(() => undefined) })
      expect(get_defaults()).toEqual(DEFAULTS)
    })

    // every structure.* key = `invalid`: typed leaves keep their default, free strings take it
    test(`rejects mistyped structure values per leaf`, () => {
      vi.spyOn(console, `warn`).mockImplementation(() => {})
      apply_config({
        get: vi.fn(),
        inspect: vi.fn((key: string) =>
          key.startsWith(`structure.`) ? { key, workspaceValue: `invalid` } : undefined,
        ),
      })
      const { structure } = get_defaults()
      const { atom_radius, show_atoms, show_bonds, vector_configs } = DEFAULTS.structure
      expect(structure).toMatchObject({
        atom_radius,
        show_atoms,
        show_bonds,
        vector_configs,
        bond_color: `invalid`,
      })
    })

    // a failing configuration API is surfaced, never papered over with guessed settings
    test(`propagates a throwing getConfiguration`, () => {
      mock_vscode.workspace.getConfiguration.mockImplementation(() => {
        throw new Error(`Config access failed`)
      })
      expect(get_defaults).toThrow(`Config access failed`)
    })
  })
})
