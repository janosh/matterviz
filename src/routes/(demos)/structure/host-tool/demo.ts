import { make_volume } from '$lib/isosurface/types'
import { trajectory_from_frames } from '$lib/trajectory/runs/memory'
import type { AnyStructure } from '$lib/structure'
import { create_frac_to_cart, type Vec3 } from '$lib/math'

export function make_demo_trajectory(structure: AnyStructure) {
  if (!(`lattice` in structure)) throw new Error(`The demo requires a crystal`)
  const to_cart = create_frac_to_cart(structure.lattice.matrix)
  return trajectory_from_frames(
    Array.from({ length: 6 }, (_, frame_idx) => ({
      step: frame_idx,
      structure: {
        ...structure,
        sites: structure.sites.map((site) => {
          const abc: Vec3 = [site.abc[0] + frame_idx * 0.015, site.abc[1], site.abc[2]]
          return { ...site, abc, xyz: to_cart(abc) }
        }),
      },
    })),
  )
}

export function predict_demo(structure: AnyStructure) {
  const lattice = `lattice` in structure ? structure.lattice.matrix : undefined
  if (!lattice) throw new Error(`The demo requires a crystal`)
  const values = Float64Array.from({ length: 12 ** 3 }, (_, idx) => {
    const x_idx = Math.floor(idx / 144)
    const y_idx = Math.floor(idx / 12) % 12
    const z_idx = idx % 12
    return Math.exp(-((x_idx - 6) ** 2 + (y_idx - 6) ** 2 + (z_idx - 6) ** 2) / 10)
  })
  return {
    site_properties: structure.sites.map((_, idx) => ({
      charge: idx % 2 ? -0.4 : 0.4,
      dipole: [0.4, 0.2, 0.1],
    })),
    color_property: `charge`,
    volumes: [
      {
        ...make_volume(values, [12, 12, 12], {
          id: `density`,
          lattice,
          origin: [0, 0, 0],
          periodic: false,
          label: `Predicted density`,
        }),
        id: `density`,
      },
    ],
  }
}
