import * as fs from 'fs'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ExtensionContext, Webview } from 'vscode'

import type { ThemeName } from '$lib/theme/index'
import { is_trajectory_file } from '$lib/trajectory/parse'
import {
  activate,
  create_html,
  get_file,
  get_theme,
  handle_msg,
  read_file,
  render,
} from '../src/extension'

// Mock modules
vi.mock(`fs`)
vi.mock(`path`, () => ({
  basename: vi.fn((p: string) => p.split(`/`).pop() || ``),
  dirname: vi.fn((p: string) => p.split(`/`).slice(0, -1).join(`/`) || `/`),
  resolve: vi.fn((p: string) => p),
  extname: vi.fn((p: string) => {
    const parts = p.split(`.`)
    return parts.length > 1 ? `.` + parts.pop() : ``
  }),
  join: vi.fn((...paths: string[]) => paths.join(`/`)),
}))

const mock_vscode = vi.hoisted(() => ({
  window: {
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showSaveDialog: vi.fn(),
    createWebviewPanel: vi.fn(),
    activeTextEditor: null,
    tabGroups: { activeTabGroup: { activeTab: null } },
    registerCustomEditorProvider: vi.fn(),
    activeColorTheme: { kind: 1 }, // Light theme by default
    onDidChangeActiveColorTheme: vi.fn(() => ({ dispose: vi.fn() })),
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((_key: string, defaultValue: string) => defaultValue),
    })),
    onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
    createFileSystemWatcher: vi.fn(() => ({
      onDidChange: vi.fn(),
      onDidDelete: vi.fn(),
      dispose: vi.fn(),
    })),
  },
  commands: { registerCommand: vi.fn() },
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
  const mock_fs = fs as unknown as {
    readFileSync: ReturnType<typeof vi.fn>
    writeFileSync: ReturnType<typeof vi.fn>
  }

  let mock_file_system_watcher: {
    onDidChange: ReturnType<typeof vi.fn>
    onDidDelete: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.clearAllMocks()

    // Reset active watchers by calling deactivate first
    try {
      const { deactivate } = await import(`../src/extension`)
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
    asWebviewUri: vi.fn((uri: unknown) =>
      `https://vscode-webview.local${(uri as { fsPath: string }).fsPath}`
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
    const file_path = `/test/${filename}`
    const result = read_file(file_path)

    expect(result.filename).toBe(filename)
    expect(result.isCompressed).toBe(expected_compressed)
    if (expected_compressed) {
      expect(mock_fs.readFileSync).toHaveBeenCalledWith(file_path)
    } else {
      expect(mock_fs.readFileSync).toHaveBeenCalledWith(file_path, `utf8`)
    }
  })

  test.each([
    [`md_npt_300K.traj`, true, true], // ASE binary trajectory
    [`ase-LiMnO2-chgnet-relax.traj`, true, true], // ASE binary trajectory
    [`simulation_nvt_250K.traj`, true, true], // ASE binary trajectory
    [`water_cluster_md.traj`, true, true], // ASE binary trajectory
    [`optimization_relax.traj`, true, true], // ASE binary trajectory
    [`regular_text.traj`, true, true], // .traj files are always binary
    [`test.xyz`, true, false], // Text trajectory file
    [`test.extxyz`, true, false], // Text trajectory file
    [`test.cif`, false, false], // Not a trajectory file
  ])(
    `ASE trajectory file handling: "%s" → trajectory:%s, binary:%s`,
    (filename, is_trajectory, is_binary) => {
      expect(is_trajectory_file(filename)).toBe(is_trajectory)

      if (is_trajectory) {
        const result = read_file(`/test/${filename}`)
        expect(result.isCompressed).toBe(is_binary)
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
    const result = get_file(uri as vscode.Uri)
    expect(result.filename).toBe(expected_filename)
  })

  test(`get_file with active editor`, () => {
    mock_vscode.window.activeTextEditor = {
      document: {
        fileName: `/test/active.cif`,
        getText: () => `active content`,
      },
    } as vscode.TextEditor

    const result = get_file()
    expect(result.filename).toBe(`active.cif`)
    expect(result.content).toBe(`active content`)
    expect(result.isCompressed).toBe(false)
  })

  test(`get_file with active tab`, () => {
    mock_vscode.window.tabGroups.activeTabGroup.activeTab = {
      input: { uri: { fsPath: `/test/tab.cif` } as vscode.Uri },
    }

    const result = get_file()
    expect(result.filename).toBe(`tab.cif`)
  })

  test(`get_file throws when no file found`, () => {
    mock_vscode.window.tabGroups.activeTabGroup.activeTab = null
    expect(() => get_file()).toThrow(
      `No file selected. MatterViz needs an active editor to know what to render.`,
    )
  })

  test.each([
    [`structure`, {
      filename: `test.cif`,
      content: `content`,
      isCompressed: false,
    }],
    [`trajectory`, {
      filename: `test.traj`,
      content: `YmluYXJ5`,
      isCompressed: true,
    }],
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
      content: `x`.repeat(100000),
      isCompressed: false,
    }],
  ])(`HTML generation: %s files`, (type, data) => {
    const webview_data = { type: type as `structure` | `trajectory`, data }
    const html = create_html(
      mock_webview as vscode.Webview,
      mock_context as vscode.ExtensionContext,
      webview_data,
    )

    expect(html).toContain(`<!DOCTYPE html>`)
    expect(html).toContain(`Content-Security-Policy`)
    expect(html).toContain(`default-src 'none'`)
    expect(html).toContain(`script-src 'nonce-`)
    expect(html).toMatch(/nonce="[a-zA-Z0-9]{8,32}"/)
    expect(html).toContain(JSON.stringify(webview_data))
    expect(html).toContain(`matterviz-app`) // App container exists
  })

  test.each([
    [{ command: `info`, text: `Test message` }, `showInformationMessage`],
    [{ command: `error`, text: `Error message` }, `showErrorMessage`],
    [
      { command: `info`, text: `"><script>alert(1)</script>` },
      `showInformationMessage`,
    ],
    [{ command: `error`, text: `javascript:alert(1)` }, `showErrorMessage`],
  ])(`message handling: %s`, async (message, expected_method) => {
    await handle_msg(message)
    expect(
      mock_vscode.window[expected_method as keyof typeof mock_vscode.window],
    )
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
    mock_vscode.window.showSaveDialog.mockResolvedValue({
      fsPath: `/test/save.cif`,
    })

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

  test(`saveAs error handling`, async () => {
    mock_vscode.window.showSaveDialog.mockResolvedValue({
      fsPath: `/test/save.cif`,
    })
    mock_fs.writeFileSync.mockImplementation(() => {
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

  test.each([
    [{ command: `info` }],
    [{ command: `saveAs` }],
    [{ text: `no command` }],
    [{}],
    [{ command: null }],
    [{ command: 123 }],
  ])(`malformed message handling: %s`, async (message) => {
    await expect(handle_msg(message)).resolves.not.toThrow()
  })

  test(`render creates webview panel`, () => {
    const mock_panel = {
      webview: { ...mock_webview },
      onDidDispose: vi.fn(),
    }
    mock_vscode.window.createWebviewPanel.mockReturnValue(mock_panel)
    mock_vscode.window.activeTextEditor = {
      document: { fileName: `/test/active.cif`, getText: () => `content` },
    } as vscode.TextEditor

    render(mock_context as vscode.ExtensionContext)
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
    render(mock_context as vscode.ExtensionContext)
    expect(mock_vscode.window.showErrorMessage).toHaveBeenCalledWith(
      `Failed: No file selected. MatterViz needs an active editor to know what to render.`,
    )
  })

  test(`extension activation`, () => {
    activate(mock_context as vscode.ExtensionContext)
    expect(mock_vscode.commands.registerCommand).toHaveBeenCalledWith(
      `matterviz.renderStructure`,
      expect.any(Function),
    )
    expect(mock_vscode.window.registerCustomEditorProvider)
      .toHaveBeenCalledWith(
        `matterviz.viewer`,
        expect.any(Object),
        expect.any(Object),
      )
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
      type: `structure` as const,
      data: {
        filename: `large.cif`,
        content: `x`.repeat(100000),
        isCompressed: false,
      },
    }
    const html_start = performance.now()
    create_html(
      mock_webview as vscode.Webview,
      mock_context as vscode.ExtensionContext,
      large_data,
    )
    expect(performance.now() - html_start).toBeLessThan(50)
  })

  test(`nonce uniqueness`, () => {
    const data = {
      type: `structure` as const,
      data: { filename: `test.cif`, content: `content`, isCompressed: false },
    }
    const nonces = new Set<string>()

    for (let idx = 0; idx < 1000; idx++) {
      const html = create_html(
        mock_webview as vscode.Webview,
        mock_context as vscode.ExtensionContext,
        data,
      )
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
        type: `structure` as const,
        data: { filename: `test.cif`, content: payload, isCompressed: false },
      }
      const html = create_html(
        mock_webview as vscode.Webview,
        mock_context as vscode.ExtensionContext,
        data,
      )

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

  // Theme functionality tests
  describe(`Theme functionality`, () => {
    test.each([
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
    ])(
      `theme detection: VSCode theme %i, setting '%s' → '%s'`,
      (vscode_theme_kind: number, setting: string, expected: ThemeName) => {
        const mock_config = {
          get: vi.fn((key: string, default_value?: string) =>
            key === `theme` ? setting : default_value
          ),
        }
        mock_vscode.workspace.getConfiguration = vi.fn(() => mock_config)
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
      mock_vscode.workspace.getConfiguration = vi.fn(() => mock_config)

      const data = {
        type: `structure` as const,
        data: { filename: `test.cif`, content: `content`, isCompressed: false },
        theme: get_theme(),
      }

      const html = create_html(
        mock_webview as vscode.Webview,
        mock_context as vscode.ExtensionContext,
        data,
      )

      const parsed_data = JSON.parse(
        html.match(/mattervizData=(.+?)</s)?.[1] || `{}`,
      )
      expect(parsed_data.theme).toBe(`dark`)
    })

    test(`HTML includes themes.js script`, () => {
      const data = {
        type: `structure` as const,
        data: { filename: `test.cif`, content: `content`, isCompressed: false },
        theme: `light` as const,
      }

      const html = create_html(
        mock_webview as vscode.Webview,
        mock_context as vscode.ExtensionContext,
        data,
      )

      expect(html).toContain(`themes.js`)
      expect(html).toMatch(/<script[^>]*src="[^"]*themes\.js"[^>]*>/)
    })

    test(`invalid theme setting falls back to auto`, () => {
      const mock_config = {
        get: vi.fn((key: string, default_value?: string) =>
          key === `theme` ? `invalid-theme` : default_value
        ),
      }
      mock_vscode.workspace.getConfiguration = vi.fn(() => mock_config)
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
      mock_vscode.workspace.getConfiguration = vi.fn(() => mock_config)

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
        webview: {
          html: `initial`,
          onDidReceiveMessage: vi.fn(),
          ...mock_webview,
        },
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
      } as vscode.TextEditor

      return { mock_dispose, mock_panel }
    }

    test(`sets up and cleans up theme listeners`, () => {
      const { mock_dispose, mock_panel } = setup_panel()

      render(mock_context as vscode.ExtensionContext)

      expect(mock_vscode.window.onDidChangeActiveColorTheme).toHaveBeenCalled()
      expect(mock_panel.onDidDispose).toHaveBeenCalled()

      // Test cleanup
      mock_panel.onDidDispose.mock.calls[0][0]()
      expect(mock_dispose).toHaveBeenCalledTimes(2)
    })

    test(`respects panel visibility for theme updates`, () => {
      const mock_panel = {
        webview: {
          html: ``,
          onDidReceiveMessage: vi.fn(),
          ...mock_webview,
        },
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
      } as vscode.TextEditor

      render(mock_context as vscode.ExtensionContext)

      // Store initial HTML after render (render always sets HTML initially)
      const initial_html = mock_panel.webview.html

      const theme_callback =
        mock_vscode.window.onDidChangeActiveColorTheme.mock.calls[0][0]

      // Should not update when invisible
      theme_callback()
      expect(mock_panel.webview.html).toBe(initial_html)

      // Should update when visible
      mock_panel.visible = true
      theme_callback()
      expect(mock_panel.webview.html).not.toBe(initial_html)
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
      } as vscode.TextEditor

      render(mock_context as vscode.ExtensionContext)
      render(mock_context as vscode.ExtensionContext)

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
})
