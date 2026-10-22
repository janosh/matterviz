import { materialize_frame_result } from '#lib/trajectory/frame.js'
import { create_display } from '#lib/file-viewer/main.js'
import { host } from '#lib/host.js'
import { parse_file_content } from '#lib/file-viewer/parse.js'
import { base64_to_array_buffer } from '#lib/utils.js'
import type { ParseResult } from '#lib/file-viewer/parse.js'
import { is_fermi_surface_data } from '#lib/fermi-surface/types.js'
import type { DownloadData } from 'svelte-widgets/download'
import { MAX_STRING_CHARS } from '#lib/io/decompress.js'
import * as trajectory_parse from '#lib/trajectory/parse/index.js'
import { parse_structure_file } from '#lib/structure/parse.js'
import type * as structure_parse_module from '#lib/structure/parse.js'
import type { TrajectoryRun } from '#lib/trajectory/index.js'
import { trajectory_from_frames } from '#lib/trajectory/runs/memory.js'
import { summarize_run } from '#lib/trajectory/run.js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { deflateSync as deflate_sync, gzipSync as gzip_sync } from 'node:zlib'
import { zipSync } from 'fflate'
import { mount } from 'svelte'
import type * as svelte_module from 'svelte'
import { afterEach, assert, describe, expect, onTestFinished, test, vi } from 'vitest'
import {
  BAD_ROW_CIF,
  cif_with_rows,
  IDENTITY_MATRIX3,
  make_crystal,
  read_binary_test_file,
  read_maybe_gz,
} from '../test-fixtures'

// Spy defaulting to the real parser so a test can return a zero-atom structure (cell-only CIF)
vi.mock('#lib/structure/parse.js', async (import_original) => {
  const original = await import_original<typeof structure_parse_module>()
  return { ...original, parse_structure_file: vi.fn(original.parse_structure_file) }
})

// Spy on mount to assert which props create_display passes to components
vi.mock('svelte', async (import_original) => ({
  ...(await import_original<typeof svelte_module>()),
  mount: vi.fn(() => ({})),
}))

