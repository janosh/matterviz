import type { ChemicalElement, ElementCategory } from './types'

const category_groups = [
  [`alkali`, `Alkali metals`, `alkali metal`],
  [`alkaline_earth`, `Alkaline earth metals`, `alkaline earth metal`],
  [`transition`, `Transition metals`, `transition metal`],
  [`post_transition`, `Post-transition metals`, `post-transition metal`],
  [`metalloid`, `Metalloids`, `metalloid`],
  [`noble_gas`, `Noble gases`, `noble gas`],
  [`lanthanide`, `Lanthanides`, `lanthanide`],
  [`actinide`, `Actinides`, `actinide`],
] as const satisfies readonly (readonly [string, string, ElementCategory])[]

type CategoryGroupKey = (typeof category_groups)[number][0]
export type ElementGroupKey = `all` | `nonmetal` | `halogen` | CategoryGroupKey
export type ElementGroup = {
  readonly value: ElementGroupKey
  readonly label: string
  readonly tooltip?: string
  readonly includes: (element: ChemicalElement) => boolean
}

const to_group = ([value, label, category]: (typeof category_groups)[number]) => ({
  value,
  label,
  includes: (element: ChemicalElement) => element.category === category,
})

/** Overlapping element filters; a single element can belong to multiple groups. */
export const element_groups: readonly ElementGroup[] = [
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

export const element_group_keys: ReadonlySet<ElementGroupKey> = new Set(
  element_groups.map(({ value }) => value),
)
