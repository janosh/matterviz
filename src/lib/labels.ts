import type { ChemicalElement } from '#lib/element/types.js'
import type { Vec3 } from '#lib/math.js'
import { normalize_unicode_minus } from '#lib/utils.js'
import { format } from 'd3-format'
import type { SymbolType } from 'd3-shape'
import * as d3_symbols from 'd3-shape'
import { timeFormat } from 'd3-time-format'

export { ELEM_SYMBOLS } from '#lib/element/types.js'

// Mutable so callers can change the adaptive defaults globally.
export const DEFAULT_FMT: [string, string] = [`,.3~s`, `.3~g`]

// d3 writes positive exponents as e+6; the sign only widens table cells and ticks, so drop it
// (1.06e+29 -> 1.06e29). Scientific zero ("0e+0" / "0.00e+0") collapses to a plain 0.
const compact_scientific = (formatted: string, fmt: string, num: number): string => {
  const compact = formatted.replace(/e\+(?=\d)/, `e`)
  return num === 0 && fmt.endsWith(`e`) ? compact.replace(/(?:\.0+)?e0$/, ``) : compact
}

// Cap for the string-keyed caches here, in sanitize.ts and colors/index.ts (keys come from
// data, so they must be bounded). Evicting the oldest — Map iterates insertion order — beats a
// wholesale clear, which makes a working set just over the limit recompute everything.
export const STRING_CACHE_LIMIT = 4096
export const evict_oldest = (
  cache: Map<string, unknown>,
  limit = STRING_CACHE_LIMIT,
): void => {
  if (cache.size < limit) return
  const [oldest] = cache.keys()
  if (oldest !== undefined) cache.delete(oldest)
}

// d3 `format()` re-parses the spec and rebuilds a closure per call, so cache one per spec
const formatters = new Map<string, (num: number) => string>()
const formatter_for = (spec: string): ((num: number) => string) => {
  let formatter = formatters.get(spec)
  if (!formatter) {
    evict_oldest(formatters)
    formatters.set(spec, (formatter = format(spec)))
  }
  return formatter
}

// DEFAULT_FMT slot for num: the SI format for 1 <= |num| < 1e27, else the sub-1 format, which
// goes scientific for huge values. d3's largest SI prefix is yotta (1e24), so past it `s`
// writes 1e27 as 1,000Y and 1e100 as a 100-digit run.
const default_fmt_idx = (num: number): 0 | 1 =>
  Math.abs(num) >= 1 && Math.abs(num) < 1e27 ? 0 : 1

// fmt as number allows [].map(format_num) without a type error.
export const format_num = (num: number, fmt?: string | number): string => {
  if (!fmt || typeof fmt !== `string`) fmt = DEFAULT_FMT[default_fmt_idx(num)]
  return compact_scientific(formatter_for(fmt)(num), fmt, num)
}

// A value within a millionth of `magnitude` (the data's largest |value|) as exactly 0, so
// floating noise (a density's 1e-125 vacuum, a fixed atom's 1e-17 force) reads 0 rather than
// 9.43e-125 or 10a once formatted to a few significant digits
export const zero_if_negligible = (value: number, magnitude: number): number =>
  Math.abs(value) <= Math.abs(magnitude) * 1e-6 ? 0 : value

// Uppercase the first character, leaving the rest alone (`bcc` -> `Bcc`, `pV` -> `PV`).
export const capitalize = (text: string): string =>
  text.charAt(0).toUpperCase() + text.slice(1)

// Snake/kebab identifier to a display label: `bond_length` -> `Bond length`.
export const humanize = (text: string): string => capitalize(text.replaceAll(/[_-]/g, ` `))

// Separate a trailing unit, including nested denominators like states/(eV atom).
// The separating space keeps function labels such as g(r) intact.
export function parse_axis_label(label: string): { name: string; unit?: string } {
  if (label.endsWith(`)`)) {
    let depth = 0
    for (let idx = label.length - 1; idx > 0; idx--) {
      if (label[idx] === `)`) depth++
      if (label[idx] === `(` && --depth === 0 && /\s/.test(label[idx - 1]))
        return { name: label.slice(0, idx).trimEnd(), unit: label.slice(idx + 1, -1) }
    }
  }
  return { name: label }
}

