// Split an oriented bulk cell into atomic layers and turn the gaps between them into the
// distinct ways the crystal can be cleaved.
import { get_electro_neg_formula } from '$lib/composition/format'
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { Crystal, Site } from '$lib/structure'
import { wrap_to_unit_cell } from '$lib/structure/pbc'
import type { OrientedBulkOptions } from './lattice-basis'
import { make_oriented_bulk } from './lattice-basis'
import {
  find_lattice_translations,
  image_distance,
  site_grid_of,
  species_keys_of,
} from './translations'
import type { OrientedBulk, SlabLayer, SlabTermination } from './types'
import { SLAB_LAYER_TOLERANCE, SLAB_POSITION_TOLERANCE } from './types'

// Sites of an oriented bulk cell grouped by height along the surface normal. In-plane
// vectors are perpendicular to the normal by construction, so the height of a site is
// just its fractional c times the cell height — no projection needed.
// Layers are listed bottom-up starting from the widest gap in the cell, which makes the
// wrap-around gap the widest one too and keeps a layer straddling c = 0 in one piece.
export function detect_layers(
  bulk: OrientedBulk,
  layer_tolerance = SLAB_LAYER_TOLERANCE,
): SlabLayer[] {
  const { sites, lattice } = bulk.crystal
  const height_c = math.cell_heights(lattice.matrix)[2]
  const order = sites
    .map((site, idx) => ({ idx, frac_c: site.abc[2] }))
    .toSorted((left, right) => left.frac_c - right.frac_c)

  // Cyclic gaps; gap[idx] sits below order[idx], so gap[0] wraps around c = 0
  const gaps = order.map((entry, idx) => {
    const below = idx === 0 ? order[order.length - 1].frac_c - 1 : order[idx - 1].frac_c
    return (entry.frac_c - below) * height_c
  })
  const widest = gaps.indexOf(Math.max(...gaps))

  // Group site indices by height, then describe each group
  const groups: { site_idxs: number[]; height: number; pos: number }[] = []
  for (let step = 0; step < order.length; step++) {
    const pos = (widest + step) % order.length
    // unwrap so heights increase monotonically from the first layer
    const offset = pos < widest ? 1 : 0
    const height = (order[pos].frac_c + offset - order[widest].frac_c) * height_c
    // Measured against the layer's lowest site, not the site just below: comparing
    // neighbours lets a run of sub-tolerance steps chain into a layer of any thickness,
    // while this bounds every layer by layer_tolerance the way SlabLayer promises.
    const last = groups[groups.length - 1]
    if (last && height - last.height <= layer_tolerance) last.site_idxs.push(order[pos].idx)
    else groups.push({ site_idxs: [order[pos].idx], height, pos })
  }
  return groups.map(({ site_idxs, height, pos }) => ({
    site_idxs,
    height,
    frac_c_start: order[pos].frac_c,
    // A single layer wraps onto itself, so its gap is the full cell height
    gap_below: groups.length === 1 ? height_c : gaps[pos],
    formula: get_electro_neg_formula(
      { sites: site_idxs.map((idx) => sites[idx]) },
      { plain_text: true, delim: `` },
    ),
  }))
}

// Gaps between consecutive layers going up from `start_layer_idx`, Å, wrapping round to
// the start layer of the next c repeat. They sum to d_hkl exactly. Cleaving at a layer
// rotates the stack, so a slab's own spacings are this list started at its cleaved layer.
export const layer_spacings = (
  layers: SlabLayer[],
  d_hkl: number,
  start_layer_idx: number,
): number[] =>
  layers.map((_layer, step) => {
    const idx = (start_layer_idx + step) % layers.length
    const top = idx + 1 < layers.length ? layers[idx + 1].height : d_hkl
    return top - layers[idx].height
  })

