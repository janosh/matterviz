import { is_elem_symbol } from '$lib/element/helpers'
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import {
  get_orig_site_idx,
  make_site,
  make_supercell,
  parse_supercell_scaling,
  type Crystal,
} from '$lib/structure'
import { compute_bonds, normalize_structure_bond } from '$lib/structure/bonding'
import { trajectory_from_frame_source, type TrajectoryRun } from '$lib/trajectory'
import { is_gamma_point } from './helpers'
import { acoustic_mode_indices } from './ir-raman'
import type {
  Complex,
  PhononBandStructure,
  PhononModeData,
  PhononModeSelection,
  QPoint,
} from './types'

interface PhononModeTrajectoryOptions {
  amplitude?: number
  supercell?: Vec3
  n_frames?: number
  vector_key?: string
}

// The real-space cell one or more modes animate in: the tiled unit cell with its positive
// faces closed and equilibrium bonds attached. Independent of the selected mode, so a viewer
// keeps one per supercell (and its camera framing) while modes and amplitudes change.
export interface PhononSupercell {
  data: PhononModeData
  scaling: Vec3
  structure: Crystal
  // Unit-cell atom each displayed site descends from, and its position in unit-cell fractional
  // coordinates (cell translation included), which sets the Bloch phase
  atom_idx: Uint32Array
  cell_position: Float64Array // [n_sites * 3]
}

// One mode's complex Cartesian displacement pattern on a supercell, mass-unweighted with the
// global phase anchored and Bloch phases applied. Packed [re_x, im_x, re_y, im_y, re_z, im_z]
// per site and normalised so the largest excursion over one cycle is exactly 1 Å; the
// animation amplitude scales it at read time.
export interface PhononModePattern {
  supercell: PhononSupercell
  selection: PhononModeSelection
  frequency: number
  q_position: Vec3
  displacements: Float64Array // [n_sites * 6]
  is_commensurate: boolean
}

export const DEFAULT_PHONON_AMPLITUDE = 0.3
export const DEFAULT_PHONON_SUPERCELL: Vec3 = [3, 3, 2]
export const DEFAULT_PHONON_FRAMES = 48
export const DEFAULT_PHONON_FPS = 24
export const DEFAULT_PHONON_SHOW_VECTORS = false
export const PHONON_VECTOR_KEY = `phonon_displacement`
// Frames are synthesised on read, so only the displayed site count bounds memory and per-frame
// work; this keeps a mistyped supercell from freezing the browser in bonding and rendering.
export const MAX_PHONON_SUPERCELL_SITES = 200_000
const CELL_FACE_TOLERANCE = 1e-10

// Close the half-open supercell [0, 1) with copies on its missing positive faces. These
// are the only image atoms the phonon player needs: they fill the displayed cell without
// asking the generic PBC renderer to add whole translated coordination shells outside it.
const close_supercell_faces = (structure: Crystal): Crystal => {
  const sites = [...structure.sites]
  const frac_to_cart = math.create_frac_to_cart(structure.lattice.matrix)

  for (const [site_idx, site] of structure.sites.entries()) {
    const face_axes = site.abc.flatMap((coordinate, axis) =>
      Math.abs(coordinate) <= CELL_FACE_TOLERANCE ? [axis] : [],
    )
    for (let face_mask = 1; face_mask < 1 << face_axes.length; face_mask++) {
      const abc = [...site.abc] as Vec3
      for (const [mask_idx, axis] of face_axes.entries()) {
        if (face_mask & (1 << mask_idx)) abc[axis] = 1
      }
      sites.push({
        ...site,
        abc,
        xyz: frac_to_cart(abc),
        properties: { ...site.properties, orig_site_idx: site_idx },
      })
    }
  }
  return { ...structure, sites }
}

