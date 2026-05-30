import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const instanced_mesh_tag_re = /<extras\.InstancedMesh\b[^>]*>/gs

function get_instanced_mesh_tags(file_path: string): string[] {
  const source = readFileSync(file_path, `utf8`)
  return [...source.matchAll(instanced_mesh_tag_re)].map((match) => match[0])
}

function get_prop_expr(tag: string, prop: `limit` | `range`): string {
  const match = new RegExp(`\\b${prop}\\s*=\\s*\\{\\s*([^}]+?)\\s*\\}`).exec(tag)
  if (!match) throw new Error(`InstancedMesh tag is missing ${prop}: ${tag}`)
  return match[1].trim().replace(/\s+/g, ``)
}

function get_key_attr(tag: string): string {
  const match = /\bkey\s*=\s*(?:"([^"]+)"|\{\s*([^}]+?)\s*\})/.exec(tag)
  if (!match) throw new Error(`InstancedMesh tag is missing key: ${tag}`)
  return (match[1] ?? match[2]).replace(/\s+/g, ``)
}

describe(`InstancedMesh limits`, () => {
  it.each([
    { file_path: `src/lib/structure/StructureScene.svelte`, expected_tags: 1 },
    { file_path: `src/lib/plot/ScatterPlot3DScene.svelte`, expected_tags: 2 },
  ])(`sets limit equal to range in $file_path`, ({ file_path, expected_tags }) => {
    const tags = get_instanced_mesh_tags(file_path)
    expect(tags).toHaveLength(expected_tags)

    for (const tag of tags) {
      expect(get_prop_expr(tag, `limit`)).toBe(get_prop_expr(tag, `range`))
    }
  })

  it(`keys StructureScene atom mesh with shared group identity`, () => {
    const source = readFileSync(`src/lib/structure/StructureScene.svelte`, `utf8`)
    const [tag] = get_instanced_mesh_tags(`src/lib/structure/StructureScene.svelte`)
    if (!tag) throw new Error(`StructureScene InstancedMesh tag not found`)

    expect(get_key_attr(tag)).toBe(`instanced_atom_group_key(atom_group,measure_mode)`)
    expect(
      source.match(/instanced_atom_group_key\(atom_group,\s*measure_mode\)/g),
    ).toHaveLength(2)
    expect(source).toMatch(/format_num\(radius, `\.3~`\)[^]*edit_mode_image[^]*atoms\.length/)
    expect(source).toContain(`limit={atoms.length}`)
  })
})
