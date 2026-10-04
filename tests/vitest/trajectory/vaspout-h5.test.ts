import { EV_PER_A3_TO_GPA } from '#lib/constants.js'
import * as math from '#lib/math.js'
import type { TrajectoryFrame } from '#lib/trajectory/index.js'
import { full_data_extractor } from '#lib/trajectory/extract.js'
import { open_trajectory } from '#lib/trajectory/open.js'
import {
  VaspoutElectronicOnlyError,
  parse_vaspout_h5_file,
} from '#lib/trajectory/parse/vaspout-h5.js'
import { expand_ion_types } from '#lib/trajectory/helpers.js'
import { with_h5_file } from '#lib/trajectory/parse/h5-utils.js'
import { electronic_band_gap } from '#lib/spectral/helpers.js'
import {
  line_mode_labels,
  read_vaspout_bands,
} from '#lib/trajectory/parse/vaspout-electronic.js'
import type { VaspoutElectronicData } from '#lib/trajectory/parse/vaspout-electronic.js'
import { is_trajectory_file } from '#lib/trajectory/format-detect.js'
import type * as h5wasm from 'h5wasm'
import { describe, expect, it, vi } from 'vitest'
import { rejection_of } from '../setup'
import { read_binary_test_file } from '../test-fixtures'

const VASPOUT_FIXTURE_DIR = `tests/vitest/fixtures/vasp-hdf5`
const read_vaspout = (filename: string): ArrayBuffer =>
  read_binary_test_file(filename, VASPOUT_FIXTURE_DIR)
const elements_of = (frame: TrajectoryFrame) =>
  frame.structure.sites.map((site) => site.species[0].element)
