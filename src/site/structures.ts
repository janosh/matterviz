import type { AnyStructure } from '#lib'
import { get_alphabetical_formula } from '#lib/composition/format'
import type { FileInfo } from '#lib/io/index'
import {
  detect_structure_type,
  is_structure_like,
  optimade_structure_from_raw,
  optimade_to_structure,
  parse_structure_file,
  structure_from_json,
} from '#lib/structure/parse'
import { is_crystal } from '#lib/structure/validation'
import { fixture_ext, glob_basename, glob_text, site_file_info } from '#site/imports'

export const structures = Object.entries(
  import.meta.glob<unknown>(`./structures/*.json`, { eager: true, import: `default` }),
)
  .flatMap(([path, data]) => {
    const identifier = glob_basename(path).split(`.`)[0]
    const optimade = optimade_structure_from_raw(data)
    // optimade_to_structure throws on a malformed fixture on purpose: that should fail loudly
    // at build/test time rather than silently drop the structure from the demo list.
    // annotated: `Crystal | Molecule` would otherwise subtype-reduce to Molecule here
    const structure: AnyStructure | null = optimade
      ? optimade_to_structure(optimade)
      : is_structure_like(data)
        ? structure_from_json(data)
        : null
    return structure && is_crystal(structure) ? [{ ...structure, id: identifier }] : []
  })
  .toSorted((struct_a, struct_b) =>
    (struct_a.id?.split(`-`)[1] ?? ``)
      .padStart(6, `0`)
      .localeCompare((struct_b.id?.split(`-`)[1] ?? ``).padStart(6, `0`)),
  )

export const structure_map = new Map(structures.map((struct) => [struct.id, struct]))

const raw_structure_modules = import.meta.glob(`#site/structures/*`, {
  eager: true,
  query: `?raw`,
  import: `default`,
})

// Parsed structure fixture by filename; throws (at build/test time) for an unknown fixture
export const parse_structure_fixture = (filename: string): AnyStructure => {
  const entry = Object.entries(raw_structure_modules).find(([path]) =>
    path.endsWith(`/${filename}`),
  )
  const text = glob_text(entry?.[1])
  if (!text) throw new Error(`Unknown structure fixture ${filename}`)
  return parse_structure_file(text, filename)
}

export const structure_files: FileInfo[] = Object.entries(raw_structure_modules).map(
  ([path, value]) => {
    const file = site_file_info(path, { type: fixture_ext(path).toUpperCase() })
    // raw_text_plugin decompresses eager `?raw` gzip imports before they reach this map.
    const category = detect_structure_type(file.name.replace(/\.gz$/i, ``), glob_text(value))
    return { ...file, category }
  },
)

// Fixtures that compare site by site (StructureDiff): every pair within a group of equal
// formula (composition and site count) and periodicity whose cell volumes differ by less than
// 25%, so polymorphs and re-encodings pair up but not a fixture's distorted test cell
export function same_composition_pairs<T extends { structure: AnyStructure }>(
  entries: readonly T[],
): [T, T][] {
  const groups = Map.groupBy(entries, ({ structure }) => {
    const formula = get_alphabetical_formula(structure, { plain_text: true, delim: ` ` })
    return `${formula} ${is_crystal(structure) ? structure.lattice.pbc : `molecule`}`
  })
  const volume = ({ structure }: T) => (is_crystal(structure) ? structure.lattice.volume : 1)
  return [...groups.values()].flatMap((group) =>
    group.flatMap((first, idx) =>
      group
        .slice(idx + 1)
        .filter((second) => Math.abs(volume(second) / volume(first) - 1) < 0.25)
        .map((second): [T, T] => [first, second]),
    ),
  )
}
