// same_composition_pairs: the structure diff demo's bundled same-formula examples
import type { AnyStructure } from '#lib/structure/index.js'
import { compute_structure_diff } from '#lib/structure-diff/compute.js'
import {
  parse_structure_fixture,
  same_composition_pairs,
  structure_files,
} from '#site/structures.js'
import { expect, test } from 'vite-plus/test'
import { make_crystal } from '../test-fixtures'

const nacl = (lattice: number, n_cells = 1, pbc?: [boolean, boolean, boolean]) =>
  make_crystal(
    lattice,
    Array.from({ length: n_cells }, (_, idx) => [
      [`Na`, [0, 0, idx / n_cells]],
      [`Cl`, [0.5, 0.5, idx / n_cells]],
    ]).flat() as [string, [number, number, number]][],
    { pbc },
  )
const names = (pairs: [{ name: string }, { name: string }][]) =>
  pairs.map(([first, second]) => `${first.name}+${second.name}`)

test(`pairs need equal formula, site count and periodicity and cells within 25% in volume`, () => {
  const entries: { name: string; structure: AnyStructure }[] = [
    { name: `a`, structure: nacl(5) },
    { name: `b`, structure: nacl(5.3) }, // +19% volume: pairs with a
    { name: `c`, structure: nacl(5.5) }, // +33% vs a, +12% vs b
    { name: `double`, structure: nacl(5, 2) }, // same reduced formula, twice the sites
    { name: `slab`, structure: nacl(5, 1, [true, true, false]) },
    { name: `molecule`, structure: { sites: nacl(5).sites } },
    { name: `molecule 2`, structure: { sites: nacl(9).sites } },
  ]
  expect(names(same_composition_pairs(entries))).toEqual([`a+b`, `b+c`, `molecule+molecule 2`])
})

test(`bundled pairs are the expected polymorphs and re-encodings, and all diff cleanly`, () => {
  const pairs = same_composition_pairs(
    structure_files.map(({ name }) => ({ name, structure: parse_structure_fixture(name) })),
  )
  expect(names(pairs)).toEqual([
    `LiFePO4.cif+mp-19017.json.gz`,
    `NaCl-cubic.poscar+NaCl-rocksalt.pdb`,
    `mp-1183085-Ac4Mg2-orthorhombic.json+mp-1183089-Ac4Mg2-monoclinic.json`,
  ])
  for (const [first, second] of pairs) {
    expect(() => compute_structure_diff(first.structure, second.structure)).not.toThrow()
  }
})
