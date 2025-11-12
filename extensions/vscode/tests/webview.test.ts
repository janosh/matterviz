import { describe, expect, test, vi } from 'vitest'
import { base64_to_array_buffer, setup_vscode_download } from '../src/webview/main'

declare global { // download function added by VSCode integration
  var download: (content: string | Blob, filename: string, contentType: string) => void
}

describe(`Webview Integration - ASE Binary Trajectory Support`, () => {
  test.each([
    [`SGVsbG8gV29ybGQ=`, `Hello World`, 11], // Basic ASCII
    [`QUJDREVGR0g=`, `ABCDEFGH`, 8], // Another ASCII
    [``, ``, 0], // Empty string
    [`QQ==`, `A`, 1], // Single character
    [`QUI=`, `AB`, 2], // Two characters
  ])(
    `base64_to_array_buffer: %s → %s (%i bytes)`,
    (base64, expected, byte_length) => {
      const result = base64_to_array_buffer(base64)
      expect(result).toBeInstanceOf(ArrayBuffer)
      expect(result.byteLength).toBe(byte_length)
      expect(new TextDecoder().decode(result)).toBe(expected)
    },
  )

  test(`handles ASE trajectory file header correctly`, () => {
    const ase_header = new Uint8Array([
      0x2d,
      0x20,
      0x6f,
      0x66,
      0x20,
      0x55,
      0x6c,
      0x6d,
      0x41,
      0x53,
      0x45,
      0x2d,
      0x54,
      0x72,
      0x61,
      0x6a,
    ])
    const result = base64_to_array_buffer(btoa(String.fromCharCode(...ase_header)))
    expect(result.byteLength).toBe(ase_header.length)
    expect(new TextDecoder().decode(result.slice(0, 8))).toBe(`- of Ulm`)
  })

  test(`preserves byte order and handles performance`, () => {
    const test_bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0xFF, 0xFE, 0xFD, 0xFC])
    const result = base64_to_array_buffer(btoa(String.fromCharCode(...test_bytes)))
    expect(Array.from(new Uint8Array(result))).toEqual(Array.from(test_bytes))

    const large_data = new Uint8Array(10000).fill(42)
    const start = performance.now()
    const large_result = base64_to_array_buffer(btoa(String.fromCharCode(...large_data)))
    expect(performance.now() - start).toBeLessThan(100)
    expect(large_result.byteLength).toBe(large_data.length)
  })

  test.each([1024, 8192, 32768])(
    `handles typical ASE trajectory file size: %i bytes`,
    (size) => {
      const data = new Uint8Array(size)
      for (let idx = 0; idx < size; idx++) data[idx] = idx % 256
      const result = base64_to_array_buffer(btoa(String.fromCharCode(...data)))
      const result_array = new Uint8Array(result)
      expect(result.byteLength).toBe(size)
      expect(result_array[0]).toBe(0)
      expect(result_array[255]).toBe(255)
      expect(result_array[size - 1]).toBe((size - 1) % 256)
    },
  )

  test(`ASE trajectory file regression test - simulates VS Code extension flow`, () => {
    const ase_data = new Uint8Array([
      0x2d,
      0x20,
      0x6f,
      0x66,
      0x20,
      0x55,
      0x6c,
      0x6d, // "- of Ulm"
      0x41,
      0x53,
      0x45,
      0x2d,
      0x54,
      0x72,
      0x61,
      0x6a,
      0x65,
      0x63,
      0x74,
      0x6f,
      0x72,
      0x79,
      0x00,
      0x00, // "ASE-Trajectory"
      ...new Array(176).fill(0), // Mock trajectory data
    ])
    const result = base64_to_array_buffer(btoa(String.fromCharCode(...ase_data)))
    const result_array = new Uint8Array(result)
    expect(result.byteLength).toBe(ase_data.length)
    expect(new TextDecoder().decode(result_array.slice(0, 8))).toBe(`- of Ulm`)
    expect(new TextDecoder().decode(result_array.slice(8, 24)).replace(/\0/g, ``)).toBe(
      `ASE-Trajectory`,
    )
  })
})

