import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { Crystal } from '$lib/structure'
import { make_supercell, parse_supercell_scaling } from '$lib/structure/supercell'
import process from 'node:process'
import { describe, expect, test } from 'vitest'
import { make_crystal } from '../setup'

// Create a large test structure with random Fe sites in a 10 Å cubic lattice
const make_perf_structure = (num_sites: number): Crystal =>
  make_crystal(
    10,
    Array.from({ length: num_sites }, () => ({
      element: `Fe`,
      xyz: [Math.random() * 10, Math.random() * 10, Math.random() * 10] as Vec3,
    })),
    { charge: 0 },
  )

// Increase thresholds in CI environment
const CI_MULTIPLIER = [`true`, `1`].includes(process.env.CI ?? ``) ? 5 : 1

describe(`supercell performance profiling`, () => {
  function time_fastest_run(callback: () => void, runs = 3): number {
    let fastest = Infinity
    for (let idx = 0; idx < runs; idx++) {
      const start = performance.now()
      callback()
      fastest = Math.min(fastest, performance.now() - start)
    }
    return fastest
  }

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

    expect(timings.transpose).toBeLessThan(100 * CI_MULTIPLIER)
    expect(timings.inverse).toBeLessThan(500 * CI_MULTIPLIER)
    expect(timings.mat_vec_multiply).toBeLessThan(100 * CI_MULTIPLIER)
  })

  test(`profile supercell generation phases`, () => {
    const structure = make_perf_structure(100)
    const scaling = `3x3x3`
    const scaling_factors = parse_supercell_scaling(scaling)
    const [nx, ny, nz] = scaling_factors
    const det = nx * ny * nz

    const timings: Record<string, number> = {}

    // Phase 1: Matrix setup
    let start = performance.now()
    const new_lattice_matrix: Matrix3x3 = [
      math.scale(structure.lattice.matrix[0], nx),
      math.scale(structure.lattice.matrix[1], ny),
      math.scale(structure.lattice.matrix[2], nz),
    ]
    const orig_lattice_T = math.transpose_3x3_matrix(structure.lattice.matrix)
    const [[orig00, orig01, orig02], [orig10, orig11, orig12], [orig20, orig21, orig22]] =
      orig_lattice_T
    const new_lattice_T = math.transpose_3x3_matrix(new_lattice_matrix)
    const new_lattice_T_inv = math.matrix_inverse_3x3(new_lattice_T)
    const [[inv00, inv01, inv02], [inv10, inv11, inv12], [inv20, inv21, inv22]] =
      new_lattice_T_inv
    const [[lat00, lat01, lat02], [lat10, lat11, lat12], [lat20, lat21, lat22]] = new_lattice_T
    timings.matrix_setup = performance.now() - start

    // Phase 2: Translation vector computation
    start = performance.now()
    const translations = new Float64Array(det * 3)
    let trans_idx = 0
    for (let kk = 0; kk < nz; kk++) {
      for (let jj = 0; jj < ny; jj++) {
        for (let ii = 0; ii < nx; ii++) {
          translations[trans_idx++] = orig00 * ii + orig01 * jj + orig02 * kk
          translations[trans_idx++] = orig10 * ii + orig11 * jj + orig12 * kk
          translations[trans_idx++] = orig20 * ii + orig21 * jj + orig22 * kk
        }
      }
    }
    timings.translation_vectors = performance.now() - start

    // Phase 3: Site generation
    start = performance.now()
    const new_sites = Array.from({ length: structure.sites.length * det })
    let site_idx = 0
    trans_idx = 0
    for (let kk = 0; kk < nz; kk++) {
      for (let jj = 0; jj < ny; jj++) {
        for (let ii = 0; ii < nx; ii++) {
          const tx = translations[trans_idx++]
          const ty = translations[trans_idx++]
          const tz = translations[trans_idx++]
          const label_suffix = `_${ii}${jj}${kk}`

          for (const orig_site of structure.sites) {
            const [ox, oy, oz] = orig_site.xyz

            const new_x = ox + tx
            const new_y = oy + ty
            const new_z = oz + tz

            let abc_x = inv00 * new_x + inv01 * new_y + inv02 * new_z
            let abc_y = inv10 * new_x + inv11 * new_y + inv12 * new_z
            let abc_z = inv20 * new_x + inv21 * new_y + inv22 * new_z

            // Wrap coordinates
            abc_x %= 1
            if (abc_x < 0) abc_x += 1
            if (abc_x >= 1 - 1e-10) abc_x = 0
            abc_y %= 1
            if (abc_y < 0) abc_y += 1
            if (abc_y >= 1 - 1e-10) abc_y = 0
            abc_z %= 1
            if (abc_z < 0) abc_z += 1
            if (abc_z >= 1 - 1e-10) abc_z = 0

            const final_x = lat00 * abc_x + lat01 * abc_y + lat02 * abc_z
            const final_y = lat10 * abc_x + lat11 * abc_y + lat12 * abc_z
            const final_z = lat20 * abc_x + lat21 * abc_y + lat22 * abc_z

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
    const { matrix_setup, translation_vectors, site_generation } = timings
    const pct = (ms: number) => ((ms / total) * 100).toFixed(1)

    console.warn(
      `\nSupercell generation phases (100 sites → ${structure.sites.length * det} sites):`,
    )
    console.warn(`  Matrix setup: ${matrix_setup.toFixed(2)}ms (${pct(matrix_setup)}%)`)
    console.warn(
      `  Translation vectors: ${translation_vectors.toFixed(2)}ms (${pct(translation_vectors)}%)`,
    )
    console.warn(
      `  Site generation: ${site_generation.toFixed(2)}ms (${pct(site_generation)}%)`,
    )
    console.warn(`  Total: ${total.toFixed(2)}ms`)

    // Should complete well under 15ms on typical hardware (15 × CI_MULTIPLIER in CI)
    expect(total).toBeLessThan(15 * CI_MULTIPLIER)
  })

  test(`compare full supercell generation`, () => {
    const sizes = [50, 100, 200, 500]
    const results: { sites: number; time: number }[] = []

    console.warn(`\nFull supercell generation (3x3x3):`)
    for (const size of sizes) {
      const structure = make_perf_structure(size)
      make_supercell(structure, `3x3x3`) // Warm up JIT and one-time allocations
      const time = time_fastest_run(() => make_supercell(structure, `3x3x3`))
      results.push({ sites: size, time })
      console.warn(`  ${size} → ${size * 27} sites: ${time.toFixed(2)}ms`)
    }

    // Check that it scales reasonably (should be roughly linear)
    const first_rate = results[0].time / results[0].sites
    const last_result = results[results.length - 1]
    const last_rate = last_result.time / last_result.sites

    // With linear scaling optimizations, the rate per atom should be fairly constant.
    // Allowing variance up to 2x to account for runtime fluctuations
    expect(last_rate / first_rate).toBeLessThan(2)

    // 500 atoms → 13500 sites should complete well under 20ms (20 × CI_MULTIPLIER in CI)
    expect(last_result.time).toBeLessThan(20 * CI_MULTIPLIER)
  })
})
