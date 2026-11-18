import { Box3, BufferAttribute, BufferGeometry, Sphere, Vector3 } from 'three/webgpu'

const shells_by_surface = new WeakMap<BufferGeometry, BufferGeometry[]>()

// A signed orbital packs disconnected lobes of one color in a single indexed mesh.
// A separate bound per connected shell lets the renderer depth-sort them across colors.
export function transparent_shells(surface: BufferGeometry): BufferGeometry[] {
  const cached = shells_by_surface.get(surface)
  if (cached) return cached
  const index = surface.index
  if (!index) return [surface]
  const position = surface.getAttribute(`position`)
  const parent = Uint32Array.from({ length: position.count }, (_, i) => i)
  const root = (vertex: number): number => {
    while (parent[vertex] !== vertex) {
      parent[vertex] = parent[parent[vertex]]
      vertex = parent[vertex]
    }
    return vertex
  }
  const indices = index.array
  for (let i = 0; i < indices.length; i += 3) {
    const a = root(indices[i])
    parent[root(indices[i + 1])] = a
    parent[root(indices[i + 2])] = a
  }
  const groups = new Map<number, number[]>()
  for (let i = 0; i < indices.length; i += 3) {
    const id = root(indices[i])
    let group = groups.get(id)
    if (!group) groups.set(id, (group = []))
    group.push(indices[i], indices[i + 1], indices[i + 2])
  }
  const point = new Vector3()
  const shells =
    groups.size <= 1
      ? [surface]
      : Array.from(groups.values(), (triangles) => {
          const shell = new BufferGeometry()
          for (const [name, attribute] of Object.entries(surface.attributes))
            shell.setAttribute(name, attribute)
          shell.setIndex(new BufferAttribute(new Uint32Array(triangles), 1))
          shell.boundingBox = new Box3()
          for (const vertex of triangles)
            shell.boundingBox.expandByPoint(point.fromBufferAttribute(position, vertex))
          shell.boundingSphere = shell.boundingBox.getBoundingSphere(new Sphere())
          return shell
        })
  shells_by_surface.set(surface, shells)
  const dispose = () => {
    surface.removeEventListener(`dispose`, dispose)
    shells_by_surface.delete(surface)
    for (const shell of shells) if (shell !== surface) shell.dispose()
  }
  surface.addEventListener(`dispose`, dispose)
  return shells
}

// Recoloring normally updates the shared attribute in place. The first mapping
// and removing a mapping also have to attach/detach it on existing draw meshes.
export function sync_shell_colors(surface: BufferGeometry): void {
  const color = surface.getAttribute(`color`)
  for (const shell of shells_by_surface.get(surface) ?? []) {
    if (shell === surface) continue
    if (color) shell.setAttribute(`color`, color)
    else shell.deleteAttribute(`color`)
  }
}