export function default_phonon_mode_selection(
  data: PhononModeData,
): PhononModeSelection | undefined {
  const gamma_idx = data.qpoints.findIndex(({ q_position }) => is_gamma_point(q_position))
  const qpoint_order = [...data.qpoints.keys()]
  if (gamma_idx > 0) qpoint_order.unshift(...qpoint_order.splice(gamma_idx, 1))
  for (const qpoint_idx of qpoint_order) {
    const qpoint = data.qpoints[qpoint_idx]
    const acoustic = acoustic_mode_indices(qpoint.modes, qpoint.q_position)
    const optical_idx = qpoint.modes.findIndex(
      (mode, mode_idx) => mode.eigenvector !== null && !acoustic.has(mode_idx),
    )
    const mode_idx =
      optical_idx !== -1 ? optical_idx : qpoint.modes.findIndex((mode) => mode.eigenvector)
    if (mode_idx !== -1) return { qpoint_idx, mode_idx }
  }
  return undefined
}

// Convert parsed band.yaml modes to the structure consumed by Bands.
export function phonon_band_structure_from_modes(data: PhononModeData): PhononBandStructure {
  if (data.path_segments.length === 0) {
    throw new Error(
      `Phonon mode data has no band path metadata. Use q-point and mode selectors for qpoints.yaml or mesh.yaml data.`,
    )
  }
  const distances = data.qpoints.map(({ distance: qpoint_distance }) => {
    if (qpoint_distance === null) {
      throw new Error(`Phonon band path contains a q-point without a distance`)
    }
    return qpoint_distance
  })

  const labels_by_index: Record<number, string> = {}
  const labels_dict: Record<string, Vec3> = {}
  const branches = data.path_segments.map((segment, segment_idx) => {
    const { start_index, end_index, start_label, end_label } = segment
    if (start_index < 0 || end_index < start_index || end_index >= data.qpoints.length) {
      throw new Error(
        `Phonon path segment ${segment_idx} has invalid bounds ${start_index}–${end_index} for ${data.qpoints.length} q-points`,
      )
    }
    for (const [qpoint_idx, label] of [
      [start_index, start_label],
      [end_index, end_label],
    ] as const) {
      if (!label) continue
      labels_by_index[qpoint_idx] = label
      labels_dict[label] = data.qpoints[qpoint_idx].q_position
    }
    const name =
      start_label && end_label ? `${start_label}-${end_label}` : `segment-${segment_idx + 1}`
    return { start_index, end_index, name, is_discontinuity: false }
  })
  const qpoints: QPoint[] = data.qpoints.map(({ q_position }, qpoint_idx) => ({
    label: labels_by_index[qpoint_idx] ?? null,
    frac_coords: q_position,
    distance: distances[qpoint_idx],
  }))
  const bands = Array.from({ length: data.qpoints[0]?.modes.length ?? 0 }, (_, mode_idx) =>
    data.qpoints.map(({ modes }, qpoint_idx) => {
      const mode = modes[mode_idx]
      if (!mode) throw new Error(`Q-point ${qpoint_idx} is missing mode ${mode_idx}`)
      return mode.frequency
    }),
  )

  return {
    qpoints,
    branches,
    labels_dict,
    distance: distances,
    nb_bands: bands.length,
    bands,
    has_imaginary_modes: bands.some((band) => band.some((frequency) => frequency < 0)),
  }
}

function validate_selection(
  data: PhononModeData,
  selection: PhononModeSelection,
): { eigenvector: Complex[][]; frequency: number; q_position: Vec3 } {
  const qpoint = data.qpoints[selection.qpoint_idx]
  if (!qpoint) {
    throw new Error(
      `Phonon q-point index ${selection.qpoint_idx} is outside 0–${data.qpoints.length - 1}`,
    )
  }
  const mode = qpoint.modes[selection.mode_idx]
  if (!mode) {
    throw new Error(
      `Phonon mode index ${selection.mode_idx} is outside 0–${qpoint.modes.length - 1} at q-point ${selection.qpoint_idx}`,
    )
  }
  if (!mode.eigenvector) {
    throw new Error(
      `Phonon mode ${selection.mode_idx} at q-point ${selection.qpoint_idx} has no eigenvector`,
    )
  }
  if (mode.eigenvector.length !== data.n_atoms) {
    throw new Error(
      `Phonon eigenvector has ${mode.eigenvector.length} atom blocks but mode data declares ${data.n_atoms}`,
    )
  }
  return {
    eigenvector: mode.eigenvector,
    frequency: mode.frequency,
    q_position: qpoint.q_position,
  }
}

