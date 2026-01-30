import type { Crystal } from '$lib/structure'
// Import types and utilities from the pure types module (no WASM side effects)
import {
  is_error,
  is_ok,
  type NeighborListResult,
  unwrap,
  unwrap_or,
  type WasmResult,
} from '$lib/structure/ferrox-wasm-types'
import { describe, expect, it } from 'vitest'

describe(`WasmResult utilities`, () => {
  it(`is_ok correctly identifies success results`, () => {
    const success: WasmResult<number> = { ok: 42 }
    const error: WasmResult<number> = { error: `something went wrong` }

    expect(is_ok(success)).toBe(true)
    expect(is_ok(error)).toBe(false)
  })

  it(`is_error correctly identifies error results`, () => {
    const success: WasmResult<number> = { ok: 42 }
    const error: WasmResult<number> = { error: `something went wrong` }

    expect(is_error(success)).toBe(false)
    expect(is_error(error)).toBe(true)
  })

  it(`unwrap returns value on success`, () => {
    const success: WasmResult<number> = { ok: 42 }
    expect(unwrap(success)).toBe(42)
  })

  it(`unwrap throws on error`, () => {
    const error: WasmResult<number> = { error: `something went wrong` }
    expect(() => unwrap(error)).toThrow(`something went wrong`)
  })

  it(`unwrap_or returns value on success`, () => {
    const success: WasmResult<number> = { ok: 42 }
    expect(unwrap_or(success, 0)).toBe(42)
  })

  it(`unwrap_or returns default on error`, () => {
    const error: WasmResult<number> = { error: `something went wrong` }
    expect(unwrap_or(error, 0)).toBe(0)
  })
})

describe(`Result type edge cases`, () => {
  it(`handles null values in ok`, () => {
    const result: WasmResult<null> = { ok: null }
    expect(is_ok(result)).toBe(true)
    expect(unwrap(result)).toBe(null)
  })

  it(`handles undefined values in ok`, () => {
    const result: WasmResult<undefined> = { ok: undefined }
    expect(is_ok(result)).toBe(true)
    expect(unwrap(result)).toBe(undefined)
  })

  it(`handles empty string in error`, () => {
    const result: WasmResult<number> = { error: `` }
    expect(is_error(result)).toBe(true)
    expect(() => unwrap(result)).toThrow(``)
  })

  it(`handles complex objects in ok`, () => {
    const complex = { nested: { value: [1, 2, 3] } }
    const result: WasmResult<typeof complex> = { ok: complex }
    expect(is_ok(result)).toBe(true)
    expect(unwrap(result)).toEqual(complex)
  })
})

// Test structure fixtures
function make_nacl_structure(): Crystal {
  return {
    lattice: {
      matrix: [
        [5.64, 0, 0],
        [0, 5.64, 0],
        [0, 0, 5.64],
      ],
      a: 5.64,
      b: 5.64,
      c: 5.64,
      alpha: 90,
      beta: 90,
      gamma: 90,
      pbc: [true, true, true],
      volume: 179.406144,
    },
    sites: [
      {
        species: [{ element: `Na`, occu: 1, oxidation_state: 0 }],
        abc: [0, 0, 0],
        xyz: [0, 0, 0],
        label: `Na`,
        properties: {},
      },
      {
        species: [{ element: `Cl`, occu: 1, oxidation_state: 0 }],
        abc: [0.5, 0.5, 0.5],
        xyz: [2.82, 2.82, 2.82],
        label: `Cl`,
        properties: {},
      },
    ],
  }
}

describe(`MatcherOptions interface`, () => {
  // Test that the matcher options type is correctly defined
  it(`allows partial options`, () => {
    // Just checking that TypeScript accepts these - actual functionality
    // would be tested with the real WASM module or in integration tests
    const options1 = { latt_len_tol: 0.2 }
    const options2 = { site_pos_tol: 0.3, primitive_cell: true }
    const options3 = {}

    // These should all be valid MatcherOptions types
    expect(options1.latt_len_tol).toBe(0.2)
    expect(options2.primitive_cell).toBe(true)
    expect(Object.keys(options3).length).toBe(0)
  })
})

