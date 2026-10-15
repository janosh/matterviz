import {
  ext_of,
  has_binary_magic,
  has_gzip_magic,
  has_hdf5_magic,
  is_binary,
  is_binary_data_extension,
  is_binary_payload,
  is_known_text_file,
  magic_head,
} from '#lib/io/is-binary.js'
import { describe, expect, test } from 'vitest'

const bytes = (...nums: number[]): Uint8Array<ArrayBuffer> => new Uint8Array(nums)
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
    // bytes that are not UTF-8 decode to U+FFFD
    [`undecodable bytes`, new TextDecoder().decode(new Uint8Array(20).fill(0xff)), true],
    [`20% undecodable bytes`, `\uFFFD\uFFFDabcdefgh`, true],
    [`C0 controls other than 9-13`, `${`\u000E`.repeat(8)}ab`, true],
    [`C1 controls`, `\u0085\u009Fabcdefgh`, true],
    // letters past ASCII are text, not high bytes: Latin-1 accents and Greek/CJK prose
    [`accented prose`, `Größe für Ångström-Abstände é è ü ÿ`.repeat(3), false],
    [`Greek and CJK comment`, `αβγ 硅晶体结构 `.repeat(10), false],
    // tab/CR/LF are text: counting them as neither sank these two to binary
    [`CRLF single-atom XYZ`, `1\r\nE\r\nH 0 0 0\r\n`.repeat(400), false],
    [`tab-indented YAML`, `\t\t\t\tvalue: 1\n`.repeat(400), false],
    // only the leading 8 KiB is sampled
    [`binary header on a large payload`, `\0${`a`.repeat(20_000)}`, true],
    [`large text with a stray NUL past the sample window`, `${`a`.repeat(20_000)}\0`, false],
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
    [`contcar`, true], // case-insensitive
    [`run.h5`, false],
    [`blob-uuid`, false],
  ])(`is_known_text_file(%s) -> %s`, (name, expected) => {
    expect(is_known_text_file(name)).toBe(expected)
  })

  test.each([
    [`h5`, true],
    [`traj`, true],
    [`npz`, true],
    [`gz`, false], // wrappers are not data formats
    [`xyz`, false],
  ])(`is_binary_data_extension(%s) -> %s`, (ext, expected) =>
    expect(is_binary_data_extension(ext)).toBe(expected),
  )
})

describe(`is_binary_payload (extension or magic bytes)`, () => {
  test.each([
    [`binary extension`, `run.h5`, [0x48, 0x49], true], // ext wins regardless of bytes
    [`magic bytes, no binary ext`, `payload.dump`, HDF5_PREFIX, true],
    [`unknown ext, text bytes`, `payload.dump`, [0x48, 0x49], false],
  ])(`%s -> %s`, (_desc, filename, byte_seq, expected) => {
    expect(is_binary_payload(filename, bytes(...byte_seq).buffer)).toBe(expected)
  })
})

describe(`magic_head`, () => {
  // slice() throws on a detached ArrayBuffer, so magic sniffing used to throw a TypeError
  test(`returns empty for a detached buffer instead of throwing`, () => {
    const buffer = new ArrayBuffer(64)
    structuredClone(buffer, { transfer: [buffer] })
    expect(buffer.byteLength).toBe(0)
    expect(magic_head(buffer)).toHaveLength(0)
    expect(is_binary_payload(`x.dump`, buffer)).toBe(false)
  })

  // Short buffers pass through so a 2-byte gzip header still matches
  test.each([
    [2, 2],
    [8, 8],
    [64, 8],
  ])(`%i-byte gzip buffer yields %i leading bytes`, (size, expected) => {
    const head = magic_head(bytes(...GZIP, ...Array(size - 2).fill(0)).buffer)
    expect(head).toHaveLength(expected)
    expect(has_gzip_magic(head)).toBe(true)
  })
})
