import type { PhononBandStructure } from '$lib/bands'
import type { Matrix3x3, Vec3 } from '$lib/math'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { beforeAll, describe, expect, it } from 'vitest'

// Test fixtures - sample phonon data
const sample_phonon_data = {
  phonon_bandstructure: {
    lattice_rec: {
      matrix: [
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
      ] as Matrix3x3,
    },
    qpoints: [
      [0.0, 0.0, 0.0],
      [0.25, 0.0, 0.0],
      [0.5, 0.0, 0.0],
      [0.75, 0.0, 0.0],
      [1.0, 0.0, 0.0],
    ] as Vec3[],
    bands: [
      [0.0, 1.0, 2.0, 1.5, 0.5],
      [0.5, 1.5, 2.5, 2.0, 1.0],
      [1.0, 2.0, 3.0, 2.5, 1.5],
    ],
    labels_dict: {
      GAMMA: [0.0, 0.0, 0.0] as Vec3,
      X: [0.5, 0.0, 0.0] as Vec3,
      M: [1.0, 0.0, 0.0] as Vec3,
    },
    has_nac: false,
    has_imaginary_modes: false,
  },
  phonon_dos: {
    frequencies: [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0],
    densities: [0.1, 0.3, 0.5, 0.4, 0.3, 0.2, 0.1],
  },
}

const sample_phonon_with_imaginary = {
  phonon_bandstructure: {
    lattice_rec: {
      matrix: [
        [2.0, 0.0, 0.0],
        [0.0, 2.0, 0.0],
        [0.0, 0.0, 2.0],
      ] as Matrix3x3,
    },
    qpoints: [
      [0.0, 0.0, 0.0],
      [0.5, 0.0, 0.0],
      [1.0, 0.0, 0.0],
    ] as Vec3[],
    bands: [
      [-1.0, 0.0, 1.0], // Has negative frequency (imaginary mode)
      [0.5, 1.0, 1.5],
    ],
    labels_dict: {
      GAMMA: [0.0, 0.0, 0.0] as Vec3,
      X: [1.0, 0.0, 0.0] as Vec3,
    },
    has_nac: true,
    has_imaginary_modes: true,
  },
}

const sample_phonon_unlabeled_ends = {
  phonon_bandstructure: {
    lattice_rec: {
      matrix: [
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
      ] as Matrix3x3,
    },
    qpoints: [
      [0.0, 0.0, 0.0], // Unlabeled start
      [0.2, 0.0, 0.0],
      [0.4, 0.0, 0.0], // X label
      [0.6, 0.0, 0.0],
      [0.8, 0.0, 0.0], // M label
      [1.0, 0.0, 0.0], // Unlabeled end
    ] as Vec3[],
    bands: [[0.0, 1.0, 2.0, 1.5, 1.0, 0.5]],
    labels_dict: {
      X: [0.4, 0.0, 0.0] as Vec3,
      M: [0.8, 0.0, 0.0] as Vec3,
    },
    has_nac: false,
    has_imaginary_modes: false,
  },
}

const sample_phonon_multiple_gamma = {
  phonon_bandstructure: {
    lattice_rec: {
      matrix: [
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
      ] as Matrix3x3,
    },
    qpoints: [
      [0.0, 0.0, 0.0], // GAMMA (first)
      [0.25, 0.0, 0.0],
      [0.5, 0.0, 0.0], // X
      [0.25, 0.0, 0.0],
      [0.0, 0.0, 0.0], // GAMMA (second)
      [0.0, 0.5, 0.0], // Y
    ] as Vec3[],
    bands: [[0.0, 1.0, 2.0, 1.0, 0.0, 1.5]],
    labels_dict: {
      GAMMA: [0.0, 0.0, 0.0] as Vec3,
      X: [0.5, 0.0, 0.0] as Vec3,
      Y: [0.0, 0.5, 0.0] as Vec3,
    },
    has_nac: false,
    has_imaginary_modes: false,
  },
}

