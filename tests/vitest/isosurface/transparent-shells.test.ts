import { sync_shell_colors, transparent_shells } from '#lib/isosurface/transparent-shells'
import { BufferAttribute, BufferGeometry } from 'three/webgpu'
import { expect, test, vi } from 'vitest'

test(`disjoint lobes have independent sort centers and retain oriented triangles and colors`, () => {
  const surface = new BufferGeometry()
  surface.setAttribute(
    `position`,
    new BufferAttribute(
      new Float32Array([0, 0, 8, 1, 0, 8, 0, 1, 8, 1, 1, 8, 0, 0, -3, 1, 0, -3, 0, 1, -3]),
      3,
    ),
  )
  surface.setIndex([0, 1, 2, 4, 6, 5, 2, 1, 3])
  const shells = transparent_shells(surface)
  expect(transparent_shells(surface)).toBe(shells)
  expect(shells.map((g) => g.boundingSphere?.center.z)).toEqual([8, -3])
  expect(shells.map((g) => Array.from(g.index?.array ?? []))).toEqual([
    [0, 1, 2, 2, 1, 3],
    [4, 6, 5],
  ])
  const colors = new BufferAttribute(new Float32Array(21), 3)
  surface.setAttribute(`color`, colors)
  sync_shell_colors(surface)
  for (const shell of shells) {
    expect(shell.getAttribute(`position`)).toBe(surface.getAttribute(`position`))
    expect(shell.getAttribute(`color`)).toBe(colors)
  }
  surface.deleteAttribute(`color`)
  sync_shell_colors(surface)
  const disposed = vi.fn()
  for (const shell of shells) {
    expect(shell.hasAttribute(`color`)).toBe(false)
    shell.addEventListener(`dispose`, disposed)
  }
  surface.dispose()
  expect(disposed).toHaveBeenCalledTimes(2)
})

test(`a connected shell uses the original geometry`, () => {
  const surface = new BufferGeometry()
  surface.setAttribute(`position`, new BufferAttribute(new Float32Array(9), 3))
  surface.setIndex([0, 1, 2])
  expect(transparent_shells(surface)[0]).toBe(surface)
  surface.dispose()
})
