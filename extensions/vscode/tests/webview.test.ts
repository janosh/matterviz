import { parse_structure_file } from '$lib/structure/parse'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  base64_to_array_buffer,
  parse_file_content,
  parse_large_file_marker,
  VSCodeFrameLoader,
} from '../src/webview/main'

// parse_structure_file throws on parse failure but can still return a structure with
// zero atoms (e.g. a CIF with cell params but no _atom_site records). Mock it to that
// shape to exercise parse_file_content's no-atoms guard.
vi.mock('$lib/structure/parse', () => ({ parse_structure_file: vi.fn() }))

declare global {
  // download function added by VSCode integration
  var download: (content: string | Blob, filename: string, contentType: string) => void
}

const uint8_as_base64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes))

describe(`Webview Integration - ASE Binary Trajectory Support`, () => {
  test.each([
    [`SGVsbG8gV29ybGQ=`, `Hello World`, 11], // Basic ASCII
    [`QUJDREVGR0g=`, `ABCDEFGH`, 8], // Another ASCII
    [``, ``, 0], // Empty string
    [`QQ==`, `A`, 1], // Single character
    [`QUI=`, `AB`, 2], // Two characters
  ])(`base64_to_array_buffer: %s → %s (%i bytes)`, (base64, expected, byte_length) => {
    const result = base64_to_array_buffer(base64)
    expect(result).toBeInstanceOf(ArrayBuffer)
    expect(result.byteLength).toBe(byte_length)
    expect(new TextDecoder().decode(result)).toBe(expected)
  })

  test(`preserves byte order`, () => {
    const test_bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd, 0xfc])
    const result = base64_to_array_buffer(uint8_as_base64(test_bytes))
    expect(Array.from(new Uint8Array(result))).toEqual(Array.from(test_bytes))
  })

  test.each([1024, 8192, 32768])(
    `handles typical ASE trajectory file size: %i bytes`,
    (size) => {
      const data = new Uint8Array(size)
      for (let idx = 0; idx < size; idx++) data[idx] = idx % 256
      const result = base64_to_array_buffer(uint8_as_base64(data))
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
      ...Array(176).fill(0), // Mock trajectory data
    ])
    const result = base64_to_array_buffer(uint8_as_base64(ase_data))
    const result_array = new Uint8Array(result)
    expect(result.byteLength).toBe(ase_data.length)
    expect(new TextDecoder().decode(result_array.slice(0, 8))).toBe(`- of Ulm`)
    expect(new TextDecoder().decode(result_array.slice(8, 24)).replaceAll(`\0`, ``)).toBe(
      `ASE-Trajectory`,
    )
  })
})

describe(`parse_file_content structure guard`, () => {
  // parse_structure_file is mocked above; vary its return to exercise the no-atoms guard.
  // error=string asserts a throw, error=null asserts a successful structure result.
  test.each([
    [`empty cell-only CIF`, { sites: [] }, `empty.cif`, `No atoms found in empty.cif`],
    [`missing sites property`, {}, `empty.cif`, `No atoms found in empty.cif`],
    [`valid structure`, { sites: [{ species: [] }] }, `ok.cif`, null],
  ])(`%s`, async (_label, parsed, filename, error) => {
    vi.mocked(parse_structure_file).mockReturnValueOnce(parsed as never)
    const promise = parse_file_content(`data_test`, filename)
    if (error) await expect(promise).rejects.toThrow(error)
    else expect(await promise).toMatchObject({ type: `structure`, filename })
  })
})

describe(`parse_file_content JSON renderable routing`, () => {
  test(`renders convex hull JSON whose filename contains convex`, async () => {
    const convex_hull_entries = [
      {
        composition: { Al: 1 },
        energy: 0,
        e_form_per_atom: 0,
        e_above_hull: 0,
        is_stable: true,
      },
      {
        composition: { Cu: 1 },
        energy: 0,
        e_form_per_atom: 0,
        e_above_hull: 0,
        is_stable: true,
      },
      {
        composition: { Al: 1, Cu: 1 },
        energy: -0.2,
        e_form_per_atom: -0.1,
        e_above_hull: 0,
        is_stable: true,
      },
    ]

    await expect(
      parse_file_content(JSON.stringify(convex_hull_entries), `Al-Cu-convex-hull.json`),
    ).resolves.toMatchObject({
      type: `convex_hull`,
      data: convex_hull_entries,
      filename: `Al-Cu-convex-hull.json`,
    })
  })
})

