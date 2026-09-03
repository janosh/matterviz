import type { Matrix3x3, Vec2, Vec3 } from '$lib/math'
// Everything is imported through the module barrel, exactly as the demo route does, so a
// missing or name-clashing export fails these tests rather than the site build.
import {
  acoustic_mode_indices,
  apply_born_sum_rule,
  born_charge_sum,
  broaden_spectrum,
  compute_ir_raman_spectrum,
  convert_frequencies,
  eigenvector_norm_sq,
  ir_intensity,
  IrRamanSpectrum,
  is_gamma_point,
  parse_born,
  parse_phonon_modes,
  raman_invariants,
  scale_to_max,
  spectrum_from_phonon_data,
  spectrum_sticks,
  to_transmittance,
} from '$lib/spectral'
import type {
  BroadenOptions,
  Complex,
  FrequencyUnit,
  PhononModeData,
  SpectrumCurve,
  VibrationalMode,
} from '$lib/spectral'
// broaden_spectrum delegates to it, and that delegation is under test
import { broaden_peaks } from '$lib/lineshape'
import co2_born from '$site/phonons/ir-raman/CO2.BORN?raw'
import co2_yaml from '$site/phonons/ir-raman/CO2-gamma.yaml.gz?raw'
import co2_raman_json from '$site/phonons/ir-raman/CO2-raman-tensors.json.gz'
import nacl_born from '$site/phonons/ir-raman/NaCl.BORN?raw'
import nacl_yaml from '$site/phonons/ir-raman/NaCl-gamma.yaml.gz?raw'
import sio2_born from '$site/phonons/ir-raman/SiO2.BORN?raw'
import sio2_raman_json from '$site/phonons/ir-raman/SiO2-raman-tensors.json.gz'
import sio2_yaml from '$site/phonons/ir-raman/SiO2-gamma.yaml.gz?raw'
import { type ComponentProps, mount, tick } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import { bind_props, doc_query, expect_plot_controls } from '../setup'

const co2_data = parse_phonon_modes(co2_yaml)
const co2_born_data = parse_born(co2_born)
const nacl_data = parse_phonon_modes(nacl_yaml)
const nacl_born_data = parse_born(nacl_born)
const nacl_masses = nacl_data.atoms.map((atom) => atom.mass)
const co2_raman_tensors = co2_raman_json.raman_tensors

// Nested array literals are always exploded one row per line by the formatter, so build
// 3-row literals through a call instead.
const mat3 = (row0: Vec3, row1: Vec3, row2: Vec3): Matrix3x3 => [row0, row1, row2]
const cvec3 = (c_x: Complex, c_y: Complex, c_z: Complex): Complex[] => [c_x, c_y, c_z]
const mode_indices = (modes: VibrationalMode[], keep: (mode: VibrationalMode) => boolean) =>
  modes.filter(keep).map((mode) => mode.mode_idx)

// Masses straight from the fixtures, so the closed-form expectations below are checked
// against the same numbers the implementation sees.
const [M_C, M_O] = [co2_data.atoms[0].mass, co2_data.atoms[1].mass]
const [M_NA, M_CL] = [nacl_data.atoms[0].mass, nacl_data.atoms[1].mass]

// CO2 mode indices, in the order the fixture declares them.
const CO2_ACOUSTIC = [0, 1, 2] // translations
const CO2_GERADE = [3, 4, 7] // librations R_x, R_y and the nu1 symmetric stretch
const CO2_UNGERADE = [5, 6, 8] // nu2 bends and the nu3 antisymmetric stretch

const co2_spectrum = spectrum_from_phonon_data(co2_data, co2_born_data, {
  raman_tensors: co2_raman_tensors,
})
const nacl_spectrum = spectrum_from_phonon_data(nacl_data, nacl_born_data)
// mode 3 is the first optical branch; used to drive ir_intensity's own guards
const nacl_optical_eigvec = nacl_data.qpoints[0].modes[3].eigenvector ?? []

// alpha-quartz: the only fixture carrying real polarizability derivatives. Point group 32
// splits the 27 modes into A1 (Raman only), A2 (IR only) and doubly degenerate E (both).
const sio2_data = parse_phonon_modes(sio2_yaml)
const sio2_spectrum = spectrum_from_phonon_data(sio2_data, parse_born(sio2_born), {
  raman_tensors: sio2_raman_json.raman_tensors,
})

describe(`eigenvector mass-weighting convention`, () => {
  // HONEST CAVEAT: these two tests are circular as evidence about phonopy. Both fixtures
  // were hand-written FROM the assumption that eigenvectors are those of the mass-weighted
  // dynamical matrix, so what follows proves the fixtures and the code agree, not that the
  // assumption matches what phonopy writes. The assumption is in fact phonopy's convention,
  // but that is documentation, not measurement — only a genuine phonopy-produced
  // qpoints.yaml would settle it, and none was available offline. Read these as regression
  // guards on the convention, not as a check of it.
  //
  // Given the assumption, a pure translation is the sharpest discriminator: every atom
  // moves by the same amount, so a mass-weighted eigenvector has components proportional to
  // sqrt(M) while a displacement eigenvector would have equal components on every atom.
  it.each([
    [`NaCl acoustic`, nacl_data],
    [`CO2 T_x`, co2_data],
  ])(`%s: component ratio equals sqrt(mass ratio)`, (_name, data) => {
    const eigenvector = data.qpoints[0].modes[0].eigenvector
    if (!eigenvector) throw new Error(`fixture has no eigenvector`)
    const ratio = eigenvector[0][0][0] / eigenvector[1][0][0]
    const mass_ratio = Math.sqrt(data.atoms[0].mass / data.atoms[1].mass)
    expect(ratio).toBeCloseTo(mass_ratio, 12)
    // Sanity: the two hypotheses are distinguishable, i.e. the masses actually differ
    expect(Math.abs(mass_ratio - 1)).toBeGreaterThan(0.1)
  })

  it(`dividing by sqrt(M) turns an acoustic eigenvector into a rigid translation`, () => {
    const eigenvector = nacl_data.qpoints[0].modes[0].eigenvector
    if (!eigenvector) throw new Error(`fixture has no eigenvector`)
    const displacements = eigenvector.map(
      (atom_block, atom_idx) => atom_block[0][0] / Math.sqrt(nacl_masses[atom_idx]),
    )
    expect(displacements[0]).toBeCloseTo(displacements[1], 12)
  })
})

