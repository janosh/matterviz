import { mat3x3_vec3_multiply, subtract, transpose_3x3_matrix } from '$lib/math'
import { phonon_bands, phonon_data, phonon_dos } from '$site/phonons'
import { describe, expect, it } from 'vitest'

describe(`Phonon Module Tests`, () => {
  const band_entries = Object.entries(phonon_bands)

  it(`keys every fixture by its file stem and derives bands and DOS for each`, () => {
    const ids = Object.keys(phonon_data)
    expect(ids).toHaveLength(13)
    // one DFT reference per material plus the ML potentials it is compared against
    expect(ids).toContain(`mp-23907-H2-pbe`)
    expect(ids).toContain(`mp-2667-Cs1Au1-mace-y7uhwpje`)
    expect(ids.every((id) => /^mp-\d+-[A-Za-z0-9]+-/.test(id))).toBe(true)
    expect(Object.keys(phonon_bands)).toEqual(ids)
    expect(Object.keys(phonon_dos)).toEqual(ids)
  })

  // Minimum qpoints threshold: band structure calculations typically sample 100+ k-points
  // along high-symmetry paths. This catches incomplete or corrupted data files.
  const MIN_QPOINTS = 100

  it.each(band_entries)(
    `%s has valid band structure with correct dimensions and physical frequencies`,
    (id, band_struct) => {
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

    // Distances never decrease (equal for consecutive points at the same location, e.g. the
    // duplicated junction point between two pymatgen branches, and across a path jump)
    band_struct.distance.forEach((dist, idx) => {
      expect(Number.isFinite(dist), id).toBe(true)
      if (idx > 0) expect(dist, id).toBeGreaterThanOrEqual(band_struct.distance[idx - 1])
    })

    // Max distance in reciprocal space should not exceed a few lattice parameters
    const max_distance = Math.max(...band_struct.distance)
    expect(max_distance, id).toBeGreaterThan(0)
    expect(max_distance, id).toBeLessThan(100)
  })

  it.each(band_entries)(
    `%s measures every branch as its Cartesian reciprocal-space chord`,
    (id, band_struct) => {
      // Every branch is a straight line between two high-symmetry points, so the summed
      // step lengths must equal the chord |Mᵀ·Δq| in the fixture's reciprocal lattice. The
      // fixtures store q-points to 7 decimals, which zig-zags the path by up to ~1e-7 and
      // lengthens the H2 M-K leg by 7.3e-11 over its chord, hence the 5e-10 tolerance.
      const raw = phonon_data[id].phonon_bandstructure
      if (!raw || !band_struct.recip_lattice) throw new Error(`${id}: missing recip lattice`)
      // the kept lattice is the fixture's phonopy-convention recip_lattice scaled by the 2π it lacks
      band_struct.recip_lattice.forEach((row, row_idx) =>
        row.forEach((val, col_idx) =>
          expect(val, id).toBeCloseTo(
            raw.recip_lattice.matrix[row_idx][col_idx] * 2 * Math.PI,
            12,
          ),
        ),
      )
      const recip_T = transpose_3x3_matrix(band_struct.recip_lattice)
      for (const { start_index, end_index, name } of band_struct.branches) {
        const delta_q = subtract(
          band_struct.qpoints[end_index].frac_coords,
          band_struct.qpoints[start_index].frac_coords,
        )
        const chord = Math.hypot(...mat3x3_vec3_multiply(recip_T, delta_q))
        expect(
          band_struct.distance[end_index] - band_struct.distance[start_index],
          `${id}: ${name}`,
        ).toBeCloseTo(chord, 9)
      }
    },
  )

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

      // Branches span the path and are contiguous: each starts where the previous ends, or
      // one q-point later where the path jumps (the jump itself is not a branch)
      const sorted_branches = [...band_struct.branches].toSorted(
        (branch_a, branch_b) => branch_a.start_index - branch_b.start_index,
      )
      expect(sorted_branches[0].start_index, id).toBe(0)
      expect(sorted_branches.at(-1)?.end_index, id).toBe(band_struct.qpoints.length - 1)
      const n_jumps = sorted_branches.filter((branch, idx) => {
        const prev_end = sorted_branches[idx - 1]?.end_index
        if (prev_end === undefined) return false
        expect([prev_end, prev_end + 1], id).toContain(branch.start_index)
        return branch.start_index === prev_end + 1
      }).length
      // every fixture path has exactly one jump (e.g. X|R, U|K), the hexagonal H2 path two
      expect(n_jumps, id).toBe(id.startsWith(`mp-23907`) ? 2 : 1)

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
      if (!raw || !transformed) throw new Error(`${id}: missing raw or transformed bands`)

      // Transformation preserves data dimensions, labels and the phonon flags
      expect(transformed.qpoints, id).toHaveLength(raw.qpoints.length)
      expect(transformed.nb_bands, id).toBe(raw.bands.length)
      expect(Object.keys(transformed.labels_dict).toSorted(), id).toEqual(
        Object.keys(raw.labels_dict).toSorted(),
      )
      expect(transformed.has_nac, id).toBe(raw.has_nac)
      expect(transformed.has_imaginary_modes, id).toBe(raw.has_imaginary_modes)
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
