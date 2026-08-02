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
    { file_path: `src/lib/plot/scatter-3d/ScatterPlot3DScene.svelte`, expected_tags: 2 },
  ])(`sets limit equal to range in $file_path`, ({ file_path, expected_tags }) => {
    const tags = get_tags(readFileSync(file_path, `utf8`))
    expect(tags).toHaveLength(expected_tags)

    for (const tag of tags) {
      expect(get_attr(tag, `limit`)).toBe(get_attr(tag, `range`))
    }
  })

  it(`renders StructureScene atoms via direct InstancedAtoms meshes, not per-atom Instance components`, () => {
    const source = readFileSync(`src/lib/structure/StructureScene.svelte`, `utf8`)
    // Per-atom <extras.Instance> components caused multi-second mount storms on
    // supercells; atoms must render through the imperative InstancedAtoms wrapper
    expect(get_tags(source)).toHaveLength(0)
    expect(source).not.toContain(`extras.Instance`)
    expect(source.match(/<InstancedAtoms\b/g)).toHaveLength(2)
    // arrows are instanced too (2 draw calls per layer): one call site for per-site
    // vectors (forces, magmoms), one for the displacement-vs-reference overlay
    expect(source.match(/<ArrowInstances\b/g)).toHaveLength(2)
  })

  it(`keeps scrub deferral wired through geometry and replacement-mesh colors`, () => {
    const scene_source = readFileSync(`src/lib/structure/StructureScene.svelte`, `utf8`)
    const atoms_source = readFileSync(`src/lib/structure/InstancedAtoms.svelte`, `utf8`)

    expect(scene_source).toContain(`if (dragging_atoms || defer_expensive_geometry)`)
    expect(scene_source).toContain(`if (defer_expensive_geometry) return last_polyhedra`)
    expect(scene_source.match(/positions_only=\{defer_expensive_geometry\}/g)).toHaveLength(2)
    expect(atoms_source).toContain(`positions_only && current === colored_mesh`)
    expect(atoms_source.indexOf(`colored_mesh = current`)).toBeGreaterThan(
      atoms_source.indexOf(`current.setColorAt`),
    )
  })
})
