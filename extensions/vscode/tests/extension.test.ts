import type { ThemeName } from '$lib/theme/index'
import { is_trajectory_file } from '$lib/trajectory/parse'
import * as fs from 'fs'
import { Buffer } from 'node:buffer'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ExtensionContext, Tab, TextEditor, Webview } from 'vscode'
import type { MessageData } from '../src/extension'
import {
  activate,
  create_html,
  deactivate,
  get_defaults,
  get_file,
  get_theme,
  handle_msg,
  read_file,
  render,
  should_auto_render,
} from '../src/extension'

// Mock modules
vi.mock(`fs`)
vi.mock(`path`, () => ({
  basename: vi.fn((p: string) => p.split(`/`).pop() || ``),
  dirname: vi.fn((p: string) => p.split(`/`).slice(0, -1).join(`/`) || `/`),
}))

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
      get: vi.fn((_key: string, defaultValue: string) => defaultValue),
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
    fs: { stat: vi.fn() },
  },
  commands: { registerCommand: vi.fn(), executeCommand: vi.fn() },
  Uri: {
    file: vi.fn((p: string) => ({ fsPath: p })),
    joinPath: vi.fn((_base: unknown, ...paths: string[]) => ({
      fsPath: paths.join(`/`),
    })),
  },
  ViewColumn: { Beside: 2 },
  ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
  RelativePattern: vi.fn((base: unknown, pattern: string) => ({ base, pattern })),
}))

vi.mock(`vscode`, () => mock_vscode)