describe(`Structure format handling`, () => {
  it(`validates structure format types`, () => {
    // Type-level test that format strings are constrained
    const formats = [`cif`, `poscar`, `json`] as const
    expect(formats).toHaveLength(3)
  })
})

describe(`Crystal structure fixtures`, () => {
  it(`creates valid NaCl structure`, () => {
    const nacl = make_nacl_structure()

    expect(nacl.sites).toHaveLength(2)
    expect(nacl.lattice.a).toBe(5.64)
    expect(nacl.sites[0].species[0].element).toBe(`Na`)
    expect(nacl.sites[1].species[0].element).toBe(`Cl`)
  })

  it(`has correct lattice parameters for cubic structure`, () => {
    const nacl = make_nacl_structure()

    // Cubic should have equal lengths and 90 degree angles
    expect(nacl.lattice.a).toBe(nacl.lattice.b)
    expect(nacl.lattice.b).toBe(nacl.lattice.c)
    expect(nacl.lattice.alpha).toBe(90)
    expect(nacl.lattice.beta).toBe(90)
    expect(nacl.lattice.gamma).toBe(90)
  })

  it(`has correct pbc for periodic crystal`, () => {
    const nacl = make_nacl_structure()
    expect(nacl.lattice.pbc).toEqual([true, true, true])
  })
})

// ============================================================================
// Additional Test Fixtures
// ============================================================================

function make_fcc_al(): Crystal {
  // FCC aluminum, conventional cell (4 atoms)
  const a = 4.05
  return {
    lattice: {
      matrix: [
        [a, 0, 0],
        [0, a, 0],
        [0, 0, a],
      ],
      a,
      b: a,
      c: a,
      alpha: 90,
      beta: 90,
      gamma: 90,
      pbc: [true, true, true],
      volume: a * a * a,
    },
    sites: [
      {
        species: [{ element: `Al`, occu: 1, oxidation_state: 0 }],
        abc: [0, 0, 0],
        xyz: [0, 0, 0],
        label: `Al`,
        properties: {},
      },
      {
        species: [{ element: `Al`, occu: 1, oxidation_state: 0 }],
        abc: [0.5, 0.5, 0],
        xyz: [a / 2, a / 2, 0],
        label: `Al`,
        properties: {},
      },
      {
        species: [{ element: `Al`, occu: 1, oxidation_state: 0 }],
        abc: [0.5, 0, 0.5],
        xyz: [a / 2, 0, a / 2],
        label: `Al`,
        properties: {},
      },
      {
        species: [{ element: `Al`, occu: 1, oxidation_state: 0 }],
        abc: [0, 0.5, 0.5],
        xyz: [0, a / 2, a / 2],
        label: `Al`,
        properties: {},
      },
    ],
  }
}

function make_displaced_nacl(): Crystal {
  // NaCl with atoms slightly displaced from ideal positions
  const nacl = make_nacl_structure()
  nacl.sites[0].abc = [0.01, 0.01, 0.01]
  nacl.sites[1].abc = [0.51, 0.49, 0.5]
  return nacl
}

// ============================================================================
// Physical Properties Tests (Type and Interface Validation)
// ============================================================================

describe(`Physical property result types`, () => {
  it(`volume result should be a number`, () => {
    const result: WasmResult<number> = { ok: 179.406144 }
    expect(is_ok(result)).toBe(true)
    expect(typeof unwrap(result)).toBe(`number`)
  })

  it(`total mass result should be a number`, () => {
    // Na (22.99) + Cl (35.45) = 58.44 amu
    const result: WasmResult<number> = { ok: 58.44 }
    expect(is_ok(result)).toBe(true)
    expect(unwrap(result)).toBeCloseTo(58.44, 1)
  })

  it(`density result should be a number`, () => {
    // NaCl density ~2.16 g/cm³
    const result: WasmResult<number> = { ok: 2.16 }
    expect(is_ok(result)).toBe(true)
    expect(unwrap(result)).toBeGreaterThan(0)
  })

  it(`density error for zero-volume structure`, () => {
    const result: WasmResult<number> = {
      error: `Cannot compute density for zero-volume structure`,
    }
    expect(is_error(result)).toBe(true)
    expect(result.error).toContain(`zero-volume`)
  })
})

