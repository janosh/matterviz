import {
  BINARY_VIEWER_EXTENSIONS,
  TEXT_VIEWER_EXTENSIONS,
  VASP_VIEWER_STEMS,
} from '$lib/constants'
import {
  is_auto_renderable_filename,
  is_matterviz_filename,
  normalize_browser_supported_filename,
  should_encode_filename_as_base64,
} from '$lib/file-viewer/eligibility'
import { expect, test } from 'vitest'

test.each([
  [`structure.cif`, true],
  [`C:\\data\\movie.traj`, true],
  [`bands.bxsf.gz`, true],
  [`density.cube.deflate`, true],
  [`CHGCAR.z`, true],
  [`vaspout.h5`, true],
  [`md_run.hdf5`, true],
  [`data.h5`, false],
  [`structure.cif.zip`, true], // fflate inflates single-file ZIPs in the webview
  [`movie.xyz.xz`, false],
  [`movie.xyz.gz.gz`, false],
  [`md/notes.log`, false],
  [`simulation/params.out`, false],
  [`relax/data.json`, false],
  [`notes.txt`, false],
  [``, false],
  [null, false],
  [undefined, false],
  [42, false],
  [true, false],
] as const)(`is_matterviz_filename(%s) returns %s`, (filename, expected) => {
  expect(is_matterviz_filename(filename)).toBe(expected)
})

test.each([
  // Obvious structure / trajectory / volumetric / Fermi
  [`structure.cif`, true],
  [`molecule.xyz`, true],
  [`atoms.extxyz.gz`, true],
  [`crystal.poscar`, true],
  [`movie.traj`, true],
  [`run.xtc`, true],
  [`POSCAR`, true],
  [`XDATCAR`, true],
  [`OUTCAR`, true],
  [`relax/OUTCAR.gz`, true],
  [`vasprun.xml`, true],
  [`run1.vasprun.xml.gz`, true],
  [`notvasprun.xml`, false],
  [`CHGCAR`, true],
  [`density.cube`, true],
  [`band.bxsf.gz`, true],
  [`vaspout.h5`, true],
  [`md_npt_300K.h5`, true],
  [`simulation.traj.h5`, true],
  // Not auto-rendered: keyword heuristics, JSON/YAML, generic data
  [`structure.json`, false],
  [`crystal.json.gz`, false],
  [`phono3py.yaml`, false],
  [`data.json.gz`, false],
  [`trajectory.dat`, false],
  [`npt.log`, false],
  [`relax.out`, false],
  [`nvt.data`, false],
  [`si_md.log`, false],
  [`data.hdf5`, false],
  [`simulation.trr`, false],
  [`README.md`, false],
  [`package.json`, false],
  [``, false],
  [null, false],
  [undefined, false],
  [42, false],
  [true, false],
] as const)(`is_auto_renderable_filename(%s) returns %s`, (filename, expected) => {
  expect(is_auto_renderable_filename(filename)).toBe(expected)
})

test.each([
  [`movie.xyz.gz`, `movie.xyz`],
  [`movie.extxyz.deflate`, `movie.extxyz`],
  [`movie.traj.z`, `movie.traj`],
  [`movie.xyz.bz2`, null],
  [`movie.xyz.gz.gz`, null],
])(`normalizes browser compression for %s`, (filename, expected) => {
  expect(normalize_browser_supported_filename(filename)).toBe(expected)
})

test.each([
  [`movie.xyz`, false],
  [`movie.traj`, true],
  [`movie.h5`, true],
  [`structure.cif.gz`, true],
])(`base64 policy for %s is %s`, (filename, expected) => {
  expect(should_encode_filename_as_base64(filename)).toBe(expected)
})

// The host vocabularies (what VS Code's package.json and JupyterLab register) and the
// predicate must never disagree: a host would otherwise offer a format the viewer cannot
// open, or hide one it gained.
test.each([...TEXT_VIEWER_EXTENSIONS, ...BINARY_VIEWER_EXTENSIONS])(
  `MatterViz can open md_run.%s`,
  (extension) => {
    expect(is_matterviz_filename(`md_run.${extension}`)).toBe(true)
  },
)

// The extensionless entries earn their place by matching a bare uppercase VASP filename.
test.each(VASP_VIEWER_STEMS.map((filename) => filename.toUpperCase()))(
  `%s opens without an extension`,
  (filename) => {
    expect(is_matterviz_filename(filename)).toBe(true)
  },
)

// Unsupported VASP outputs and run inputs only send the host to a parser that answers
// `Unable to determine file format`, so the predicate must not offer them.
test.each([`INCAR`, `KPOINTS`, `POTCAR`, `calc/INCAR`, `si_incar.txt`, `run.xml`])(
  `%s is not offered to the viewer`,
  (filename) => {
    expect(is_matterviz_filename(filename)).toBe(false)
  },
)
