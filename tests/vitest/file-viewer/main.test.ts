import { create_display } from '$lib/file-viewer/main'
import { base64_to_array_buffer, parse_file_content } from '$lib/file-viewer/parse'
import type { ParseResult } from '$lib/file-viewer/parse'
import { is_fermi_surface_data } from '$lib/fermi-surface/types'
import { parse_structure_file } from '$lib/structure/parse'
import type * as structure_parse_module from '$lib/structure/parse'
import type { TrajectoryRun } from '$lib/trajectory'
import { trajectory_from_frames } from '$lib/trajectory/open'
import { summarize_run } from '$lib/trajectory/run'
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
import { IDENTITY_MATRIX3, make_crystal, read_binary_test_file } from '../setup'

// parse_structure_file throws on parse failure but can still return a structure with
// zero atoms (e.g. a CIF with cell params but no _atom_site records). Wrap it in a spy that
// defaults to the real parser so single tests can return that shape and exercise
// parse_file_content's no-atoms guard.
vi.mock('$lib/structure/parse', async (import_original) => {
  const original = await import_original<typeof structure_parse_module>()
  return { ...original, parse_structure_file: vi.fn(original.parse_structure_file) }
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
// Run `body` with host `defaults` in the bootstrap payload create_display reads, then restore
const with_defaults = (defaults: unknown, body: () => void): void => {
  const prev_data = globalThis.matterviz_data
  globalThis.matterviz_data = { ...prev_data, defaults } as typeof globalThis.matterviz_data
  try {
    body()
  } finally {
    globalThis.matterviz_data = prev_data
  }
}

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

test(`parses a POSCAR structure through the worker-safe entry`, async () => {
  const poscar = `Si2\n1.0\n5.43 0 0\n0 5.43 0\n0 0 5.43\nSi\n2\ndirect\n0 0 0 Si\n0.25 0.25 0.25 Si\n`
  const result = await parse_file_content(poscar, `POSCAR`)

  expect(result.type).toBe(`structure`)
  expect((result.data as { sites: unknown[] }).sites).toHaveLength(2)
})

test(`multi-frame XYZ text opens as a trajectory run`, async () => {
  const h2 = (step: number, dz: number): string => `2\nstep=${step}\nH 0 0 0\nH 0 0 ${dz}`
  const result = await parse_file_content(`${h2(0, 0.74)}\n${h2(1, 0.78)}`, `h2.xyz`)
  expect(result.type).toBe(`trajectory`)
  const run = result.data as TrajectoryRun
  expect(run.frame_count).toBe(2)
  expect(run.provenance).toMatchObject({ filename: `h2.xyz`, format: `xyz` })
  expect((await run.read_frame(1)).step).toBe(1)
  run.dispose()
})

// The host's matterviz.trajectory.atom_type_mapping arrives in load_options with string keys
// (JSON); the LAMMPS reader names the types from it instead of guessing atomic numbers
test.each([
  [{ '1': `Si`, '2': `O` }, [`Si`, `O`, `O`], 0],
  [undefined, [`H`, `He`, `He`], 1],
] as const)(
  `LAMMPS dump with atom_type_mapping %o`,
  async (atom_type_mapping, elements, n_warnings) => {
    const dump = `ITEM: TIMESTEP\n0\nITEM: NUMBER OF ATOMS\n3\nITEM: BOX BOUNDS pp pp pp\n0 5\n0 5\n0 5
ITEM: ATOMS id type x y z\n1 1 0 0 0\n2 2 1 1 1\n3 2 2 2 2`
    const result = await parse_file_content(dump, `dump.lammpstrj`, false, {
      atom_type_mapping,
    })
    expect(result.type).toBe(`trajectory`)
    const run = result.data as TrajectoryRun
    expect(run.preview.structure.sites.map((site) => site.species[0].element)).toEqual(
      elements,
    )
    expect(run.warnings).toHaveLength(n_warnings)
    run.dispose()
  },
)

test.each([
  [`data.json.xz`, `XZ decompression is not supported`],
  [`data.json.bz2`, `BZ2 decompression is not supported`],
  [`movie.xyz.gz.gz`, `Nested compression is not supported`], // rejected before parsing the inner payload
])(`rejects %s with %s`, async (filename, message) => {
  await expect(parse_file_content(btoa(`content`), filename, true)).rejects.toThrow(message)
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

test(`parse_file_content converts IFermi JSON to typed Fermi surface data`, async () => {
  const ifermi_surface = {
    '@class': `FermiSurface`,
    isosurfaces: {
      1: [
        {
          vertices: [
            [0, 0, 0],
            [1, 0, 0],
            [0, 1, 0],
          ],
          faces: [[0, 1, 2]],
          band_idx: 1,
        },
      ],
    },
    reciprocal_space: { reciprocal_lattice: IDENTITY_MATRIX3 },
  }

  const result = await parse_file_content(JSON.stringify(ifermi_surface), `surface.json`)

  if (result.type !== `fermi_surface`) throw new Error(`expected Fermi surface result`)
  if (!is_fermi_surface_data(result.data)) throw new Error(`expected Fermi surface data`)
  // Positive band key → spin up; the mesh lands in renderer-ready typed arrays
  expect(result.data).toMatchObject({
    k_lattice: IDENTITY_MATRIX3,
    fermi_energy: 0,
    reciprocal_cell: `wigner_seitz`,
    metadata: { n_bands: 1, n_surfaces: 1, source_format: `ifermi-json` },
  })
  expect(result.data.isosurfaces).toHaveLength(1)
  const [sheet] = result.data.isosurfaces
  expect(sheet.positions).toEqual(Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]))
  expect(sheet.indices).toEqual(Uint32Array.from([0, 1, 2]))
  expect([sheet.band_index, sheet.spin]).toEqual([1, `up`])
})

// Regression: the site-less structure wrapping a volumetric JSON carried the bare 3x3 matrix
// as `lattice`, so StructureScene crashed on lattice.matrix (JsonBrowser panels shared it)
test.each([true, false])(
  `parse_file_content wraps volumetric JSON (periodic=%s) in a structure with a full lattice`,
  async (periodic) => {
    const matrix = [
      [4, 0, 0],
      [0, 5, 0],
      [0, 0, 6],
    ]
    const volumetric = {
      lattice: matrix,
      origin: [0, 0, 0],
      periodic,
      values: Array.from({ length: 8 }, (_, idx) => idx),
      dims: [2, 2, 2],
    }
    const result = await parse_file_content(JSON.stringify(volumetric), `density.json`)
    expect(result).toMatchObject({
      type: `isosurface`,
      data: {
        structure: {
          sites: [],
          lattice: {
            matrix,
            a: 4,
            b: 5,
            c: 6,
            volume: 120,
            pbc: [periodic, periodic, periodic],
          },
        },
      },
    })
    const { volumes } = result.data as { volumes: { lattice: number[][]; dims: number[] }[] }
    expect(volumes).toHaveLength(1)
    expect(volumes[0]).toMatchObject({ lattice: matrix, dims: [2, 2, 2] })
  },
)

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

  test(`trajectories carrying a DOS mount the trajectory-with-DOS wrapper`, async () => {
    const scf_base64 = fixture_base64(`vaspout-si-static-scf.h5`)
    const result = await parse_file_content(scf_base64, `vaspout.h5`, true)
    expect(result.type).toBe(`trajectory`)
    const run = result.data as TrajectoryRun
    expect(run.frame_count).toBeGreaterThanOrEqual(1)
    expect(run.provenance.format).toBe(`vaspout-h5`)

    create_display(make_container(), result)
    const mount_props = last_mount_props() as {
      dos?: unknown
      trajectory_props?: { trajectory: unknown; property_labels: Record<string, string> }
    }
    // the DOS panel is fed the run's own electronic metadata, not a re-parsed copy
    const electronic = run.metadata?.electronic as { dos: unknown } | undefined
    if (!electronic?.dos) throw new Error(`fixture run carries no electronic DOS`)
    expect(mount_props.dos).toBe(electronic.dos)
    expect(mount_props.trajectory_props?.trajectory).toBe(run)
    expect(mount_props.trajectory_props?.property_labels).toEqual({})
    run.dispose()
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

  // ULM-encoded .traj bytes are not valid UTF-8: text decompression would corrupt them and
  // the ASE parser would reject the header, so a successful open proves the bytes survived
  test.each([
    [`.gz`, gzip_sync],
    [`.deflate`, deflate_sync],
    [`.z`, deflate_raw_sync],
    [`.zip`, (data: Uint8Array) => zipSync({ [`relax.traj`]: data })],
  ] as const)(
    `%s-compressed .traj routes byte-identical data to the trajectory parser`,
    async (extension, compress) => {
      const raw_bytes = new Uint8Array(read_binary_test_file(`ase-LiMnO2-chgnet-relax.traj`))
      const result = await parse_file_content(
        uint8_as_base64(compress(raw_bytes)),
        `relax.traj${extension}`,
        true,
      )
      expect(result.type).toBe(`trajectory`)
      expect(result.filename).toBe(`relax.traj`)
      const run = result.data as TrajectoryRun
      expect(run.provenance).toMatchObject({ filename: `relax.traj`, format: `ase` })
      expect(run.frame_count).toBe(2)
      expect(run.preview.structure.sites).toHaveLength(8)
      run.dispose()
    },
  )
})

test.each([
  [`fermi_surface`, { energies: [] }, `band_data`, false],
  [`convex_hull`, [], `entries`, false],
  [`phase_diagram`, {}, `data`, undefined],
  [`structure`, { sites: [] }, `structure`, false],
] as const)(`create_display mounts %s data`, (type, data, prop_name, allow_file_drop) => {
  // Minimal stubs: this asserts which prop create_display forwards data to, not that the
  // payload is a well-formed member of its view type
  create_display(make_container(), { type, data, filename: `test.json` } as ParseResult)
  const mount_props = last_mount_props()
  expect(mount_props[prop_name]).toBe(data)
  expect(mount_props.allow_file_drop).toBe(allow_file_drop)
  expect(mount_props.fullscreen_toggle).toBe(false)
})

describe(`create_display trajectory display options`, () => {
  const trajectory_result = (): ParseResult => ({
    type: `trajectory`,
    data: trajectory_from_frames(
      [0, 1].map((step) => ({ step, structure: make_crystal(5, [[`H`, [0, 0, step / 10]]]) })),
      { provenance: { filename: `relax.h5` } },
    ),
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
    const result = trajectory_result()
    create_display(make_container(), result, {
      initial_step_idx: 42,
      on_step_change,
      on_trajectory_controller,
    })
    const mount_props = last_mount_props()
    expect(mount_props.trajectory).toBe(result.data)
    expect(mount_props.current_step_idx).toBe(42)
    expect(mount_props.on_controller).toBe(on_trajectory_controller)
    // The webview mounts the pure viewer after parsing elsewhere, so loading/file-drop
    // settings (and the never-declared enable_tips) must not reach it: Trajectory would
    // spread them onto its wrapper div as unknown HTML attributes
    for (const key of [
      `loading_options`,
      `spinner_props`,
      `index_above_bytes`,
      `atom_type_mapping`,
      `allow_file_drop`,
      `enable_tips`,
    ]) {
      expect(mount_props).not.toHaveProperty(key)
    }
    expect(mount_props.fullscreen_toggle).toBe(false)
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
    with_defaults({ scatter: { show_legend: mode }, histogram: { show_legend: mode } }, () => {
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
    })
  })

  // Regression: the webview used to forward invented keys (markers, point_size, show_grid,
  // bin_count, ...) that no plot component declares, so they were spread onto the wrapper
  // div and the corresponding VS Code settings did nothing
  test(`plot settings reach Trajectory's scatter/histogram props under their real names`, () => {
    const defaults = {
      plot: { display: { x_grid: false } },
      scatter: { point: { size: 7 }, line: { width: 4 }, symbol_type: `Square` },
      histogram: { bin_count: 12, mode: `single` },
    }
    with_defaults(defaults, () => {
      create_display(make_container(), trajectory_result())
      const { scatter_props, histogram_props } = last_mount_props() as {
        scatter_props: Record<string, Record<string, unknown>>
        histogram_props: Record<string, unknown>
      }
      expect(scatter_props.display).toMatchObject({ x_grid: false, y_grid: true })
      // symbol_type rides in styles.point, the only place ScatterPlot reads a marker shape from
      expect(scatter_props.styles.point).toMatchObject({
        size: 7,
        color: `#4A9EFF`,
        symbol_type: `Square`,
      })
      expect(scatter_props).not.toHaveProperty(`symbol_type`)
      expect(scatter_props.styles.line).toMatchObject({ width: 4 })
      expect(histogram_props).toMatchObject({ bins: 12, mode: `single`, normalize: `count` })
      expect(histogram_props.display).toMatchObject({ x_grid: false })
      for (const stale of [`markers`, `point_size`, `line_width`, `show_grid`, `bin_count`]) {
        expect(scatter_props).not.toHaveProperty(stale)
        expect(histogram_props).not.toHaveProperty(stale)
      }
    })
  })

  test(`rejects stale boolean legend settings`, () => {
    with_defaults({ scatter: { show_legend: true }, histogram: { show_legend: true } }, () => {
      expect(() => create_display(make_container(), trajectory_result())).toThrow(
        `Invalid legend visibility mode: true`,
      )
    })
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

// A file past the host's inline limit arrives as a marker instead of its bytes.
// Handling it here (rather than in the host entry point, as it used to be) is
// what lets callers that parse through this module — notably Hive's worker
// wrapper — reach the host's streaming bridge at all. Before this, a marker fell
// through to the structure parser and died with "XYZ frame too short".
describe(`LARGE_FILE markers`, () => {
  const marker = `LARGE_FILE:/data/movie.extxyz:268435456`
  const backing = trajectory_from_frames(
    [0, 1, 2].map((step) => ({
      step,
      structure: make_crystal(5, [[`H`, [0, 0, step / 10]]]),
    })),
    { provenance: { filename: `movie.extxyz`, format: `xyz` } },
  )

  // post_request listens on globalThis, a real EventTarget in the webview but
  // not in vitest's node environment.
  const with_host = (
    respond: (request: Record<string, unknown>) => Record<string, unknown>,
  ): { post_message: ReturnType<typeof vi.fn>; message_bus: EventTarget } => {
    const message_bus = new EventTarget()
    vi.stubGlobal(`addEventListener`, message_bus.addEventListener.bind(message_bus))
    vi.stubGlobal(`removeEventListener`, message_bus.removeEventListener.bind(message_bus))
    const post_message = vi.fn((request: Record<string, unknown>) => {
      queueMicrotask(() =>
        message_bus.dispatchEvent(new MessageEvent(`message`, { data: respond(request) })),
      )
    })
    vi.stubGlobal(`acquireVsCodeApi`, () => ({ postMessage: post_message }))
    return { post_message, message_bus }
  }

  // The bridge caches the host handle at import (and main.ts above already loaded it without
  // one), so take a fresh copy of the module graph after acquireVsCodeApi is in place.
  const fresh_parse = async () => {
    vi.resetModules()
    return (await import(`$lib/file-viewer/parse`)).parse_file_content
  }

  afterEach(() => vi.unstubAllGlobals())

  test(`asks the host for the file and serves frames and plot rows from it`, async () => {
    // The host keeps the indexed run and hands over only its summary; plot rows follow
    const summary = { ...summarize_run(backing), properties: { rows: [], complete: false } }
    const { post_message, message_bus } = with_host((request) =>
      request.command === `request_frame`
        ? {
            command: `frame_response`,
            request_id: request.request_id,
            frame: backing.read_frame(Number(request.frame_index)),
          }
        : {
            command: `large_file_response`,
            request_id: request.request_id,
            run_summary: summary,
          },
    )
    const result = await (await fresh_parse())(marker, `movie.extxyz`)

    expect(post_message).toHaveBeenCalledWith({
      command: `request_large_file`,
      request_id: expect.any(String),
      file_path: `/data/movie.extxyz`,
      // The host picks its per-format indexer from the name.
      filename: `movie.extxyz`,
    })
    expect(result.type).toBe(`trajectory`)
    const run = result.data as TrajectoryRun
    expect(run.frame_count).toBe(3)
    expect(run.provenance).toMatchObject({ filename: `movie.extxyz`, format: `xyz` })
    expect(run.read_frame(0)).toBe(run.preview)

    // Frames past the preview are fetched from the host one request at a time
    const frame = await run.read_frame(2)
    expect(post_message).toHaveBeenLastCalledWith({
      command: `request_frame`,
      request_id: expect.any(String),
      file_path: `/data/movie.extxyz`,
      filename: `movie.extxyz`,
      frame_index: 2,
    })
    expect(frame.step).toBe(2)
    expect(frame.structure.sites[0].xyz[2]).toBeCloseTo(1, 12)

    // Plot rows stream in after the summary, keyed by the host file path
    expect(run.properties.complete).toBe(false)
    const rows = [...backing.properties.rows]
    for (const [batch, complete, file_path] of [
      [rows.slice(0, 2), false, `/data/movie.extxyz`],
      [rows.slice(2), true, `/data/other.extxyz`], // another file's rows must not leak in
      [rows.slice(2), true, `/data/movie.extxyz`],
    ] as const) {
      message_bus.dispatchEvent(
        new MessageEvent(`message`, {
          data: { command: `plot_metadata_stream`, file_path, rows: batch, complete },
        }),
      )
    }
    await run.properties.done
    expect(run.properties.rows.map((row) => row.frame_number)).toEqual([0, 1, 2])
    run.dispose()
    await expect(Promise.resolve().then(() => run.read_frame(1))).rejects.toThrow(/disposed/)
  })

  test(`surfaces a host-side error for the file`, async () => {
    with_host((request) => ({
      command: `large_file_response`,
      request_id: request.request_id,
      error: `indexer crashed`,
    }))
    await expect((await fresh_parse())(marker, `movie.extxyz`)).rejects.toThrow(
      `indexer crashed`,
    )
  })

  test(`says so plainly when no host is listening`, async () => {
    await expect((await fresh_parse())(marker, `movie.extxyz`)).rejects.toThrow(
      /no host bridge is available/,
    )
  })

  test(`refuses formats the host cannot index`, async () => {
    const { post_message } = with_host(() => ({}))
    await expect(
      (await fresh_parse())(`LARGE_FILE:/data/charge.cube:268435456`, `charge.cube`),
    ).rejects.toThrow(`only supported for indexed trajectories`)
    expect(post_message).not.toHaveBeenCalled()
  })

  test(`a malformed marker fails instead of parsing as file content`, async () => {
    await expect(
      parse_file_content(`LARGE_FILE:/data/movie.extxyz:not-a-number`, `movie.extxyz`),
    ).rejects.toThrow(`Malformed large file marker`)
  })
})

describe(`VSCode Download Integration`, () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  // Reset modules (clears the cached vscode_api in file-viewer/main.ts), mock the VS Code
  // API, then install the download override. Returns the postMessage mock to assert on.
  const init_download = async () => {
    vi.resetModules()
    const mock_post_message = vi.fn()
    vi.stubGlobal(`acquireVsCodeApi`, () => ({
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

    const FakeFileReader = vi.fn(function (this: FileReader) {
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
    })
    vi.stubGlobal(`FileReader`, FakeFileReader)
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
