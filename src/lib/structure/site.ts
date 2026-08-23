// Shared single-species Site construction used by all structure/trajectory/volumetric parsers,
// plus the site-provenance reads every consumer of supercell/image-atom copies shares
import type { ElementSymbol } from '$lib/element'
import type { Vec3 } from '$lib/math'
import type { Site } from '$lib/structure'

export const make_site = (
  element: ElementSymbol,
  abc: Vec3,
  xyz: Vec3,
  label: string,
  properties: Record<string, unknown> = {},
  occu = 1,
): Site => ({ species: [{ element, occu, oxidation_state: 0 }], abc, xyz, label, properties })

// PBC image copies carry the index of the site they mirror; every other site is an original
export const is_image_site = (site: Site | undefined): boolean =>
  typeof site?.properties?.orig_site_idx === `number`

// Index of the unit-cell site a displayed site descends from: make_supercell stamps
// `orig_unit_cell_idx` (into the cell it tiled), get_pbc_image_sites stamps `orig_site_idx`
// (into the structure it imaged, inheriting any `orig_unit_cell_idx`). Sites with neither are
// their own ancestor.
export const get_orig_site_idx = (site: Site | undefined, site_idx: number): number =>
  typeof site?.properties?.orig_unit_cell_idx === `number`
    ? site.properties.orig_unit_cell_idx
    : typeof site?.properties?.orig_site_idx === `number`
      ? site.properties.orig_site_idx
      : site_idx
