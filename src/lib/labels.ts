import type { ChemicalElement, ElementCategory } from '$lib/element/types'
import type { Vec3 } from '$lib/math'
import { format } from 'd3-format'
import type { SymbolType } from 'd3-shape'
import * as d3_symbols from 'd3-shape'
import { timeFormat } from 'd3-time-format'

// Symbol types and formatting utilities from d3-shape
export type D3Symbol = keyof typeof d3_symbols & `symbol${Capitalize<string>}`
export type D3SymbolName = Exclude<D3Symbol extends `symbol${infer Name}` ? Name : never, ``>

const is_d3_symbol_name = (name: string): name is D3SymbolName =>
  Object.hasOwn(d3_symbols, `symbol${name}`)

function name_for_symbol(sym: unknown): D3SymbolName | null {
  for (const [key, symbol] of Object.entries(d3_symbols)) {
    if (symbol === sym && /^symbol[A-Z]/.test(key)) {
      const name = key.substring(6)
      if (is_d3_symbol_name(name)) return name
    }
  }
  return null
}

export const symbol_names = [
  ...new Set([...d3_symbols.symbolsFill, ...d3_symbols.symbolsStroke]),
]
  .map(name_for_symbol)
  .filter((n): n is D3SymbolName => n !== null)

export const symbol_map: Partial<Record<D3SymbolName, SymbolType>> = Object.fromEntries(
  // Symbol lookup from d3-shape
  symbol_names.map((name) => [name, d3_symbols[`symbol${name}`]]),
)

// Format a value for display with optional time formatting
export function format_value(value: number, formatter?: string): string {
  if (!formatter) return `${value}`
  if (formatter.startsWith(`%`)) return timeFormat(formatter)(new Date(value))

  // Handle special values consistently
  if (value === -Infinity) return `-Infinity`
  if (value === Infinity) return `Infinity`
  if (Number.isNaN(value)) return `NaN`

  // Format and normalize unicode minus
  const formatted = format(formatter)(value).replace(/−/g, `-`)

  // Handle percentage formatting - remove trailing zeros
  if (formatter.includes(`%`)) {
    return formatted.includes(`.`)
      ? formatted.replace(/(\.\d*?)0+%$/, `$1%`).replace(/\.%$/, `%`)
      : formatted
  }

  // Handle currency formatting - preserve precision if specified
  if (formatter.includes(`$`) && formatter.includes(`.`) && /\.\d+f/.test(formatter)) {
    return formatted
  }

  // Remove trailing zeros after decimal point
  const out = formatted.includes(`.`)
    ? formatted.replace(/(\.\d*?)0+$/, `$1`).replace(/\.$/, ``)
    : formatted
  return out === `-0` ? `0` : out
}

// TODO add labels and units for all elemental properties
export const ELEM_PROPERTY_LABELS: Partial<
  Record<keyof ChemicalElement, [string, string | null]>
> = {
  atomic_mass: [`Atomic Mass`, `u`],
  atomic_radius: [`Atomic Radius`, `Å`],
  boiling_point: [`Boiling Point`, `K`],
  covalent_radius: [`Covalent Radius`, `Å`],
  density: [`Density`, `g/cm³`],
  electron_affinity: [`Electron Affinity`, null],
  electronegativity: [`Electronegativity`, null],
  first_ionization: [`First Ionization Energy`, `eV`],
  melting_point: [`Melting Point`, `K`],
  mendeleev_number: [`Mendeleev Number`, null],
  // molar_heat: [`Molar Heat`, `J/(mol·K)`],
  n_shells: [`Number of Shells`, null],
  n_valence: [`Electron Valency`, null],
  number: [`Atomic Number`, null],
  shells: [`Electron Shell Occupations`, null],
  specific_heat: [`Specific Heat`, `J/(g K)`],
} as const

export const ELEM_HEATMAP_KEYS: (keyof ChemicalElement)[] = [
  `atomic_mass`,
  `atomic_radius`,
  `covalent_radius`,
  `electronegativity`,
  `density`,
  `boiling_point`,
  `melting_point`,
  `first_ionization`,
]

export const ELEM_HEATMAP_LABELS: Partial<Record<string, keyof ChemicalElement>> =
  Object.fromEntries(
    ELEM_HEATMAP_KEYS.map((key) => {
      const [label, unit] = ELEM_PROPERTY_LABELS[key] ?? []
      if (!label) throw `Unexpected missing label ${label}`
      return [label + (unit ? ` (${unit})` : ``), key]
    }),
  )

// Allow users to import DEFAULT_FMT and change its items in place to
// set the default number format globally
export const DEFAULT_FMT: [string, string] = [`,.3~s`, `.3~g`]

