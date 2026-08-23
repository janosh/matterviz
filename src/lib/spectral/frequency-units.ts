// The one place frequency units are spelled and converted: phonon DOS / band units and the
// classical-MD spectra (VDOS, IR, Raman) that derive a frequency axis from a timestep.
import {
  ELEMENTARY_CHARGE_C,
  HARTREE_TO_EV,
  PLANCK_J_S,
  THZ_TO_INVERSE_CM,
} from '$lib/constants'

// Units a phonon DOS / band structure can be displayed in. `cm^-1` is the only spelling;
// the plots render it as cm⁻¹ (see `frequency_unit_label`).
export const FREQUENCY_UNITS = [`THz`, `eV`, `meV`, `cm^-1`, `Ha`] as const
export type FrequencyUnit = (typeof FREQUENCY_UNITS)[number]

// Classical MD spectra have no business reporting eV / meV / Ha: a VDOS peak is a
// vibrational frequency, not a quantum of energy.
export const MD_FREQUENCY_UNITS = [`THz`, `cm^-1`] as const
export type MdFrequencyUnit = (typeof MD_FREQUENCY_UNITS)[number]

const THZ_TO_EV = (PLANCK_J_S * 1e12) / ELEMENTARY_CHARGE_C
const FREQUENCY_UNIT_PER_THZ: Record<FrequencyUnit, number> = {
  THz: 1,
  eV: THZ_TO_EV,
  meV: THZ_TO_EV * 1000,
  Ha: THZ_TO_EV / HARTREE_TO_EV,
  'cm^-1': THZ_TO_INVERSE_CM,
}

export const frequency_unit_per_thz = (unit: FrequencyUnit): number => {
  const factor = FREQUENCY_UNIT_PER_THZ[unit]
  if (!factor) {
    throw new Error(`Invalid unit: ${unit}. Must be one of ${FREQUENCY_UNITS.join(`, `)}`)
  }
  return factor
}

// Convert frequencies between any two units (THz by default on both sides, so the one-arg
// form is a no-op)
export function convert_frequencies(
  frequencies: number[],
  to_unit: FrequencyUnit = `THz`,
  from_unit: FrequencyUnit = `THz`,
): number[] {
  const factor = frequency_unit_per_thz(to_unit) / frequency_unit_per_thz(from_unit)
  return factor === 1 ? frequencies : frequencies.map((freq) => freq * factor)
}

// Accepts the spellings found in the wild (cm-1, cm^-1, cm⁻¹, hartree, …); null when unknown
export const parse_frequency_unit = (unit: unknown): FrequencyUnit | null => {
  if (typeof unit !== `string`) return null
  const normalized = unit.trim().toLowerCase()
  if (normalized === `thz`) return `THz`
  if (normalized === `ev`) return `eV`
  if (normalized === `mev`) return `meV`
  if (normalized === `ha` || normalized === `hartree`) return `Ha`
  if ([`cm-1`, `cm^-1`, `cm⁻¹`].includes(normalized)) return `cm^-1`
  return null
}

// How a unit reads on an axis label
export const frequency_unit_label = (unit: string): string =>
  unit === `cm^-1` ? `cm⁻¹` : unit

// Time units whose inverse is expressible in THz. A dt in anything else can still drive a
// lag axis, but asking for a THz / cm^-1 spectrum on top of it throws.
export const TIME_UNIT_TO_THZ: Record<string, number> = { fs: 1000, ps: 1, ns: 0.001 }

export const thz_per_inverse_time = (time_unit: string): number | undefined =>
  Object.hasOwn(TIME_UNIT_TO_THZ, time_unit) ? TIME_UNIT_TO_THZ[time_unit] : undefined

// Factor from cycles per `time_unit` to `frequency_unit`, or null when the time unit has
// no THz conversion. Callers decide what to report then (a per-frame axis, or an error).
export const md_frequency_factor = (
  time_unit: string,
  frequency_unit: MdFrequencyUnit,
): number | null => {
  const to_thz = thz_per_inverse_time(time_unit)
  return to_thz === undefined ? null : to_thz * frequency_unit_per_thz(frequency_unit)
}