describe(`large file marker parsing`, () => {
  test.each([
    [
      `LARGE_FILE:/tmp/movie.traj:536870912`,
      { file_path: `/tmp/movie.traj`, file_size: 536870912 },
    ],
    [
      `LARGE_FILE:C:\\Users\\janosh\\movie.traj:536870912`,
      { file_path: `C:\\Users\\janosh\\movie.traj`, file_size: 536870912 },
    ],
    [`not-large`, null],
  ])(`parses marker %s`, (marker, expected) => {
    expect(parse_large_file_marker(marker)).toEqual(expected)
  })

  test.each([
    `LARGE_FILE:missing-size`,
    `LARGE_FILE:/tmp/file:not-a-number`,
    `LARGE_FILE:/tmp/file:123abc`,
    `LARGE_FILE:/tmp/file:-1`,
    `LARGE_FILE:/tmp/file:`,
    `LARGE_FILE:/tmp/file: `,
  ])(`rejects malformed marker %s`, (marker) => {
    expect(() => parse_large_file_marker(marker)).toThrow(`Malformed large file`)
  })
})

describe(`VS Code frame loader`, () => {
  test(`includes filename in frame requests for desktop streaming bridge`, async () => {
    const post_message = vi.fn()
    const loader = new VSCodeFrameLoader(`/tmp/movie.extxyz`, `movie.extxyz`, {
      postMessage: post_message,
    })
    const frame_promise = loader.load_frame(``, 7)

    expect(post_message).toHaveBeenCalledWith({
      command: `request_frame`,
      request_id: expect.any(String),
      file_path: `/tmp/movie.extxyz`,
      filename: `movie.extxyz`,
      frame_index: 7,
    })

    const [{ request_id }] = post_message.mock.calls[0]
    globalThis.dispatchEvent(
      new MessageEvent(`message`, {
        data: { command: `frame_response`, request_id, frame: null },
      }),
    )
    await expect(frame_promise).resolves.toBeNull()
  })
})

describe(`VSCode Download Integration`, () => {
  afterEach(vi.useRealTimers)

  // Reset modules (clears the cached vscode_api in webview/main.ts), mock the VS Code
  // API, then install the download override. Returns the postMessage mock to assert on.
  const init_download = async () => {
    vi.resetModules()
    const mock_post_message = vi.fn()
    globalThis.acquireVsCodeApi = vi.fn(() => ({
      postMessage: mock_post_message,
      setState: vi.fn(),
      getState: vi.fn(),
    }))
    const { setup_vscode_download } = await import(`../src/webview/main`)
    setup_vscode_download()
    return mock_post_message
  }

  test(`sets up global download override when VSCode API is available`, async () => {
    const mock_post_message = await init_download()
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
    vi.useFakeTimers()
    let load_listener: (() => void) | undefined
    let result: string | null = null

    globalThis.FileReader = vi.fn(function (this: FileReader) {
      this.readAsDataURL = vi.fn((blob: Blob) => {
        setTimeout(() => {
          void (async () => {
            // Read actual Blob content for end-to-end correctness
            const array_buffer = await blob.arrayBuffer()
            const uint8_array = new Uint8Array(array_buffer)
            const binary_string = String.fromCharCode(...uint8_array)
            const base64_string = btoa(binary_string)
            result = `data:${blob.type};base64,${base64_string}`
            load_listener?.()
          })()
        }, 0)
      })
      this.addEventListener = vi.fn((type: string, listener: EventListener) => {
        if (type === `load`) load_listener = listener as () => void
      })
      Object.defineProperty(this, `result`, { get: () => result })
    }) as unknown as typeof FileReader

    const mock_post_message = await init_download()
    globalThis.download(
      new Blob([`fake png data`], { type: `image/png` }),
      `structure.png`,
      `image/png`,
    )
    await vi.runAllTimersAsync()

    expect(mock_post_message).toHaveBeenCalledWith({
      command: `saveAs`,
      content: `data:image/png;base64,ZmFrZSBwbmcgZGF0YQ==`,
      filename: `structure.png`,
      is_binary: true,
    })
  })

  test.each([``, `   `])(`rejects invalid filename: "%s"`, async (filename) => {
    const mock_post_message = await init_download()

    globalThis.download(`test content`, filename, `application/json`)
    expect(mock_post_message).not.toHaveBeenCalled()
  })

  test(`handles FileReader errors for binary data`, async () => {
    vi.useFakeTimers()
    let error_listener: (() => void) | undefined

    globalThis.FileReader = vi.fn(function (this: FileReader) {
      this.readAsDataURL = vi.fn(() => setTimeout(() => error_listener?.(), 0))
      this.addEventListener = vi.fn((type: string, listener: EventListener) => {
        if (type === `error`) error_listener = listener as () => void
      })
    }) as unknown as typeof FileReader

    const mock_post_message = await init_download()
    globalThis.download(new Blob([`data`]), `test.png`, `image/png`)
    await vi.runAllTimersAsync()

    expect(mock_post_message).toHaveBeenCalledWith({
      command: `error`,
      text: `Failed to read binary data for download`,
    })
  })

  test(`handles general exceptions during download`, async () => {
    const mock_post_message = await init_download()

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