describe(`acoustic mode identification`, () => {
  it.each([
    // Per-fixture frequency bound: CO2 declares its translations at literal 0 THz, while
    // NaCl comes from real force constants and leaves ~2e-7 THz (6e-6 cm^-1) of residual.
    [`CO2`, co2_spectrum, CO2_ACOUSTIC, 1e-12],
    [`NaCl`, nacl_spectrum, [0, 1, 2], 1e-5],
  ])(
    `%s: the three zero-frequency Gamma modes are acoustic and IR-silent`,
    (_name, spec, expected, freq_bound) => {
      const acoustic = spec.modes.filter((mode) => mode.is_acoustic)
      const indices = acoustic.map((mode) => mode.mode_idx)
      expect(indices.toSorted((lo, hi) => lo - hi)).toEqual(expected)
      for (const mode of acoustic) {
        // Both bounds sit five or more orders under the smallest optical branch either
        // fixture carries (2 THz for CO2, 5.05 THz for NaCl), so this pins "zero-frequency"
        // rather than the classifier's own ACOUSTIC_FREQ_THRESHOLD, which would be circular.
        expect(Math.abs(mode.frequency), `mode ${mode.mode_idx} frequency`).toBeLessThan(
          freq_bound,
        )
        // Exactly zero up to f64 round-off: sum_kappa Z*_kappa = 0 and every atom of an
        // acoustic mode has the same displacement, so the dipole derivative cancels term by
        // term. Bound is well below the smallest optical intensity (~4e-2).
        expect(Math.abs(mode.ir_intensity), `mode ${mode.mode_idx}`).toBeLessThan(1e-15)
      }
    },
  )

  it(`away from Gamma no mode is labelled acoustic`, () => {
    expect(is_gamma_point([0.25, 0, 0])).toBe(false)
    const off_gamma = acoustic_mode_indices(co2_data.qpoints[0].modes, [0.25, 0, 0])
    expect(off_gamma.size).toBe(0)
  })

  it(`only counts near-zero modes even when fewer than three qualify`, () => {
    const modes = [0.1, 0.2, 3, 4].map((frequency) => ({ frequency, eigenvector: null }))
    expect([...acoustic_mode_indices(modes, [0, 0, 0])]).toEqual([0, 1])
  })
})

describe(`IR intensities against closed-form results`, () => {
  // The one genuinely end-to-end check of the mass weighting: mu cannot cancel out of
  // Z*^2/mu, so getting this number right requires both masses to enter as assumed.
  it(`NaCl optical mode reproduces Z*^2 / mu`, () => {
    const reduced_mass = (M_NA * M_CL) / (M_NA + M_CL)
    const expected = nacl_born_data.born_charges[0][0][0] ** 2 / reduced_mass
    for (const mode_idx of [3, 4, 5]) {
      const mode = nacl_spectrum.modes[mode_idx]
      expect(mode.is_acoustic).toBe(false)
      // Analytic for a 2-atom cell: the optical eigenvector is symmetry-fixed, so
      // I = Z*^2 (1/M_Na + 1/M_Cl) = Z*^2 / mu with no free parameters.
      expect(mode.ir_intensity).toBeCloseTo(expected, 12)
    }
    // magnitude pin, from PBEsol Z*(Na) = 1.08875538 and mu = 13.945 amu
    expect(expected).toBeCloseTo(0.084997, 6)
  })

  // NOT a mass-weighting discriminator, despite the mass factors in the formula: for a
  // linear XY2 the nu2 and nu3 modes have identical mass-weighted amplitude patterns, so
  // the mass terms cancel between them. What this does check is that the right Born-charge
  // component is picked up for each cartesian direction.
  it.each([
    [`nu2 bend x`, 5, 0],
    [`nu2 bend y`, 6, 0],
    [`nu3 asym stretch`, 8, 2],
  ])(`CO2 %s reproduces Z_C^2 (1/M_C + 1/(2 M_O))`, (_name, mode_idx, direction) => {
    const z_carbon = co2_born_data.born_charges[0][direction][direction]
    const expected = z_carbon ** 2 * (1 / M_C + 1 / (2 * M_O))
    expect(co2_spectrum.modes[mode_idx].ir_intensity).toBeCloseTo(expected, 12)
  })

  // Hand-computed: I = sum_alpha |sum_{kappa,beta} Z*_{kappa,alpha beta} e_{kappa beta} / sqrt(M_kappa)|^2
  // with a complex eigenvector and an off-diagonal Z* so every index of the contraction is
  // exercised. Atom 0 (M = 4, weight 1/2): mu_x = (1*(0.6,0) + 2*(0,0.8))/2 = (0.3, 0.8),
  // mu_y = (0,0.8)/2 = (0, 0.4). Atom 1 (M = 1): mu_y += -1*(0.5,0). Total
  // |(0.3,0.8)|^2 + |(-0.5,0.4)|^2 = 0.73 + 0.41 = 1.14.
  it(`reproduces a hand-computed two-atom contraction`, () => {
    const eigenvector = [cvec3([0.6, 0], [0, 0.8], [0, 0]), cvec3([0, 0], [0.5, 0], [0, 0])]
    const born_charges = [
      mat3([1, 2, 0], [0, 1, 0], [0, 0, 3]),
      mat3([-1, 0, 0], [0, -1, 0], [0, 0, -3]),
    ]
    expect(ir_intensity(eigenvector, [4, 1], born_charges)).toBeCloseTo(1.14, 14)
  })

  it(`throws when Born charge and eigenvector atom counts disagree`, () => {
    const born = { ...nacl_born_data, born_charges: [nacl_born_data.born_charges[0]] }
    const compute = () => compute_ir_raman_spectrum(nacl_data.qpoints[0], nacl_masses, born)
    expect(compute).toThrow(/1 Born charge tensors for 2 atoms/)
  })

  // Building a spectrum means pairing a phonopy YAML with a BORN and maybe a Raman file,
  // routinely from different sources, so every shape mismatch has to name what disagreed
  // rather than silently truncate to the shorter array.
  const nacl_q = () => nacl_data.qpoints[0]
  const spec = (opts = {}, qpoint = nacl_q()) =>
    compute_ir_raman_spectrum(qpoint, nacl_masses, nacl_born_data, opts)
  const charges = nacl_born_data.born_charges
  // oxfmt-ignore
  it.each([
    [`fewer modes than 3N`, () => spec({}, { ...nacl_q(), modes: nacl_q().modes.slice(0, 5) }), /5 modes for 2 atoms, expected 3N = 6/],
    [`one Raman tensor for six modes`, () => spec({ raman_tensors: [mat3([1, 0, 0], [0, 1, 0], [0, 0, 1])] }), /1 Raman tensors for 6 modes/],
    [`one Raman activity for six modes`, () => spec({ raman_activities: [1] }), /1 Raman activities for 6 modes/],
    [`a mass array shorter than the eigenvector`, () => ir_intensity(nacl_optical_eigvec, [M_NA], charges), /length mismatch/],
    [`a non-physical mass`, () => ir_intensity(nacl_optical_eigvec, [0, M_CL], charges), /atom 0 has invalid mass 0/],
  ])(`rejects %s`, (_name, run, pattern) => expect(run).toThrow(pattern))

  it(`throws when a mode has no eigenvector`, () => {
    const modes = nacl_data.qpoints[0].modes.map((mode) => ({ ...mode, eigenvector: null }))
    const stripped = { ...nacl_data.qpoints[0], modes }
    const compute = () => compute_ir_raman_spectrum(stripped, nacl_masses, nacl_born_data)
    expect(compute).toThrow(/has no eigenvector/)
  })

  it(`scales quadratically with the Born charges`, () => {
    const born_charges = nacl_born_data.born_charges.map(
      (tensor) => tensor.map((row) => row.map((val) => 2 * val)) as Matrix3x3,
    )
    const doubled = { ...nacl_born_data, born_charges }
    const scaled = compute_ir_raman_spectrum(nacl_data.qpoints[0], nacl_masses, doubled)
    const plain_intensity = nacl_spectrum.modes[3].ir_intensity
    expect(scaled.modes[3].ir_intensity).toBeCloseTo(4 * plain_intensity, 12)
  })
})

