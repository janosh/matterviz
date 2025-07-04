import * as fs from 'fs'
import * as path from 'path'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import * as vscode from 'vscode'
import {
  activate,
  create_html,
  get_file,
  handle_msg,
  is_trajectory_file,
  read_file,
  render,
} from '../src/extension'

// Mock modules
vi.mock(`fs`)
vi.mock(`vscode`, () => ({
  window: {
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showSaveDialog: vi.fn(),
    createWebviewPanel: vi.fn(),
    activeTextEditor: null,
    tabGroups: { activeTabGroup: { activeTab: null } },
    registerCustomEditorProvider: vi.fn(),
  },
  commands: { registerCommand: vi.fn() },
  Uri: {
    file: vi.fn((p: string) => ({ fsPath: p })),
    joinPath: vi.fn((_base: unknown, ...paths: string[]) => ({
      fsPath: path.join(`/`, ...paths),
    })),
  },
  ViewColumn: { Beside: 2 },
}))

const mock_vscode = vscode as unknown as {
  window: {
    showInformationMessage: ReturnType<typeof vi.fn>
    showErrorMessage: ReturnType<typeof vi.fn>
    showSaveDialog: ReturnType<typeof vi.fn>
    createWebviewPanel: ReturnType<typeof vi.fn>
    activeTextEditor: vscode.TextEditor | null
    tabGroups: {
      activeTabGroup: { activeTab: { input?: { uri?: vscode.Uri } } | null }
    }
    registerCustomEditorProvider: ReturnType<typeof vi.fn>
  }
  commands: { registerCommand: ReturnType<typeof vi.fn> }
}

describe(`MatterViz Extension`, () => {
  const mock_fs = fs as unknown as {
    readFileSync: ReturnType<typeof vi.fn>
    writeFileSync: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mock_fs.readFileSync = vi.fn().mockReturnValue(`mock content`)
    mock_fs.writeFileSync = vi.fn()
    mock_vscode.window.activeTextEditor = null
  })

  // Test data consolidation
  const mock_webview = {
    cspSource: `vscode-webview:`,
    asWebviewUri: vi.fn((uri: unknown) => uri),
  }
  const mock_context = { extensionUri: { fsPath: `/test` }, subscriptions: [] }

  // only checking filename recognition, files don't need to exist
  test.each([
    // Basic trajectory files
    [`test.traj`, true],
    [`test.xyz`, true],
    [`test.extxyz`, true],
    [`test.h5`, true],
    [`data.hdf5`, true],
    // VASP and special files
    [`XDATCAR`, true],
    [`trajectory.dat`, true],
    [`md.xyz.gz`, true],
    [`relax.extxyz`, true],
    // ASE ULM binary trajectory files (specific to this fix)
    [`md_npt_300K.traj`, true],
    [`ase-LiMnO2-chgnet-relax.traj`, true],
    [`simulation_nvt_250K.traj`, true],
    [`molecular_dynamics_nve.traj`, true],
    [`water_cluster_md.traj`, true],
    [`optimization_relax.traj`, true],
    // Case insensitive
    [`FILE.TRAJ`, true],
    [`TrAjEcToRy.XyZ`, true],
    [`trajectory`, true],
    [`.hidden.xyz`, true],
    // Unicode filenames
    [`مەركەزیtrajectory.traj`, true],
    [`日本語.xyz`, true],
    [`file🔥emoji.h5`, true],
    [`Мой_файл.extxyz`, true],
    // Non-trajectory files
    [`test.cif`, false],
    [`test.json`, false],
    [`random.txt`, false],
    [`test.xyz.backup`, false],
    // Edge cases
    [``, false],
    [`no.extension`, false],
    [`.`, false],
    [`file.xyz.`, false],
    // Very long filename
    [`${`a`.repeat(1000)}.xyz`, true],
  ])(`trajectory detection: "%s" → %s`, (filename, expected) => {
    expect(is_trajectory_file(filename)).toBe(expected)
  })

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
    const html = create_html(
      mock_webview as unknown as vscode.Webview,
      mock_context as unknown as vscode.ExtensionContext,
      webview_data,
    )

    expect(html).toContain(`<!DOCTYPE html>`)
    expect(html).toContain(JSON.stringify(webview_data))

    // Step 5: Verify the exact data structure that would be sent to webview
    const parsed_data = JSON.parse(
      html.match(/mattervizData=(.+?)</s)?.[1] || `{}`,
    )
    expect(parsed_data.type).toBe(`trajectory`)
    expect(parsed_data.data.filename).toBe(ase_filename)
    expect(parsed_data.data.isCompressed).toBe(true)
    expect(parsed_data.data.content).toBe(`mock content`)
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
    expect(() => get_file()).toThrow(`No file found`)
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
      webview: { html: ``, onDidReceiveMessage: vi.fn(), ...mock_webview },
    }
    mock_vscode.window.createWebviewPanel.mockReturnValue(mock_panel)
    mock_vscode.window.activeTextEditor = {
      document: { fileName: `/test/active.cif`, getText: () => `content` },
    } as vscode.TextEditor

    render(mock_context as vscode.ExtensionContext)
    expect(mock_vscode.window.createWebviewPanel).toHaveBeenCalledWith(
      `matterviz`,
      `MatterViz - active.cif`,
      vscode.ViewColumn.Beside,
      expect.any(Object),
    )
  })

  test(`render handles errors`, () => {
    mock_vscode.window.activeTextEditor = null
    mock_vscode.window.tabGroups.activeTabGroup.activeTab = null
    render(mock_context as vscode.ExtensionContext)
    expect(mock_vscode.window.showErrorMessage).toHaveBeenCalledWith(
      `Failed: No file found`,
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
})