// d3-shape symbol names (`Circle`, `Cross`, ...) in d3's fill-then-stroke order, and the
// matching SymbolType for each. `symbolX` aliases `symbolTimes`, so the first export
// naming a symbol object wins.
type D3SymbolExport = Extract<keyof typeof d3_symbols, `symbol${Capitalize<string>}`>
export type D3SymbolName = Exclude<
  D3SymbolExport extends `symbol${infer Name}` ? Name : never,
  ``
>
const symbols_by_name = Object.fromEntries(
  Object.entries(d3_symbols)
    .filter(([key]) => /^symbol[A-Z]/.test(key))
    .map(([key, symbol]) => [key.slice(6), symbol]),
) as Record<D3SymbolName, SymbolType>
const name_by_symbol = new Map<SymbolType, D3SymbolName>()
for (const [name, symbol] of Object.entries(symbols_by_name) as [D3SymbolName, SymbolType][]) {
  if (!name_by_symbol.has(symbol)) name_by_symbol.set(symbol, name)
}
export const symbol_names = [
  ...new Set([...d3_symbols.symbolsFill, ...d3_symbols.symbolsStroke]),
].flatMap((symbol) => name_by_symbol.get(symbol) ?? [])
export const symbol_map: Partial<Record<D3SymbolName, SymbolType>> = Object.fromEntries(
  symbol_names.map((name) => [name, symbols_by_name[name]]),
)

// Format a value for display with optional time formatting
export function format_value(value: number, formatter?: string): string {
  if (!formatter) return `${value}`
  if (formatter.startsWith(`%`)) return timeFormat(formatter)(new Date(value))

  const formatted = normalize_unicode_minus(formatter_for(formatter)(value))
  // Fixed-precision currency keeps its zeros ($1.50); everything else drops trailing zeros
  // after the decimal point, keeping a % suffix
  if (formatter.includes(`$`) && /\.\d+f/.test(formatter)) return formatted
  const [body, suffix] =
    formatter.includes(`%`) && formatted.endsWith(`%`)
      ? [formatted.slice(0, -1), `%`]
      : [formatted, ``]
  const stripped = body.replace(/(?<decimals>\.\d*?)0+$/, `$1`).replace(/\.$/, ``) + suffix
  return compact_scientific(stripped === `-0` ? `0` : stripped, formatter, value)
}

// Human-readable label + unit (null when dimensionless) for displayable element
// properties. Omitted: Record-valued (ionic_radii, shannon_radii), assets
// (cpk-hex, spectral_img), heading/summary fields (name, symbol, category,
// discoverer, year, summary) and electronegativity_pauling, which duplicates electronegativity
// for most elements but not all: Kr, Xe, Rn and Lr have a Pauling value and a null
// electronegativity, and Tb, Tl, Pb, Fr, Am and Cm differ in the last digit or two.
export const ELEM_PROPERTY_LABELS: Partial<
  Record<keyof ChemicalElement, [string, string | null]>
> = {
  appearance: [`Appearance`, null],
  atomic_mass: [`Atomic Mass`, `u`],
  atomic_radius: [`Atomic Radius`, `Å`],
  boiling_point: [`Boiling Point`, `K`],
  column: [`Group`, null],
  common_oxidation_states: [`Common Oxidation States`, null],
  covalent_radius: [`Covalent Radius`, `Å`],
  density: [`Density`, `g/cm³`],
  electron_affinity: [`Electron Affinity`, `kJ/mol`],
  electron_configuration: [`Electron Configuration`, null],
  electron_configuration_semantic: [`Electron Configuration (semantic)`, null],
  electronegativity: [`Electronegativity`, null],
  electrons: [`Electrons`, null],
  first_ionization: [`First Ionization Energy`, `eV`],
  icsd_oxidation_states: [`ICSD Oxidation States`, null],
  ionization_energies: [`Ionization Energies`, `kJ/mol`],
  melting_point: [`Melting Point`, `K`],
  mendeleev_number: [`Mendeleev Number`, null],
  molar_heat: [`Molar Heat`, `J/(mol·K)`],
  n_shells: [`Number of Shells`, null],
  n_valence: [`Electron Valency`, null],
  neutrons: [`Neutrons`, null],
  number: [`Atomic Number`, null],
  number_of_isotopes: [`Number of Isotopes`, null],
  oxidation_states: [`Oxidation States`, null],
  period: [`Period`, null],
  phase: [`Phase`, null],
  protons: [`Protons`, null],
  shells: [`Electron Shell Occupations`, null],
  specific_heat: [`Specific Heat`, `J/(g K)`],
}

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
      if (!label) throw new Error(`Unexpected missing label for element property ${key}`)
      return [label + (unit ? ` (${unit})` : ``), key]
    }),
  )