describe(`selection rules`, () => {
  it(`CO2 gerade modes are IR silent, ungerade modes IR active`, () => {
    // Gerade modes of a centrosymmetric structure cannot carry a dipole derivative. This is
    // exact, not small: the O atoms move oppositely while their Z* tensors are identical
    // (Z* is even under inversion), so every contribution cancels.
    const ir_of = (mode_idx: number) => co2_spectrum.modes[mode_idx].ir_intensity
    expect(CO2_GERADE.map((mode_idx) => Math.abs(ir_of(mode_idx)) < 1e-15)).not.toContain(
      false,
    )
    expect(CO2_UNGERADE.map((mode_idx) => ir_of(mode_idx) > 1e-2)).not.toContain(false)
  })

  // The real-data counterpart of the CO2 selection-rule checks below. Point group 32 has no
  // inversion centre, so mutual exclusion does not apply — but A2 modes still carry IR
  // intensity with zero Raman activity, and the split has to survive the whole pipeline.
  it(`alpha-quartz A2 modes are IR-active and Raman-silent`, () => {
    const optical = sio2_spectrum.modes.filter((mode) => !mode.is_acoustic)
    expect(optical).toHaveLength(24)
    const raman_silent = optical.filter((mode) => (mode.raman_activity ?? 0) === 0)
    // the four A2 modes; every other optical mode is A1 or E and carries Raman activity
    expect(raman_silent.map((mode) => mode.mode_idx)).toEqual([9, 15, 18, 23])
    // ...and those indices are exactly the A2 entries in the irrep labels, which come from
    // phonopy's own symmetry analysis rather than from the Raman file that omitted them
    const labels = sio2_raman_json.mode_labels
    expect(labels.flatMap((label, idx) => (label === `A2` ? [idx] : []))).toEqual([
      9, 15, 18, 23,
    ])
    for (const mode of raman_silent) expect(mode.ir_intensity).toBeGreaterThan(1e-3)
    // ...and no optical mode is silent in both channels, which would mean a dropped mode
    for (const mode of optical) {
      expect(
        mode.ir_intensity + (mode.raman_activity ?? 0),
        `mode ${mode.mode_idx}`,
      ).toBeGreaterThan(0)
    }
  })

  it(`CO2 obeys mutual exclusion: no mode is both IR and Raman active`, () => {
    const { modes } = co2_spectrum
    const ir_active = mode_indices(modes, (mode) => mode.ir_intensity > 1e-12)
    const raman_active = mode_indices(modes, (mode) => (mode.raman_activity ?? 0) > 1e-12)
    expect(ir_active.filter((idx) => raman_active.includes(idx))).toEqual([])
    // ...and the split is the textbook one, not vacuously empty on both sides
    expect(ir_active).toEqual(CO2_UNGERADE)
    expect(raman_active).toEqual([7])
  })

  it(`NaCl has an IR-active optical mode and no Raman data`, () => {
    expect(nacl_spectrum.has_raman).toBe(false)
    expect(nacl_spectrum.modes.every((mode) => mode.raman_activity === null)).toBe(true)
    expect(() => spectrum_sticks(nacl_spectrum, `raman`)).toThrow(/no polarizability data/)
  })

  it(`IR intensity is invariant under a global eigenvector phase`, () => {
    // Physical observables cannot depend on the arbitrary complex phase of an eigenvector.
    const { eigenvector } = nacl_data.qpoints[0].modes[3]
    if (!eigenvector) throw new Error(`fixture has no eigenvector`)
    const angle = 0.7
    const rotate = ([re_part, im_part]: Complex): Complex => [
      re_part * Math.cos(angle) - im_part * Math.sin(angle),
      re_part * Math.sin(angle) + im_part * Math.cos(angle),
    ]
    const rotated = eigenvector.map((atom_block) => atom_block.map(rotate))
    const charges = nacl_born_data.born_charges
    const rotated_intensity = ir_intensity(rotated, nacl_masses, charges)
    expect(rotated_intensity).toBeCloseTo(ir_intensity(eigenvector, nacl_masses, charges), 12)
  })
})

describe(`raman_invariants`, () => {
  it.each([
    // Isotropic tensor: no anisotropy, activity = 45 a^2, depolarization 0
    [`isotropic`, 2, 2, 2, 0, 45 * 4, 0],
    // Traceless uniaxial tensor: a = 0, so activity = 7 gamma^2 and rho saturates at 3/4
    [`traceless uniaxial`, 1, 1, -2, 0, 7 * 9, 0.75],
    // Pure shear: a = 0, gamma^2 = 3 * xy^2
    [`pure shear`, 0, 0, 0, 3, 7 * 27, 0.75],
  ])(`%s tensor`, (_name, xx, yy, zz, xy, activity, depolarization) => {
    const invariants = raman_invariants(mat3([xx, xy, 0], [xy, yy, 0], [0, 0, zz]))
    expect(invariants.activity).toBeCloseTo(activity, 12)
    expect(invariants.depolarization_ratio).toBeCloseTo(depolarization, 12)
  })

  it(`uses only the symmetric part of the tensor`, () => {
    const antisymmetric = mat3([0, 1, 0], [-1, 0, 0], [0, 0, 0])
    expect(raman_invariants(antisymmetric).activity).toBe(0)
  })

  it(`CO2 nu1 activity matches the invariant formula applied to the fixture tensor`, () => {
    const expected = raman_invariants(co2_raman_tensors[7]).activity
    expect(co2_spectrum.modes[7].raman_activity).toBeCloseTo(expected, 12)
    expect(expected).toBeGreaterThan(0)
  })

  it(`precomputed activities take precedence over tensors`, () => {
    const raman_activities = co2_data.qpoints[0].modes.map((_mode, idx) => idx)
    const overridden = spectrum_from_phonon_data(co2_data, co2_born_data, {
      raman_tensors: co2_raman_tensors,
      raman_activities,
    })
    const activities = overridden.modes.map((mode) => mode.raman_activity)
    expect(activities).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
  })
})

