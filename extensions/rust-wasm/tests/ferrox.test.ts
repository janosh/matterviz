// Tests for matterviz-wasm - mirrors Python tests in extensions/rust/tests/
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

type WasmResult<T> = { ok: T } | { error: string }

let wasm: Awaited<typeof import('../pkg/ferrox.js')>

function unwrap<T>(result: WasmResult<T>): T {
  if (`error` in result) throw new Error(result.error)
  return result.ok
}

const nacl_json = {
  lattice: { matrix: [[5.64, 0, 0], [0, 5.64, 0], [0, 0, 5.64]] },
  sites: [
    { species: [{ element: `Na`, occu: 1 }], abc: [0, 0, 0] },
    { species: [{ element: `Cl`, occu: 1 }], abc: [0.5, 0.5, 0.5] },
  ],
}

const fcc_cu_json = {
  lattice: { matrix: [[3.6, 0, 0], [0, 3.6, 0], [0, 0, 3.6]] },
  sites: [
    { species: [{ element: `Cu`, occu: 1 }], abc: [0, 0, 0] },
    { species: [{ element: `Cu`, occu: 1 }], abc: [0.5, 0.5, 0] },
    { species: [{ element: `Cu`, occu: 1 }], abc: [0.5, 0, 0.5] },
    { species: [{ element: `Cu`, occu: 1 }], abc: [0, 0.5, 0.5] },
  ],
}

const bcc_fe_json = {
  lattice: { matrix: [[2.87, 0, 0], [0, 2.87, 0], [0, 0, 2.87]] },
  sites: [
    { species: [{ element: `Fe`, occu: 1 }], abc: [0, 0, 0] },
    { species: [{ element: `Fe`, occu: 1 }], abc: [0.5, 0.5, 0.5] },
  ],
}

beforeAll(async () => {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)
  const wasm_path = join(__dirname, `..`, `pkg`, `ferrox_bg.wasm`)
  const wasm_bytes = readFileSync(wasm_path)
  wasm = await import(`../pkg/ferrox.js`)
  await wasm.default(wasm_bytes)
})

describe(`JsElement`, () => {
  it(`creates element from symbol with correct properties`, () => {
    const fe = new wasm.JsElement(`Fe`)
    expect(fe.symbol).toBe(`Fe`)
    expect(fe.atomicNumber).toBe(26)
    expect(fe.name).toBe(`Iron`)
    expect(fe.atomicMass).toBeCloseTo(55.845, 2)
    expect(fe.row).toBe(4)
    expect(fe.group).toBe(8)
    expect(fe.block).toBe(`D`)
    expect(fe.electronegativity).toBeCloseTo(1.83, 1)
  })

  it.each(
    [
      [`Fe`, `isTransitionMetal`],
      [`Na`, `isAlkali`],
      [`He`, `isNobleGas`],
      [`Cl`, `isHalogen`],
    ] as const,
  )(`%s is classified correctly via %s()`, (symbol, method) => {
    const elem = new wasm.JsElement(symbol)
    expect(elem[method]()).toBe(true)
  })

  it(`rejects invalid symbols`, () => {
    expect(() => new wasm.JsElement(`InvalidSymbol`)).toThrow()
  })
})

describe(`JsSpecies`, () => {
  it.each(
    [
      [`Fe2+`, `Fe`, 2],
      [`Cl-`, `Cl`, -1],
      [`Cu`, `Cu`, undefined],
    ] as const,
  )(`parses %s as %s with oxidation %s`, (input, symbol, oxi) => {
    const sp = new wasm.JsSpecies(input)
    expect(sp.symbol).toBe(symbol)
    expect(sp.oxidationState).toBe(oxi)
  })
})

describe(`get_structure_metadata`, () => {
  it(`returns correct metadata for NaCl`, () => {
    const result = unwrap(wasm.get_structure_metadata(nacl_json))
    expect(result.formula).toBe(`NaCl`)
    expect(result.formula_anonymous).toBe(`AB`)
    expect(result.num_sites).toBe(2)
    expect(result.is_ordered).toBe(true)
    expect(result.volume).toBeCloseTo(5.64 ** 3, 1)
  })
})

