import { nearest_image_idx } from '#lib/neb/reaction-path.js'
import type { StructureIdSweep } from '#lib/structure-id/collect.js'
import type { AnyStructure } from '#lib/structure/index.js'
import type { TrajectoryFrame } from './index'

// Analyses and the data inspector index atoms of the full source frame. A render sample
// (huge runs preview every n-th atom) lists the source atom behind each rendered site in
// `source_atom_indices`; atoms outside the sample have no site and drop out.
export const scene_site_indices = (
  source_indices: Iterable<number>,
  frame: Pick<TrajectoryFrame, `structure` | `metadata`> | null | undefined,
): number[] => {
  if (!frame) return []
  const { metadata, structure } = frame
  const sampled = metadata?.render_sample ? metadata.source_atom_indices : undefined
  if (!Array.isArray(sampled)) {
    return [...source_indices].filter((idx) => idx >= 0 && idx < structure.sites.length)
  }
  const site_of_source = new Map(sampled.map((source_idx, site_idx) => [source_idx, site_idx]))
  return [...source_indices].flatMap((source_idx) => site_of_source.get(source_idx) ?? [])
}

// Sites carrying any of `elements`. A curve label that names no element, like the all-atom
// `Total` curve of MSD/VACF, matches nothing.
export const element_site_indices = (
  structure: AnyStructure | undefined,
  elements: readonly string[],
): number[] =>
  (structure?.sites ?? []).flatMap(({ species }, site_idx) =>
    species.some(({ element }) => elements.includes(element)) ? [site_idx] : [],
  )

// Source atoms of one CNA type in the analysed frame nearest `frame_idx` (ties go to the
// earlier frame): a sweep samples a subset of frames, so the shown frame may not have been
// classified itself. Returns the frame the classification comes from so the caller can say so.
export const cna_type_source_atoms = (
  sweep: StructureIdSweep,
  frame_idx: number,
  type_code: number,
): { frame_number: number; atom_indices: number[] } | null => {
  if (sweep.frame_numbers.length === 0) return null
  const position = nearest_image_idx(sweep.frame_numbers, frame_idx)
  const cna_types = sweep.results[position]?.cna_types
  if (!cna_types) return null
  const atom_indices = [...cna_types.keys()].filter(
    (atom_idx) => cna_types[atom_idx] === type_code,
  )
  return { frame_number: sweep.frame_numbers[position], atom_indices }
}
