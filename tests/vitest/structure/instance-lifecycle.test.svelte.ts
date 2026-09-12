import type { Vec3 } from '$lib/math'
import type { BondPair } from '$lib/structure'
import ArrowInstances from '$lib/structure/ArrowInstances.svelte'
import Bond from '$lib/structure/Bond.svelte'
import InstancedAtoms from '$lib/structure/InstancedAtoms.svelte'
import { mount_scene } from '../scene/mount'
import { flushSync } from 'svelte'
import { InstancedMesh } from 'three/webgpu'
import { expect, onTestFinished, test, vi } from 'vitest'

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
    try {
      for (const count of [2, 3, 6, 2, 0, 2]) {
        inputs.count = count
        inputs.offset += 1
        flushSync()
        const active = scene.children.filter(
          (child): child is InstancedMesh => child instanceof InstancedMesh,
        )
        expect(active).toHaveLength(kind === `arrows` ? 2 : 1)
        for (const mesh of active) {
          expect(mesh.count).toBe(count)
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
      }
    } finally {
      await unmount_scene()
    }
    for (const dispose of [...meshes.values(), ...resources.values()]) {
      expect(dispose).toHaveBeenCalledTimes(1)
    }
  },
)
