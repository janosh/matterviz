// Map what an analysis pane points at (source atoms, an element, a structure type) onto site
// indices of the frame the viewer renders, so hovering a curve or picking a table row can
// highlight those atoms in 3D.
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
  if (Array.isArray(sampled)) {
    const site_of_source = new Map(
      sampled.map((source_idx, site_idx) => [source_idx, site_idx]),
    )
    return [...source_indices].flatMap((source_idx) => {
      const site_idx = site_of_source.get(source_idx)
      return site_idx === undefined ? [] : [site_idx]
    })
  }
  const n_sites = structure.sites.length
  return [...source_indices].filter(
    (idx) => Number.isInteger(idx) && idx >= 0 && idx < n_sites,
  )
}

// Sites carrying any of `elements` (the per-element curves of MSD/VACF are labelled by
// symbol). A label that names no element, like the all-atom `Total` curve, matches nothing.
export const element_site_indices = (
  structure: AnyStructure | undefined,
  elements: readonly string[],
): number[] =>
  (structure?.sites ?? []).flatMap(({ species }, site_idx) =>
    species.some(({ element }) => elements.includes(element)) ? [site_idx] : [],
  )

// Position in `frame_numbers` (ascending source frame indices) closest to `frame_idx`, ties
// going to the earlier frame. -1 for an empty list.
export const nearest_frame_position = (
  frame_numbers: readonly number[],
  frame_idx: number,
): number =>
  frame_numbers.reduce(
    (best, frame_number, position) =>
      best < 0 ||
      Math.abs(frame_number - frame_idx) < Math.abs(frame_numbers[best] - frame_idx)
        ? position
        : best,
    -1,
  )

// Source atoms of one CNA type in the analysed frame nearest `frame_idx`: a sweep samples a
// subset of frames, so the shown frame may not have been classified itself. Returns the
// frame the classification comes from so the caller can say so.
export const cna_type_source_atoms = (
  sweep: StructureIdSweep,
  frame_idx: number,
  type_code: number,
): { frame_number: number; atom_indices: number[] } | null => {
  const position = nearest_frame_position(sweep.frame_numbers, frame_idx)
  const cna_types = sweep.results[position]?.cna_types
  if (position < 0 || !cna_types) return null
  const atom_indices = [...cna_types.keys()].filter(
    (atom_idx) => cna_types[atom_idx] === type_code,
  )
  return { frame_number: sweep.frame_numbers[position], atom_indices }
}