// `incar` overrides input/incar/<TAG> datasets (POTIM, PSTRESS) the fixture was written with
const parse_fixture = (fixture: string, incar: Record<string, number | undefined> = {}) =>
  with_h5_file(read_vaspout(fixture), `vaspout.h5`, (h5_file) => {
    const file_with_incar = {
      get: (path: string) => {
        const value = incar[path.replace(/^input\/incar\//, ``)]
        return value === undefined ? h5_file.get(path) : { to_array: () => value }
      },
    } as unknown as h5wasm.File
    return parse_vaspout_h5_file(file_with_incar, () => {})
  })

describe(`vaspout.h5 parsing`, () => {
  // With PSTRESS set, VASP's TOTEN column holds the enthalpy F + PV; it was reported as the
  // energy, 0.25 eV off the OUTCAR reader's free energy on a real NPT run
  it(`reports the free energy and keeps the PSTRESS enthalpy apart`, async () => {
    const plain = await parse_fixture(`vaspout-si-relax.h5`)
    const pressed = await parse_fixture(`vaspout-si-relax.h5`, { PSTRESS: 10 })
    for (const [idx, frame] of pressed.frames.entries()) {
      const raw = Number(plain.frames[idx].metadata?.energy)
      if (!(`lattice` in frame.structure)) throw new Error(`frame ${idx} has no lattice`)
      const volume = Math.abs(math.det_3x3(frame.structure.lattice.matrix))
      // 10 kB = 1 GPa; 1 eV/A^3 = 160.2177 GPa
      expect(frame.metadata?.energy).toBeCloseTo(raw - volume / EV_PER_A3_TO_GPA, 12)
      expect(frame.metadata?.enthalpy).toBe(raw)
    }
    expect(plain.frames[0].metadata?.enthalpy).toBeUndefined()
  })

  it(`parses a relaxation trajectory with energy, forces, and SCF summaries`, async () => {
    const trajectory = await parse_fixture(`vaspout-si-relax.h5`)

    expect(trajectory.format).toBe(`vaspout-h5`)
    expect(trajectory.frames).toHaveLength(5)
    // ionic steps count from 1 like the OUTCAR/vasprun/XDATCAR readers (the time axis is
    // step × POTIM, so 0-based steps shifted a vaspout run one step earlier)
    expect(trajectory.frames.map(({ step }) => step)).toEqual([1, 2, 3, 4, 5])
    expect(elements_of(trajectory.frames[0])).toEqual([`Si`, `Si`])
    expect(trajectory.metadata?.energy_tag).toBe(`free energy    TOTEN`)
    expect(trajectory.metadata?.electronic).toBeUndefined()

    // TOTEN column of the energies dataset, in step order
    const energies = trajectory.frames.map((frame) => frame.metadata?.energy)
    expect(energies).toEqual([-10.0, -10.2, -10.35, -10.45, -10.5])

    expect(trajectory.frames.map((frame) => frame.metadata?.n_scf_steps)).toEqual([
      12, 8, 6, 5, 4,
    ])
    for (const frame of trajectory.frames) {
      expect(frame.structure.sites.every(({ properties }) => properties.force)).toBe(true)
      expect(frame.metadata?.force_max).toBeGreaterThanOrEqual(0)
      expect(frame.metadata?.volume).toBeCloseTo(5.43 ** 3, 6)
    }
    // The fixture stores the final SCF residuals per ionic step as decades: charge RMS
    // 10^-7, 10^-5, 10^-4, 10^-3.5, 10^-3 and the energy RMS sqrt(10) above each of them
    const charge_rms = [1e-7, 1e-5, 1e-4, 10 ** -3.5, 1e-3]
    for (const [frame_idx, frame] of trajectory.frames.entries()) {
      const label = `frame ${frame_idx}`
      expect(frame.metadata?.scf_charge_rms, label).toBeCloseTo(charge_rms[frame_idx], 12)
      expect(frame.metadata?.scf_rms, label).toBeCloseTo(
        Math.sqrt(10) * charge_rms[frame_idx],
        12,
      )
    }
    // ...while the last |ΔE| grows step over step, as fewer SCF iterations converge less far
    const energy_deltas = trajectory.frames.map((frame) =>
      Number(frame.metadata?.scf_energy_delta),
    )
    expect(energy_deltas[0]).toBeCloseTo(3.009464147218921e-5, 15)
    expect(energy_deltas).toEqual(energy_deltas.toSorted((low, high) => low - high))
    // SCF summaries flow through the shared extractor into plot series unchanged
    const frame_0_metadata = trajectory.frames[0].metadata
    expect(full_data_extractor(trajectory.frames[0])).toMatchObject({
      n_scf_steps: 12,
      scf_energy_delta: frame_0_metadata?.scf_energy_delta,
      scf_rms: frame_0_metadata?.scf_rms,
      scf_charge_rms: frame_0_metadata?.scf_charge_rms,
    })

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
    expect(elements_of(trajectory.frames[0])).toEqual([`Ga`, `Sb`])
    expect(trajectory.frames[0].metadata?.energy).toBeCloseTo(-8.95303508, 6)
    const structure = trajectory.frames[0].structure
    expect(structure.sites[1].abc.map((coord) => Math.round(coord * 1e6) / 1e6)).toEqual([
      0.25, 0.25, 0.25,
    ])
  })

  it(`falls back to results/positions for NSW=0 files without ion_dynamics or SCF data`, async () => {
    const trajectory = await parse_fixture(`vaspout-si-static.h5`)

    expect(trajectory.frames).toHaveLength(1)
    expect(trajectory.frames[0].step).toBe(1) // the single ionic step, numbered like OUTCAR
    expect(elements_of(trajectory.frames[0])).toEqual([`Si`, `Si`])
    expect(trajectory.metadata?.frames_are_scf_steps).toBeUndefined()
    expect(trajectory.frames[0].metadata?.n_scf_steps).toBeUndefined()
  })

  it(`keeps complete steps from a file torn mid-write`, async () => {
    const trajectory = await parse_fixture(`vaspout-si-relax-torn.h5`)

    // 5 energies but only 4 position/lattice frames and 3 force frames:
    // frame count follows the shortest required dataset, forces stay optional.
    expect(trajectory.frames).toHaveLength(4)
    expect(trajectory.frames.every((frame) => Number.isFinite(frame.metadata?.energy))).toBe(
      true,
    )
    expect(trajectory.frames[2].structure.sites[0].properties.force).toHaveLength(3)
    expect(trajectory.frames[3].structure.sites[0].properties.force).toBeUndefined()
    expect(trajectory.frames[3].metadata?.force_max).toBeUndefined()
  })

  it(`throws electronic-only data for bands-only vaspout files`, async () => {
    const direct = await rejection_of(parse_fixture(`vaspout-tinisn-bands-only.h5`))
    const dispatched = await rejection_of(
      open_trajectory(read_vaspout(`vaspout-tinisn-bands-only.h5`), {
        filename: `vaspout.h5`,
      }),
    )
    for (const error of [direct, dispatched]) {
      expect(error).toBeInstanceOf(VaspoutElectronicOnlyError)
      if (!(error instanceof VaspoutElectronicOnlyError)) throw error
      expect(error.electronic.dos).toBeNull()
      expect(error.electronic.bands).not.toBeNull()
    }
  })

  // Second no-structure exit: ion species datasets exist but the geometry is
  // missing/torn — files with electronic results render those, others throw.
  it(`falls back to electronic-only when geometry is torn but a DOS exists`, async () => {
    const error = await rejection_of(parse_fixture(`vaspout-si-dos-torn-structure.h5`))
    expect(error).toBeInstanceOf(VaspoutElectronicOnlyError)
    if (!(error instanceof VaspoutElectronicOnlyError)) throw error
    const electronic = error.electronic
    expect(electronic.dos).not.toBeNull()
    expect(electronic.dos?.efermi).toBeCloseTo(0.5, 6)
  })

  it.each([
    [`vaspout-si-potim.h5`, undefined, { value: 2.5, unit: `fs` }],
    [`vaspout-si-static.h5`, undefined, undefined],
    [`vaspout-si-static.h5`, 2.5, { value: 2.5, unit: `fs` }],
    [`vaspout-si-static-scf.h5`, 2.5, undefined],
  ])(
    `%s with POTIM override %s -> time_step %j`,
    async (fixture, potim_override, time_step) => {
      const trajectory = await parse_fixture(fixture, { POTIM: potim_override })
      expect(trajectory.time_step).toEqual(time_step)
    },
  )

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
    [`a negative count`, [`Si`], [-1], `Invalid ion count for Si: -1`],
    [`a fractional count`, [`Si`], [1.5], `Invalid ion count for Si: 1.5`],
    [`an infinite count`, [`Si`], [Infinity], `Invalid ion count for Si: Infinity`],
    [
      `fewer counts than types`,
      [`Si`, `O`],
      [2],
      `ion_types (2) and ion_counts (1) length mismatch`,
    ],
    [
      `more counts than types`,
      [`Si`],
      [2, 1],
      `ion_types (1) and ion_counts (2) length mismatch`,
    ],
  ])(`rejects %s`, (_label, ion_types, ion_counts, message) => {
    expect(() => expand_ion_types(ion_types, ion_counts)).toThrow(message)
  })
})

