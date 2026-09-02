// extXYZ files whose `Properties=` layout does not start with the species column: the frame
// indexer must read the declared column layout rather than assume `symbol x y z`, and the
// indexed (large-file) run must report the same per-frame scalars as the materialized one.
import { count_xyz_frames } from '$lib/trajectory/helpers'
import { create_warning_collector } from '$lib/trajectory/parse/shared'
import { index_xyz_frames, parse_xyz_trajectory } from '$lib/trajectory/parse/xyz'
import { indexed_text_run } from '$lib/trajectory/runs/indexed-text'
import { expect, test } from 'vitest'

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

const species_first = two_frames(`species:S:1:pos:R:3`, [[`Si`], [`Si`]])
const id_first = two_frames(`id:I:1:species:S:1:pos:R:3`, [
  [`1`, `Si`],
  [`2`, `Si`],
])

test.each([
  [`species first`, species_first],
  [`an id column before species`, id_first],
])(`indexes and parses both frames of an extXYZ with %s`, (_case, text) => {
  const collector = create_warning_collector()
  expect(index_xyz_frames(text, collector.warn)).toHaveLength(2)
  expect(count_xyz_frames(text)).toBe(2)
  const { frames } = parse_xyz_trajectory(text, collector)
  expect(frames).toHaveLength(2)
  expect(frames.map((frame) => frame.structure.sites.length)).toEqual([2, 2])
  expect(frames.map((frame) => frame.structure.sites[0].xyz[2])).toEqual([0, 0.1])
  expect(frames.map((frame) => frame.structure.sites[1].species[0].element)).toEqual([
    `Si`,
    `Si`,
  ])
})

// `Properties=Z:I:1:pos:R:3` names atoms by atomic number - there is no species column for
// the `symbol x y z` shape to find, and no symbol for the frame builder to resolve either.
test(`reads atomic numbers from a layout with no species column`, () => {
  const text = two_frames(`Z:I:1:pos:R:3`, [[`14`], [`14`]])
  const { frames } = parse_xyz_trajectory(text, create_warning_collector())
  expect(frames).toHaveLength(2)
  expect(frames[0].structure.sites.map((site) => site.species[0].element)).toEqual([
    `Si`,
    `Si`,
  ])
})

// The layout-driven check must stay strict: a stray number on its own line inside a frame,
// or a numeric comment line, must not be mistaken for an atom-count line.
test(`does not invent frames from numeric lines inside a frame`, () => {
  const text = [`2`, `3`, `Si 0 0 0`, `Si 1.35 1.35 1.35`].join(`\n`)
  expect(count_xyz_frames(text)).toBe(1)
})

// Both open paths must agree on the plot data. The indexed path is chosen purely by file
// size (open.ts index_above_bytes), so a force curve that only the materialized path
// computes disappears when the same file grows past the threshold.
test(`indexed run reports the same force stats as the materialized run`, async () => {
  const text = two_frames(`species:S:1:pos:R:3:forces:R:3`, [[`Si`], [`Si`]])
    .split(`\n`)
    .map((line) => (line.startsWith(`Si`) ? `${line} 0.1 0.2 0.2` : line))
    .join(`\n`)
  const collector = create_warning_collector()
  const materialized = parse_xyz_trajectory(text, collector).frames
  // |(0.1, 0.2, 0.2)| = 0.3 for every atom, so both stats are exactly 0.3
  expect(materialized[0].metadata?.force_max).toBeCloseTo(0.3, 12)

  const run = indexed_text_run(text, `xyz`, {}, create_warning_collector())
  await run.properties.done
  expect(run.properties.rows.map((row) => row.properties.force_max)).toEqual(
    materialized.map((frame) => frame.metadata?.force_max),
  )
  expect(run.properties.rows.map((row) => row.properties.force_norm)).toEqual(
    materialized.map((frame) => frame.metadata?.force_norm),
  )
  expect(run.properties.rows.map((row) => row.properties.energy)).toEqual([-3, -4])
})

// A malformed `Properties=` must fail loudly. Both of these used to produce a plausible
// wrong atom: a short `pos` read the next field (forces[0]) as z, and a non-integer atomic
// number was truncated into a real element.
test.each([
  [
    `pos declaring fewer than 3 columns`,
    `1\nProperties=species:S:1:pos:R:2:forces:R:3 Lattice="5 0 0 0 5 0 0 0 5"\nSi 1.0 2.0 9.9 8.8 7.7\n`,
    /declares pos with 2 columns, expected 3/,
  ],
  [
    `a non-integer atomic number`,
    `1\nProperties=Z:I:1:pos:R:3 Lattice="5 0 0 0 5 0 0 0 5"\n14.9 0.0 0.0 0.0\n`,
    /no atom with a recognised element symbol/,
  ],
])(`rejects %s instead of guessing`, (_name, text, message) => {
  expect(() => parse_xyz_trajectory(text, create_warning_collector())).toThrow(message)
})
