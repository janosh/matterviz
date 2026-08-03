import { VASP_STRUCTURE_FILES, VASP_VOLUMETRIC_FILES } from '$lib/constants'
import {
  is_auto_renderable_filename,
  is_matterviz_filename,
  MATTERVIZ_FILE_EXTENSIONS,
  normalize_browser_supported_filename,
  should_encode_filename_as_base64,
} from '$lib/file-viewer/eligibility'
import { expect, test } from 'vitest'

const vasp_filenames = [`xdatcar`, ...VASP_STRUCTURE_FILES, ...VASP_VOLUMETRIC_FILES]

test.each([
  [`structure.cif`, true],
  [`C:\\data\\movie.traj`, true],
  [`bands.bxsf.gz`, true],
  [`density.cube.deflate`, true],
  [`CHGCAR.z`, true],
  [`vaspout.h5`, true],
  [`md_run.hdf5`, true],
  [`data.h5`, false],
  [`structure.cif.zip`, false],
  [`movie.xyz.xz`, false],
  [`movie.xyz.gz.gz`, false],
  [`md/notes.log`, false],
  [`simulation/params.out`, false],
  [`relax/data.json`, false],
  [`notes.txt`, false],
  [``, false],
  [null, false],
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

// The literal list and the predicate must never disagree: a host that filters an open
// dialog by the list would silently hide a format the viewer gained, or offer one it
// cannot open.
test.each(MATTERVIZ_FILE_EXTENSIONS)(`MatterViz can open md_run.%s`, (extension) => {
  expect(is_matterviz_filename(`md_run.${extension}`)).toBe(true)
})

// The extensionless entries earn their place by matching a bare uppercase VASP filename.
test.each(vasp_filenames.map((filename) => filename.toUpperCase()))(
  `%s opens without an extension`,
  (filename) => {
    expect(is_matterviz_filename(filename)).toBe(true)
  },
)

// Unsupported VASP outputs and run inputs only send the host to a parser that answers
// `Unable to determine file format`, so the predicate must not offer them.
test.each([`OUTCAR`, `INCAR`, `KPOINTS`, `POTCAR`, `calc/INCAR`, `si_incar.txt`])(
  `%s is not offered to the viewer`,
  (filename) => {
    expect(is_matterviz_filename(filename)).toBe(false)
  },
)

test(`extension list matches the explicit host allowlist`, () => {
  // oxfmt-ignore
  const expected_extensions = [
    `cif`, `mcif`, `poscar`, `vasp`, `cube`, `lmp`, `data`, `dump`, `pdb`, `mol`, `mol2`,
    `sdf`, `mmcif`, `traj`, `xtc`, `lammpstrj`, `xyz`, `extxyz`, `bxsf`, `frmsf`,
    `xdatcar`, `contcar`, `chgcar`, `aeccar`, `aeccar0`, `aeccar1`, `aeccar2`, `elfcar`,
    `locpot`, `parchg`,
  ]
  expect(MATTERVIZ_FILE_EXTENSIONS).toEqual(expected_extensions)
  // JSON/YAML open only with a structure keyword in the name, so a blanket entry would
  // claim every unrelated .json a host offers. Hosts that want them add their own.
  expect(MATTERVIZ_FILE_EXTENSIONS).not.toContain(`json`)
  expect(MATTERVIZ_FILE_EXTENSIONS).not.toContain(`yaml`)
})