describe(`spectrum_sticks`, () => {
  it(`drops acoustic modes by default and keeps them on request`, () => {
    expect(spectrum_sticks(co2_spectrum).x).toHaveLength(6)
    expect(spectrum_sticks(co2_spectrum, `ir`, { include_acoustic: true }).x).toHaveLength(9)
  })

  // Experimental CO2 fundamentals in cm^-1, and the same values expressed in THz via the
  // module's own conversion so the two rows cannot drift apart.
  const CO2_OPTICAL_CM = [667, 667, 1333, 2349]
  it.each([
    [`cm^-1`, CO2_OPTICAL_CM],
    [`THz`, CO2_OPTICAL_CM.map((freq) => freq / convert_frequencies([1], `cm^-1`)[0])],
  ] as const)(`emits optical mode positions in %s`, (unit, expected) => {
    // Modes 5..8 are the four optical vibrations (librations 3,4 come first)
    const optical = spectrum_sticks(co2_spectrum, `ir`, { unit }).x.slice(2)
    for (const [idx, value] of optical.entries()) expect(value).toBeCloseTo(expected[idx], 6)
  })

  it(`flags imaginary modes and excludes them by default`, () => {
    const modes = nacl_data.qpoints[0].modes.map((mode, idx) =>
      idx === 3 ? { ...mode, frequency: -3 } : mode,
    )
    const soft = { ...nacl_data.qpoints[0], modes }
    const spectrum = compute_ir_raman_spectrum(soft, nacl_masses, nacl_born_data)
    expect(spectrum.modes[3].is_imaginary).toBe(true)
    expect(spectrum_sticks(spectrum).x).toHaveLength(2)
    expect(spectrum_sticks(spectrum, `ir`, { include_imaginary: true }).x).toHaveLength(3)
  })

  // Whether a mode is imaginary is a property of that mode, so the same -1.5 THz soft mode
  // must be flagged identically however many other branches the cell happens to have. A
  // spectral-weight fraction would call it imaginary at 9 modes and real at 48, leaking a
  // -50 cm^-1 stick into the default spectrum of the larger cell.
  it.each([3, 16])(`a -1.5 THz soft mode is imaginary in a %i-atom cell`, (n_atoms) => {
    const zeros = mat3([0, 0, 0], [0, 0, 0], [0, 0, 0])
    const eigenvector = Array.from({ length: n_atoms }, () => cvec3([1, 0], [0, 0], [0, 0]))
    const soft_idx = 3
    const modes = Array.from({ length: 3 * n_atoms }, (_unused, mode_idx) => ({
      eigenvector,
      frequency: mode_idx < 3 ? 0.01 : mode_idx === soft_idx ? -1.5 : 5 + mode_idx,
    }))
    const born_charges = Array.from({ length: n_atoms }, () => zeros)
    const spectrum = compute_ir_raman_spectrum(
      { q_position: [0, 0, 0], distance: null, modes },
      Array.from({ length: n_atoms }, () => 12),
      { factor: 1, dielectric: zeros, born_charges },
    )
    expect(spectrum.modes[soft_idx].is_imaginary).toBe(true)
    expect(spectrum.modes.filter((mode) => mode.is_imaginary)).toHaveLength(1)
    // -1.5 THz is -50.0 cm^-1; the default stick spectrum must not carry it
    expect(spectrum_sticks(spectrum).x.every((freq) => freq > 0)).toBe(true)
  })
})

