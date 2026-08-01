// Guards the filename patterns. JupyterLab checks a file type's `pattern` before
// any extension match, and these types are in `defaultFor`, so an over-broad pattern
// silently makes MatterViz the default opener for unrelated files rather than an
// extra "Open With" entry.
import { describe, expect, test } from 'vitest'
import { BASE64_FILE_TYPES, TEXT_FILE_TYPES } from '../src/file-types'

const match_kind = (filename: string): `text` | `base64` | null => {
  const matches = (types: typeof TEXT_FILE_TYPES) =>
    types.some((file_type) =>
      file_type.pattern
        ? new RegExp(file_type.pattern).test(filename)
        : file_type.extensions?.some((ext) => filename.endsWith(ext)),
    )
  if (matches(TEXT_FILE_TYPES)) return `text`
  if (matches(BASE64_FILE_TYPES)) return `base64`
  return null
}

describe(`file type patterns`, () => {
  test.each([
    // Extensionless VASP names route to the text model factory
    [`POSCAR`, `text`],
    [`CONTCAR`, `text`],
    [`XDATCAR`, `text`],
    [`CHGCAR`, `text`],
    [`LOCPOT`, `text`],
    [`POSCAR_relaxed`, `text`],
    [`Si-POSCAR`, `text`],
    [`Si.poscar`, `text`],
    // Compressed payloads must reach the parser as bytes, not mangled UTF-8
    [`POSCAR.gz`, `base64`],
    [`CHGCAR.gz`, `base64`],
    [`structure.cif.gz`, `base64`],
    [`traj.h5.gz`, `base64`],
    // Binary containers we actually have a decoder for
    [`run.traj`, `base64`],
    [`vaspout.h5`, `base64`],
    // Plain text structures
    [`Li10GeP2S12.cif`, `text`],
    [`dump.lammpstrj`, `text`],
    // Source files that merely mention a VASP name must not be claimed
    [`write_poscar.py`, null],
    [`poscar_utils.py`, null],
    [`notes-contcar.md`, null],
    [`test_xdatcar.ipynb`, null],
    [`contcar_reader.rs`, null],
    [`my-poscar-analysis.py`, null],
    [`make_chgcar.sh`, null],
    // Formats with no decoder stay unclaimed so other handlers keep them
    [`traj.xtc`, null],
    [`traj.trr`, null],
    [`traj.dcd`, null],
  ])(`%s -> %s`, (filename, expected) => {
    expect(match_kind(filename)).toBe(expected)
  })
})
