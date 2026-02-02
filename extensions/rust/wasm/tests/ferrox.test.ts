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
    expect(fe.atomic_number).toBe(26)
    expect(fe.name).toBe(`Iron`)
    expect(fe.atomic_mass).toBeCloseTo(55.845, 2)
    expect(fe.row).toBe(4)
    expect(fe.group).toBe(8)
    expect(fe.block).toBe(`D`)
    expect(fe.electronegativity).toBeCloseTo(1.83, 1)
  })

  it.each(
    [
      [`Fe`, `is_transition_metal`],
      [`Na`, `is_alkali`],
      [`He`, `is_noble_gas`],
      [`Cl`, `is_halogen`],
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
    expect(sp.oxidation_state).toBe(oxi)
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

describe(`XRD functions`, () => {
  it(`computes XRD pattern for NaCl`, () => {
    const pattern = unwrap(wasm.compute_xrd(nacl_json, {}))
    expect(pattern.two_theta.length).toBeGreaterThan(0)
    const n = pattern.two_theta.length
    expect(pattern.intensities).toHaveLength(n)
    expect(pattern.hkls).toHaveLength(n)
    expect(pattern.d_spacings).toHaveLength(n)
  })

  it(`scales intensities to 100`, () => {
    const pattern = unwrap(wasm.compute_xrd(nacl_json, { scaled: true }))
    expect(Math.max(...pattern.intensities)).toBeCloseTo(100, 0)
  })

  it(`respects two_theta_range`, () => {
    const pattern = unwrap(wasm.compute_xrd(nacl_json, { two_theta_range: [20, 60] }))
    expect(pattern.two_theta.every((tt) => tt >= 20 && tt <= 60)).toBe(true)
  })

  it(`shorter wavelength -> peaks at lower 2θ`, () => {
    const cu_ka = unwrap(wasm.compute_xrd(nacl_json, { wavelength: 1.54184 }))
    const mo_ka = unwrap(wasm.compute_xrd(nacl_json, { wavelength: 0.71073 }))
    expect(Math.min(...mo_ka.two_theta)).toBeLessThan(Math.min(...cu_ka.two_theta))
  })

  it(`hkl info has correct structure`, () => {
    const pattern = unwrap(wasm.compute_xrd(nacl_json, {}))
    for (const peak_hkls of pattern.hkls) {
      for (const info of peak_hkls) {
        expect(info.hkl).toHaveLength(3)
        expect(info.multiplicity).toBeGreaterThan(0)
      }
    }
  })

  it(`d_spacings are positive`, () => {
    const pattern = unwrap(wasm.compute_xrd(nacl_json, {}))
    expect(pattern.d_spacings.every((d) => d > 0)).toBe(true)
  })

  it.each([-1, 0])(`rejects invalid wavelength %s`, (wavelength) => {
    expect(`error` in wasm.compute_xrd(nacl_json, { wavelength })).toBe(true)
  })

  it.each(
    [
      [[-10, 90], `min<0`],
      [[0, 200], `max>180`],
      [[90, 10], `min>max`],
    ] as const,
  )(`rejects invalid two_theta_range %s (%s)`, (two_theta_range) => {
    expect(`error` in wasm.compute_xrd(nacl_json, { two_theta_range })).toBe(true)
  })

  it(`returns atomic scattering params as JSON`, () => {
    const params = JSON.parse(wasm.get_atomic_scattering_params())
    expect(params).toHaveProperty(`Fe`)
    expect(params).toHaveProperty(`Na`)
    expect(params.Fe).toHaveLength(4)
    expect(params.D).toEqual(params.H)
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

describe(`WasmStructureMatcher.get_structure_distance`, () => {
  it(`identical=0, symmetric, finite for incompatible`, () => {
    const matcher = new wasm.WasmStructureMatcher()
    // Identical = 0
    expect(unwrap(matcher.get_structure_distance(nacl_json, nacl_json))).toBeCloseTo(
      0,
      10,
    )
    // Symmetric
    const d12 = unwrap(matcher.get_structure_distance(nacl_json, nacl_perturbed))
    const d21 = unwrap(matcher.get_structure_distance(nacl_perturbed, nacl_json))
    expect(d12).toBeCloseTo(d21, 10)
    // Incompatible returns finite (unlike get_rms_dist which returns null)
    const dist_diff = unwrap(matcher.get_structure_distance(nacl_json, fcc_cu_json))
    expect(Number.isFinite(dist_diff)).toBe(true)
    expect(dist_diff).toBeGreaterThan(d12) // Different composition > same composition
  })
})

// === Interatomic Potentials ===

describe(`compute_lennard_jones`, () => {
  it(`computes correct energy at r = sigma (should be zero)`, () => {
    const sigma = 1.0
    const positions = new Float64Array([0, 0, 0, sigma, 0, 0])
    const result = unwrap(wasm.compute_lennard_jones(
      positions,
      null,
      true,
      true,
      true,
      sigma,
      1.0,
      null,
      false,
    ))
    expect(result.energy).toBeCloseTo(0, 10)
  })

  it(`computes correct energy at equilibrium (r = 2^(1/6) * sigma)`, () => {
    const sigma = 1.0
    const epsilon = 1.0
    const r_eq = Math.pow(2, 1 / 6) * sigma
    const positions = new Float64Array([0, 0, 0, r_eq, 0, 0])
    const result = unwrap(wasm.compute_lennard_jones(
      positions,
      null,
      true,
      true,
      true,
      sigma,
      epsilon,
      null,
      false,
    ))
    expect(result.energy).toBeCloseTo(-epsilon, 10)
    // Forces should be near zero at equilibrium
    expect(Math.abs(result.forces[0])).toBeLessThan(1e-10)
    expect(Math.abs(result.forces[3])).toBeLessThan(1e-10)
  })

  it(`forces satisfy momentum conservation`, () => {
    const positions = new Float64Array([0, 0, 0, 1.5, 0.5, 0.2, 2.5, 1.0, 0.5])
    const result = unwrap(wasm.compute_lennard_jones(
      positions,
      null,
      false,
      false,
      false,
      1.0,
      1.0,
      null,
      false,
    ))
    // Sum forces for each atom
    let sum_x = 0
    let sum_y = 0
    let sum_z = 0
    for (let idx = 0; idx < result.forces.length; idx += 3) {
      sum_x += result.forces[idx]
      sum_y += result.forces[idx + 1]
      sum_z += result.forces[idx + 2]
    }
    expect(Math.abs(sum_x)).toBeLessThan(1e-12)
    expect(Math.abs(sum_y)).toBeLessThan(1e-12)
    expect(Math.abs(sum_z)).toBeLessThan(1e-12)
  })

  it(`respects cutoff`, () => {
    const positions = new Float64Array([0, 0, 0, 5.0, 0, 0])
    const result = unwrap(wasm.compute_lennard_jones(
      positions,
      null,
      false,
      false,
      false,
      1.0,
      1.0,
      3.0,
      false,
    ))
    expect(result.energy).toBeCloseTo(0, 14)
  })

  it(`computes stress tensor when requested`, () => {
    const positions = new Float64Array([0, 0, 0, 1.5, 0, 0])
    const cell = new Float64Array([5, 0, 0, 0, 5, 0, 0, 0, 5])
    const result = unwrap(wasm.compute_lennard_jones(
      positions,
      cell,
      true,
      true,
      true,
      1.0,
      1.0,
      null,
      true,
    ))
    expect(result.stress).not.toBeNull()
    expect(result.stress).toHaveLength(6)
    // xx component should be non-zero for 1D chain
    if (result.stress) expect(Math.abs(result.stress[0])).toBeGreaterThan(0)
  })
})

describe(`compute_morse`, () => {
  it(`computes correct energy at equilibrium (r = r0)`, () => {
    const well_depth = 1.0
    const r0 = 1.2
    const positions = new Float64Array([0, 0, 0, r0, 0, 0])
    const result = unwrap(wasm.compute_morse(
      positions,
      null,
      false,
      false,
      false,
      well_depth,
      1.5,
      r0,
      10.0,
      false,
    ))
    expect(result.energy).toBeCloseTo(-well_depth, 10)
  })

  it(`forces are zero at equilibrium`, () => {
    const r0 = 1.2
    const positions = new Float64Array([0, 0, 0, r0, 0, 0])
    const result = unwrap(wasm.compute_morse(
      positions,
      null,
      false,
      false,
      false,
      1.0,
      1.5,
      r0,
      10.0,
      false,
    ))
    expect(Math.abs(result.forces[0])).toBeLessThan(1e-10)
    expect(Math.abs(result.forces[3])).toBeLessThan(1e-10)
  })

  it(`energy approaches zero at large distance`, () => {
    const positions = new Float64Array([0, 0, 0, 20.0, 0, 0])
    const result = unwrap(wasm.compute_morse(
      positions,
      null,
      false,
      false,
      false,
      1.0,
      2.0,
      1.0,
      100.0,
      false,
    ))
    expect(Math.abs(result.energy)).toBeLessThan(1e-6)
  })
})

describe(`compute_soft_sphere`, () => {
  it(`computes correct energy at r = sigma (should equal epsilon)`, () => {
    const sigma = 1.0
    const epsilon = 1.0
    const alpha = 12.0
    const positions = new Float64Array([0, 0, 0, sigma, 0, 0])
    const result = unwrap(wasm.compute_soft_sphere(
      positions,
      null,
      false,
      false,
      false,
      sigma,
      epsilon,
      alpha,
      10.0,
      false,
    ))
    expect(result.energy).toBeCloseTo(epsilon, 10)
  })

  it(`is always repulsive`, () => {
    const positions = new Float64Array([0, 0, 0, 0.8, 0, 0])
    const result = unwrap(wasm.compute_soft_sphere(
      positions,
      null,
      false,
      false,
      false,
      1.0,
      1.0,
      6.0,
      10.0,
      false,
    ))
    // Force on atom 0 should be negative (pushed away from atom 1)
    expect(result.forces[0]).toBeLessThan(0)
    // Force on atom 1 should be positive (pushed away from atom 0)
    expect(result.forces[3]).toBeGreaterThan(0)
  })
})

describe(`compute_harmonic_bonds`, () => {
  it(`energy is zero at equilibrium`, () => {
    const positions = new Float64Array([0, 0, 0, 1.0, 0, 0])
    const bonds = new Float64Array([0, 1, 1.0, 1.0]) // i=0, j=1, k=1.0, r0=1.0
    const result = unwrap(wasm.compute_harmonic_bonds(
      positions,
      bonds,
      null,
      false,
      false,
      false,
      false,
    ))
    expect(result.energy).toBeCloseTo(0, 14)
  })

  it(`computes correct energy for stretched bond`, () => {
    const spring_k = 2.0
    const r0 = 1.0
    const dist = 1.5
    const positions = new Float64Array([0, 0, 0, dist, 0, 0])
    const bonds = new Float64Array([0, 1, spring_k, r0])
    const result = unwrap(wasm.compute_harmonic_bonds(
      positions,
      bonds,
      null,
      false,
      false,
      false,
      false,
    ))
    const expected = 0.5 * spring_k * Math.pow(dist - r0, 2)
    expect(result.energy).toBeCloseTo(expected, 12)
  })

  it(`computes correct force for stretched bond`, () => {
    const spring_k = 2.0
    const r0 = 1.0
    const dist = 1.2
    const positions = new Float64Array([0, 0, 0, dist, 0, 0])
    const bonds = new Float64Array([0, 1, spring_k, r0])
    const result = unwrap(wasm.compute_harmonic_bonds(
      positions,
      bonds,
      null,
      false,
      false,
      false,
      false,
    ))
    // F = -k(r - r0), negative because stretched
    const expected_force = -spring_k * (dist - r0)
    expect(result.forces[3]).toBeCloseTo(expected_force, 12)
    expect(result.forces[0]).toBeCloseTo(-expected_force, 12)
  })

  it(`handles multiple bonds`, () => {
    const positions = new Float64Array([0, 0, 0, 1.0, 0, 0, 2.2, 0, 0])
    const bonds = new Float64Array([
      0,
      1,
      1.0,
      1.0, // equilibrium
      1,
      2,
      1.0,
      1.0, // stretched by 0.2
    ])
    const result = unwrap(wasm.compute_harmonic_bonds(
      positions,
      bonds,
      null,
      false,
      false,
      false,
      false,
    ))
    const expected = 0.5 * 1.0 * Math.pow(0.2, 2)
    expect(result.energy).toBeCloseTo(expected, 12)
  })

  it(`forces sum to zero`, () => {
    const positions = new Float64Array([0, 0, 0, 1.2, 0.3, 0.1, 2.5, 0.8, 0.4])
    const bonds = new Float64Array([0, 1, 1.0, 1.0, 1, 2, 1.5, 1.2])
    const result = unwrap(wasm.compute_harmonic_bonds(
      positions,
      bonds,
      null,
      false,
      false,
      false,
      false,
    ))
    let sum_x = 0
    let sum_y = 0
    let sum_z = 0
    for (let idx = 0; idx < result.forces.length; idx += 3) {
      sum_x += result.forces[idx]
      sum_y += result.forces[idx + 1]
      sum_z += result.forces[idx + 2]
    }
    expect(Math.abs(sum_x)).toBeLessThan(1e-12)
    expect(Math.abs(sum_y)).toBeLessThan(1e-12)
    expect(Math.abs(sum_z)).toBeLessThan(1e-12)
  })
})
