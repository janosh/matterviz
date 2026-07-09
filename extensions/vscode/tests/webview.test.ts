import { parse_structure_file } from '$lib/structure/parse'
import type * as TrajectoryParseModule from '$lib/trajectory/parse'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { mount } from 'svelte'
import type * as svelte_module from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  base64_to_array_buffer,
  create_display,
  parse_file_content,
  parse_large_file_marker,
  type ParseResult,
  VSCodeFrameLoader,
} from '../src/webview/main'

// parse_structure_file throws on parse failure but can still return a structure with
// zero atoms (e.g. a CIF with cell params but no _atom_site records). Mock it to that
// shape to exercise parse_file_content's no-atoms guard.
vi.mock('$lib/structure/parse', () => ({ parse_structure_file: vi.fn() }))

// Wrap (not replace) parse_trajectory_data so most tests hit the real parser
// while individual tests can inject degenerate outputs via mockResolvedValueOnce.
vi.mock('$lib/trajectory/parse', async (import_original) => {
  const original = await import_original<typeof TrajectoryParseModule>()
  return { ...original, parse_trajectory_data: vi.fn(original.parse_trajectory_data) }
})

// Svelte components are stubbed out in test mode (see vite.config.ts svelte-mock), so
// spy on mount to assert which props create_display passes to the mounted component.
vi.mock('svelte', async (import_original) => ({
  ...(await import_original<typeof svelte_module>()),
  mount: vi.fn(() => ({})),
}))

declare global {
  // download function added by VSCode integration
  var download: (content: string | Blob, filename: string, contentType: string) => void
}

const uint8_as_base64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes))

