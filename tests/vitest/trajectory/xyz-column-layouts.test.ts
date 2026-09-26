// extXYZ files whose `Properties=` layout does not start with the species column: the frame
// indexer must read the declared column layout rather than assume `symbol x y z`, and the
// indexed (large-file) run must report the same per-frame scalars as the materialized one.
import { frame_property_row } from '$lib/trajectory/extract'
import { encode_frame } from '$lib/trajectory/frame'
import { count_xyz_frames } from '$lib/trajectory/helpers'
import { create_warning_collector } from '$lib/trajectory/parse/shared'
import {
  build_xyz_frame,
  index_xyz_frames,
  parse_xyz_trajectory,
  read_xyz_numeric_frame,
  xyz_plot_row_frame,
} from '$lib/trajectory/parse/xyz'
import { indexed_text_run } from '$lib/trajectory/runs/indexed-text'
import { join } from 'node:path'
import process from 'node:process'
import { expect, onTestFinished, test, vi } from 'vitest'
import { read_maybe_gz } from '../test-fixtures'
import { synthetic_extxyz } from './fixtures'

// Two frames of Si2, written with `columns` prefixed to each atom line
const two_frames = (properties: string, columns: string[][]): string =>
  [0, 1]
    .flatMap((frame_idx) => [
      `2`,
      `Lattice="5 0 0 0 5 0 0 0 5" Properties=${properties} energy=${-3 - frame_idx}`,
      `${columns[0].join(` `)} 0.0 0.0 ${0.1 * frame_idx}`,
      `${columns[1].join(` `)} 1.35 1.35 1.35`,
    ])
    .join(`\n`)

// oxfmt-ignore
test.each([
  [`species first`, two_frames(`species:S:1:pos:R:3`, [[`Si`], [`Si`]])],
  [`an id column before species`, two_frames(`id:I:1:species:S:1:pos:R:3`, [[`1`, `Si`], [`2`, `Si`]])],
  // `Properties=Z:I:1:pos:R:3` names atoms by atomic number - there is no species column for
  // the `symbol x y z` shape to find, and no symbol for the frame builder to resolve either.
  [`atomic numbers and no species column`, two_frames(`Z:I:1:pos:R:3`, [[`14`], [`14`]])],
])(`indexes and parses both frames of an extXYZ with %s`, (_case, text) => {
  const collector = create_warning_collector()
  expect(index_xyz_frames(text, collector.warn)).toHaveLength(2)
  expect(count_xyz_frames(text)).toBe(2)
  const { frames } = parse_xyz_trajectory(text, collector)
  expect(frames).toHaveLength(2)
  expect(frames.map((frame) => frame.structure.sites[0].xyz[2])).toEqual([0, 0.1])
  // every frame must hold exactly the two Si the layout declares
  expect(frames.map((frame) => frame.structure.sites.map((site) => site.species[0].element)))
    .toEqual([[`Si`, `Si`], [`Si`, `Si`]])
})

// The layout-driven check must stay strict: a stray number on its own line inside a frame,
// or a numeric comment line, must not be mistaken for an atom-count line.
test(`does not invent frames from numeric lines inside a frame`, () => {
  const text = [`2`, `3`, `Si 0 0 0`, `Si 1.35 1.35 1.35`].join(`\n`)
  expect(count_xyz_frames(text)).toBe(1)
})

// Both open paths must agree on the plot rows (parsers.test compares them for sound files),
// also when a spec is unusable: each frame carries its own `Properties=`, so a later frame
// the materialized path refuses to build must not get a plot row in the indexed run either.
test(`indexed run publishes no force stats for a frame whose spec is unusable`, async () => {
  const sound = `species:S:1:pos:R:3:forces:R:3`
  const text = two_frames(sound, [[`Si`], [`Si`]])
    .split(`\n`)
    .map((line) => (line.startsWith(`Si`) ? `${line} 0.1 0.2 0.2` : line))
    .join(`\n`)
    // only the second frame's spec is broken
    .replace(new RegExp(`${sound}(?![\\s\\S]*${sound})`), `species:S:1:pos:R:2:forces:R:3`)
  expect(() => parse_xyz_trajectory(text, create_warning_collector())).toThrow(
    /does not declare a 3-column pos field/,
  )
  const run = indexed_text_run(text, `xyz`, {}, create_warning_collector())
  await run.properties.done
  const [first, second] = run.properties.rows.map((row) => row.properties.force_max)
  expect(first).toBeCloseTo(0.3, 12)
  expect(second).toBeUndefined() // read the tail of the position columns before the fix
})

