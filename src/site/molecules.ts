import type { FileInfo, Molecule } from '$lib'
import { fixture_ext, glob_basename, site_file_info } from '$site/imports'

const molecules = Object.entries(
  import.meta.glob<Molecule>(`./molecules/*.json`, {
    eager: true,
    import: `default`,
  }),
).map(([path, mol]) => {
  mol.id = glob_basename(path).split(`.`)[0]
  return mol
})

export const test_molecules = Object.fromEntries(molecules.map((mol) => [mol.id, mol]))

// ?url like the other site registries: only the keys are read here, and without it Vite
// puts every non-JS fixture (.mol2, .pdb, .sdf, .xyz) through the module transform pipeline
// instead of emitting it as an asset. The static symlink serves them at /molecules/<name>.
export const molecule_files: FileInfo[] = Object.keys(
  import.meta.glob(`$site/molecules/*`, { query: `?url` }),
).map((path) =>
  site_file_info(path, {
    type: fixture_ext(path).toUpperCase(),
    category: `molecule`,
    category_icon: `🧬`,
  }),
)
