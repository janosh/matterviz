// Render records for the instanced atom meshes: which atoms draw, with what radius and color,
// split into the visual classes that each get their own mesh. Kept out of StructureScene so
// the per-frame reuse path (coordinate-only trajectory frames) is testable without a canvas.
import { same_position, type Vec3 } from '#lib/math.js'
import type { AnyStructure, Site } from '#lib/structure/index.js'
import type { AtomColorField } from './atom-color-field'
import type { AtomPropertyColors } from './atom-properties'
import { update_atom_coordinates, update_ordered_atom_positions } from './atom-instances'
import { site_base_radius } from './camera-fit'
import type { PartialAtom } from './partial-atoms'
import {
  compute_slice_geometry,
  merge_species_by_element,
  type RenderSite,
} from './partial-occupancy'
import { numeric_sites, snapshot_topologies } from './site'

// One record per wedge; an ordered atom is a single full-turn wedge
export type RenderAtom = PartialAtom & { species: Site[`species`] }
export type AtomGroups = {
  first_by_site: Map<number, RenderAtom>
  base: RenderAtom[]
  image: RenderAtom[]
  partial: RenderAtom[]
}
export type SiteAnchor = Pick<RenderAtom, `site_idx` | `position` | `radius`>

const empty_atom_groups = (): AtomGroups => ({
  first_by_site: new Map(),
  base: [],
  image: [],
  partial: [],
})

export const site_anchor = ({ site_idx, position, radius }: RenderAtom): SiteAnchor => ({
  site_idx,
  position,
  radius,
})

// The hovered atom's tooltip wears its fill when the drawn atom shows one color: a property
// color, or one visible element (merged across oxidation states and split partial sites,
// full or partial occupancy). Element wedges and color fields keep the neutral chip (null).
export function tooltip_fill(
  atom: RenderAtom | undefined,
  color_field: AtomColorField | undefined,
  property_colors: AtomPropertyColors | null,
  hidden_elements: ReadonlySet<string>,
): string | null | undefined {
  if (!atom || color_field) return null
  if (property_colors?.colors[atom.site_idx]) return atom.color
  const visible = merge_species_by_element(atom.species).filter(
    ({ element }) => !hidden_elements.has(element),
  )
  return visible.length === 1 ? atom.color : null
}

export type AtomGroupInput = {
  structure: AnyStructure | undefined
  // Lazy: the reuse path never needs the merged sites, and reading them would rebuild the
  // partial-site merge on every trajectory frame
  render_sites: () => readonly RenderSite[]
  palette: Record<string, string>
  property_colors: AtomPropertyColors | null
  hidden_prop_vals: ReadonlySet<number | string>
  hidden_elements: ReadonlySet<string>
  // Phase-2 PBC images exist only to complete bonds/coordination polyhedra at cell faces: the
  // ones ending a drawn bond or cornering a drawn polyhedron, the rest are skipped
  drawn_completion_sites: ReadonlySet<number>
  radius_scale: number
  radius_options: Parameters<typeof site_base_radius>[2]
  hidden_centers: ReadonlySet<number> | null // polyhedron centers to hide
  cutaway_sites: ReadonlyMap<number, Vec3[]> | undefined // whole-atom cutaway positions
  appearance: string // serialized palette + radius settings; a change rebuilds every record
}

// Builds render groups and site anchors together. Frames with the same ordered atoms reuse
// records and lookup; fresh base arrays still invalidate child instance buffers.
export class AtomGroupBuilder {
  #previous:
    | { appearance: string; groups: AtomGroups; colored: boolean; topology?: object }
    | undefined

  reset(): AtomGroups {
    this.#previous = undefined
    return empty_atom_groups()
  }

  build(input: AtomGroupInput): AtomGroups {
    // Hoist everything constant across sites: this loop runs >10k times for a 3x3x3
    // supercell, and the collections below live on a $state object or are SvelteMap/
    // SvelteSet, whose get/has allocate a signal per key.
    const { structure, appearance, property_colors, palette, cutaway_sites } = input
    const { hidden_prop_vals, hidden_elements, drawn_completion_sites } = input
    const { radius_scale, radius_options, hidden_centers } = input
    const { values: prop_values, colors: prop_colors } = property_colors ?? {}
    const filter_prop_vals = hidden_prop_vals.size > 0
    const filter_elements = hidden_elements.size > 0
    const reusable =
      !filter_prop_vals && !filter_elements && !hidden_centers?.size && !cutaway_sites
    const previous = this.#previous
    if (reusable && previous?.appearance === appearance && structure) {
      const columns = numeric_sites.get(structure)
      const topology = snapshot_topologies.get(structure)
      const { base } = previous.groups
      // Row identity permits coordinate reuse only for complete, original-atom groups.
      // Generated copies carry provenance and use record-backed frames.
      const updated =
        columns && topology && topology === previous.topology && base.length === columns.length
          ? update_atom_coordinates(base, columns.coordinates, columns.stride)
          : update_ordered_atom_positions(base, structure.sites)
      if (updated) {
        previous.topology = topology
        if (prop_colors || previous.colored) {
          for (const atom of updated) {
            atom.color = prop_colors?.[atom.site_idx] ?? palette[atom.element]
          }
          previous.colored = Boolean(prop_colors)
        }
        return (previous.groups = { ...previous.groups, base: updated })
      }
    }

    const groups = empty_atom_groups()
    for (const { site_idx, site, is_image_atom } of input.render_sites()) {
      if (cutaway_sites && !cutaway_sites.has(site_idx)) continue
      if (filter_prop_vals) {
        const prop_val = prop_values?.[site_idx]
        if (prop_val !== undefined && hidden_prop_vals.has(prop_val)) continue
      }
      if (hidden_centers?.has(site_idx)) continue // centers hidden inside their polyhedra
      // A completion image no drawn bond or polyhedron ends at would float outside the cell
      if (site.provenance?.completion && !drawn_completion_sites.has(site_idx)) continue

      // All radii scale uniformly with atom_radius for consistent slider behavior
      const radius = site_base_radius(site, site_idx, radius_options) * radius_scale
      // A property color (coordination number, Wyckoff position, ...) paints the whole site;
      // otherwise each species gets its own element color (disordered sites)
      const site_property_color = prop_colors?.[site_idx]
      const visible_species = filter_elements
        ? site.species.filter(({ element }) => !hidden_elements.has(element))
        : site.species
      for (const position of cutaway_sites?.get(site_idx) ?? [site.xyz]) {
        for (const slice_data of compute_slice_geometry(visible_species)) {
          const atom = {
            ...slice_data,
            site_idx,
            species: site.species,
            position: [...position] as Vec3,
            radius,
            color: site_property_color ?? palette[slice_data.element],
            is_image_atom: is_image_atom || !same_position(position, site.xyz),
          }
          // Wedges share one anchor per site; image atoms need a separate ghosted mesh.
          if (!groups.first_by_site.has(site_idx)) groups.first_by_site.set(site_idx, atom)
          if (atom.occupancy < 1) groups.partial.push(atom)
          else (atom.is_image_atom ? groups.image : groups.base).push(atom)
        }
      }
    }
    this.#previous =
      reusable && groups.image.length === 0 && groups.partial.length === 0
        ? {
            appearance,
            groups,
            colored: Boolean(prop_colors),
            topology: structure && snapshot_topologies.get(structure),
          }
        : undefined
    return groups
  }
}
