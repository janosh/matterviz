import type { IdStructure } from '../lib'

export { default as DemoNav } from './DemoNav.svelte'
export { default as FileCarousel } from './FileCarousel.svelte'
export { default as Footer } from './Footer.svelte'
export { default as PeriodicTableControls } from './PeriodicTableControls.svelte'
export { default as PeriodicTableDemo } from './PeriodicTableDemo.svelte'

export const structures = Object.entries(
  import.meta.glob(`./structures/*.json`, {
    eager: true,
    import: `default`,
  }) as Record<string, IdStructure>,
)
  .map(([path, structure]) => {
    const id = path.split(`/`).at(-1)?.split(`.`)[0] as string
    structure.id = id
    return structure
  })
  .sort((struct1, struct2) => {
    const [n1, n2] = [struct1, struct2].map((struct) =>
      struct.id.split(`-`)[1].padStart(6, `0`)
    )
    return n1.localeCompare(n2)
  })

export const molecules = Object.entries(
  import.meta.glob(`./molecules/*.json`, {
    eager: true,
    import: `default`,
  }) as Record<string, IdStructure>,
).map(([path, mol]) => {
  const name = path.split(`/`).at(-1)?.split(`.`)[0] as string
  mol.name = name
  return mol
})

export interface FileInfo {
  name: string
  content: string
  formatted_name: string
  type: string
  structure_type?: `crystal` | `molecule` | `unknown`
  content_type?: `text` | `binary` // Indicates if content is text or binary data URL
}
