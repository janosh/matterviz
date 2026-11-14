import {
  format_large_file_marker,
  parse_large_file_marker,
  plan_host_file_transfer,
} from '#lib/file-viewer/host-transfer.js'
import { expect, test } from 'vite-plus/test'

const plan = (filename: string, file_size: number) =>
  plan_host_file_transfer({
    filename,
    file_path: `C:\\data\\${filename}`,
    file_size,
    large_file_threshold: 100,
    max_file_size: 1000,
  })

// `marker` stands for the planned file's own large-file marker
test.each([
  [`movie.xyz`, 100, { kind: `inline`, is_base64: false }],
  [`movie.traj`, 100, { kind: `inline`, is_base64: true }],
  [`movie.extxyz.gz`, 500, `marker`],
  // text trajectories decode in chunks, so they share the binary size cap
  [`movie.extxyz`, 1000, `marker`],
  [`movie.extxyz`, 1001, { kind: `reject`, reason: `file-too-large`, max_file_size: 1000 }],
  [`movie.traj`, 1000, `marker`],
  [`movie.traj`, 1001, { kind: `reject`, reason: `file-too-large`, max_file_size: 1000 }],
  [`movie.h5`, 101, { kind: `reject`, reason: `unsupported-large-format` }],
  // Large LAMMPS dumps and XDATCARs are indexed text trajectories too
  [`md.lammpstrj`, 500, `marker`],
  [`XDATCAR`, 200, `marker`],
  [`XDATCAR_nvt.gz`, 200, `marker`],
  [`movie.xyz.zip`, 101, { kind: `reject`, reason: `unsupported-compression` }],
  [`movie.xyz.gz.gz`, 101, `marker`],
  [`movie.xyz.xz.gz`, 101, { kind: `reject`, reason: `unsupported-compression` }],
] as const)(`plans %s at %d bytes`, (filename, file_size, expected) => {
  const marker = { kind: `marker`, content: `LARGE_FILE:C:\\data\\${filename}:${file_size}` }
  expect(plan(filename, file_size)).toEqual(expected === `marker` ? marker : expected)
})

test.each([
  [`LARGE_FILE:/tmp/movie.traj:536870912`, `/tmp/movie.traj`],
  [`LARGE_FILE:/tmp/movie\npart.traj:536870912`, `/tmp/movie\npart.traj`],
  [`LARGE_FILE:C:\\Users\\janosh\\movie.traj:536870912`, `C:\\Users\\janosh\\movie.traj`],
])(`round-trips marker %s`, (marker, file_path) => {
  const parsed = parse_large_file_marker(marker)
  expect(parsed).toEqual({ file_path, file_size: 536_870_912 })
  expect(parsed && format_large_file_marker(parsed)).toBe(marker)
})

test(`ignores non-markers`, () => {
  expect(parse_large_file_marker(`not-large`)).toBeNull()
})

test.each([
  { file_path: ``, file_size: 1 },
  { file_path: `/tmp/file`, file_size: -1 },
  { file_path: `/tmp/file`, file_size: Number.MAX_SAFE_INTEGER + 1 },
])(`rejects invalid marker data $file_path:$file_size`, (marker) => {
  expect(() => format_large_file_marker(marker)).toThrow(`Invalid large file marker data`)
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
