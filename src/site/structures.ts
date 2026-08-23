import type { AnyStructure, FileInfo } from '$lib'
import {
  detect_structure_type,
  is_structure_like,
  optimade_structure_from_raw,
  optimade_to_structure,
  structure_from_json,
} from '$lib/structure/parse'
import { is_crystal } from '$lib/structure/validation'
import { fixture_ext, glob_text, site_file_info } from '$site/imports'
import { SvelteMap } from 'svelte/reactivity'

export const structures = Object.entries(
  import.meta.glob<unknown>(`./structures/*.json`, { eager: true, import: `default` }),
)
  .flatMap(([path, data]) => {
    const id = path.split(`/`).at(-1)?.split(`.`)[0] as string
    const optimade = optimade_structure_from_raw(data)
    // optimade_to_structure throws on a malformed fixture on purpose: that should fail loudly
    // at build/test time rather than silently drop the structure from the demo list.
    // annotated: `Crystal | Molecule` would otherwise subtype-reduce to Molecule here
    const structure: AnyStructure | null = optimade
      ? optimade_to_structure(optimade)
      : is_structure_like(data)
        ? structure_from_json(data)
        : null
    return structure && is_crystal(structure) ? [{ ...structure, id }] : []
  })
  .toSorted((struct_a, struct_b) =>
    (struct_a.id?.split(`-`)[1] ?? ``)
      .padStart(6, `0`)
      .localeCompare((struct_b.id?.split(`-`)[1] ?? ``).padStart(6, `0`)),
  )

export const structure_map = new SvelteMap(structures.map((struct) => [struct.id, struct]))

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
    const file = site_file_info(path, { type: fixture_ext(path).toUpperCase() })
    // raw_text_plugin decompresses eager `?raw` gzip imports before they reach this map.
    const category = detect_structure_type(file.name.replace(/\.gz$/i, ``), glob_text(value))
    return { ...file, category, category_icon: category_icons[category] }
  },
)
