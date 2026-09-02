import type { Vec3 } from '$lib/math'
import type { Site } from '$lib/structure'
import { is_image_site } from '$lib/structure/site'

const PARTIAL_OCCUPANCY_SLICE_GAP_RAD = 1e-3
const OCCUPANCY_EPS = 1e-6
const MIN_PHI_LENGTH = 1e-4
const MERGE_DISTANCE_TOLERANCE = 1e-8
// Bucket edge for the merge lookup, far wider than the tolerance so a group almost never sits
// close enough to a face for a coincident partner to land in the next bucket along
const MERGE_BUCKET_SIZE = MERGE_DISTANCE_TOLERANCE * 1e3
// Bucket offsets along one axis that a point within the tolerance of `coord` could fall in:
// just [0] unless `coord` sits within the tolerance of a bucket face, which is what keeps the
// index exact without registering all 27 neighbours for every group
const neighbor_offsets = (coord: number, bucket: number): readonly number[] => {
  const from_center = coord / MERGE_BUCKET_SIZE - bucket
  const reach = MERGE_DISTANCE_TOLERANCE / MERGE_BUCKET_SIZE
  if (from_center + reach > 0.5) return [0, 1]
  if (from_center - reach < -0.5) return [-1, 0]
  return [0]
}
type RenderSite = {
  site_idx: number
  site: Site
  is_image_atom: boolean
  source_site_indices: number[]
}

type SliceGeometry = {
  element: string
  occupancy: number
  start_phi: number
  end_phi: number
  phi_length: number
  render_start_cap: boolean
  render_end_cap: boolean
}

// Flat caps closing a partial-occupancy wedge: a half-disc from CAP_ARC_START spanning
// CAP_ARC_LENGTH at the wedge's start and end azimuth
export const CAP_ARC_START = Math.PI / 2
export const CAP_ARC_LENGTH = Math.PI

// Allocation-free: runs for every site of every trajectory frame
const is_split_partial_site = (site: Site, hidden_elements: ReadonlySet<string>): boolean => {
  let n_visible = 0
  let total_visible_occupancy = 0
  for (const { element, occu } of site.species) {
    if (hidden_elements.size > 0 && hidden_elements.has(element)) continue
    n_visible++
    total_visible_occupancy += occu
  }
  return n_visible === 1 && total_visible_occupancy < 1 - OCCUPANCY_EPS
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
  // Groups indexed by coordinate bucket, each registered under its own bucket and the 26 around
  // it so a lookup is a single key even when two coincident sites round to opposite sides of a
  // boundary. Scanning every group instead made this quadratic, and it runs per trajectory
  // frame: 8k split-partial sites took 218 ms a frame, which hiding one species of an alloy
  // reaches with any site count (that leaves one visible species summing under 1).
  const groups_by_bucket = new Map<string, number[]>()
  const bucket_of = (coord: number) => Math.round(coord / MERGE_BUCKET_SIZE)
  for (const [site_idx, site] of sites.entries()) {
    if (!is_split_partial_site(site, hidden_elements)) {
      render_sites.push(make_render_site(site_idx, [site_idx]))
      continue
    }
    const [bx, by, bz] = site.xyz.map(bucket_of)
    // candidates arrive in group-creation order, so the first hit is the one `find` returned
    let group_idx = -1
    for (const candidate of groups_by_bucket.get(`${bx},${by},${bz}`) ?? []) {
      const { center } = groups[candidate]
      const [dx, dy, dz] = [
        center[0] - site.xyz[0],
        center[1] - site.xyz[1],
        center[2] - site.xyz[2],
      ]
      if (dx * dx + dy * dy + dz * dz <= MERGE_DISTANCE_TOLERANCE ** 2) {
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
    for (const off_x of neighbor_offsets(site.xyz[0], bx)) {
      for (const off_y of neighbor_offsets(site.xyz[1], by)) {
        for (const off_z of neighbor_offsets(site.xyz[2], bz)) {
          const key = `${bx + off_x},${by + off_y},${bz + off_z}`
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

export const compute_slice_geometry = (visible_species: Site[`species`]): SliceGeometry[] => {
  if (visible_species.length === 0) return []
  // Ordered site (the common case): one full turn, no gap, no caps
  const [only] = visible_species
  if (visible_species.length === 1 && Math.abs(only.occu - 1) <= OCCUPANCY_EPS) {
    return [
      {
        element: only.element,
        occupancy: only.occu,
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
    total_visible_occupancy > 1 + OCCUPANCY_EPS ? 1 / total_visible_occupancy : 1
  const normalized_species = visible_species.map(({ element, occu }) => ({
    element,
    occu: occu * occupancy_scale_factor,
  }))
  // Sum of scaled occupancies equals total * scale (avoids a second O(n) pass)
  const normalized_total_occupancy = total_visible_occupancy * occupancy_scale_factor
  const has_vacancy_gap = normalized_total_occupancy < 1 - OCCUPANCY_EPS
  const last_visible_species_idx = normalized_species.length - 1
  let start_angle = 0
  return normalized_species.map(({ element, occu }, species_idx) => {
    const start_phi_raw = 2 * Math.PI * start_angle
    const end_phi_raw = 2 * Math.PI * (start_angle += occu)
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
      occupancy: occu,
      start_phi,
      end_phi,
      phi_length: Math.max(MIN_PHI_LENGTH, end_phi - start_phi),
      render_start_cap: has_vacancy_gap && species_idx === 0,
      render_end_cap: has_vacancy_gap && species_idx === last_visible_species_idx,
    }
  })
}
