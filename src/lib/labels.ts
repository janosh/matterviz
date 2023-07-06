import type { Category, ChemicalElement } from '$lib'
// .ts ext needed for Playwright to be able to resolve import
import { rgb } from 'd3-color'
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
      const [label, unit] = property_labels[key] ?? []
      if (!label) throw `Unexpected missing label ${label}`
      return [label + (unit ? ` (${unit})` : ``), key]
    }),
  )

// allow users to import default_fmt and change it's items in place to
// set default number format globally
export const default_fmt: [string, string] = [`,.3~s`, `.3~g`]

// fmt as number only allowed to support [].map(pretty_num) without type error
export const pretty_num = (num: number, fmt?: string | number) => {
  if (num === null) return ``
  if (!fmt || typeof fmt !== `string`) {
    const [gt_1_fmt, lt_1_fmt] = default_fmt
    return format(Math.abs(num) >= 1 ? gt_1_fmt : lt_1_fmt)(num)
  }
  return format(fmt)(num)
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

// prettier-ignore
export const elem_symbols = [`H`,`He`,`Li`,`Be`,`B`,`C`,`N`,`O`,`F`,`Ne`,`Na`,`Mg`,`Al`,`Si`,`P`,`S`,`Cl`,`Ar`,`K`,`Ca`,`Sc`,`Ti`,`V`,`Cr`,`Mn`,`Fe`,`Co`,`Ni`,`Cu`,`Zn`,`Ga`,`Ge`,`As`,`Se`,`Br`,`Kr`,`Rb`,`Sr`,`Y`,`Zr`,`Nb`,`Mo`,`Tc`,`Ru`,`Rh`,`Pd`,`Ag`,`Cd`,`In`,`Sn`,`Sb`,`Te`,`I`,`Xe`,`Cs`,`Ba`,`La`,`Ce`,`Pr`,`Nd`,`Pm`,`Sm`,`Eu`,`Gd`,`Tb`,`Dy`,`Ho`,`Er`,`Tm`,`Yb`,`Lu`,`Hf`,`Ta`,`W`,`Re`,`Os`,`Ir`,`Pt`,`Au`,`Hg`,`Tl`,`Pb`,`Bi`,`Po`,`At`,`Rn`,`Fr`,`Ra`,`Ac`,`Th`,`Pa`,`U`,`Np`,`Pu`,`Am`,`Cm`,`Bk`,`Cf`,`Es`,`Fm`,`Md`,`No`,`Lr`,`Rf`,`Db`,`Sg`,`Bh`,`Hs`,`Mt`,`Ds`,`Rg`,`Cn`,`Nh`,`Fl`,`Mc`,`Lv`,`Ts`,`Og`] as const

// function combo used to retrieve background color and to compute text color to maximize contrast
export function luminance(clr: string) {
  // calculate human-perceived lightness from RGB
  const { r, g, b } = rgb(clr)
  // if (![r, g, b].every((c) => c >= 0 && c <= 255)) {
  //   console.error(`invalid RGB color: ${clr}, parsed to rgb=${r},${g},${b}`)
  // }
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 // https://stackoverflow.com/a/596243
}

export function get_bg_color(
  elem: HTMLElement | null,
  bg_color: string | null = null,
): string {
  if (bg_color) return bg_color
  // recurse up the DOM tree to find the first non-transparent background color
  const transparent = `rgba(0, 0, 0, 0)`
  if (!elem) return `rgba(0, 0, 0, 0)`

  const bg = getComputedStyle(elem).backgroundColor
  if (bg !== transparent) return bg
  return get_bg_color(elem.parentElement)
}

export function get_text_color(
  node: HTMLElement | null,
  // you can explicitly pass bg_color to avoid DOM recursion and in case get_bg_color() fails
  bg_color: string | null = null,
  text_color_threshold: number = 0.7,
) {
  const dark_bg = luminance(get_bg_color(node, bg_color)) < text_color_threshold
  return dark_bg ? `white` : `black`
}
