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
