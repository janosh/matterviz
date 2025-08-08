import type { FileInfo, PymatgenMolecule } from '$lib'

// Array of molecules
export const molecules = Object.entries(
  import.meta.glob(`./*.json`, {
    eager: true,
    import: `default`,
  }) as Record<string, PymatgenMolecule>,
).map(([path, mol]) => {
  const id = path.split(`/`).at(-1)?.split(`.`)[0]
  mol.id = id
  return mol
})

// Object of molecules by ID
export const test_molecules = Object.fromEntries(molecules.map((mol) => [mol.id, mol]))

export const molecule_files: FileInfo[] = (Object.entries( // all structure files as raw text
  import.meta.glob(
    `$site/molecules/*`,
    { eager: true, query: `?raw`, import: `default` },
  ),
) as [string, string][]).map(
  ([path]) => {
    const filename = path.split(`/`).pop() || path
    const type = path.split(`.`).pop()?.toUpperCase() ?? `FILE`
    const category = `🧬` as const
    return { name: filename, url: path.replace(`/src/site`, ``), type, category }
  },
)