describe(`broaden_spectrum`, () => {
  // Measure the width of the broadened profile at half its maximum, interpolating linearly
  // between the two grid points that bracket each crossing.
  const measure_fwhm = (curve: SpectrumCurve): number => {
    const half = Math.max(...curve.y) / 2
    const crossings: number[] = []
    for (let idx = 1; idx < curve.y.length; idx++) {
      const [y_prev, y_next] = [curve.y[idx - 1], curve.y[idx]]
      const [below_prev, below_next] = [y_prev < half, y_next < half]
      if (below_prev === below_next) continue
      const frac = (half - y_prev) / (y_next - y_prev)
      crossings.push(curve.x[idx - 1] + frac * (curve.x[idx] - curve.x[idx - 1]))
    }
    if (crossings.length !== 2) {
      throw new Error(`expected 2 half-maximum crossings, found ${crossings.length}`)
    }
    return crossings[1] - crossings[0]
  }
  const gaussian = (fwhm: number, range: Vec2, step_size: number): BroadenOptions => ({
    fwhm,
    shape_factor: 0,
    range,
    step_size,
  })

  it.each([
    [`Gaussian`, 0, 12],
    [`Lorentzian`, 1, 12],
    [`pseudo-Voigt`, 0.5, 30],
  ])(`%s line shape has the requested FWHM`, (_name, shape_factor, fwhm) => {
    const opts: BroadenOptions = { fwhm, shape_factor, range: [700, 1300], step_size: 0.02 }
    const curve = broaden_spectrum({ x: [1000], y: [1] }, opts)
    // Grid step 0.02 with linear interpolation of the crossings; 1e-3 relative is ~0.012
    // in absolute width, comfortably above the interpolation error and below any real
    // shape error the implementation could introduce.
    expect(measure_fwhm(curve) / fwhm).toBeCloseTo(1, 3)
  })

  it(`superposes multiple sticks additively`, () => {
    const opts = gaussian(8, [900, 1300], 0.1)
    const both = broaden_spectrum({ x: [1000, 1200], y: [1, 2] }, opts)
    const first = broaden_spectrum({ x: [1000], y: [1] }, opts)
    const second = broaden_spectrum({ x: [1200], y: [2] }, opts)
    for (let idx = 0; idx < both.y.length; idx += 137) {
      expect(both.y[idx]).toBeCloseTo(first.y[idx] + second.y[idx], 10)
    }
  })

  it(`accepts a frequency-dependent width model`, () => {
    const curve = broaden_spectrum(
      { x: [500, 2000], y: [1, 1] },
      { fwhm_fn: (center) => center / 100, shape_factor: 0, step_size: 0.05 },
    )
    // Peak height of an area-normalised Gaussian scales as 1/FWHM, so the 2000 cm^-1 peak
    // (FWHM 20) must be 4x shorter than the 500 cm^-1 one (FWHM 5).
    const near = (target: number) => {
      const dist = (idx: number) => Math.abs(curve.x[idx] - target)
      const best = curve.x.reduce((acc, _val, idx) => (dist(idx) < dist(acc) ? idx : acc), 0)
      return curve.y[best]
    }
    expect(near(500) / near(2000)).toBeCloseTo(4, 2)
  })

  // Also the area-preservation check: line shapes are area-normalised, so the integral of
  // the broadened curve is the stick intensity, with discretisation the only error source
  // (the Gaussian is truncated at +/-20 FWHM, far outside the +/-25 sigma of this range).
  // The small intensities matter because broaden_peaks drops any stick below an ABSOLUTE
  // 1e-5 — a sane floor for XRD intensities normalised to 100, meaningless in e^2/amu,
  // where a whole spectrum can legitimately sit under it.
  it.each([9e-6, 3.7])(`broadens a spectrum whose only stick is %f`, (intensity) => {
    const step_size = 0.05
    const opts = gaussian(12, [700, 1300], step_size)
    const curve = broaden_spectrum({ x: [1000], y: [intensity] }, opts)
    const area = curve.y.reduce((acc, val) => acc + val, 0) * step_size
    expect(area / intensity).toBeCloseTo(1, 6)
  })

  // ...and it skips sticks more than 5 x-units outside `range`, a buffer that meant
  // degrees of 2-theta upstream and nothing at all in cm^-1.
  it.each([
    [`6 cm^-1 past the high edge`, 1106],
    [`80 cm^-1 past the high edge`, 1180],
    [`80 cm^-1 below the low edge`, 820],
  ])(`keeps the tail of a stick %s`, (_name, position) => {
    const opts = gaussian(40, [900, 1100], 0.5)
    const curve = broaden_spectrum({ x: [position], y: [1] }, opts)
    // Same grid as a stick that was always inside the range...
    expect(curve.x).toEqual(broaden_spectrum({ x: [1000], y: [1] }, opts).x)
    // ...carrying the analytic Gaussian tail at the nearest grid point, which the buffer
    // would otherwise zero outright
    const gap = Math.min(...curve.x.map((x_val) => Math.abs(x_val - position)))
    const sigma = 40 / (2 * Math.sqrt(2 * Math.LN2))
    const expected =
      Math.exp(-(gap ** 2) / (2 * sigma ** 2)) / (sigma * Math.sqrt(2 * Math.PI))
    // 1e-3 relative covers the grid discretisation of the nearest-point lookup
    expect(Math.max(...curve.y) / expected).toBeCloseTo(1, 3)
  })

  // A caller-supplied fwhm_fn gets the same check as the constant. Without it the failure
  // surfaces downstream as "step_size must be > 0", naming a derived value rather than the
  // width model that produced it.
  it.each([
    [`zero fwhm`, { fwhm: 0 }, /fwhm must be > 0/],
    [`an fwhm_fn returning 0`, { fwhm_fn: () => 0 }, /fwhm must be > 0.*got 0/],
    [`an fwhm_fn returning NaN`, { fwhm_fn: () => NaN }, /got NaN/],
  ])(`throws on %s`, (_name, options, pattern) => {
    expect(() => broaden_spectrum({ x: [100], y: [1] }, options)).toThrow(pattern)
  })

  // ...but only the bad one, and the message has to name which stick it was
  it(`names the stick whose width model went bad`, () => {
    const fwhm_fn = (center: number) => (center === 2000 ? 0 : 10)
    expect(() => broaden_spectrum({ x: [500, 2000], y: [1, 1] }, { fwhm_fn })).toThrow(
      /got 0 at peak 2000/,
    )
  })

  // Every width can be individually valid while their ratio is not: the grid spans
  // 10*max_width in steps of min_width/20, so this asks for ~2.4e12 points and used to
  // hand broaden_peaks an uninterruptible fill loop (measured: still running after 4 min).
  const wide_ratio_sticks = { x: [0, 1000], y: [1, 1] }
  const wide_ratio_fwhm = (center: number) => (center === 0 ? 1e-8 : 10)

  it(`refuses a width ratio that would explode the grid`, () => {
    const broaden = () => broaden_spectrum(wide_ratio_sticks, { fwhm_fn: wide_ratio_fwhm })
    expect(broaden).toThrow(
      /grid points over \[-100, 1100\] at step 5e-10.*Widths span 1e-8\.\.10/s,
    )
  })

  // ...but an explicit step_size means the caller has taken responsibility for the grid
  it(`allows a wide width ratio when step_size is given explicitly`, () => {
    const opts = { fwhm_fn: wide_ratio_fwhm, range: [-50, 1050] as Vec2, step_size: 0.5 }
    const curve = broaden_spectrum(wide_ratio_sticks, opts)
    expect(curve.x).toHaveLength(2201) // [-50, 1050] at 0.5 is 2200 steps plus the endpoint
    expect(curve.y.every(Number.isFinite)).toBe(true)
  })

  // NaN would otherwise come back as a full curve of NaN, a negative as an all-zero curve
  // (broaden_peaks drops it under the relative intensity floor), neither with any signal.
  // NaN and shape_factor are broaden_peaks' own checks; the negative one is local.
  it.each([
    [`a NaN stick intensity`, { y: [NaN] }, {}, /intensities must be finite, got NaN/],
    [
      `a negative stick intensity`,
      { y: [-5] },
      {},
      /stick 0 at 1000 has negative intensity -5/,
    ],
    [`a NaN shape_factor`, {}, { shape_factor: NaN }, /shape_factor must be in \[0, 1\]/],
  ])(`rejects %s`, (_name, stick_override, opt_override, pattern) => {
    const sticks = { x: [1000], y: [1], ...stick_override }
    expect(() => broaden_spectrum(sticks, { fwhm: 10, ...opt_override })).toThrow(pattern)
  })

  it(`throws on mismatched stick arrays and returns empty for no sticks`, () => {
    const mismatched = () => broaden_spectrum({ x: [1, 2], y: [1] })
    expect(mismatched).toThrow(/2 positions but 1 intensities/)
    expect(broaden_spectrum({ x: [], y: [] })).toEqual({ x: [], y: [] })
  })

  // broaden_spectrum used to rescale intensities to max 1 and widen/crop the grid to work
  // around broaden_peaks' XRD-flavoured constants. Both are gone, so it must now be a plain
  // delegation - exactly equal, not merely close, since nothing rescales on the way through.
  it(`passes sticks straight through to broaden_peaks`, () => {
    const sticks = { x: [820, 1106, 1180], y: [0.4, 1.7, 0.9] }
    const [range, step_size, shape_factor]: [Vec2, number, number] = [[900, 1100], 0.5, 0.5]
    const via_spectrum = broaden_spectrum(sticks, { fwhm: 12, shape_factor, range, step_size })
    const direct = broaden_peaks(sticks, () => 12, shape_factor, range, step_size)
    expect(via_spectrum.y).toEqual(direct.y)
    expect(via_spectrum.x).toEqual(direct.x)
    // sticks outside `range` still paint their tails across it (820 and 1180 are both
    // within 20 x FWHM of the window), which is what the old grid extension existed for
    expect(Math.max(...via_spectrum.y)).toBeGreaterThan(0)
  })

  // An absolute 1e-5 floor erased spectra outright: IR intensities in e^2/amu routinely sit
  // below it, and pre-scaling to max 1 was the workaround. Broadening is linear in intensity
  // and the floor is relative now, so scaling every stick scales the curve by exactly that
  // factor. Under the old floor the 1e-9 curve came back all zeros and this reads 1.
  it(`broadens to the same profile whatever the intensities are scaled to`, () => {
    const curve_at = (scale: number) =>
      broaden_spectrum(
        { x: [1000, 1200], y: [2 * scale, scale] },
        { fwhm: 10, range: [900, 1300], step_size: 1 },
      )
    const reference = curve_at(1)
    expect(Math.max(...reference.y)).toBeGreaterThan(0)

    for (const scale of [1e-9, 1e9]) {
      const scaled = curve_at(scale)
      const max_rel_err = Math.max(
        ...reference.y.map((val, idx) =>
          val === 0 ? 0 : Math.abs(scaled.y[idx] / scale - val) / val,
        ),
      )
      expect(max_rel_err, `scale ${scale}`).toBeLessThan(1e-12)
    }
  })
})

// The conversion factors themselves are pinned per unit in helpers.test.ts
it(`round-trips a 4000 cm^-1 mode through THz and meV`, () => {
  const cm_per_thz = convert_frequencies([1], `cm^-1`)[0]
  const thz = 4000 / cm_per_thz
  expect(convert_frequencies([thz], `cm^-1`)[0]).toBeCloseTo(4000, 9)
  expect(convert_frequencies([thz], `meV`)[0]).toBeCloseTo(495.9, 1) // 4000 cm^-1 = 0.4959 eV
})