describe(`MatterViz Extension`, () => {
  const mock_fs = fs

  let mock_file_system_watcher: {
    onDidChange: ReturnType<typeof vi.fn>
    onDidDelete: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Reset active watchers by calling deactivate first
    try {
      deactivate()
    } catch {
      // Ignore errors if not activated
    }

    mock_fs.readFileSync = vi.fn().mockReturnValue(`mock content`)
    mock_fs.writeFileSync = vi.fn()
    mock_vscode.window.activeTextEditor = null

    // Set up file system watcher mock
    mock_file_system_watcher = {
      onDidChange: vi.fn(),
      onDidDelete: vi.fn(),
      dispose: vi.fn(),
    }
    mock_vscode.workspace.createFileSystemWatcher.mockReturnValue(
      mock_file_system_watcher,
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
    [`test.xyz`, false],
    [`test.json`, false],
    [``, false],
  ])(`file reading: "%s" → compressed:%s`, (filename, expected_compressed) => {
    const result = read_file(`/test/${filename}`)
    expect(result.filename).toBe(filename)
    expect(result.isCompressed).toBe(expected_compressed)
    if (expected_compressed) {
      expect(mock_fs.readFileSync).toHaveBeenCalledWith(`/test/${filename}`)
    } else {
      expect(mock_fs.readFileSync).toHaveBeenCalledWith(`/test/${filename}`, `utf8`)
    }
  })

  test.each([
    [`md_npt_300K.traj`, true, true], // ASE binary trajectory
    [`ase-LiMnO2-chgnet-relax.traj`, true, true], // ASE binary trajectory
    [`simulation_nvt_250K.traj`, true, true], // ASE binary trajectory
    [`water_cluster_md.traj`, true, true], // ASE binary trajectory
    [`optimization_relax.traj`, true, true], // ASE binary trajectory
    [`regular_text.traj`, true, true], // .traj files are always binary
    [`test.xyz`, false, false], // Text file without trajectory keywords
    [`test.extxyz`, false, false], // Text file without trajectory keywords
    [`test.cif`, false, false], // Not a trajectory file
  ])(
    `ASE trajectory file handling: "%s" → trajectory:%s, binary:%s`,
    (filename, is_trajectory, is_binary) => {
      expect(is_trajectory_file(filename)).toBe(is_trajectory)
      if (is_trajectory) {
        expect(read_file(`/test/${filename}`).isCompressed).toBe(
          is_binary,
        )
      }
    },
  )

  // Integration test for ASE trajectory file processing (simulates the exact failing scenario)
  test(`ASE trajectory file end-to-end processing`, () => {
    const ase_filename = `ase-LiMnO2-chgnet-relax.traj`

    // Step 1: Extension should detect this as a trajectory file
    expect(is_trajectory_file(ase_filename)).toBe(true)

    // Step 2: Extension should read this as binary (compressed)
    const file_result = read_file(`/test/${ase_filename}`)
    expect(file_result.filename).toBe(ase_filename)
    expect(file_result.isCompressed).toBe(true)
    expect(file_result.content).toBe(`mock content`) // base64 encoded binary data

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
      html.match(/mattervizData=(.+?)</s)?.[1] || `{}`,
    )
    expect(parsed_data.type).toBe(`trajectory`)
    expect(parsed_data.data.filename).toBe(ase_filename)
    expect(parsed_data.data.isCompressed).toBe(true)
    expect(parsed_data.data.content).toBe(`mock content`)
    expect(parsed_data.theme).toBe(`light`)
  })

  test.each([
    [{ fsPath: `/test/file.cif` }, `file.cif`],
    [{ fsPath: `/test/structure.xyz` }, `structure.xyz`],
  ])(`get_file with URI`, (uri, expected_filename) => {
    expect(get_file(uri).filename).toBe(expected_filename)
  })

  test(`get_file with active editor`, () => {
    mock_vscode.window.activeTextEditor = {
      document: { fileName: `/test/active.cif`, getText: () => `active content` },
    } as TextEditor
    const result = get_file()
    expect(result.filename).toBe(`active.cif`)
    expect(result.content).toBe(`active content`)
    expect(result.isCompressed).toBe(false)
  })

  test(`get_file with active tab`, () => {
    mock_vscode.window.tabGroups.activeTabGroup.activeTab = {
      input: { uri: { fsPath: `/test/tab.cif` } },
    } as unknown as Tab
    expect(get_file().filename).toBe(`tab.cif`)
  })

  test(`get_file throws when no file found`, () => {
    mock_vscode.window.tabGroups.activeTabGroup.activeTab = null
    expect(() => get_file()).toThrow(
      `No file selected. MatterViz needs an active editor to know what to render.`,
    )
  })

  test.each(
    [
      [`structure`, { filename: `test.cif`, content: `content`, isCompressed: false }],
      [`trajectory`, { filename: `test.traj`, content: `YmluYXJ5`, isCompressed: true }],
      [`structure`, {
        filename: `test"quotes.cif`,
        content: `content`,
        isCompressed: false,
      }],
      [`structure`, { filename: `test.cif`, content: ``, isCompressed: false }],
      [`structure`, {
        filename: `test.cif`,
        content: `<script>alert("xss")</script>`,
        isCompressed: false,
      }],
      [`structure`, {
        filename: `large.cif`,
        content: `x`.repeat(100_000),
        isCompressed: false,
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

  test.each([
    [{ command: `info`, text: `Test message` }, `showInformationMessage`],
    [{ command: `error`, text: `Error message` }, `showErrorMessage`],
    [{ command: `info`, text: `"><script>alert(1)</script>` }, `showInformationMessage`],
    [{ command: `error`, text: `javascript:alert(1)` }, `showErrorMessage`],
  ])(`message handling: %s`, async (message, expected_method) => {
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
      expect(mock_fs.writeFileSync).toHaveBeenCalledWith(
        `/test/save.cif`,
        message.content,
        `utf8`,
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
    await handle_msg({ command: `saveAs`, content: data_url, filename, is_binary })
    const base64_data = data_url.replace(/^data:[^;]+;base64,/, ``)
    const expected_buffer = Buffer.from(base64_data, `base64`)
    expect(mock_fs.writeFileSync).toHaveBeenCalledWith(
      `/test/${filename}`,
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
    ;(mock_fs.writeFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error(`Write failed`)
    })

    await handle_msg({
      command: `saveAs`,
      content: `content`,
      filename: `test.cif`,
    })
    expect(mock_vscode.window.showErrorMessage).toHaveBeenCalledWith(
      `Save failed: Write failed`,
    )
  })

  test(`saveAs user cancellation`, async () => {
    mock_vscode.window.showSaveDialog.mockResolvedValue(undefined)

    await handle_msg({
      command: `saveAs`,
      content: `content`,
      filename: `test.cif`,
    })
    expect(mock_fs.writeFileSync).not.toHaveBeenCalled()
  })

  test(`saveAs binary data validation: empty base64 data`, async () => {
    mock_vscode.window.showSaveDialog.mockResolvedValue({ fsPath: `/test/test.png` })

    await handle_msg({
      command: `saveAs`,
      content: `data:image/png;base64,`,
      filename: `test.png`,
      is_binary: true,
    })

    expect(mock_vscode.window.showErrorMessage).toHaveBeenCalledWith(
      `Failed to save binary data: Invalid data URL: missing base64 data`,
    )
    expect(mock_fs.writeFileSync).not.toHaveBeenCalled()
  })

  test.each([
    [{ command: `info` }],
    [{ command: `saveAs` }],
    [{ command: `unknown` }],
  ])(`malformed message handling: %s`, async (message) => {
    await expect(handle_msg(message as MessageData)).resolves.not.toThrow()
  })

  test(`render creates webview panel`, () => {
    const mock_panel = {
      webview: { ...mock_webview },
      onDidDispose: vi.fn(),
    }
    mock_vscode.window.createWebviewPanel.mockReturnValue(mock_panel)
    mock_vscode.window.activeTextEditor = {
      document: { fileName: `/test/active.cif`, getText: () => `content` },
    } as TextEditor

    render(mock_context)
    expect(mock_vscode.window.createWebviewPanel).toHaveBeenCalledWith(
      `matterviz`,
      `MatterViz - active.cif`,
      mock_vscode.ViewColumn.Beside,
      expect.any(Object),
    )
  })

  test(`render handles errors`, () => {
    mock_vscode.window.activeTextEditor = null
    mock_vscode.window.tabGroups.activeTabGroup.activeTab = null
    render(mock_context)
    expect(mock_vscode.window.showErrorMessage).toHaveBeenCalledWith(
      `Failed: No file selected. MatterViz needs an active editor to know what to render.`,
    )
  })

  test(`extension activation`, () => {
    activate(mock_context)
    expect(mock_vscode.commands.registerCommand).toHaveBeenCalledWith(
      `matterviz.renderStructure`,
      expect.any(Function),
    )
    expect(mock_vscode.window.registerCustomEditorProvider)
      .toHaveBeenCalledWith(`matterviz.viewer`, expect.any(Object), expect.any(Object))
  })

  test(`performance benchmarks`, () => {
    // Trajectory detection performance
    const filenames = Array.from(
      { length: 10000 },
      (_, idx) => `test_${idx}.xyz`,
    )
    const start = performance.now()
    filenames.forEach(is_trajectory_file)
    expect(performance.now() - start).toBeLessThan(100)

    // HTML generation performance
    const large_data = {
      type: `structure`,
      data: { filename: `large.cif`, content: `x`.repeat(100_000), isCompressed: false },
      theme: `light`,
    } as const
    const html_start = performance.now()
    create_html(mock_webview, mock_context, large_data)
    expect(performance.now() - html_start).toBeLessThan(50)
  })

  test(`nonce uniqueness`, () => {
    const data = {
      type: `structure`,
      data: { filename: `test.cif`, content: `content`, isCompressed: false },
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
        data: { filename: `test.cif`, content: payload, isCompressed: false },
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
      (_, idx) => handle_msg({ command: `info`, text: `Message ${idx}` }),
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
        data: { filename: `test.cif`, content: `content`, isCompressed: false },
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

    test(`sets up and cleans up theme listeners`, () => {
      const { mock_dispose, mock_panel } = setup_panel()

      render(mock_context)

      expect(mock_vscode.window.onDidChangeActiveColorTheme).toHaveBeenCalled()
      expect(mock_panel.onDidDispose).toHaveBeenCalled()

      // Test cleanup
      mock_panel.onDidDispose.mock.calls[0][0]()
      expect(mock_dispose).toHaveBeenCalledTimes(2)
    })

    test(`respects panel visibility for theme updates`, () => {
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

      render(mock_context)

      // Store initial HTML after render (render always sets HTML initially)
      const initial_html = mock_panel.webview.html

      const theme_callback = mock_vscode.window.onDidChangeActiveColorTheme.mock.calls[0]
        ?.[0]

      // Should not update when invisible
      if (theme_callback) {
        theme_callback()
        expect(mock_panel.webview.html).toBe(initial_html)

        // Should update when visible
        mock_panel.visible = true
        theme_callback()
        expect(mock_panel.webview.html).not.toBe(initial_html)
      }
    })

    test(`multiple panels dispose independently`, () => {
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

      render(mock_context)
      render(mock_context)

      panel1.onDidDispose.mock.calls[0][0]()
      expect(dispose1).toHaveBeenCalledTimes(2)
      expect(dispose2).not.toHaveBeenCalled()
    })
  })

  describe(`File Watching`, () => {
    describe(`message handling`, () => {
      test(`should handle startWatching message`, async () => {
        const message = { command: `startWatching`, file_path: `/test/file.cif` }
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
          file_path: `/test/file.cif`,
        }
        await handle_msg(start_message, mock_webview)

        // Then test stopping
        const stop_message = {
          command: `stopWatching`,
          file_path: `/test/file.cif`,
        }
        await handle_msg(stop_message, mock_webview)

        expect(mock_file_system_watcher.dispose).toHaveBeenCalled()
      })

      test(`should handle startWatching without webview gracefully`, async () => {
        const message = {
          command: `startWatching`,
          file_path: `/test/file.cif`,
        }

        await expect(handle_msg(message)).resolves.not.toThrow()
        expect(mock_vscode.workspace.createFileSystemWatcher).not.toHaveBeenCalled()
      })

      test(`should handle startWatching without file_path gracefully`, async () => {
        const message = {
          command: `startWatching`,
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
        const fs = await import(`fs`)
        vi.mocked(fs.readFileSync).mockReturnValue(`updated content`)

        const message = {
          command: `startWatching`,
          file_path: `/test/file.cif`,
        }

        await handle_msg(message, mock_webview)

        // Get the change handler
        const change_handler = mock_file_system_watcher.onDidChange.mock.calls[0][0]

        // Trigger file change
        change_handler()

        expect(mock_webview.postMessage).toHaveBeenCalledWith({
          command: `fileUpdated`,
          file_path: `/test/file.cif`,
          data: expect.objectContaining({
            filename: `file.cif`,
            content: `updated content`,
            isCompressed: false,
          }),
          type: `structure`,
          theme: expect.any(String),
        })
      })

      test(`should handle file deletion notifications`, async () => {
        const message = {
          command: `startWatching`,
          file_path: `/test/file.cif`,
        }

        await handle_msg(message, mock_webview)

        // Get the delete handler
        const delete_handler = mock_file_system_watcher.onDidDelete.mock.calls[0][0]

        // Trigger file deletion
        delete_handler()

        expect(mock_webview.postMessage).toHaveBeenCalledWith({
          command: `fileDeleted`,
          file_path: `/test/file.cif`,
        })
      })
    })

    describe(`lifecycle management`, () => {
      test(`should dispose all watchers on extension deactivation`, async () => {
        // Start watching a file
        const message = {
          command: `startWatching`,
          file_path: `/test/file.cif`,
        }
        await handle_msg(message, mock_webview)

        // Import deactivate function dynamically to test it
        const { deactivate } = await import(`../src/extension`)
        deactivate()

        expect(mock_file_system_watcher.dispose).toHaveBeenCalled()
      })

      test(`should handle activation gracefully`, () => {
        const mock_context = {
          extensionUri: { fsPath: `/test/extension` },
          subscriptions: [],
        }

        expect(() => activate(mock_context)).not.toThrow()

        expect(mock_vscode.commands.registerCommand).toHaveBeenCalledWith(
          `matterviz.renderStructure`,
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
      [`data.json`, true],
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
      [`data.json.gz`, true],
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

    test(`should register auto-render functionality`, () => {
      const mock_context = {
        subscriptions: { push: vi.fn() },
      } as unknown as ExtensionContext
      activate(mock_context)
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

    test(`should not trigger on non-file URIs`, () => {
      const mock_context = {
        subscriptions: { push: vi.fn() },
      } as unknown as ExtensionContext

      activate(mock_context)

      // Get the registered callback
      const onDidOpenTextDocument_callback = mock_vscode.workspace.onDidOpenTextDocument
        .mock.calls[0]?.[0]
      expect(onDidOpenTextDocument_callback).toBeDefined()

      // Mock document with non-file URI
      const mock_document = {
        uri: { scheme: `untitled` },
      }

      expect(() => onDidOpenTextDocument_callback(mock_document)).not.toThrow()
    })

    test(`should respect autoRender configuration setting`, () => {
      const mock_context = {
        subscriptions: { push: vi.fn() },
      } as unknown as ExtensionContext

      // Mock configuration to disable autoRender
      mock_vscode.workspace.getConfiguration.mockReturnValue({
        get: vi.fn((key: string, defaultValue: string) => {
          if (key === `autoRender`) return `false`
          return defaultValue
        }),
      })

      activate(mock_context)

      // Get the registered callback
      const onDidOpenTextDocument_callback = mock_vscode.workspace.onDidOpenTextDocument
        .mock.calls[0]?.[0]
      expect(onDidOpenTextDocument_callback).toBeDefined()

      // Mock document with supported file
      const mock_document = {
        uri: { scheme: `file`, fsPath: `/test/structure.cif` },
      }

      expect(() => onDidOpenTextDocument_callback(mock_document)).not.toThrow()
    })

    test(`should handle file reading errors gracefully during auto-render`, async () => {
      const mock_context = {
        subscriptions: { push: vi.fn() },
      } as unknown as ExtensionContext

      // Mock fs.readFileSync to throw an error
      vi.mocked(mock_fs.readFileSync).mockImplementation(() => {
        throw new Error(`File not found`)
      })

      activate(mock_context)

      // Get the registered callback
      const onDidOpenTextDocument_callback = mock_vscode.workspace.onDidOpenTextDocument
        .mock.calls[0]?.[0]
      expect(onDidOpenTextDocument_callback).toBeDefined()

      // Mock document with supported file
      const mock_document = {
        uri: { scheme: `file`, fsPath: `/test/structure.cif` },
      }

      // Should show error message when file reading fails
      expect(() => onDidOpenTextDocument_callback(mock_document)).not.toThrow()

      await vi.waitFor(() => { // Wait for error message to be called
        expect(mock_vscode.window.showErrorMessage).toHaveBeenCalledWith(
          expect.stringContaining(`MatterViz auto-render failed:`),
        )
      })
    })
  })

  describe(`Default Settings`, () => {
    describe(`get_defaults function`, () => {
      test(`should return merged defaults with user settings`, () => {
        const mock_config = {
          get: vi.fn((key: string) => {
            if (key === `defaults.structure.atom_radius`) return 1.5
            if (key === `defaults.structure.show_bonds`) return true
            if (key === `defaults.structure.bond_color`) return `#ff0000`
            if (key === `defaults.trajectory.auto_play`) return true
            return undefined
          }),
        }
        mock_vscode.workspace.getConfiguration.mockImplementation((section: string) => {
          if (section === `matterviz`) return mock_config
          return { get: vi.fn((_key: string, defaultValue?: unknown) => defaultValue) }
        })

        const result = get_defaults()

        expect(result.structure.atom_radius).toBe(1.5)
        expect(result.structure.show_bonds).toBe(true)
        expect(result.structure.bond_color).toBe(`#ff0000`)
        expect(result.trajectory.auto_play).toBe(true)
        // Should fall back to defaults for unset values
        expect(result.structure.same_size_atoms).toBe(false) // Default value
      })

      test(`should handle missing config values gracefully`, () => {
        const mock_config = {
          get: vi.fn(() => undefined),
        }
        mock_vscode.workspace.getConfiguration.mockImplementation((section: string) => {
          if (section === `matterviz`) return mock_config
          return { get: vi.fn((_key: string, defaultValue?: unknown) => defaultValue) }
        })

        const result = get_defaults()

        // Should return all default values
        expect(result.structure.atom_radius).toBe(1.0)
        expect(result.structure.show_bonds).toBe(false)
        expect(result.structure.bond_color).toBe(`#ffffff`)
        expect(result.structure.same_size_atoms).toBe(false)
        expect(result.trajectory.auto_play).toBe(false)
        expect(result.trajectory.fps).toBe(5)
      })
    })

    describe(`WebviewData with defaults`, () => {
      test(`should include defaults in webview data`, () => {
        const mock_config = {
          get: vi.fn((key: string) => {
            if (key === `defaults.structure.atom_radius`) return 1.2
            return undefined
          }),
        }
        mock_vscode.workspace.getConfiguration.mockImplementation((section: string) => {
          if (section === `matterviz`) return mock_config
          return { get: vi.fn((_key: string, defaultValue?: unknown) => defaultValue) }
        })

        const webview_data = {
          type: `structure` as const,
          data: { filename: `test.cif`, content: `content`, isCompressed: false },
          theme: `light` as const,
          defaults: {
            structure: {
              atom_radius: 1.2,
              show_bonds: false,
              bond_color: `#ffffff`,
              same_size_atoms: false,
            },
            trajectory: {
              auto_play: false,
              fps: 5,
            },
          },
        }

        const html = create_html(mock_webview, mock_context, webview_data)
        const parsed_data = JSON.parse(
          html.match(/mattervizData=(.+?)</s)?.[1] || `{}`,
        )

        expect(parsed_data.defaults).toBeDefined()
        expect(parsed_data.defaults.structure.atom_radius).toBe(1.2)
      })
    })

    describe(`Nested Settings`, () => {
      test.each([
        [`structure.atom_radius`, 1.5, `defaults.structure.atom_radius`],
        [`structure.sphere_segments`, 24, `defaults.structure.sphere_segments`],
        [`structure.bond_thickness`, 0.2, `defaults.structure.bond_thickness`],
        [`structure.rotation_damping`, 0.2, `defaults.structure.rotation_damping`],
        [`structure.zoom_speed`, 1.0, `defaults.structure.zoom_speed`],
        [`structure.pan_speed`, 1.0, `defaults.structure.pan_speed`],
        [`structure.auto_rotate`, 2.0, `defaults.structure.auto_rotate`],
        [`structure.site_label_size`, 14, `defaults.structure.site_label_size`],
        [`structure.site_label_padding`, 4, `defaults.structure.site_label_padding`],
        [`structure.ambient_light`, 0.6, `defaults.structure.ambient_light`],
        [`structure.directional_light`, 0.8, `defaults.structure.directional_light`],
        [`structure.force_scale`, 2.0, `defaults.structure.force_scale`],
        [
          `structure.lattice_edge_opacity`,
          0.5,
          `defaults.structure.lattice_edge_opacity`,
        ],
        [
          `structure.lattice_surface_opacity`,
          0.2,
          `defaults.structure.lattice_surface_opacity`,
        ],
        [`background_opacity`, 0.8, `defaults.background_opacity`],
        [`trajectory.fps`, 10, `defaults.trajectory.fps`],
      ])(
        `should handle number setting: %s = %s`,
        (result_path, expected_value, config_key) => {
          const mock_config = {
            get: vi.fn((key: string) => key === config_key ? expected_value : undefined),
          }
          mock_vscode.workspace.getConfiguration.mockReturnValue(mock_config)

          const result = get_defaults()

          // Navigate nested path like 'structure.atom_radius'
          const value = result_path.split(`.`).reduce(
            (obj: Record<string, unknown>, key: string) =>
              obj?.[key] as Record<string, unknown>,
            result,
          )
          expect(value).toBe(expected_value)
        },
      )

      test.each([
        [`structure.same_size_atoms`, true, `defaults.structure.same_size_atoms`],
        [`structure.show_atoms`, false, `defaults.structure.show_atoms`],
        [`structure.show_bonds`, true, `defaults.structure.show_bonds`],
        [`structure.show_site_labels`, true, `defaults.structure.show_site_labels`],
        [`structure.show_force_vectors`, true, `defaults.structure.show_force_vectors`],
        [`structure.show_lattice`, true, `defaults.structure.show_lattice`],
        [`structure.show_vectors`, true, `defaults.structure.show_vectors`],
        [`show_image_atoms`, true, `defaults.show_image_atoms`],
        [`show_gizmo`, false, `defaults.show_gizmo`],
        [`trajectory.auto_play`, true, `defaults.trajectory.auto_play`],
        [`trajectory.show_controls`, false, `defaults.trajectory.show_controls`],
        [
          `trajectory.show_fullscreen_button`,
          false,
          `defaults.trajectory.show_fullscreen_button`,
        ],
      ])(
        `should handle boolean setting: %s = %s`,
        (result_path, expected_value, config_key) => {
          const mock_config = {
            get: vi.fn((key: string) => key === config_key ? expected_value : undefined),
          }
          mock_vscode.workspace.getConfiguration.mockReturnValue(mock_config)

          const result = get_defaults()

          // Navigate nested path like 'structure.show_atoms'
          const value = result_path.split(`.`).reduce(
            (obj: Record<string, unknown>, key: string) =>
              obj?.[key] as Record<string, unknown>,
            result,
          )
          expect(value).toBe(expected_value)
        },
      )

      test.each([
        [`structure.bond_color`, `#ff0000`, `defaults.structure.bond_color`],
        [`structure.site_label_color`, `#00ff00`, `defaults.structure.site_label_color`],
        [
          `structure.site_label_bg_color`,
          `#333333`,
          `defaults.structure.site_label_bg_color`,
        ],
        [
          `structure.lattice_edge_color`,
          `#aaaaaa`,
          `defaults.structure.lattice_edge_color`,
        ],
        [
          `structure.lattice_surface_color`,
          `#bbbbbb`,
          `defaults.structure.lattice_surface_color`,
        ],
        [`structure.force_color`, `#ffff00`, `defaults.structure.force_color`],
        [`background_color`, `#111111`, `defaults.background_color`],
      ])(
        `should handle color setting: %s = %s`,
        (result_path, expected_value, config_key) => {
          const mock_config = {
            get: vi.fn((key: string) => key === config_key ? expected_value : undefined),
          }
          mock_vscode.workspace.getConfiguration.mockReturnValue(mock_config)

          const result = get_defaults()

          // Navigate nested path like 'structure.bond_color'
          const value = result_path.split(`.`).reduce(
            (obj: Record<string, unknown>, key: string) =>
              obj?.[key] as Record<string, unknown>,
            result,
          )
          expect(value).toBe(expected_value)
        },
      )

      test.each([
        [
          `structure.bonding_strategy`,
          `covalent_radius`,
          `defaults.structure.bonding_strategy`,
        ],
        [`structure.projection`, `orthographic`, `defaults.structure.projection`],
        [`color_scheme`, `Jmol`, `defaults.color_scheme`],
        [
          `composition.composition_color_scheme`,
          `Alloy`,
          `defaults.composition.composition_color_scheme`,
        ],
        [`trajectory.display_mode`, `scatter`, `defaults.trajectory.display_mode`],
        [`trajectory.layout`, `vertical`, `defaults.trajectory.layout`],
        [`composition.composition_mode`, `bar`, `defaults.composition.composition_mode`],
      ])(
        `should handle string enum setting: %s = %s`,
        (result_path, expected_value, config_key) => {
          const mock_config = {
            get: vi.fn((key: string) => key === config_key ? expected_value : undefined),
          }
          mock_vscode.workspace.getConfiguration.mockReturnValue(mock_config)

          const result = get_defaults()

          // Navigate nested path like 'structure.bonding_strategy'
          const value = result_path.split(`.`).reduce(
            (obj: Record<string, unknown>, key: string) =>
              obj?.[key] as Record<string, unknown>,
            result,
          )
          expect(value).toBe(expected_value)
        },
      )

      test.each([
        [`structure.camera_position`, [1, 2, 3], `defaults.structure.camera_position`],
        [
          `structure.site_label_offset`,
          [0.5, 1.0, 0],
          `defaults.structure.site_label_offset`,
        ],
        [`trajectory.fps_range`, [0.5, 60], `defaults.trajectory.fps_range`],
      ])(
        `should handle array setting: %s = %s`,
        (result_path, expected_value, config_key) => {
          const mock_config = {
            get: vi.fn((key: string) => key === config_key ? expected_value : undefined),
          }
          mock_vscode.workspace.getConfiguration.mockReturnValue(mock_config)

          const result = get_defaults()

          // Navigate nested path like 'structure.camera_position'
          const value = result_path.split(`.`).reduce(
            (obj: Record<string, unknown>, key: string) =>
              obj?.[key] as Record<string, unknown>,
            result,
          )
          expect(value).toEqual(expected_value)
        },
      )

      test(`should handle step_labels integer setting`, () => {
        const mock_config = {
          get: vi.fn((key: string) =>
            key === `defaults.trajectory.step_labels` ? 10 : undefined
          ),
        }
        mock_vscode.workspace.getConfiguration.mockReturnValue(mock_config)

        const result = get_defaults()

        expect(result.trajectory.step_labels).toBe(10)
      })
    })

    describe(`Edge cases and validation`, () => {
      test(`should handle invalid config values gracefully`, () => {
        const mock_config = {
          get: vi.fn((key: string) => {
            // Return invalid values for some settings
            if (key === `defaults.structure.atom_radius`) return `invalid`
            else if (key === `defaults.structure.show_bonds`) return `not-a-boolean`
            else if (key === `defaults.structure.bond_color`) return 12345
            else return undefined
          }),
        }
        mock_vscode.workspace.getConfiguration.mockReturnValue(mock_config)

        expect(() => get_defaults()).not.toThrow()
        const result = get_defaults()

        // Should include the invalid values as-is (merge doesn't validate)
        expect(result.structure.atom_radius).toBe(`invalid`)
        expect(result.structure.show_bonds).toBe(`not-a-boolean`)
        expect(result.structure.bond_color).toBe(12345)
      })

      test(`should handle empty config gracefully`, () => {
        const mock_config = {
          get: vi.fn(() => undefined),
        }
        mock_vscode.workspace.getConfiguration.mockReturnValue(mock_config)

        const result = get_defaults()

        // Should return default values with nested structure
        expect(typeof result).toBe(`object`)
        expect(result).toHaveProperty(`structure`)
        expect(result).toHaveProperty(`trajectory`)
        expect(result).toHaveProperty(`composition`)
        expect(result.structure).toHaveProperty(`atom_radius`)
        expect(result.structure).toHaveProperty(`show_bonds`)
        expect(result.structure).toHaveProperty(`bond_color`)
      })

      test(`should handle workspace config errors gracefully`, () => {
        mock_vscode.workspace.getConfiguration.mockImplementation(() => {
          throw new Error(`Config access failed`)
        })

        expect(() => get_defaults()).toThrow(`Config access failed`)
      })
    })
  })
})
