import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const tag_re = /<extras\.InstancedMesh\b[^>]*>/gs

const get_tags = (source: string): string[] =>
  [...source.matchAll(tag_re)].map((match) => match[0])

function get_attr(tag: string, attr: `limit` | `range` | `key`): string {
  const match = new RegExp(`\\b${attr}\\s*=\\s*(?:"([^"]+)"|\\{\\s*([^}]+?)\\s*\\})`).exec(tag)
  if (!match) throw new Error(`InstancedMesh tag is missing ${attr}: ${tag}`)
  return (match[1] ?? match[2]).replaceAll(/\s+/g, ``)
}

describe(`InstancedMesh limits`, () => {
  it.each([
    { file_path: `src/lib/structure/StructureScene.svelte`, expected_tags: 1 },
    { file_path: `src/lib/plot/scatter-3d/ScatterPlot3DScene.svelte`, expected_tags: 2 },
  ])(`sets limit equal to range in $file_path`, ({ file_path, expected_tags }) => {
    const tags = get_tags(readFileSync(file_path, `utf8`))
    expect(tags).toHaveLength(expected_tags)

    for (const tag of tags) {
      expect(get_attr(tag, `limit`)).toBe(get_attr(tag, `range`))
    }
  })

  it(`keys StructureScene atom mesh with shared group identity`, () => {
    const source = readFileSync(`src/lib/structure/StructureScene.svelte`, `utf8`)
    const [tag] = get_tags(source)
    if (!tag) throw new Error(`StructureScene InstancedMesh tag not found`)

    expect(get_attr(tag, `key`)).toBe(`instanced_atom_group_key(atom_group,measure_mode)`)
    expect(
      source.match(/instanced_atom_group_key\(atom_group,\s*measure_mode\)/g),
    ).toHaveLength(2)
    // match up to the closing brace at the function's own indent (group 1), so the
    // pattern tolerates reindentation and skips deeper-nested braces (e.g. template literals)
    const key_fn =
      /\n(?<indent> *)function instanced_atom_group_key\([\s\S]*?\n\k<indent>\}/.exec(
        source,
      )?.[0]
    if (!key_fn) throw new Error(`instanced_atom_group_key function not found`)
    for (const token of [`format_num(radius, \`.3~\`)`, `edit_mode_image`, `atoms.length`]) {
      expect(key_fn).toContain(token)
    }
    expect(source).toContain(`limit={atoms.length}`)
  })
})