describe(`symmetry functions`, () => {
  it.each(
    [
      [`fcc_cu`, fcc_cu_json, 225, `F m -3 m`, `cubic`],
      [`bcc_fe`, bcc_fe_json, 229, `I m -3 m`, `cubic`],
    ] as const,
  )(`detects symmetry for %s`, (_, structure, sg_num, sg_sym, crystal_sys) => {
    expect(unwrap(wasm.get_spacegroup_number(structure, 0.01))).toBe(sg_num)
    expect(unwrap(wasm.get_spacegroup_symbol(structure, 0.01))).toBe(sg_sym)
    expect(unwrap(wasm.get_crystal_system(structure, 0.01))).toBe(crystal_sys)
  })

  it(`gets full symmetry dataset`, () => {
    const dataset = unwrap(wasm.get_symmetry_dataset(fcc_cu_json, 0.01))
    expect(dataset.spacegroup_number).toBe(225)
    expect(dataset.wyckoff_letters).toHaveLength(4)
    expect(dataset.operations.length).toBeGreaterThan(0)
  })
})

describe(`supercell functions`, () => {
  it(`creates diagonal supercell`, () => {
    const supercell = unwrap(wasm.make_supercell_diag(nacl_json, 2, 2, 2))
    expect(supercell.sites).toHaveLength(16)
  })

  it(`creates supercell with matrix`, () => {
    const matrix: [
      [number, number, number],
      [number, number, number],
      [number, number, number],
    ] = [[2, 0, 0], [0, 2, 0], [0, 0, 1]]
    expect(unwrap(wasm.make_supercell(nacl_json, matrix)).sites).toHaveLength(8)
  })

  it(`rejects non-positive scaling factors`, () => {
    expect(`error` in wasm.make_supercell_diag(nacl_json, 0, 1, 1)).toBe(true)
  })
})

describe(`neighbor finding`, () => {
  it(`gets neighbor list with consistent array lengths`, () => {
    const result = unwrap(wasm.get_neighbor_list(nacl_json, 5.0, 1e-8, true))
    expect(result.center_indices.length).toBeGreaterThan(0)
    expect(result.center_indices.length).toBe(result.neighbor_indices.length)
    expect(result.center_indices.length).toBe(result.distances.length)
  })

  it(`gets distance matrix`, () => {
    const matrix = unwrap(wasm.get_distance_matrix(nacl_json))
    expect(matrix).toHaveLength(2)
    expect(matrix[0][0]).toBe(0)
    expect(matrix[0][1]).toBeGreaterThan(0)
  })

  it(`rejects out-of-bounds indices`, () => {
    expect(`error` in wasm.get_distance(nacl_json, 0, 99)).toBe(true)
  })
})

describe(`coordination analysis`, () => {
  it(`gets coordination numbers and local environment`, () => {
    const cns = unwrap(wasm.get_coordination_numbers(fcc_cu_json, 3.0))
    expect(cns).toHaveLength(4)
    const env = unwrap(wasm.get_local_environment(fcc_cu_json, 0, 3.0))
    expect(env.center_element).toBe(`Cu`)
    expect(env.coordination_number).toBeGreaterThanOrEqual(0)
  })

  it(`rejects negative cutoff`, () => {
    expect(`error` in wasm.get_coordination_numbers(nacl_json, -1.0)).toBe(true)
  })
})

describe(`structure manipulation`, () => {
  it(`wraps to unit cell`, () => {
    const wrapped = unwrap(wasm.wrap_to_unit_cell(nacl_json))
    wrapped.sites.forEach((site) =>
      site.abc.forEach((coord) => {
        expect(coord).toBeGreaterThanOrEqual(0)
        expect(coord).toBeLessThan(1)
      })
    )
  })
})

describe(`species manipulation`, () => {
  it(`substitutes species`, () => {
    const substituted = unwrap(wasm.substitute_species(nacl_json, `Na`, `K`))
    expect(substituted.sites.some((s) => s.species.some((sp) => sp.element === `K`)))
      .toBe(true)
  })

  it(`removes species`, () => {
    const removed = unwrap(wasm.remove_species(nacl_json, [`Na`]))
    expect(removed.sites).toHaveLength(1)
    expect(removed.sites[0].species[0].element).toBe(`Cl`)
  })
})

