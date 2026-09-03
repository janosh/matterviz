// Search a periodic site set for the fractional translations that map it onto itself.
// Used to shrink a surface cell to its primitive in-plane form and to spot terminations
// that are related by a lattice translation and therefore not distinct surfaces.
import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { Site } from '$lib/structure'
import { wrap_to_unit_cell } from '$lib/structure/pbc'
import { MAX_TRANSLATION_PROBES, SLAB_POSITION_TOLERANCE } from './types'

// Two sites are interchangeable when they carry the same species at the same
// occupancies. Sorted so the ordering inside a disordered site cannot change the key.
export const species_keys_of = (sites: Site[]): string[] =>
  sites.map((site) =>
    site.species
      .map(({ element, occu }) => `${element}:${occu}`)
      .toSorted()
      .join(`,`),
  )

// Fractional offset folded into [-0.5, 0.5): the nearest periodic image of a coordinate
// difference along one axis.
const centered_frac = (frac: number): number => frac - Math.round(frac)

// Cartesian distance between two fractional positions via the nearest periodic image on
// every axis. The positions compared here are meant to coincide, so the nearest image is
// the only one that can be within tolerance and no full minimum-image search is needed.
export const image_distance = (
  frac_1: Vec3,
  frac_2: Vec3,
  frac_to_cart: (frac: Vec3) => Vec3,
): number => {
  const diff: Vec3 = [
    centered_frac(frac_1[0] - frac_2[0]),
    centered_frac(frac_1[1] - frac_2[1]),
    centered_frac(frac_1[2] - frac_2[2]),
  ]
  return Math.hypot(...frac_to_cart(diff))
}

// Distinct bucket indices along one axis that can hold a position within tolerance of
// `bucket_idx`, the exact bucket first because that is where the hit almost always is.
// Below four buckets the ±1 neighbourhood wraps onto itself, so the whole axis is
// returned instead of looking the same bucket up several times.
const axis_neighbours = (bucket_idx: number, count: number): number[] =>
  count < 4
    ? Array.from({ length: count }, (_val, idx) => idx)
    : [bucket_idx, (bucket_idx + count - 1) % count, (bucket_idx + 1) % count]

// Periodic lookup of "is a site of this species already at this fractional position?"
// within SLAB_POSITION_TOLERANCE. A linear scan makes every caller quadratic in the site
// count; bucketing the positions so that a bucket is at least a tolerance wide turns each
// query into a look at 27 buckets, whatever the cell holds.
export type SiteGrid = {
  // Index registered for the site of `key` within tolerance of `abc`, or -1 if none
  find: (abc: Vec3, key: string) => number
  add: (abc: Vec3, key: string, idx: number) => void
}

// Pass `sites` and their `keys` to index a fixed site set up front; callers that build the
// set as they go start from an empty grid and add(...) to it instead.
export function make_site_grid(
  matrix: Matrix3x3,
  sites: Site[] = [],
  keys: string[] = [],
): SiteGrid {
  const tolerance = SLAB_POSITION_TOLERANCE
  const frac_to_cart = math.create_frac_to_cart(matrix)
  // Moving a Cartesian distance `tolerance` changes fractional coordinate i by at most
  // tolerance / height_i, because height_i is the cell's extent perpendicular to the
  // other two axes. Buckets that wide put coincident sites at most one bucket apart.
  const counts = math
    .cell_heights(matrix)
    .map((height) => Math.max(1, Math.floor(height / tolerance)))
  // Species outer, position inner: the inner key is arithmetic on three small integers, so
  // a query never has to build a string.
  const by_species = new Map<string, Map<number, { idx: number; abc: Vec3 }[]>>()
  // fractional coords are not always wrapped into [0, 1), so fold the bucket index
  const bucket_idxs = (abc: Vec3): number[] =>
    [0, 1, 2].map((axis) => {
      const raw = Math.floor(abc[axis] * counts[axis]) % counts[axis]
      return raw < 0 ? raw + counts[axis] : raw
    })
  const flat_idx = (bin_a: number, bin_b: number, bin_c: number): number =>
    (bin_a * counts[1] + bin_b) * counts[2] + bin_c

  const grid: SiteGrid = {
    add(abc, key, idx) {
      const [bin_a, bin_b, bin_c] = bucket_idxs(abc)
      let buckets = by_species.get(key)
      if (!buckets) by_species.set(key, (buckets = new Map()))
      const bucket_key = flat_idx(bin_a, bin_b, bin_c)
      const bucket = buckets.get(bucket_key)
      if (bucket) bucket.push({ idx, abc })
      else buckets.set(bucket_key, [{ idx, abc }])
    },
    find(abc, key) {
      const buckets = by_species.get(key)
      if (!buckets) return -1
      const [bin_a, bin_b, bin_c] = bucket_idxs(abc)
      for (const near_a of axis_neighbours(bin_a, counts[0])) {
        for (const near_b of axis_neighbours(bin_b, counts[1])) {
          for (const near_c of axis_neighbours(bin_c, counts[2])) {
            const bucket = buckets.get(flat_idx(near_a, near_b, near_c))
            if (!bucket) continue
            for (const entry of bucket) {
              if (image_distance(entry.abc, abc, frac_to_cart) <= tolerance) return entry.idx
            }
          }
        }
      }
      return -1
    },
  }
  for (const [idx, site] of sites.entries()) grid.add(site.abc, keys[idx], idx)
  return grid
}

