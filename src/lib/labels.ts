import type { ChemicalElement } from './types'

// TODO add labels and units for all elemental properties
export const element_property_labels: Partial<
  Record<keyof ChemicalElement, [string, string | null]>
> = {
  number: [`Atomic Number`, null],
  atomic_mass: [`Atomic Mass`, `u`],
  melting_point: [`Melting Point`, `K`],
  boiling_point: [`Boiling Point`, `K`],
  density: [`Density`, `g/cm³`],
  atomic_radius: [`Atomic Radius`, `Å`],
  covalent_radius: [`Covalent Radius`, `Å`],
  electronegativity: [`Electronegativity`, null],
  first_ionization: [`First Ionization Energy`, `eV`],
  electron_affinity: [`Electron Affinity`, null],
  n_shells: [`Number of Shells`, null],
  n_valence: [`Electron Valency`, null],
  shells: [`Electron Shell Occupations`, null],
  specific_heat: [`Specific Heat`, `J/g`], // TODO check correct unit
}

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

export const heatmap_labels: Partial<Record<string, keyof ChemicalElement>> =
  Object.fromEntries(
    heatmap_keys.map((key) => {
      const [label, unit] = element_property_labels[key] ?? []
      if (!label) throw `Unexpected missing label ${label}`
      return [label + (unit ? ` (${unit})` : ``), key]
    })
  )

export const pretty_num = (num: number | null, precision = 2) => {
  if (num === null) return ``
  if (num < 0.01 || num > 10000) {
    return num.toExponential(precision)
  } else {
    return parseFloat(num.toFixed(precision))
  }
}
