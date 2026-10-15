import type { Vec3 } from '#lib/math.js'
import type { Site } from '#lib/structure/index.js'
import { is_image_site } from '#lib/structure/site.js'

const PARTIAL_OCCUPANCY_SLICE_GAP_RAD = 1e-3
// One tolerance for "fully occupied" in rendering and export: admits occupancies printed to 3
// decimals (3 x 0.333) and float sums like 0.7 + 0.2 + 0.1 = 0.9999999999999999
export const OCCUPANCY_TOL = 1e-3
const NO_HIDDEN_ELEMENTS: ReadonlySet<string> = new Set()
const MIN_PHI_LENGTH = 1e-4
const MERGE_DISTANCE_TOLERANCE = 1e-8
// Bucket edge for the merge lookup, far wider than the tolerance so a group almost never sits
// close enough to a face for a coincident partner to land in the next bucket along
const MERGE_BUCKET_SIZE = MERGE_DISTANCE_TOLERANCE * 1e3
// The tolerance as a fraction of a bucket, i.e. how far from a face still counts as close to it
const MERGE_BUCKET_REACH = MERGE_DISTANCE_TOLERANCE / MERGE_BUCKET_SIZE
// Bucket offsets along one axis that a point within the tolerance of `coord` could fall in:
// just [0] unless `coord` sits within the tolerance of a bucket face, which is what keeps the
// index exact without registering all 27 neighbours for every group
const neighbor_offsets = (coord: number, bucket: number): readonly number[] => {
  const from_center = coord / MERGE_BUCKET_SIZE - bucket
  if (from_center + MERGE_BUCKET_REACH > 0.5) return [0, 1]
  if (from_center - MERGE_BUCKET_REACH < -0.5) return [-1, 0]
  return [0]
}
type RenderSite = {
  site_idx: number
  site: Site
  is_image_atom: boolean
  source_site_indices: number[]
}

export type SliceGeometry = {
  element: string
  occupancy: number
  start_phi: number
  end_phi: number
  phi_length: number
  render_start_cap: boolean
  render_end_cap: boolean
}

// Summed occupancy of a site's species when the visible ones all name one element (Fe2+ and
// Fe3+ count as one Fe), else NaN (several elements, or none visible). Answers "one element,
// fully occupied?" for rendering and export alike. Allocation-free: runs for every site of
// every trajectory frame.
export const single_element_occupancy = (
  species: Site[`species`],
  hidden_elements: ReadonlySet<string> = NO_HIDDEN_ELEMENTS,
): number => {
  let visible_element: string | undefined
  let n_visible = 0
  let occupancy = 0
  for (const { element, occu } of species) {
    if (hidden_elements.size > 0 && hidden_elements.has(element)) continue
    if (n_visible++ === 0) visible_element = element
    else if (element !== visible_element) return NaN
    occupancy += occu ?? 1 // hand-built sites may omit occu
  }
  return n_visible === 0 ? NaN : occupancy
}

export const is_full_occupancy = (occupancy: number): boolean =>
  Math.abs(occupancy - 1) <= OCCUPANCY_TOL

// A site's species as drawn: each element once with its occupancies summed, so mixed-valence
// Fe2+ 0.5 / Fe3+ 0.5 is one full Fe sphere rather than two half wedges with a seam. Returns
// the input itself when no element repeats (the common case allocates nothing).
export const merge_species_by_element = (species: Site[`species`]): Site[`species`] => {
  if (species.length < 2) return species
  const repeats = species.some(
    (spec, idx) => species.findIndex(({ element }) => element === spec.element) !== idx,
  )
  if (!repeats) return species
  const merged = new Map<string, Site[`species`][number]>()
  for (const spec of species) {
    const prev = merged.get(spec.element)
    merged.set(spec.element, prev ? { ...prev, occu: prev.occu + spec.occu } : spec)
  }
  return [...merged.values()]
}

