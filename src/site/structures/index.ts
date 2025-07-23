import { type PymatgenStructure } from '$lib/index'
import { detect_structure_type } from '$lib/io'
import type { FileInfo } from '$site'

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

export const structure_files: FileInfo[] = (Object.entries(
  import.meta.glob(`$site/structures/*.{poscar,xyz,cif,yaml}`, {
    eager: true,
    query: `?raw`,
    import: `default`,
  }),
) as [string, string][]).map(
  ([path, content]) => {
    const filename = path.split(`/`).pop() || path
    const type = path.split(`.`).pop()?.toUpperCase() ?? `FILE`

    const structure_type = detect_structure_type(filename, content)
    const category = { crystal: `🔷`, molecule: `🧬`, unknown: `❓` }[structure_type] ||
      `📄`
    return { name: filename, url: path.replace(`/src/site`, ``), type, category }
  },
)
