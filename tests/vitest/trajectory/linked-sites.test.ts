import type { StructureIdResult } from '#lib/structure-id/calc-structure-id.js'
import type { StructureIdSweep } from '#lib/structure-id/collect.js'
import {
  cna_type_source_atoms,
  element_site_indices,
  nearest_frame_position,
  scene_site_indices,
} from '#lib/trajectory/linked-sites.js'
import { describe, expect, test } from 'vitest'
import { make_molecule } from '../test-fixtures'

// Li on sites 0 and 2, Si on 1 and 3
const structure = make_molecule([
  [`Li`, [0, 0, 0]],
  [`Si`, [1, 0, 0]],
  [`Li`, [2, 0, 0]],
  [`Si`, [3, 0, 0]],
])

describe(`scene_site_indices`, () => {
  test.each<[string, Record<string, unknown> | undefined, number[], number[]]>([
    [`full frame passes indices through`, undefined, [3, 0], [3, 0]],
    [`full frame drops indices past the last site`, {}, [1, 4, -1, 1.5], [1]],
    // a render sample of every 3rd atom out of 12: source 0, 3, 6, 9 are sites 0-3
    [
      `render sample maps source atoms to their sampled sites`,
      { render_sample: true, source_atom_indices: [0, 3, 6, 9] },
      [9, 4, 3],
      [3, 1],
    ],
    // without the render_sample flag the index list is not a sample
    [`index list alone is ignored`, { source_atom_indices: [0, 3, 6, 9] }, [3], [3]],
  ])(`%s`, (_name, metadata, source_indices, expected) => {
    expect(scene_site_indices(source_indices, { structure, metadata })).toEqual(expected)
  })

  test(`no frame yet maps nothing`, () => {
    expect(scene_site_indices([0, 1], null)).toEqual([])
  })
})

test.each([
  [`Li`, [0, 2]],
  [`Si`, [1, 3]],
  // the all-atom MSD/VACF curve is labelled Total, which names no element
  [`Total`, []],
])(`element_site_indices(%s)`, (element, expected) => {
  expect(element_site_indices(structure, element)).toEqual(expected)
  expect(element_site_indices(undefined, element)).toEqual([])
})

test.each([
  [[0, 10, 20], 0, 0],
  [[0, 10, 20], 14, 1],
  [[0, 10, 20], 16, 2],
  [[0, 10, 20], 99, 2],
  // equidistant goes to the earlier frame
  [[0, 10, 20], 15, 1],
  [[], 3, -1],
])(`nearest_frame_position(%j, %i) = %i`, (frame_numbers, frame_idx, expected) => {
  expect(nearest_frame_position(frame_numbers, frame_idx)).toBe(expected)
})

describe(`cna_type_source_atoms`, () => {
  const result = (codes: number[]): StructureIdResult => ({
    cna_types: Int8Array.from(codes),
    centrosymmetry: null,
    populations: { other: 0, fcc: 0, hcp: 0, bcc: 0, ico: 0 },
    n_atoms: codes.length,
    cna_mode: `adaptive`,
    n_csp_neighbors: 12,
    n_csp_undefined: 0,
    neighbor_cutoff: 3,
  })
  const sweep: StructureIdSweep = {
    frame_numbers: [0, 10],
    results: [result([1, 1, 0, 2]), result([0, 1, 1, 1])],
    frame_stride: 10,
  }

  test.each([
    [0, 1, { frame_number: 0, atom_indices: [0, 1] }],
    // frame 7 was never analysed: the classification comes from frame 10
    [7, 1, { frame_number: 10, atom_indices: [1, 2, 3] }],
    [7, 4, { frame_number: 10, atom_indices: [] }],
  ])(`frame %i, type %i`, (frame_idx, type_code, expected) => {
    expect(cna_type_source_atoms(sweep, frame_idx, type_code)).toEqual(expected)
  })

  test.each<[string, StructureIdSweep]>([
    [`empty sweep`, { frame_numbers: [], results: [], frame_stride: 1 }],
    [
      `CNA skipped`,
      { frame_numbers: [0], results: [{ ...result([1]), cna_types: null }], frame_stride: 1 },
    ],
  ])(`%s gives null`, (_name, empty_sweep) => {
    expect(cna_type_source_atoms(empty_sweep, 0, 1)).toBeNull()
  })
})
