import {
  STRUCTURE_EXTENSIONS,
  TRAJ_EXTENSIONS,
  TRAJ_KEYWORDS,
  VASP_VOLUMETRIC_REGEX,
} from '$lib/constants'
import { VOLUMETRIC_VASP_RE } from '$lib/file-viewer/types'
import { DEFAULTS, SETTINGS_CONFIG, type SettingType } from '$lib/settings'
import type { ThemeName } from '$lib/theme/index'
import { is_trajectory_file, LARGE_FILE_THRESHOLD } from '$lib/trajectory/parse'
import { Buffer } from 'node:buffer'
import type * as node_path from 'node:path'
import { gzipSync } from 'node:zlib'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ExtensionContext, Tab, TextEditor, Uri, WebviewOptions } from 'vscode'
import pkg_json from '../package.json' with { type: 'json' }
import type { MessageData } from '../src/extension'
import { MAX_TEXT_TRAJECTORY_SIZE } from '../src/node-io'
import {
  activate,
  active_auto_render_panels,
  active_frame_loaders,
  active_watcher_subscribers,
  active_watchers,
  auto_render_timers,
  create_html,
  get_defaults,
  get_file,
  get_theme,
  handle_msg,
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
    basename: vi.fn((p: string) => p.split(`/`).pop() ?? ``),
    dirname: vi.fn((p: string) => p.split(`/`).slice(0, -1).join(`/`) || `/`),
    join: vi.fn((...paths: string[]) => paths.join(`/`)),
    isAbsolute: vi.fn((p: string) => p.startsWith(`/`)),
  }
})

const msg_args = {
  // generic placeholder arguments for all messages
  filename: `filename`,
  request_id: `request_id`,
  file_path: `file_path`,
  frame_index: 0,
} as const
const mock_base64 = Buffer.from(`mock content`).toString(`base64`)

// request envelopes: the protocol requires `filename` even though the VS Code host
// re-derives it from file_path
const basename_of = (file_path: string) => file_path.split(`/`).pop() ?? file_path
const large_file_msg = (file_path: string, request_id: string): MessageData => ({
  command: `request_large_file`,
  request_id,
  file_path,
  filename: basename_of(file_path),
})
const frame_msg = (file_path: string, frame_index: number): MessageData => ({
  command: `request_frame`,
  request_id: `frame-request`,
  file_path,
  filename: basename_of(file_path),
  frame_index,
})
const watch_msg = (
  file_path: string,
  command: `startWatching` | `stopWatching` = `startWatching`,
): MessageData => ({ command, ...msg_args, file_path })

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