// Disordered sites are often stored as separate single-species partial sites at the same
// position; merge them into one render site whose `species` holds every element. Ordered and
// unmatched sites keep their own Site object, in input order, followed by the merged groups.
export const merge_split_partial_sites = (
  sites: Site[],
  hidden_elements: ReadonlySet<string> = new Set(),
): RenderSite[] => {
  const make_render_site = (site_idx: number, source_site_indices: number[], site?: Site) => ({
    site_idx,
    site: site ?? sites[site_idx],
    is_image_atom: source_site_indices.some((source_idx) => is_image_site(sites[source_idx])),
    source_site_indices,
  })
  const render_sites: RenderSite[] = []
  const groups: { center: Vec3; indices: number[] }[] = []
  // Groups indexed by coordinate bucket, each registered under its own bucket and the handful
  // of neighbours it actually lies close to (see `neighbor_offsets`), so a lookup is a single
  // key even when two coincident sites round to opposite sides of a boundary. Scanning every
  // group instead made this quadratic, and it runs per trajectory frame: 8k split-partial
  // sites took 218 ms a frame, which hiding one species of an alloy reaches at any site count
  // (that leaves one visible species summing under 1).
  const groups_by_bucket = new Map<string, number[]>()
  const bucket_of = (coord: number) => Math.round(coord / MERGE_BUCKET_SIZE)
  for (const [site_idx, site] of sites.entries()) {
    // one visible element short of full occupancy (NaN compares false)
    if (!(single_element_occupancy(site.species, hidden_elements) < 1 - OCCUPANCY_TOL)) {
      render_sites.push(make_render_site(site_idx, [site_idx]))
      continue
    }
    const [basis_x, basis_y, basis_z] = site.xyz.map(bucket_of)
    // candidates arrive in group-creation order, so the first hit is the one `find` returned
    let group_idx = -1
    for (const candidate of groups_by_bucket.get(`${basis_x},${basis_y},${basis_z}`) ?? []) {
      const { center } = groups[candidate]
      const [delta_x, delta_y, delta_z] = [
        center[0] - site.xyz[0],
        center[1] - site.xyz[1],
        center[2] - site.xyz[2],
      ]
      if (
        delta_x * delta_x + delta_y * delta_y + delta_z * delta_z <=
        MERGE_DISTANCE_TOLERANCE ** 2
      ) {
        group_idx = candidate
        break
      }
    }
    if (group_idx !== -1) {
      groups[group_idx].indices.push(site_idx)
      continue
    }
    const new_idx = groups.length
    groups.push({ center: site.xyz, indices: [site_idx] })
    for (const off_x of neighbor_offsets(site.xyz[0], basis_x)) {
      for (const off_y of neighbor_offsets(site.xyz[1], basis_y)) {
        for (const off_z of neighbor_offsets(site.xyz[2], basis_z)) {
          const key = `${basis_x + off_x},${basis_y + off_y},${basis_z + off_z}`
          const bucket = groups_by_bucket.get(key)
          if (bucket) bucket.push(new_idx)
          else groups_by_bucket.set(key, [new_idx])
        }
      }
    }
  }
  for (const { indices } of groups) {
    const [representative_idx] = indices
    const merged =
      indices.length > 1
        ? {
            ...sites[representative_idx],
            species: indices.flatMap((idx) => sites[idx].species),
          }
        : undefined
    render_sites.push(make_render_site(representative_idx, indices, merged))
  }
  return render_sites
}

export const compute_slice_geometry = (site_species: Site[`species`]): SliceGeometry[] => {
  const visible_species = merge_species_by_element(site_species)
  if (visible_species.length === 0) return []
  // Ordered site (the common case): one full turn, no gap, no caps. Occupancy is exactly 1, not
  // a merged float sum like 0.9999999999999999 that consumers comparing to 1 would read partial
  const [only] = visible_species
  if (visible_species.length === 1 && is_full_occupancy(only.occu)) {
    return [
      {
        element: only.element,
        occupancy: 1,
        start_phi: 0,
        end_phi: 2 * Math.PI,
        phi_length: 2 * Math.PI,
        render_start_cap: false,
        render_end_cap: false,
      },
    ]
  }
  const total_visible_occupancy = visible_species.reduce(
    (occupancy_sum, { occu }) => occupancy_sum + occu,
    0,
  )
  // Preserve total angular coverage at one full turn for invalid overfull inputs.
  const occupancy_scale_factor =
    total_visible_occupancy > 1 + OCCUPANCY_TOL ? 1 / total_visible_occupancy : 1
  // Sum of scaled occupancies equals total * scale (avoids a second O(n) pass)
  const normalized_total_occupancy = total_visible_occupancy * occupancy_scale_factor
  const has_vacancy_gap = normalized_total_occupancy < 1 - OCCUPANCY_TOL
  const last_visible_species_idx = visible_species.length - 1
  let start_angle = 0
  return visible_species.map(({ element, occu }, species_idx) => {
    const occupancy = occu * occupancy_scale_factor
    const start_phi_raw = 2 * Math.PI * start_angle
    const end_phi_raw = 2 * Math.PI * (start_angle += occupancy)
    // Keep neighboring wedges from sharing the exact same plane (z-fighting).
    const phi_span_raw = Math.max(0, end_phi_raw - start_phi_raw)
    const max_safe_gap = Math.max(0, phi_span_raw - MIN_PHI_LENGTH)
    const desired_gap =
      visible_species.length > 1
        ? Math.min(PARTIAL_OCCUPANCY_SLICE_GAP_RAD, phi_span_raw * 0.25)
        : 0
    const phi_gap = Math.min(desired_gap, max_safe_gap)
    const start_phi = start_phi_raw + phi_gap / 2
    const end_phi = end_phi_raw - phi_gap / 2
    return {
      element,
      occupancy,
      start_phi,
      end_phi,
      phi_length: Math.max(MIN_PHI_LENGTH, end_phi - start_phi),
      render_start_cap: has_vacancy_gap && species_idx === 0,
      render_end_cap: has_vacancy_gap && species_idx === last_visible_species_idx,
    }
  })
}