// Unicode glyphs for common fractions used by format_fractional()
export const FRACTION_GLYPHS: ReadonlyArray<readonly [number, string]> = [
  [0, `0`],
  [1 / 12, `¹⁄₁₂`],
  [1 / 8, `⅛`],
  [1 / 6, `⅙`],
  [1 / 5, `⅕`],
  [1 / 4, `¼`],
  [1 / 3, `⅓`],
  [2 / 5, `⅖`],
  [1 / 2, `½`],
  [3 / 5, `⅗`],
  [2 / 3, `⅔`],
  [3 / 4, `¾`],
  [4 / 5, `⁴⁄₅`],
  [5 / 6, `⁵⁄₆`],
  [7 / 8, `⁷⁄₈`],
  [11 / 12, `¹¹⁄₁₂`],
]

// fmt as number only allowed to support [].map(format_num) without type error
export const format_num = (num: number, fmt?: string | number) => {
  if (num === null) return ``
  if (!fmt || typeof fmt !== `string`) {
    const [gt_1_fmt, lt_1_fmt] = DEFAULT_FMT
    return format(Math.abs(num) >= 1 ? gt_1_fmt : lt_1_fmt)(num)
  }
  return format(fmt)(num)
}

// Format a 3D vector as "(x, y, z)" with configurable precision
export const format_vec3 = (vec: Readonly<Vec3>, fmt_spec = `.4~`): string =>
  `(${format_num(vec[0], fmt_spec)}, ${format_num(vec[1], fmt_spec)}, ${format_num(
    vec[2],
    fmt_spec,
  )})`

const BYTE_UNITS = [`B`, `KiB`, `MiB`, `GiB`, `TiB`, `PiB`] as const

// Format file sizes using IEC binary units (1024 factor).
export const format_bytes = (bytes?: number): string => {
  if (bytes === undefined || !Number.isFinite(bytes)) return `Unknown`

  let [val, idx] = [bytes, 0]
  while (Math.abs(val) >= 1024 && idx < BYTE_UNITS.length - 1) {
    val /= 1024
    idx++
  }
  return idx === 0 ? `${val} B` : `${val.toFixed(2)} ${BYTE_UNITS[idx]}`
}

// Replace common fractional values with unicode glyphs (e.g. 1/2 → ½)
export function format_fractional(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  const wrapped_value = ((value % 1) + 1) % 1 // wrap into [0,1)
  const eps = 1e-3
  for (const [target, glyph] of FRACTION_GLYPHS) {
    if (target === 0) {
      if (Math.abs(wrapped_value - target) <= eps) return glyph
    } else if (Math.abs(wrapped_value - target) < eps) return glyph
  }
  for (const [target, glyph] of FRACTION_GLYPHS) {
    if (target !== 0 && Math.abs(1 - wrapped_value - target) < eps) return glyph
  }
  return format_num(value, `.4~`)
}

export function parse_si_float<T extends string | number | null | undefined>(
  value: T,
): T | number | string {
  // if not string, return as is
  if (typeof value !== `string`) return value
  // Remove whitespace and commas
  const cleaned = value.trim().replace(/(\d),(\d)/g, `$1$2`)

  // Check if the value is a SI-formatted number (e.g. "1.23k", "4.56M", "789µ", "12n")
  const match = /^([-+]?\d*\.?\d+)\s*([yzafpnµmkMGTPEZY])?$/i.exec(cleaned)
  if (match) {
    const [, num_part, suffix] = match
    let multiplier = 1
    if (suffix) {
      const suffixes = `yzafpnµm kMGTPEZY`
      const index = suffixes.indexOf(suffix)
      if (index !== -1) {
        multiplier = Math.pow(1000, index - 8)
      }
    }
    return parseFloat(num_part) * multiplier
  }

  // If it's a number without SI suffix, try parsing it
  if (/^[-+]?[\d,]+\.?\d*$/.test(cleaned)) return parseFloat(cleaned)

  // If the value is not a formatted number, return as is
  return value
}

export const CATEGORY_COUNTS: Record<ElementCategory, number> = {
  actinide: 15,
  'alkali metal': 6,
  'alkaline earth metal': 6,
  'diatomic nonmetal': 7,
  lanthanide: 15,
  metalloid: 8,
  'noble gas': 7,
  'polyatomic nonmetal': 4,
  'post-transition metal': 12,
  'transition metal': 38,
}

export const ELEMENT_CATEGORIES = [
  `actinide`,
  `alkali metal`,
  `alkaline earth metal`,
  `diatomic nonmetal`,
  `lanthanide`,
  `metalloid`,
  `noble gas`,
  `polyatomic nonmetal`,
  `post-transition metal`,
  `transition metal`,
] as const

