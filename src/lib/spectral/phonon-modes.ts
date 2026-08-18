import { is_elem_symbol } from '$lib/element/helpers'
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import {
  make_site,
  make_supercell,
  parse_supercell_scaling,
  type Crystal,
} from '$lib/structure'
import { compute_bonds, normalize_structure_bond } from '$lib/structure/bonding'
import type { TrajectoryType } from '$lib/trajectory'
import {
  complex_mode_displacement_frames,
  complex_phase,
  multiply_complex,
} from './complex-mode'
import { acoustic_mode_indices, is_gamma_point } from './ir-raman'
import type {
  Complex,
  PhononBandStructure,
  PhononModeData,
  PhononModeSelection,
  QPoint,
} from './types'

export interface PhononModeTrajectoryOptions {
  amplitude?: number
  supercell?: Vec3
  n_frames?: number
  vector_key?: string
}

export const DEFAULT_PHONON_AMPLITUDE = 0.3
export const DEFAULT_PHONON_SUPERCELL: Vec3 = [3, 3, 2]
export const DEFAULT_PHONON_FRAMES = 48
export const DEFAULT_PHONON_FPS = 12
export const DEFAULT_PHONON_SHOW_VECTORS = false
export const PHONON_VECTOR_KEY = `phonon_displacement`
// Every frame clones complete site objects, so reject requests likely to freeze the browser.
const MAX_PHONON_TRAJECTORY_SITE_FRAMES = 500_000
const CELL_FACE_TOLERANCE = 1e-10

const validate_trajectory_size = (n_sites: number, n_frames: number): void => {
  const n_site_frames = n_sites * n_frames
  if (
    Number.isSafeInteger(n_site_frames) &&
    n_site_frames <= MAX_PHONON_TRAJECTORY_SITE_FRAMES
  ) {
    return
  }
  throw new Error(
    `Phonon trajectory would generate ${n_sites} sites × ${n_frames} frames ` +
      `(${n_site_frames} site-frames), exceeding the ${MAX_PHONON_TRAJECTORY_SITE_FRAMES} limit. ` +
      `Reduce the supercell or frame count.`,
  )
}

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
  const reciprocal_lattice =
    data.reciprocal_lattice ??
    (data.lattice ? math.transpose_3x3_matrix(math.matrix_inverse_3x3(data.lattice)) : null)
  if (!reciprocal_lattice) {
    throw new Error(`Phonon band data needs a real or reciprocal lattice`)
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
    recip_lattice: { matrix: reciprocal_lattice },
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

// Build one phase cycle of a phonon mode as an in-memory structure trajectory.
export function phonon_mode_trajectory(
  data: PhononModeData,
  selection: PhononModeSelection,
  options: PhononModeTrajectoryOptions = {},
): TrajectoryType {
  const {
    amplitude = DEFAULT_PHONON_AMPLITUDE,
    supercell = DEFAULT_PHONON_SUPERCELL,
    n_frames = DEFAULT_PHONON_FRAMES,
    vector_key = PHONON_VECTOR_KEY,
  } = options
  if (!Number.isFinite(amplitude) || amplitude <= 0) {
    throw new Error(`Phonon amplitude must be a positive finite number, got ${amplitude}`)
  }
  if (!Number.isInteger(n_frames) || n_frames < 2) {
    throw new Error(`Phonon trajectory needs at least 2 integer frames, got ${n_frames}`)
  }
  if (!data.lattice) throw new Error(`Phonon mode animation needs a real-space lattice`)
  if (data.atoms.length !== data.n_atoms) {
    throw new Error(
      `Phonon mode data declares ${data.n_atoms} atoms but contains ${data.atoms.length}`,
    )
  }
  const scaling = parse_supercell_scaling(supercell)
  const n_cells = scaling[0] * scaling[1] * scaling[2]
  validate_trajectory_size(data.n_atoms * n_cells, n_frames)
  const { eigenvector, frequency, q_position } = validate_selection(data, selection)
  if (eigenvector.length !== data.n_atoms) {
    throw new Error(
      `Phonon eigenvector has ${eigenvector.length} atom blocks but mode data declares ${data.n_atoms}`,
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
    properties: {
      phonon_q_position: q_position,
      phonon_frequency: frequency,
      phonon_mode_idx: selection.mode_idx,
    },
  }
  const expanded_cell = make_supercell(unit_cell, scaling, false)
  const closed_cell = close_supercell_faces(expanded_cell)
  validate_trajectory_size(closed_cell.sites.length, n_frames)
  const equilibrium: Crystal = {
    ...closed_cell,
    properties: {
      ...closed_cell.properties,
      bonds: compute_bonds(closed_cell, `electroneg_ratio`).map(
        ({ site_idx_1, site_idx_2, bond_order }) =>
          normalize_structure_bond(site_idx_1, site_idx_2, bond_order ?? 1),
      ),
    },
  }
  const supercell_cart_to_frac = math.create_cart_to_frac(equilibrium.lattice.matrix)

  let anchor: Complex = [1, 0]
  let anchor_magnitude = 0
  for (const atom_vector of eigenvector) {
    for (const component of atom_vector) {
      const magnitude = Math.hypot(...component)
      if (magnitude > anchor_magnitude) {
        anchor = component
        anchor_magnitude = magnitude
      }
    }
  }
  if (!(anchor_magnitude > 0)) throw new Error(`Phonon eigenvector has zero displacement`)
  const anchor_rotation = complex_phase(-Math.atan2(anchor[1], anchor[0]))
  const phase_anchored = eigenvector.map((atom_vector, atom_idx) => {
    const { mass } = data.atoms[atom_idx]
    if (!Number.isFinite(mass) || mass <= 0) {
      throw new Error(`Phonon atom ${atom_idx} has invalid mass ${mass}`)
    }
    const mass_scale = 1 / Math.sqrt(mass * n_cells)
    return atom_vector.map(([real_part, imag_part]) =>
      multiply_complex([real_part * mass_scale, imag_part * mass_scale], anchor_rotation),
    )
  })

  const complex_displacements = equilibrium.sites.map((site, site_idx) => {
    const source_site_idx =
      typeof site.properties.orig_site_idx === `number`
        ? site.properties.orig_site_idx
        : site_idx
    const atom_position = site.abc.map(
      (coordinate, axis) => coordinate * scaling[axis],
    ) as Vec3
    const spatial_phase = complex_phase(2 * Math.PI * math.dot(q_position, atom_position))
    return phase_anchored[source_site_idx % data.n_atoms].map((component) =>
      multiply_complex(component, spatial_phase),
    )
  })
  const displacement_frames = complex_mode_displacement_frames(complex_displacements, {
    amplitude,
    n_frames,
    label: `Phonon eigenvector`,
  })
  const frames = displacement_frames.map(({ phase, displacements }, frame_idx) => {
    const frame_sites = equilibrium.sites.map((site, site_idx) => {
      const displacement = displacements[site_idx]
      const xyz = math.add(site.xyz, displacement)
      return {
        ...site,
        xyz,
        abc: supercell_cart_to_frac(xyz),
        properties: { ...site.properties, [vector_key]: displacement },
      }
    })
    return {
      structure: { ...equilibrium, sites: frame_sites },
      step: frame_idx,
      metadata: { phase, frequency, q_position },
    }
  })

  return {
    frames,
    metadata: {
      amplitude,
      frequency,
      mode_idx: selection.mode_idx,
      qpoint_idx: selection.qpoint_idx,
      q_position,
      supercell: scaling,
      is_commensurate: is_commensurate_phonon_supercell(q_position, scaling),
    },
  }
}