export type TranslationSearchOptions = {
  // Keep only translations that leave every atom's height along c unchanged. Those are
  // the ones that survive cleaving, so only they may be used to shrink a surface cell.
  in_plane_only?: boolean
  // `sites` after a point operation (same order, same species). The search then returns
  // the translations that complete that operation into a symmetry of the site set, the
  // identity translation included. Defaults to `sites` itself, i.e. pure translations,
  // where the identity is skipped as trivial.
  images?: Site[]
}

// Every fractional translation that maps `images` onto `sites`, i.e. for which every
// image plus the translation coincides with a site of the same species. Pure translations
// form a finite group under addition mod 1, so their count plus one is the index of the
// given cell over the true primitive cell (restricted to the searched directions).
// Candidates come from the rarest species, because a translation must in particular map
// one of those sites onto another.
export function find_lattice_translations(
  sites: Site[],
  matrix: Matrix3x3,
  options: TranslationSearchOptions = {},
): Vec3[] {
  const { in_plane_only = false, images = sites } = options
  const pure_translations = images === sites
  if (sites.length < (pure_translations ? 2 : 1)) return []

  const keys = species_keys_of(sites)
  const counts = new Map<string, number>()
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1)
  let [rarest_key, rarest_count] = [keys[0], Infinity]
  for (const [key, count] of counts) {
    if (count < rarest_count) [rarest_key, rarest_count] = [key, count]
  }
  const target_idxs = keys.flatMap((key, idx) => (key === rarest_key ? [idx] : []))
  // Every candidate shift is checked against every image, so this product is the real cost
  const probes = target_idxs.length * images.length
  if (probes > MAX_TRANSLATION_PROBES) {
    throw new Error(
      `Lattice-translation search needs ${probes} probes (${target_idxs.length} shifts x ${images.length} sites), past the ${MAX_TRANSLATION_PROBES} limit. Reduce the cell to its primitive form first: a supercell has the same surfaces as the cell it repeats.`,
    )
  }
  const anchor = images[target_idxs[0]]

  const frac_to_cart = math.create_frac_to_cart(matrix)
  const height_c = math.cell_heights(matrix)[2]
  // The site set is the same for every candidate shift, so index it once
  const grid = make_site_grid(matrix, sites, keys)
  const is_identity = (shift: Vec3) =>
    image_distance(shift, [0, 0, 0], frac_to_cart) <= SLAB_POSITION_TOLERANCE

  const translations: Vec3[] = []
  for (const idx of target_idxs) {
    const shift = wrap_to_unit_cell(math.subtract(sites[idx].abc, anchor.abc))
    if (in_plane_only) {
      if (Math.abs(centered_frac(shift[2])) * height_c > SLAB_POSITION_TOLERANCE) continue
      shift[2] = 0
    }
    // dropping the c component of a purely vertical offset also leaves the identity
    if (pure_translations && is_identity(shift)) continue
    const maps_onto_sites = images.every(
      (image, image_idx) => grid.find(math.add(image.abc, shift), keys[image_idx]) >= 0,
    )
    if (maps_onto_sites) translations.push(shift)
  }
  return translations
}
