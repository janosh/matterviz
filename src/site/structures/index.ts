import type { Crystal, FileInfo } from '$lib'
import {
  detect_structure_type,
  is_optimade_json,
  parse_optimade_json,
} from '$lib/structure/parse'

export const structures = Object.entries(
  // JSON structure files (OPTIMADE/pymatgen format) as JS objects
  import.meta.glob<unknown>(`./*.json`, { eager: true, import: `default` }),
)
  .map(([path, data]) => {
    const id = path.split(`/`).at(-1)?.split(`.`)[0] as string
    const data_str = JSON.stringify(data)
    // Convert OPTIMADE to pymatgen format
    if (is_optimade_json(data_str)) {
      const parsed = parse_optimade_json(data_str)
      if (parsed) return { ...parsed, id } as Crystal
    }

    // Assume pymatgen format
    const structure = data as Crystal
    structure.id = id
    return structure
  })
  .filter(
    (structure): structure is Crystal =>
      structure && `sites` in structure && Array.isArray(structure.sites),
  )
  .toSorted((struct_a, struct_b) =>
    (struct_a.id?.split(`-`)[1] ?? ``)
      .padStart(6, `0`)
      .localeCompare((struct_b.id?.split(`-`)[1] ?? ``).padStart(6, `0`)),
  )

export const structure_map = new Map(structures.map((struct) => [struct.id, struct]))

// dev yields strings; the Rolldown prod build yields the module namespace (text
// under `.default`, JSON parsed) — unwrap and re-stringify objects back to text
export const glob_text = (value: unknown): string => {
  const raw = typeof value === `string` ? value : (value as { default?: unknown })?.default
  if (typeof raw === `string`) return raw
  // JSON.stringify(undefined) would return undefined, breaking the string contract
  return raw == null ? `` : JSON.stringify(raw)
}

// all structure files as raw text
const raw_structure_modules = import.meta.glob(`$site/structures/*`, {
  eager: true,
  query: `?raw`,
  import: `default`,
})

// Look up the raw text of a structure fixture by filename (e.g. `LiFePO4.cif`)
export function structure_file_text(filename: string): string | null {
  const entry = Object.entries(raw_structure_modules).find(([path]) =>
    path.endsWith(`/${filename}`),
  )
  if (!entry) return null
  const text = glob_text(entry[1])
  return text === `` ? null : text
}

const category_icons: Record<ReturnType<typeof detect_structure_type>, string> = {
  crystal: `🔷`,
  molecule: `🧬`,
  unknown: `❓`,
}

export const structure_files: FileInfo[] = Object.entries(raw_structure_modules).map(
  ([path, value]) => {
    const filename = path.split(`/`).pop() ?? path
    const type = path.split(`.`).pop()?.toUpperCase() ?? `FILE`
    const url = path.replace(`/src/site`, ``)
    const category = detect_structure_type(filename, glob_text(value))
    return { name: filename, url, type, category, category_icon: category_icons[category] }
  },
)
