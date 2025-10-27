import type { ThemeName } from '$lib/theme/index'
import { is_trajectory_file } from '$lib/trajectory/parse'
import { Buffer } from 'node:buffer'
import * as fs from 'node:fs'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ExtensionContext, Tab, TextEditor } from 'vscode'
import pkg_json from '../package.json' with { type: 'json' }
import {
  activate,
  create_html,
  get_defaults,
  get_file,
  get_theme,
  handle_msg,
  MessageData,
  read_file,
  render,
  should_auto_render,
} from '../src/extension'
import type { FileData } from '../src/webview/main'

// Mock modules
vi.mock(`fs`)
vi.mock(`path`, async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    basename: vi.fn((p: string) => p.split(`/`).pop() || ``),
    dirname: vi.fn((p: string) => p.split(`/`).slice(0, -1).join(`/`) || `/`),
  }
})

const msg_args = { // generic placeholder arguments for all messages
  filename: `filename`,
  request_id: `request_id`,
  file_path: `file_path`,
  frame_index: 0,
} as const

const mock_vscode = vi.hoisted(() => ({
  window: {
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
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
  ViewColumn: { Beside: 2 },
  ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
  UIKind: { Desktop: 1, Web: 2 },
  RelativePattern: vi.fn((base: unknown, pattern: string) => ({ base, pattern })),
  version: `1.99.0`,
  env: {
    appName: `VSCode`,
    remoteName: undefined,
    uiKind: 1, // Desktop
    clipboard: {
      writeText: vi.fn(() => Promise.resolve()),
      readText: vi.fn(() => Promise.resolve(``)),
    },
    openExternal: vi.fn(() => Promise.resolve(true)),
  },
}))

vi.mock(`vscode`, () => mock_vscode)

describe(`MatterViz Extension`, () => {
  const mock_fs = fs

  let mock_file_system_watcher: {
    onDidChange: ReturnType<typeof vi.fn>
    onDidDelete: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
  }

  test(`extensionKind should be configured as ["workspace"] to work locally and in remote SSH sessions`, () => {
    // https://github.com/janosh/matterviz/issues/129#issuecomment-3193473225
    expect(pkg_json.extensionKind).toEqual([`workspace`])
  })

  beforeEach(async () => {
    vi.clearAllMocks()

    // Import extension module and clear all watchers
    const ext = await import(`../src/extension`)
    ext.active_watchers.clear()
    ext.active_frame_loaders.clear()
    ext.auto_render_timers.clear()
    ext.active_auto_render_panels.clear()

    mock_fs.readFileSync = vi.fn().mockReturnValue(`mock content`)
    mock_vscode.window.activeTextEditor = null

    // Reset theme to default Light theme to avoid inter-test coupling
    mock_vscode.window.activeColorTheme = { kind: 1 } // Light theme by default

    // Set up file system watcher mock
    mock_file_system_watcher = {
      onDidChange: vi.fn(),
      onDidDelete: vi.fn(),
      dispose: vi.fn(),
    }
    mock_vscode.workspace.createFileSystemWatcher.mockReturnValue(
      mock_file_system_watcher,
    )

    // Set up default mock for vscode.workspace.fs.stat to return file stats
    mock_vscode.workspace.fs.stat.mockResolvedValue({ size: 1000, type: 1 })
    mock_vscode.workspace.fs.readFile.mockResolvedValue(
      new Uint8Array(Buffer.from(`mock content`)),
    )
  })

  // Test data consolidation
  const mock_webview = {
    cspSource: `vscode-webview:`,
    asWebviewUri: vi.fn((uri: { fsPath: string }) =>
      `vscode-webview://unit-test${encodeURIComponent(uri.fsPath)}`
    ),
    onDidReceiveMessage: vi.fn(),
    postMessage: vi.fn(),
    html: ``,
  }
  const mock_context = { extensionUri: { fsPath: `/test` }, subscriptions: [] }

  test.each([
    [`test.gz`, true],
    [`test.h5`, true],
    [`test.traj`, true], // ASE binary files should be treated as compressed
    [`test.hdf5`, true],
    [`md_npt_300K.traj`, true], // Specific ASE ULM binary file
    [`ase-LiMnO2-chgnet-relax.traj`, true], // Another ASE ULM binary file
    [`test.cif`, false],
    [`test.xyz`, false], // .xyz files are text format, not compressed binary
    [`test.json`, false],
    [``, false],
  ])(`file reading: "%s" → compressed:%s`, async (filename, expected_compressed) => {
    const result = await read_file(`/test/${filename}`)
    expect(result.filename).toBe(filename)
    expect(result.is_base64).toBe(expected_compressed)
    // Assert payload differences instead of redundant API calls
    if (expected_compressed) {
      expect(result.content).toBe(Buffer.from(`mock content`).toString(`base64`))
    } else {
      expect(result.content).toBe(`mock content`)
    }
  })

  test(`file reading: large file should return sentinel`, async () => {
    const large_file_size = 2 * 1024 * 1024 * 1024 // 2GB, above MAX_VSCODE_FILE_SIZE (1GB)
    const filename = `large-structure.cif`
    const file_path = `/test/${filename}`

    // Mock fs.stat to return a size above the threshold
    mock_vscode.workspace.fs.stat.mockResolvedValue({
      size: large_file_size,
      type: 1,
    })

    const result = await read_file(file_path)

    expect(result.filename).toBe(filename)
    expect(result.content).toBe(`LARGE_FILE:${file_path}:${large_file_size}`)
    expect(result.is_base64).toBe(false)
    // readFile should not be called for large files
    expect(mock_vscode.workspace.fs.readFile).not.toHaveBeenCalled()
  })

  test(`file reading: large binary file should return sentinel with base64 flag`, async () => {
    const large_file_size = 2 * 1024 * 1024 * 1024 // 2GB, above MAX_VSCODE_FILE_SIZE (1GB)
    const filename = `large-trajectory.traj`
    const file_path = `/test/${filename}`

    // Mock fs.stat to return a size above the threshold
    mock_vscode.workspace.fs.stat.mockResolvedValue({
      size: large_file_size,
      type: 1,
    })

    const result = await read_file(file_path)

    expect(result.filename).toBe(filename)
    expect(result.content).toBe(`LARGE_FILE:${file_path}:${large_file_size}`)
    expect(result.is_base64).toBe(true) // Binary files should have base64 flag
    // readFile should not be called for large files
    expect(mock_vscode.workspace.fs.readFile).not.toHaveBeenCalled()
  })

  test.each([
    [`md_npt_300K.traj`, true, true], // ASE binary trajectory
    [`ase-LiMnO2-chgnet-relax.traj`, true, true], // ASE binary trajectory
    [`simulation_nvt_250K.traj`, true, true], // ASE binary trajectory
    [`water_cluster_md.traj`, true, true], // ASE binary trajectory
    [`optimization_relax.traj`, true, true], // ASE binary trajectory
    [`regular_text.traj`, true, true], // .traj files are always binary
    // filename-only based .xyz/.extxyz detection always assumes structure, requires file content to look for frames and recognize as trajectory
    [`test.xyz`, false, false],
    [`test.extxyz`, false, false],
    [`test.cif`, false, false], // Not a trajectory file
  ])(
    `ASE trajectory file handling: "%s" → trajectory:%s, binary:%s`,
    async (filename, is_trajectory, is_binary) => {
      expect(is_trajectory_file(filename)).toBe(is_trajectory)
      if (is_trajectory) {
        const result = await read_file(`/test/${filename}`)
        expect(result.is_base64).toBe(is_binary)
      }
    },
  )

  // Integration test for ASE trajectory file processing (simulates the exact failing scenario)
  test(`ASE trajectory file end-to-end processing`, async () => {
    const ase_filename = `ase-LiMnO2-chgnet-relax.traj`

    // Step 1: Extension should detect this as a trajectory file
    expect(is_trajectory_file(ase_filename)).toBe(true)

    // Step 2: Extension should read this as binary (compressed)
    const file_result = await read_file(`/test/${ase_filename}`)
    expect(file_result.filename).toBe(ase_filename)
    expect(file_result.is_base64).toBe(true)
    expect(file_result.content).toBe(Buffer.from(`mock content`).toString(`base64`)) // base64 encoded binary data

    // Step 3: Verify webview data structure matches expected format
    const webview_data = {
      type: `trajectory` as const,
      data: file_result,
    }

    // Step 4: HTML generation should work with this data
    const webview_data_with_theme = { ...webview_data, theme: `light` as const }
    const html = create_html(
      mock_webview as Webview,
      mock_context as ExtensionContext,
      webview_data_with_theme,
    )

    expect(html).toContain(`<!DOCTYPE html>`)
    expect(html).toContain(JSON.stringify(webview_data_with_theme))

    // Step 5: Verify the exact data structure that would be sent to webview
    const parsed_data = JSON.parse(
      html.match(/mattervizData=(\{[\s\S]*?\})(?=\s*<\/script>)/)?.[1] ?? `{}`,
    )
    expect(parsed_data.type).toBe(`trajectory`)
    expect(parsed_data.data.filename).toBe(ase_filename)
    expect(parsed_data.data.is_base64).toBe(true)
    expect(parsed_data.data.content).toBe(Buffer.from(`mock content`).toString(`base64`))
    expect(parsed_data.theme).toBe(`light`)
  })

  test.each([
    [{ fsPath: `/test/file.cif` }, `file.cif`],
    [{ fsPath: `/test/structure.xyz` }, `structure.xyz`],
  ])(`get_file with URI`, async (uri, expected_filename) => {
    const result = await get_file(uri)
    expect(result.filename).toBe(expected_filename)
  })

  test(`get_file with active editor`, async () => {
    mock_vscode.window.activeTextEditor = {
      document: { fileName: `/test/active.cif`, getText: () => `active content` },
    } as TextEditor
    const result = await get_file()
    expect(result.filename).toBe(`active.cif`)
    expect(result.content).toBe(`active content`)
    expect(result.is_base64).toBe(false)
  })

  test(`get_file with active tab`, async () => {
    mock_vscode.window.tabGroups.activeTabGroup.activeTab = {
      input: { uri: { fsPath: `/test/tab.cif` } },
    } as unknown as Tab
    const result = await get_file()
    expect(result.filename).toBe(`tab.cif`)
  })

  test(`get_file throws when no file found`, async () => {
    mock_vscode.window.tabGroups.activeTabGroup.activeTab = null
    await expect(get_file()).rejects.toThrow(
      `No file selected. MatterViz needs an active editor to know what to render.`,
    )
  })

  test.each(
    [
      [`structure`, { filename: `test.cif`, content: `content`, is_base64: false }],
      [`trajectory`, { filename: `test.traj`, content: `YmluYXJ5`, is_base64: true }],
      [`structure`, {
        filename: `test"quotes.cif`,
        content: `content`,
        is_base64: false,
      }],
      [`structure`, { filename: `test.cif`, content: ``, is_base64: false }],
      [`structure`, {
        filename: `test.cif`,
        content: `<script>alert("xss")</script>`,
        is_base64: false,
      }],
      [`structure`, {
        filename: `large.cif`,
        content: `x`.repeat(100_000),
        is_base64: false,
      }],
    ] as const,
  )(`HTML generation: %s files`, (type, data) => {
    const webview_data = { type, data, theme: `light` } as const
    const html = create_html(mock_webview, mock_context, webview_data)
    expect(html).toContain(`<!DOCTYPE html>`)
    expect(html).toContain(`Content-Security-Policy`)
    expect(html).toContain(`default-src 'none'`)
    expect(html).toContain(`script-src 'nonce-`)
    expect(html).toMatch(/nonce="[a-zA-Z0-9]{8,32}"/)
    expect(html).toContain(JSON.stringify(webview_data))
    expect(html).toContain(`matterviz-app`)
  })

  test.each(
    [
      [{ command: `info`, text: `Test message` }, `showInformationMessage`],
      [{ command: `error`, text: `Error message` }, `showErrorMessage`],
      [
        { command: `info`, text: `"><script>alert(1)</script>` },
        `showInformationMessage`,
      ],
      [{ command: `error`, text: `javascript:alert(1)` }, `showErrorMessage`],
    ] as const,
  )(`message handling: %s`, async (message, expected_method) => {
    await handle_msg(message)
    expect(mock_vscode.window[expected_method as keyof typeof mock_vscode.window])
      .toHaveBeenCalledWith(message.text)
  })

  test.each([
    [
      { command: `saveAs`, content: `content`, filename: `test.cif` },
      true,
      `Saved: save.cif`,
    ],
    [
      {
        command: `saveAs`,
        content: `<script>alert("XSS")</script>`,
        filename: `test.cif`,
      },
      true,
      `Saved: save.cif`,
    ],
  ])(`saveAs success: %s`, async (message, should_succeed, expected_info) => {
    mock_vscode.window.showSaveDialog.mockResolvedValue({ fsPath: `/test/save.cif` })
    await handle_msg(message)
    if (should_succeed) {
      const enc = new TextEncoder()
      expect(mock_vscode.workspace.fs.writeFile).toHaveBeenCalledWith(
        { fsPath: `/test/save.cif` },
        enc.encode(message.content),
      )
      expect(mock_vscode.window.showInformationMessage).toHaveBeenCalledWith(
        expected_info,
      )
    }
  })

  test.each([
    [
      `PNG image`,
      `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==`,
      `structure.png`,
      true,
    ],
    [
      `JPEG image`,
      `data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AP/Z`,
      `plot.jpg`,
      true,
    ],
    [
      `PDF document`,
      `data:application/pdf;base64,JVBERi0xLjQKJcOkw7zDtsO8DQoxIDAgb2JqDQo8PA0KL1R5cGUgL0NhdGFsb2cNCi9QYWdlcyAyIDAgUg0KPj4NCmVuZG9iag0KMiAwIG9iag0KPDwNCi9UeXBlIC9QYWdlcw0KL0tpZHMgWzMgMCBSXQ0KL0NvdW50IDENCi9NZWRpYUJveCBbMCAwIDYxMiA3OTJdDQo+Pg0KZW5kb2JqDQozIDAgb2JqDQo8PA0KL1R5cGUgL1BhZ2UNCi9QYXJlbnQgMiAwIFINCi9SZXNvdXJjZXMgPDwNCi9Gb250IDw8DQovRjEgNCAwIFINCj4+DQo+Pg0KL0NvbnRlbnRzIDUgMCBSDQo+Pg0KZW5kb2JqDQo0IDAgb2JqDQo8PA0KL1R5cGUgL0ZvbnQNCi9TdWJ0eXBlIC9UeXBlMQ0KL0Jhc2VGb250IC9IZWx2ZXRpY2ENCi9FbmNvZGluZyAvV2luQW5zaUVuY29kaW5nDQo+Pg0KZW5kb2JqDQo1IDAgb2JqDQo8PA0KL0xlbmd0aCA0NA0KPj4NCnN0cmVhbQ0KQlQNCjEyIDAgVGQKL0YxIDEyIFRqDQooSGVsbG8gV29ybGQpIFRqDQpFVA0KZW5kc3RyZWFtDQplbmRvYmoNCnhyZWYNCjAgNg0KMDAwMDAwMDAwMCA2NTUzNSBmDQowMDAwMDAwMDEwIDAwMDAwIG4NCjAwMDAwMDAwNzkgMDAwMDAgbg0KMDAwMDAwMDE3MyAwMDAwMCBuDQowMDAwMDAwMzAxIDAwMDAwIG4NCjAwMDAwMDAzODAgMDAwMDAgbg0KdHJhaWxlcg0KPDwNCi9TaXplIDYNCi9Sb290IDEgMCBSDQo+Pg0Kc3RhcnR4cmVmDQo0OTINCiUlRU9G`,
      `report.pdf`,
      true,
    ],
  ])(`saveAs binary data: %s`, async (_description, data_url, filename, is_binary) => {
    mock_vscode.window.showSaveDialog.mockResolvedValue({ fsPath: `/test/${filename}` })
    await handle_msg({
      command: `saveAs`,
      content: data_url,
      ...msg_args,
      filename,
      is_binary,
    })
    const base64_data = data_url.replace(/^data:[^;]+;base64,/, ``)
    const expected_buffer = Uint8Array.from(Buffer.from(base64_data, `base64`))
    expect(mock_vscode.workspace.fs.writeFile).toHaveBeenCalledWith(
      { fsPath: `/test/${filename}` },
      expected_buffer,
    )
    expect(mock_vscode.window.showInformationMessage).toHaveBeenCalledWith(
      `Saved: ${filename}`,
    )
  })

  test(`saveAs error handling`, async () => {
    mock_vscode.window.showSaveDialog.mockResolvedValue({
      fsPath: `/test/save.cif`,
    })
    mock_vscode.workspace.fs.writeFile.mockRejectedValue(new Error(`Write failed`))

    await handle_msg({
      command: `saveAs`,
      content: `content`,
      ...msg_args,
      filename: `test.cif`,
    })
    expect(mock_vscode.window.showErrorMessage).toHaveBeenCalledWith(
      `Failed to save text file: Write failed`,
    )
  })

  test(`saveAs user cancellation`, async () => {
    mock_vscode.window.showSaveDialog.mockResolvedValue(undefined)

    await handle_msg({
      command: `saveAs`,
      content: `content`,
      ...msg_args,
      filename: `test.cif`,
    })
    expect(mock_vscode.workspace.fs.writeFile).not.toHaveBeenCalled()
  })

  test(`saveAs binary data validation: empty base64 data`, async () => {
    mock_vscode.window.showSaveDialog.mockResolvedValue({ fsPath: `/test/test.png` })

    await handle_msg({
      command: `saveAs`,
      content: `data:image/png;base64,`,
      ...msg_args,
      filename: `test.png`,
      is_binary: true,
    })

    expect(mock_vscode.window.showErrorMessage).toHaveBeenCalledWith(
      `Failed to save binary data: Invalid data URL: missing base64 data`,
    )
    expect(mock_vscode.workspace.fs.writeFile).not.toHaveBeenCalled()
  })

  test.each([
    [{ command: `info` }],
    [{ command: `saveAs` }],
    [{ command: `unknown` }],
  ])(`malformed message handling: %s`, async (msg) => {
    await expect(handle_msg({ ...msg, ...msg_args })).resolves.not.toThrow()
  })

  test(`render creates webview panel`, async () => {
    const mock_panel = {
      webview: { ...mock_webview },
      onDidDispose: vi.fn(),
    }
    mock_vscode.window.createWebviewPanel.mockReturnValue(mock_panel)
    mock_vscode.window.activeTextEditor = {
      document: { fileName: `/test/active.cif`, getText: () => `content` },
    } as TextEditor

    await render(mock_context)
    expect(mock_vscode.window.createWebviewPanel).toHaveBeenCalledWith(
      `matterviz`,
      `MatterViz - active.cif`,
      mock_vscode.ViewColumn.Beside,
      expect.any(Object),
    )
  })

  test(`render handles errors`, async () => {
    mock_vscode.window.activeTextEditor = null
    mock_vscode.window.tabGroups.activeTabGroup.activeTab = null
    await render(mock_context)
    expect(mock_vscode.window.showErrorMessage).toHaveBeenCalledWith(
      `Failed: No file selected. MatterViz needs an active editor to know what to render.`,
    )
  })

  test(`extension activation`, async () => {
    await activate(mock_context)
    expect(mock_vscode.commands.registerCommand).toHaveBeenCalledWith(
      `matterviz.render_structure`,
      expect.any(Function),
    )
    expect(mock_vscode.commands.registerCommand).toHaveBeenCalledWith(
      `matterviz.report_bug`,
      expect.any(Function),
    )
    expect(mock_vscode.window.registerCustomEditorProvider)
      .toHaveBeenCalledWith(`matterviz.viewer`, expect.any(Object), expect.any(Object))
  })

  describe(`Bug Reporting`, () => {
    let mock_opened_document: { content: string; language: string } | null = null
    let report_bug_command: (() => Promise<void>) | null = null
    let mock_env: {
      appName: string
      remoteName: string | undefined
      uiKind: number
      clipboard: {
        writeText: ReturnType<typeof vi.fn>
        readText: ReturnType<typeof vi.fn>
      }
      openExternal: ReturnType<typeof vi.fn>
    }

    beforeEach(async () => {
      // Reset state
      mock_opened_document = null
      report_bug_command = null

      // Mock clipboard API (must be set up before activation)
      mock_env = {
        appName: `Cursor`,
        remoteName: undefined,
        uiKind: 1, // Desktop
        clipboard: {
          writeText: vi.fn(() => Promise.resolve()),
          readText: vi.fn(() => Promise.resolve(``)),
        },
        openExternal: vi.fn(() => Promise.resolve(true)),
      }
      mock_vscode.env = mock_env

      // Capture the report_bug command during activation
      const command_registry = new Map<string, () => Promise<void>>()
      mock_vscode.commands.registerCommand = vi.fn(
        (command_name: string, callback: () => Promise<void>) => {
          command_registry.set(command_name, callback)
          return { dispose: vi.fn() }
        },
      )

      // Mock workspace.openTextDocument to capture the document content (BEFORE activation)
      mock_vscode.workspace.openTextDocument = vi.fn((options: {
        content: string
        language: string
      }) => {
        mock_opened_document = {
          content: options.content,
          language: options.language,
        }
        return Promise.resolve({
          uri: { fsPath: `/tmp/bug-report.md` },
          getText: () => options.content,
        })
      })

      // Mock window.showTextDocument (BEFORE activation)
      mock_vscode.window.showTextDocument = vi.fn(() => Promise.resolve())

      // Mock showInformationMessage to return action choices (BEFORE activation)
      mock_vscode.window.showInformationMessage = vi.fn(() => Promise.resolve(undefined))

      // Activate extension to register commands
      await activate(mock_context)

      // Get the report_bug command
      report_bug_command = command_registry.get(`matterviz.report_bug`) ?? null
    })

    test(`should generate bug report with environment information`, async () => {
      expect(report_bug_command).not.toBeNull()
      if (!report_bug_command) return

      await report_bug_command()

      expect(mock_opened_document).not.toBeNull()
      expect(mock_opened_document?.language).toBe(`markdown`)

      const content = mock_opened_document?.content ?? ``

      // Check for main sections
      expect(content).toContain(`### Environment`)
      expect(content).toContain(`### System Resources`)
      expect(content).toContain(`### Active Files & Extension State`)
      expect(content).toContain(`### Console Logs`)

      // Check environment details
      expect(content).toContain(`- **Editor**: Cursor`)
      expect(content).toContain(`- **MatterViz Version**: ${pkg_json.version}`)
      expect(content).toContain(`- **UI Kind**: Desktop`)
      expect(content).toContain(`- **Remote Session**: No (Local)`)

      // Check system resources
      expect(content).toContain(`- **Total Memory**:`)
      expect(content).toContain(`- **Free Memory**:`)
      expect(content).toContain(`- **Process RSS**:`)
      expect(content).toContain(`- **Process Heap Used**:`)
      expect(content).toContain(`- **Process Heap Total**:`)

      // Check console logs instructions
      expect(content).toContain(`**Please check for console errors/warnings:**`)
      expect(content).toContain(`Toggle Developer Tools`)

      // Check GitHub link
      expect(content).toContain(
        `https://github.com/janosh/matterviz/issues`,
      )

      // Check timestamp
      expect(content).toMatch(/\*\*Generated\*\*: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })

    test(`should detect remote session correctly`, async () => {
      // Mock remote session
      mock_env.remoteName = `ssh-remote`

      expect(report_bug_command).not.toBeNull()
      if (!report_bug_command) return

      await report_bug_command()

      const content = mock_opened_document?.content ?? ``
      expect(content).toContain(`- **Remote Session**: Yes (ssh-remote)`)
    })

    test(`should include active files in report`, async () => {
      // Start watching some files first
      const file1_path = `/test/structure.cif`
      const file2_path = `/test/trajectory.traj`

      await handle_msg({
        command: `startWatching`,
        file_path: file1_path,
        filename: `structure.cif`,
        request_id: `req1`,
        frame_index: 0,
      } as MessageData, mock_webview)

      await handle_msg({
        command: `startWatching`,
        file_path: file2_path,
        filename: `trajectory.traj`,
        request_id: `req2`,
        frame_index: 0,
      } as MessageData, mock_webview)

      expect(report_bug_command).not.toBeNull()
      if (!report_bug_command) return

      await report_bug_command()

      const content = mock_opened_document?.content ?? ``

      // Should list both files with bold filenames (not headers)
      expect(content).toContain(`**structure.cif**`)
      expect(content).toContain(`**trajectory.traj**`)
      expect(content).toContain(`- **Path**: \`${file1_path}\``)
      expect(content).toContain(`- **Path**: \`${file2_path}\``)
      expect(content).toContain(`- **Has Watcher**: true`)

      // Check for combined section and extension state counters
      expect(content).toContain(`### Active Files & Extension State`)
      expect(content).toContain(`- **Active Watchers**: 2`)
    })

    test(`should handle files with no active watchers`, async () => {
      expect(report_bug_command).not.toBeNull()
      if (!report_bug_command) return

      await report_bug_command()

      const content = mock_opened_document?.content ?? ``
      expect(content).toContain(`No files currently being watched/rendered.`)
    })

    test(`should copy to clipboard when user selects that option`, async () => {
      mock_vscode.window.showInformationMessage = vi.fn(() =>
        Promise.resolve(`Copy to Clipboard`)
      )

      expect(report_bug_command).not.toBeNull()
      if (!report_bug_command) return

      await report_bug_command()

      const content = mock_opened_document?.content ?? ``

      // Should have called clipboard.writeText with the content
      expect(mock_env.clipboard.writeText).toHaveBeenCalledWith(content)

      // Should show success message
      expect(mock_vscode.window.showInformationMessage).toHaveBeenCalledWith(
        `Debug information copied to clipboard!`,
      )
    })

    test(`should open GitHub issues when user selects that option`, async () => {
      mock_vscode.window.showInformationMessage = vi.fn(() =>
        Promise.resolve(`Open GitHub Issues`)
      )

      expect(report_bug_command).not.toBeNull()
      if (!report_bug_command) return

      await report_bug_command()

      // Should have opened GitHub issues URL
      expect(mock_env.openExternal).toHaveBeenCalledWith(
        expect.objectContaining({
          toString: expect.any(Function),
        }),
      )

      // Verify the URL contains the GitHub issues path
      const call_args = mock_env.openExternal.mock.calls[0]
      expect(call_args[0].toString()).toContain(
        `https://github.com/janosh/matterviz/issues/new`,
      )
    })

    test(`should format file sizes correctly`, async () => {
      // Mock different file sizes
      const test_cases = [
        { size: 500, expected: `500 B` },
        { size: 1024, expected: `1.00 KB` },
        { size: 1024 * 1024, expected: `1.00 MB` },
        { size: 1024 * 1024 * 1024, expected: `1.00 GB` },
      ]

      // Create a map to track sizes for each file
      const file_sizes = new Map<string, number>()

      // Set up persistent mock that uses the file_sizes map
      mock_vscode.workspace.fs.stat.mockImplementation((uri) => {
        const size = file_sizes.get(uri.fsPath) ?? 1000
        return Promise.resolve({ size, type: 1 })
      })

      // Add files to watchers with their sizes
      const watcher_promises = test_cases.map((test_case) => {
        const file_path = `/test/file_${test_case.size}.cif`
        file_sizes.set(file_path, test_case.size)

        return handle_msg({
          command: `startWatching`,
          file_path,
          filename: `file_${test_case.size}.cif`,
          request_id: `req_${test_case.size}`,
          frame_index: 0,
        } as MessageData, mock_webview)
      })

      await Promise.all(watcher_promises)

      expect(report_bug_command).not.toBeNull()
      if (!report_bug_command) return

      await report_bug_command()

      const content = mock_opened_document?.content ?? ``

      // Check that sizes are formatted correctly
      for (const test_case of test_cases) {
        if (test_case.size >= 1024) { // Only check KB and above (bytes might be rounded)
          expect(content).toContain(test_case.expected)
        }
      }
    })

    test(`should handle file stat errors gracefully`, async () => {
      // Mock file that exists but throws error on stat
      const file_path = `/test/error-file.cif`

      await handle_msg({
        command: `startWatching`,
        file_path,
        filename: `error-file.cif`,
        request_id: `req_error`,
        frame_index: 0,
      } as MessageData, mock_webview)

      // Mock stat to throw error for this specific file
      mock_vscode.workspace.fs.stat.mockRejectedValue(new Error(`File not found`))

      expect(report_bug_command).not.toBeNull()
      if (!report_bug_command) return

      await report_bug_command()

      const content = mock_opened_document?.content ?? ``

      // Should still include the file but with "Unknown" size
      expect(content).toContain(`**error-file.cif**`)
      expect(content).toContain(`- **Size**: Unknown`)
    })

    test(`should include extension state counters`, async () => {
      // Start watching multiple files
      await handle_msg({
        command: `startWatching`,
        file_path: `/test/file1.cif`,
        filename: `file1.cif`,
        request_id: `req1`,
        frame_index: 0,
      } as MessageData, mock_webview)

      await handle_msg({
        command: `startWatching`,
        file_path: `/test/file2.cif`,
        filename: `file2.cif`,
        request_id: `req2`,
        frame_index: 0,
      } as MessageData, mock_webview)

      expect(report_bug_command).not.toBeNull()
      if (!report_bug_command) return

      await report_bug_command()

      const content = mock_opened_document?.content ?? ``

      // Check combined Active Files & Extension State section
      expect(content).toContain(`### Active Files & Extension State`)
      expect(content).toContain(`- **Active Watchers**: 2`)
      expect(content).toMatch(/- \*\*Active Frame Loaders\*\*: \d+/)
      expect(content).toMatch(/- \*\*Auto-Render Timers\*\*: \d+/)
      expect(content).toMatch(/- \*\*Active Auto-Render Panels\*\*: \d+/)
    })

    test(`should handle errors during report generation`, async () => {
      // Mock openTextDocument to throw an error
      mock_vscode.workspace.openTextDocument = vi.fn(() =>
        Promise.reject(new Error(`Failed to create document`))
      )

      expect(report_bug_command).not.toBeNull()
      if (!report_bug_command) return

      await report_bug_command()

      // Should show error message
      expect(mock_vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining(`Failed to collect debug information`),
      )
    })

    test(`should include console logs instructions in bug report`, async () => {
      expect(report_bug_command).not.toBeNull()
      if (!report_bug_command) return

      await report_bug_command()

      const content = mock_opened_document?.content ?? ``

      // Check for console logs section with instructions
      expect(content).toContain(`### Console Logs`)
      expect(content).toContain(`**Please check for console errors/warnings:**`)
      expect(content).toContain(`Toggle Developer Tools`)
      expect(content).toContain(`Tip: You can filter console messages`)
    })
  })

  test(`performance benchmarks`, () => {
    // Trajectory detection performance
    const filenames = Array.from({ length: 10000 }, (_, idx) => `test_${idx}.xyz`)
    const start = performance.now()
    filenames.forEach(is_trajectory_file)
    expect(performance.now() - start).toBeLessThan(100)

    // HTML generation performance
    const large_data = {
      type: `structure`,
      data: { filename: `large.cif`, content: `x`.repeat(100_000), is_base64: false },
      theme: `light`,
    } as const
    const html_start = performance.now()
    create_html(mock_webview, mock_context, large_data)
    expect(performance.now() - html_start).toBeLessThan(50)
  })

  test(`nonce uniqueness`, () => {
    const data = {
      type: `structure`,
      data: { filename: `test.cif`, content: `content`, is_base64: false },
      theme: `light`,
    } as const
    const nonces = new Set<string>()

    for (let idx = 0; idx < 1000; idx++) {
      const html = create_html(mock_webview, mock_context, data)
      const nonce_match = html.match(/nonce="([a-zA-Z0-9]+)"/)
      if (nonce_match) nonces.add(nonce_match[1])
    }

    expect(nonces.size).toBe(1000)
  })

  test(`XSS prevention`, () => {
    const dangerous_payloads = [
      `<script>alert("XSS")</script>`,
      `<img src="x" onerror="alert(1)">`,
      `javascript:alert(1)`,
      `"><script>alert(1)</script>`,
      `';alert(1);//`,
    ]

    dangerous_payloads.forEach((payload) => {
      const data = {
        type: `structure`,
        data: { filename: `test.cif`, content: payload, is_base64: false },
        theme: `light`,
      } as const
      const html = create_html(mock_webview, mock_context, data)

      expect(html).toContain(JSON.stringify(data))
      if (payload.includes(`<script>`)) {
        expect(html).not.toMatch(
          new RegExp(
            `<script[^>]*>${payload.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`)}`,
          ),
        )
      }
    })
  })

  test(`concurrent operations`, async () => {
    const promises = Array.from(
      { length: 50 },
      (_, idx) => handle_msg({ command: `info`, text: `Message ${idx}`, ...msg_args }),
    )
    await Promise.all(promises)
    expect(mock_vscode.window.showInformationMessage).toHaveBeenCalledTimes(50)
  })

  describe(`Theme functionality`, () => {
    test.each(
      [
        [mock_vscode.ColorThemeKind.Light, `auto`, `light`], // Light VSCode theme, auto setting → light
        [mock_vscode.ColorThemeKind.Dark, `auto`, `dark`], // Dark VSCode theme, auto setting → dark
        [mock_vscode.ColorThemeKind.HighContrast, `auto`, `black`], // High contrast VSCode theme, auto setting → black
        [mock_vscode.ColorThemeKind.HighContrastLight, `auto`, `white`], // High contrast light VSCode theme, auto setting → white
        [mock_vscode.ColorThemeKind.Light, `light`, `light`], // Light VSCode theme, light setting → light
        [mock_vscode.ColorThemeKind.Light, `dark`, `dark`], // Light VSCode theme, dark setting → dark
        [mock_vscode.ColorThemeKind.Light, `white`, `white`], // Light VSCode theme, white setting → white
        [mock_vscode.ColorThemeKind.Light, `black`, `black`], // Light VSCode theme, black setting → black
        [mock_vscode.ColorThemeKind.Dark, `light`, `light`], // Dark VSCode theme, light setting → light
        [mock_vscode.ColorThemeKind.Dark, `dark`, `dark`], // Dark VSCode theme, dark setting → dark
        [mock_vscode.ColorThemeKind.Dark, `white`, `white`], // Dark VSCode theme, white setting → white
        [mock_vscode.ColorThemeKind.Dark, `black`, `black`], // Dark VSCode theme, black setting → black
      ] as const,
    )(
      `theme detection: VSCode theme %i, setting '%s' → '%s'`,
      (vscode_theme_kind: number, setting: string, expected: ThemeName) => {
        const mock_config = {
          get: vi.fn((key: string, default_value?: string) =>
            key === `theme` ? setting : default_value
          ),
        }
        mock_vscode.workspace.getConfiguration = vi.fn(() => mock_config) as ReturnType<
          typeof vi.fn
        >
        mock_vscode.window.activeColorTheme = { kind: vscode_theme_kind }

        const result = get_theme()
        expect(result).toBe(expected)
      },
    )

    test(`webview data includes theme`, () => {
      const mock_config = {
        get: vi.fn((key: string, default_value?: string) =>
          key === `theme` ? `dark` : default_value
        ),
      }
      mock_vscode.workspace.getConfiguration = vi.fn(() => mock_config) as ReturnType<
        typeof vi.fn
      >

      const data = {
        type: `structure` as const,
        data: { filename: `test.cif`, content: `content`, is_base64: false },
        theme: get_theme(),
      }

      const html = create_html(mock_webview, mock_context, data)

      const parsed_data = JSON.parse(
        html.match(/mattervizData=(.+?)</s)?.[1] || `{}`,
      )
      expect(parsed_data.theme).toBe(`dark`)
    })

    test(`invalid theme setting falls back to auto`, () => {
      const mock_config = {
        get: vi.fn((key: string, default_value?: string) =>
          key === `theme` ? `invalid-theme` : default_value
        ),
      }
      mock_vscode.workspace.getConfiguration = vi.fn(() => mock_config) as ReturnType<
        typeof vi.fn
      >
      mock_vscode.window.activeColorTheme = {
        kind: mock_vscode.ColorThemeKind.Light,
      }

      const result = get_theme()
      expect(result).toBe(`light`) // Should fall back to system theme
    })

    test(`high contrast themes are mapped correctly`, () => {
      const mock_config = {
        get: vi.fn((key: string, default_value?: string) =>
          key === `theme` ? `auto` : default_value
        ),
      }
      mock_vscode.workspace.getConfiguration = vi.fn(() => mock_config) as ReturnType<
        typeof vi.fn
      >

      // Test high contrast dark → black
      mock_vscode.window.activeColorTheme = {
        kind: mock_vscode.ColorThemeKind.HighContrast,
      }
      expect(get_theme()).toBe(`black`)

      // Test high contrast light → white
      mock_vscode.window.activeColorTheme = {
        kind: mock_vscode.ColorThemeKind.HighContrastLight,
      }
      expect(get_theme()).toBe(`white`)
    })
  })

  describe(`Theme listener cleanup`, () => {
    const setup_panel = (options = {}) => {
      const mock_dispose = vi.fn()
      const mock_panel = {
        webview: { ...mock_webview },
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
      mock_vscode.window.activeTextEditor = {
        document: { fileName: `/test/active.cif`, getText: () => `content` },
      } as TextEditor

      return { mock_dispose, mock_panel }
    }

    test(`sets up and cleans up theme listeners`, async () => {
      const { mock_dispose, mock_panel } = setup_panel()

      await render(mock_context)

      expect(mock_vscode.window.onDidChangeActiveColorTheme).toHaveBeenCalled()
      expect(mock_panel.onDidDispose).toHaveBeenCalled()

      // Test cleanup
      mock_panel.onDidDispose.mock.calls[0][0]()
      expect(mock_dispose).toHaveBeenCalledTimes(2)
    })

    test(`respects panel visibility for theme updates`, async () => {
      const mock_panel = {
        webview: { ...mock_webview },
        onDidDispose: vi.fn(),
        visible: false,
      }

      mock_vscode.window.createWebviewPanel.mockReturnValue(mock_panel)
      mock_vscode.window.onDidChangeActiveColorTheme.mockReturnValue({
        dispose: vi.fn(),
      })
      mock_vscode.workspace.onDidChangeConfiguration.mockReturnValue({
        dispose: vi.fn(),
      })
      mock_vscode.window.activeTextEditor = {
        document: { fileName: `/test/active.cif`, getText: () => `content` },
      } as TextEditor

      await render(mock_context)

      // Store initial HTML after render (render always sets HTML initially)
      const initial_html = mock_panel.webview.html

      const theme_callback = mock_vscode.window.onDidChangeActiveColorTheme.mock.calls[0]
        ?.[0] as unknown as () => void

      // Should not update when invisible
      if (theme_callback) {
        await theme_callback()
        expect(mock_panel.webview.html).toBe(initial_html)

        // Should update when visible
        mock_panel.visible = true
        await theme_callback()
        expect(mock_panel.webview.html).not.toBe(initial_html)
      }
    })

    test(`multiple panels dispose independently`, async () => {
      const dispose1 = vi.fn()
      const dispose2 = vi.fn()
      const panel1 = { webview: { ...mock_webview }, onDidDispose: vi.fn() }
      const panel2 = { webview: { ...mock_webview }, onDidDispose: vi.fn() }

      mock_vscode.window.createWebviewPanel
        .mockReturnValueOnce(panel1).mockReturnValueOnce(panel2)
      mock_vscode.window.onDidChangeActiveColorTheme
        .mockReturnValueOnce({ dispose: dispose1 }).mockReturnValueOnce({
          dispose: dispose2,
        })
      mock_vscode.workspace.onDidChangeConfiguration
        .mockReturnValueOnce({ dispose: dispose1 }).mockReturnValueOnce({
          dispose: dispose2,
        })

      mock_vscode.window.activeTextEditor = {
        document: { fileName: `/test/active.cif`, getText: () => `content` },
      } as TextEditor

      await render(mock_context)
      await render(mock_context)

      panel1.onDidDispose.mock.calls[0][0]()
      expect(dispose1).toHaveBeenCalledTimes(2)
      expect(dispose2).not.toHaveBeenCalled()
    })
  })

  describe(`File Watching`, () => {
    describe(`message handling`, () => {
      test(`should handle startWatching message`, async () => {
        const message = {
          command: `startWatching`,
          ...msg_args,
          file_path: `/test/file.cif`,
        }
        await handle_msg(message, mock_webview)

        expect(mock_vscode.workspace.createFileSystemWatcher).toHaveBeenCalledWith(
          expect.objectContaining({
            base: expect.anything(),
            pattern: `file.cif`,
          }),
        )
        expect(mock_file_system_watcher.onDidChange).toHaveBeenCalledWith(
          expect.any(Function),
        )
        expect(mock_file_system_watcher.onDidDelete).toHaveBeenCalledWith(
          expect.any(Function),
        )
      })

      test(`should handle stopWatching message`, async () => {
        // First start watching
        const start_message = {
          command: `startWatching`,
          ...msg_args,
          file_path: `/test/file.cif`,
        }
        await handle_msg(start_message, mock_webview)

        // Then test stopping
        const stop_message = {
          command: `stopWatching`,
          ...msg_args,
          file_path: `/test/file.cif`,
        }
        await handle_msg(stop_message, mock_webview)

        expect(mock_file_system_watcher.dispose).toHaveBeenCalled()
      })

      test(`should handle startWatching without webview gracefully`, async () => {
        const message = {
          command: `startWatching`,
          ...msg_args,
          file_path: `/test/file.cif`,
        }

        await expect(handle_msg(message)).resolves.not.toThrow()
        expect(mock_vscode.workspace.createFileSystemWatcher).not.toHaveBeenCalled()
      })

      test(`should handle startWatching without file_path gracefully`, async () => {
        const message = {
          command: `startWatching`,
          ...msg_args,
        }

        await expect(handle_msg(message, mock_webview)).resolves.not.toThrow()
        expect(mock_vscode.workspace.createFileSystemWatcher).not.toHaveBeenCalled()
      })

      test(`should send error message when file watching fails`, async () => {
        mock_vscode.workspace.createFileSystemWatcher.mockImplementation(() => {
          throw new Error(`File system watcher creation failed`)
        })

        const message = {
          command: `startWatching`,
          ...msg_args,
          file_path: `/test/large-file.cif`,
        }

        await handle_msg(message, mock_webview)

        expect(mock_webview.postMessage).toHaveBeenCalledWith({
          command: `error`,
          text: expect.stringContaining(`Failed to start watching file`),
        })
      })
    })

    describe(`file change notifications`, () => {
      test(`should send file change notification to webview`, async () => {
        const message = {
          command: `startWatching` as const,
          ...msg_args,
          file_path: `/test/file.cif`,
        }

        await handle_msg(message, mock_webview)

        // Get the change handler
        const change_handler = mock_file_system_watcher.onDidChange.mock.calls[0][0]

        // Trigger file change
        await change_handler()

        // Wait for postMessage to be called (it's async)
        await vi.waitFor(() => {
          expect(mock_webview.postMessage).toHaveBeenCalledWith({
            command: `fileUpdated`,
            data: expect.objectContaining({
              filename: `file.cif`,
              content: `mock content`,
              is_base64: false,
            }),
            type: `structure`,
            ...msg_args,
            file_path: `/test/file.cif`,
            theme: `light`,
          })
        })
      })

      test(`should handle file deletion notifications`, async () => {
        const message = {
          command: `startWatching` as const,
          ...msg_args,
          file_path: `/test/file.cif`,
        }

        await handle_msg(message, mock_webview)

        // Get the delete handler
        const delete_handler = mock_file_system_watcher.onDidDelete.mock.calls[0][0]

        // Trigger file deletion
        delete_handler()

        expect(mock_webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            command: `fileDeleted`,
            file_path: `/test/file.cif`,
          }),
        )
      })
    })

    describe(`lifecycle management`, () => {
      test(`should handle activation gracefully`, () => {
        const mock_context = {
          extensionUri: { fsPath: `/test/extension` },
          subscriptions: [],
        }

        expect(() => activate(mock_context)).not.toThrow()

        expect(mock_vscode.commands.registerCommand).toHaveBeenCalledWith(
          `matterviz.render_structure`,
          expect.any(Function),
        )
      })
    })
  })

  describe(`Auto-Render Functionality`, () => {
    test.each([
      // Supported structure files
      [`structure.cif`, true],
      [`molecule.xyz`, true],
      [`crystal.poscar`, true],
      [`data.json`, false], // "data" is too broad, will not auto-render without structure-specific keywords in filename
      [`structure.xml`, true],
      [`molecule.pdb`, true],
      [`compound.mol`, true],
      [`structure.mol2`, true],
      [`data.sdf`, true],
      [`crystal.mmcif`, true],
      // Supported trajectory files
      [`trajectory.traj`, true],
      [`simulation.h5`, true],
      [`data.hdf5`, false],
      [`traj.xtc`, true],
      // Compressed supported files
      [`trajectory.xyz.gz`, true],
      [`data.json.gz`, false], // "data" is too broad, will not auto-render without structure-specific keywords in filename
      [`structure.cif.gz`, true],
      // Special filenames
      [`POSCAR`, true],
      [`CONTCAR`, true],
      [`XDATCAR`, true],
      [`trajectory.dat`, true],
      [`md.xyz`, true],
      [`relax.out`, true],
      [`npt.log`, true],
      [`nvt.data`, true],
      [`nve.traj`, true],
      // Files with special characters
      [`structure (1).cif`, true],
      [`trajectory[test].xyz.gz`, true],
      [`crystal@test.poscar`, true],
      [`molecule#test.xyz`, true],
      [`structure$test.json`, true],
      [`trajectory%test.h5`, true],
      [`crystal^test.traj`, true],
      [`molecule&test.extxyz`, true],
      [`structure*test.xml`, true],
      [`trajectory+test.pdb`, true],
      [`crystal=test.mol`, true],
      [`molecule|test.mol2`, true],
      [`structure\`test.sdf`, true],
      [`trajectory~test.mmcif`, true],
      // Case sensitivity tests
      [`STRUCTURE.CIF`, true],
      [`structure.CIF`, true],
      [`Structure.cif`, true],
      [`TRAJECTORY.XYZ`, true],
      [`trajectory.XYZ`, true],
      [`Trajectory.xyz`, true],
      [`POSCAR`, true],
      [`poscar`, true],
      [`Poscar`, true],
      [`CONTCAR`, true],
      [`contcar`, true],
      [`Contcar`, true],
      [`XDATCAR`, true],
      [`xdatcar`, true],
      [`Xdatcar`, true],
      // Files that look like structure files but are supported
      [`structure_copy.cif`, true],
      [`trajectory_backup.xyz`, true],
      [`trajectory.log`, true], // Contains "trajectory" keyword
      // Very long filenames
      [`structure`.repeat(100) + `.cif`, true],
      // Unsupported files
      [`config.yaml`, false],
      [`simulation.trr`, false], // .trr files not supported
      [`md.dcd`, false], // .dcd files not supported
      [`document.txt`, false],
      [`script.py`, false],
      [`data.csv`, false],
      [`image.png`, false],
      [`archive.zip`, false],
      [`fake.gz`, false],
      [`config.ini`, false],
      [`log.txt`, false],
      [`README.md`, false],
      [`readme.md`, false],
      [`ReadMe.Md`, false],
      [`vite.config.ts`, false],
      [`test.spec.ts`, false],
      [`index.html`, false],
      [`style.css`, false],
      [`app.js`, false],
      [`data.sql`, false],
      [`backup.tar`, false],
      [`compressed.7z`, false],
      [`binary.bin`, false],
      [`.pre-commit-config.yaml`, false],
      [`changelog.md`, false],
      [`.prettierrc`, false],
      [`.gitignore`, false],
      [`dockerfile`, false],
      [`makefile`, false],
      [`.env`, false],
      [`.env.local`, false],
      [`.env.production`, false],
      [`.github/workflows/ci.yml`, false],
      [`dist/bundle.js`, false],
      [`build/index.html`, false],
      [`coverage/lcov.info`, false],
      [`.cache/build.js`, false],
      [`structure.json.bak`, false],
      [`crystal.poscar.lock`, true],
      [`simulation.log`, true],
      [`backup.old`, false],
      [`original.orig`, false],
      [`patch.diff`, false],
      [`structure.txt`, false],
      [`crystal.md`, false],
      [`molecule.doc`, false],
      [`poscar.bak`, true],
      [`contcar.old`, true],
      [`document.txt.gz`, false],
      [`script.py.gz`, false],
      [`data.csv.gz`, false],
      [`image.png.gz`, false],
      [`archive.zip.gz`, false],
      [`structure.cif.bak`, false],
      [`crystal.poscar.old`, true],
      [`molecule.xyz~`, false],
      [`structure.cif.swp`, false],
      [`DOCUMENT.TXT`, false],
      [`document.TXT`, false],
      [`Document.txt`, false],
      [`SCRIPT.PY`, false],
      [`script.PY`, false],
      [`Script.py`, false],
      [`DATA.CSV`, false],
      [`data.CSV`, false],
      [`Data.csv`, false],
      // Configuration files that should never auto-render
      [`package.json`, false],
      [`tsconfig.json`, false],
      [`vite.config.ts`, false],
      [`webpack.config.js`, false],
      [`rollup.config.js`, false],
      [`eslint.config.js`, false],
      [`prettier.config.js`, false],
      [`babel.config.js`, false],
      [`jest.config.js`, false],
      [`karma.conf.js`, false],
      [`cypress.json`, false],
      [`playwright.config.ts`, false],
      [`.eslintrc.json`, false],
      [`.prettierrc`, false],
      [`.babelrc`, false],
      [`.jest.config.js`, false],
      [`.karma.conf.js`, false],
      [`.cypress.json`, false],
      [`.playwright.config.ts`, false],
      [`.npmrc`, false],
      [`.yarnrc`, false],
      [`.vscode/settings.json`, false],
      [`.idea/workspace.xml`, false],
      [`.nyc_output/coverage.json`, false],
      [`.tmp/temp.json`, false],
      [`.temp/structure.json`, false],
      [`node_modules/package.json`, false],
      // Edge cases
      [``, false],
      [`   `, false],
      [`.`, false],
      [`..`, false],
      [`/`, false],
      [`\\`, false],
      [`a`.repeat(1000) + `.txt`, false],
      // Null/undefined inputs
      [null as unknown as string, false],
      [undefined as unknown as string, false],
    ])(`should detect auto-render for "%s" as %s`, (filename, expected) => {
      expect(should_auto_render(filename)).toBe(expected)
    })

    test(`should register auto-render functionality`, async () => {
      const mock_context = {
        subscriptions: { push: vi.fn() },
      } as unknown as ExtensionContext
      await activate(mock_context)
      expect(mock_vscode.workspace.onDidOpenTextDocument).toHaveBeenCalledWith(
        expect.any(Function),
      )
    })

    test(`should handle rapid file detection efficiently`, () => {
      const filenames = Array.from({ length: 100 }, (_, idx) => `test_${idx}.cif`)
      const start = performance.now()
      filenames.forEach(should_auto_render)
      expect(performance.now() - start).toBeLessThan(10)
    })

    test(`should not trigger on non-file URIs`, async () => {
      const mock_context = {
        subscriptions: { push: vi.fn() },
      } as unknown as ExtensionContext

      await activate(mock_context)

      // Get the registered callback
      const on_did_open_text_document_callback = mock_vscode.workspace
        .onDidOpenTextDocument
        // @ts-expect-error: Mock calls array typing is complex but runtime behavior is correct
        .mock.calls[0]?.[0]
      expect(on_did_open_text_document_callback).toBeDefined()

      // Mock document with non-file URI
      const mock_document = {
        uri: { scheme: `untitled` },
      }

      expect(() => on_did_open_text_document_callback?.(mock_document)).not.toThrow()
    })

    test(`should respect auto_render configuration setting`, async () => {
      const mock_context = {
        subscriptions: { push: vi.fn() },
      } as unknown as ExtensionContext

      // Mock configuration to disable auto_render
      mock_vscode.workspace.getConfiguration.mockReturnValue({
        get: vi.fn((key: string, default_val: string) => {
          if (key === `auto_render`) return false
          return default_val
        }),
      })

      await activate(mock_context)

      // Get the registered callback
      const on_did_open_text_document_callback = mock_vscode.workspace
        .onDidOpenTextDocument
        .mock.calls[0]?.[0]
      expect(on_did_open_text_document_callback).toBeDefined()

      // Mock document with supported file
      const mock_document = {
        uri: { scheme: `file`, fsPath: `/test/structure.cif` },
      }

      expect(() => on_did_open_text_document_callback?.(mock_document)).not.toThrow()
    })

    test(`should handle file reading errors gracefully during auto-render`, async () => {
      const mock_context = {
        subscriptions: { push: vi.fn() },
      } as unknown as ExtensionContext

      // Mock vscode.workspace.fs.stat to throw an error
      mock_vscode.workspace.fs.stat.mockRejectedValue(new Error(`File not found`))

      // Enable auto_render in config
      mock_vscode.workspace.getConfiguration.mockReturnValue({
        get: vi.fn((key: string) => key === `auto_render` ? true : undefined),
      })

      activate(mock_context)

      // Get the registered callback
      const on_did_open_text_document_callback = mock_vscode.workspace
        .onDidOpenTextDocument
        .mock.calls[0]?.[0]
      expect(on_did_open_text_document_callback).toBeDefined()

      // Mock document with supported file
      const mock_document = {
        uri: { scheme: `file`, fsPath: `/test/structure.cif` },
      }

      // Should show error message when file reading fails
      expect(() => on_did_open_text_document_callback?.(mock_document)).not.toThrow()

      await vi.waitFor(() => {
        expect(mock_vscode.window.showErrorMessage).toHaveBeenCalledWith(
          expect.stringContaining(`MatterViz auto-render failed:`),
        )
      })
    })
  })

  describe(`Multi-frame xyz/extxyz handling`, () => {
    test(`should correctly identify multi-frame XYZ as trajectory using content`, () => {
      // Multi-frame XYZ content (2 frames)
      const multi_frame_xyz_content = `3
frame 1
H 0.0 0.0 0.0
O 0.0 0.0 1.0
H 0.0 1.0 0.0
3
frame 2
H 0.1 0.0 0.0
O 0.0 0.1 1.0
H 0.0 1.0 0.1`

      // Single-frame XYZ content
      const single_frame_xyz_content = `3
water molecule
H 0.0 0.0 0.0
O 0.0 0.0 1.0
H 0.0 1.0 0.0`

      // Test 1: Verify is_trajectory_file directly detects multi-frame content
      expect(is_trajectory_file(`multi-frame.xyz`, multi_frame_xyz_content)).toBe(true)
      expect(is_trajectory_file(`single-frame.xyz`, single_frame_xyz_content)).toBe(false)

      // Test 2: Verify filename-only detection doesn't identify .xyz as trajectory
      expect(is_trajectory_file(`multi-frame.xyz`)).toBe(false) // filename-only should be false
      expect(is_trajectory_file(`single-frame.xyz`)).toBe(false) // filename-only should be false

      // Test 3: Test with FileData objects (simulating what infer_view_type receives)
      const multi_frame_file: FileData = {
        filename: `multi-frame.xyz`,
        content: multi_frame_xyz_content,
        is_base64: false,
      }

      const single_frame_file: FileData = {
        filename: `single-frame.xyz`,
        content: single_frame_xyz_content,
        is_base64: false,
      }

      const compressed_file: FileData = {
        filename: `trajectory.xyz.gz`,
        content: `base64encodedcontent`,
        is_base64: true,
      }

      // Test what infer_view_type logic would do:
      // For non-compressed files, pass content
      expect(is_trajectory_file(multi_frame_file.filename, multi_frame_file.content))
        .toBe(true)
      expect(is_trajectory_file(single_frame_file.filename, single_frame_file.content))
        .toBe(false)

      // For compressed files, don't pass content (falls back to filename-only)
      expect(is_trajectory_file(compressed_file.filename)).toBe(true) // .xyz.gz with trajectory keyword is detected as trajectory by filename

      // Test 4: Test webview creation scenario directly with content-based detection
      const multi_frame_html = create_html(mock_webview, mock_context, {
        type: is_trajectory_file(multi_frame_file.filename, multi_frame_file.content)
          ? `trajectory`
          : `structure`,
        data: multi_frame_file,
        theme: `light`,
      })

      const multi_frame_parsed_data = JSON.parse(
        multi_frame_html.match(/mattervizData=(\{[\s\S]*?\})(?=\s*<\/script>)/)?.[1] ??
          `{}`,
      )

      expect(multi_frame_parsed_data.type).toBe(`trajectory`)
      expect(multi_frame_parsed_data.data.filename).toBe(`multi-frame.xyz`)
      expect(multi_frame_parsed_data.data.content).toBe(multi_frame_xyz_content)

      // Test 5: Test single-frame for comparison
      const single_frame_html = create_html(mock_webview, mock_context, {
        type: is_trajectory_file(single_frame_file.filename, single_frame_file.content)
          ? `trajectory`
          : `structure`,
        data: single_frame_file,
        theme: `light`,
      })

      const single_frame_parsed_data = JSON.parse(
        single_frame_html.match(/mattervizData=(\{[\s\S]*?\})(?=\s*<\/script>)/)?.[1] ??
          `{}`,
      )

      expect(single_frame_parsed_data.type).toBe(`structure`)

      // Test 6: Test compressed file falls back correctly
      const compressed_html = create_html(mock_webview, mock_context, {
        type: is_trajectory_file(compressed_file.filename) ? `trajectory` : `structure`,
        data: compressed_file,
        theme: `light`,
      })

      const compressed_parsed_data = JSON.parse(
        compressed_html.match(/mattervizData=(\{[\s\S]*?\})(?=\s*<\/script>)/)?.[1] ??
          `{}`,
      )

      expect(compressed_parsed_data.type).toBe(`trajectory`) // Should be trajectory since filename contains trajectory keyword
    })

    test(`should handle compressed XYZ files by falling back to filename-only detection`, () => {
      // Test compressed file (should fall back to filename-only detection)
      const compressed_file = {
        filename: `trajectory.xyz.gz`,
        content: `base64encodedcontent`, // This is binary/compressed
        is_base64: true,
      }

      // For compressed files, infer_view_type should fall back to filename-only detection
      // Since .xyz.gz with trajectory keyword is detected as trajectory by filename, it should be 'trajectory'
      expect(is_trajectory_file(compressed_file.filename)).toBe(true) // filename-only detection

      // Test the HTML generation scenario
      const html = create_html(mock_webview, mock_context, {
        type: is_trajectory_file(compressed_file.filename) ? `trajectory` : `structure`,
        data: compressed_file,
        theme: `light`,
      })

      const parsed_data = JSON.parse(
        html.match(/mattervizData=(\{[\s\S]*?\})(?=\s*<\/script>)/)?.[1] ?? `{}`,
      )

      // Should be 'trajectory' since filename contains trajectory keyword
      expect(parsed_data.type).toBe(`trajectory`)
    })
  })

  describe(`Default Settings`, () => {
    // Helper to create mock config and test setting
    const test_setting = (
      result_path: string,
      expected_value: unknown,
      config_key: string,
    ) => {
      const parts = config_key.split(`.`)

      const mock_config = {
        get: vi.fn((key: string, default_val?: unknown): unknown => {
          if (parts.length === 2 && key === parts[0]) {
            return { [parts[1]]: expected_value }
          } else if (parts.length === 1 && key === parts[0]) return expected_value
          return default_val
        }),
      }
      // @ts-expect-error: Mock type override needed for testing
      mock_vscode.workspace.getConfiguration.mockReturnValue(mock_config)

      const result = get_defaults()
      const value = result_path.split(`.`).reduce(
        (obj: Record<string, unknown>, key: string) =>
          obj?.[key] as Record<string, unknown>,
        result,
      )

      return Array.isArray(expected_value)
        ? expect(value).toEqual(expected_value)
        : expect(value).toBe(expected_value)
    }

    test(`should merge user settings with defaults`, () => {
      const user_config = {
        structure: { atom_radius: 1.5, show_bonds: `always`, bond_color: `#ff0000` },
        trajectory: { auto_play: true },
      }
      const mock_config = {
        get: vi.fn((key: string, default_val?: unknown) => {
          if (key === `structure`) return user_config.structure
          if (key === `trajectory`) return user_config.trajectory
          return default_val
        }),
      }
      // @ts-expect-error: Mock type override needed for testing
      mock_vscode.workspace.getConfiguration.mockReturnValue(mock_config)

      const result = get_defaults()

      expect(result.structure.atom_radius).toBe(1.5)
      expect(result.structure.show_bonds).toBe(`always`)
      expect(result.structure.bond_color).toBe(`#ff0000`)
      expect(result.trajectory.auto_play).toBe(true)
      expect(result.structure.same_size_atoms).toBe(false) // Falls back to default
    })

    test.each([
      // Numbers
      [`structure.atom_radius`, 1.5],
      [`structure.sphere_segments`, 24],
      [`structure.bond_thickness`, 0.2],
      [`structure.rotation_damping`, 0.2],
      [`structure.zoom_speed`, 1.0],
      [`structure.pan_speed`, 1.0],
      [`structure.auto_rotate`, 2.0],
      [`structure.site_label_size`, 14],
      [`structure.site_label_padding`, 4],
      [`structure.ambient_light`, 0.6],
      [`structure.directional_light`, 0.8],
      [`structure.force_scale`, 2.0],
      [`structure.cell_edge_opacity`, 0.5],
      [`structure.cell_surface_opacity`, 0.2],
      [`background_opacity`, 0.8],
      [`trajectory.fps`, 10],
      [`trajectory.step_labels`, 10],

      // Booleans
      [`structure.same_size_atoms`, true],
      [`structure.show_atoms`, false],
      [`structure.show_bonds`, `always`],
      [`structure.show_site_labels`, true],
      [`structure.show_force_vectors`, true],
      [`structure.show_cell`, true],
      [`structure.show_cell_vectors`, true],
      [`structure.show_image_atoms`, true],
      [`structure.show_gizmo`, false],
      [`trajectory.auto_play`, true],
      [`trajectory.show_controls`, false],

      // Colors (strings)
      [`structure.bond_color`, `#ff0000`],
      [`structure.site_label_color`, `#00ff00`],
      [`structure.site_label_bg_color`, `#333333`],
      [`structure.cell_edge_color`, `#aaaaaa`],
      [`structure.cell_surface_color`, `#bbbbbb`],
      [`structure.force_color`, `#ffff00`],
      [`background_color`, `#111111`],

      // String enums
      [`structure.bonding_strategy`, `solid_angle`],
      [`structure.camera_projection`, `orthographic`],
      [`color_scheme`, `Jmol`],
      [`composition.color_scheme`, `Alloy`],
      [`trajectory.display_mode`, `scatter`],
      [`trajectory.layout`, `vertical`],
      [`composition.display_mode`, `bar`],

      // Arrays
      [`structure.camera_position`, [1, 2, 3]],
      [`structure.site_label_offset`, [0.5, 1.0, 0]],
      [`trajectory.fps_range`, [0.5, 60]],
    ])(`should handle setting: %s = %s`, (result_path, expected_value) => {
      test_setting(result_path, expected_value, result_path)
    })

    test.each([
      [{ get: vi.fn(() => undefined) }, `missing config`],
      [
        {
          get: vi.fn((key: string, default_val?: unknown) =>
            key === `defaults`
              ? {
                structure: {
                  atom_radius: `invalid`,
                  show_bonds: `invalid-value`,
                  bond_color: 123,
                },
              }
              : default_val
          ),
        },
        `invalid values`,
      ],
    ])(`should handle %s gracefully`, (mock_config, _description) => {
      // @ts-expect-error: Mock type override needed for testing
      mock_vscode.workspace.getConfiguration.mockReturnValue(mock_config)

      expect(() => get_defaults()).not.toThrow()
      const result = get_defaults()

      expect(result).toEqual(
        expect.objectContaining({
          structure: expect.any(Object),
          trajectory: expect.any(Object),
          composition: expect.any(Object),
        }),
      )
    })

    test(`should handle workspace config errors`, () => {
      mock_vscode.workspace.getConfiguration.mockImplementation(() => {
        throw new Error(`Config access failed`)
      })

      expect(() => get_defaults()).not.toThrow()
    })
  })
})