declare global {
  // download function added by VSCode integration, typed as the shared contract it overrides
  var download: (content: DownloadData, filename: string, contentType: string) => void
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

// 0/1/2 bytes cover the no/two/one `=` padding classes; byte values cycle 0-255 past 256
test.each([0, 1, 2, 1024, 8192])(`base64_to_array_buffer round-trips %i bytes`, (size) => {
  const data = Uint8Array.from({ length: size }, (_, idx) => idx % 256)
  const result = base64_to_array_buffer(uint8_as_base64(data))
  expect(result).toBeInstanceOf(ArrayBuffer)
  expect(new Uint8Array(result)).toEqual(data)
})

test.each([
  [`empty cell-only CIF`, { sites: [] }, `empty.cif`, `No atoms found in empty.cif`],
  [`missing sites property`, {}, `empty.cif`, `No atoms found in empty.cif`],
  [`valid structure`, { sites: [{ species: [] }] }, `ok.cif`, null],
])(`parse_file_content structure guard: %s`, async (_label, parsed, filename, error) => {
  vi.mocked(parse_structure_file).mockReturnValueOnce(parsed as never)
  const promise = parse_file_content(`data_test`, filename)
  if (error) await expect(promise).rejects.toThrow(error)
  else expect(await promise).toMatchObject({ type: `structure`, filename })
})

const SINGULAR_MATRIX = [
  [5, 0, 0],
  [5, 0, 0],
  [0, 0, 5],
]
const SINGULAR_JSON = JSON.stringify({
  lattice: { matrix: SINGULAR_MATRIX },
  sites: [{ species: [{ element: `Si`, occu: 1 }], xyz: [0, 0, 0] }],
})

const pdb_atom = (model: number): string =>
  `MODEL        ${model}\nATOM      1  O   HOH A   1       ${model}.000   0.000   0.000  1.00  0.00           O\nENDMDL`
const optimade_json = JSON.stringify({
  data: {
    type: `structures`,
    id: `x`,
    attributes: {
      lattice_vectors: SINGULAR_MATRIX,
      cartesian_site_positions: [[0, 0, 0]],
      species_at_sites: [`Si`],
    },
  },
})
// Recoverable parser issues ride on the structure/volumetric result into the mounted viewer,
// and nothing is logged: the viewer's notice is where they are shown
// oxfmt-ignore
test.each([
  [`a CIF row with bad coordinates`, `bad.cif`, BAD_ROW_CIF, /^CIF: skipped 1 atom-site row: /],
  [`ambiguous CIF labels`, `amb.cif`, cif_with_rows(`CO1 . 0 0 0`), /ambiguous all-caps atom-site labels.*'CO1' read as Co/],
  [`a Cartesian POSCAR on a singular lattice`, `POSCAR`, `x\n1.0\n5 0 0\n5 0 0\n0 0 5\nSi\n1\nCartesian\n1 0 1`, /^POSCAR: singular lattice/],
  [`a CHGCAR with a VASP 4 header and a truncated second block`, `CHGCAR`,
    `x\n1.0\n4 0 0\n0 4 0\n0 0 4\n1\nDirect\n0 0 0\n\n2 2 2\n1 2 3 4 5 6 7 8\n2 2 2\n1 2\n`,
    [/^CHGCAR: no element symbols/, /^CHGCAR block 2 .*Keeping the intact first block only/]],
  [`a MOL query bond`, `q.mol`,
    `q\n  t\n\n  2  1  0  0  0  0  0  0  0  0999 V2000\n    0.0 0.0 0.0 C   0  0\n    1.5 0.0 0.0 C   0  0\n  1  2  8  0\nM  END\n`,
    /^MOL bond 1: query bond type 8/],
  [`a two-molecule MOL2`, `two.mol2`,
    `@<TRIPOS>MOLECULE\na\n@<TRIPOS>ATOM\n1 C1 0 0 0 C.3\n@<TRIPOS>MOLECULE\nb\n@<TRIPOS>ATOM\n1 C1 1 0 0 C.3\n`,
    /^MOL2 contains 2 molecules/],
  [`a two-model PDB`, `two.pdb`, `${pdb_atom(1)}\n${pdb_atom(2)}`, /^PDB contains 2 models/],
  [`an mmCIF without type_symbol`, `x.mmcif`,
    `data_x\nloop_\n_atom_site.group_PDB\n_atom_site.id\n_atom_site.label_atom_id\n_atom_site.Cartn_x\n_atom_site.Cartn_y\n_atom_site.Cartn_z\nATOM 1 C 0 0 0\n`,
    /^mmCIF _atom_site loop has no type_symbol column/],
  [`a LAMMPS data file without an Atoms style`, `x.lmp`,
    `LAMMPS\n\n1 atoms\n1 atom types\n\n0 5 xlo xhi\n0 5 ylo yhi\n0 5 zlo zhi\n\nMasses\n\n1 28.0855\n\nAtoms\n\n1 1 0 0 0\n`,
    /^LAMMPS data: Atoms section has no style comment/],
  [`a cube file with a ghost centre`, `x.cube`, `t\nc\n2 0 0 0\n2 1 0 0\n2 0 1 0\n2 0 0 1\n0 0 0 0 0\n6 0 1 1 1\n1 2 3 4 5 6 7 8\n`, /^\.cube atom 1: skipping Z = 0 ghost/],
  [`an OPTIMADE structure on a singular lattice`, `opt.json`, optimade_json, /^Singular OPTIMADE lattice/],
  [`a pymatgen JSON on a singular lattice`, `s.json`, SINGULAR_JSON, /^Singular JSON lattice/],
])(
  `parse warnings of %s land on the result and the viewer`,
  async (_label, filename, content, warnings) => {
    const warn_spy = vi.spyOn(console, `warn`)
    onTestFinished(() => warn_spy.mockRestore())
    const result = await parse_file_content(content, filename)
    assert(
      result.type === `structure` || result.type === `isosurface`,
      `expected a structure or volume, got ${result.type}`,
    )
    expect(result.warnings).toEqual([warnings].flat().map((re) => expect.stringMatching(re)))
    expect(warn_spy).not.toHaveBeenCalled()
    create_display(make_container(), result)
    expect(last_mount_props().parse_warnings).toBe(result.warnings)
  },
)

// A JSON trajectory's frames are read by the structure parser, whose warnings land on the run
test(`structure warnings of JSON trajectory frames land on the run`, async () => {
  const warn_spy = vi.spyOn(console, `warn`).mockImplementation(() => {})
  onTestFinished(() => warn_spy.mockRestore())
  const frame = JSON.parse(SINGULAR_JSON)
  const content = JSON.stringify({ frames: [frame, frame] })
  const result = await parse_file_content(content, `run.json`)
  assert(result.type === `trajectory`, `expected a trajectory, got ${result.type}`)
  expect(result.data.warnings).toEqual([
    expect.stringMatching(/^Singular JSON lattice/),
    expect.stringMatching(/^Singular JSON lattice/),
  ])
})

// A VASP volumetric name over POSCAR content (POSCAR_from_CHGCAR) still opens the structure
test.each([`POSCAR`, `POSCAR_from_CHGCAR`])(
  `parses POSCAR content named %s as a structure through the worker-safe entry`,
  async (filename) => {
    const poscar = `Si2\n1.0\n5.43 0 0\n0 5.43 0\n0 0 5.43\nSi\n2\ndirect\n0 0 0 Si\n0.25 0.25 0.25 Si\n`
    const result = await parse_file_content(poscar, filename)
    expect(result.type).toBe(`structure`)
    expect((result.data as { sites: unknown[] }).sites).toHaveLength(2)
  },
)

// Content, not the name, decides the kind: names used to drop frames or grids or misroute files
test.each([
  [`mdanalysis-chain-dump.lammpstrj`, `md.dump`, `trajectory`],
  [`vasp-XDATCAR-traj.gz`, `Si_run`, `trajectory`],
  [`vasp-XDATCAR-traj.gz`, `runs/build/XDATCAR`, `trajectory`],
  [`pymatgen-LiMnO2-chgnet-relax.json.gz`, `run1.json`, `trajectory`],
  [`Si-CHGCAR.gz`, `CHG`, `isosurface`],
  [`Si-CHGCAR.gz`, `Si.vasp`, `isosurface`],
  [`TiO2.cif`, `chgcar_structure.cif`, `structure`],
  [`TiO2.cif`, `outcar/Si.cif`, `structure`],
])(`%s named %s opens as %s`, async (fixture, filename, expected) => {
  const folder = fixture.includes(`CHGCAR`)
    ? `isosurfaces`
    : fixture.endsWith(`.cif`)
      ? `structures`
      : `trajectories`
  const content = read_maybe_gz(`src/site/${folder}/${fixture}`)
  expect((await parse_file_content(content, filename)).type).toBe(expected)
})

test(`multi-frame XYZ text opens as a trajectory run`, async () => {
  const hydrogen_frame = (step: number, delta_z: number): string =>
    `2\nstep=${step}\nH 0 0 0\nH 0 0 ${delta_z}`
  const result = await parse_file_content(
    `${hydrogen_frame(0, 0.74)}\n${hydrogen_frame(1, 0.78)}`,
    `h2.xyz`,
  )
  expect(result.type).toBe(`trajectory`)
  const run = result.data as TrajectoryRun
  expect(run.frame_count).toBe(2)
  expect(run.provenance).toMatchObject({ filename: `h2.xyz`, format: `xyz` })
  expect((await materialize_frame_result(run.read_frame(1))).step).toBe(1)
  run.dispose()
})

// Text past one JS string reaches only the chunked trajectory reader, never a string decode
test(`routes a byte payload past the string limit to the trajectory reader`, async () => {
  const blob = new Blob([`data_big`])
  Object.defineProperty(blob, `size`, { value: MAX_STRING_CHARS + 1 })
  const decode = vi.spyOn(blob, `text`)
  const open = vi
    .spyOn(trajectory_parse, `open_trajectory`)
    .mockRejectedValue(new Error(`trajectory reader reached`))
  onTestFinished(() => open.mockRestore())
  await expect(parse_file_content(blob, `big.cif`)).rejects.toThrow(
    `trajectory reader reached`,
  )
  expect(open).toHaveBeenCalledWith(blob, expect.objectContaining({ filename: `big.cif` }))
  expect(decode).not.toHaveBeenCalled()
})

// The host's atom_type_mapping (JSON string keys) names LAMMPS types instead of guessed Z
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
])(`rejects %s with %s`, async (filename, message) => {
  await expect(parse_file_content(btoa(`content`), filename, true)).rejects.toThrow(message)
})

