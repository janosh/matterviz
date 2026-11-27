// The shape as plain meshes for STL/GLB export (export_scene_as): one per family in its
// color, closed and wound outward, without edges or axes, scaled to a unit sphere's volume
import { polyhedron_geometry } from '#lib/brillouin/geometry'
import { Group, Mesh, MeshStandardMaterial } from 'three/webgpu'
import { family_label } from './format'
import type { WulffShapeData } from './types'

export const wulff_model = (
  { vertices, facets, families }: WulffShapeData,
  colors: string[],
): Group => {
  const model = Object.assign(new Group(), { name: `Wulff shape` })
  for (const [family_idx, { miller }] of families.entries()) {
    const faces = facets.flatMap((facet) =>
      facet.family_idx === family_idx ? [facet.vertex_indices] : [],
    )
    const geometry = polyhedron_geometry(vertices, faces)
    if (!geometry) continue // absent family
    const material = new MeshStandardMaterial({ color: colors[family_idx] })
    model.add(Object.assign(new Mesh(geometry, material), { name: family_label(miller) }))
  }
  return model
}
