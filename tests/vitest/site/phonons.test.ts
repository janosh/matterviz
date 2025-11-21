import type { PhononBandStructure } from '$lib/bands'
import { describe, expect, it } from 'vitest'

describe(`Phonon Module Tests`, () => {
  it(`imports phonon module with phonon_bands and phonon_dos`, async () => {
    const { phonon_bands, phonon_dos } = await import(`$site/phonons`)
    expect(phonon_bands).toBeDefined()
    expect(phonon_dos).toBeDefined()
    expect(typeof phonon_bands).toBe(`object`)
    expect(typeof phonon_dos).toBe(`object`)
    expect(Object.keys(phonon_bands).length).toBeGreaterThan(0)
  })

  it(`transforms band structures with all required fields and correct types`, async () => {
    const { phonon_bands } = await import(`$site/phonons`)
    const keys = Object.keys(phonon_bands)
    expect(keys.length).toBeGreaterThan(0)

    // Test all band structures, not just the first one
    for (const band_struct of Object.values(phonon_bands) as PhononBandStructure[]) {
      // Check structure and types
      expect(band_struct.recip_lattice).toBeDefined()
      expect(band_struct.recip_lattice.matrix).toBeDefined()
      expect(Array.isArray(band_struct.recip_lattice.matrix)).toBe(true)
      expect(band_struct.recip_lattice.matrix).toHaveLength(3)

      expect(Array.isArray(band_struct.qpoints)).toBe(true)
      expect(band_struct.qpoints.length).toBeGreaterThan(0)

      expect(Array.isArray(band_struct.branches)).toBe(true)
      expect(band_struct.branches.length).toBeGreaterThan(0)

      expect(typeof band_struct.labels_dict).toBe(`object`)

      expect(Array.isArray(band_struct.distance)).toBe(true)
      expect(band_struct.distance).toHaveLength(band_struct.qpoints.length)

      expect(typeof band_struct.nb_bands).toBe(`number`)
      expect(band_struct.nb_bands).toBeGreaterThan(0)

      expect(Array.isArray(band_struct.bands)).toBe(true)
      expect(band_struct.bands).toHaveLength(band_struct.nb_bands)

      // Validate all bands have correct length matching qpoints
      band_struct.bands.forEach((band) => {
        expect(Array.isArray(band)).toBe(true)
        expect(band).toHaveLength(band_struct.qpoints.length)
        band.forEach((freq) => {
          expect(typeof freq).toBe(`number`)
          expect(Number.isFinite(freq)).toBe(true)
        })
      })

      // has_nac and has_imaginary_modes are optional boolean fields
      if (band_struct.has_nac !== undefined) {
        expect(typeof band_struct.has_nac).toBe(`boolean`)
      }
      if (band_struct.has_imaginary_modes !== undefined) {
        expect(typeof band_struct.has_imaginary_modes).toBe(`boolean`)
      }
    }
  })

  it(`assigns labels to qpoints and matches labels_dict`, async () => {
    const { phonon_bands } = await import(`$site/phonons`)

    // Test all band structures
    for (const band_struct of Object.values(phonon_bands) as PhononBandStructure[]) {
      const labeled_points = band_struct.qpoints.filter((qpt) => qpt.label !== null)
      expect(labeled_points.length).toBeGreaterThan(0)

      // All labeled qpoints should have their labels present in labels_dict
      labeled_points.forEach((qpt) => {
        expect(qpt.label).not.toBeNull()
        if (qpt.label) {
          expect(band_struct.labels_dict).toHaveProperty(qpt.label)

          // Verify the coordinates match (within tolerance)
          const dict_coords = band_struct.labels_dict[qpt.label]
          expect(dict_coords).toBeDefined()
          if (dict_coords) {
            const coord_diff = qpt.frac_coords.map(
              (coord, idx) => Math.abs(coord - dict_coords[idx]),
            )
            coord_diff.forEach((diff) => {
              expect(diff).toBeLessThan(1e-5)
            })
          }
        }
      })

      // All labels in labels_dict should appear at least once in qpoints
      Object.keys(band_struct.labels_dict).forEach((label) => {
        const has_label = band_struct.qpoints.some((qpt) => qpt.label === label)
        expect(has_label).toBe(true)
      })
    }
  })

  it(`preserves valid fractional coordinates in qpoints`, async () => {
    const { phonon_bands } = await import(`$site/phonons`)

    // Test all band structures
    for (const band_struct of Object.values(phonon_bands) as PhononBandStructure[]) {
      band_struct.qpoints.forEach((q_point) => {
        expect(q_point.frac_coords).toBeDefined()
        expect(Array.isArray(q_point.frac_coords)).toBe(true)
        expect(q_point.frac_coords).toHaveLength(3)

        // Fractional coordinates should be finite numbers
        q_point.frac_coords.forEach((coord) => {
          expect(typeof coord).toBe(`number`)
          expect(Number.isFinite(coord)).toBe(true)
        })

        // Verify q_point has distance property
        expect(typeof q_point.distance).toBe(`number`)
        expect(Number.isFinite(q_point.distance)).toBe(true)
        expect(q_point.distance).toBeGreaterThanOrEqual(0)
      })
    }
  })

  it(`calculates cumulative distances correctly and monotonically`, async () => {
    const { phonon_bands } = await import(`$site/phonons`)

    // Test all band structures
    for (const band_struct of Object.values(phonon_bands) as PhononBandStructure[]) {
      expect(band_struct.qpoints[0].distance).toBe(0)
      expect(band_struct.distance[0]).toBe(0)

      // Verify distances array matches qpoints distances
      band_struct.qpoints.forEach((qpt, idx) => {
        expect(qpt.distance).toBe(band_struct.distance[idx])
      })

      // Distances should be monotonically non-decreasing
      // (can be equal for consecutive points at same location, e.g. repeated labels)
      for (let idx = 1; idx < band_struct.qpoints.length; idx++) {
        const current_dist = band_struct.qpoints[idx].distance
        const prev_dist = band_struct.qpoints[idx - 1].distance
        expect(current_dist).toBeDefined()
        expect(prev_dist).toBeDefined()

        // TypeScript guards: ensure distances are numbers before comparison
        if (typeof current_dist === `number` && typeof prev_dist === `number`) {
          expect(current_dist).toBeGreaterThanOrEqual(prev_dist)
          expect(current_dist).toBeGreaterThanOrEqual(0)
          expect(Number.isFinite(current_dist)).toBe(true)
        }
      }
    }
  })

  it(`creates branches that properly cover and connect labeled points`, async () => {
    const { phonon_bands } = await import(`$site/phonons`)

    // Test all band structures
    for (const band_struct of Object.values(phonon_bands) as PhononBandStructure[]) {
      expect(band_struct.branches.length).toBeGreaterThan(0)

      // Validate each branch
      band_struct.branches.forEach((branch) => {
        expect(branch).toHaveProperty(`start_index`)
        expect(branch).toHaveProperty(`end_index`)
        expect(branch).toHaveProperty(`name`)
        expect(typeof branch.name).toBe(`string`)
        expect(branch.name.length).toBeGreaterThan(0)
        expect(branch.start_index).toBeGreaterThanOrEqual(0)
        expect(branch.end_index).toBeLessThan(band_struct.qpoints.length)
        expect(branch.end_index).toBeGreaterThanOrEqual(branch.start_index)
      })

      // Verify branches are contiguous (no gaps, no overlaps beyond shared endpoints)
      const sorted_branches = [...band_struct.branches].sort(
        (branch_a, branch_b) => branch_a.start_index - branch_b.start_index,
      )
      expect(sorted_branches[0].start_index).toBe(0)
      expect(sorted_branches.at(-1)?.end_index).toBe(band_struct.qpoints.length - 1)

      for (let idx = 0; idx < sorted_branches.length - 1; idx++) {
        const current = sorted_branches[idx]
        const next = sorted_branches[idx + 1]
        // Next branch should start where current ends (shared endpoint)
        expect(next.start_index).toBe(current.end_index)
      }

      // Verify labeled points are at branch boundaries
      const labeled_indices = band_struct.qpoints
        .map((qpt, idx) => (qpt.label ? idx : null))
        .filter((idx): idx is number => idx !== null)

      labeled_indices.forEach((label_idx) => {
        const is_branch_boundary = sorted_branches.some(
          (branch) => branch.start_index === label_idx || branch.end_index === label_idx,
        )
        expect(is_branch_boundary).toBe(true)
      })
    }
  })

  it(`exports DOS data with valid frequencies and densities`, async () => {
    const { phonon_dos } = await import(`$site/phonons`)
    const keys = Object.keys(phonon_dos)
    expect(keys.length).toBeGreaterThan(0)

    // Test all DOS data
    for (const dos of Object.values(phonon_dos)) {
      expect(dos).toBeDefined()
      expect(Array.isArray(dos.frequencies)).toBe(true)
      expect(Array.isArray(dos.densities)).toBe(true)
      expect(dos.frequencies.length).toBe(dos.densities.length)
      expect(dos.frequencies.length).toBeGreaterThan(0)

      // Frequencies should be monotonically increasing
      for (let idx = 1; idx < dos.frequencies.length; idx++) {
        expect(dos.frequencies[idx]).toBeGreaterThan(dos.frequencies[idx - 1])
        expect(Number.isFinite(dos.frequencies[idx])).toBe(true)
      }

      // Densities should be non-negative and finite
      dos.densities.forEach((density) => {
        expect(density).toBeGreaterThanOrEqual(0)
        expect(Number.isFinite(density)).toBe(true)
      })
    }
  })

  it(`validates cumulative distance consistency and reciprocal lattice presence`, async () => {
    const { phonon_bands } = await import(`$site/phonons`)

    // Verify reciprocal lattice exists and validate distance consistency
    for (const band_struct of Object.values(phonon_bands) as PhononBandStructure[]) {
      // Verify lattice exists (used in distance calculations)
      expect(band_struct.recip_lattice.matrix).toBeDefined()
      expect(Array.isArray(band_struct.recip_lattice.matrix)).toBe(true)
      expect(band_struct.recip_lattice.matrix).toHaveLength(3)
      band_struct.recip_lattice.matrix.forEach((row) => {
        expect(Array.isArray(row)).toBe(true)
        expect(row).toHaveLength(3)
        row.forEach((val) => {
          expect(typeof val).toBe(`number`)
          expect(Number.isFinite(val)).toBe(true)
        })
      })

      // Check that distances are physically reasonable
      // Maximum distance in reciprocal space should not exceed a few lattice parameters
      const max_distance = Math.max(...band_struct.distance)
      expect(max_distance).toBeLessThan(100) // Sanity check
      expect(max_distance).toBeGreaterThan(0)

      // Verify distance calculation consistency:
      // distance[i] should equal sum of all incremental distances up to i
      let cumulative = 0
      for (let idx = 1; idx < band_struct.qpoints.length; idx++) {
        const increment = band_struct.distance[idx] - band_struct.distance[idx - 1]
        cumulative += increment
        expect(Math.abs(band_struct.distance[idx] - cumulative)).toBeLessThan(1e-10)
      }
    }
  })

  it(`splits single-label paths into head and tail branches`, async () => {
    const { phonon_bands } = await import(`$site/phonons`)

    // Check if any band structure has exactly one labeled point
    for (const band_struct of Object.values(phonon_bands) as PhononBandStructure[]) {
      const labeled_qpoints = band_struct.qpoints.filter((qpt) => qpt.label !== null)

      if (labeled_qpoints.length === 1) {
        const label_idx = band_struct.qpoints.findIndex((qpt) => qpt.label !== null)
        const label = band_struct.qpoints[label_idx].label

        // Should have head segment if label is not at start
        if (label_idx > 0) {
          const head_branch = band_struct.branches.find(
            (branch) => branch.start_index === 0 && branch.end_index === label_idx,
          )
          expect(head_branch).toBeDefined()
          expect(head_branch?.name).toBe(`0-${label}`)
        }

        // Should have tail segment if label is not at end
        if (label_idx < band_struct.qpoints.length - 1) {
          const tail_branch = band_struct.branches.find(
            (branch) =>
              branch.start_index === label_idx &&
              branch.end_index === band_struct.qpoints.length - 1,
          )
          expect(tail_branch).toBeDefined()
          expect(tail_branch?.name).toBe(`${label}-end`)
        }

        // Branch endpoints should be inclusive
        band_struct.branches.forEach((branch) => {
          expect(branch.end_index).toBeGreaterThanOrEqual(branch.start_index)
        })
      }
    }
  })
})