test.each([`plain`, `zip`, `gzip/gzip`, `zip/gzip`] as const)(
  `base64 %s payloads route by their decoded contents and inner name`,
  async (compression) => {
    const content = { label: `café`, values: [1, 2] }
    let bytes: Uint8Array<ArrayBuffer> = new TextEncoder().encode(JSON.stringify(content))
    let filename = `settings.json`
    for (const layer of compression.split(`/`).toReversed()) {
      if (layer === `zip`) {
        bytes = zipSync({ [filename]: bytes })
        filename = `bundle.zip`
      } else if (layer === `gzip`) {
        bytes = new Uint8Array(gzip_sync(bytes))
        filename += `.gz`
      }
    }
    expect(await parse_file_content(uint8_as_base64(bytes), filename, true)).toEqual({
      type: `json_browser`,
      data: content,
      filename: `settings.json`,
    })
  },
)

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
      // oxfmt-ignore
      1: [{ vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 2]], band_idx: 1 }],
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

// The site-less structure wrapping volumetric JSON carried a bare 3x3 `lattice`, crashing StructureScene
test.each([true, false])(
  `parse_file_content wraps volumetric JSON (periodic=%s) in a structure with a full lattice`,
  async (periodic) => {
    // oxfmt-ignore
    const matrix = [[4, 0, 0], [0, 5, 0], [0, 0, 6]]
    const values = Array.from({ length: 8 }, (_, idx) => idx)
    const volumetric = { id: `density`, lattice: matrix, origin: [0, 0, 0], periodic, values }
    const json = JSON.stringify({ ...volumetric, dims: [2, 2, 2] })
    const result = await parse_file_content(json, `density.json`)
    const pbc = [periodic, periodic, periodic]
    const lattice = { matrix, a: 4, b: 5, c: 6, volume: 120, pbc }
    expect(result).toMatchObject({
      type: `isosurface`,
      data: { structure: { sites: [], lattice } },
    })
    const { volumes } = result.data as { volumes: { lattice: number[][]; dims: number[] }[] }
    expect(volumes).toHaveLength(1)
    expect(volumes[0]).toMatchObject({ lattice: matrix, dims: [2, 2, 2] })
  },
)

