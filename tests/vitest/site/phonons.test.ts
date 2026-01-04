import type { PhononBandStructure } from '$lib/spectral'
import { phonon_bands, phonon_data, phonon_dos } from '$site/phonons'
import { describe, expect, it } from 'vitest'

describe(`Phonon Module Tests`, () => {
  it(`imports phonon module with phonon_bands and phonon_dos`, () => {
    expect(phonon_bands).toBeDefined()
    expect(phonon_dos).toBeDefined()
    expect(typeof phonon_bands).toBe(`object`)
    expect(typeof phonon_dos).toBe(`object`)
    expect(Object.keys(phonon_bands).length).toBeGreaterThan(0)
    expect(Object.keys(phonon_dos).length).toBeGreaterThan(0)
  })

  it(`transforms band structures with all required fields and correct types`, () => {
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

  it(`assigns labels to qpoints and matches labels_dict`, () => {
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

  it(`preserves valid fractional coordinates in qpoints`, () => {
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

  it(`calculates cumulative distances correctly and monotonically`, () => {
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

  it(`creates branches that properly cover and connect labeled points`, () => {
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

  it(`exports DOS data with valid frequencies and densities`, () => {
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

  it(`validates cumulative distance consistency and reciprocal lattice presence`, () => {
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

  // Verify branch naming follows "start_label-end_label" convention
  it.each(Object.entries(phonon_bands))(
    `%s branch names match endpoint labels`,
    (id, band_struct) => {
      for (const branch of band_struct.branches) {
        expect(branch.name.length, `${id}: branch name`).toBeGreaterThan(0)

        const start_label = band_struct.qpoints[branch.start_index]?.label
        const end_label = band_struct.qpoints[branch.end_index]?.label

        if (start_label && end_label) {
          expect(branch.name, `${id}`).toBe(`${start_label}-${end_label}`)
        } else if (start_label) {
          expect(branch.name, `${id}`).toContain(start_label)
        } else if (end_label) {
          expect(branch.name, `${id}`).toContain(end_label)
        }
      }
    },
  )

  // Verify each real phonon file has expected structure characteristics
  // Minimum qpoints threshold: band structure calculations typically sample 100+ k-points
  // along high-symmetry paths. This catches incomplete or corrupted data files.
  const MIN_QPOINTS = 100

  it.each(Object.entries(phonon_bands))(
    `%s has valid band structure with correct dimensions`,
    (id, band_struct) => {
      // Verify minimum expected content
      expect(band_struct.qpoints.length, `${id}: should have qpoints`).toBeGreaterThan(
        MIN_QPOINTS,
      )
      expect(band_struct.nb_bands, `${id}: should have bands`).toBeGreaterThan(0)
      expect(
        Object.keys(band_struct.labels_dict).length,
        `${id}: should have labeled points`,
      ).toBeGreaterThan(0)

      // Verify labeled points count matches labels_dict entries
      const labeled_count = band_struct.qpoints.filter((q) => q.label !== null).length
      expect(
        labeled_count,
        `${id}: labeled qpoints should match labels_dict`,
      ).toBeGreaterThanOrEqual(Object.keys(band_struct.labels_dict).length)

      // Verify branch count is reasonable (at least 1 per pair of consecutive labels)
      const num_labels = Object.keys(band_struct.labels_dict).length
      expect(
        band_struct.branches.length,
        `${id}: should have at least ${num_labels - 1} branches`,
      ).toBeGreaterThanOrEqual(num_labels - 1)

      // Verify all bands have consistent length
      for (const [band_idx, band] of band_struct.bands.entries()) {
        expect(
          band.length,
          `${id}: band ${band_idx} should have ${band_struct.qpoints.length} points`,
        ).toBe(band_struct.qpoints.length)
      }
    },
  )

  // Verify raw phonon data files are loaded and transformed correctly
  it.each(Object.keys(phonon_data))(
    `%s raw data is correctly transformed to PhononBandStructure`,
    (id) => {
      const raw = phonon_data[id]
      const transformed = phonon_bands[id]

      // Verify raw data exists
      expect(raw, `${id}: raw data should exist`).toBeDefined()
      expect(raw.phonon_bandstructure, `${id}: should have phonon_bandstructure`)
        .toBeDefined()

      // Verify transformation produces valid output
      expect(transformed, `${id}: transformed data should exist`).toBeDefined()

      // Verify qpoint count matches raw data
      const raw_qpoints = raw.phonon_bandstructure?.qpoints
      if (raw_qpoints) {
        expect(transformed.qpoints.length, `${id}: qpoint count should match`).toBe(
          raw_qpoints.length,
        )
      }

      // Verify band count matches raw data
      const raw_bands = raw.phonon_bandstructure?.bands
      if (raw_bands) {
        expect(transformed.nb_bands, `${id}: band count should match`).toBe(
          raw_bands.length,
        )
      }

      // Verify labels_dict is preserved
      const raw_labels = raw.phonon_bandstructure?.labels_dict
      if (raw_labels) {
        expect(
          Object.keys(transformed.labels_dict).sort(),
          `${id}: labels should match`,
        ).toEqual(Object.keys(raw_labels).sort())
      }
    },
  )

  // Verify frequency values are physically reasonable for phonons
  it.each(Object.entries(phonon_bands))(
    `%s has physically reasonable phonon frequencies`,
    (id, band_struct) => {
      // Phonon frequencies in THz: typically -5 to 50 THz for most materials
      // Negative frequencies indicate imaginary modes (instabilities)
      const all_freqs = band_struct.bands.flat()

      // All frequencies should be finite
      expect(
        all_freqs.every(Number.isFinite),
        `${id}: all frequencies should be finite`,
      ).toBe(true)

      // Max frequency should be reasonable (< 100 THz even for light elements like H)
      const max_freq = Math.max(...all_freqs)
      expect(max_freq, `${id}: max frequency should be < 100 THz`).toBeLessThan(100)

      // If has_imaginary_modes is false, all frequencies should be non-negative
      if (band_struct.has_imaginary_modes === false) {
        const min_freq = Math.min(...all_freqs)
        expect(
          min_freq,
          `${id}: min frequency should be >= 0 when no imaginary modes`,
        ).toBeGreaterThanOrEqual(-0.1) // Small tolerance for numerical noise
      }
    },
  )
})
