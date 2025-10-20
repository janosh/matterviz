import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { PymatgenStructure } from '$lib/structure'
import { make_supercell, parse_supercell_scaling } from '$lib/structure/supercell'
import { describe, expect, test } from 'vitest'

// Create a large test structure
function create_test_structure(num_sites: number): PymatgenStructure {
  const lattice_matrix: Matrix3x3 = [
    [10, 0, 0],
    [0, 10, 0],
    [0, 0, 10],
  ]

  const sites = Array.from({ length: num_sites }, (_, idx) => ({
    species: [{ element: `Fe`, occu: 1, oxidation_state: 0 }],
    xyz: [Math.random() * 10, Math.random() * 10, Math.random() * 10] as Vec3,
    abc: [Math.random(), Math.random(), Math.random()] as Vec3,
    label: `Fe${idx}`,
    properties: {},
  }))

  return {
    '@module': `pymatgen.core.structure`,
    '@class': `Structure`,
    lattice: {
      matrix: lattice_matrix,
      a: 10,
      b: 10,
      c: 10,
      alpha: 90,
      beta: 90,
      gamma: 90,
      volume: 1000,
      pbc: [true, true, true] as [boolean, boolean, boolean],
    },
    sites,
    charge: 0,
  }
}

describe(`supercell performance profiling`, () => {
  test(`profile matrix operations`, () => {
    const matrix: Matrix3x3 = [
      [10, 1, 0.5],
      [0.5, 10, 1],
      [1, 0.5, 10],
    ]

    const iterations = 10000
    const timings: Record<string, number> = {}

    // Test transpose
    let start = performance.now()
    for (let idx = 0; idx < iterations; idx++) {
      math.transpose_3x3_matrix(matrix)
    }
    timings.transpose = performance.now() - start

    // Test inverse
    start = performance.now()
    const transposed = math.transpose_3x3_matrix(matrix)
    for (let idx = 0; idx < iterations; idx++) {
      math.matrix_inverse_3x3(transposed)
    }
    timings.inverse = performance.now() - start

    // Test matrix-vector multiply
    const vec: Vec3 = [1, 2, 3]
    start = performance.now()
    for (let idx = 0; idx < iterations; idx++) {
      math.mat3x3_vec3_multiply(matrix, vec)
    }
    timings.mat_vec_multiply = performance.now() - start

    console.log(`Matrix operations (${iterations} iterations):`)
    console.log(`  Transpose: ${timings.transpose.toFixed(2)}ms`)
    console.log(`  Inverse: ${timings.inverse.toFixed(2)}ms`)
    console.log(`  Mat-Vec multiply: ${timings.mat_vec_multiply.toFixed(2)}ms`)

    expect(timings.transpose).toBeLessThan(100)
    expect(timings.inverse).toBeLessThan(500)
    expect(timings.mat_vec_multiply).toBeLessThan(100)
  })

  test(`profile supercell generation phases`, () => {
    const structure = create_test_structure(100)
    const scaling = `3x3x3`
    const scaling_factors = parse_supercell_scaling(scaling)
    const [nx, ny, nz] = scaling_factors
    const det = nx * ny * nz

    const timings: Record<string, number> = {}

    // Phase 1: Matrix setup
    let start = performance.now()
    const new_lattice_matrix = [
      math.scale(structure.lattice.matrix[0], nx),
      math.scale(structure.lattice.matrix[1], ny),
      math.scale(structure.lattice.matrix[2], nz),
    ] as Matrix3x3
    const orig_lattice_T = math.transpose_3x3_matrix(structure.lattice.matrix)
    const new_lattice_T = math.transpose_3x3_matrix(new_lattice_matrix)
    const new_lattice_T_inv = math.matrix_inverse_3x3(new_lattice_T)
    timings.matrix_setup = performance.now() - start

    // Phase 2: Translation vector computation
    start = performance.now()
    const translations = new Float64Array(det * 3)
    let trans_idx = 0
    for (let kk = 0; kk < nz; kk++) {
      for (let jj = 0; jj < ny; jj++) {
        for (let ii = 0; ii < nx; ii++) {
          translations[trans_idx++] = orig_lattice_T[0][0] * ii +
            orig_lattice_T[0][1] * jj + orig_lattice_T[0][2] * kk
          translations[trans_idx++] = orig_lattice_T[1][0] * ii +
            orig_lattice_T[1][1] * jj + orig_lattice_T[1][2] * kk
          translations[trans_idx++] = orig_lattice_T[2][0] * ii +
            orig_lattice_T[2][1] * jj + orig_lattice_T[2][2] * kk
        }
      }
    }
    timings.translation_vectors = performance.now() - start

    // Phase 3: Site generation
    start = performance.now()
    const new_sites = new Array(structure.sites.length * det)
    let site_idx = 0
    trans_idx = 0
    for (let kk = 0; kk < nz; kk++) {
      for (let jj = 0; jj < ny; jj++) {
        for (let ii = 0; ii < nx; ii++) {
          const tx = translations[trans_idx++]
          const ty = translations[trans_idx++]
          const tz = translations[trans_idx++]
          const label_suffix = `_${ii}${jj}${kk}`

          for (let orig_idx = 0; orig_idx < structure.sites.length; orig_idx++) {
            const orig_site = structure.sites[orig_idx]
            const [ox, oy, oz] = orig_site.xyz

            const new_x = ox + tx
            const new_y = oy + ty
            const new_z = oz + tz

            let abc_x = new_lattice_T_inv[0][0] * new_x +
              new_lattice_T_inv[0][1] * new_y + new_lattice_T_inv[0][2] * new_z
            let abc_y = new_lattice_T_inv[1][0] * new_x +
              new_lattice_T_inv[1][1] * new_y + new_lattice_T_inv[1][2] * new_z
            let abc_z = new_lattice_T_inv[2][0] * new_x +
              new_lattice_T_inv[2][1] * new_y + new_lattice_T_inv[2][2] * new_z

            // Wrap coordinates
            abc_x = abc_x % 1
            if (abc_x < 0) abc_x += 1
            if (abc_x >= 1 - 1e-10) abc_x = 0
            abc_y = abc_y % 1
            if (abc_y < 0) abc_y += 1
            if (abc_y >= 1 - 1e-10) abc_y = 0
            abc_z = abc_z % 1
            if (abc_z < 0) abc_z += 1
            if (abc_z >= 1 - 1e-10) abc_z = 0

            const final_x = new_lattice_T[0][0] * abc_x +
              new_lattice_T[0][1] * abc_y + new_lattice_T[0][2] * abc_z
            const final_y = new_lattice_T[1][0] * abc_x +
              new_lattice_T[1][1] * abc_y + new_lattice_T[1][2] * abc_z
            const final_z = new_lattice_T[2][0] * abc_x +
              new_lattice_T[2][1] * abc_y + new_lattice_T[2][2] * abc_z

            new_sites[site_idx++] = {
              species: orig_site.species,
              xyz: [final_x, final_y, final_z] as Vec3,
              abc: [abc_x, abc_y, abc_z] as Vec3,
              label: `${orig_site.label}${label_suffix}`,
              properties: orig_site.properties,
            }
          }
        }
      }
    }
    timings.site_generation = performance.now() - start

    const total = Object.values(timings).reduce((sum, time) => sum + time, 0)

    console.log(
      `\nSupercell generation phases (100 sites → ${
        structure.sites.length * det
      } sites):`,
    )
    console.log(
      `  Matrix setup: ${timings.matrix_setup.toFixed(2)}ms (${
        ((timings.matrix_setup / total) * 100).toFixed(1)
      }%)`,
    )
    console.log(
      `  Translation vectors: ${timings.translation_vectors.toFixed(2)}ms (${
        ((timings.translation_vectors / total) * 100).toFixed(1)
      }%)`,
    )
    console.log(
      `  Site generation: ${timings.site_generation.toFixed(2)}ms (${
        ((timings.site_generation / total) * 100).toFixed(1)
      }%)`,
    )
    console.log(`  Total: ${total.toFixed(2)}ms`)

    expect(total).toBeLessThan(100)
  })

  test(`compare full supercell generation`, () => {
    const sizes = [50, 100, 200, 500]
    const results: Array<{ sites: number; time: number }> = []

    console.log(`\nFull supercell generation (3x3x3):`)
    for (const size of sizes) {
      const structure = create_test_structure(size)
      const start = performance.now()
      make_supercell(structure, `3x3x3`)
      const time = performance.now() - start
      results.push({ sites: size, time })
      console.log(`  ${size} → ${size * 27} sites: ${time.toFixed(2)}ms`)
    }

    // Check that it scales reasonably (should be roughly linear)
    const first_rate = results[0].time / results[0].sites
    const last_rate = results[results.length - 1].time / results[results.length - 1].sites
    expect(last_rate / first_rate).toBeLessThan(2) // Should not degrade more than 2x
  })
})