// The sites' images under every point operation that keeps the surface normal pointing
// up and maps the oriented lattice onto itself: rotations about the normal and mirrors
// through planes containing it. Composed with a translation these are what map e.g. the
// A and B basal layers of hcp onto each other. Such an operation permutes the in-plane
// lattice vectors, so it is an integer 2x2 matrix on (a, b) that preserves their lengths
// and angle; a and b are Gauss-reduced, which confines the entries to -1, 0, 1. It must
// also send c to a lattice vector, otherwise no translation can complete it into a
// symmetry of the crystal. The identity is left out: pure translations are searched
// separately.
function normal_preserving_images(bulk: OrientedBulk): Site[][] {
  const { matrix } = bulk.crystal.lattice
  const [vec_a, vec_b, vec_c] = matrix
  const { normal } = bulk
  const cart_to_frac = math.create_cart_to_frac(matrix)
  const frac_to_cart = math.create_frac_to_cart(matrix)
  // coordinates in the (a, b, normal) frame; the operation acts on them as (M, 1)
  const to_frame = math.create_cart_to_frac([vec_a, vec_b, normal])
  const [len_a, len_b] = [Math.hypot(...vec_a), Math.hypot(...vec_b)]
  const dot_ab = math.dot(vec_a, vec_b)
  // Isometric to within the position tolerance: lengths directly, the dot product via
  // d(a·b) <= |a| d|b| + |b| d|a|. Real structure files are symmetric only to the
  // precision they were written with.
  const tol = SLAB_POSITION_TOLERANCE
  const same_length = (vec: Vec3, len: number) => Math.abs(Math.hypot(...vec) - len) <= tol

  const images: Site[][] = []
  const coeffs = [-1, 0, 1]
  for (const m_aa of coeffs) {
    for (const m_ab of coeffs) {
      for (const m_ba of coeffs) {
        for (const m_bb of coeffs) {
          if (m_aa === 1 && m_bb === 1 && m_ab === 0 && m_ba === 0) continue
          if (Math.abs(m_aa * m_bb - m_ab * m_ba) !== 1) continue
          const image_a = math.add(math.scale(vec_a, m_aa), math.scale(vec_b, m_ab))
          const image_b = math.add(math.scale(vec_a, m_ba), math.scale(vec_b, m_bb))
          if (!same_length(image_a, len_a) || !same_length(image_b, len_b)) continue
          if (Math.abs(math.dot(image_a, image_b) - dot_ab) > tol * (len_a + len_b)) continue
          const from_frame = math.create_frac_to_cart([image_a, image_b, normal])
          const apply = (vec: Vec3): Vec3 => from_frame(to_frame(vec))
          const image_c = cart_to_frac(apply(vec_c))
          const nearest_lattice_vec = image_c.map(Math.round) as Vec3
          if (image_distance(image_c, nearest_lattice_vec, frac_to_cart) > tol) continue
          images.push(
            bulk.crystal.sites.map((site) => ({
              ...site,
              abc: wrap_to_unit_cell(cart_to_frac(apply(site.xyz))),
            })),
          )
        }
      }
    }
  }
  return images
}

// Cyclic layer shifts realized by a symmetry of the oriented bulk that keeps the normal
// pointing up: a lattice translation, or a normal-preserving point operation followed by
// one. Layer idx and layer idx + shift then expose the same surface, so only one of them
// is a distinct termination.
function equivalent_layer_shifts(bulk: OrientedBulk, layers: SlabLayer[]): number[] {
  if (layers.length < 2) return []
  const { sites, lattice } = bulk.crystal
  const keys = species_keys_of(sites)
  const grid = site_grid_of(sites, keys, lattice.matrix)
  const layer_of_site: number[] = Array(sites.length).fill(-1)
  for (const [layer_idx, layer] of layers.entries()) {
    for (const site_idx of layer.site_idxs) layer_of_site[site_idx] = layer_idx
  }

  const anchor_idx = layers[0].site_idxs[0]
  const shifts: number[] = []
  for (const images of [sites, ...normal_preserving_images(bulk)]) {
    const translations = find_lattice_translations(sites, lattice.matrix, { images })
    for (const translation of translations) {
      const target = math.add(images[anchor_idx].abc, translation)
      const image_idx = grid.find(target, keys[anchor_idx])
      if (image_idx < 0) {
        throw new Error(
          `Symmetry translation ${JSON.stringify(translation)} maps site ${anchor_idx} to ` +
            `${JSON.stringify(target)}, where no matching site was found`,
        )
      }
      const shift = layer_of_site[image_idx]
      if (shift > 0 && !shifts.includes(shift)) shifts.push(shift)
    }
  }
  return shifts
}

export type SlabTerminationOptions = OrientedBulkOptions & { layer_tolerance?: number }

// Distinct terminations of an already oriented bulk cell: one per layer, minus the ones a
// normal-preserving symmetry maps onto an earlier layer.
export function terminations_of_oriented_bulk(
  bulk: OrientedBulk,
  layers: SlabLayer[],
): SlabTermination[] {
  const shifts = equivalent_layer_shifts(bulk, layers)
  const terminations: SlabTermination[] = []
  const claimed = new Set<number>()
  for (const [layer_idx, layer] of layers.entries()) {
    if (claimed.has(layer_idx)) continue
    const equivalent_layer_idxs = shifts
      .map((shift) => (layer_idx + shift) % layers.length)
      .filter((idx) => !claimed.has(idx))
      .toSorted((left, right) => left - right)
    for (const idx of equivalent_layer_idxs) claimed.add(idx)
    terminations.push({
      layer_idx,
      formula: layer.formula,
      gap: layer.gap_below,
      equivalent_layer_idxs,
    })
  }
  return terminations
}

// Distinct terminations for an (hkl) surface of a bulk crystal, in the order make_slab's
// `termination_idx` expects.
export function enumerate_terminations(
  crystal: Crystal,
  miller_indices: Vec3,
  options: SlabTerminationOptions = {},
): SlabTermination[] {
  const bulk = make_oriented_bulk(crystal, miller_indices, options)
  return terminations_of_oriented_bulk(bulk, detect_layers(bulk, options.layer_tolerance))
}
