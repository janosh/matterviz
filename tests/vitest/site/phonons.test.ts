import { phonon_bands, phonon_data, phonon_dos } from '$site/phonons'
import { describe, expect, it } from 'vitest'

describe(`Phonon Module Tests`, () => {
  const band_entries = Object.entries(phonon_bands)

  it(`exports non-empty phonon_data, phonon_bands and phonon_dos records`, () => {
    expect(Object.keys(phonon_data).length).toBeGreaterThan(0)
    expect(Object.keys(phonon_bands).length).toBeGreaterThan(0)
    expect(Object.keys(phonon_dos).length).toBeGreaterThan(0)
  })

  // Minimum qpoints threshold: band structure calculations typically sample 100+ k-points
  // along high-symmetry paths. This catches incomplete or corrupted data files.
  const MIN_QPOINTS = 100

  it.each(band_entries)(
    `%s has valid band structure with correct dimensions and physical frequencies`,
    (id, band_struct) => {
      // Reciprocal lattice must be a finite 3x3 matrix
      expect(band_struct.recip_lattice.matrix, id).toHaveLength(3)
      for (const row of band_struct.recip_lattice.matrix) {
        expect(row, id).toHaveLength(3)
        expect(row.every(Number.isFinite), id).toBe(true)
      }

      expect(band_struct.qpoints.length, id).toBeGreaterThan(MIN_QPOINTS)
      expect(band_struct.distance, id).toHaveLength(band_struct.qpoints.length)
      expect(band_struct.nb_bands, id).toBeGreaterThan(0)
      expect(band_struct.bands, id).toHaveLength(band_struct.nb_bands)

      for (const qpt of band_struct.qpoints) {
        expect(qpt.frac_coords, id).toHaveLength(3)
        expect(qpt.frac_coords.every(Number.isFinite), id).toBe(true)
      }

      // Every band spans all qpoints with finite frequencies
      for (const [band_idx, band] of band_struct.bands.entries()) {
        expect(band, `${id}: band ${band_idx}`).toHaveLength(band_struct.qpoints.length)
        expect(band.every(Number.isFinite), `${id}: band ${band_idx}`).toBe(true)
      }

      // Phonon frequencies in THz: max should be reasonable (< 100 THz even for light
      // elements like H)
      const all_freqs = band_struct.bands.flat()
      expect(Math.max(...all_freqs), `${id}: max frequency`).toBeLessThan(100)

      // If has_imaginary_modes is false, all frequencies should be non-negative.
      // Tolerance of -0.1 THz accommodates soft modes near zero (quasi-stable structures)
      if (band_struct.has_imaginary_modes === false) {
        expect(Math.min(...all_freqs), `${id}: min frequency`).toBeGreaterThanOrEqual(-0.1)
      }
    },
  )

  it.each(band_entries)(`%s assigns qpoint labels matching labels_dict`, (id, band_struct) => {
    const labeled_points = band_struct.qpoints.filter((qpt) => qpt.label !== null)
    const dict_labels = Object.keys(band_struct.labels_dict)
    expect(dict_labels.length, id).toBeGreaterThan(0)
    // A label like GAMMA can appear multiple times in the path (e.g. Γ→X→Γ→L)
    expect(labeled_points.length, id).toBeGreaterThanOrEqual(dict_labels.length)

    // Labeled qpoints must match labels_dict coordinates (within tolerance)
    for (const qpt of labeled_points) {
      const dict_coords = band_struct.labels_dict[qpt.label as string]
      expect(dict_coords, `${id}: label ${qpt.label}`).toBeDefined()
      qpt.frac_coords.forEach((coord, idx) => {
        expect(Math.abs(coord - dict_coords[idx]), `${id}: label ${qpt.label}`).toBeLessThan(
          1e-5,
        )
      })
    }

    // All labels in labels_dict should appear at least once in qpoints
    for (const label of dict_labels) {
      expect(
        band_struct.qpoints.some((qpt) => qpt.label === label),
        `${id}: label ${label} missing from qpoints`,
      ).toBe(true)
    }
  })

  it.each(band_entries)(`%s has monotonic cumulative distances`, (id, band_struct) => {
    expect(band_struct.distance[0], id).toBe(0)

    // qpoint distances mirror the distance array and never decrease
    // (can be equal for consecutive points at same location, e.g. repeated labels)
    band_struct.qpoints.forEach((qpt, idx) => {
      expect(qpt.distance, id).toBe(band_struct.distance[idx])
      expect(Number.isFinite(qpt.distance), id).toBe(true)
      if (idx > 0) {
        expect(qpt.distance, id).toBeGreaterThanOrEqual(band_struct.distance[idx - 1])
      }
    })

    // Max distance in reciprocal space should not exceed a few lattice parameters
    const max_distance = Math.max(...band_struct.distance)
    expect(max_distance, id).toBeGreaterThan(0)
    expect(max_distance, id).toBeLessThan(100)
  })

  it.each(band_entries)(
    `%s creates contiguous branches covering all labeled points`,
    (id, band_struct) => {
      const num_labels = Object.keys(band_struct.labels_dict).length
      expect(band_struct.branches.length, id).toBeGreaterThanOrEqual(num_labels - 1)

      for (const branch of band_struct.branches) {
        expect(branch.name.length, `${id}: branch name`).toBeGreaterThan(0)
        expect(branch.start_index, id).toBeGreaterThanOrEqual(0)
        expect(branch.end_index, id).toBeLessThan(band_struct.qpoints.length)
        expect(branch.end_index, id).toBeGreaterThanOrEqual(branch.start_index)

        // Branch names follow the "start_label-end_label" convention
        const start_label = band_struct.qpoints[branch.start_index]?.label
        const end_label = band_struct.qpoints[branch.end_index]?.label
        if (start_label && end_label) {
          expect(branch.name, id).toBe(`${start_label}-${end_label}`)
        } else if (start_label) expect(branch.name, id).toContain(start_label)
        else if (end_label) expect(branch.name, id).toContain(end_label)
      }

      // Branches are contiguous (each starts where the previous ends) and span the path
      const sorted_branches = [...band_struct.branches].sort(
        (branch_a, branch_b) => branch_a.start_index - branch_b.start_index,
      )
      expect(sorted_branches[0].start_index, id).toBe(0)
      expect(sorted_branches.at(-1)?.end_index, id).toBe(band_struct.qpoints.length - 1)
      for (let idx = 0; idx < sorted_branches.length - 1; idx++) {
        expect(sorted_branches[idx + 1].start_index, id).toBe(sorted_branches[idx].end_index)
      }

      // Every labeled point sits on a branch boundary
      band_struct.qpoints.forEach((qpt, qpt_idx) => {
        if (!qpt.label) return
        const is_boundary = sorted_branches.some(
          (branch) => branch.start_index === qpt_idx || branch.end_index === qpt_idx,
        )
        expect(is_boundary, `${id}: labeled qpoint ${qpt_idx}`).toBe(true)
      })
    },
  )

  it.each(Object.keys(phonon_data))(
    `%s raw data is correctly transformed to PhononBandStructure`,
    (id) => {
      const raw = phonon_data[id].phonon_bandstructure
      const transformed = phonon_bands[id]
      expect(raw, `${id}: should have phonon_bandstructure`).toBeDefined()
      expect(transformed, `${id}: transformed data should exist`).toBeDefined()
      if (!raw || !transformed) return // Guard for TypeScript

      // Transformation preserves data dimensions and labels
      expect(transformed.qpoints, id).toHaveLength(raw.qpoints.length)
      expect(transformed.nb_bands, id).toBe(raw.bands.length)
      expect(Object.keys(transformed.labels_dict).sort(), id).toEqual(
        Object.keys(raw.labels_dict).sort(),
      )
    },
  )

  it.each(Object.entries(phonon_dos))(
    `%s DOS has valid frequencies and densities`,
    (id, dos) => {
      expect(dos.frequencies, id).toHaveLength(dos.densities.length)
      expect(dos.frequencies.length, id).toBeGreaterThan(0)

      // Frequencies should be finite and monotonically increasing
      for (let idx = 1; idx < dos.frequencies.length; idx++) {
        expect(dos.frequencies[idx], id).toBeGreaterThan(dos.frequencies[idx - 1])
        expect(Number.isFinite(dos.frequencies[idx]), id).toBe(true)
      }

      // Densities should be non-negative and finite
      expect(
        dos.densities.every((density) => Number.isFinite(density) && density >= 0),
        id,
      ).toBe(true)
    },
  )
})