// The frame walk's atom-line test rules out a NaN coordinate but not an overflowing one, so
// `1e999` reaches the force scan while the frame builder still refuses the atom as non-finite.
test.each([0, 1, 2])(
  `indexed run publishes no force stats with non-finite coordinate axis %s`,
  async (axis) => {
    const sound = `species:S:1:pos:R:3:forces:R:3`
    const text = two_frames(sound, [[`Si`], [`Si`]])
      .split(`\n`)
      .map((line) => (line.startsWith(`Si`) ? `${line} 0.1 0.2 0.2` : line))
      .join(`\n`)
      // frame 1's FIRST atom line: frame 0 is decoded eagerly, and a bad LAST line of the file
      // is already caught by the torn-frame guard, which drops the frame instead
      .replace(
        `Si 0.0 0.0 0.1 `,
        `Si ${[`0.0`, `0.0`, `0.1`].map((value, idx) => (idx === axis ? `1e999` : value)).join(` `)} `,
      )
    expect(() => parse_xyz_trajectory(text, create_warning_collector())).toThrow(
      /non-numeric coordinates/,
    )
    const run = indexed_text_run(text, `xyz`, {}, create_warning_collector())
    await run.properties.done
    const [first, second] = run.properties.rows.map((row) => row.properties.force_max)
    expect(first).toBeCloseTo(0.3, 12)
    expect(second).toBeUndefined() // 0.3 before the fix, for a frame that cannot be built
  },
)

// A malformed `Properties=` must fail loudly. Each of these used to yield a plausible wrong
// atom: an unusable spec was discarded and read as "no Properties= at all", so the plain
// `symbol x y z` fallback took columns 1-3 — the very ones the bad spec would have misread.
test.each([
  [`pos declaring fewer than 3 columns`, `species:S:1:pos:R:2:forces:R:3`],
  [`pos declaring more than 3 columns`, `species:S:1:pos:R:4`],
  [`a zero pos count`, `species:S:1:pos:R:0:forces:R:3`],
  [`a fractional pos count`, `species:S:1:pos:R:2.5:forces:R:3`],
  // truncating the count first let a fractional one through and shifted every later offset
  [`a fractional count in a later field`, `species:S:1:pos:R:3:forces:R:3.7`],
  [`a non-numeric pos count`, `species:S:1:pos:R:x:forces:R:3`],
  // a bad count in an earlier field makes every later offset, `pos` included, unknowable
  [`a bad count before pos`, `id:I:0:species:S:1:pos:R:3`],
  [`a field count that is not a multiple of 3`, `species:S:1:pos:R`],
  // extXYZ requires `pos`; without it column 1 is not the x coordinate but the first force
  [`no pos field at all`, `species:S:1:forces:R:3`],
  // a repeat overwrote the first entry and moved its offset: this read columns 4-6 as the
  // coordinates, and no count anywhere in the spec is wrong enough to notice
  [`pos declared twice`, `species:S:1:pos:R:3:pos:R:3`],
  [`another field declared twice`, `species:S:1:pos:R:3:forces:R:3:forces:R:3`],
])(`rejects %s instead of guessing`, (name, properties) => {
  // long enough for every layout under test, so a case fails on its spec rather than on a
  // short line: the duplicate-`pos` layout alone reads out to column 6
  const text = `1\nProperties=${properties} Lattice="5 0 0 0 5 0 0 0 5"\nSi 1.0 2.0 9.9 8.8 7.7 6.6 5.5\n`
  const reason = name.includes(`twice`)
    ? /declares '(?:pos|forces)' more than once/
    : `Properties=${properties} does not declare a 3-column pos field`
  expect(() => parse_xyz_trajectory(text, create_warning_collector())).toThrow(reason)
})