describe(`vaspout.h5 electronic routing`, () => {
  // Only routing and the mount contract; parsed content is in trajectory/vaspout-h5.test.ts
  test(`bands-only vaspout.h5 routes to vaspout_electronic and mounts electronic bands`, async () => {
    const base64 = fixture_base64(`vaspout-tinisn-bands-only.h5`)
    const result = await parse_file_content(base64, `vaspout.h5`, true)
    expect(result.type).toBe(`vaspout_electronic`)
    const data = result.data as { dos: unknown; bands: unknown }
    expect(data.dos).toBeNull()
    expect(data.bands).toMatchObject({ type: `electronic` })
    create_display(make_container(), result)
    expect(last_mount_props().band_structs).toEqual({ '': data.bands })
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

  // The inner filename drives routing after binary decompression
  test.each([
    [`vaspout-tinisn-bands-only.h5`, `vaspout.h5.gz`, `vaspout_electronic`],
    [`vaspwave-si-charge.h5`, `vaspwave.h5.gz`, `isosurface`],
  ])(`gzipped %s routes as %s`, async (fixture_name, gz_filename, expected_type) => {
    const gz_base64 = fixture_base64(fixture_name, true)
    const result = await parse_file_content(gz_base64, gz_filename, true)
    expect(result.type).toBe(expected_type)
    expect(result.filename).toBe(gz_filename.replace(/\.gz$/, ``))
  })

  // ULM .traj bytes are not UTF-8, so a successful open proves no text decode corrupted them
  test.each([
    [`.gz`, gzip_sync],
    [`.deflate`, deflate_sync],
    [`.zip`, (data: Uint8Array) => zipSync({ [`relax.traj`]: data })],
    [`.traj.zip`, (data: Uint8Array) => zipSync({ [`relax.traj.gz`]: gzip_sync(data) })],
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
  // Minimal stubs: asserts which prop receives the data, not that the payload is well-formed
  create_display(make_container(), { type, data, filename: `test.json` } as ParseResult)
  const mount_props = last_mount_props()
  expect(mount_props[prop_name]).toBe(data)
  expect(mount_props.allow_file_drop).toBe(allow_file_drop)
  // the viewer's own toggle stays, gated by host.fullscreen
  expect(mount_props).not.toHaveProperty(`fullscreen_toggle`)
  expect(host.wheel_zoom).toBe(`always`) // a viewer filling the tab has no page to scroll
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

  // Non-VS Code hosts leave --vscode-* unset; a dark hex fallback blackened light-mode shells
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
    // The host owns parsing and drops; the viewer borrows its already-opened run.
    expect(mount_props.allow_file_drop).toBe(false)
    for (const key of [
      `loading_options`,
      `spinner_props`,
      `index_above_bytes`,
      `atom_type_mapping`,
      `enable_tips`,
    ]) {
      expect(mount_props).not.toHaveProperty(key)
    }
    // the settings default, gated by host.fullscreen
    expect(mount_props.fullscreen_toggle).toBe(true)
    // create_display adapts Trajectory's TrajHandlerData callback to (step_idx, total)
    ;(mount_props.on_step_change as (data: unknown) => void)({ step_idx: 7, frame_count: 20 })
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

  // Invented keys (markers, show_grid, bin_count, ...) used to land on the wrapper div unread
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

// A file past the host's inline limit arrives as a marker; it once fell through to the
// structure parser and died with "XYZ frame too short"
describe(`LARGE_FILE markers`, () => {
  const marker = `LARGE_FILE:/data/movie.extxyz:268435456`
  const backing = trajectory_from_frames(
    [0, 1, 2].map((step) => ({
      step,
      structure: make_crystal(5, [[`H`, [0, 0, step / 10]]]),
    })),
    { provenance: { filename: `movie.extxyz`, format: `xyz` } },
  )
  // The host's answer to request_large_file: the run summary with plot rows still streaming
  const summary_reply = (request: Record<string, unknown>): Record<string, unknown> => ({
    command: `large_file_response`,
    request_id: request.request_id,
    run_summary: { ...summarize_run(backing), properties: { rows: [], complete: false } },
  })

  // post_request listens on globalThis, not an EventTarget in vitest's node environment
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

  // The bridge caches the host handle at import, so re-import after stubbing acquireVsCodeApi
  const fresh_parse = async () => {
    vi.resetModules()
    return (await import(`#lib/file-viewer/parse.js`)).parse_file_content
  }

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  test(`asks the host for the file and serves frames and plot rows from it`, async () => {
    const { post_message, message_bus } = with_host((request) =>
      request.command === `request_frame`
        ? {
            command: `frame_response`,
            request_id: request.request_id,
            frame: materialize_frame_result(backing.read_frame(Number(request.frame_index))),
          }
        : summary_reply(request),
    )
    const result = await (await fresh_parse())(marker, `movie.extxyz`)

    expect(post_message).toHaveBeenCalledWith({
      command: `request_large_file`,
      request_id: expect.any(String),
      file_path: `/data/movie.extxyz`,
      filename: `movie.extxyz`, // the host picks its indexer by name
    })
    expect(result.type).toBe(`trajectory`)
    const run = result.data as TrajectoryRun
    expect(run.frame_count).toBe(3)
    expect(run.provenance).toMatchObject({ filename: `movie.extxyz`, format: `xyz` })
    expect(materialize_frame_result(run.read_frame(0))).toEqual(run.preview)

    // Frames past the preview are fetched from the host one request at a time
    const frame = await materialize_frame_result(run.read_frame(2))
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
    await expect(
      Promise.resolve().then(() => materialize_frame_result(run.read_frame(1))),
    ).rejects.toThrow(/disposed/)
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

  test.each([`batch`, `completion`, `both`] as const)(
    `finishes host metadata and detaches its listener after %s subscriber failures`,
    async (phase) => {
      with_host(summary_reply)
      const add_listener = vi.spyOn(globalThis, `addEventListener`)
      const remove_listener = vi.spyOn(globalThis, `removeEventListener`)
      const result = await (await fresh_parse())(marker, `movie.extxyz`)
      if (result.type !== `trajectory`) throw new Error(`Expected a host trajectory`)
      const { properties } = result.data
      const failures = {
        batch: new Error(`Batch observer failed`),
        completion: new Error(`Completion observer failed`),
      }
      properties.subscribe((_batch, complete) => {
        const event_phase = complete ? `completion` : `batch`
        if (phase === `both` || phase === event_phase) throw failures[event_phase]
      })
      const observer = vi.fn()
      properties.subscribe(observer)
      const handler = add_listener.mock.calls.at(-1)?.[1]
      if (typeof handler !== `function`) throw new Error(`Missing host metadata listener`)
      const notify = vi.fn(() =>
        handler.call(
          globalThis,
          new MessageEvent(`message`, {
            data: {
              command: `plot_metadata_stream`,
              file_path: `/data/movie.extxyz`,
              rows: backing.properties.rows,
              complete: true,
            },
          }),
        ),
      )
      // Invoke directly to inspect errors normally reported by the browser's event loop.
      expect(notify).toThrow(Error)
      const error: unknown = notify.mock.results[0].value
      if (phase === `both`) {
        expect(error).toBeInstanceOf(AggregateError)
        expect(error).toHaveProperty(`errors`, Object.values(failures))
      } else expect(error).toBe(failures[phase])
      expect(properties.complete).toBe(true)
      await properties.done
      expect(properties.rows).toEqual(backing.properties.rows)
      expect(observer.mock.calls).toEqual([
        [backing.properties.rows, false],
        [[], true],
      ])
      expect(remove_listener).toHaveBeenCalledWith(`message`, handler)
      result.data.dispose()
    },
  )

  test.each([
    [{ command: `frame_response` }, `Host returned no trajectory frame 3`],
    [{}, `Frame 3 timeout after 10s`], // host never answers
  ])(`frame reply %j rejects with "%s" (1-based)`, async (frame_reply, msg) => {
    with_host((request) =>
      request.command === `request_frame`
        ? { ...frame_reply, request_id: request.request_id }
        : summary_reply(request),
    )
    vi.useFakeTimers({ toFake: [`setTimeout`, `clearTimeout`] })
    const result = await (await fresh_parse())(marker, `movie.extxyz`)
    if (result.type !== `trajectory`) throw new Error(`Expected a host trajectory`)
    const error = Promise.resolve()
      .then(() => materialize_frame_result(result.data.read_frame(2)))
      .catch((exc: unknown) => exc)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await error).toEqual(new Error(msg))
    result.data.dispose()
  })

  test.each([`send`, `response`])(`cleans up a host request when %s throws`, async (phase) => {
    const { post_message } = with_host((request) => ({
      command: `large_file_response`,
      request_id: request.request_id,
      run_summary: {},
    }))
    const parse = await fresh_parse()
    const add_listener = vi.spyOn(globalThis, `addEventListener`)
    const remove_listener = vi.spyOn(globalThis, `removeEventListener`)
    vi.useFakeTimers({ toFake: [`setTimeout`, `clearTimeout`] })
    if (phase === `send`)
      post_message.mockImplementationOnce(() => {
        throw new TypeError(`Host transport failed`)
      })
    await expect(parse(marker, `movie.extxyz`)).rejects.toThrow(TypeError)
    const handler = add_listener.mock.calls.at(-1)?.[1]
    expect(typeof handler).toBe(`function`)
    expect(remove_listener).toHaveBeenCalledWith(`message`, handler)
    expect(vi.getTimerCount()).toBe(0)
  })

  test.each([
    [false, marker, `movie.extxyz`, `no host bridge is available`],
    [
      true,
      `LARGE_FILE:/data/charge.cube:1`,
      `charge.cube`,
      `only supported for indexed trajectories`,
    ],
    [
      true,
      `LARGE_FILE:/data/movie.extxyz:not-a-number`,
      `movie.extxyz`,
      `Malformed large file marker`,
    ],
  ])(
    `host=%s: rejects %s without a host request`,
    async (has_host, content, filename, msg) => {
      const post_message = has_host && with_host(() => ({})).post_message
      await expect((await fresh_parse())(content, filename)).rejects.toThrow(msg)
      if (post_message) expect(post_message).not.toHaveBeenCalled()
    },
  )
})

describe(`VSCode Download Integration`, () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  // Fresh module graph (drops the cached vscode_api), stubbed API, download override installed
  const init_download = async () => {
    vi.resetModules()
    const mock_post_message = vi.fn()
    vi.stubGlobal(`acquireVsCodeApi`, () => ({
      postMessage: mock_post_message,
      setState: vi.fn(),
      getState: vi.fn(),
    }))
    const { setup_vscode_download } = await import(`#lib/file-viewer/main.js`)
    setup_vscode_download()
    return mock_post_message
  }

  test(`sets up global download override when VSCode API is available`, async () => {
    const mock_post_message = await init_download()
    globalThis.download(`test content`, `test.json`, `application/json`)
    expect(mock_post_message).toHaveBeenCalledWith({
      command: `saveAs`,
      content: `test content`,
      filename: `test.json`,
      is_binary: false,
    })
  })

  // Timer-driven FileReader stub firing `outcome`'s listener; `load` encodes the real Blob
  const stub_file_reader = (outcome: `load` | `error`) => {
    vi.useFakeTimers()
    const FakeFileReader = vi.fn(function (this: FileReader) {
      // Per instance so overlapping downloads don't clobber each other's result
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

  // STL/GLB exports pass an ArrayBuffer or view, which readAsDataURL (Blob-only) used to reject
  test.each([
    [`a Blob`, () => new Blob([`fake stl data`], { type: `model/stl` })],
    [`an ArrayBuffer`, () => new TextEncoder().encode(`fake stl data`).buffer],
    [`a typed-array view`, () => new TextEncoder().encode(`fake stl data`)],
  ])(`saves %s as base64 binary`, async (_case, make_data) => {
    stub_file_reader(`load`)
    const mock_post_message = await init_download()
    globalThis.download(make_data(), `structure.stl`, `model/stl`)
    await vi.runAllTimersAsync()
    expect(mock_post_message).toHaveBeenCalledWith({
      command: `saveAs`,
      content: `data:model/stl;base64,ZmFrZSBzdGwgZGF0YQ==`,
      filename: `structure.stl`,
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
