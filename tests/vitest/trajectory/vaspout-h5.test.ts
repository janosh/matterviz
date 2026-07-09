import { full_data_extractor } from '$lib/trajectory/extract'
import { parse_trajectory_data } from '$lib/trajectory/parse'
import { expand_ion_types, with_h5_file } from '$lib/trajectory/parse/h5-utils'
import {
  line_mode_labels,
  read_vaspout_bands,
  type VaspoutElectronicData,
} from '$lib/trajectory/parse/vaspout-electronic'
import { parse_vaspout_h5 } from '$lib/trajectory/parse/vaspout-h5'
import { is_trajectory_file } from '$lib/trajectory/format-detect'
import { describe, expect, it } from 'vitest'
import { read_binary_test_file } from '../setup'

const VASPOUT_FIXTURE_DIR = `tests/vitest/fixtures/vasp-hdf5`
const read_vaspout = (filename: string): ArrayBuffer =>
  read_binary_test_file(filename, VASPOUT_FIXTURE_DIR)
const parse_fixture = (fixture: string) =>
  parse_vaspout_h5(read_vaspout(fixture), `vaspout.h5`)

describe(`vaspout.h5 parsing`, () => {
  it(`parses a relaxation trajectory with energy and force metadata`, async () => {
    const trajectory = await parse_fixture(`vaspout-si-relax.h5`)

    expect(trajectory.metadata?.source_format).toBe(`vaspout_h5`)
    expect(trajectory.frames).toHaveLength(5)
    expect(trajectory.metadata?.num_atoms).toBe(2)
    expect(trajectory.metadata?.element_counts).toEqual({ Si: 2 })
    expect(trajectory.metadata?.energy_tag).toBe(`free energy    TOTEN`)

    // TOTEN column of the energies dataset, in step order
    const energies = trajectory.frames.map((frame) => frame.metadata?.energy)
    expect(energies).toEqual([-10.0, -10.2, -10.35, -10.45, -10.5])

    for (const frame of trajectory.frames) {
      expect(Array.isArray(frame.metadata?.forces)).toBe(true)
      expect(frame.metadata?.volume).toBeCloseTo(5.43 ** 3, 6)
    }

    // Cubic 5.43 Å lattice survives the round trip
    const structure = trajectory.frames.at(-1)?.structure
    if (!structure || !(`lattice` in structure)) throw new Error(`missing lattice`)
    expect(structure.lattice.a).toBeCloseTo(5.43, 6)
    expect(structure.lattice.alpha).toBeCloseTo(90, 6)
    // Fractional positions converted to Cartesian and back
    expect(structure.sites[1].abc.map((coord) => Math.round(coord * 1e6) / 1e6)).toEqual([
      0.25, 0.25, 0.25,
    ])
  })

  it(`parses a real VASP 6.4 static file (GaSb, trimmed from pymatgen test data)`, async () => {
    const trajectory = await parse_fixture(`vaspout-gasb-static.h5`)

    expect(trajectory.frames).toHaveLength(1)
    expect(trajectory.metadata?.element_counts).toEqual({ Ga: 1, Sb: 1 })
    expect(trajectory.frames[0].metadata?.energy).toBeCloseTo(-8.95303508, 6)
    const structure = trajectory.frames[0].structure
    expect(structure.sites[1].abc.map((coord) => Math.round(coord * 1e6) / 1e6)).toEqual([
      0.25, 0.25, 0.25,
    ])
  })

  it(`falls back to results/positions for NSW=0 files without ion_dynamics`, async () => {
    const trajectory = await parse_fixture(`vaspout-si-static.h5`)

    expect(trajectory.frames).toHaveLength(1)
    expect(trajectory.frames[0].step).toBe(0)
    expect(trajectory.metadata?.element_counts).toEqual({ Si: 2 })
  })

  it(`keeps complete steps from a file torn mid-write`, async () => {
    const trajectory = await parse_fixture(`vaspout-si-relax-torn.h5`)

    // 5 energies but only 4 position/lattice frames and 3 force frames:
    // frame count follows the shortest required dataset, forces stay optional.
    expect(trajectory.frames).toHaveLength(4)
    expect(trajectory.frames.every((frame) => Number.isFinite(frame.metadata?.energy))).toBe(
      true,
    )
    expect(Array.isArray(trajectory.frames[2].metadata?.forces)).toBe(true)
    expect(trajectory.frames[3].metadata?.forces).toBeUndefined()
  })

  it(`returns an electronic-only zero-frame trajectory for bands-only vaspout files`, async () => {
    const trajectory = await parse_fixture(`vaspout-tinisn-bands-only.h5`)

    expect(trajectory.frames).toHaveLength(0)
    expect(trajectory.metadata?.vaspout_electronic_only).toBe(true)
    const electronic = trajectory.metadata?.electronic as VaspoutElectronicData
    expect(electronic.dos).toBeNull()
    expect(electronic.bands).not.toBeNull()
  })

  // Second no-structure exit: ion species datasets exist but the geometry is
  // missing/torn — files with electronic results render those, others throw.
  it(`falls back to electronic-only when geometry is torn but a DOS exists`, async () => {
    const trajectory = await parse_fixture(`vaspout-si-dos-torn-structure.h5`)

    expect(trajectory.frames).toHaveLength(0)
    expect(trajectory.metadata?.vaspout_electronic_only).toBe(true)
    const electronic = trajectory.metadata?.electronic as VaspoutElectronicData
    expect(electronic.dos).not.toBeNull()
    expect(electronic.dos?.efermi).toBeCloseTo(0.5, 6)
  })

  it(`throws for torn geometry without any electronic results`, async () => {
    await expect(parse_fixture(`vaspout-si-torn-structure.h5`)).rejects.toThrow(
      /no electron_dos\/electron_eigenvalues results either/,
    )
  })
})