it(`a 4000 cm^-1 stick survives the IR path`, () => {
  const cm_per_thz = convert_frequencies([1], `cm^-1`)[0]
  // Mode 8 is optical and IR-active, so only its frequency has to be swapped out
  const mode = { ...co2_spectrum.modes[8], frequency: 4000 / cm_per_thz }
  const spectrum = { ...co2_spectrum, modes: [mode] }
  expect(spectrum_sticks(spectrum, `ir`, { unit: `cm^-1` }).x[0]).toBeCloseTo(4000, 9)
})

// Its only caller inverts the result as 1 - A, so a silent no-op here would render a
// flat transmittance line at 1 and look like a converged spectrum with no absorption.
it.each([
  [`an all-zero curve`, [0, 0, 0]],
  [`an all-negative curve`, [-1, -2]],
  [`a non-finite maximum`, [Number.NaN, 1]],
])(`scale_to_max throws for %s instead of passing it through`, (_name, values) => {
  expect(() => scale_to_max(values)).toThrow(/needs a positive finite maximum/)
})

it(`to_transmittance puts the baseline at 1 and the strongest absorption at 0`, () => {
  expect(to_transmittance([1, 2, 4])).toEqual([0.75, 0.5, 0])
  expect(to_transmittance([0, 0, 5])).toEqual([1, 1, 0])
  // broadened grids run to 1e7 points, past what Math.max(...values) accepts
  const wide = Array.from({ length: 300_000 }, (_, idx) => idx % 1000)
  expect(to_transmittance(wide)[999]).toBe(0)
})

it(`spectrum_from_phonon_data selects the Gamma point automatically`, () => {
  expect(co2_spectrum.q_position).toEqual([0, 0, 0])
  expect(co2_spectrum.n_atoms).toBe(3)
})

it(`spectrum_from_phonon_data throws when no Gamma point is present`, () => {
  const shifted: PhononModeData = {
    ...nacl_data,
    qpoints: [{ ...nacl_data.qpoints[0], q_position: [0.5, 0, 0] }],
  }
  expect(() => spectrum_from_phonon_data(shifted, nacl_born_data)).toThrow(/no Gamma point/)
})

// A negative index used to fall into the Gamma-search branch and report "no Gamma point",
// which says nothing about the index the caller actually passed
it.each([5, -1])(`spectrum_from_phonon_data throws on q-point index %i`, (qpoint_index) => {
  const compute = () => spectrum_from_phonon_data(nacl_data, nacl_born_data, { qpoint_index })
  expect(compute).toThrow(/out of range/)
})

// Frequencies as declared in the fixtures, in file order (THz). The parser must not sort.
const CM_TO_THZ = 0.0299792458
const CO2_FREQS = [0, 0, 0, 2, 2, 667, 667, 1333, 2349].map((freq, idx) =>
  idx < 5 ? freq : freq * CM_TO_THZ,
)
// Exactly as the fixture declares them, since this test pins declared order. PhononDB
// PBEsol puts the triply-degenerate TO mode at 5.0527 THz = 168.5 cm^-1 against ~164
// measured (normal PBEsol agreement for a rocksalt halide); the three translations carry
// ~1e-7 THz of force-constant residual rather than the literal 0 a synthetic file can use.
// oxfmt-ignore
const NACL_FREQS = [
  -0.0000001723, -0.0000000824, 0.0000000659,
  5.0527260362, 5.0527260362, 5.0527260362,
]

// Minimal 1-atom phonopy YAML, spliced together per error case.
const h_cell = (natom = 1, mass = 1) =>
  `natom: ${natom}\npoints:\n- symbol: H\n  coordinates: [0,0,0]\n  mass: ${mass}\n`
const Q_BAND = `phonon:\n- q-position: [0,0,0]\n  band:\n  - frequency: 1.0\n`
const H_BAND = `${h_cell()}${Q_BAND}`
const MORE_FREQS = `  - frequency: 2.0\n  - frequency: 3.0\n`
const eig_atom = (re_part: number) => `    - - [${re_part},0]\n      - [0,0]\n      - [0,0]\n`
const eig_x = (re_part = 1, n_atoms = 1) =>
  `    eigenvector:\n${eig_atom(re_part).repeat(n_atoms)}`

// One row-major identity tensor line, the shape every BORN data line has.
const UNIT_TENSOR = `1 0 0 0 1 0 0 0 1\n`

