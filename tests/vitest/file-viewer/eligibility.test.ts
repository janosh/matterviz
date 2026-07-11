import {
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