describe(`line-mode k-path labels`, () => {
  const seg_labels = [`GAMMA`, `X`, `X`, `L`]

  it.each([
    [`explicit per-segment dataset`, 3],
    [`inferred from label/k-point counts when number_kpoints is absent`, null],
  ])(`places labels at segment endpoints (%s)`, (_case, per_segment) => {
    const result = line_mode_labels(seg_labels, per_segment, 6)
    expect(result?.labels).toEqual([`Γ`, null, `X`, `X`, null, `L`])
    expect(result?.per_segment).toBe(3)
  })

  it.each([
    [`odd label count`, [`GAMMA`, `X`, `L`], null, 6],
    [`k-points not divisible into segments`, seg_labels, null, 7],
    [`inferred segment shorter than 2 points`, seg_labels, null, 2],
    [`explicit per-segment mismatching k-point count`, seg_labels, 4, 6],
    [`missing labels`, null, 3, 6],
  ])(`returns null for %s`, (_case, labels, per_segment, n_kpoints) => {
    expect(line_mode_labels(labels, per_segment, n_kpoints)).toBeNull()
  })
})

describe(`HDF5 ion type expansion`, () => {
  it.each([
    [`negative`, -1],
    [`fractional`, 1.5],
    [`infinite`, Infinity],
  ])(`rejects %s ion counts`, (_case, ion_count) => {
    expect(() => expand_ion_types([`Si`], [ion_count])).toThrow(
      `Invalid ion count for Si: ${ion_count}`,
    )
  })

  it.each([
    [[`Si`, `O`], [2]],
    [[`Si`], [2, 1]],
  ])(`rejects mismatched lengths (%j vs %j)`, (ion_types, ion_counts) => {
    expect(() => expand_ion_types(ion_types, ion_counts)).toThrow(
      `ion_types (${ion_types.length}) and ion_counts (${ion_counts.length}) length mismatch`,
    )
  })
})