// Unicode glyphs for common fractions used by format_fractional(); every complement
// (1/3 <-> 2/3, ...) is listed, so matching against wrapped values alone suffices
const FRACTION_GLYPHS: readonly (readonly [number, string])[] = [
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

// format_value when an explicit format is given, else format_num's adaptive
// default: SI prefixes for |value| >= 1 (4500 -> 4.5k) but plain decimals
// below 1 (0.2 stays 0.2, never the SI milli form "200m")
export const format_value_or_num = (value: number, fmt?: string): string =>
  fmt ? format_value(value, fmt) : format_num(value)

const DEFAULT_TICK_PRECISION = 3
const MAX_TICK_PRECISION = 17

const labels_collide = (values: readonly number[], labels: readonly string[]): boolean =>
  labels.some(
    (label, value_idx) =>
      label === labels[value_idx - 1] && !Object.is(values[value_idx - 1], values[value_idx]),
  )

const longest_label = (labels: readonly string[]): number =>
  labels.reduce((longest, label) => Math.max(longest, label.length), 0)

// Digits the labels need to resolve the smallest gap between adjacent ticks: significant
// digits for the adaptive formats, decimals for the fixed one. Distinct neighbours alone are
// not enough: ticks 998 … 1000, 1000.5 read 1k, 1.001k at 4 significant digits. With
// ceil(log10(max|v| / step)) + 1 significant digits (or ceil(-log10(step)) decimals) the last
// digit's unit is at most the step, and for d3's 1-2-5 steps it divides the step, so every
// tick prints exactly. The 1e-9 slack keeps float noise in the step (0.30000000000000004 - 0.2)
// from adding a digit at exact powers of ten.
const tick_resolution_digits = (
  values: readonly number[],
): { significant: number; decimals: number } => {
  let min_step = Infinity
  let max_abs = 0
  for (const [idx, value] of values.entries()) {
    if (!Number.isFinite(value)) continue
    max_abs = Math.max(max_abs, Math.abs(value))
    const step = Math.abs(value - values[idx - 1])
    if (step > 0 && step < min_step) min_step = step
  }
  if (!Number.isFinite(min_step) || max_abs === 0) return { significant: 0, decimals: 0 }
  return {
    significant: Math.ceil(Math.log10(max_abs / min_step) - 1e-9) + 1,
    decimals: Math.max(0, Math.ceil(-Math.log10(min_step) - 1e-9)),
  }
}

// Retain compact adaptive labels while adjacent distinct tick values render distinctly and
// every label resolves the tick step, else add just enough precision for both. Explicit
// formats remain authoritative: callers may intentionally request rounded or
// categorical-looking labels.
export const format_tick_values = (
  values: readonly number[],
  formatter?: string,
): string[] => {
  if (formatter || values.length < 2)
    return values.map((value) => format_value_or_num(value, formatter))

  let labels = values.map(format_num)
  const resolution = tick_resolution_digits(values)

  const labels_with_precision = (precision: number, fixed = false): string[] =>
    values.map((value) =>
      format_num(
        value,
        fixed
          ? `.${precision}~f`
          : DEFAULT_FMT[default_fmt_idx(value)].replace(
              /(?:\.\d+)?(?=~?[a-z%]$)/iu,
              `.${precision}`,
            ),
      ),
    )
  const minimum_precision = Math.max(
    DEFAULT_TICK_PRECISION,
    ...DEFAULT_FMT.map((fmt) =>
      Number(/\.(?<precision>\d+)/u.exec(fmt)?.groups?.precision ?? DEFAULT_TICK_PRECISION),
    ),
  )
  if (resolution.significant <= minimum_precision && !labels_collide(values, labels)) {
    return labels
  }
  const first_precision = Math.min(
    MAX_TICK_PRECISION,
    Math.max(minimum_precision + 1, resolution.significant),
  )
  for (let precision = first_precision; precision <= MAX_TICK_PRECISION; precision++) {
    labels = labels_with_precision(precision)
    if (!labels_collide(values, labels)) break
  }
  const first_decimals = Math.min(MAX_TICK_PRECISION, resolution.decimals)
  for (let precision = first_decimals; precision <= MAX_TICK_PRECISION; precision++) {
    const fixed_labels = labels_with_precision(precision, true)
    if (!labels_collide(values, fixed_labels)) {
      return longest_label(fixed_labels) < longest_label(labels) ? fixed_labels : labels
    }
  }
  return labels
}

// Format a 3D vector as "(x, y, z)" with configurable precision
export const format_vec3 = (vec: Readonly<Vec3>, fmt_spec = `.3~`): string =>
  `(${vec.map((coord) => format_num(coord, fmt_spec)).join(`, `)})`

// "1 site" / "3 sites"
export const plural = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? `` : `s`}`

// Replace common fractional values with unicode glyphs (e.g. 1/2 → ½). The integer part is
// dropped: callers format fractional coordinates and stoichiometric remainders.
export function format_fractional(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  const wrapped = ((value % 1) + 1) % 1 // wrap into [0,1)
  const eps = 1e-3
  // The zero glyph covers both sides of an integer (0.9995 and -1e-7 as well as 1.0005), so
  // it measures the distance to the nearest integer on the value itself: `wrapped` picks up
  // float noise (0.999 wraps to 0.9990000000000001, within eps of 1)
  const match = FRACTION_GLYPHS.find(([target]) =>
    target === 0
      ? Math.abs(value - Math.round(value)) <= eps
      : Math.abs(wrapped - target) < eps,
  )
  return match?.[1] ?? format_num(value, `.4~`)
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

const SUPERSCRIPT_MAP = {
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
  input.replaceAll(
    /[\d+-]/g,
    (match) => SUPERSCRIPT_MAP[match as keyof typeof SUPERSCRIPT_MAP],
  )

// Axis-group key for SCF convergence series: shared between the property config
// below and the log-scale detection in trajectory/plotting.ts so the two can't drift
export const SCF_AXIS_GROUP = `eV (SCF)`

// Trajectory property configuration: clean labels and units as structured data.
// axis_group (optional) overrides the unit as the y-axis grouping key: series with
// the same unit normally share an axis, but e.g. log-scaled |ΔE_SCF| (all-positive,
// spanning many decades) must not share the linear energy axis despite both being eV.
// Keys are lowercase: every consumer falls back to `config[key.toLowerCase()]`, so
// `Energy`, `Fmax`, `Alpha`, ... resolve without their own entries.
export interface TrajPropertyConfig {
  label: string
  unit: string
  axis_group?: string
}
export const trajectory_property_config: Record<string, TrajPropertyConfig> = {
  // Energy properties
  energy: { label: `Energy`, unit: `eV` },
  energy_per_atom: { label: `Energy per atom`, unit: `eV/atom` },
  potential_energy: { label: `Potential energy`, unit: `eV` },
  kinetic_energy: { label: `Kinetic energy`, unit: `eV` },
  total_energy: { label: `Total energy`, unit: `eV` },

  // Force properties (common variations)
  force_max: { label: `F<sub>max</sub>`, unit: `eV/Å` },
  fmax: { label: `F<sub>max</sub>`, unit: `eV/Å` },
  'Force Max': { label: `Force Max`, unit: `eV/Å` },
  force_norm: { label: `F<sub>norm</sub>`, unit: `eV/Å` },
  'Force RMS': { label: `Force RMS`, unit: `eV/Å` },

  // Structural properties
  volume: { label: `Volume`, unit: `Å³` },
  density: { label: `Density`, unit: `g/cm³` },

  // Lattice parameters
  a: { label: `A`, unit: `Å` },
  b: { label: `B`, unit: `Å` },
  c: { label: `C`, unit: `Å` },
  alpha: { label: `α`, unit: `°` },
  beta: { label: `β`, unit: `°` },
  gamma: { label: `γ`, unit: `°` },

  // Thermodynamic properties
  temperature: { label: `Temperature`, unit: `K` },
  pressure: { label: `Pressure`, unit: `GPa` },
  stress_max: { label: `σ<sub>max</sub>`, unit: `GPa` },
  stress_frobenius: { label: `σ<sub>F</sub>`, unit: `GPa` },

  // Electronic structure
  bandgap: { label: `Band gap`, unit: `eV` },

  // SCF/electronic convergence properties (e.g. from VASP vaspout.h5 OSZICAR data)
  n_scf_steps: { label: `SCF steps`, unit: `steps` },
  scf_energy_delta: { label: `|ΔE<sub>SCF</sub>|`, unit: `eV`, axis_group: SCF_AXIS_GROUP },
  scf_rms: { label: `ρ residual (rms)`, unit: `a.u.` },
  scf_charge_rms: { label: `ρ<sub>c</sub> residual (rms(c))`, unit: `a.u.` },
}
