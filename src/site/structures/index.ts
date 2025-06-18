import type { PymatgenStructure } from '$lib/index'

const get_padded_number = (struct: PymatgenStructure) =>
  (struct.id?.split(`-`)[1] ?? ``).padStart(6, `0`)

export const structures = Object.entries(
  import.meta.glob(`./*.json`, {
    eager: true,
    import: `default`,
  }) as Record<string, PymatgenStructure>,
)
  .map(([path, structure]) => {
    const id = path.split(`/`).at(-1)?.split(`.`)[0] as string
    structure.id = id
    return structure
  })
  .sort((struct_a, struct_b) =>
    get_padded_number(struct_a).localeCompare(get_padded_number(struct_b))
  )

export const structure_map = new Map(structures.map((struct) => [struct.id, struct]))