describe(`vaspout.h5 electronic results (DOS + bands)`, () => {
  it(`reads band structure from the phelel kpoints_opt fixture (TiNiSn)`, async () => {
    const bands = await with_h5_file(
      read_vaspout(`vaspout-tinisn-bands-only.h5`),
      `vaspout.h5`,
      read_vaspout_bands,
    )
    if (!bands) throw new Error(`expected bands`)

    // eigenvalues shape (1, 306, 24) -> 24 bands over 306 k-points
    expect(bands.nb_bands).toBe(24)
    expect(bands.bands).toHaveLength(24)
    expect(bands.bands[0]).toHaveLength(306)
    expect(bands.qpoints).toHaveLength(306)
    expect(bands.distance).toHaveLength(306)
    expect(bands.is_spin_polarized).toBe(false)
    expect(bands.spin_down_bands).toBeUndefined()
    expect(bands.bands[0][0]).toBeCloseTo(-48.4674, 3)

    // 12 line-mode labels + 51 points per segment -> 6 branches with Γ prettified
    expect(bands.branches).toHaveLength(6)
    expect(bands.branches[0]).toMatchObject({ start_index: 0, end_index: 50 })
    expect(bands.qpoints[0].label).toBe(`Γ`)
    expect(bands.qpoints[50].label).toBe(`X`)
    expect(bands.labels_dict[`Γ`]).toEqual([0, 0, 0])

    // Path distance is cumulative and non-decreasing
    for (let idx = 1; idx < bands.distance.length; idx++) {
      expect(bands.distance[idx]).toBeGreaterThanOrEqual(bands.distance[idx - 1])
    }
    expect(bands.distance.at(-1)).toBeGreaterThan(0)
  })

  it(`attaches DOS to static-run trajectories via metadata.electronic`, async () => {
    const trajectory = await parse_fixture(`vaspout-si-static-scf.h5`)

    // SCF pseudo-frame expansion is untouched by the DOS group
    expect(trajectory.frames).toHaveLength(8)
    const electronic = trajectory.metadata?.electronic as VaspoutElectronicData
    expect(electronic.bands).toBeNull()
    const dos = electronic.dos
    if (!dos) throw new Error(`expected dos`)
    expect(dos.type).toBe(`electronic`)
    expect(dos.energies).toHaveLength(25)
    expect(dos.densities).toHaveLength(25)
    expect(dos.efermi).toBeCloseTo(0.5, 6)
    expect(dos.spin_polarized).toBeUndefined()
  })

  it.each([
    [`vaspout-gasb-static.h5`], // real file trimmed of dos/bands datasets
    [`vaspout-si-relax.h5`], // synthetic relax fixture without electronic groups
  ])(`%s has no metadata.electronic`, async (fixture) => {
    const trajectory = await parse_fixture(fixture)
    expect(trajectory.frames.length).toBeGreaterThan(0)
    expect(trajectory.metadata?.electronic).toBeUndefined()
  })

  it(`routes bands-only files through parse_trajectory_data without error`, async () => {
    const trajectory = await parse_trajectory_data(
      read_vaspout(`vaspout-tinisn-bands-only.h5`),
      `vaspout.h5`,
    )
    expect(trajectory.frames).toHaveLength(0)
    expect(trajectory.metadata?.vaspout_electronic_only).toBe(true)
  })
})