// oxfmt-ignore
export const ELEM_SYMBOLS = [`H`,`He`,`Li`,`Be`,`B`,`C`,`N`,`O`,`F`,`Ne`,`Na`,`Mg`,`Al`,`Si`,`P`,`S`,`Cl`,`Ar`,`K`,`Ca`,`Sc`,`Ti`,`V`,`Cr`,`Mn`,`Fe`,`Co`,`Ni`,`Cu`,`Zn`,`Ga`,`Ge`,`As`,`Se`,`Br`,`Kr`,`Rb`,`Sr`,`Y`,`Zr`,`Nb`,`Mo`,`Tc`,`Ru`,`Rh`,`Pd`,`Ag`,`Cd`,`In`,`Sn`,`Sb`,`Te`,`I`,`Xe`,`Cs`,`Ba`,`La`,`Ce`,`Pr`,`Nd`,`Pm`,`Sm`,`Eu`,`Gd`,`Tb`,`Dy`,`Ho`,`Er`,`Tm`,`Yb`,`Lu`,`Hf`,`Ta`,`W`,`Re`,`Os`,`Ir`,`Pt`,`Au`,`Hg`,`Tl`,`Pb`,`Bi`,`Po`,`At`,`Rn`,`Fr`,`Ra`,`Ac`,`Th`,`Pa`,`U`,`Np`,`Pu`,`Am`,`Cm`,`Bk`,`Cf`,`Es`,`Fm`,`Md`,`No`,`Lr`,`Rf`,`Db`,`Sg`,`Bh`,`Hs`,`Mt`,`Ds`,`Rg`,`Cn`,`Nh`,`Fl`,`Mc`,`Lv`,`Ts`,`Og`] as const

export const SUPERSCRIPT_MAP = {
  '0': `⁰`,
  '1': `¹`,
  '2': `²`,
  '3': `³`,
  '4': `⁴`,
  '5': `⁵`,
  '6': `⁶`,
  '7': `⁷`,
  '8': `⁸`,
  '9': `⁹`,
  '+': `⁺`,
  '-': `⁻`,
} as const
const is_superscript_key = (key: string): key is keyof typeof SUPERSCRIPT_MAP =>
  key in SUPERSCRIPT_MAP
export const SUBSCRIPT_MAP = {
  '0': `₀`,
  '1': `₁`,
  '2': `₂`,
  '3': `₃`,
  '4': `₄`,
  '5': `₅`,
  '6': `₆`,
  '7': `₇`,
  '8': `₈`,
  '9': `₉`,
} as const

// replaces all signs and digits with their unicode superscript equivalent
export const superscript_digits = (input: string): string =>
  input.replace(/[\d+-]/g, (match) =>
    is_superscript_key(match) ? SUPERSCRIPT_MAP[match] : match,
  )

// Trajectory property configuration: clean labels and units as structured data
export const trajectory_property_config: Record<string, { label: string; unit: string }> = {
  // Energy properties
  energy: { label: `Energy`, unit: `eV` },
  Energy: { label: `Energy`, unit: `eV` },
  energy_per_atom: { label: `Energy per atom`, unit: `eV/atom` },
  potential_energy: { label: `Potential energy`, unit: `eV` },
  kinetic_energy: { label: `Kinetic energy`, unit: `eV` },
  total_energy: { label: `Total energy`, unit: `eV` },

  // Force properties (common variations)
  force_max: { label: `F<sub>max</sub>`, unit: `eV/Å` },
  Fmax: { label: `F<sub>max</sub>`, unit: `eV/Å` },
  fmax: { label: `F<sub>max</sub>`, unit: `eV/Å` },
  'Force Max': { label: `Force Max`, unit: `eV/Å` },
  force_norm: { label: `F<sub>norm</sub>`, unit: `eV/Å` },
  'Force RMS': { label: `Force RMS`, unit: `eV/Å` },

  // Structural properties
  volume: { label: `Volume`, unit: `Å³` },
  Volume: { label: `Volume`, unit: `Å³` },
  density: { label: `Density`, unit: `g/cm³` },
  Density: { label: `Density`, unit: `g/cm³` },

  // Lattice parameters (common variations)
  a: { label: `A`, unit: `Å` },
  A: { label: `A`, unit: `Å` },
  b: { label: `B`, unit: `Å` },
  B: { label: `B`, unit: `Å` },
  c: { label: `C`, unit: `Å` },
  C: { label: `C`, unit: `Å` },
  alpha: { label: `α`, unit: `°` },
  Alpha: { label: `α`, unit: `°` },
  beta: { label: `β`, unit: `°` },
  Beta: { label: `β`, unit: `°` },
  gamma: { label: `γ`, unit: `°` },
  Gamma: { label: `γ`, unit: `°` },

  // Thermodynamic properties
  temperature: { label: `Temperature`, unit: `K` },
  Temperature: { label: `Temperature`, unit: `K` },
  pressure: { label: `Pressure`, unit: `GPa` },
  Pressure: { label: `Pressure`, unit: `GPa` },
  stress_max: { label: `σ<sub>max</sub>`, unit: `GPa` },
  stress_frobenius: { label: `σ<sub>F</sub>`, unit: `GPa` },
}
