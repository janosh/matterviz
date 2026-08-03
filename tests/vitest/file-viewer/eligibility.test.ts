import { VASP_STRUCTURE_FILES_REGEX, XYZ_EXTXYZ_REGEX } from '$lib/constants'
import {
  is_auto_renderable_filename,
  is_matterviz_filename,
  MATTERVIZ_FILE_EXTENSIONS,
  normalize_browser_supported_filename,
  should_encode_filename_as_base64,
} from '$lib/file-viewer/eligibility'
import { FERMI_FILE_RE, VOLUMETRIC_EXT_RE, VOLUMETRIC_VASP_RE } from '$lib/file-viewer/types'
import { expect, test } from 'vitest'

test.each([
  [`structure.cif`, true],
  [`C:\\data\\movie.traj`, true],
  [`bands.bxsf.gz`, true],
  [`density.cube.deflate`, true],
  [`CHGCAR.z`, true],
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
// cannot open. `md_run.` supplies the trajectory keyword .h5/.hdf5 need.
test.each(MATTERVIZ_FILE_EXTENSIONS)(`MatterViz can open md_run.%s`, (extension) => {
  expect(is_matterviz_filename(`md_run.${extension}`)).toBe(true)
})

// The extensionless entries earn their place by matching a bare uppercase VASP filename.
test.each([`XDATCAR`, `CONTCAR`, `OUTCAR`, `CHGCAR`, `AECCAR2`, `ELFCAR`, `LOCPOT`, `PARCHG`])(
  `%s opens without an extension`,
  (filename) => {
    expect(is_matterviz_filename(filename)).toBe(true)
  },
)

// VASP run inputs hold no coordinates. Claiming them only sends the host to a parser that
// answers `Unable to determine file format`, so the predicate must not offer them.
test.each([`INCAR`, `KPOINTS`, `POTCAR`, `calc/INCAR`, `si_incar.txt`])(
  `%s is not offered to the viewer`,
  (filename) => {
    expect(is_matterviz_filename(filename)).toBe(false)
  },
)

// The reverse direction: widening a regex the predicate matches on must not silently
// leave a host's open dialog behind. STRUCTURE_EXTENSIONS and TRAJ_EXTENSIONS are spread
// into the list directly, so only the regex-backed names need checking here. Two shapes
// occur: `\.(?:a|b)$` for extensions and `(?:^|[\/_.-])(?:a|b)(?:[\/_.-]|$)` for the bare
// VASP filenames. `aeccar[012]?` stands for four names, so expand the optional class.
const OPTIONAL_CLASS_RE = /^(?<stem>[a-z0-9]+)\[(?<chars>[a-z0-9]+)\]\?$/

const regex_alternatives = (regex: RegExp): string[] =>
  regex.source
    .replace(`(?:^|[\\\\/_.-])`, ``)
    .replace(`(?:[\\\\/_.-]|$)`, ``)
    .replace(/^\\\./, ``)
    .replace(/^\(\?:/, ``)
    .replace(/\$$/, ``)
    .replace(/\)$/, ``)
    .split(`|`)
    .flatMap((alternative) => {
      const groups = OPTIONAL_CLASS_RE.exec(alternative)?.groups
      if (!groups) return [alternative]
      const { stem, chars } = groups
      return [stem, ...chars.split(``).map((char) => `${stem}${char}`)]
    })

test.each([
  [`FERMI_FILE_RE`, FERMI_FILE_RE],
  [`XYZ_EXTXYZ_REGEX`, XYZ_EXTXYZ_REGEX],
  [`VOLUMETRIC_EXT_RE`, VOLUMETRIC_EXT_RE],
  [`VOLUMETRIC_VASP_RE`, VOLUMETRIC_VASP_RE],
  [`VASP_STRUCTURE_FILES_REGEX`, VASP_STRUCTURE_FILES_REGEX],
])(`every name %s matches is listed`, (_label, regex) => {
  const names = regex_alternatives(regex)
  expect(names.every((name) => /^[a-z0-9]+$/.test(name))).toBe(true) // extraction worked
  expect(MATTERVIZ_FILE_EXTENSIONS).toEqual(expect.arrayContaining(names))
})

test(`extension list covers every structure/trajectory/volumetric/Fermi format`, () => {
  expect([...MATTERVIZ_FILE_EXTENSIONS].toSorted()).toEqual([
    `aeccar`,
    `aeccar0`,
    `aeccar1`,
    `aeccar2`,
    `bxsf`,
    `chgcar`,
    `cif`,
    `contcar`,
    `cube`,
    `data`,
    `dump`,
    `elfcar`,
    `extxyz`,
    `frmsf`,
    `h5`,
    `hdf5`,
    `lammpstrj`,
    `lmp`,
    `locpot`,
    `mcif`,
    `mmcif`,
    `mol`,
    `mol2`,
    `outcar`,
    `parchg`,
    `pdb`,
    `poscar`,
    `sdf`,
    `traj`,
    `vasp`,
    `xdatcar`,
    `xtc`,
    `xyz`,
  ])
  // JSON/YAML open only with a structure keyword in the name, so a blanket entry would
  // claim every unrelated .json a host offers. Hosts that want them add their own.
  expect(MATTERVIZ_FILE_EXTENSIONS).not.toContain(`json`)
  expect(MATTERVIZ_FILE_EXTENSIONS).not.toContain(`yaml`)
})
