import { make_volume } from '#lib/isosurface/types.js'
import { trajectory_from_frames } from '#lib/trajectory/runs/memory.js'
import type { AnyStructure } from '#lib/structure/index.js'
import { create_frac_to_cart, type Vec3 } from '#lib/math.js'

const DEMO_FRAMES = 6

// Sites of a demo relaxation frame: atoms drift along a.
function demo_frame_sites(structure: AnyStructure, frame_idx: number) {
  if (!(`lattice` in structure)) throw new Error(`The demo requires a crystal`)
  const to_cart = create_frac_to_cart(structure.lattice.matrix)
  return structure.sites.map((site) => {
    const abc: Vec3 = [site.abc[0] + frame_idx * 0.015, site.abc[1], site.abc[2]]
    return { ...site, abc, xyz: to_cart(abc) }
  })
}

export const make_demo_trajectory = (structure: AnyStructure) =>
  trajectory_from_frames(
    Array.from({ length: DEMO_FRAMES }, (_, frame_idx) => ({
      step: frame_idx,
      structure: { ...structure, sites: demo_frame_sites(structure, frame_idx) },
    })),
  )

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
    // The relaxed geometry: the trajectory's last frame, drawn in the main viewer.
    geometry: {
      positions: demo_frame_sites(structure, DEMO_FRAMES - 1).map(({ xyz }) => xyz),
    },
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