// Whether the selected Bloch phase repeats across every diagonal supercell boundary.
export function is_commensurate_phonon_supercell(
  q_position: Vec3,
  supercell: Vec3,
  tolerance = 1e-8,
): boolean {
  const scaling = parse_supercell_scaling(supercell)
  return q_position.every(
    (coordinate, axis) =>
      Math.abs(coordinate * scaling[axis] - Math.round(coordinate * scaling[axis])) <=
      tolerance,
  )
}

// Mass-weighted mode character: the share of sum |e|^2 each element carries, in descending
// order, plus the participation ratio (1/n_atoms for one atom moving, 1 for all equally).
export function phonon_mode_character(
  data: PhononModeData,
  eigenvector: Complex[][],
): { element_weights: [string, number][]; participation_ratio: number } {
  const by_element = new Map<string, number>()
  let total = 0
  let total_sq = 0
  for (const [atom_idx, atom_vector] of eigenvector.entries()) {
    let weight = 0
    for (const [re_part, im_part] of atom_vector) weight += re_part ** 2 + im_part ** 2
    const symbol = data.atoms[atom_idx]?.symbol ?? `?`
    by_element.set(symbol, (by_element.get(symbol) ?? 0) + weight)
    total += weight
    total_sq += weight ** 2
  }
  const participation_ratio =
    eigenvector.length && total_sq > 0 ? total ** 2 / (eigenvector.length * total_sq) : 0
  const element_weights = [...by_element]
    .map(([symbol, weight]): [string, number] => [symbol, total > 0 ? weight / total : 0])
    .toSorted((left, right) => right[1] - left[1])
  return { element_weights, participation_ratio }
}

// Build the displayed supercell once per (data, scaling): tiling, face closure and bonding
// are the expensive steps and none of them depends on which mode is animated.
export function phonon_supercell(
  data: PhononModeData,
  supercell: Vec3 = DEFAULT_PHONON_SUPERCELL,
): PhononSupercell {
  if (!data.lattice) throw new Error(`Phonon mode animation needs a real-space lattice`)
  if (data.atoms.length !== data.n_atoms) {
    throw new Error(
      `Phonon mode data declares ${data.n_atoms} atoms but contains ${data.atoms.length}`,
    )
  }
  const scaling = parse_supercell_scaling(supercell)
  const n_cells = scaling[0] * scaling[1] * scaling[2]
  if (data.n_atoms * n_cells > MAX_PHONON_SUPERCELL_SITES) {
    throw new Error(
      `Phonon supercell ${scaling.join(`x`)} would display ${data.n_atoms * n_cells} sites, ` +
        `exceeding the ${MAX_PHONON_SUPERCELL_SITES} limit. Reduce the supercell.`,
    )
  }
  const frac_to_cart = math.create_frac_to_cart(data.lattice)
  const sites = data.atoms.map((atom, atom_idx) => {
    if (!is_elem_symbol(atom.symbol)) {
      throw new Error(`Phonon atom ${atom_idx} has unknown element symbol '${atom.symbol}'`)
    }
    return make_site(
      atom.symbol,
      atom.coordinates,
      frac_to_cart(atom.coordinates),
      `${atom.symbol}${atom_idx + 1}`,
    )
  })
  const unit_cell: Crystal = {
    sites,
    lattice: {
      matrix: data.lattice,
      pbc: [false, false, false],
      ...math.calc_lattice_params(data.lattice),
    },
    properties: {},
  }
  const closed_cell = close_supercell_faces(make_supercell(unit_cell, scaling, false))
  const structure: Crystal = {
    ...closed_cell,
    properties: {
      bonds: compute_bonds(closed_cell, `electroneg_ratio`).map(
        ({ site_idx_1, site_idx_2, bond_order }) =>
          normalize_structure_bond(site_idx_1, site_idx_2, bond_order ?? 1),
      ),
    },
  }
  const n_sites = structure.sites.length
  const atom_idx = new Uint32Array(n_sites)
  const cell_position = new Float64Array(n_sites * 3)
  for (const [site_idx, site] of structure.sites.entries()) {
    atom_idx[site_idx] = get_orig_site_idx(site, site_idx) % data.n_atoms
    for (let axis = 0; axis < 3; axis++) {
      cell_position[site_idx * 3 + axis] = site.abc[axis] * scaling[axis]
    }
  }
  return { data, scaling, structure, atom_idx, cell_position }
}

