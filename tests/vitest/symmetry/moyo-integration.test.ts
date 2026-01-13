// Integration tests for moyo-wasm symmetry analysis
// Uses real WASM binary to verify symmetry detection behavior
// Note: Most symmetry tests use mocks (see index.test.ts, symmetry-utils.test.ts)

import { analyze_structure_symmetry, wyckoff_positions_from_moyo } from '$lib/symmetry'
import { structure_map } from '$site/structures'
import { beforeAll, describe, expect, test } from 'vitest'
import { init_moyo_for_tests } from '../setup'

// Helper to get structure or throw with descriptive error
function get_structure(id: string) {
  const structure = structure_map.get(id)
  if (!structure) throw new Error(`Structure ${id} not found`)
  return structure
}

describe(`moyo-wasm integration`, () => {
  beforeAll(init_moyo_for_tests)

  // Issue #139: Mg atoms were missing from Wyckoff table due to array length mismatch
  // between wyckoffs and std_cell.numbers. Fixed by iterating over std_cell.numbers.
  test.each([
    [`mp-1183085-Ac4Mg2-orthorhombic`, [`Ac`, `Mg`]],
    [`mp-1183089-Ac4Mg2-monoclinic`, [`Ac`, `Mg`]],
  ])(`%s Wyckoff table includes expected elements`, async (id, expected) => {
    const sym_data = await analyze_structure_symmetry(get_structure(id), {
      symprec: 1e-4,
    })
    const elements = wyckoff_positions_from_moyo(sym_data).map((pos) => pos.elem)
    expect(elements).toEqual(expect.arrayContaining(expected))
  })

  // Note: moyo-wasm returns HM symbols with spaces (e.g. "F m -3 m" not "Fm-3m")
  test.each([
    [`Cu-FCC`, 225],
    [`Fe-BCC`, 229],
    [`Po-simple-cubic`, 221],
    [`mp-862690-Ac4-hexagonal`, 194],
    [`mp-1207297-Ac2Br2O1-tetragonal`, 123],
  ])(`%s has space group %i`, async (id, expected_sg) => {
    const sym_data = await analyze_structure_symmetry(get_structure(id), {
      symprec: 1e-4,
    })
    expect(sym_data.number).toBe(expected_sg)
    expect(sym_data.hm_symbol).toBeDefined()
  })

  test.each([
    [`mp-1`, 1],
    [`mp-2`, 1],
    [`mp-1234`, 2],
  ])(`%s has %i unique Wyckoff positions`, async (id, expected_count) => {
    const sym_data = await analyze_structure_symmetry(get_structure(id), {
      symprec: 1e-4,
    })
    expect(wyckoff_positions_from_moyo(sym_data)).toHaveLength(expected_count)
  })

  test(`highly oblique TlBiSe2 cell is handled correctly`, async () => {
    const sym_data = await analyze_structure_symmetry(
      get_structure(`TlBiSe2-highly-oblique-cell`),
      { symprec: 1e-3 },
    )

    expect(sym_data.number).toBeGreaterThan(0)
    expect(sym_data.std_cell.numbers.length).toBeGreaterThan(0)

    const elements = wyckoff_positions_from_moyo(sym_data).map((pos) => pos.elem)
    expect(elements).toEqual(expect.arrayContaining([`Tl`, `Bi`, `Se`]))
  })
})
