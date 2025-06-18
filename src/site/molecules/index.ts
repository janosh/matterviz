import type { PymatgenMolecule } from '$lib/index'

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