describe(`vaspout.h5 electronic results (DOS + bands)`, () => {
  // The TiNiSn fixture only has the KPOINTS_OPT path. Remap datasets to stage other layouts:
  // a path maps to another dataset (null hides it), optionally with replaced contents
  type Remap = Record<string, null | { from: string; value?: unknown }>
  const read_remapped = (remap: Remap) =>
    with_h5_file(read_vaspout(`vaspout-tinisn-bands-only.h5`), `vaspout.h5`, (h5_file) => {
      const get_dataset = h5_file.get.bind(h5_file)
      vi.spyOn(h5_file, `get`).mockImplementation((path) => {
        if (!(path in remap)) return get_dataset(path)
        const target = remap[path]
        if (!target) return null
        const entity = get_dataset(target.from)
        if (target.value !== undefined && entity && `to_array` in entity)
          vi.spyOn(entity, `to_array`).mockReturnValue(target.value as never)
        return entity
      })
      return read_vaspout_bands(h5_file)
    })
  const opt = `results/electron_eigenvalues_kpoints_opt`
  const scf = `results/electron_eigenvalues`
  const mesh = Array.from({ length: 8 }, (_, idx) => [idx / 8, 0, 0])
  const scf_mesh = (mode: string): Remap => ({
    [`${scf}/eigenvalues`]: {
      from: `${opt}/eigenvalues`,
      value: [mesh.map(() => Array.from({ length: 24 }, () => 0))],
    },
    [`${scf}/kpoint_coords`]: { from: `${opt}/kpoint_coords`, value: mesh },
    [`input/kpoints/mode`]: { from: `input/kpoints_opt/number_kpoints`, value: mode },
  })
  const hide_opt: Remap = {
    [`${opt}/eigenvalues`]: null,
    [`${opt}/kpoint_coords`]: null,
    [`input/kpoints_opt/labels_kpoints`]: null,
    [`input/kpoints_opt/number_kpoints`]: null,
  }

  const lattice_paths = [`results/positions/lattice_vectors`, `input/poscar/lattice_vectors`]
  const zero_cell = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  const cell_remaps: Record<string, Remap> = {
    valid: {},
    missing: Object.fromEntries(lattice_paths.map((path) => [path, null])),
    singular: Object.fromEntries(
      lattice_paths.map((path) => [path, { from: path, value: zero_cell }]),
    ),
  }
  it.each(Object.keys(cell_remaps))(`reads TiNiSn bands with a %s cell`, async (cell) => {
    const bands = await read_remapped(cell_remaps[cell])
    if (!bands) throw new Error(`expected bands`)
    if (cell === `valid`) {
      expect(bands.recip_lattice).toHaveLength(3)
      expect(bands.recip_lattice?.flat().every(Number.isFinite)).toBe(true)
    } else expect(bands.recip_lattice).toBeUndefined()

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

  // No fixture carries fermiweights, so they are injected (1 spin, 306 k-points, 24 bands)
  const read_with_fermiweights = (weights: unknown) =>
    read_remapped({ [`${opt}/fermiweights`]: { from: `${opt}/eigenvalues`, value: weights } })

  it(`reads fermiweights as occupations`, async () => {
    const n_filled = 9
    const bands = await read_with_fermiweights([
      Array.from({ length: 306 }, () =>
        Array.from({ length: 24 }, (_, band_idx) => (band_idx < n_filled ? 1 : 0)),
      ),
    ])
    if (!bands?.occupations) throw new Error(`expected occupations`)
    expect(bands.occupations).toHaveLength(24)
    expect(bands.occupations[n_filled - 1].every((occ) => occ === 1)).toBe(true)
    expect(bands.occupations[n_filled].every((occ) => occ === 0)).toBe(true)
    expect(bands.spin_down_occupations).toBeUndefined()
    const vbm = Math.max(...bands.bands[n_filled - 1])
    const cbm = Math.min(...bands.bands[n_filled])
    expect(electronic_band_gap(bands.bands, bands.occupations)?.gap).toBe(cbm - vbm)
  })

  const tinisn_path = {
    n_kpoints: 306,
    branch_names: [`Γ-X`, `X-U`, `K-Γ`, `Γ-L`, `L-W`, `W-X`],
  }
  // VASP 6.3+ writes the SCF eigenvalues on every run; they used to win over the band path,
  // drawing an unlabelled 8-point mesh as a one-branch "path". An SCF group is a band path
  // only in line mode, labelled from its own input/kpoints group.
  // oxfmt-ignore
  it.each<[string, Remap, { n_kpoints: number; branch_names: string[] } | null]>([
    [`KPOINTS_OPT path beside an SCF mesh`, scf_mesh(`Gamma`), tinisn_path],
    [`SCF mesh in Gamma mode`, { ...scf_mesh(`Gamma`), ...hide_opt }, null],
    [`SCF mesh in Monkhorst-Pack mode`, { ...scf_mesh(`Monkhorst-Pack`), ...hide_opt }, null],
    [`SCF mesh in Automatic mode`, { ...scf_mesh(`Automatic`), ...hide_opt }, null],
    [`unlabelled SCF path in line mode`, { ...scf_mesh(`Line-mode`), ...hide_opt }, { n_kpoints: 8, branch_names: [`path`] }],
    [`labelled SCF line-mode path`, {
      ...hide_opt,
      [`${scf}/eigenvalues`]: { from: `${opt}/eigenvalues` },
      [`${scf}/kpoint_coords`]: { from: `${opt}/kpoint_coords` },
      [`input/kpoints/labels_kpoints`]: { from: `input/kpoints_opt/labels_kpoints` },
      [`input/kpoints/number_kpoints`]: { from: `input/kpoints_opt/number_kpoints` },
    }, tinisn_path],
  ])(`band source for %s`, async (_label, remap, expected) => {
    const bands = await read_remapped(remap)
    expect(
      bands && {
        n_kpoints: bands.qpoints.length,
        branch_names: bands.branches.map(({ name }) => name),
      },
    ).toEqual(expected)
  })

  // A malformed dataset still loads the bands; the gap check reports it (Bands shows a notice).
  // Occupations keep their own shape: an extra band must not be cut to the eigenvalue grid
  const grid = (n_kpoints: number, n_bands: number) =>
    Array.from({ length: n_kpoints }, () => Array.from({ length: n_bands }, () => 1))
  it.each([
    [`an empty dataset`, [], `0 occupation rows for 24 bands`],
    [`an extra band per k-point`, [grid(306, 25)], `25 occupation rows for 24 bands`],
    [`a missing k-point`, [grid(305, 24)], `occupation row 0 needs 306 finite values`],
    [`a 1-D dataset`, [1, 0, 1], `0 occupation rows for 24 bands`],
  ])(`leaves %s to the gap check`, async (_label, weights, message) => {
    const bands = await read_with_fermiweights(weights)
    const occupations = bands?.occupations
    if (!bands || !occupations) throw new Error(`expected occupations`)
    expect(bands.bands).toHaveLength(24)
    expect(() => electronic_band_gap(bands.bands, occupations)).toThrow(message)
  })

  it(`expands single-point SCF runs into pseudo-frames and attaches DOS`, async () => {
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
})

describe(`vaspout.h5 routing`, () => {
  it(`routes a renamed VASP HDF5 file by root-group layout`, async () => {
    const run = await open_trajectory(read_vaspout(`vaspout-si-relax.h5`), {
      filename: `renamed.h5`,
    })
    try {
      expect(run.provenance.format).toBe(`vaspout-h5`)
    } finally {
      run.dispose()
    }
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