// Mass-unweight the eigenvector (phonopy convention), rotate away its arbitrary global phase
// so the largest component starts real, apply exp(2πi q·r) per site and normalise the
// largest cyclic excursion to 1 Å.
export function phonon_mode_pattern(
  supercell: PhononSupercell,
  selection: PhononModeSelection,
): PhononModePattern {
  const { data, scaling, atom_idx, cell_position } = supercell
  const { eigenvector, frequency, q_position } = validate_selection(data, selection)

  let anchor_re = 1
  let anchor_im = 0
  let anchor_magnitude = 0
  for (const atom_vector of eigenvector) {
    for (const [re_part, im_part] of atom_vector) {
      const magnitude = Math.hypot(re_part, im_part)
      if (magnitude > anchor_magnitude)
        [anchor_re, anchor_im, anchor_magnitude] = [re_part, im_part, magnitude]
    }
  }
  if (!(anchor_magnitude > 0)) throw new Error(`Phonon eigenvector has zero displacement`)
  const rotation = -Math.atan2(anchor_im, anchor_re)
  const [rot_re, rot_im] = [Math.cos(rotation), Math.sin(rotation)]
  const anchored = eigenvector.map((atom_vector, idx) => {
    const { mass } = data.atoms[idx]
    if (!Number.isFinite(mass) || mass <= 0) {
      throw new Error(`Phonon atom ${idx} has invalid mass ${mass}`)
    }
    const mass_scale = 1 / Math.sqrt(mass)
    return atom_vector.map(([re_part, im_part]): Complex => [
      mass_scale * (re_part * rot_re - im_part * rot_im),
      mass_scale * (re_part * rot_im + im_part * rot_re),
    ])
  })

  const n_sites = atom_idx.length
  const displacements = new Float64Array(n_sites * 6)
  let max_excursion_sq = 0
  for (let site_idx = 0; site_idx < n_sites; site_idx++) {
    const phase =
      2 *
      Math.PI *
      (q_position[0] * cell_position[site_idx * 3] +
        q_position[1] * cell_position[site_idx * 3 + 1] +
        q_position[2] * cell_position[site_idx * 3 + 2])
    const [cos_phase, sin_phase] = [Math.cos(phase), Math.sin(phase)]
    // Max over the cycle of |Re(u e^{-iφ})|² for u = a + ib is (|a|²+|b|²+√((|a|²−|b|²)²+4(a·b)²))/2
    let re_sq = 0
    let im_sq = 0
    let re_im = 0
    for (const [axis, [re_part, im_part]] of anchored[atom_idx[site_idx]].entries()) {
      const re_rotated = re_part * cos_phase - im_part * sin_phase
      const im_rotated = re_part * sin_phase + im_part * cos_phase
      displacements[site_idx * 6 + axis * 2] = re_rotated
      displacements[site_idx * 6 + axis * 2 + 1] = im_rotated
      re_sq += re_rotated ** 2
      im_sq += im_rotated ** 2
      re_im += re_rotated * im_rotated
    }
    const excursion_sq = (re_sq + im_sq + Math.hypot(re_sq - im_sq, 2 * re_im)) / 2
    if (excursion_sq > max_excursion_sq) max_excursion_sq = excursion_sq
  }
  if (!(max_excursion_sq > 0)) throw new Error(`Phonon eigenvector has zero displacement`)
  const norm = 1 / Math.sqrt(max_excursion_sq)
  for (let idx = 0; idx < displacements.length; idx++) displacements[idx] *= norm

  return {
    supercell,
    selection,
    frequency,
    q_position,
    displacements,
    is_commensurate: is_commensurate_phonon_supercell(q_position, scaling),
  }
}