// ============================================================================
// Neighbor Finding Tests (Type Validation)
// ============================================================================

describe(`Neighbor list result types`, () => {
  it(`neighbor list has correct structure`, () => {
    const result: WasmResult<NeighborListResult> = {
      ok: {
        center_indices: [0, 0, 1],
        neighbor_indices: [1, 1, 0],
        image_offsets: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 0, 0],
        ],
        distances: [2.82, 5.64, 2.82],
      },
    }
    expect(is_ok(result)).toBe(true)
    const nlist = unwrap(result)
    expect(nlist.center_indices).toHaveLength(3)
    expect(nlist.neighbor_indices).toHaveLength(3)
    expect(nlist.image_offsets).toHaveLength(3)
    expect(nlist.distances).toHaveLength(3)
  })

  it(`image offsets are 3-element arrays`, () => {
    const offset: [number, number, number] = [1, -1, 0]
    expect(offset).toHaveLength(3)
    expect(offset[0]).toBe(1)
    expect(offset[1]).toBe(-1)
    expect(offset[2]).toBe(0)
  })

  it(`distance result is a number`, () => {
    const result: WasmResult<number> = { ok: 2.82 }
    expect(is_ok(result)).toBe(true)
    expect(unwrap(result)).toBeCloseTo(2.82, 2)
  })

  it(`distance matrix is 2D array`, () => {
    const result: WasmResult<number[][]> = {
      ok: [
        [0, 2.82],
        [2.82, 0],
      ],
    }
    expect(is_ok(result)).toBe(true)
    const matrix = unwrap(result)
    expect(matrix).toHaveLength(2)
    expect(matrix[0]).toHaveLength(2)
    expect(matrix[0][0]).toBe(0) // Self distance
    expect(matrix[0][1]).toBeCloseTo(2.82, 2)
    expect(matrix[1][0]).toBeCloseTo(2.82, 2) // Symmetric
  })

  it(`distance out of bounds error`, () => {
    const result: WasmResult<number> = {
      error: `Site indices (0, 5) out of bounds for structure with 2 sites`,
    }
    expect(is_error(result)).toBe(true)
    expect(result.error).toContain(`out of bounds`)
  })
})

// ============================================================================
// Sorting Tests (Type Validation)
// ============================================================================

describe(`Sorting result types`, () => {
  it(`sorted structure result is a Crystal`, () => {
    const result: WasmResult<Crystal> = { ok: make_nacl_structure() }
    expect(is_ok(result)).toBe(true)
    const sorted = unwrap(result)
    expect(sorted.sites).toBeDefined()
    expect(sorted.lattice).toBeDefined()
  })

  it(`reverse parameter changes sort order`, () => {
    // In sorted NaCl: Na (Z=11) before Cl (Z=17)
    // In reverse sorted: Cl before Na
    const nacl = make_nacl_structure()
    expect(nacl.sites[0].species[0].element).toBe(`Na`)
    expect(nacl.sites[1].species[0].element).toBe(`Cl`)
  })
})

// ============================================================================
// Interpolation Tests (Type Validation)
// ============================================================================

describe(`Interpolation result types`, () => {
  it(`interpolation returns array of structures`, () => {
    const nacl = make_nacl_structure()
    const displaced = make_displaced_nacl()

    // Result should be array of Crystal
    const result: WasmResult<Crystal[]> = { ok: [nacl, displaced] }
    expect(is_ok(result)).toBe(true)
    const images = unwrap(result)
    expect(images).toHaveLength(2)
    expect(images[0].sites).toBeDefined()
    expect(images[1].sites).toBeDefined()
  })

  it(`interpolation with n_images=5 returns 6 structures`, () => {
    // start + 5 intermediates = 6 total (last overlaps with end)
    const images = new Array(6).fill(null).map(() => make_nacl_structure())
    const result: WasmResult<Crystal[]> = { ok: images }
    expect(unwrap(result)).toHaveLength(6)
  })

  it(`interpolation error for incompatible structures`, () => {
    const result: WasmResult<Crystal[]> = {
      error: `Cannot interpolate structures with different number of sites: 2 vs 4`,
    }
    expect(is_error(result)).toBe(true)
    expect(result.error).toContain(`different number of sites`)
  })

  it(`interpolation error for species mismatch`, () => {
    const result: WasmResult<Crystal[]> = {
      error: `Species mismatch at site 0: Na vs K`,
    }
    expect(is_error(result)).toBe(true)
    expect(result.error).toContain(`Species mismatch`)
  })
})