describe(`I/O functions`, () => {
  it.each([`CIF`, `POSCAR`] as const)(`roundtrips through %s format`, (format) => {
    const to_fn = format === `CIF` ? wasm.structure_to_cif : wasm.structure_to_poscar
    const parse_fn = format === `CIF` ? wasm.parse_cif : wasm.parse_poscar
    const output = unwrap(to_fn(nacl_json))
    expect(unwrap(parse_fn(output)).sites).toHaveLength(2)
  })
})

describe(`WasmStructureMatcher`, () => {
  it(`matches identical structures`, () => {
    expect(unwrap(new wasm.WasmStructureMatcher().fit(nacl_json, nacl_json))).toBe(true)
  })

  it(`deduplicates structures`, () => {
    const indices = unwrap(
      new wasm.WasmStructureMatcher().deduplicate([nacl_json, nacl_json, fcc_cu_json]),
    )
    expect(indices[0]).toBe(indices[1])
    expect(indices[2]).not.toBe(indices[0])
  })

  it(`finds matches`, () => {
    const matches = unwrap(
      new wasm.WasmStructureMatcher().find_matches([nacl_json], [fcc_cu_json, nacl_json]),
    )
    expect(matches[0]).toBe(1)
  })
})

// Perturbed NaCl with shifted sites (for testing non-zero distances)
const nacl_perturbed = {
  lattice: { matrix: [[5.64, 0, 0], [0, 5.64, 0], [0, 0, 5.64]] },
  sites: [
    { species: [{ element: `Na`, occu: 1 }], abc: [0.05, 0.0, 0.0] },
    { species: [{ element: `Cl`, occu: 1 }], abc: [0.55, 0.5, 0.5] },
  ],
}

describe(`WasmStructureMatcher.get_rms_dist`, () => {
  it.each([
    [`nacl`, nacl_json],
    [`fcc_cu`, fcc_cu_json],
    [`bcc_fe`, bcc_fe_json],
  ])(`returns rms=0, symmetric for identical %s structures`, (_, struct) => {
    const matcher = new wasm.WasmStructureMatcher()
    const result = unwrap(matcher.get_rms_dist(struct, struct))
    if (!result) throw new Error(`expected result`)
    expect(result.rms).toBeCloseTo(0, 14)
    expect(result.max_dist).toBeCloseTo(0, 14)
  })

  it(`perturbed: non-zero rms, symmetric`, () => {
    const matcher = new wasm.WasmStructureMatcher()
    const r1 = unwrap(matcher.get_rms_dist(nacl_json, nacl_perturbed))
    const r2 = unwrap(matcher.get_rms_dist(nacl_perturbed, nacl_json))
    if (!r1 || !r2) throw new Error(`expected results`)
    expect(r1.rms).toBeGreaterThan(0)
    expect(r1.rms).toBeLessThan(0.2)
    expect(r1.rms).toBeCloseTo(r2.rms, 10)
  })

  it(`returns falsy for incompatible structures`, () => {
    expect(unwrap(new wasm.WasmStructureMatcher().get_rms_dist(nacl_json, fcc_cu_json)))
      .toBeFalsy()
  })
})

describe(`WasmStructureMatcher.getStructureDistance`, () => {
  it(`identical=0, symmetric, finite for incompatible`, () => {
    const matcher = new wasm.WasmStructureMatcher()
    // Identical = 0
    expect(unwrap(matcher.getStructureDistance(nacl_json, nacl_json))).toBeCloseTo(0, 10)
    // Symmetric
    const d12 = unwrap(matcher.getStructureDistance(nacl_json, nacl_perturbed))
    const d21 = unwrap(matcher.getStructureDistance(nacl_perturbed, nacl_json))
    expect(d12).toBeCloseTo(d21, 10)
    // Incompatible returns finite (unlike get_rms_dist which returns null)
    const dist_diff = unwrap(matcher.getStructureDistance(nacl_json, fcc_cu_json))
    expect(Number.isFinite(dist_diff)).toBe(true)
    expect(dist_diff).toBeGreaterThan(d12) // Different composition > same composition
  })
})
