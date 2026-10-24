import type { Vec3 } from '#lib/math.js'
import type { StructureIdResult } from '#lib/structure-id/calc-structure-id.js'
import type { StructureIdSweep } from '#lib/structure-id/collect.js'
import {
  cna_type_source_atoms,
  scene_site_indices,
  site_source_atoms,
} from '#lib/trajectory/linked-sites.js'
import { expect, test } from 'vitest'
import { make_molecule } from '../test-fixtures'

const structure = make_molecule(
  Array.from({ length: 4 }, (_unused, idx): [string, Vec3] => [`Li`, [idx, 0, 0]]),
)

const sampled = [0, 3, 6, 9]

test.each<[string, Record<string, unknown> | null, number[], number[]]>([
  [`full frame passes indices through`, {}, [3, 0], [3, 0]],
  [`full frame drops indices past the last site`, {}, [1, 4, -1], [1]],
  // a render sample of every 3rd atom out of 12: source 0, 3, 6, 9 are sites 0-3
  [`render sample`, { render_sample: true, source_atom_indices: sampled }, [9, 4, 3], [3, 1]],
  [`index list without render_sample flag`, { source_atom_indices: sampled }, [3], [3]],
  [`no frame yet maps nothing`, null, [0, 1], []],
])(`scene_site_indices: %s`, (_name, metadata, source_indices, expected) => {
  const frame = metadata && { structure, metadata }
  expect(scene_site_indices(source_indices, frame)).toEqual(expected)
})

// oxfmt-ignore
test.each<[string, Record<string, unknown>, number[]]>([
  [`full frame passes sites through`, {}, [3, 1, 7]],
  // site 7 lies past the 4-site sample
  [`render sample maps sites to source atoms`, { render_sample: true, source_atom_indices: sampled }, [9, 3]],
])(`site_source_atoms: %s`, (_name, metadata, expected) => {
  expect(site_source_atoms([3, 1, 7], { metadata })).toEqual(expected)
})

// A sample that does not say which atoms it kept would pass site indices off as atoms
test(`a render sample without source_atom_indices throws`, () => {
  const metadata = { render_sample: true }
  expect(() => scene_site_indices([0], { structure, metadata })).toThrow(`source_atom_indices`)
  expect(() => site_source_atoms([0], { metadata })).toThrow(`source_atom_indices`)
})

const sweep_of = (frame_numbers: number[], types: (Int8Array | null)[]): StructureIdSweep => ({
  frame_numbers,
  results: types.map((frame_types) => ({ cna_types: frame_types }) as StructureIdResult),
  frame_stride: 10,
})
const sweep = sweep_of([0, 10], [Int8Array.of(1, 1, 0, 2), Int8Array.of(0, 1, 1, 1)])

test.each([
  [sweep, 0, 1, { frame_number: 0, atom_indices: [0, 1] }],
  // frame 7 was never analysed: the classification comes from the nearest frame 10
  [sweep, 7, 1, { frame_number: 10, atom_indices: [1, 2, 3] }],
  // equidistant goes to the earlier frame
  [sweep, 5, 2, { frame_number: 0, atom_indices: [3] }],
  [sweep, 7, 4, { frame_number: 10, atom_indices: [] }],
  [sweep_of([], []), 0, 1, null],
  [sweep_of([0], [null]), 0, 1, null], // CNA skipped
])(`cna_type_source_atoms(frame %#)`, (sweep_in, frame_idx, type_code, expected) => {
  expect(cna_type_source_atoms(sweep_in, frame_idx, type_code)).toEqual(expected)
})
