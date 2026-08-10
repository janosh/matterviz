import type { FileInfo, Molecule } from '$lib'

const molecules = Object.entries(
  import.meta.glob<Molecule>(`./molecules/*.json`, {
    eager: true,
    import: `default`,
  }),
).map(([path, mol]) => {
  const id = path.split(`/`).at(-1)?.split(`.`)[0]
  mol.id = id
  return mol
})

export const test_molecules = Object.fromEntries(molecules.map((mol) => [mol.id, mol]))

// ?url like the other site registries: only the keys are read here, and without it Vite
// puts every non-JS fixture (.mol2, .pdb, .sdf, .xyz) through the module transform pipeline
// instead of emitting it as an asset. The static symlink serves them at /molecules/<name>.
export const molecule_files: FileInfo[] = Object.keys(
  import.meta.glob(`$site/molecules/*`, { query: `?url` }),
).map((path) => {
  const filename = path.split(`/`).pop() ?? path
  const type = filename.split(`.`).pop()?.toUpperCase() ?? `FILE`
  const url = path.replace(`/src/site`, ``)
  return { name: filename, url, type, category: `molecule`, category_icon: `🧬` }
})