// A `Properties=` that declares nothing is not the same as no `Properties=` at all, and the
// plain `symbol x y z` fallback is a guess either way. The value also has to be read as the
// one token it is: allowing whitespace after `=` let the match run on into the next key, so
// `Properties= Lattice="..."` reported `Lattice=` as the offending spec.
test.each([`Properties=""`, `Properties=`])(
  `rejects the empty declaration %s`,
  (declaration) => {
    const text = `1\n${declaration} Lattice="5 0 0 0 5 0 0 0 5"\nSi 1.0 2.0 3.0\n`
    expect(() => parse_xyz_trajectory(text, create_warning_collector())).toThrow(
      `Properties= does not declare a 3-column pos field`,
    )
  },
)

test(`rejects a non-integer atomic number instead of truncating it to an element`, () => {
  const text = `1\nProperties=Z:I:1:pos:R:3 Lattice="5 0 0 0 5 0 0 0 5"\n14.9 0.0 0.0 0.0\n`
  expect(() => parse_xyz_trajectory(text, create_warning_collector())).toThrow(
    /no atom with a recognised element symbol/,
  )
})

// The indexed run's numeric read and plot-row scan skip Site records; both must equal the
// Site path exactly (encode_frame of build_xyz_frame, and its frame_property_row), including
// warnings, errors, -0 and every frame shape that has to fall back to that path
const outcome = <T>(read: () => T): { value: T } | { error: string } => {
  try {
    return { value: read() }
  } catch (error) {
    return { error: String(error) }
  }
}
const frame_text = (comment: string, lines: string[]): string =>
  `${lines.length}\n${comment}\n${lines.join(`\n`)}\n`
const cell = `Lattice="5 0 0 0 5 0 0 0 5"`
const site_file = (dir: string, name: string) => () =>
  read_maybe_gz(join(process.cwd(), `src/site`, dir, name))
