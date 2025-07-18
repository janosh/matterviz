import type { Category, ChemicalElement } from '$lib'
import { format } from 'd3-format'

// TODO add labels and units for all elemental properties
export const property_labels: Partial<
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
  // molar_heat: [`Molar Heat`, `J/(mol·K)`],
  n_shells: [`Number of Shells`, null],
  n_valence: [`Electron Valency`, null],
  number: [`Atomic Number`, null],
  shells: [`Electron Shell Occupations`, null],
  specific_heat: [`Specific Heat`, `J/(g K)`],
} as const

export const heatmap_keys: (keyof ChemicalElement)[] = [
  `atomic_mass`,
  `atomic_radius`,
  `covalent_radius`,
  `electronegativity`,
  `density`,
  `boiling_point`,
  `melting_point`,
  `first_ionization`,
]

export const heatmap_labels: Partial<Record<string, keyof ChemicalElement>> = Object
  .fromEntries(
    heatmap_keys.map((key) => {
      const [label, unit] = property_labels[key] ?? []
      if (!label) throw `Unexpected missing label ${label}`
      return [label + (unit ? ` (${unit})` : ``), key]
    }),
  )

// allow users to import default_fmt and change it's items in place to
// set default number format globally
export const default_fmt: [string, string] = [`,.3~s`, `.3~g`]

// fmt as number only allowed to support [].map(format_num) without type error
export const format_num = (num: number, fmt?: string | number) => {
  if (num === null) return ``
  if (!fmt || typeof fmt !== `string`) {
    const [gt_1_fmt, lt_1_fmt] = default_fmt
    return format(Math.abs(num) >= 1 ? gt_1_fmt : lt_1_fmt)(num)
  }
  return format(fmt)(num)
}

export function parse_si_float<T extends string | number | null | undefined>(
  value: T,
): T | number | string {
  // if not string, return as is
  if (typeof value !== `string`) return value
  // Remove whitespace and commas
  const cleaned = value.trim().replace(/(\d),(\d)/g, `$1$2`)

  // Check if the value is a SI-formatted number (e.g., "1.23k", "4.56M", "789µ", "12n")
  const match = cleaned.match(/^([-+]?\d*\.?\d+)\s*([yzafpnµmkMGTPEZY])?$/i)
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

export const category_counts: Record<Category, number> = {
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

export const categories = [
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

// deno-fmt-ignore-next-line
export const elem_symbols = [`H`,`He`,`Li`,`Be`,`B`,`C`,`N`,`O`,`F`,`Ne`,`Na`,`Mg`,`Al`,`Si`,`P`,`S`,`Cl`,`Ar`,`K`,`Ca`,`Sc`,`Ti`,`V`,`Cr`,`Mn`,`Fe`,`Co`,`Ni`,`Cu`,`Zn`,`Ga`,`Ge`,`As`,`Se`,`Br`,`Kr`,`Rb`,`Sr`,`Y`,`Zr`,`Nb`,`Mo`,`Tc`,`Ru`,`Rh`,`Pd`,`Ag`,`Cd`,`In`,`Sn`,`Sb`,`Te`,`I`,`Xe`,`Cs`,`Ba`,`La`,`Ce`,`Pr`,`Nd`,`Pm`,`Sm`,`Eu`,`Gd`,`Tb`,`Dy`,`Ho`,`Er`,`Tm`,`Yb`,`Lu`,`Hf`,`Ta`,`W`,`Re`,`Os`,`Ir`,`Pt`,`Au`,`Hg`,`Tl`,`Pb`,`Bi`,`Po`,`At`,`Rn`,`Fr`,`Ra`,`Ac`,`Th`,`Pa`,`U`,`Np`,`Pu`,`Am`,`Cm`,`Bk`,`Cf`,`Es`,`Fm`,`Md`,`No`,`Lr`,`Rf`,`Db`,`Sg`,`Bh`,`Hs`,`Mt`,`Ds`,`Rg`,`Cn`,`Nh`,`Fl`,`Mc`,`Lv`,`Ts`,`Og`] as const

export const superscript_map = {
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

export function superscript_digits(input: string): string {
  // use replace all signs and digits with their unicode superscript equivalent
  return input.replace(
    /[\d+-]/g,
    (match) => superscript_map[match as keyof typeof superscript_map] ?? match,
  )
}

// Trajectory property configuration: clean labels and units as structured data
export const trajectory_property_config: Record<string, { label: string; unit: string }> =
  {
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
