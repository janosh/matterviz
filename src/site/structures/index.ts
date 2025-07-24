import { type PymatgenStructure } from '$lib/index'
import { detect_structure_type, is_optimade_json, parse_optimade_json } from '$lib/io'
import type { FileInfo } from '$site'

export const structures = Object.entries( // JSON structure files (OPTIMADE/pymatgen format) as JS objects
  import.meta.glob(`./*.json`, {
    eager: true,
    import: `default`,
  }) as Record<string, unknown>,
)
  .map(([path, data]) => {
    const id = path.split(`/`).at(-1)?.split(`.`)[0] as string
    const data_str = JSON.stringify(data)
    // Convert OPTIMADE to pymatgen format
    if (is_optimade_json(data_str)) {
      const parsed = parse_optimade_json(data_str)
      if (parsed) return { ...parsed, id } as PymatgenStructure
    }

    // Assume pymatgen format
    const structure = data as PymatgenStructure
    structure.id = id
    return structure
  })
  .filter((structure): structure is PymatgenStructure =>
    structure && `sites` in structure && Array.isArray(structure.sites)
  )
  .sort((struct_a, struct_b) =>
    (struct_a.id?.split(`-`)[1] ?? ``).padStart(6, `0`).localeCompare(
      (struct_b.id?.split(`-`)[1] ?? ``).padStart(6, `0`),
    )
  )

export const structure_map = new Map(structures.map((struct) => [struct.id, struct]))

export const structure_files: FileInfo[] = (Object.entries( // all structure files as raw text
  import.meta.glob(
    `$site/structures/*`,
    { eager: true, query: `?raw`, import: `default` },
  ),
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
