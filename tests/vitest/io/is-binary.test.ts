import {
  BINARY_EXTENSIONS,
  ext_of,
  has_binary_inner_ext,
  has_binary_magic,
  has_gzip_magic,
  has_hdf5_magic,
  is_binary,
  is_binary_payload,
  is_known_text_file,
  strip_gz_ext,
} from '$lib/io/is-binary'
import { describe, expect, test } from 'vitest'

const bytes = (...nums: number[]): Uint8Array => new Uint8Array(nums)
const to_buffer = (nums: number[]): ArrayBuffer => {
  const buffer = new ArrayBuffer(nums.length)
  new Uint8Array(buffer).set(nums)
  return buffer
}

// magic-byte signatures reused across cases
const GZIP = [0x1f, 0x8b]
const HDF5_FULL = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]
const HDF5_PREFIX = [0x89, 0x48, 0x44, 0x46]
const ZIP_LOCAL = [0x50, 0x4b, 0x03, 0x04]
const ASE_ULM = [0x2d, 0x20, 0x6f, 0x66, 0x20, 0x55, 0x6c, 0x6d]

describe(`is_binary (string heuristic)`, () => {
  test.each([
    [`empty string`, ``, false],
    [`plain ascii text`, `H 0 0 0\nO 1 1 1`, false],
    [`contains NUL byte`, `abc\0def`, true],
    [`mostly non-printable bytes`, `\u00FF`.repeat(20), true],
    // 20% high bytes but 80% printable -> only the binary-char-ratio (>0.1) clause fires
    [`high-byte-ratio clause alone`, `\u00FF\u00FFabcdefgh`, true],
    // control chars (no high bytes) drop printable below 70% -> only the printable clause fires
    [`printable-ratio clause alone`, `${`\t`.repeat(8)}ab`, true],
  ])(`%s -> %s`, (_desc, content, expected) => {
    expect(is_binary(content)).toBe(expected)
  })
})

describe(`magic-byte detection`, () => {
  test.each([
    [`gzip header`, GZIP, true],
    [`not gzip`, [0x1f, 0x8c], false],
    [`too short`, [0x1f], false],
  ])(`has_gzip_magic: %s -> %s`, (_desc, sig, expected) => {
    expect(has_gzip_magic(bytes(...sig))).toBe(expected)
  })

  // strict 8-byte superblock — used only to validate a named .h5 really is HDF5
  test.each([
    [`full 8-byte superblock`, HDF5_FULL, true],
    [`4-byte prefix is NOT enough`, HDF5_PREFIX, false],
    [`wrong bytes`, [0x89, 0x48, 0x44, 0x46, 0, 0, 0, 0], false],
  ])(`has_hdf5_magic: %s -> %s`, (_desc, sig, expected) => {
    expect(has_hdf5_magic(bytes(...sig))).toBe(expected)
  })

  test.each([
    [`gzip`, GZIP, true],
    [`HDF5 4-byte prefix (loose sniff)`, HDF5_PREFIX, true],
    [`ZIP local file`, ZIP_LOCAL, true],
    [`ZIP empty archive (EOCD)`, [0x50, 0x4b, 0x05, 0x06], true],
    [`ZIP spanned`, [0x50, 0x4b, 0x07, 0x08], true],
    [`ASE .traj "- of Ulm"`, ASE_ULM, true],
    // tightened matching: a leading "PK" alone is not a real ZIP signature
    [`"PK-" plastic, not ZIP`, [0x50, 0x4b, 0x2d, 0x31], false],
    [`plain ascii`, [0x48, 0x20, 0x30], false],
    [`empty`, [], false],
  ])(`has_binary_magic: %s -> %s`, (_desc, sig, expected) => {
    expect(has_binary_magic(bytes(...sig))).toBe(expected)
  })
})

describe(`extension / filename classification`, () => {
  test.each([
    [`foo.XYZ`, `xyz`], // lowercased
    [`a.b.gz`, `gz`], // last segment only
    [`POSCAR`, `poscar`], // extensionless -> whole basename lowercased
    [``, ``],
  ])(`ext_of(%s) -> %s`, (name, expected) => {
    expect(ext_of(name)).toBe(expected)
  })

  test.each([
    [`structure.xyz`, true],
    [`config.json`, true],
    [`POSCAR`, true], // VASP basename without extension
    [`XDATCAR`, true],
    [`contcar`, true],
    [`run.h5`, false],
    [`blob-uuid`, false],
  ])(`is_known_text_file(%s) -> %s`, (name, expected) => {
    expect(is_known_text_file(name)).toBe(expected)
  })

  test.each([
    [`a.h5.gz`, `a.h5`],
    [`a.json.gzip`, `a.json`],
    [`a.json`, `a.json`], // no wrapper -> unchanged
  ])(`strip_gz_ext(%s) -> %s`, (name, expected) => {
    expect(strip_gz_ext(name)).toBe(expected)
  })

  test.each([
    [`traj.h5.gz`, true],
    [`archive.zip.gz`, true], // zip is a binary wrapper
    [`data.json.gz`, false],
    [`notes.txt.gz`, false],
  ])(`has_binary_inner_ext(%s) -> %s`, (name, expected) => {
    expect(has_binary_inner_ext(name)).toBe(expected)
  })

  test.each([`h5`, `traj`, `npz`, `gz`, `zip`])(`BINARY_EXTENSIONS includes %s`, (ext) =>
    expect(BINARY_EXTENSIONS.has(ext)).toBe(true),
  )
  test.each([`xyz`, `json`, `cif`])(`BINARY_EXTENSIONS excludes %s`, (ext) =>
    expect(BINARY_EXTENSIONS.has(ext)).toBe(false),
  )
})

describe(`is_binary_payload (extension or magic bytes)`, () => {
  test.each([
    [`binary extension`, `run.h5`, [0x48, 0x49], true], // ext wins regardless of bytes
    [`magic bytes, no binary ext`, `payload.dump`, HDF5_PREFIX, true],
    [`text ext, text bytes`, `data.csv`, [0x48, 0x49], false],
    [`unknown ext, text bytes`, `payload.dump`, [0x48, 0x49], false],
  ])(`%s -> %s`, (_desc, filename, byte_seq, expected) => {
    expect(is_binary_payload(filename, to_buffer(byte_seq))).toBe(expected)
  })
})
