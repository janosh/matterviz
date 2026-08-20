import { parse_structure_file } from '$lib/structure/parse'
import type * as TrajectoryParseModule from '$lib/trajectory/parse'
import { create_display, VSCodeFrameLoader } from '$lib/file-viewer/main'
import { base64_to_array_buffer, parse_file_content } from '$lib/file-viewer/parse'
import type { ParseResult } from '$lib/file-viewer/parse'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  deflateRawSync as deflate_raw_sync,
  deflateSync as deflate_sync,
  gzipSync as gzip_sync,
} from 'node:zlib'
import { zipSync } from 'fflate'
import { mount } from 'svelte'
import type * as svelte_module from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

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

// Spy on the mocked mount to assert which props create_display passes to components.
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
  const bytes = readFileSync(resolve(import.meta.dirname, `../fixtures/vasp-hdf5/${name}`))
  return (gzip ? gzip_sync(bytes) : bytes).toString(`base64`)
}
const make_container = () => ({ style: {}, innerHTML: `` }) as unknown as HTMLElement
const last_mount_props = () =>
  vi.mocked(mount).mock.calls.at(-1)?.[1]?.props as Record<string, unknown>

describe(`Webview Integration - ASE Binary Trajectory Support`, () => {
  test.each([
    [`SGVsbG8gV29ybGQ=`, `Hello World`, 11], // Basic ASCII, one `=` pad
    [``, ``, 0], // Empty string
    [`QQ==`, `A`, 1], // Single character, two `=` pads
    [`QUI=`, `AB`, 2], // Two characters, one `=` pad
  ])(`base64_to_array_buffer: %s → %s (%i bytes)`, (base64, expected, byte_length) => {
    const result = base64_to_array_buffer(base64)
    expect(result).toBeInstanceOf(ArrayBuffer)
    expect(result.byteLength).toBe(byte_length)
    expect(new TextDecoder().decode(result)).toBe(expected)
  })

  // Both padding classes at a size past 256, so every byte value appears in each
  test.each([1024, 8192])(`handles typical ASE trajectory file size: %i bytes`, (size) => {
    // bytes cycle through 0-255, so full equality also proves byte-order
    // preservation for every possible byte value
    const data = new Uint8Array(size)
    for (let idx = 0; idx < size; idx++) data[idx] = idx % 256
    const result = base64_to_array_buffer(uint8_as_base64(data))
    expect(result.byteLength).toBe(size)
    expect(Array.from(new Uint8Array(result))).toEqual(Array.from(data))
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

test(`parse_file_content renders convex hull JSON whose filename contains convex`, async () => {
  // oxfmt-ignore
  const convex_hull_entries = [
    { composition: { Al: 1 }, energy: 0, e_form_per_atom: 0, e_above_hull: 0, is_stable: true },
    { composition: { Cu: 1 }, energy: 0, e_form_per_atom: 0, e_above_hull: 0, is_stable: true },
    { composition: { Al: 1, Cu: 1 }, energy: -0.2, e_form_per_atom: -0.1, e_above_hull: 0, is_stable: true },
  ]

  await expect(
    parse_file_content(JSON.stringify(convex_hull_entries), `Al-Cu-convex-hull.json`),
  ).resolves.toMatchObject({
    type: `convex_hull`,
    data: convex_hull_entries,
    filename: `Al-Cu-convex-hull.json`,
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

    create_display(make_container(), result)
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

    create_display(make_container(), result)
    const mount_props = last_mount_props() as {
      dos?: unknown
      trajectory_props?: { trajectory: unknown; property_labels: Record<string, string> }
    }
    expect(mount_props.dos).toBeDefined()
    expect(mount_props.trajectory_props?.trajectory).toBe(result.data)
    expect(mount_props.trajectory_props?.property_labels).toEqual({})
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

  test.each([
    [`.gz`, gzip_sync],
    [`.deflate`, deflate_sync],
    [`.z`, deflate_raw_sync],
    [`.zip`, (data: Uint8Array) => zipSync({ [`relax.traj`]: data })],
  ] as const)(
    `%s-compressed .traj routes byte-identical data to the trajectory parser`,
    async (extension, compress) => {
      const { parse_trajectory_data } = await import(`$lib/trajectory/parse`)
      vi.mocked(parse_trajectory_data).mockResolvedValueOnce({ frames: [], metadata: {} })
      // ULM magic + bytes that are invalid UTF-8: text decompression would corrupt them
      const raw_bytes = new Uint8Array([
        0x2d, 0x20, 0x6f, 0x66, 0x20, 0x55, 0x6c, 0x6d, 0x00, 0xff, 0xfe, 0x80,
      ])
      const result = await parse_file_content(
        uint8_as_base64(compress(raw_bytes)),
        `relax.traj${extension}`,
        true,
      )

      expect(result.type).toBe(`trajectory`)
      expect(result.filename).toBe(`relax.traj`)
      const [buffer, inner_name] = vi.mocked(parse_trajectory_data).mock.calls.at(-1) ?? []
      expect(inner_name).toBe(`relax.traj`)
      expect(Array.from(new Uint8Array(buffer as ArrayBuffer))).toEqual([...raw_bytes])
    },
  )
})

test.each([
  [`fermi_surface`, { energies: [] }, `band_data`],
  [`convex_hull`, [], `entries`],
  [`phase_diagram`, {}, `data`],
  [`structure`, { sites: [] }, `structure`],
] as const)(`create_display mounts %s data`, (type, data, prop_name) => {
  create_display(make_container(), { type, data, filename: `test.json` })
  expect(last_mount_props()[prop_name]).toBe(data)
})

describe(`create_display trajectory display options`, () => {
  const trajectory_result = (): ParseResult => ({
    type: `trajectory`,
    data: { frames: [], metadata: {} },
    filename: `relax.h5`,
  })

  // Regression: Hive (and other non-VS Code hosts) leave --vscode-* unset. Falling
  // back to dark hex made light-mode traj shells black and bleached info-pane text.
  test(`viewer shell follows MatterViz theme tokens when VS Code vars are absent`, () => {
    const container = make_container()
    create_display(container, trajectory_result())
    expect(container.style.background).toContain(`--page-bg`)
    expect(container.style.background).not.toContain(`#1e1e1e`)
    expect(container.style.color).toContain(`--text-color`)
    expect(container.style.color).not.toContain(`#d4d4d4`)
  })

  test(`trajectory display options reach the mounted Trajectory component`, () => {
    const on_step_change = vi.fn()
    const on_trajectory_controller = vi.fn()
    create_display(make_container(), trajectory_result(), {
      initial_step_idx: 42,
      on_step_change,
      on_trajectory_controller,
    })
    const mount_props = last_mount_props()
    expect(mount_props.current_step_idx).toBe(42)
    expect(mount_props.on_controller).toBe(on_trajectory_controller)
    // Loading settings travel in loading_options; as top-level props they would land on the
    // wrapper div as unknown HTML attributes
    expect(mount_props.loading_options).toEqual({
      bin_file_threshold: 50_000_000,
      text_file_threshold: 25_000_000,
      use_indexing: false,
    })
    for (const key of [`bin_file_threshold`, `text_file_threshold`, `use_indexing`]) {
      expect(mount_props).not.toHaveProperty(key)
    }
    expect(mount_props).not.toHaveProperty(`show_parsing_progress`)
    expect(mount_props.spinner_props).toEqual({ show_progress: true })
    // create_display adapts Trajectory's TrajHandlerData callback to (step_idx, total)
    ;(mount_props.on_step_change as (data: unknown) => void)({
      step_idx: 7,
      frame_count: 20,
    })
    expect(on_step_change).toHaveBeenCalledWith(7, 20)
  })

  test.each([
    [`auto`, undefined],
    [`always`, true],
    [`never`, false],
  ] as const)(`show_legend setting %s maps to %s`, (mode, expected) => {
    const prev_data = globalThis.matterviz_data
    globalThis.matterviz_data = {
      ...prev_data,
      defaults: { scatter: { show_legend: mode }, histogram: { show_legend: mode } },
    } as typeof globalThis.matterviz_data
    try {
      create_display(make_container(), trajectory_result())
      const { scatter_props, histogram_props } = last_mount_props() as {
        scatter_props: Record<string, unknown>
        histogram_props: Record<string, unknown>
      }
      expect(scatter_props.show_legend).toBe(expected)
      expect(histogram_props.show_legend).toBe(expected)
      // LegendConfig has no `show` field, so `legend` would leak onto the DOM via ...rest.
      expect(scatter_props).not.toHaveProperty(`legend`)
      expect(histogram_props).not.toHaveProperty(`legend`)
    } finally {
      globalThis.matterviz_data = prev_data
    }
  })

  test(`rejects stale boolean legend settings`, () => {
    const prev_data = globalThis.matterviz_data
    globalThis.matterviz_data = {
      ...prev_data,
      defaults: { scatter: { show_legend: true }, histogram: { show_legend: true } },
    } as unknown as typeof globalThis.matterviz_data
    try {
      expect(() => create_display(make_container(), trajectory_result())).toThrow(
        `Invalid legend visibility mode: true`,
      )
    } finally {
      globalThis.matterviz_data = prev_data
    }
  })

  test.each([[undefined], [{}]])(
    `display options %o leave Trajectory props untouched`,
    (display_options) => {
      create_display(make_container(), trajectory_result(), display_options)
      const mount_props = last_mount_props()
      expect(mount_props.current_step_idx).toBeUndefined()
      expect(mount_props.on_step_change).toBeUndefined()
    },
  )
})

describe(`VS Code frame loader`, () => {
  test(`requests frames by host file path`, async () => {
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
        // The host picks its per-format frame decoder from the name.
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

  // Reset modules (clears the cached vscode_api in file-viewer/main.ts), mock the VS Code
  // API, then install the download override. Returns the postMessage mock to assert on.
  const init_download = async () => {
    vi.resetModules()
    const mock_post_message = vi.fn()
    globalThis.acquireVsCodeApi = vi.fn(() => ({
      postMessage: mock_post_message,
      setState: vi.fn(),
      getState: vi.fn(),
    }))
    const { setup_vscode_download } = await import(`$lib/file-viewer/main`)
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

  // Both binary download paths need a FileReader stub whose async read is driven by
  // fake timers. `outcome` picks which of the two listeners main.ts registers fires:
  // `load` also fills in `result` from the real Blob for end-to-end correctness.
  const stub_file_reader = (outcome: `load` | `error`) => {
    vi.useFakeTimers()

    globalThis.FileReader = vi.fn(function (this: FileReader) {
      // Per instance, not per stub: overlapping downloads would otherwise share one
      // listener and result, so the second read would clobber the first
      let listener: (() => void) | undefined
      let result: string | null = null

      this.readAsDataURL = vi.fn((blob: Blob) => {
        setTimeout(() => {
          void (async () => {
            if (outcome === `load`) {
              const bytes = new Uint8Array(await blob.arrayBuffer())
              result = `data:${blob.type};base64,${btoa(String.fromCharCode(...bytes))}`
            }
            listener?.()
          })()
        }, 0)
      })
      this.addEventListener = vi.fn((type: string, handler: EventListener) => {
        if (type === outcome) listener = handler as () => void
      })
      Object.defineProperty(this, `result`, { get: () => result })
    }) as unknown as typeof FileReader
  }

  test(`handles binary data (PNG) correctly`, async () => {
    stub_file_reader(`load`)
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
    stub_file_reader(`error`)
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