describe(`VSCode Download Integration`, () => {
  test(`sets up global download override when VSCode API is available`, async () => {
    vi.resetModules() // Reset modules to clear cached vscode_api variable in webview/main.ts
    const mock_post_message = vi.fn()
    globalThis.acquireVsCodeApi = vi.fn(() => ({
      postMessage: mock_post_message,
      setState: vi.fn(),
      getState: vi.fn(),
    }))
    const { setup_vscode_download } = await import(`../src/webview/main`)
    setup_vscode_download()
    expect(typeof globalThis.download).toBe(`function`)
    globalThis.download(`test content`, `test.json`, `application/json`)
    expect(mock_post_message).toHaveBeenCalledWith({
      command: `saveAs`,
      content: `test content`,
      filename: `test.json`,
      is_binary: false,
    })
  })

  test(`handles binary data (PNG) correctly`, async () => {
    vi.resetModules()
    let onload: (() => void) | undefined
    let result: string | null = null

    globalThis.FileReader = vi.fn(function (this: FileReader) {
      this.readAsDataURL = vi.fn((blob: Blob) => {
        setTimeout(async () => {
          // Read actual Blob content for end-to-end correctness
          const array_buffer = await blob.arrayBuffer()
          const uint8_array = new Uint8Array(array_buffer)
          const binary_string = String.fromCharCode(...uint8_array)
          const base64_string = btoa(binary_string)
          result = `data:${blob.type};base64,${base64_string}`
          onload?.()
        }, 0)
      })
      Object.defineProperty(this, `onload`, { set: (fn) => (onload = fn) })
      Object.defineProperty(this, `result`, { get: () => result })
    }) as unknown as typeof FileReader

    const mock_post_message = vi.fn()
    globalThis.acquireVsCodeApi = vi.fn(() => ({
      postMessage: mock_post_message,
      setState: vi.fn(),
      getState: vi.fn(),
    }))
    const { setup_vscode_download } = await import(`../src/webview/main`)
    setup_vscode_download()
    globalThis.download(
      new Blob([`fake png data`], { type: `image/png` }),
      `structure.png`,
      `image/png`,
    )
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(mock_post_message).toHaveBeenCalledWith({
      command: `saveAs`,
      content: `data:image/png;base64,ZmFrZSBwbmcgZGF0YQ==`,
      filename: `structure.png`,
      is_binary: true,
    })
  })

  test.each([``, `   `])(`rejects invalid filename: "%s"`, (filename) => {
    vi.resetModules()
    const mock_post_message = vi.fn()
    globalThis.acquireVsCodeApi = vi.fn(() => ({
      postMessage: mock_post_message,
      setState: vi.fn(),
      getState: vi.fn(),
    }))
    setup_vscode_download()

    globalThis.download(`test content`, filename, `application/json`)
    expect(mock_post_message).not.toHaveBeenCalled()
  })

  test(`handles FileReader errors for binary data`, async () => {
    vi.resetModules()
    let onerror: (() => void) | undefined

    globalThis.FileReader = vi.fn(function (this: FileReader) {
      this.readAsDataURL = vi.fn(() => setTimeout(() => onerror?.(), 0))
      Object.defineProperty(this, `onerror`, { set: (fn) => (onerror = fn) })
    }) as unknown as typeof FileReader

    const mock_post_message = vi.fn()
    globalThis.acquireVsCodeApi = vi.fn(() => ({
      postMessage: mock_post_message,
      setState: vi.fn(),
      getState: vi.fn(),
    }))
    const { setup_vscode_download } = await import(`../src/webview/main`)
    setup_vscode_download()
    globalThis.download(new Blob([`data`]), `test.png`, `image/png`)
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(mock_post_message).toHaveBeenCalledWith({
      command: `error`,
      text: `Failed to read binary data for download`,
    })
  })

  test(`handles general exceptions during download`, async () => {
    vi.resetModules()
    const mock_post_message = vi.fn()
    globalThis.acquireVsCodeApi = vi.fn(() => ({
      postMessage: mock_post_message,
      setState: vi.fn(),
      getState: vi.fn(),
    }))
    const { setup_vscode_download } = await import(`../src/webview/main`)
    setup_vscode_download()

    mock_post_message.mockImplementationOnce(() => {
      throw new Error(`Network error`)
    })

    globalThis.download(`test content`, `test.json`, `application/json`)
    expect(mock_post_message).toHaveBeenCalledWith({
      command: `error`,
      text: `Download failed: Error: Network error`,
    })
  })
})
