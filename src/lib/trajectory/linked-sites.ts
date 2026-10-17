import { nearest_value_idx } from '#lib/math.js'
import type { StructureIdSweep } from '#lib/structure-id/collect.js'
import type { AnyStructure } from '#lib/structure/index.js'
import { site_count } from '#lib/structure/site.js'
import type { TrajectoryFrame } from './index'

// The source atom behind each site of a render sample (huge runs preview every n-th atom),
// or undefined for a frame that shows every atom. A sample that does not say which atoms it
// kept cannot be mapped, so it throws rather than passing site indices off as atom indices.
export const sampled_source_indices = (
  frame: Pick<TrajectoryFrame, `metadata`> | null | undefined,
): readonly number[] | undefined => {
  const metadata = frame?.metadata
  if (!metadata?.render_sample) return undefined
  const { source_atom_indices } = metadata
  if (!Array.isArray(source_atom_indices))
    throw new Error(
      `Render-sampled frame lacks its source_atom_indices array, got ${typeof source_atom_indices}`,
    )
  return source_atom_indices
}

// Analyses and the data inspector index atoms of the full source frame; atoms outside a render
// sample have no site and drop out.
export const scene_site_indices = (
  source_indices: Iterable<number>,
  frame: Pick<TrajectoryFrame, `structure` | `metadata`> | null | undefined,
): number[] => {
  if (!frame) return []
  const sampled = sampled_source_indices(frame)
  if (!sampled) {
    const n_sites = site_count(frame.structure)
    return [...source_indices].filter((idx) => idx >= 0 && idx < n_sites)
  }
  const site_of_source = new Map(sampled.map((source_idx, site_idx) => [source_idx, site_idx]))
  return [...source_indices].flatMap((source_idx) => site_of_source.get(source_idx) ?? [])
}

// Source atoms of scene sites, the inverse of scene_site_indices
export const site_source_atoms = (
  site_indices: number[],
  frame: Pick<TrajectoryFrame, `metadata`> | null | undefined,
): number[] => {
  const sampled = sampled_source_indices(frame)
  return sampled ? site_indices.flatMap((site_idx) => sampled[site_idx] ?? []) : site_indices
}

// Sites carrying any of `elements`. A curve label that names no element, like the all-atom
// `Total` curve of MSD/VACF, matches nothing. Runs per hover, so push instead of flatMap
// (2-3x faster on 1e5-1e6 sites).
export const element_site_indices = (
  structure: AnyStructure | undefined,
  elements: readonly string[],
): number[] => {
  const site_indices: number[] = []
  structure?.sites.forEach(({ species }, site_idx) => {
    if (species.some(({ element }) => elements.includes(element))) site_indices.push(site_idx)
  })
  return site_indices
}

// Source atoms of one CNA type in the analysed frame nearest `frame_idx` (ties go to the
// earlier frame): a sweep samples a subset of frames, so the shown frame may not have been
// classified itself. Returns the frame the classification comes from so the caller can say so.
export const cna_type_source_atoms = (
  sweep: StructureIdSweep,
  frame_idx: number,
  type_code: number,
): { frame_number: number; atom_indices: number[] } | null => {
  if (sweep.frame_numbers.length === 0) return null
  const position = nearest_value_idx(sweep.frame_numbers, frame_idx)
  const cna_types = sweep.results[position]?.cna_types
  if (!cna_types) return null
  // no full-length keys() copy: this runs per hover over every source atom
  const atom_indices: number[] = []
  cna_types.forEach((code, atom_idx) => {
    if (code === type_code) atom_indices.push(atom_idx)
  })
  return { frame_number: sweep.frame_numbers[position], atom_indices }
}