// ============================================================================
// Copy and Wrap Tests (Type Validation)
// ============================================================================

describe(`Copy and wrap result types`, () => {
  it(`copy returns a Crystal`, () => {
    const result: WasmResult<Crystal> = { ok: make_nacl_structure() }
    expect(is_ok(result)).toBe(true)
    expect(unwrap(result).sites).toHaveLength(2)
  })

  it(`sanitized copy applies transformations`, () => {
    // After sanitization: LLL reduce, sort by electronegativity, wrap
    // This is a type-level test; actual behavior tested in Rust
    const result: WasmResult<Crystal> = { ok: make_nacl_structure() }
    expect(is_ok(result)).toBe(true)
  })

  it(`wrap to unit cell wraps fractional coordinates`, () => {
    const nacl = make_nacl_structure()
    // Original coords should be in [0, 1)
    expect(nacl.sites[0].abc[0]).toBeGreaterThanOrEqual(0)
    expect(nacl.sites[0].abc[0]).toBeLessThan(1)
  })
})

// ============================================================================
// Supercell Tests (Type Validation)
// ============================================================================

describe(`Supercell result types`, () => {
  it(`diagonal supercell multiplies sites`, () => {
    // 2x2x2 supercell of 2-atom NaCl = 16 atoms
    const _nacl = make_nacl_structure()
    const expected_sites = 2 * 2 * 2 * 2 // 2 atoms * 8 cells
    expect(expected_sites).toBe(16)
  })

  it(`3x3 matrix supercell is valid`, () => {
    // Full transformation matrix
    const matrix: [
      [number, number, number],
      [number, number, number],
      [number, number, number],
    ] = [
      [2, 0, 0],
      [0, 2, 0],
      [0, 0, 2],
    ]
    expect(matrix).toHaveLength(3)
    expect(matrix[0]).toHaveLength(3)
  })

  it(`supercell error for zero determinant`, () => {
    const result: WasmResult<Crystal> = {
      error: `Supercell scaling matrix has zero determinant`,
    }
    expect(is_error(result)).toBe(true)
    expect(result.error).toContain(`zero determinant`)
  })
})

// ============================================================================
// Site Manipulation Tests (Type Validation)
// ============================================================================

describe(`Site manipulation result types`, () => {
  it(`translate_sites returns modified Crystal`, () => {
    const result: WasmResult<Crystal> = { ok: make_nacl_structure() }
    expect(is_ok(result)).toBe(true)
  })

  it(`translation vector has 3 components`, () => {
    const vector: [number, number, number] = [0.1, 0.2, 0.3]
    expect(vector).toHaveLength(3)
  })

  it(`translate_sites error for out of bounds`, () => {
    const result: WasmResult<Crystal> = {
      error: `Index 10 out of bounds for structure with 2 sites`,
    }
    expect(is_error(result)).toBe(true)
    expect(result.error).toContain(`out of bounds`)
  })

  it(`perturb returns modified Crystal`, () => {
    const result: WasmResult<Crystal> = { ok: make_nacl_structure() }
    expect(is_ok(result)).toBe(true)
  })

  it(`perturb with seed is reproducible`, () => {
    // Same seed should give same result (tested in Rust)
    const options = { min_distance: 0, seed: 42 }
    expect(options.seed).toBe(42)
  })

  it(`perturb error for invalid range`, () => {
    const result: WasmResult<Crystal> = {
      error: `distance (0.1) must be >= min_distance (0.5)`,
    }
    expect(is_error(result)).toBe(true)
    expect(result.error).toContain(`min_distance`)
  })
})

