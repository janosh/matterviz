import type { PymatgenStructure } from '../lib'

export { default as DemoNav } from './DemoNav.svelte'
export { default as Footer } from './Footer.svelte'

export const structures = Object.entries(
  import.meta.glob(`./structures/*.json`, {
    eager: true,
    import: `default`,
  }) as Record<string, PymatgenStructure>
).map(([path, structure]) => {
  const id = path.split(`/`).at(-1)?.split(`.`)[0] as string
  structure.id = id
  return structure
})
