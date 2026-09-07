import { trajectory_from_frames } from '$lib/trajectory'
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
