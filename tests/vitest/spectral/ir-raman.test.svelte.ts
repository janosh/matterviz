import type { Matrix3x3, Vec2, Vec3 } from '#lib/math.js'
// Everything is imported through the module barrel, exactly as the demo route does, so a
// missing or name-clashing export fails these tests rather than the site build.
import {
  acoustic_mode_indices,
  broaden_spectrum,
  compute_ir_raman_spectrum,
  ir_intensity,
  peak_mode_indices,
  raman_invariants,
  scale_to_max,
  spectrum_from_phonon_data,
  spectrum_sticks,
  to_transmittance,
} from '#lib/spectral/ir-raman.js'
import {
  apply_born_sum_rule,
  born_charge_sum,
  eigenvector_norm_sq,
  parse_born,
  parse_phonon_modes,
} from '#lib/spectral/parse-phonon-modes.js'
import { convert_frequencies, parse_frequency_unit } from '#lib/spectral/frequency-units.js'
import IrRamanSpectrum from '#lib/spectral/IrRamanSpectrum.svelte'
import { is_gamma_point } from '#lib/spectral/helpers.js'
import type {
  BroadenOptions,
  Complex,
  FrequencyUnit,
  PhononModeData,
  SpectrumCurve,
  VibrationalMode,
} from '#lib/spectral/index.js'
// broaden_spectrum delegates to it, and that delegation is under test
import { broaden_peaks } from '#lib/lineshape.js'
import co2_born from '#site/phonons/ir-raman/CO2.BORN?raw'
import co2_yaml from '#site/phonons/ir-raman/CO2-gamma.yaml.gz?raw'
import co2_raman_json from '#site/phonons/ir-raman/CO2-raman-tensors.json.gz'
import nacl_born from '#site/phonons/ir-raman/NaCl.BORN?raw'
import nacl_yaml from '#site/phonons/ir-raman/NaCl-gamma.yaml.gz?raw'
import sio2_born from '#site/phonons/ir-raman/SiO2.BORN?raw'
import sio2_raman_json from '#site/phonons/ir-raman/SiO2-raman-tensors.json.gz'
import sio2_yaml from '#site/phonons/ir-raman/SiO2-gamma.yaml.gz?raw'
import { type ComponentProps, mount, tick } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import { bind_props, doc_query, expect_plot_controls, set_input } from '../setup'

const co2_data = parse_phonon_modes(co2_yaml)
const co2_born_data = parse_born(co2_born)
const nacl_data = parse_phonon_modes(nacl_yaml)
const nacl_born_data = parse_born(nacl_born)
const nacl_masses = nacl_data.atoms.map((atom) => atom.mass)
const nacl_q = () => nacl_data.qpoints[0]
const nacl_spec = (opts = {}, qpoint = nacl_q()) =>
  compute_ir_raman_spectrum(qpoint, nacl_masses, nacl_born_data, opts)
const co2_raman_tensors = co2_raman_json.raman_tensors

// Nested array literals are always exploded one row per line by the formatter, so build
// 3-row literals through a call instead.
const mat3 = (row0: Vec3, row1: Vec3, row2: Vec3): Matrix3x3 => [row0, row1, row2]
const cvec3 = (c_x: Complex, c_y: Complex, c_z: Complex): Complex[] => [c_x, c_y, c_z]
const mode_indices = (modes: VibrationalMode[], keep: (mode: VibrationalMode) => boolean) =>
  modes.filter(keep).map((mode) => mode.mode_idx)
// sum over atoms of Z* vanishes to f64 round-off for a charge-neutral cell
const expect_neutral = (charges: Matrix3x3[]) => {
  for (const val of born_charge_sum(charges).flat()) expect(Math.abs(val)).toBeLessThan(1e-15)
}

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
  // Pins fixture/code agreement on eigenvectors of the mass-weighted dynamical matrix: in a
  // pure translation mass-weighted components scale as sqrt(M), displacement ones are equal
  it.each([
    [`NaCl acoustic`, nacl_data],
    [`CO2 T_x`, co2_data],
  ])(`%s: component ratio equals sqrt(mass ratio)`, (_name, data) => {
    const eigenvector = data.qpoints[0].modes[0].eigenvector
    if (!eigenvector) throw new Error(`fixture has no eigenvector`)
    const ratio = eigenvector[0][0][0] / eigenvector[1][0][0]
    const mass_ratio = Math.sqrt(data.atoms[0].mass / data.atoms[1].mass)
    expect(ratio).toBeCloseTo(mass_ratio, 12)
    expect(Math.abs(mass_ratio - 1)).toBeGreaterThan(0.1) // hypotheses distinguishable
  })
})

