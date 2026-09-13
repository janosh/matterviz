import type { Vec3 } from '$lib/math'
import type { BondPair } from '$lib/structure'
import type { AtomPropertyColors } from '$lib/structure/atom-properties'
import { AtomInstances } from '$lib/structure/atom-instances'
import { make_site } from '$lib/structure/site'
import StructureScene from '$lib/structure/StructureScene.svelte'
import ArrowInstances from '$lib/structure/ArrowInstances.svelte'
import Bond from '$lib/structure/Bond.svelte'
import InstancedAtoms from '$lib/structure/InstancedAtoms.svelte'
import { mount_scene } from '../scene/mount'
import { flushSync } from 'svelte'
import { InstancedMesh } from 'three/webgpu'
import { expect, onTestFinished, test, vi } from 'vitest'

test(`property-colored Scene frames refresh reused atoms and restore element colors`, async () => {
  const sites = [
    make_site(`C`, [0, 0, 0], [0, 0, 0], `C`),
    make_site(`O`, [0, 0, 0], [2, 0, 0], `O`),
    make_site(`H`, [0, 0, 0], [3, 0, 0], `H`),
  ]
  let structure = $state.raw({ sites })
  let property_colors = $state.raw<AtomPropertyColors | null>(null)
  const { scene, unmount_scene } = mount_scene((anchor) =>
    StructureScene(anchor, {
      get structure() {
        return structure
      },
      get property_colors() {
        return property_colors
      },
      show_bonds: `never`,
      show_polyhedra: `never`,
      gizmo: false,
      interactive: false,
    }),
  )
  try {
    flushSync()
    const atom_meshes: AtomInstances[] = []
    scene.traverse((object) => {
      if (object instanceof AtomInstances) atom_meshes.push(object)
    })
    const [atoms] = atom_meshes
    if (!atoms?.instanceColor) throw new Error(`Expected an instanced atom mesh`)
    const element_colors = atoms.instanceColor.array.slice()
    property_colors = { colors: [`red`, `blue`, `green`], values: [0, 1, 2] }
    flushSync()
    for (const frame_idx of [1, 2]) {
      structure = {
        sites: sites.map((site) => ({ ...site, xyz: [site.xyz[0], frame_idx, 0] as Vec3 })),
      }
      // The missing property color must use the element palette, even after a colored frame.
      property_colors = {
        colors: frame_idx === 1 ? [`blue`, `red`] : [`red`, `blue`],
        values: [0, 1, 2],
      }
      flushSync()
      expect(Array.from(atoms.instanceColor.array.slice(0, 6))).toEqual(
        frame_idx === 1 ? [0, 0, 1, 1, 0, 0] : [1, 0, 0, 0, 0, 1],
      )
      expect(atoms.instanceColor.array.slice(6, 9)).toEqual(element_colors.slice(6, 9))
      for (let site_idx = 0; site_idx < sites.length; site_idx++) {
        expect(atoms.instanceMatrix.array[site_idx * 16 + 13]).toBe(frame_idx)
      }
    }
    property_colors = null
    flushSync()
    expect(atoms.instanceColor.array).toEqual(element_colors)
    property_colors = { colors: [`red`], values: [0, 1, 2] }
    flushSync()
    // JavaScript callers can supply a property-color record without its color array.
    property_colors = { values: [0, 1, 2] } as AtomPropertyColors
    flushSync()
    expect(atoms.instanceColor.array).toEqual(element_colors)
  } finally {
    await unmount_scene()
  }
})

test.each([`atoms`, `arrows`, `bonds`] as const)(
  `%s releases retired meshes during growth and disposes each resource once`,
  async (kind) => {
    const inputs = $state({ count: 2, offset: 0 })
    const positions = $derived(
      Array.from({ length: inputs.count }, (_unused, idx): Vec3 => [idx, inputs.offset, 0]),
    )
    onTestFinished(() => {
      vi.restoreAllMocks()
    })
    const { scene, disposable_objects, unmount_scene } = mount_scene((anchor) => {
      if (kind === `atoms`)
        return InstancedAtoms(anchor, {
          get atoms() {
            return positions.map((position) => ({ position, radius: 0.5, color: `red` }))
          },
        })
      if (kind === `arrows`)
        return ArrowInstances(anchor, {
          get arrows() {
            return positions.map((position) => ({
              position,
              vector: [0, 1, 0] satisfies Vec3,
              scale: 1,
              color: `red`,
            }))
          },
          shaft_radius: 0.1,
          arrow_head_radius: 0.2,
          arrow_head_length: 0.3,
        })
      return Bond(anchor, {
        get bonds() {
          return positions.map((position): BondPair => ({
            pos_1: position,
            pos_2: [position[0], position[1] + 1, 0],
            site_idx_1: 0,
            site_idx_2: 1,
            bond_order: 1,
            bond_length: 1,
          }))
        },
        site_colors: [`red`, `blue`],
        thickness: 0.1,
        ambient_light: 0.7,
        directional_light: 0.3,
      })
    })
    const meshes = new Map<InstancedMesh, ReturnType<typeof vi.spyOn>>()
    const resources = new Map<{ dispose: () => void }, ReturnType<typeof vi.spyOn>>()
    let previous_active: InstancedMesh[] = []
    try {
      for (const count of [2, 3, 4, 5, 6, 2, 0, 2]) {
        inputs.count = count
        inputs.offset += 1
        flushSync()
        const active = scene.children.filter(
          (child): child is InstancedMesh => child instanceof InstancedMesh,
        )
        expect(active).toHaveLength(kind === `arrows` ? 2 : 1)
        if (kind === `arrows`) {
          expect(active[0].instanceColor).not.toBeNull()
          expect(active[0].instanceColor).toBe(active[1].instanceColor)
        }
        if (previous_active.length && count <= previous_active[0].instanceMatrix.count) {
          expect(active).toEqual(previous_active)
        }
        for (const mesh of active) {
          expect(mesh.count).toBe(count)
          if (kind === `arrows` && count === 4) expect(mesh.instanceMatrix.count).toBe(5)
          if (count > 0) {
            const center_offset =
              kind === `atoms`
                ? 0
                : kind === `bonds`
                  ? 0.5
                  : mesh.geometry.type === `ConeGeometry`
                    ? 1
                    : 0.425
            expect(mesh.instanceMatrix.array[13]).toBe(
              Math.fround(inputs.offset + center_offset),
            )
          }
          if (!meshes.has(mesh)) meshes.set(mesh, vi.spyOn(mesh, `dispose`))
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          for (const resource of [mesh.geometry, ...materials]) {
            if (!resources.has(resource))
              resources.set(resource, vi.spyOn(resource, `dispose`))
            expect(resources.get(resource)).not.toHaveBeenCalled()
          }
        }
        for (const [mesh, dispose] of meshes) {
          expect(dispose).toHaveBeenCalledTimes(active.includes(mesh) ? 0 : 1)
          // Threlte must not retain already-disposed matrices or dispose them a second time.
          if (!active.includes(mesh)) expect(disposable_objects.has(mesh)).toBe(false)
        }
        previous_active = active
      }
    } finally {
      await unmount_scene()
    }
    for (const dispose of [...meshes.values(), ...resources.values()]) {
      expect(dispose).toHaveBeenCalledTimes(1)
    }
  },
)