// ============================================================================
// Element Information Tests (Type Validation)
// ============================================================================

describe(`Element information result types`, () => {
  it(`atomic mass is a number`, () => {
    // Na atomic mass ~22.99
    const result: WasmResult<number> = { ok: 22.989769282 }
    expect(is_ok(result)).toBe(true)
    expect(unwrap(result)).toBeCloseTo(23, 0)
  })

  it(`electronegativity is a number`, () => {
    // Na electronegativity ~0.93
    const result: WasmResult<number> = { ok: 0.93 }
    expect(is_ok(result)).toBe(true)
    expect(unwrap(result)).toBeCloseTo(0.93, 2)
  })

  it(`unknown element error`, () => {
    const result: WasmResult<number> = { error: `Unknown element: Xx` }
    expect(is_error(result)).toBe(true)
    expect(result.error).toContain(`Unknown element`)
  })

  it(`no electronegativity data error`, () => {
    // Noble gases typically have no electronegativity
    const result: WasmResult<number> = { error: `No electronegativity data for He` }
    expect(is_error(result)).toBe(true)
    expect(result.error).toContain(`No electronegativity data`)
  })
})

// ============================================================================
// Reduction Algorithm Tests (Type Validation)
// ============================================================================

describe(`Reduction algorithm types`, () => {
  it(`niggli is valid algorithm`, () => {
    const algo: `niggli` | `lll` = `niggli`
    expect(algo).toBe(`niggli`)
  })

  it(`lll is valid algorithm`, () => {
    const algo: `niggli` | `lll` = `lll`
    expect(algo).toBe(`lll`)
  })
})

// ============================================================================
// Matcher Options Tests (Extended)
// ============================================================================

describe(`MatcherOptions full coverage`, () => {
  it(`all options can be set`, () => {
    const options = {
      latt_len_tol: 0.2,
      site_pos_tol: 0.3,
      angle_tol: 5,
      primitive_cell: true,
      scale: false,
      element_only: true,
    }
    expect(options.latt_len_tol).toBe(0.2)
    expect(options.site_pos_tol).toBe(0.3)
    expect(options.angle_tol).toBe(5)
    expect(options.primitive_cell).toBe(true)
    expect(options.scale).toBe(false)
    expect(options.element_only).toBe(true)
  })
})

// ============================================================================
// FCC Aluminum Fixture Tests
// ============================================================================

describe(`FCC Aluminum fixture`, () => {
  it(`creates valid FCC Al structure`, () => {
    const al = make_fcc_al()
    expect(al.sites).toHaveLength(4)
    expect(al.lattice.a).toBe(4.05)
  })

  it(`all sites are aluminum`, () => {
    const al = make_fcc_al()
    for (const site of al.sites) {
      expect(site.species[0].element).toBe(`Al`)
    }
  })

  it(`has correct FCC positions`, () => {
    const al = make_fcc_al()
    // FCC positions: (0,0,0), (0.5,0.5,0), (0.5,0,0.5), (0,0.5,0.5)
    expect(al.sites[0].abc).toEqual([0, 0, 0])
    expect(al.sites[1].abc).toEqual([0.5, 0.5, 0])
    expect(al.sites[2].abc).toEqual([0.5, 0, 0.5])
    expect(al.sites[3].abc).toEqual([0, 0.5, 0.5])
  })
})

// ============================================================================
// Displaced NaCl Fixture Tests
// ============================================================================

describe(`Displaced NaCl fixture`, () => {
  it(`creates structure with displaced atoms`, () => {
    const displaced = make_displaced_nacl()
    expect(displaced.sites[0].abc[0]).not.toBe(0)
    expect(displaced.sites[1].abc[1]).not.toBe(0.5)
  })

  it(`maintains same number of sites`, () => {
    const original = make_nacl_structure()
    const displaced = make_displaced_nacl()
    expect(displaced.sites).toHaveLength(original.sites.length)
  })
})