const mock_vscode = vi.hoisted(() => ({
  window: {
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
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
    })),
    onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
    openTextDocument: vi.fn(),
    onDidOpenTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    onDidCreateFiles: vi.fn(() => ({ dispose: vi.fn() })),
    onDidRenameFiles: vi.fn(() => ({ dispose: vi.fn() })),
    createFileSystemWatcher: vi.fn(() => ({
      onDidChange: vi.fn(),
      onDidDelete: vi.fn(),
      dispose: vi.fn(),
    })),
    fs: { stat: vi.fn(), readFile: vi.fn(), writeFile: vi.fn() },
  },
  commands: { registerCommand: vi.fn(), executeCommand: vi.fn() },
  Uri: {
    file: vi.fn((p: string) => ({ fsPath: p })),
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

    for (const state of [
      active_watchers,
      active_watcher_subscribers,
      active_frame_loaders,
      auto_render_timers,
      active_auto_render_panels,
    ])
      state.clear()

    mock_fs.existsSync.mockReturnValue(true)
    mock_fs.readdirSync.mockReturnValue([])
    mock_vscode.window.activeTextEditor = null

    // Reset theme to default Light theme to avoid inter-test coupling
    mock_vscode.window.activeColorTheme = { kind: 1 } // Light theme by default

    // Set up file system watcher mock
    mock_file_system_watcher = {
      onDidChange: vi.fn(),
      onDidDelete: vi.fn(),
      dispose: vi.fn(),
    }
    mock_vscode.workspace.createFileSystemWatcher.mockReturnValue(mock_file_system_watcher)

    // Set up default mock for vscode.workspace.fs.stat to return file stats
    mock_vscode.workspace.fs.stat.mockResolvedValue({ size: 1000, type: 1 })
    mock_vscode.workspace.fs.readFile.mockResolvedValue(
      new Uint8Array(Buffer.from(`mock content`)),
    )
  })

  test(`extensionKind should be configured as ["workspace"] to work locally and in remote SSH sessions`, () => {
    // https://github.com/janosh/matterviz/issues/129#issuecomment-3193473225
    expect(pkg_json.extensionKind).toEqual([`workspace`])
  })

  test(`VS Code API types match the minimum supported editor version`, () => {
    expect(pkg_json.devDependencies[`@types/vscode`]).toBe(
      pkg_json.engines.vscode.replace(/^\^/, `~`),
    )
  })

  test(`extension volumetric regex stays in sync with app detection`, () => {
    expect(VOLUMETRIC_VASP_RE.source).toBe(VASP_VOLUMETRIC_REGEX.source)
    expect(VOLUMETRIC_VASP_RE.flags).toBe(VASP_VOLUMETRIC_REGEX.flags)
  })

  test(`generated settings in package.json match SETTINGS_CONFIG`, () => {
    // sync-config.ts only regenerates package.json on `prebuild`, so a schema edit stays
    // invisible to the editor until someone runs it.
    const synced_fields = [
      `type`,
      `default`,
      `description`,
      `minimum`,
      `maximum`,
      `multipleOf`,
      `minItems`,
      `maxItems`,
      `enum`,
      `items`,
    ] as const
    const pick = (obj: Record<string, unknown>): Record<string, unknown> =>
      Object.fromEntries(synced_fields.map((field) => [field, obj[field]]))

    const expected: Record<string, Record<string, unknown>> = {}
    const collect = (node: unknown, key_path: string): void => {
      if (!node || typeof node !== `object`) return
      if (!(`value` in node)) {
        for (const [key, val] of Object.entries(node)) collect(val, `${key_path}.${key}`)
        return
      }
      const schema = node as SettingType
      if (schema.context && ![`editor`, `all`].includes(schema.context)) return
      const type =
        typeof schema.value === `boolean`
          ? `boolean`
          : typeof schema.value === `number`
            ? `number`
            : Array.isArray(schema.value)
              ? `array`
              : `string`
      const first_item = Array.isArray(schema.value) ? schema.value[0] : undefined
      const item_type =
        typeof first_item === `boolean`
          ? `boolean`
          : typeof first_item === `number`
            ? `number`
            : `string`
      expected[key_path] = pick({
        ...schema,
        type,
        default: schema.value,
        enum: schema.enum && Object.keys(schema.enum),
        items: type === `array` ? { type: item_type } : undefined,
      })
    }
    collect(SETTINGS_CONFIG, `matterviz`)

    const props = pkg_json.contributes.configuration.properties as unknown as Record<
      string,
      Record<string, unknown> | undefined
    >
    const actual = Object.fromEntries(
      Object.keys(expected).map((key) => [key, pick(props[key] ?? {})]),
    )
    expect(actual).toEqual(expected)

    // sync-config.ts preserves properties it did not generate, so a setting deleted from (or
    // scoped away from the editor in) SETTINGS_CONFIG can linger in package.json unnoticed.
    // These three are hand-written and have no SETTINGS_CONFIG entry; anything else is stale.
    const package_only = [`matterviz.auto_render`, `matterviz.open_beside`, `matterviz.theme`]
    const unexpected = Object.keys(props)
      .filter((key) => !(key in expected))
      .sort()
    expect(unexpected).toEqual(package_only)
  })

  describe(`Custom Editor File Patterns`, () => {
    const custom_editors = pkg_json.contributes.customEditors
    const matterviz_editor = custom_editors.find(
      (editor) => editor.viewType === `matterviz.viewer`,
    )
    const patterns = matterviz_editor?.selector.map((sel) => sel.filenamePattern) ?? []

    // Tests if a filename matches any pattern (simplified glob matching).
    const matches_any_pattern = (filename: string): boolean =>
      patterns.some((pattern) => {
        // Convert glob pattern to regex
        const regex_str = pattern
          .replaceAll(`.`, `\\.`) // escape dots
          .replaceAll(`*`, `.*`) // * → .*
          .replaceAll(/\{(?<braced>[^}]+)\}/g, (_, group) => `(${group.split(`,`).join(`|`)})`) // {a,b} → (a|b)
        return new RegExp(`^${regex_str}$`, `i`).test(filename)
      })

    test(`should have matterviz.viewer custom editor defined`, () => {
      expect(matterviz_editor).toBeDefined()
      expect(matterviz_editor?.displayName).toBe(`MatterViz Viewer`)
    })

    // Tests auto-synced with library constants to prevent regressions
    test.each<[string, string]>([
      // All trajectory extensions from library
      ...TRAJ_EXTENSIONS.map(
        (ext: string) => [`test${ext}`, `TRAJ_EXT ${ext}`] as [string, string],
      ),
      // All structure extensions from library (uncompressed, .gz, .bz2)
      ...STRUCTURE_EXTENSIONS.flatMap(
        (ext: string) =>
          [
            [`test${ext}`, `STRUCT_EXT ${ext}`],
            [`test${ext}.gz`, `${ext}.gz`],
          ] as [string, string][],
      ),
      // All trajectory keywords in filenames
      ...TRAJ_KEYWORDS.map(
        (kw: string) => [`${kw}_output.dat`, `TRAJ_KW ${kw}`] as [string, string],
      ),
      // VASP special filenames + additional VS Code-only formats
      [`POSCAR`, `VASP`],
      [`CONTCAR`, `VASP`],
      [`XDATCAR`, `VASP`],
      [`simulation.h5`, `HDF5`],
      [`data.hdf5`, `HDF5`],
      [`dynamics.dcd`, `DCD`],
      [`run.trr`, `TRR`],
      // xyz/extxyz are editor-only (not in STRUCTURE_EXTENSIONS)
      [`molecule.xyz`, `XYZ`],
      [`atoms.extxyz`, `extXYZ`],
      // VASP volumetric filenames, incl. compressed and band/run-suffixed variants
      // (.cube / .cube.gz covered by STRUCTURE_EXTENSIONS above)
      ...[
        `CHGCAR`,
        `AECCAR0`,
        `AECCAR1`,
        `AECCAR2`,
        `ELFCAR`,
        `LOCPOT`,
        `PARCHG`,
        `PARCHG.gz`,
        `PARCHG.BAND_1`,
        `run_PARCHG_001`,
      ].map((filename) => [filename, `VASP volumetric`] as [string, string]),
    ])(`pattern matches "%s" (%s)`, (filename) => {
      expect(matches_any_pattern(filename)).toBe(true)
    })

    test.each([
      [`OUTCAR`],
      [`myCHGCARfile`],
      [`prefixPARCHGsuffix`],
      [`notes_ELFCARbackup`],
      [`report-AECCARnotes`],
      [`density.cube.bz2`],
      [`structure.cif.bz2`],
    ])(`pattern does not match unsupported near miss "%s"`, (filename) => {
      expect(matches_any_pattern(filename)).toBe(false)
    })

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
      const open_command = commands.get(`matterviz.open`)
      expect(open_command).toBeDefined()
      await open_command?.()

      expect(mock_vscode.window.createWebviewPanel).not.toHaveBeenCalled()
      expect(mock_vscode.window.showErrorMessage).toHaveBeenCalledWith(
        `MatterViz cannot open README.md because it is not a supported structure or trajectory file.`,
      )
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
  // Per-panel webview: own postMessage spy so fan-out to multiple panels is
  // distinguishable, plus a disposable message listener to assert cleanup
  const make_webview = (dispose: () => void = vi.fn()) => ({
    ...mock_webview,
    postMessage: vi.fn(),
    onDidReceiveMessage: vi.fn(() => ({ dispose })),
    options: undefined as WebviewOptions | undefined,
  })
  const mock_context = {
    extensionUri: { fsPath: `/test` },
    subscriptions: [],
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

  test.each([
    [`test.gz`, true],
    [`test.h5`, true],
    [`test.traj`, true], // ASE binary files should be treated as compressed
    [`test.hdf5`, true],
    [`test.cif`, false],
    [`test.xyz`, false], // .xyz files are text format, not compressed binary
    [`test.json`, false],
    [``, false],
  ])(`file reading: "%s" → compressed:%s`, async (filename, expected_compressed) => {
    const result = await read_file(`/test/${filename}`)
    expect(result.filename).toBe(filename)
    expect(result.is_base64).toBe(expected_compressed)
    // Assert payload differences instead of redundant API calls
    expect(result.content).toBe(expected_compressed ? mock_base64 : `mock content`)
  })

  test.each([`large-trajectory.traj`, `large.extxyz`])(
    `file reading: large trajectory %s returns an indexed marker`,
    async (filename) => {
      const large_file_size = LARGE_FILE_THRESHOLD + 1
      const file_path = `/test/${filename}`
      mock_vscode.workspace.fs.stat.mockResolvedValue({ size: large_file_size, type: 1 })

      const result = await read_file(file_path)

      expect(result).toEqual({
        filename,
        content: `LARGE_FILE:${file_path}:${large_file_size}`,
        is_base64: false,
      })
      expect(mock_vscode.workspace.fs.readFile).not.toHaveBeenCalled()
    },
  )

  test.each([
    [`large-structure.cif`, LARGE_FILE_THRESHOLD + 1, `supports trajectories only`],
    [`large.extxyz`, MAX_TEXT_TRAJECTORY_SIZE + 1, `Maximum supported size: 512.00 MiB`],
    [`huge.extxyz`, 1024 ** 3 + 1, `Maximum supported size: 512.00 MiB`],
    [`large-trajectory.traj`, 1024 ** 3 + 1, `Maximum supported size`],
  ])(`file reading: rejects unsupported large file %s`, async (filename, file_size, error) => {
    mock_vscode.workspace.fs.stat.mockResolvedValue({ size: file_size, type: 1 })

    await expect(read_file(`/test/${filename}`)).rejects.toThrow(error)
    expect(mock_vscode.workspace.fs.readFile).not.toHaveBeenCalled()
  })

  test(`large compressed EXTXYZ request is parsed and registered for frame loading`, async () => {
    const file_path = `/test/movie.extxyz.gz`
    const trajectory = [`1`, `frame=0`, `H 0 0 0`, `1`, `frame=1`, `H 1 0 0`, ``].join(`\n`)
    const compressed = new Uint8Array(gzipSync(trajectory))
    mock_vscode.workspace.fs.stat.mockResolvedValue({ size: compressed.byteLength, type: 1 })
    mock_vscode.workspace.fs.readFile.mockResolvedValue(compressed)

    await handle_msg(large_file_msg(file_path, `large-request`), mock_webview)

    expect(active_frame_loaders.get(file_path)).toMatchObject({
      file_data: trajectory,
    })
    expect(mock_webview.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        command: `large_file_response`,
        request_id: `large-request`,
      }),
    )
    const large_file_response = mock_webview.postMessage.mock.calls.at(-1)?.[0] as {
      parsed_trajectory: object
    }
    expect(large_file_response.parsed_trajectory).not.toHaveProperty(`frame_loader`)

    mock_webview.postMessage.mockClear()
    await handle_msg(frame_msg(file_path, 1), mock_webview)
    expect(mock_webview.postMessage).toHaveBeenLastCalledWith({
      command: `frame_response`,
      request_id: `frame-request`,
      frame: expect.any(Object),
      frame_index: 1,
    })
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
    [`missing frame loader`, `/test/missing.extxyz`, 0, `No frame loader found`],
  ])(`request_frame reports %s`, async (_label, file_path, frame_index, error) => {
    await handle_msg(frame_msg(file_path, frame_index), mock_webview)

    expect(mock_webview.postMessage).toHaveBeenLastCalledWith({
      command: `frame_response`,
      request_id: `frame-request`,
      error: expect.stringContaining(error),
      frame_index,
    })
  })

  test(`ASE trajectory file end-to-end processing`, async () => {
    const ase_filename = `ase-LiMnO2-chgnet-relax.traj`
    expect(is_trajectory_file(ase_filename)).toBe(true)

    const data = await read_file(`/test/${ase_filename}`)
    const html = create_html(mock_webview, mock_context, { data, theme: `light` })
    const parsed_data = JSON.parse(
      /matterviz_data=(?<json>\{[\s\S]*?\});/.exec(html)?.[1] ?? `{}`,
    )
    expect(parsed_data).toEqual({
      data: { filename: ase_filename, content: mock_base64, is_base64: true },
      theme: `light`,
    })
  })

  test.each([
    {
      label: `explicit URI`,
      uri: `/test/file.cif`,
      expect_filename: `file.cif`,
      from_disk: true,
    },
    {
      label: `explicit URI xyz`,
      uri: `/test/structure.xyz`,
      expect_filename: `structure.xyz`,
      from_disk: true,
    },
    // unsaved editor buffers must win over the on-disk copy
    {
      label: `active editor buffer`,
      editor: `/test/active.cif`,
      content: `unsaved`,
      expect_filename: `active.cif`,
      from_disk: false,
    },
    {
      label: `URI matching active editor`,
      uri: `/test/active.cif`,
      editor: `/test/active.cif`,
      content: `unsaved`,
      expect_filename: `active.cif`,
      from_disk: false,
    },
    {
      label: `URI different from active editor`,
      uri: `/test/other.cif`,
      editor: `/test/active.cif`,
      content: `unsaved`,
      expect_filename: `other.cif`,
      from_disk: true,
    },
    { label: `active tab`, tab: `/test/tab.cif`, expect_filename: `tab.cif`, from_disk: true },
    {
      label: `no target`,
      error: `No file selected. MatterViz needs an active editor to know what to render.`,
    },
  ])(
    `get_file ($label)`,
    async ({ uri, editor, tab, content, expect_filename, from_disk, error }) => {
      set_active_editor(editor, content ?? ``)
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
      if (from_disk) {
        expect(mock_vscode.workspace.fs.readFile).toHaveBeenCalled()
      } else {
        expect(result).toEqual({
          filename: expect_filename,
          content,
          is_base64: false,
        })
        expect(mock_vscode.workspace.fs.readFile).not.toHaveBeenCalled()
      }
    },
  )

  test.each([
    [`structure`, { filename: `test.cif`, content: `content`, is_base64: false }],
    [`trajectory`, { filename: `test.traj`, content: `YmluYXJ5`, is_base64: true }],
    [`structure`, { filename: `test"quotes.cif`, content: `content`, is_base64: false }],
    [`structure`, { filename: `test.cif`, content: ``, is_base64: false }],
    [
      `structure`,
      { filename: `test.cif`, content: `<script>alert("xss")</script>`, is_base64: false },
    ],
    [`structure`, { filename: `large.cif`, content: `x`.repeat(100_000), is_base64: false }],
  ] as const)(`HTML generation: %s files`, (type, data) => {
    const webview_data = { type, data, theme: `light` } as const
    const html = create_html(mock_webview, mock_context, webview_data)
    expect(html).toContain(`<!DOCTYPE html>`)
    expect(html).toContain(`Content-Security-Policy`)
    expect(html).toContain(`default-src 'none'`)
    expect(html).toContain(`script-src 'nonce-`)
    expect(html).toMatch(/nonce="[a-zA-Z0-9]{8,32}"/)
    expect(html).toContain(JSON.stringify(webview_data).replaceAll(`</`, `<\\/`))
    expect(html).toContain(`matterviz-app`)
  })

  test.each([
    [{ command: `info`, text: `Test message` }, `showInformationMessage`],
    [{ command: `error`, text: `Error message` }, `showErrorMessage`],
    [{ command: `info`, text: `"><script>alert(1)</script>` }, `showInformationMessage`],
    [{ command: `error`, text: `javascript:alert(1)` }, `showErrorMessage`],
  ] as const)(`message handling: %s`, async (message, expected_method) => {
    await handle_msg(message)
    expect(
      mock_vscode.window[expected_method as keyof typeof mock_vscode.window],
    ).toHaveBeenCalledWith(message.text)
  })

  test.each([`content`, `<script>alert("XSS")</script>`])(
    `saveAs writes text content verbatim: %s`,
    async (content) => {
      mock_vscode.window.showSaveDialog.mockResolvedValue({ fsPath: `/test/save.cif` })
      await handle_msg({ command: `saveAs`, content, filename: `test.cif` })
      expect(mock_vscode.workspace.fs.writeFile).toHaveBeenCalledWith(
        { fsPath: `/test/save.cif` },
        new TextEncoder().encode(content),
      )
      expect(mock_vscode.window.showInformationMessage).toHaveBeenCalledWith(`Saved: save.cif`)
    },
  )

  test(`saveAs binary data URL writes decoded bytes`, async () => {
    const filename = `structure.png`
    mock_vscode.window.showSaveDialog.mockResolvedValue({ fsPath: `/test/${filename}` })
    await handle_msg({
      command: `saveAs`,
      content: `data:image/png;base64,/wCA`,
      ...msg_args,
      filename,
      is_binary: true,
    })
    expect(mock_vscode.workspace.fs.writeFile).toHaveBeenCalledWith(
      { fsPath: `/test/${filename}` },
      Uint8Array.from([255, 0, 128]),
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
      filename: `test.cif`,
      error: `Failed to save text file: Write failed`,
    },
    {
      label: `user cancellation`,
      dialog: undefined,
      content: `content`,
      filename: `test.cif`,
    },
    {
      label: `empty base64`,
      dialog: { fsPath: `/test/test.png` },
      content: `data:image/png;base64,`,
      filename: `test.png`,
      is_binary: true,
      error: `Failed to save binary data: Invalid data URL: missing base64 data`,
    },
  ])(`saveAs $label`, async ({ dialog, write_error, content, filename, is_binary, error }) => {
    mock_vscode.window.showSaveDialog.mockResolvedValue(dialog)
    if (write_error) {
      mock_vscode.workspace.fs.writeFile.mockRejectedValue(new Error(write_error))
    }

    await handle_msg({
      command: `saveAs`,
      content,
      ...msg_args,
      filename,
      is_binary,
    })

    if (error) {
      expect(mock_vscode.window.showErrorMessage).toHaveBeenCalledWith(error)
    }
    expect(mock_vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(write_error ? 1 : 0)
  })

  // messages missing their payload (text/content) or with an unknown command are ignored
  test.each([{ command: `info` }, { command: `saveAs` }, { command: `unknown` }])(
    `malformed message handling: $command`,
    async (msg) => {
      await expect(
        handle_msg({ ...msg, ...msg_args } as unknown as MessageData),
      ).resolves.toBeUndefined()
    },
  )

  test.each([
    [`active editor`, `/test/active.cif`, true],
    [`active tab`, `/test/tab.cif`, false],
  ] as const)(
    `render from %s creates a panel and watches the file`,
    async (_source, file_path, use_editor) => {
      const basename = file_path.split(`/`).pop() as string
      if (use_editor) {
        mock_vscode.window.tabGroups.activeTabGroup.activeTab = null
        set_active_editor(file_path)
      } else {
        mock_vscode.window.activeTextEditor = null
        mock_vscode.window.tabGroups.activeTabGroup.activeTab = {
          input: { uri: { fsPath: file_path } },
        } as unknown as Tab
      }
      mock_vscode.window.createWebviewPanel.mockReturnValue({
        webview: make_webview(),
        onDidDispose: vi.fn(),
        visible: true,
      })

      await render(mock_context)

      expect(mock_vscode.window.createWebviewPanel).toHaveBeenCalledWith(
        `matterviz`,
        `MatterViz - ${basename}`,
        mock_vscode.ViewColumn.Active,
        expect.any(Object),
      )
      expect(mock_vscode.workspace.createFileSystemWatcher).toHaveBeenCalledWith(
        expect.objectContaining({ pattern: basename }),
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

  test(`extension activation`, () => {
    activate(mock_context)
    expect(mock_vscode.commands.registerCommand).toHaveBeenCalledWith(
      `matterviz.open`,
      expect.any(Function),
    )
    expect(mock_vscode.commands.registerCommand).toHaveBeenCalledWith(
      `matterviz.report_bug`,
      expect.any(Function),
    )
    expect(mock_vscode.window.registerCustomEditorProvider).toHaveBeenCalledWith(
      `matterviz.viewer`,
      expect.any(Object),
      expect.any(Object),
    )
  })

  describe(`Bug Reporting`, () => {
    let mock_opened_document: { content: string; language: string } | null = null
    let report_bug_command: CommandCallback | null = null
    const mock_env = mock_vscode.env

    // Every mock below has to be in place before activate() registers the command
    beforeEach(() => {
      mock_opened_document = null
      report_bug_command = null

      mock_env.appName = `Cursor`
      mock_env.remoteName = undefined

      const command_registry = capture_commands()

      // capture the report content instead of opening a real editor document
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
      // no follow-up action chosen by default; individual tests opt into one
      mock_vscode.window.showInformationMessage = vi.fn(() => Promise.resolve(undefined))

      activate(mock_context)
      report_bug_command = command_registry.get(`matterviz.report_bug`) ?? null
    })

    // Assert the command was registered, run it, and return the generated report
    const run_report_bug = async (): Promise<string> => {
      expect(report_bug_command).not.toBeNull()
      await report_bug_command?.()
      return mock_opened_document?.content ?? ``
    }

    // Register a file watcher via the startWatching message (populates the report)
    const start_watching = (filename: string) =>
      handle_msg(watch_msg(`/test/${filename}`), mock_webview)

    // Pick a follow-up action from the notification shown after the report is generated
    const choose_action = (action: string) => {
      mock_vscode.window.showInformationMessage = vi.fn(() => Promise.resolve(action))
    }

    test(`should generate bug report with environment information`, async () => {
      const content = await run_report_bug()

      expect(mock_opened_document).not.toBeNull()
      expect(mock_opened_document?.language).toBe(`markdown`)

      for (const snippet of [
        // Main sections
        `### Environment`,
        `### System Resources`,
        `### Active Files & Extension State`,
        `### Console Logs`,
        // Environment details
        `- **Editor**: Cursor`,
        `- **MatterViz Version**: ${pkg_json.version}`,
        `- **UI Kind**: Desktop`,
        `- **Remote Session**: No (Local)`,
        // System resources
        `- **Total Memory**:`,
        `- **Free Memory**:`,
        `- **Process RSS**:`,
        `- **Process Heap Used**:`,
        `- **Process Heap Total**:`,
        // Console logs instructions
        `**Please check for console errors/warnings:**`,
        `Toggle Developer Tools`,
        `Tip: You can filter console messages`,
        // No watchers registered in this test
        `No files currently being watched/rendered.`,
        // GitHub link
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

      // Should list both files with bold filenames (not headers)
      expect(content).toContain(`**structure.cif**`)
      expect(content).toContain(`**trajectory.traj**`)
      expect(content).toContain(`- **Path**: \`/test/structure.cif\``)
      expect(content).toContain(`- **Path**: \`/test/trajectory.traj\``)
      expect(content).toContain(`- **Has Watcher**: true`)
      // Check for combined section and extension state counters
      expect(content).toContain(`### Active Files & Extension State`)
      expect(content).toContain(`- **Active Watchers**: 2`)
      expect(content).toMatch(/- \*\*Active Frame Loaders\*\*: \d+/)
      expect(content).toMatch(/- \*\*Auto-Render Timers\*\*: \d+/)
      expect(content).toMatch(/- \*\*Active Auto-Render Panels\*\*: \d+/)
    })

    test(`should copy to clipboard when user selects that option`, async () => {
      choose_action(`Copy to Clipboard`)
      const content = await run_report_bug()
      expect(mock_env.clipboard.writeText).toHaveBeenCalledWith(content)
      expect(mock_vscode.window.showInformationMessage).toHaveBeenCalledWith(
        `Debug information copied to clipboard!`,
      )
    })

    test(`should open GitHub issues when user selects that option`, async () => {
      choose_action(`Open GitHub Issues`)
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
      // Persistent stat mock resolving each watched file to its configured size
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
      // Should still include the file but with "Unknown" size
      expect(content).toContain(`**error-file.cif**`)
      expect(content).toContain(`- **Size**: Unknown`)
    })

    test(`should handle errors during report generation`, async () => {
      mock_vscode.workspace.openTextDocument = vi.fn(() =>
        Promise.reject(new Error(`Failed to create document`)),
      )

      expect(report_bug_command).not.toBeNull()
      await report_bug_command?.()

      expect(mock_vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining(`Failed to collect debug information`),
      )
    })
  })

  test(`nonce uniqueness`, () => {
    const data = {
      data: { filename: `test.cif`, content: `content`, is_base64: false },
      theme: `light`,
    } as const
    const nonces = new Set<string>()

    for (let idx = 0; idx < 1000; idx++) {
      const html = create_html(mock_webview, mock_context, data)
      const nonce_match = /nonce="(?<nonce>[a-zA-Z0-9]+)"/.exec(html)
      if (nonce_match) nonces.add(nonce_match[1])
    }

    expect(nonces.size).toBe(1000)
  })

  test.each([
    `<script>alert("XSS")</script>`,
    `<img src="x" onerror="alert(1)">`,
    `javascript:alert(1)`,
    `"><script>alert(1)</script>`,
    `';alert(1);//`,
    `</script><script>alert(document.cookie)</script>`,
  ])(`XSS prevention: %s`, (payload) => {
    const data = {
      data: { filename: `test.cif`, content: payload, is_base64: false },
      theme: `light`,
    } as const
    const html = create_html(mock_webview, mock_context, data)
    const escaped_json = JSON.stringify(data).replaceAll(`</`, `<\\/`)

    expect(html).toContain(escaped_json)
    // Ensure no raw </script> inside the JSON data breaks out of the script tag
    const data_script = /window\.matterviz_data=(?<json>.*?);/s.exec(html)
    if (data_script) expect(data_script[1]).not.toContain(`</script>`)
  })

  describe(`Theme functionality`, () => {
    // Stub vscode.workspace.getConfiguration so get(`theme`, default) returns theme_value
    const stub_theme_config = (theme_value: string) => {
      mock_vscode.workspace.getConfiguration = vi.fn(() => ({
        get: vi.fn((key: string, default_value?: string) =>
          key === `theme` ? theme_value : default_value,
        ),
      })) as unknown as typeof mock_vscode.workspace.getConfiguration
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

        const result = get_theme()
        expect(result).toBe(expected)
      },
    )

    test(`webview data includes theme`, () => {
      stub_theme_config(`dark`)

      const data = {
        data: { filename: `test.cif`, content: `content`, is_base64: false },
        theme: get_theme(),
      }

      const html = create_html(mock_webview, mock_context, data)

      const parsed_data = JSON.parse(
        /matterviz_data=(?<json>\{[\s\S]*?\});/.exec(html)?.[1] ?? `{}`,
      )
      expect(parsed_data.theme).toBe(`dark`)
    })

    // high-contrast auto mappings (HighContrast → black, HighContrastLight → white)
    // are covered by the theme detection test.each above

    test(`invalid theme setting falls back to auto`, () => {
      stub_theme_config(`invalid-theme`)
      mock_vscode.window.activeColorTheme = {
        kind: mock_vscode.ColorThemeKind.Light,
      }

      const result = get_theme()
      expect(result).toBe(`light`) // Should fall back to system theme
    })
  })

  describe(`Panel listener cleanup`, () => {
    const setup_panel = (options = {}) => {
      const mock_dispose = vi.fn()
      const mock_panel = {
        webview: make_webview(mock_dispose),
        onDidDispose: vi.fn(),
        visible: true,
        ...options,
      }

      mock_vscode.window.createWebviewPanel.mockReturnValue(mock_panel)
      mock_vscode.window.onDidChangeActiveColorTheme.mockReturnValue({
        dispose: mock_dispose,
      })
      mock_vscode.workspace.onDidChangeConfiguration.mockReturnValue({
        dispose: mock_dispose,
      })
      set_active_editor(`/test/active.cif`)

      return { mock_dispose, mock_panel }
    }

    test(`sets up and cleans up panel listeners`, async () => {
      const { mock_dispose, mock_panel } = setup_panel()

      await render(mock_context)

      expect(mock_vscode.window.onDidChangeActiveColorTheme).toHaveBeenCalled()
      expect(mock_panel.onDidDispose).toHaveBeenCalled()

      // Test cleanup
      mock_panel.onDidDispose.mock.calls[0][0]()
      expect(mock_dispose).toHaveBeenCalledTimes(3)
    })

    test(`respects panel visibility for theme updates`, async () => {
      const { mock_panel } = setup_panel({ visible: false })

      await render(mock_context)

      // Store initial HTML after render (render always sets HTML initially)
      const initial_html = mock_panel.webview.html

      const theme_calls = mock_vscode.window.onDidChangeActiveColorTheme.mock
        .calls as unknown as unknown[][]
      const theme_callback = theme_calls[0]?.[0] as (() => Promise<void>) | undefined
      expect(theme_callback).toBeDefined()

      // Should not update when invisible
      await theme_callback?.()
      expect(mock_panel.webview.html).toBe(initial_html)

      // Should update when visible
      mock_panel.visible = true
      await theme_callback?.()
      expect(mock_panel.webview.html).not.toBe(initial_html)
    })

    test(`multiple panels dispose independently`, async () => {
      const dispose1 = vi.fn()
      const dispose2 = vi.fn()
      const panel1 = { webview: make_webview(dispose1), onDidDispose: vi.fn() }
      const panel2 = { webview: make_webview(dispose2), onDidDispose: vi.fn() }

      mock_vscode.window.createWebviewPanel
        .mockReturnValueOnce(panel1)
        .mockReturnValueOnce(panel2)
      for (const listener of [
        mock_vscode.window.onDidChangeActiveColorTheme,
        mock_vscode.workspace.onDidChangeConfiguration,
      ]) {
        listener.mockReturnValueOnce({ dispose: dispose1 }).mockReturnValueOnce({
          dispose: dispose2,
        })
      }

      set_active_editor(`/test/active.cif`)

      await render(mock_context)
      await render(mock_context)

      panel1.onDidDispose.mock.calls[0][0]()
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

      // Register the provider via activate() and grab the instance VSCode would use
      const get_provider = (): ProviderLike => {
        activate(mock_context)
        return mock_vscode.window.registerCustomEditorProvider.mock.calls[0][1] as ProviderLike
      }

      test(`resolveCustomEditor wires webview options, html, watcher, and cleanup`, async () => {
        const provider = get_provider()
        const { mock_dispose, mock_panel: panel } = setup_panel()

        const file_path = `/test/custom-editor.cif`
        const document = provider.openCustomDocument({ fsPath: file_path }, {}, {})
        await provider.resolveCustomEditor(document, panel, {})

        // No error path taken, webview fully configured
        expect(panel.webview.options).toMatchObject({ enableScripts: true })
        expect(
          (panel.webview.options as { localResourceRoots: unknown[] }).localResourceRoots,
        ).toHaveLength(1)
        expect(panel.webview.html).toContain(`custom-editor.cif`)
        expect(panel.webview.onDidReceiveMessage).toHaveBeenCalledWith(
          expect.any(Function),
          undefined,
        )
        expect(active_watchers.has(file_path)).toBe(true)

        // Dispose tears down message/theme/config listeners and the file watcher
        panel.onDidDispose.mock.calls[0][0]()
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
      const shared_watcher = {
        onDidChange: vi.fn(),
        onDidDelete: vi.fn(),
        dispose: vi.fn(),
      }
      const disposable = () => ({ dispose: vi.fn() })
      const webview1 = make_webview()
      const webview2 = make_webview()
      const panel1 = { webview: webview1, onDidDispose: vi.fn(), visible: true }
      const panel2 = { webview: webview2, onDidDispose: vi.fn(), visible: true }

      mock_vscode.workspace.createFileSystemWatcher.mockReturnValue(shared_watcher)
      mock_vscode.window.onDidChangeActiveColorTheme.mockReturnValue(disposable())
      mock_vscode.workspace.onDidChangeConfiguration.mockReturnValue(disposable())
      mock_vscode.window.createWebviewPanel
        .mockReturnValueOnce(panel1)
        .mockReturnValueOnce(panel2)
      set_active_editor(`/test/file.cif`)

      await render(mock_context)
      await render(mock_context)

      expect(mock_vscode.workspace.createFileSystemWatcher).toHaveBeenCalledTimes(1)

      const change_handler = shared_watcher.onDidChange.mock.calls[0]?.[0] as
        | (() => Promise<void> | void)
        | undefined
      expect(change_handler).toBeDefined()
      mock_vscode.workspace.fs.readFile.mockClear()
      await change_handler?.()

      await vi.waitFor(() => {
        for (const webview of [webview1, webview2]) {
          expect(webview.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
              command: `fileUpdated`,
              file_path: `/test/file.cif`,
            }),
          )
        }
      })
      // one shared read fans out to both panels rather than one read per panel
      expect(mock_vscode.workspace.fs.readFile).toHaveBeenCalledTimes(1)

      panel1.onDidDispose.mock.calls[0]?.[0]()
      expect(shared_watcher.dispose).not.toHaveBeenCalled()

      panel2.onDidDispose.mock.calls[0]?.[0]()
      expect(shared_watcher.dispose).toHaveBeenCalledTimes(1)
    })

    describe(`message handling`, () => {
      const watch_path = `/test/file.cif`
      const start_watching = watch_msg(watch_path)
      const stop_watching = watch_msg(watch_path, `stopWatching`)

      test(`startWatching registers a watcher and stopWatching disposes its subscriber`, async () => {
        await handle_msg(start_watching, mock_webview)

        expect(mock_vscode.workspace.createFileSystemWatcher).toHaveBeenCalledWith(
          expect.objectContaining({
            base: expect.anything(),
            pattern: `file.cif`,
          }),
        )
        expect(mock_file_system_watcher.onDidChange).toHaveBeenCalledWith(expect.any(Function))
        expect(mock_file_system_watcher.onDidDelete).toHaveBeenCalledWith(expect.any(Function))
        mock_file_system_watcher.dispose.mockClear()

        await expect(handle_msg(stop_watching)).resolves.not.toThrow()
        expect(mock_file_system_watcher.dispose).not.toHaveBeenCalled()
        expect(active_watchers.has(watch_path)).toBe(true)

        await handle_msg(stop_watching, mock_webview)
        expect(mock_file_system_watcher.dispose).toHaveBeenCalled()
      })

      test.each([
        { label: `without webview`, message: start_watching, webview: undefined },
        {
          label: `without file_path`,
          message: { command: `startWatching` as const, ...msg_args },
          webview: mock_webview,
        },
        {
          label: `with relative file_path`,
          message: watch_msg(`relative/file.cif`),
          webview: mock_webview,
        },
      ])(`should handle startWatching $label gracefully`, async ({ message, webview }) => {
        await expect(handle_msg(message, webview)).resolves.not.toThrow()
        expect(mock_vscode.workspace.createFileSystemWatcher).not.toHaveBeenCalled()
      })

      test(`should send error message when file watching fails`, async () => {
        mock_vscode.workspace.createFileSystemWatcher.mockImplementation(() => {
          throw new Error(`File system watcher creation failed`)
        })

        await handle_msg(watch_msg(`/test/large-file.cif`), mock_webview)

        expect(mock_webview.postMessage).toHaveBeenCalledWith({
          command: `error`,
          text: expect.stringContaining(`Failed to start watching file`),
        })
      })
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
            ...msg_args,
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
        await handle_msg(watch_msg(`/test/file.cif`), mock_webview)

        const handler = mock_file_system_watcher[register].mock.calls[0][0]
        await handler()

        await vi.waitFor(() => {
          expect(mock_webview.postMessage).toHaveBeenCalledWith(expected)
        })
      })
    })

    // activation itself is covered by the top-level `extension activation` test
  })

  describe(`Auto-Render Functionality`, () => {
    const stub_auto_render = (enabled: boolean | string): void => {
      mock_vscode.workspace.getConfiguration.mockReturnValue({
        get: vi.fn((key: string, default_val: string) =>
          key === `auto_render` ? enabled : default_val,
        ),
      } as unknown as ReturnType<typeof mock_vscode.workspace.getConfiguration>)
    }

    // activate() with a minimal context, then hand back the document-open callback it registered
    const get_open_document_callback = (): ((doc: unknown) => void) => {
      activate({ subscriptions: { push: vi.fn() } } as unknown as ExtensionContext)
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
      // should_auto_render only inspects the filename, so an eligible name still schedules
      // the 100ms render timer; the auto_render config is read inside it. Without advancing
      // past the delay this asserts nothing about the disabled case.
      vi.useFakeTimers()
      try {
        stub_auto_render(auto_render)
        expect(() => get_open_document_callback()({ uri })).not.toThrow()
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

      expect(() => get_open_document_callback()(mock_document)).not.toThrow()

      await vi.waitFor(() => {
        expect(mock_vscode.window.showErrorMessage).toHaveBeenCalledWith(
          expect.stringContaining(`MatterViz auto-render failed:`),
        )
      })
    })
  })

  describe(`Default Settings`, () => {
    // Helper to create mock config and test setting
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
        'structure.camera_position': [1, 2, 3],
        'structure.vector_configs': { force: { visible: true } },
        'trajectory.auto_play': true,
        'trajectory.show_controls': false,
        'scatter.point.size': 7,
        background_color: `#111111`,
      })
      expect(get_defaults()).toMatchObject({
        structure: {
          atom_radius: 1.5,
          show_bonds: `always`,
          camera_position: [1, 2, 3],
          same_size_atoms: DEFAULTS.structure.same_size_atoms,
          vector_configs: { force: { visible: true } },
        },
        trajectory: { auto_play: true, show_controls: false },
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

    test.each([
      [`bond_thickness`, 0.2, 0.2],
      [`site_label_padding`, -1, 0],
      [`rotation_damping`, 1, 0.3],
    ] as const)(`bounds structure.%s override %s to %s`, (key, value, expected) => {
      const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
      apply_overrides({ [`structure.${key}`]: value })
      expect(get_defaults().structure[key]).toBe(expected)
      expect(warn).toHaveBeenCalledTimes(value === expected ? 0 : 1)
    })

    test.each([
      [`missing inspect`, () => ({ get: vi.fn(), inspect: vi.fn(() => undefined) })],
      [
        `invalid structure values`,
        () => ({
          get: vi.fn(),
          inspect: vi.fn((key: unknown) =>
            typeof key === `string` && key.startsWith(`structure.`)
              ? { key, workspaceValue: `invalid` }
              : undefined,
          ),
        }),
      ],
      [
        `getConfiguration throws`,
        () => {
          throw new Error(`Config access failed`)
        },
      ],
    ])(`handles %s without throwing`, (_label, make_config) => {
      mock_vscode.workspace.getConfiguration.mockImplementation(() => make_config())
      expect(() => get_defaults()).not.toThrow()
      expect(get_defaults()).toEqual(
        expect.objectContaining({
          structure: expect.any(Object),
          trajectory: expect.any(Object),
          composition: expect.any(Object),
        }),
      )
    })
  })
})