describe(`vaspout.h5 SCF convergence data (OSZICAR)`, () => {
  it(`attaches per-ionic-step SCF summaries to relax frames`, async () => {
    const trajectory = await parse_fixture(`vaspout-si-relax.h5`)

    expect(trajectory.frames.map((frame) => frame.metadata?.n_scf_steps)).toEqual([
      12, 8, 6, 5, 4,
    ])
    for (const frame of trajectory.frames) {
      expect(frame.metadata?.scf_energy_delta).toBeGreaterThan(0)
      expect(frame.metadata?.scf_rms).toBeGreaterThan(0)
      expect(frame.metadata?.scf_charge_rms).toBeGreaterThan(0)
    }
    // SCF summaries flow through the shared extractor into plot series
    const extracted = full_data_extractor(trajectory.frames[0], trajectory)
    for (const key of [`n_scf_steps`, `scf_energy_delta`, `scf_rms`, `scf_charge_rms`]) {
      expect(extracted[key], key).toBeGreaterThan(0)
    }
  })

  it(`expands single-point runs into SCF pseudo-frames for convergence plots`, async () => {
    const trajectory = await parse_fixture(`vaspout-si-static-scf.h5`)

    expect(trajectory.metadata?.frames_are_scf_steps).toBe(true)
    expect(trajectory.frames).toHaveLength(8)
    expect(trajectory.frames.map((frame) => frame.step)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    // Fixed structure while the SCF loop converges: all frames share it
    const structures = new Set(trajectory.frames.map((frame) => frame.structure))
    expect(structures.size).toBe(1)

    // Energy converges monotonically toward the final TOTEN
    const scf_energies = trajectory.frames.map((frame) => frame.metadata?.energy as number)
    for (let idx = 1; idx < scf_energies.length; idx++) {
      expect(scf_energies[idx]).toBeLessThan(scf_energies[idx - 1])
    }
    expect(scf_energies.at(-1)).toBeCloseTo(-10.499, 2)

    // Charge-density residual rms(c) decays across SCF steps
    const charge_rms = trajectory.frames.map(
      (frame) => frame.metadata?.scf_charge_rms as number,
    )
    for (let idx = 1; idx < charge_rms.length; idx++) {
      expect(charge_rms[idx]).toBeLessThan(charge_rms[idx - 1])
    }
    // OSZICAR's dE column: zero on the first SCF row, then |dE| per step
    expect(trajectory.frames[0].metadata?.scf_energy_delta).toBe(0)
    expect(trajectory.frames[3].metadata?.scf_energy_delta).toBeGreaterThan(0)
  })

  it(`leaves files without SCF data as plain single-frame trajectories`, async () => {
    const trajectory = await parse_fixture(`vaspout-si-static.h5`)
    expect(trajectory.frames).toHaveLength(1)
    expect(trajectory.metadata?.frames_are_scf_steps).toBeUndefined()
    expect(trajectory.frames[0].metadata?.n_scf_steps).toBeUndefined()
  })
})

describe(`vaspout.h5 routing`, () => {
  it.each([
    [`vaspout-si-relax.h5`, `vaspout.h5`, `vaspout_h5`],
    [`vaspout-si-relax.h5`, `some/dir/vaspout.h5`, `vaspout_h5`],
    // Dispatch is content-based (root group layout), not filename-based
    [`vaspout-si-relax.h5`, `renamed.h5`, `vaspout_h5`],
  ])(`%s as %s routes to %s`, async (fixture, filename, expected_format) => {
    const trajectory = await parse_trajectory_data(read_vaspout(fixture), filename)
    expect(trajectory.metadata?.source_format).toBe(expected_format)
  })

  it(`still routes torch-sim h5 files to the generic HDF5 parser`, async () => {
    const content = read_binary_test_file(`flame-gold-cluster-55-atoms.h5`)
    const trajectory = await parse_trajectory_data(content, `flame-gold-cluster-55-atoms.h5`)
    expect(trajectory.metadata?.source_format).toBe(`hdf5_trajectory`)
  })

  it.each([
    [`vaspout.h5`, true],
    [`VASPOUT.H5`, true],
    [`run-01/vaspout.h5`, true],
    [`vaspout_backup.hdf5`, true],
    [`random.h5`, false],
  ])(`is_trajectory_file(%s) -> %s`, (filename, expected) => {
    expect(is_trajectory_file(filename)).toBe(expected)
  })
})
