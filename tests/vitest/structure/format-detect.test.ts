import { is_lammps_data_content, is_lammps_dump_content } from '$lib/structure/format-detect'
import { describe, expect, test } from 'vitest'

const lammps_data = `LAMMPS data file

   256 atoms
   2 atom types

0.0 10.0 xlo xhi

Atoms # atomic

1 1 0.0 0.0 0.0
`

describe(`LAMMPS content sniffing`, () => {
  test.each([
    [`a real data file`, lammps_data, true],
    [`the same file with CRLF endings`, lammps_data.replaceAll(`\n`, `\r\n`), true],
    [`a count line carrying a comment`, `12 atoms # note\nAtoms\n`, true],
    [`a header with no Atoms section`, `256 atoms\n`, false],
    [`an Atoms section with no count`, `Atoms\n1 1 0 0 0\n`, false],
    [`unrelated text`, `just some prose about atoms\n`, false],
  ])(`recognises %s`, (_case, content, expected) => {
    expect(is_lammps_data_content(content)).toBe(expected)
  })

  test(`recognises a dump file`, () => {
    expect(is_lammps_dump_content(`ITEM: TIMESTEP\n0\n`)).toBe(true)
    expect(is_lammps_dump_content(`no items here\n`)).toBe(false)
  })

  // These run on the raw text of any dropped file whose extension is unrecognised. `\s` matches
  // a newline, so under /m the `^` retried at every line start and `\s*` swallowed the whole
  // remaining run of newlines before failing on `\d` - quadratic, and a file of blank lines was
  // a denial of service: 80 kB of them blocked the thread for 826 ms, a megabyte for minutes.
  test(`stays linear on a file of blank lines`, () => {
    const timings = [20_000, 40_000, 80_000].map((count) => {
      const start = performance.now()
      is_lammps_data_content(`\n`.repeat(count))
      is_lammps_dump_content(`\n`.repeat(count))
      return performance.now() - start
    })
    expect(Math.max(...timings)).toBeLessThan(100) // quadratic put 80k at 826 ms
  })
})