const fixture_base64 = (name: string, gzip = false): string => {
  const bytes = readFileSync(
    resolve(import.meta.dirname, `../../../tests/vitest/fixtures/vasp-hdf5/${name}`),
  )
  return (gzip ? gzipSync(bytes) : bytes).toString(`base64`)
}
const make_container = () => ({ style: {}, innerHTML: `` }) as unknown as HTMLElement
const last_mount_props = () =>
  vi.mocked(mount).mock.calls.at(-1)?.[1]?.props as Record<string, unknown>

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

  test.each([1024, 8192, 32768])(
    `handles typical ASE trajectory file size: %i bytes`,
    (size) => {
      // bytes cycle through 0-255, so full equality also proves byte-order
      // preservation for every possible byte value
      const data = new Uint8Array(size)
      for (let idx = 0; idx < size; idx++) data[idx] = idx % 256
      const result = base64_to_array_buffer(uint8_as_base64(data))
      expect(result.byteLength).toBe(size)
      expect(Array.from(new Uint8Array(result))).toEqual(Array.from(data))
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

describe(`vaspout.h5 electronic routing`, () => {
  // Parsed content details are covered by tests/vitest/trajectory/vaspout-h5.test.ts;
  // these tests only check routing and the mount contract.
  test(`bands-only vaspout.h5 routes to vaspout_electronic and mounts electronic bands`, async () => {
    const base64 = fixture_base64(`vaspout-tinisn-bands-only.h5`)
    const result = await parse_file_content(base64, `vaspout.h5`, true)
    expect(result.type).toBe(`vaspout_electronic`)
    const data = result.data as { dos: unknown; bands: unknown }
    expect(data.dos).toBeNull()
    expect(data.bands).not.toBeNull()

    create_display(make_container(), result, `vaspout.h5`)
    const mount_props = last_mount_props()
    expect(mount_props.band_type).toBe(`electronic`)
    expect(mount_props.band_structs).toBe(data.bands)
  })

  test(`0-frame trajectory with all-null electronic falls through to trajectory`, async () => {
    // The vaspout parser never emits { dos: null, bands: null } today, but the
    // metadata cast in parse.ts is unchecked — an empty electronic object must
    // not route to vaspout_electronic (create_display would mount Dos with
    // doses: null, violating DosInput).
    const { parse_trajectory_data } = await import(`$lib/trajectory/parse`)
    vi.mocked(parse_trajectory_data).mockResolvedValueOnce({
      frames: [],
      metadata: { electronic: { dos: null, bands: null } },
    })
    const result = await parse_file_content(`ignored`, `vaspout.h5`, true)
    expect(result.type).toBe(`trajectory`)
  })

  test(`trajectories carrying a DOS mount the trajectory-with-DOS wrapper`, async () => {
    const scf_base64 = fixture_base64(`vaspout-si-static-scf.h5`)
    const result = await parse_file_content(scf_base64, `vaspout.h5`, true)
    expect(result.type).toBe(`trajectory`)

    create_display(make_container(), result, `vaspout.h5`)
    const mount_props = last_mount_props() as {
      dos?: unknown
      trajectory_props?: { trajectory: unknown }
    }
    expect(mount_props.dos).toBeDefined()
    expect(mount_props.trajectory_props?.trajectory).toBe(result.data)
  })

  // Ferrox archives VASP HDF5 outputs gzipped on S3; the inner filename must
  // drive routing after binary decompression.
  test.each([
    [`vaspout-tinisn-bands-only.h5`, `vaspout.h5.gz`, `vaspout_electronic`],
    [`vaspwave-si-charge.h5`, `vaspwave.h5.gz`, `isosurface`],
  ])(`gzipped %s routes as %s`, async (fixture_name, gz_filename, expected_type) => {
    const gz_base64 = fixture_base64(fixture_name, true)
    const result = await parse_file_content(gz_base64, gz_filename, true)
    expect(result.type).toBe(expected_type)
    expect(result.filename).toBe(gz_filename.replace(/\.gz$/, ``))
  })

  test(`gzipped .traj routes byte-identical binary data to the trajectory parser`, async () => {
    const { parse_trajectory_data } = await import(`$lib/trajectory/parse`)
    vi.mocked(parse_trajectory_data).mockResolvedValueOnce({ frames: [], metadata: {} })
    // ULM magic + bytes that are invalid UTF-8: text decompression would corrupt them
    const raw_bytes = new Uint8Array([
      0x2d, 0x20, 0x6f, 0x66, 0x20, 0x55, 0x6c, 0x6d, 0x00, 0xff, 0xfe, 0x80,
    ])
    const gz_base64 = uint8_as_base64(new Uint8Array(gzipSync(raw_bytes)))

    const result = await parse_file_content(gz_base64, `relax.traj.gz`, true)

    expect(result.type).toBe(`trajectory`)
    expect(result.filename).toBe(`relax.traj`)
    const [buffer, inner_name] = vi.mocked(parse_trajectory_data).mock.calls.at(-1) ?? []
    expect(inner_name).toBe(`relax.traj`)
    expect(Array.from(new Uint8Array(buffer as ArrayBuffer))).toEqual([...raw_bytes])
  })
})

describe(`create_display trajectory display options`, () => {
  const trajectory_result = (): ParseResult => ({
    type: `trajectory`,
    data: { frames: [], metadata: {} },
    filename: `relax.h5`,
  })

  test(`initial_step_idx and on_step_change reach the mounted Trajectory component`, () => {
    const on_step_change = vi.fn()
    create_display(make_container(), trajectory_result(), `relax.h5`, {
      initial_step_idx: 42,
      on_step_change,
    })
    const mount_props = last_mount_props()
    expect(mount_props.current_step_idx).toBe(42)
    // create_display adapts Trajectory's TrajHandlerData callback to (step_idx, total)
    ;(mount_props.on_step_change as (data: unknown) => void)({
      step_idx: 7,
      frame_count: 20,
    })
    expect(on_step_change).toHaveBeenCalledWith(7, 20)
  })

  test.each([[undefined], [{}]])(
    `display options %o leave Trajectory props untouched`,
    (display_options) => {
      create_display(make_container(), trajectory_result(), `relax.h5`, display_options)
      const mount_props = last_mount_props()
      expect(mount_props.current_step_idx).toBeUndefined()
      expect(mount_props.on_step_change).toBeUndefined()
    },
  )
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
  test(`includes filename in frame requests for the host streaming bridge`, async () => {
    // post_request listens on globalThis, which is a real EventTarget in the
    // webview but not in vitest's node environment — bridge it for the test
    const message_bus = new EventTarget()
    vi.stubGlobal(`addEventListener`, message_bus.addEventListener.bind(message_bus))
    vi.stubGlobal(`removeEventListener`, message_bus.removeEventListener.bind(message_bus))
    try {
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
      message_bus.dispatchEvent(
        new MessageEvent(`message`, {
          data: { command: `frame_response`, request_id, frame: null },
        }),
      )
      await expect(frame_promise).resolves.toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
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