// One phase cycle of a mode as a trajectory whose frames are synthesised on read: memory and
// setup stay O(n_sites) however many frames are requested, and an amplitude change is a new
// run over the same pattern rather than a rebuild.
export function phonon_mode_run(
  pattern: PhononModePattern,
  options: Omit<PhononModeTrajectoryOptions, `supercell`> = {},
): TrajectoryRun {
  const {
    amplitude = DEFAULT_PHONON_AMPLITUDE,
    n_frames = DEFAULT_PHONON_FRAMES,
    vector_key = PHONON_VECTOR_KEY,
  } = options
  if (!Number.isFinite(amplitude) || amplitude <= 0) {
    throw new Error(`Phonon amplitude must be a positive finite number, got ${amplitude}`)
  }
  if (!Number.isInteger(n_frames) || n_frames < 2) {
    throw new Error(`Phonon trajectory needs at least 2 integer frames, got ${n_frames}`)
  }
  const { supercell, selection, frequency, q_position, displacements } = pattern
  const equilibrium = supercell.structure
  // Fractional coordinates move by the displacement in the lattice basis, so the inverse
  // matrix is applied to the (small) displacement and added to the fixed equilibrium abc
  const [[ia, ib, ic], [ja, jb, jc], [ka, kb, kc]] = math.matrix_inverse_3x3(
    equilibrium.lattice.matrix,
  )
  const phase_of = (frame_idx: number) => (2 * Math.PI * frame_idx) / n_frames

  // Phonon eigenvectors conventionally evolve as exp(-iωt): u(φ) = Re(u) cos φ + Im(u) sin φ.
  // Hot loop for large supercells: every site allocates one object and three vectors, nothing
  // else, so a 10k-site frame synthesises in about a millisecond.
  const read_frame = (frame_idx: number) => {
    const phase = phase_of(frame_idx)
    const cos_phase = amplitude * Math.cos(phase)
    const sin_phase = amplitude * Math.sin(phase)
    const sites = equilibrium.sites.map((site, site_idx) => {
      const offset = site_idx * 6
      const dx = displacements[offset] * cos_phase + displacements[offset + 1] * sin_phase
      const dy = displacements[offset + 2] * cos_phase + displacements[offset + 3] * sin_phase
      const dz = displacements[offset + 4] * cos_phase + displacements[offset + 5] * sin_phase
      const { xyz, abc, properties } = site
      return {
        species: site.species,
        label: site.label,
        xyz: [xyz[0] + dx, xyz[1] + dy, xyz[2] + dz] as Vec3,
        abc: [
          abc[0] + dx * ia + dy * ja + dz * ka,
          abc[1] + dx * ib + dy * jb + dz * kb,
          abc[2] + dx * ic + dy * jc + dz * kc,
        ] as Vec3,
        properties: { ...properties, [vector_key]: [dx, dy, dz] as Vec3 },
      }
    })
    return {
      structure: { ...equilibrium, sites },
      step: frame_idx,
      metadata: { phase, frequency, q_position },
    }
  }

  return trajectory_from_frame_source(n_frames, read_frame, {
    properties: Array.from({ length: n_frames }, (_unused, frame_idx) => ({
      frame_number: frame_idx,
      step: frame_idx,
      properties: { Step: frame_idx, phase: phase_of(frame_idx) },
    })),
    metadata: {
      amplitude,
      frequency,
      mode_idx: selection.mode_idx,
      qpoint_idx: selection.qpoint_idx,
      q_position,
      supercell: supercell.scaling,
      is_commensurate: pattern.is_commensurate,
    },
  })
}

// Convenience composition of the three stages above for one-off use.
export function phonon_mode_trajectory(
  data: PhononModeData,
  selection: PhononModeSelection,
  options: PhononModeTrajectoryOptions = {},
): TrajectoryRun {
  const { supercell, ...run_options } = options
  return phonon_mode_run(
    phonon_mode_pattern(phonon_supercell(data, supercell), selection),
    run_options,
  )
}
