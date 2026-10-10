import {
  is_lammps_data_content,
  is_lammps_dump_content,
} from '#lib/structure/format-detect.js'
import { is_mmcif_content } from '#lib/structure/parsers/mmcif.js'
import { describe, expect, test } from 'vitest'

const lammps_data = `LAMMPS data file

   256 atoms
   2 atom types

0.0 10.0 xlo xhi

Atoms # atomic

1 1 0.0 0.0 0.0
`

describe(`LAMMPS content sniffing`, () => {
  // oxfmt-ignore
  test.each([
    [`a real data file`, is_lammps_data_content, lammps_data, true],
    [`the same file with CRLF endings`, is_lammps_data_content, lammps_data.replaceAll(`\n`, `\r\n`), true],
    [`a count line carrying a comment`, is_lammps_data_content, `12 atoms # note\nAtoms\n`, true],
    [`a header with no Atoms section`, is_lammps_data_content, `256 atoms\n`, false],
    [`an Atoms section with no count`, is_lammps_data_content, `Atoms\n1 1 0 0 0\n`, false],
    [`unrelated text`, is_lammps_data_content, `just some prose about atoms\n`, false],
    [`a dump file`, is_lammps_dump_content, `ITEM: TIMESTEP\n0\n`, true],
    [`text without dump items`, is_lammps_dump_content, `no items here\n`, false],
  ])(`recognises %s`, (_case, sniff, content, expected) => {
    expect(sniff(content)).toBe(expected)
  })
})

describe(`mmCIF content sniffing`, () => {
  test.each([
    [`dot-notation Cartesian atom sites`, `data_x\n_atom_site.Cartn_x\n1.0\n`, true],
    [`the same tag indented`, `data_x\n   _atom_site.Cartn_x\n`, true],
    // small-molecule CIF2: dotted tags but fractional coordinates, read by parse_cif
    [`dot-notation fractional atom sites`, `data_x\n_atom_site.fract_x\n0.5\n`, false],
    [`plain CIF underscore tags`, `data_x\n_atom_site_type_symbol\nSi 0 0 0\n`, false],
    [`unrelated text`, `just prose\n`, false],
  ])(`recognises %s`, (_case, content, expected) => {
    expect(is_mmcif_content(content)).toBe(expected)
  })
})

// These sniffers run on the raw text of any dropped file whose extension is unrecognised. `\s`
// matches a newline, so under /m the `^` retried at every line start and `\s*` swallowed the
// whole remaining run of newlines before failing - quadratic, and a file of blank lines was a
// denial of service: 80 kB of them blocked the thread for 826 ms (LAMMPS) / 631 ms (mmCIF).
test.each([
  [`LAMMPS`, [is_lammps_data_content, is_lammps_dump_content]],
  [`mmCIF`, [is_mmcif_content]],
])(`%s sniffing stays linear on a file of blank lines`, (_format, sniffers) => {
  const timings = [20_000, 40_000, 80_000].map((count) => {
    const start = performance.now()
    for (const sniff of sniffers) sniff(`\n`.repeat(count))
    return performance.now() - start
  })
  expect(Math.max(...timings)).toBeLessThan(100)
})
