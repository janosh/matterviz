import type { Vec3 } from '$lib/math'
import type { Site } from '$lib/structure'

export const PARTIAL_OCCUPANCY_SLICE_GAP_RAD = 1e-3
const OCCUPANCY_EPS = 1e-6
const MIN_PHI_LENGTH = 1e-4
const MERGE_DISTANCE_TOLERANCE = 1e-8
const CAP_ARC_START = Math.PI / 2

export type RenderSite = {
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

export type CapArcConfig = {
  start_cap_arc_start: number
  end_cap_arc_start: number
  arc_length: number
}

const is_image_atom = (site: Site): boolean =>
  typeof site.properties?.orig_site_idx === `number`
const make_render_site = (
  sites: Site[],
  site_idx: number,
  source_site_indices: number[],
  site_override?: Site,
): RenderSite => ({
  site_idx,
  site: site_override ?? sites[site_idx],
  is_image_atom: source_site_indices.some((source_site_idx) =>
    is_image_atom(sites[source_site_idx])
  ),
  source_site_indices,
})
const sq_dist = (
  xyz_1: Vec3,
  xyz_2: Vec3,
): number =>
  (xyz_1[0] - xyz_2[0]) ** 2 +
  (xyz_1[1] - xyz_2[1]) ** 2 +
  (xyz_1[2] - xyz_2[2]) ** 2

const is_split_partial_site = (
  site: Site,
  hidden_elements: ReadonlySet<string>,
): boolean => {
  const visible_species = site.species.filter(({ element }) =>
    !hidden_elements.has(element)
  )
  const total_visible_occupancy = visible_species.reduce(
    (occupancy_sum, { occu }) => occupancy_sum + occu,
    0,
  )
  return visible_species.length === 1 && total_visible_occupancy < 1 - OCCUPANCY_EPS
}

const group_split_partial_indices = (
  sites: Site[],
  hidden_elements: ReadonlySet<string>,
): {
  non_grouped_site_indices: number[]
  grouped_site_indices: number[][]
} => {
  const grouped_centers: Vec3[] = []
  const grouped_site_indices: number[][] = []
  const non_grouped_site_indices: number[] = []
  for (const [site_idx, site] of sites.entries()) {
    if (!is_split_partial_site(site, hidden_elements)) {
      non_grouped_site_indices.push(site_idx)
      continue
    }

    const matched_group_idx = grouped_centers.findIndex((center_xyz) =>
      sq_dist(center_xyz, site.xyz) <= MERGE_DISTANCE_TOLERANCE ** 2
    )
    if (matched_group_idx === -1) {
      grouped_centers.push(site.xyz)
      grouped_site_indices.push([site_idx])
      continue
    }
    grouped_site_indices[matched_group_idx].push(site_idx)
  }
  return { non_grouped_site_indices, grouped_site_indices }
}

const build_render_sites = (
  sites: Site[],
  non_grouped_site_indices: number[],
  grouped_site_indices: number[][],
): RenderSite[] => {
  const render_sites: RenderSite[] = non_grouped_site_indices.map((site_idx) =>
    make_render_site(sites, site_idx, [site_idx])
  )

  for (const grouped_indices of grouped_site_indices) {
    if (grouped_indices.length === 1) {
      const site_idx = grouped_indices[0]
      render_sites.push(make_render_site(sites, site_idx, [site_idx]))
      continue
    }

    const representative_site_idx = grouped_indices[0]
    const representative_site = sites[representative_site_idx]
    const merged_species = grouped_indices.flatMap((grouped_site_idx) =>
      sites[grouped_site_idx].species
    )
    render_sites.push(
      make_render_site(
        sites,
        representative_site_idx,
        [...grouped_indices],
        { ...representative_site, species: merged_species },
      ),
    )
  }

  return render_sites
}

export const PARTIAL_OCCUPANCY_CAP_ARC: CapArcConfig = {
  start_cap_arc_start: CAP_ARC_START,
  end_cap_arc_start: CAP_ARC_START,
  arc_length: Math.PI,
}

export const merge_split_partial_sites = (
  sites: Site[],
  hidden_elements: ReadonlySet<string> = new Set(),
): RenderSite[] => {
  const grouped_indices = group_split_partial_indices(sites, hidden_elements)
  return build_render_sites(
    sites,
    grouped_indices.non_grouped_site_indices,
    grouped_indices.grouped_site_indices,
  )
}

export const compute_slice_geometry = (
  visible_species: Site[`species`],
  slice_gap_rad: number = PARTIAL_OCCUPANCY_SLICE_GAP_RAD,
): SliceGeometry[] => {
  if (visible_species.length === 0) return []
  const total_visible_occupancy = visible_species.reduce(
    (occupancy_sum, { occu }) => occupancy_sum + occu,
    0,
  )
  // Preserve total angular coverage at one full turn for invalid overfull inputs.
  const occupancy_scale_factor = total_visible_occupancy > 1 + OCCUPANCY_EPS
    ? 1 / total_visible_occupancy
    : 1
  const normalized_species = visible_species.map(({ element, occu }) => ({
    element,
    occu: occu * occupancy_scale_factor,
  }))
  const normalized_total_occupancy = normalized_species.reduce(
    (occupancy_sum, { occu }) => occupancy_sum + occu,
    0,
  )
  const has_vacancy_gap = normalized_total_occupancy < 1 - OCCUPANCY_EPS
  const last_visible_species_idx = normalized_species.length - 1
  let start_angle = 0
  return normalized_species.map(({ element, occu }, species_idx) => {
    const start_phi_raw = 2 * Math.PI * start_angle
    const end_phi_raw = 2 * Math.PI * (start_angle += occu)
    // Keep neighboring wedges from sharing the exact same plane (z-fighting).
    const phi_span_raw = Math.max(0, end_phi_raw - start_phi_raw)
    const max_safe_gap = Math.max(0, phi_span_raw - MIN_PHI_LENGTH)
    const desired_gap = visible_species.length > 1
      ? Math.min(slice_gap_rad, phi_span_raw * 0.25)
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