describe(`acoustic mode identification`, () => {
  it.each([
    // CO2 declares its translations at literal 0 THz, NaCl's force constants leave ~2e-7 THz
    [`CO2`, co2_spectrum, CO2_ACOUSTIC, 1e-12],
    [`NaCl`, nacl_spectrum, [0, 1, 2], 1e-5],
  ])(
    `%s: the three zero-frequency Gamma modes are acoustic and IR-silent`,
    (_name, spec, expected, freq_bound) => {
      const acoustic = spec.modes.filter((mode) => mode.is_acoustic)
      const indices = acoustic.map((mode) => mode.mode_idx)
      expect(indices.toSorted((lower, upper) => lower - upper)).toEqual(expected)
      for (const mode of acoustic) {
        // bounds sit 5+ orders under the lowest optical branch (not the classifier's own
        // ACOUSTIC_FREQ_THRESHOLD, which would be circular)
        const label = `mode ${mode.mode_idx}`
        expect(Math.abs(mode.frequency), label).toBeLessThan(freq_bound)
        // sum_kappa Z*_kappa = 0 and all atoms move alike, so the dipole cancels term by term
        expect(Math.abs(mode.ir_intensity), label).toBeLessThan(1e-15)
      }
    },
  )

  const few_soft = [0.1, 0.2, 3, 4].map((frequency) => ({ frequency, eigenvector: null }))
  it.each([
    [`no mode away from Gamma`, co2_data.qpoints[0].modes, [0.25, 0, 0], []],
    [`only near-zero modes when fewer than three qualify`, few_soft, [0, 0, 0], [0, 1]],
  ] as [string, PhononModeData[`qpoints`][0][`modes`], Vec3, number[]][])(
    `acoustic_mode_indices labels %s`,
    (_name, modes, q_position, expected) => {
      expect(is_gamma_point(q_position)).toBe(expected.length > 0)
      expect([...acoustic_mode_indices(modes, q_position)]).toEqual(expected)
    },
  )
})

describe(`IR intensities against closed-form results`, () => {
  // The one genuinely end-to-end check of the mass weighting: mu cannot cancel out of
  // Z*^2/mu, so getting this number right requires both masses to enter as assumed.
  it(`NaCl optical mode reproduces Z*^2 / mu`, () => {
    const reduced_mass = (M_NA * M_CL) / (M_NA + M_CL)
    const expected = nacl_born_data.born_charges[0][0][0] ** 2 / reduced_mass
    // the 2-atom optical eigenvector is symmetry-fixed: I = Z*^2 (1/M_Na + 1/M_Cl)
    for (const mode of nacl_spectrum.modes.slice(3)) {
      expect(mode.is_acoustic).toBe(false)
      expect(mode.ir_intensity).toBeCloseTo(expected, 12)
    }
    // magnitude pin, from PBEsol Z*(Na) = 1.08875538 and mu = 13.945 amu
    expect(expected).toBeCloseTo(0.084997, 6)
  })

  // Not a mass-weighting discriminator (linear XY2 nu2/nu3 share mass-weighted amplitude
  // patterns); checks the right Born-charge component is picked per cartesian direction
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

  // Building a spectrum means pairing a phonopy YAML with a BORN and maybe a Raman file,
  // routinely from different sources, so every shape mismatch has to name what disagreed
  // rather than silently truncate to the shorter array.
  const charges = nacl_born_data.born_charges
  // oxfmt-ignore
  it.each([
    [`fewer Born charge tensors than atoms`, () => compute_ir_raman_spectrum(nacl_q(), nacl_masses, { ...nacl_born_data, born_charges: charges.slice(0, 1) }), /1 Born charge tensors for 2 atoms/],
    [`missing eigenvectors`, () => nacl_spec({}, { ...nacl_q(), modes: nacl_q().modes.map((mode) => ({ ...mode, eigenvector: null })) }), /mode 1 has no eigenvector/],
    [`fewer modes than 3N`, () => nacl_spec({}, { ...nacl_q(), modes: nacl_q().modes.slice(0, 5) }), /5 modes for 2 atoms, expected 3N = 6/],
    [`one Raman tensor for six modes`, () => nacl_spec({ raman_tensors: [mat3([1, 0, 0], [0, 1, 0], [0, 0, 1])] }), /1 Raman tensors for 6 modes/],
    [`one Raman activity for six modes`, () => nacl_spec({ raman_activities: [1] }), /1 Raman activities for 6 modes/],
    [`a mass array shorter than the eigenvector`, () => ir_intensity(nacl_optical_eigvec, [M_NA], charges), /length mismatch/],
    [`a non-physical mass`, () => ir_intensity(nacl_optical_eigvec, [0, M_CL], charges), /atom 1 has invalid mass 0/],
  ])(`rejects %s`, (_name, run, pattern) => expect(run).toThrow(pattern))

  it(`scales quadratically with the Born charges`, () => {
    const double = (tensor: Matrix3x3) => tensor.map((row) => row.map((val) => 2 * val))
    const doubled = { ...nacl_born_data, born_charges: charges.map(double) as Matrix3x3[] }
    const scaled = compute_ir_raman_spectrum(nacl_q(), nacl_masses, doubled).modes[3]
    expect(scaled.ir_intensity / nacl_spectrum.modes[3].ir_intensity).toBeCloseTo(4, 12)
  })
})