describe(`parse_phonon_modes`, () => {
  it.each([
    // oxfmt-ignore
    [`CO2`, co2_data, [`C`, `O`, `O`], CO2_FREQS,
      [[12, 0, 0], [0, 12, 0], [0, 0, 12]]],
    // oxfmt-ignore
    [`NaCl`, nacl_data, [`Na`, `Cl`], NACL_FREQS,
      [[0, 2.79977964, 2.79977964], [2.79977964, 0, 2.79977964], [2.79977964, 2.79977964, 0]]],
  ])(
    `%s: parses 3N modes with normalised eigenvectors in declared order`,
    (_name, data, symbols, expected_freqs, expected_lattice) => {
      const n_atoms = symbols.length
      expect(data.n_atoms).toBe(n_atoms)
      expect(data.atoms.map((atom) => atom.symbol)).toEqual(symbols)
      // row order and orientation, which the Matrix3x3 cast cannot check
      expect(data.lattice).toEqual(expected_lattice)
      expect(data.qpoints).toHaveLength(1)

      const { modes, q_position } = data.qpoints[0]
      expect(q_position).toEqual([0, 0, 0])
      // Mode count must be exactly 3N
      expect(modes).toHaveLength(3 * n_atoms)

      for (const [mode_idx, mode] of modes.entries()) {
        const label = `mode ${mode_idx}`
        // Frequencies come back in the order the file declares them (no sorting). The
        // fixtures are written to 14 decimals, hence the 1e-12 comparison.
        expect(mode.frequency, label).toBeCloseTo(expected_freqs[mode_idx], 12)
        expect(mode.eigenvector, label).not.toBeNull()
        if (!mode.eigenvector) continue
        // [n_atoms][3] complex layout
        expect(mode.eigenvector).toHaveLength(n_atoms)
        for (const atom_block of mode.eigenvector) expect(atom_block).toHaveLength(3)
        // Normalised to sum |e|^2 = 1. Fixtures are written to 14 decimals, so the only
        // error here is the rounding of the last digit of each of 3N components.
        expect(eigenvector_norm_sq(mode.eigenvector)).toBeCloseTo(1, 12)
      }
    },
  )

  it(`round-trips eigenvector components including imaginary parts`, () => {
    const yaml = `natom: 1
points: [{symbol: H, coordinates: [0,0,0], mass: 1.008}]
phonon:
- q-position: [0.25, 0, 0]
  band:
  - {frequency: 12.5, eigenvector: [[[0.6,0],[0,0.8],[0,0]]]}
  - {frequency: 13.5, eigenvector: [[[1,0],[0,0],[0,0]]]}
  - {frequency: 14.5, eigenvector: [[[0,0],[0,0],[0,-1]]]}
`
    const { qpoints } = parse_phonon_modes(yaml)
    expect(qpoints[0].q_position).toEqual([0.25, 0, 0])
    expect(qpoints[0].modes[0].eigenvector?.[0]).toEqual(cvec3([0.6, 0], [0, 0.8], [0, 0]))
    expect(qpoints[0].modes[2].eigenvector?.[0][2]).toEqual([0, -1])
  })

  it(`normalizes band path segments`, () => {
    const yaml = `natom: 1
nqpoint: 2
segment_nqpoint: [2]
labels: [[GAMMA, X]]
lattice: [[1,0,0],[0,1,0],[0,0,1]]
points: [{symbol: H, coordinates: [0,0,0], mass: 1.008}]
phonon:
- q-position: [0,0,0]
  distance: 0
  band:
  - {frequency: 1, eigenvector: [[[1,0],[0,0],[0,0]]]}
  - {frequency: 2, eigenvector: [[[0,0],[1,0],[0,0]]]}
  - {frequency: 3, eigenvector: [[[0,0],[0,0],[1,0]]]}
- q-position: [0.5,0,0]
  distance: 1
  band:
  - {frequency: 2, eigenvector: [[[1,0],[0,0],[0,0]]]}
  - {frequency: 3, eigenvector: [[[0,0],[1,0],[0,0]]]}
  - {frequency: 4, eigenvector: [[[0,0],[0,0],[1,0]]]}
`
    expect(parse_phonon_modes(yaml).path_segments).toEqual([
      { start_index: 0, end_index: 1, start_label: `GAMMA`, end_label: `X` },
    ])
  })

  it.each([
    [`q-point count`, `nqpoint: 2\n`, /declares nqpoint=2 but lists 1 q-points/],
    [`invalid q-point count`, `nqpoint: many\n`, /'nqpoint' must be an integer/],
    [
      `invalid path count`,
      `npath: many\nsegment_nqpoint: [1]\n`,
      /'npath' must be a positive integer/,
    ],
    [
      `path count mismatch`,
      `npath: 2\nsegment_nqpoint: [1]\n`,
      /declares npath=2 but segment_nqpoint lists 1 path segments/,
    ],
    [`segment total`, `segment_nqpoint: [2]\n`, /sums to 2 but phonon lists 1/],
    [
      `label count`,
      `segment_nqpoint: [1]\nlabels: [[GAMMA, X], [X, L]]\n`,
      /one pair for each/,
    ],
    [
      `missing distance`,
      `segment_nqpoint: [1]\nlabels: [[GAMMA, X]]\n`,
      /without a finite 'distance'/,
    ],
  ])(`rejects malformed band metadata: %s`, (_name, metadata, pattern) => {
    expect(() => parse_phonon_modes(`${metadata}${H_BAND}${eig_x()}${MORE_FREQS}`)).toThrow(
      pattern,
    )
  })

  it.each([
    [`no phonon list`, h_cell(), /no non-empty 'phonon' list/],
    [`no atom masses`, Q_BAND, /no 'points'\/'atoms' list with per-atom masses/],
    [`natom clash`, `${h_cell(2)}${Q_BAND}${eig_x()}`, /declares natom=2 but lists 1 atoms/],
    [`no eigenvectors`, `${H_BAND}${MORE_FREQS}`, /no 'eigenvector' blocks/],
    [`unnormalised`, `${H_BAND}${eig_x(2)}`, /not normalised \(sum \|e\|\^2 = 4/],
    [`extra eigenvector atom`, `${H_BAND}${eig_x(1, 2)}`, /over 1 atoms, got 2 atom blocks/],
    [`negative mass`, `${h_cell(1, -1)}${Q_BAND}`, /invalid 'mass'/],
    [`band count`, `${H_BAND}${eig_x()}`, /lists 1 bands but a 1-atom cell has 3N = 3 modes/],
    // A 2-row lattice would otherwise be cast to Matrix3x3 unchecked
    [
      `2-row lattice`,
      `lattice:\n- [1,0,0]\n- [0,1,0]\n${H_BAND}${eig_x()}${MORE_FREQS}`,
      /'lattice': expected 3 rows, got 2/,
    ],
  ])(`throws on %s`, (_name, content, pattern) => {
    expect(() => parse_phonon_modes(content)).toThrow(pattern)
  })
})

describe(`parse_born`, () => {
  it.each([
    [`CO2`, co2_born_data, 3, 14.4, 1.15, [0.6, 0.6, 1.3]],
    [`NaCl`, nacl_born_data, 2, 14.399652, 2.56544675, [1.08875538, 1.08875538, 1.08875538]],
  ])(
    `%s: reads factor, dielectric and one sum-rule-obeying Z* tensor per atom`,
    (_name, born, n_atoms, factor, eps_xx, first_charge_diag) => {
      expect(born.factor).toBeCloseTo(factor, 12)
      expect(born.dielectric[0][0]).toBeCloseTo(eps_xx, 12)
      expect(born.born_charges).toHaveLength(n_atoms)
      const diag = [0, 1, 2].map((idx) => born.born_charges[0][idx][idx])
      expect(diag).toEqual(first_charge_diag)
      // Off-diagonals vanish for both fixtures' site symmetries
      expect(born.born_charges[0][0][1]).toBe(0)
      // Sum over atoms of Z* must vanish for a charge-neutral cell. The fixtures are
      // written with exactly-representable decimals summing to zero, so allow only f64
      // round-off.
      for (const row of born_charge_sum(born.born_charges)) {
        for (const val of row) expect(Math.abs(val)).toBeLessThan(1e-15)
      }
    },
  )

  it.each([
    [`comments and blank lines`, `# lead\n\n14.4 # trailing\n\n${UNIT_TENSOR.repeat(2)}`],
    [`factor plus q-direction`, `14.4 0.0 0.0 1.0\n${UNIT_TENSOR.repeat(2)}`],
  ])(`tolerates %s`, (_name, content) => {
    const born = parse_born(content)
    expect(born.factor).toBeCloseTo(14.4, 12)
    expect(born.born_charges).toHaveLength(1)
  })

  it.each([
    [`too few lines`, `14.4\n${UNIT_TENSOR}`, /need at least 3/],
    [`missing factor line`, UNIT_TENSOR.repeat(3), /expected the NAC unit conversion factor/],
    [`short tensor`, `14.4\n${UNIT_TENSOR}1 0 0\n`, /expected 9 numbers/],
    [`non-numeric token`, `14.4\n${UNIT_TENSOR}foo 0 0 0 1 0 0 0 1\n`, /is not a number/],
  ])(`throws on %s`, (_name, content, pattern) => {
    expect(() => parse_born(content)).toThrow(pattern)
  })
})

it(`apply_born_sum_rule removes the residual, leaves neutral charges untouched`, () => {
  const violating = [
    mat3([1.2, 0, 0], [0, 1.2, 0], [0, 0, 1.2]),
    mat3([-1, 0, 0], [0, -1, 0], [0, 0, -1]),
  ]
  const corrected = apply_born_sum_rule(violating)
  // Residual +0.2 per diagonal element split evenly over 2 atoms
  expect(corrected[0][0][0]).toBeCloseTo(1.1, 12)
  expect(corrected[1][0][0]).toBeCloseTo(-1.1, 12)
  for (const row of born_charge_sum(corrected)) {
    for (const val of row) expect(Math.abs(val)).toBeLessThan(1e-15)
  }

  const neutral = nacl_born_data.born_charges
  expect(apply_born_sum_rule(neutral)).toEqual(neutral)
})

it(`apply_born_sum_rule throws on empty input`, () => {
  expect(() => apply_born_sum_rule([])).toThrow(/no Born charges given/)
})

describe(`IrRamanSpectrum component`, () => {
  type SpectrumProps = ComponentProps<typeof IrRamanSpectrum>
  const render = (props: Partial<SpectrumProps> = {}) =>
    mount(IrRamanSpectrum, {
      target: document.body,
      props: { spectrum: co2_spectrum, ...props },
    })

  // One stick per active optical mode: NaCl's triply degenerate TO mode, CO2's 2 bends + nu3
  // (the 3 acoustic modes are excluded and the gerade modes carry exactly zero intensity, so
  // they draw no stick), and only nu1 is Raman active.
  it.each([
    [`NaCl IR`, { spectrum: nacl_spectrum, fwhm: 8 }, 3],
    [`CO2 IR`, { fwhm: 25 }, 3],
    [`CO2 Raman`, { fwhm: 25, kind: `raman` } as const, 1],
  ])(`renders %s with one stick per active mode`, async (_name, props, n_sticks) => {
    render(props)
    await tick()
    expect(document.querySelector(`.scatter`)).toBeInstanceOf(HTMLElement)
    expect(document.querySelectorAll(`line.mode-stick`)).toHaveLength(n_sticks)
  })

  it(`forwards flat control props and controls_open binding`, async () => {
    expect.hasAssertions()
    const controls_state = { controls_open: true, units: `cm^-1` as FrequencyUnit }
    mount(IrRamanSpectrum, {
      target: document.body,
      props: bind_props(
        {
          spectrum: co2_spectrum,
          controls_toggle_props: { 'data-testid': `ir-raman-toggle` },
          controls_pane_props: { 'data-testid': `ir-raman-pane` },
        },
        controls_state,
      ),
    })
    await tick()
    // picking a unit writes back to the bound `units` (the handler is delegated, so the
    // synthetic change event must bubble like a real one)
    const select = doc_query<HTMLSelectElement>(`#ir-raman-units`)
    select.value = `THz`
    select.dispatchEvent(new Event(`change`, { bubbles: true }))
    await tick()
    expect(controls_state.units).toBe(`THz`)
    await expect_plot_controls(document, controls_state, `ir-raman`)
  })

  it(`hides sticks when show_sticks is false`, async () => {
    render({ fwhm: 25, show_sticks: false })
    await tick()
    expect(document.querySelectorAll(`line.mode-stick`)).toHaveLength(0)
  })

  it(`selects a mode from a stick by pointer or keyboard`, async () => {
    const on_mode_select = vi.fn()
    render({ fwhm: 25, on_mode_select })
    await tick()
    const stick = document.querySelector(`line.mode-stick`)
    expect(stick).toBeInstanceOf(SVGElement)
    stick?.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
    await tick()
    expect(on_mode_select).toHaveBeenCalledOnce()
    expect(stick?.classList.contains(`selected`)).toBe(true)

    stick?.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true }))
    expect(on_mode_select).toHaveBeenCalledTimes(2)
  })

  it(`shows an empty state when Raman is requested without polarizability data`, () => {
    render({ spectrum: nacl_spectrum, kind: `raman` })
    expect(document.querySelector(`.scatter`)).toBeNull()
    expect(document.body.textContent).toMatch(/polarizability derivatives must be supplied/)
  })

  it(`shows an empty state when every mode is silent`, () => {
    const modes = co2_spectrum.modes.map((mode) => ({ ...mode, ir_intensity: 0 }))
    render({ spectrum: { ...co2_spectrum, modes } })
    expect(document.querySelector(`.scatter`)).toBeNull()
    expect(document.body.textContent).toMatch(/No IR-active modes/)
  })

  // FWHM is quoted in whatever unit is on the axis, so switching units has to carry it
  // across; otherwise 25 cm^-1 silently becomes 25 THz, i.e. 834 cm^-1 of broadening.
  it.each([`THz`, `meV`] as const)(`rescales fwhm from cm^-1 to %s`, async (units) => {
    type Props = { spectrum: typeof co2_spectrum; units: FrequencyUnit; fwhm: number }
    const props: Props = $state({ spectrum: co2_spectrum, units: `cm^-1`, fwhm: 25 })
    mount(IrRamanSpectrum, { target: document.body, props })
    await tick()
    props.units = units
    await tick()
    const ratio = convert_frequencies([1], units)[0] / convert_frequencies([1], `cm^-1`)[0]
    // Pure multiplication by a ratio of f64 constants, so demand near-exact agreement
    expect(props.fwhm).toBeCloseTo(25 * ratio, 12)
  })

  // `cm-1`/`cm⁻¹` are the spellings found in the wild; they map to cm^-1 at the prop boundary
  // (no throw, no fwhm rescale since the unit did not actually change)
  it.each([`cm-1`, `cm⁻¹`])(`accepts %s as an alias of cm^-1`, async (alias) => {
    type Props = { spectrum: typeof co2_spectrum; units: FrequencyUnit; fwhm: number }
    const props: Props = $state({
      spectrum: co2_spectrum,
      units: alias as FrequencyUnit,
      fwhm: 25,
    })
    mount(IrRamanSpectrum, { target: document.body, props })
    await tick()
    expect(document.body.textContent).toContain(`Frequency (cm⁻¹)`)
    expect(props.fwhm).toBe(25)
    // flipping to the canonical spelling is the same unit: fwhm must not rescale either
    props.units = `cm^-1`
    await tick()
    expect(props.fwhm).toBe(25)
  })

  // The curve itself is not measurable here — the plot's line path stays empty under
  // happy-dom — so the drawn direction is checked on the sticks, which share the same
  // baseline, and the 1 - A arithmetic is covered by to_transmittance's own unit test.
  it.each([
    [`transmittance`, 1, 0],
    [`absorbance`, 0, 1],
  ] as const)(`%s hangs sticks from the %i baseline`, async (presentation, baseline, peak) => {
    render({ presentation, fwhm: 25 })
    await tick()
    const sticks = [...document.querySelectorAll(`line.mode-stick`)]
    expect(sticks).toHaveLength(3)
    const y_of = (stick: Element, attr: string) => Number(stick.getAttribute(attr))
    // Every stick starts on the shared baseline
    const base_px = y_of(sticks[0], `y1`)
    expect(sticks.every((stick) => y_of(stick, `y1`) === base_px)).toBe(true)
    // The strongest mode spans the full axis, so its far end pins the other extreme and
    // fixes which way round the axis runs: y grows downwards in SVG
    const tips = sticks.map((stick) => y_of(stick, `y2`))
    const full_span = baseline > peak ? Math.max(...tips) : Math.min(...tips)
    expect(baseline > peak ? full_span > base_px : full_span < base_px).toBe(true)
  })
})
