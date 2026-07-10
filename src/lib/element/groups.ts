import element_data from './data'
import type { ChemicalElement, ElementCategory } from './types'

export type ElementGroup = {
  value: string
  label: string
  tooltip?: string
  includes: (element: ChemicalElement) => boolean
}

export const element_by_symbol = new Map(
  element_data.map((element) => [element.symbol, element]),
)

const category_groups: [string, string, ElementCategory][] = [
  [`alkali`, `Alkali metals`, `alkali metal`],
  [`alkaline_earth`, `Alkaline earth metals`, `alkaline earth metal`],
  [`transition`, `Transition metals`, `transition metal`],
  [`post_transition`, `Post-transition metals`, `post-transition metal`],
  [`metalloid`, `Metalloids`, `metalloid`],
  [`noble_gas`, `Noble gases`, `noble gas`],
  [`lanthanide`, `Lanthanides`, `lanthanide`],
  [`actinide`, `Actinides`, `actinide`],
]
const to_group = ([value, label, category]: (typeof category_groups)[number]) => ({
  value,
  label,
  includes: (element: ChemicalElement) => element.category === category,
})

export const element_groups: ElementGroup[] = [
  { value: `all`, label: `All`, tooltip: `Show all elements`, includes: () => true },
  ...category_groups.slice(0, 5).map(to_group),
  {
    value: `nonmetal`,
    label: `Nonmetals`,
    tooltip: `Diatomic and polyatomic nonmetals`,
    includes: (element) =>
      [`diatomic nonmetal`, `polyatomic nonmetal`].includes(element.category),
  },
  {
    value: `halogen`,
    label: `Halogens`,
    tooltip: `Group 17 halogen elements`,
    includes: (element) => element.column === 17 && element.row <= 7,
  },
  ...category_groups.slice(5).map(to_group),
]

export const element_group_by_key = new Map(
  element_groups.map((group) => [group.value, group]),
)
export const element_group_keys = new Set(element_group_by_key.keys())