describe(`selection rules`, () => {
  // Real-data counterpart of the CO2 checks below: point group 32 has no inversion centre,
  // so no mutual exclusion, but A2 modes are IR-only through the whole pipeline
  it(`alpha-quartz A2 modes are IR-active and Raman-silent`, () => {
    const optical = sio2_spectrum.modes.filter((mode) => !mode.is_acoustic)
    expect(optical).toHaveLength(24)
    const raman_silent = optical.filter((mode) => (mode.raman_activity ?? 0) === 0)
    // exactly the A2 entries of phonopy's own irrep labels; A1 and E modes are Raman active
    const labels = sio2_raman_json.mode_labels
    const a2_indices = labels.flatMap((label, idx) => (label === `A2` ? [idx] : []))
    expect(a2_indices).toEqual([9, 15, 18, 23])
    expect(raman_silent.map((mode) => mode.mode_idx)).toEqual(a2_indices)
    for (const mode of raman_silent) expect(mode.ir_intensity).toBeGreaterThan(1e-3)
    // ...and no optical mode is silent in both channels, which would mean a dropped mode
    for (const mode of optical) {
      const total = mode.ir_intensity + (mode.raman_activity ?? 0)
      expect(total, `mode ${mode.mode_idx}`).toBeGreaterThan(0)
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
    // Gerade IR silence is exact: O atoms move oppositely with identical Z* (even under
    // inversion), so every contribution cancels
    for (const mode_idx of CO2_GERADE)
      expect(Math.abs(modes[mode_idx].ir_intensity)).toBeLessThan(1e-15)
    for (const mode_idx of CO2_UNGERADE)
      expect(modes[mode_idx].ir_intensity).toBeGreaterThan(1e-2)
  })

  it(`NaCl has no Raman data`, () => {
    expect(nacl_spectrum.has_raman).toBe(false)
    expect(nacl_spectrum.modes.every((mode) => mode.raman_activity === null)).toBe(true)
    expect(() => spectrum_sticks(nacl_spectrum, `raman`)).toThrow(/no polarizability data/)
  })

  it(`IR intensity is invariant under a global eigenvector phase`, () => {
    const [cos, sin] = [Math.cos(0.7), Math.sin(0.7)]
    const rotate = ([re, im]: Complex): Complex => [re * cos - im * sin, re * sin + im * cos]
    const rotated = nacl_optical_eigvec.map((atom_block) => atom_block.map(rotate))
    const charges = nacl_born_data.born_charges
    expect(ir_intensity(rotated, nacl_masses, charges)).toBeCloseTo(
      ir_intensity(nacl_optical_eigvec, nacl_masses, charges),
      12,
    )
  })
})

describe(`raman_invariants`, () => {
  it.each([
    // Isotropic tensor: no anisotropy, activity = 45 a^2, depolarization 0
    [`isotropic`, mat3([2, 0, 0], [0, 2, 0], [0, 0, 2]), 45 * 4, 0],
    // Traceless uniaxial tensor: a = 0, so activity = 7 gamma^2 and rho saturates at 3/4
    [`traceless uniaxial`, mat3([1, 0, 0], [0, 1, 0], [0, 0, -2]), 7 * 9, 0.75],
    // Pure shear: a = 0, gamma^2 = 3 * xy^2
    [`pure shear`, mat3([0, 3, 0], [3, 0, 0], [0, 0, 0]), 7 * 27, 0.75],
    // only the symmetric part scatters, so a purely antisymmetric tensor is silent
    [`antisymmetric`, mat3([0, 1, 0], [-1, 0, 0], [0, 0, 0]), 0, 0],
  ])(`%s tensor`, (_name, tensor, activity, depolarization) => {
    const invariants = raman_invariants(tensor)
    expect(invariants.activity).toBeCloseTo(activity, 12)
    expect(invariants.depolarization_ratio).toBeCloseTo(depolarization, 12)
  })

  it(`activities come from the tensor invariants unless precomputed ones are given`, () => {
    const expected = raman_invariants(co2_raman_tensors[7]).activity // CO2 nu1
    expect(co2_spectrum.modes[7].raman_activity).toBeCloseTo(expected, 12)
    expect(expected).toBeGreaterThan(0)
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

  it(`drops acoustic and imaginary modes by default and keeps them on request`, () => {
    expect(spectrum_sticks(co2_spectrum).x).toHaveLength(6)
    expect(spectrum_sticks(co2_spectrum, `ir`, { include_acoustic: true }).x).toHaveLength(9)
    const modes = nacl_q().modes.map((mode, idx) =>
      idx === 3 ? { ...mode, frequency: -3 } : mode,
    )
    const spectrum = nacl_spec({}, { ...nacl_q(), modes })
    expect(spectrum.modes[3].is_imaginary).toBe(true)
    expect(spectrum_sticks(spectrum).x).toHaveLength(2)
    expect(spectrum_sticks(spectrum, `ir`, { include_imaginary: true }).x).toHaveLength(3)
  })

  // Imaginary is a per-mode property: a spectral-weight fraction called this -1.5 THz mode
  // imaginary at 9 modes but real at 48, leaking a -50 cm^-1 stick into the larger cell
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

describe(`peak_mode_indices`, () => {
  // sticks closer than half the distance merge into one peak; farther ones stay apart, and a
  // silent stick never claims the pointer from an active one
  it.each([
    [101, [1, 1, 1], [0, 1]],
    [115, [1, 1, 1], [1, 2]],
    [140, [1, 1, 1], []],
    [101, [0, 1, 1], [1, 2]],
  ])(`at %d with intensities %j picks the nearest peak`, (position, y, expected) => {
    const modes = [0, 1, 2].map((mode_idx) => ({ ...co2_spectrum.modes[8], mode_idx }))
    const sticks = { x: [100, 104, 108], y, modes }
    expect(peak_mode_indices(sticks, position, 10)).toEqual(expected)
  })
})

describe(`broaden_spectrum`, () => {
  // width at half maximum, linearly interpolating the grid points bracketing each crossing
  const measure_fwhm = (curve: SpectrumCurve): number => {
    const half = Math.max(...curve.y) / 2
    const crossings: number[] = []
    for (let idx = 1; idx < curve.y.length; idx++) {
      const [y_prev, y_next] = [curve.y[idx - 1], curve.y[idx]]
      if (y_prev < half === y_next < half) continue
      const frac = (half - y_prev) / (y_next - y_prev)
      crossings.push(curve.x[idx - 1] + frac * (curve.x[idx] - curve.x[idx - 1]))
    }
    if (crossings.length !== 2)
      throw new Error(`expected 2 crossings, found ${crossings.length}`)
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
    // 1e-3 relative (~0.012 absolute) sits above the 0.02-step interpolation error and
    // below any real shape error
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
    // area-normalised peak height scales as 1/FWHM: FWHM 20 at 2000 is 4x below FWHM 5 at 500
    const near = (target: number) => {
      const dist = (idx: number) => Math.abs(curve.x[idx] - target)
      const best = curve.x.reduce((acc, _val, idx) => (dist(idx) < dist(acc) ? idx : acc), 0)
      return curve.y[best]
    }
    expect(near(500) / near(2000)).toBeCloseTo(4, 2)
  })

  // Area preservation: line shapes are area-normalised, so the curve integrates to the
  // stick intensity. 9e-6 sits under broaden_peaks' old ABSOLUTE 1e-5 (XRD-scale) floor
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

  // A wide width ratio: the grid spans 10*max_width in steps of min_width/20, so ~2.4e12
  // points, which used to hand broaden_peaks an uninterruptible fill loop (>4 min).
  const wide_ratio_fwhm = (center: number) => (center === 0 ? 1e-8 : 10)

  // A bad fwhm_fn surfaced downstream as "step_size must be > 0" without naming the stick;
  // NaN and negative intensities silently gave all-NaN and all-zero curves
  // oxfmt-ignore
  it.each([
    [`zero fwhm`, [100], [1], { fwhm: 0 }, /fwhm must be > 0/],
    [`an fwhm_fn returning 0`, [100], [1], { fwhm_fn: () => 0 }, /fwhm must be > 0.*got 0/],
    [`an fwhm_fn returning NaN`, [100], [1], { fwhm_fn: () => NaN }, /got NaN/],
    [`an fwhm_fn bad at one stick`, [500, 2000], [1, 1], { fwhm_fn: (center: number) => (center === 2000 ? 0 : 10) }, /got 0 at peak 2000/],
    [`a width ratio that would explode the grid`, [0, 1000], [1, 1], { fwhm_fn: wide_ratio_fwhm }, /grid points over \[-100, 1100\] at step 5e-10.*Widths span 1e-8\.\.10/s],
    [`a NaN stick intensity`, [1000], [NaN], { fwhm: 10 }, /intensities must be finite, got NaN/],
    [`a negative stick intensity`, [1000], [-5], { fwhm: 10 }, /stick 0 at 1000 has negative intensity -5/],
    [`a NaN shape_factor`, [1000], [1], { fwhm: 10, shape_factor: NaN }, /shape_factor must be in \[0, 1\]/],
    [`mismatched stick arrays`, [1, 2], [1], {}, /2 positions but 1 intensities/],
  ] as [string, number[], number[], BroadenOptions, RegExp][])(`rejects %s`, (_name, x, y, options, pattern) => {
    expect(() => broaden_spectrum({ x, y }, options)).toThrow(pattern)
  })

  // ...but an explicit step_size means the caller has taken responsibility for the grid
  it(`allows a wide width ratio when step_size is given explicitly`, () => {
    const opts = { fwhm_fn: wide_ratio_fwhm, range: [-50, 1050] as Vec2, step_size: 0.5 }
    const curve = broaden_spectrum({ x: [0, 1000], y: [1, 1] }, opts)
    expect(curve.x).toHaveLength(2201) // [-50, 1050] at 0.5 is 2200 steps plus the endpoint
    expect(curve.y.every(Number.isFinite)).toBe(true)
  })

  // The old max-1 rescaling and grid widening/cropping are gone: plain delegation, so exact
  it(`passes sticks (or none) straight through to broaden_peaks`, () => {
    const sticks = { x: [820, 1106, 1180], y: [0.4, 1.7, 0.9] }
    const [range, step_size, shape_factor]: [Vec2, number, number] = [[900, 1100], 0.5, 0.5]
    const via_spectrum = broaden_spectrum(sticks, { fwhm: 12, shape_factor, range, step_size })
    const direct = broaden_peaks(sticks, () => 12, shape_factor, range, step_size)
    expect(via_spectrum.y).toEqual(direct.y)
    expect(via_spectrum.x).toEqual(direct.x)
    // sticks outside `range` still paint their tails across it (820 and 1180 are both
    // within 20 x FWHM of the window), which is what the old grid extension existed for
    expect(Math.max(...via_spectrum.y)).toBeGreaterThan(0)
    expect(broaden_spectrum({ x: [], y: [] })).toEqual({ x: [], y: [] })
  })

  // An absolute 1e-5 floor zeroed the whole 1e-9 curve (IR intensities in e^2/amu sit
  // below it); with a relative floor, scaling every stick scales the curve exactly
  it.each([1e-9, 1e9])(
    `broadens to the same profile with intensities scaled by %f`,
    (scale) => {
      const opts: BroadenOptions = { fwhm: 10, range: [900, 1300], step_size: 1 }
      const curve_at = (factor: number) =>
        broaden_spectrum({ x: [1000, 1200], y: [2 * factor, factor] }, opts)
      const [reference, scaled] = [curve_at(1), curve_at(scale)]
      expect(Math.max(...reference.y)).toBeGreaterThan(0)
      const rel_errs = reference.y.map((val, idx) =>
        val === 0 ? 0 : Math.abs(scaled.y[idx] / scale - val) / val,
      )
      expect(Math.max(...rel_errs)).toBeLessThan(1e-12)
    },
  )
})

// Unit conversion constants are pinned per unit in helpers.test.ts; exercise both units
// through the complete stick-selection path for the high-frequency mode.
it.each([
  [`cm^-1`, 4000, 9],
  [`meV`, 495.9, 1],
] as const)(`a 4000 cm^-1 stick survives the IR path in %s`, (unit, expected, precision) => {
  const frequency = 4000 / convert_frequencies([1], `cm^-1`)[0] // in THz
  const modes = [{ ...co2_spectrum.modes[8], frequency }]
  const [stick] = spectrum_sticks({ ...co2_spectrum, modes }, `ir`, { unit }).x
  expect(stick).toBeCloseTo(expected, precision)
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

// A negative index used to fall into the Gamma-search branch and report "no Gamma point",
// which says nothing about the index the caller actually passed
const off_gamma: PhononModeData = {
  ...nacl_data,
  qpoints: [{ ...nacl_data.qpoints[0], q_position: [0.5, 0, 0] }],
}
it.each([
  [`no Gamma point`, off_gamma, undefined, /no Gamma point/],
  [`q-point index 5`, nacl_data, 5, /out of range/],
  [`q-point index -1`, nacl_data, -1, /out of range/],
])(`spectrum_from_phonon_data throws on %s`, (_name, data, qpoint_index, pattern) => {
  expect(() => spectrum_from_phonon_data(data, nacl_born_data, { qpoint_index })).toThrow(
    pattern,
  )
})

it(`spectrum_from_phonon_data selects the Gamma point automatically`, () => {
  expect(co2_spectrum).toMatchObject({ q_position: [0, 0, 0], n_atoms: 3 })
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
    const q_block = (q_pos: string, distance: number) =>
      `- q-position: [${q_pos}]\n  distance: ${distance}\n  band:\n  - frequency: 1.0\n${eig_x()}${MORE_FREQS}`
    const header = `segment_nqpoint: [2]\nlabels: [[GAMMA, X]]\n${h_cell()}phonon:\n`
    const yaml = `${header}${q_block(`0,0,0`, 0)}${q_block(`0.5,0,0`, 1)}`
    expect(parse_phonon_modes(yaml).path_segments).toEqual([
      { start_index: 0, end_index: 1, start_label: `GAMMA`, end_label: `X` },
    ])
  })

  // oxfmt-ignore
  it.each([
    [`q-point count`, `nqpoint: 2\n`, /declares nqpoint=2 but lists 1 q-points/],
    [`invalid q-point count`, `nqpoint: many\n`, /'nqpoint' must be an integer/],
    [`invalid path count`, `npath: many\nsegment_nqpoint: [1]\n`, /'npath' must be a positive integer/],
    [`path count mismatch`, `npath: 2\nsegment_nqpoint: [1]\n`, /declares npath=2 but segment_nqpoint lists 1 path segments/],
    [`segment total`, `segment_nqpoint: [2]\n`, /sums to 2 but phonon lists 1/],
    [`label count`, `segment_nqpoint: [1]\nlabels: [[GAMMA, X], [X, L]]\n`, /one pair for each/],
    [`missing distance`, `segment_nqpoint: [1]\nlabels: [[GAMMA, X]]\n`, /without a finite 'distance'/],
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
    // atom and component are both named 1-based
    [
      `bad eigenvector component`,
      `${H_BAND}    eigenvector:\n    - - [1,0]\n      - [0,0]\n      - [0]\n`,
      /eigenvector atom 1 component 3\b/,
    ],
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
      // fixtures use exactly-representable decimals summing to zero
      expect_neutral(born.born_charges)
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

it(`apply_born_sum_rule removes the residual, keeps neutral charges, rejects empty input`, () => {
  const violating = [
    mat3([1.2, 0, 0], [0, 1.2, 0], [0, 0, 1.2]),
    mat3([-1, 0, 0], [0, -1, 0], [0, 0, -1]),
  ]
  const corrected = apply_born_sum_rule(violating)
  // Residual +0.2 per diagonal element split evenly over 2 atoms
  expect(corrected[0][0][0]).toBeCloseTo(1.1, 12)
  expect(corrected[1][0][0]).toBeCloseTo(-1.1, 12)
  expect_neutral(corrected)

  const neutral = nacl_born_data.born_charges
  expect(apply_born_sum_rule(neutral)).toEqual(neutral)
  expect(() => apply_born_sum_rule([])).toThrow(/no Born charges given/)
})

describe(`IrRamanSpectrum component`, () => {
  type SpectrumProps = ComponentProps<typeof IrRamanSpectrum>
  const render = (props: Partial<SpectrumProps> = {}) =>
    mount(IrRamanSpectrum, {
      target: document.body,
      props: { spectrum: co2_spectrum, ...props },
    })

  const no_grid = { x_grid: false, y_grid: false }
  // One stick per active optical mode: NaCl's triply degenerate TO mode, CO2's 2 bends + nu3
  // (the 3 acoustic modes are excluded and the gerade modes carry exactly zero intensity, so
  // they draw no stick), and only nu1 is Raman active.
  it.each([
    [`NaCl IR`, { spectrum: nacl_spectrum, fwhm: 8 }, 3],
    [`CO2 IR`, { fwhm: 25 }, 3],
    [`CO2 Raman`, { fwhm: 25, kind: `raman` } as const, 1],
  ])(`renders %s with one stick per active mode`, async (_name, props, n_sticks) => {
    render({ ...props, legend: {}, show_legend: true, display: no_grid })
    await tick()
    expect(document.querySelector(`.scatter`)).toBeInstanceOf(HTMLElement)
    expect(document.querySelectorAll(`line.mode-stick`)).toHaveLength(n_sticks)
    expect(document.querySelector(`.legend`)).not.toBeNull()
    for (const axis_tick of document.querySelectorAll(`.tick`)) {
      expect(axis_tick.querySelectorAll(`line`)).toHaveLength(1)
    }
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

  it.each([`multiple peaks`, `single peak`])(
    `resets authored spectrum and stable broadening defaults for %s`,
    async (variant) => {
      render({
        spectrum:
          variant === `single peak`
            ? { ...co2_spectrum, modes: [co2_spectrum.modes[8]] }
            : co2_spectrum,
        units: `THz`,
        fwhm: 3,
        shape_factor: 0.9,
        normalize: null,
        presentation: `transmittance`,
        show_sticks: false,
        controls_open: true,
      })
      await tick()
      expect(document.querySelectorAll(`line.mode-stick`)).toHaveLength(0)
      const reset_section = async (section: string) => {
        const selector = `button[title="Reset ${section} to defaults"]`
        doc_query<HTMLButtonElement>(selector).click()
        await tick()
        expect(document.querySelector(selector)).toBeNull()
      }
      await reset_section(`spectrum`)
      expect(doc_query<HTMLSelectElement>(`#ir-raman-units`).value).toBe(`cm^-1`)
      expect(doc_query<HTMLInputElement>(`#ir-raman-sticks`).checked).toBe(true)
      expect(document.querySelectorAll(`line.mode-stick`)).toHaveLength(
        variant === `single peak` ? 1 : 3,
      )
      await reset_section(`broadening`)
      const fwhm_input = doc_query<HTMLInputElement>(`#ir-raman-fwhm`)
      const reset_width = Number(fwhm_input.value)
      if (variant === `single peak`) expect(reset_width).toBe(10)
      set_input(fwhm_input, String(reset_width * 2))
      await tick()
      await reset_section(`broadening`)
      expect(Number(fwhm_input.value)).toBe(reset_width)
    },
  )

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

  // rotated beside a band plot: frequency runs up the y axis and sticks grow along x
  it.each([`vertical`, `horizontal`] as const)(
    `draws a %s spectrum with its reference line and highlighted sticks`,
    async (orientation) => {
      render({
        fwhm: 25,
        orientation,
        units: `THz`,
        reference_frequency: co2_spectrum.modes[8].frequency,
        highlighted_mode_indices: [5, 6],
      })
      await tick()
      const sticks = [...document.querySelectorAll(`line.mode-stick`)]
      expect(sticks).toHaveLength(3)
      const attr = (element: Element, name: string) => Number(element.getAttribute(name))
      const [freq_attr, other_attr] = orientation === `horizontal` ? [`y`, `x`] : [`x`, `y`]
      for (const stick of sticks) {
        expect(attr(stick, `${freq_attr}1`)).toBe(attr(stick, `${freq_attr}2`))
        expect(attr(stick, `${other_attr}1`)).not.toBe(attr(stick, `${other_attr}2`))
      }
      const highlighted = document.querySelectorAll(`line.mode-stick.highlighted`)
      expect([...highlighted].map((stick) => stick.getAttribute(`aria-label`))).toEqual([
        expect.stringMatching(/^Select mode 6 at/),
        expect.stringMatching(/^Select mode 7 at/),
      ])
      // the reference line spans the plot across the frequency axis at the nu3 stick
      const ref_line = doc_query(`line.reference-line`)
      expect(attr(ref_line, `${freq_attr}1`)).toBe(attr(ref_line, `${freq_attr}2`))
      expect(attr(ref_line, `${freq_attr}1`)).toBeCloseTo(attr(sticks[2], `${freq_attr}1`), 6)
    },
  )

  const silent_modes = co2_spectrum.modes.map((mode) => ({ ...mode, ir_intensity: 0 }))
  // oxfmt-ignore
  it.each([
    [`Raman without polarizability data`, { spectrum: nacl_spectrum, kind: `raman` } as const, /polarizability derivatives must be supplied/],
    [`every mode silent`, { spectrum: { ...co2_spectrum, modes: silent_modes } }, /No IR-active modes/],
  ])(`shows an empty state for %s`, (_name, props, message) => {
    render(props)
    expect(document.querySelector(`.scatter`)).toBeNull()
    expect(document.body.textContent).toMatch(message)
  })

  // fwhm is one physical width in cm^-1: unit switches only rescale the slider's display
  it.each([
    [`Ha`, `cm^-1`],
    [`cm^-1`, `THz`],
    [`cm^-1`, `meV`],
    [`cm-1`, `cm^-1`],
    [`cm⁻¹`, `cm^-1`],
  ] as const)(`fwhm stays 25 cm^-1 across the unit switch %s → %s`, async (initial, units) => {
    const props = $state({
      spectrum: co2_spectrum,
      units: initial as FrequencyUnit,
      fwhm: 25,
      controls_open: true,
    })
    mount(IrRamanSpectrum, { target: document.body, props })
    for (const unit of [initial, units]) {
      props.units = unit as FrequencyUnit
      await tick()
      expect(props.fwhm).toBe(25)
      const canonical = parse_frequency_unit(unit) // resolves the cm-1/cm⁻¹ aliases
      if (!canonical) throw new Error(`unknown unit ${unit}`)
      const expected_width = convert_frequencies([25], canonical, `cm^-1`)[0]
      const slider = doc_query<HTMLInputElement>(`#ir-raman-fwhm`)
      expect(Number(slider.value) / expected_width).toBeCloseTo(1, 12)
      expect(document.querySelectorAll(`line.mode-stick`)).toHaveLength(3)
    }
  })

  // The curve itself is not measurable here — the plot's line path stays empty under
  // happy-dom — so the drawn direction is checked on the sticks, which share the same
  // baseline, and the 1 - A arithmetic is covered by to_transmittance's own unit test.
  // Transmittance is IR-only: a Raman view keeps its sticks upright and hides the selector
  it.each([
    [`ir`, `transmittance`, 1, 3],
    [`ir`, `absorbance`, 0, 3],
    [`raman`, `transmittance`, 0, 1],
  ] as const)(
    `%s %s hangs sticks from the %i baseline`,
    async (kind, presentation, baseline, n_sticks) => {
      render({ kind, presentation, fwhm: 25, controls_open: true })
      await tick()
      const presentation_select = document.querySelector(`#ir-raman-presentation`)
      expect(presentation_select !== null).toBe(kind === `ir`)
      const sticks = [...document.querySelectorAll(`line.mode-stick`)]
      expect(sticks).toHaveLength(n_sticks)
      const y_of = (stick: Element, attr: string) => Number(stick.getAttribute(attr))
      // Every stick starts on the shared baseline
      const base_px = y_of(sticks[0], `y1`)
      expect(sticks.every((stick) => y_of(stick, `y1`) === base_px)).toBe(true)
      // The strongest mode spans the full axis, so its far end fixes which way round the
      // axis runs: y grows downwards in SVG, so a baseline at 1 (top) hangs sticks down
      const tips = sticks.map((stick) => y_of(stick, `y2`))
      if (baseline) expect(Math.max(...tips)).toBeGreaterThan(base_px)
      else expect(Math.min(...tips)).toBeLessThan(base_px)
    },
  )
})