// oxfmt-ignore
test.each<[string, () => string]>([
  [`the V8Ta12W71Re8 MACE run`, site_file(`trajectories`, `V8Ta12W71Re8-mace-omat.xyz`)],
  [`mp-1184225.extxyz`, site_file(`trajectories`, `mp-1184225.extxyz`)],
  [`the Ag NEB images`, site_file(`trajectories`, `ase-images-Ag-0-to-97.xyz.gz`)],
  [`the CrFeCoNi QHA run`, site_file(`trajectories`, `Cr0.25Fe0.25Co0.25Ni0.25-mace-omat-qha.xyz.gz`)],
  [`quartz.extxyz`, site_file(`structures`, `quartz.extxyz`)],
  [`cyclohexane.xyz`, site_file(`molecules`, `cyclohexane.xyz`)],
  [`C5-extra-data.xyz`, site_file(`molecules`, `C5-extra-data.xyz`)],
  [`C2HO-scientific-notation.xyz`, site_file(`molecules`, `C2HO-scientific-notation.xyz`)],
  [`synthetic forces`, () => synthetic_extxyz(3, 20)],
  [`plain XYZ with -0 and Fortran exponents`, () => frame_text(`plain`, [`Si -0.0 0 1.0D-1`, `O 1 2 3`])],
  [`numeric extra columns`, () => frame_text(`${cell} Properties=id:I:1:species:S:1:pos:R:3:velocities:R:3:charges:R:1:forces:R:3 fmax=9 stress="1 0 0 0 1 0 0 0 1" pbc="T F T"`, [`1 Si 0 0 0 1 2 3 0.5 0.1 -0 0.2`, `2 O 1 1 1 -1 -2 -3 -0.5 0.3 0.1 0`])],
  [`atomic numbers and a string column`, () => frame_text(`${cell} Properties=Z:I:1:pos:R:3:tag:S:1`, [`14 0 0 0 a`, `8 1 1 1 b`])],
  [`a move mask`, () => frame_text(`${cell} Properties=species:S:1:pos:R:3:move_mask:L:3`, [`Si 0 0 0 T F T`, `O 1 1 1 T T T`])],
  [`a bool column`, () => frame_text(`${cell} Properties=species:S:1:pos:R:3:fixed:L:1`, [`Si 0 0 0 T`, `O 1 1 1 F`])],
  [`a 2-column extra`, () => frame_text(`${cell} Properties=species:S:1:pos:R:3:uv:R:2`, [`Si 0 0 0 1 2`, `O 1 1 1 3 4`])],
  [`aliased duplicate columns`, () => frame_text(`${cell} Properties=species:S:1:pos:R:3:velocities:R:3:velocity:R:3`, [`Si 0 0 0 1 2 3 4 5 6`, `O 1 1 1 1 2 3 4 5 6`])],
  [`a NaN in an extra column`, () => frame_text(`${cell} Properties=species:S:1:pos:R:3:charges:R:1`, [`Si 0 0 0 nan`, `O 1 1 1 0.5`])],
  [`a short extra column`, () => frame_text(`${cell} Properties=species:S:1:pos:R:3:velocities:R:3`, [`Si 0 0 0 1 2 3`, `O 1 1 1 1 2`])],
  [`one atom without forces`, () => frame_text(`${cell} Properties=species:S:1:pos:R:3:forces:R:3`, [`Si 0 0 0 1 2 3`, `O 1 1 1`]) + frame_text(cell, [`Si 0 0 0`, `O 1 1 1`])],
  [`unknown elements between frames`, () => frame_text(`${cell} Properties=species:S:1:pos:R:3:forces:R:3`, [`X 0 0 0 1 2 3`, `Si 1 1 1 1 0 0`, `O 2 2 2 0 1 0`]) + frame_text(cell, [`Si 0 0 0`, `Si 1 1 1`, `O 2 2 2`])],
  [`only unknown elements`, () => frame_text(cell, [`X 0 0 0`, `Q 1 1 1`]) + frame_text(cell, [`Si 0 0 0`, `O 1 1 1`])],
  [`a singular and an invalid-pbc cell`, () => frame_text(`Lattice="1 0 0 2 0 0 0 0 1" pbc="T X"`, [`Si 0 0 0`, `O 1 1 1`]) + frame_text(`${cell} pbc="nope"`, [`Si 0 0 0`, `O 1 1 1`])],
  [`a short atom line mid-file`, () => frame_text(`${cell} Properties=species:S:1:pos:R:3:forces:R:3`, [`Si 0 0 0 1 2 3`, `O 1 1 1 1 2 3`, `O 1 1 1 1 2 3`, `Si 1 1`]) + frame_text(cell, [`Si 0 0 0`])],
  [`an overflowing coordinate mid-file`, () => frame_text(cell, [`Si 0 0 0`, `O 1 1 1`, `O 1e999 1 1`, `Si 1 1 1`]) + frame_text(cell, [`Si 0 0 0`])],
  [`a bad Properties spec`, () => frame_text(`${cell} Properties=species:S:1:pos:R:3`, [`Si 0 0 0`]) + frame_text(`${cell} Properties=species:S:1:pos:R:3:pos:R:3`, [`Si 0 0 0 1 1 1`])],
])(`numeric reads and plot rows of %s equal the Site path's`, (_label, make_text) => {
  const text = make_text()
  const index_collector = create_warning_collector()
  const console_warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
  onTestFinished(() => console_warn.mockRestore())
  const specs = index_xyz_frames(text, index_collector.warn)
  expect(specs.length).toBeGreaterThan(0)
  const [site_reads, numeric_reads, site_rows, scan_rows] = Array.from({ length: 4 }, create_warning_collector)
  const previous = {}
  for (const [frame_idx, spec] of specs.entries()) {
    const opts = { frame_label: `indexed frame ${frame_idx}`, default_step: frame_idx }
    expect(outcome(() => read_xyz_numeric_frame(text, spec, opts, numeric_reads))).toStrictEqual(
      outcome(() => encode_frame(build_xyz_frame(text, spec, opts, site_reads))),
    )
    expect(
      outcome(() => frame_property_row(xyz_plot_row_frame(text, spec, opts, scan_rows, previous), frame_idx)),
    ).toStrictEqual(outcome(() => frame_property_row(build_xyz_frame(text, spec, opts, site_rows), frame_idx)))
  }
  expect(numeric_reads.warnings).toStrictEqual(site_reads.warnings)
  expect(scan_rows.warnings).toStrictEqual(site_rows.warnings)
})