// Helper to create temporary test data files
const test_data_dir = join(process.cwd(), `src/site/phonons`)
const test_files: string[] = []

type PhononTestData = {
  phonon_bandstructure?: {
    lattice_rec: { matrix: Matrix3x3 }
    qpoints: Vec3[]
    bands: number[][]
    labels_dict: Record<string, Vec3>
    has_nac?: boolean
    has_imaginary_modes?: boolean
  }
  phonon_dos?: {
    frequencies: number[]
    densities: number[]
  }
}

function create_test_file(name: string, data: PhononTestData): string {
  const file_path = join(test_data_dir, `${name}.json`)
  writeFileSync(file_path, JSON.stringify(data))
  test_files.push(file_path)
  return file_path
}

describe(`Phonon Module - Real Import Tests`, () => {
  beforeAll(() => {
    create_test_file(`test-sample`, sample_phonon_data)
    create_test_file(`test-imaginary`, sample_phonon_with_imaginary)
    create_test_file(`test-unlabeled-ends`, sample_phonon_unlabeled_ends)
    create_test_file(`test-multiple-gamma`, sample_phonon_multiple_gamma)
  })

  it(`imports phonon module with phonon_bands and phonon_dos`, async () => {
    const { phonon_bands, phonon_dos } = await import(`$site/phonons`)
    expect(phonon_bands).toBeDefined()
    expect(phonon_dos).toBeDefined()
    expect(typeof phonon_bands).toBe(`object`)
    expect(typeof phonon_dos).toBe(`object`)
    expect(Object.keys(phonon_bands).length).toBeGreaterThan(0)
  })

  it(`transforms band structure with all required fields`, async () => {
    const { phonon_bands } = await import(`$site/phonons`)
    const band_struct = phonon_bands[`test-sample`] as PhononBandStructure

    expect(band_struct).toHaveProperty(`lattice_rec`)
    expect(band_struct).toHaveProperty(`branches`)
    expect(band_struct).toHaveProperty(`labels_dict`)
    expect(band_struct).toHaveProperty(`has_nac`)
    expect(band_struct).toHaveProperty(`has_imaginary_modes`)
    expect(band_struct.qpoints).toHaveLength(5)
    expect(band_struct.distance).toHaveLength(5)
    expect(band_struct.nb_bands).toBe(3)
    expect(band_struct.bands).toHaveLength(3)
  })

  it.each([
    { idx: 0, label: `GAMMA`, coords: [0.0, 0.0, 0.0] },
    { idx: 1, label: null, coords: [0.25, 0.0, 0.0] },
    { idx: 2, label: `X`, coords: [0.5, 0.0, 0.0] },
    { idx: 3, label: null, coords: [0.75, 0.0, 0.0] },
    { idx: 4, label: `M`, coords: [1.0, 0.0, 0.0] },
  ])(
    `assigns label $label at qpoint $idx with coords $coords`,
    async ({ idx, label, coords }) => {
      const { phonon_bands } = await import(`$site/phonons`)
      const band_struct = phonon_bands[`test-sample`]
      expect(band_struct.qpoints[idx].label).toBe(label)
      expect(band_struct.qpoints[idx].frac_coords).toEqual(coords)
    },
  )

  it(`calculates cumulative distances monotonically`, async () => {
    const { phonon_bands } = await import(`$site/phonons`)
    const band_struct = phonon_bands[`test-sample`]

    expect(band_struct.qpoints[0].distance).toBe(0)
    for (let idx = 1; idx < band_struct.qpoints.length; idx++) {
      const current_dist = band_struct.qpoints[idx].distance
      const prev_dist = band_struct.qpoints[idx - 1].distance
      expect(current_dist).toBeDefined()
      expect(prev_dist).toBeDefined()
      if (current_dist !== undefined && prev_dist !== undefined) {
        expect(current_dist).toBeGreaterThan(prev_dist)
      }
    }
    expect(band_struct.qpoints[4].distance).toBe(
      band_struct.distance[band_struct.distance.length - 1],
    )
  })

  it(`creates branches between labeled points`, async () => {
    const { phonon_bands } = await import(`$site/phonons`)
    const band_struct = phonon_bands[`test-sample`]

    expect(band_struct.branches).toHaveLength(2)
    expect(band_struct.branches[0]).toEqual({
      start_index: 0,
      end_index: 2,
      name: `GAMMA-X`,
    })
    expect(band_struct.branches[1]).toEqual({
      start_index: 2,
      end_index: 4,
      name: `X-M`,
    })
  })

  it(`handles head and tail segments for unlabeled ends`, async () => {
    const { phonon_bands } = await import(`$site/phonons`)
    const band_struct = phonon_bands[`test-unlabeled-ends`]

    expect(band_struct.branches.length).toBeGreaterThanOrEqual(2)
    const has_head = band_struct.branches.some(
      (branch) => branch.start_index === 0 && branch.name.startsWith(`0-`),
    )
    const has_tail = band_struct.branches.some(
      (branch) =>
        branch.end_index === band_struct.qpoints.length - 1 &&
        branch.name.endsWith(`-end`),
    )
    expect(has_head || has_tail).toBe(true)
  })

  it(`handles multiple occurrences of same label`, async () => {
    const { phonon_bands } = await import(`$site/phonons`)
    const band_struct = phonon_bands[`test-multiple-gamma`]

    expect(band_struct.qpoints[0].label).toBe(`GAMMA`)
    expect(band_struct.qpoints[4].label).toBe(`GAMMA`)
    expect(band_struct.branches.length).toBeGreaterThanOrEqual(2)
  })

  it.each([
    { key: `test-sample`, has_nac: false, has_imaginary: false },
    { key: `test-imaginary`, has_nac: true, has_imaginary: true },
  ])(
    `preserves has_nac=$has_nac and has_imaginary_modes=$has_imaginary for $key`,
    async ({ key, has_nac, has_imaginary }) => {
      const { phonon_bands } = await import(`$site/phonons`)
      const band_struct = phonon_bands[key]
      expect(band_struct.has_nac).toBe(has_nac)
      expect(band_struct.has_imaginary_modes).toBe(has_imaginary)
    },
  )

  it(`handles non-orthogonal lattice with correct distance calculation`, async () => {
    const { phonon_bands } = await import(`$site/phonons`)
    const band_struct = phonon_bands[`test-sample`]

    expect(band_struct.lattice_rec.matrix).toBeDefined()
    expect(band_struct.distance[0]).toBe(0)
    for (let idx = 1; idx < band_struct.distance.length; idx++) {
      expect(band_struct.distance[idx]).toBeGreaterThan(band_struct.distance[idx - 1])
    }
  })

  it(`exports DOS data with frequencies and densities`, async () => {
    const { phonon_dos } = await import(`$site/phonons`)
    const dos = phonon_dos[`test-sample`]

    expect(dos).toBeDefined()
    expect(dos).toHaveProperty(`frequencies`)
    expect(dos).toHaveProperty(`densities`)
    expect(dos.frequencies).toHaveLength(7)
    expect(dos.densities).toHaveLength(7)
    expect(Array.isArray(dos.frequencies)).toBe(true)
    expect(Array.isArray(dos.densities)).toBe(true)
  })

  it(`handles band structure data independently`, async () => {
    const { phonon_bands } = await import(`$site/phonons`)
    const band_struct = phonon_bands[`test-imaginary`]

    expect(band_struct).toBeDefined()
    expect(Array.isArray(band_struct.qpoints)).toBe(true)
    expect(Array.isArray(band_struct.bands)).toBe(true)
    expect(Array.isArray(band_struct.branches)).toBe(true)
  })

  it(`calculates distances efficiently`, async () => {
    const { phonon_bands } = await import(`$site/phonons`)
    const band_struct = phonon_bands[`test-sample`]

    const start = performance.now()
    const distances = band_struct.distance
    const end = performance.now()

    expect(end - start).toBeLessThan(10)
    expect(distances.length).toBe(5)
  })
})
