import type { FileInfo, Molecule } from '$lib'

// Array of molecules
const molecules = Object.entries(
  import.meta.glob<Molecule>(`./*.json`, {
    eager: true,
    import: `default`,
  }),
).map(([path, mol]) => {
  const id = path.split(`/`).at(-1)?.split(`.`)[0]
  mol.id = id
  return mol
})

// Object of molecules by ID
export const test_molecules = Object.fromEntries(molecules.map((mol) => [mol.id, mol]))

// Only the glob keys (paths) are needed to build FileInfo entries, so don't eager-load
// file contents
export const molecule_files: FileInfo[] = Object.keys(
  import.meta.glob(`$site/molecules/*`),
).map((path) => {
  const filename = path.split(`/`).pop() ?? path
  const type = path.split(`.`).pop()?.toUpperCase() ?? `FILE`
  const url = path.replace(`/src/site`, ``)
  return { name: filename, url, type, category: `molecule`, category_icon: `🧬` }
})
