// Guards the filename patterns. JupyterLab checks a file type's `pattern` before
// any extension match, and these types are in `defaultFor`, so an over-broad pattern
// silently makes MatterViz the default opener for unrelated files rather than an
// extra "Open With" entry.
import { describe, expect, test } from 'vitest'
import { BASE64_FILE_TYPES, TEXT_FILE_TYPES } from '../src/file-types'

// Registration order in `index.ts`: text types first, then base64.
const REGISTERED = [
  ...TEXT_FILE_TYPES.map((file_type) => [file_type, `text`] as const),
  ...BASE64_FILE_TYPES.map((file_type) => [file_type, `base64`] as const),
]

// Mirrors DocumentRegistry._getFileTypesForPath: the first pattern match anywhere in
// the registry wins outright, and extensions are only consulted after every pattern
// has missed. Extensions match case-insensitively, patterns do not.
const match_kind = (filename: string): `text` | `base64` | null => {
  const matched =
    REGISTERED.find(
      ([file_type]) => file_type.pattern && new RegExp(file_type.pattern).test(filename),
    ) ??
    REGISTERED.find(([file_type]) =>
      file_type.extensions.some((ext) => filename.toLowerCase().endsWith(ext)),
    )
  return matched?.[1] ?? null
}

describe(`file type patterns`, () => {
  // VASP's canonical filenames carry no extension, so only the pattern can claim
  // them. Both cases, since tooling around VASP is inconsistent about it.
  test.each([
    `POSCAR`,
    `CONTCAR`,
    `XDATCAR`,
    `CHGCAR`,
    `LOCPOT`,
    `ELFCAR`,
    `PARCHG`,
    `AECCAR0`,
    `AECCAR1`,
    `AECCAR2`,
  ])(`%s, upper and lower case -> text`, (stem) => {
    expect(match_kind(stem)).toBe(`text`)
    expect(match_kind(stem.toLowerCase())).toBe(`text`)
  })

  test.each([
    // Decorated VASP names: leading token, trailing token, and a dotted prefix
    [`POSCAR_relaxed`, `text`],
    [`Si-POSCAR`, `text`],
    [`Si.poscar`, `text`],
    // the charge index is a regex class the lowercase mapping leaves alone, so it
    // must still bound: the stem table above covers 0-2, this is the edge past them
    [`AECCAR3`, null],
    // Compressed payloads must reach the parser as bytes, not mangled UTF-8
    [`POSCAR.gz`, `base64`],
    [`structure.cif.gz`, `base64`],
    [`traj.h5.gz`, `base64`],
    // Binary containers we actually have a decoder for
    [`run.traj`, `base64`],
    [`vaspout.h5`, `base64`],
    // Plain text structures and trajectories
    [`Li10GeP2S12.cif`, `text`],
    [`dump.lammpstrj`, `text`],
    [`Li2O.CIF`, `text`],
    // Source files that merely mention a VASP name must not be claimed
    [`write_poscar.py`, null],
    [`contcar_reader.rs`, null],
    [`my-poscar-analysis.py`, null],
    // Only known inner names are ours; bare .gz belongs to whoever else handles it
    [`archive.tar.gz`, null],
    // Formats with no decoder stay unclaimed so other handlers keep them
    [`traj.xtc`, null],
  ])(`%s -> %s`, (filename, expected) => {
    expect(match_kind(filename)).toBe(expected)
  })
})
