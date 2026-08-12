import { is_elem_symbol } from '$lib/element/helpers'
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import {
  generate_lattice_points,
  make_site,
  make_supercell,
  parse_supercell_scaling,
  type Crystal,
} from '$lib/structure'
import type { TrajectoryType } from '$lib/trajectory'
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
export const DEFAULT_PHONON_SUPERCELL: Vec3 = [2, 2, 2]
export const DEFAULT_PHONON_FRAMES = 48
export const PHONON_VECTOR_KEY = `phonon_displacement`

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
  if (data.qpoints.some(({ distance }) => distance === null)) {
    throw new Error(`Phonon band path contains a q-point without a distance`)
  }

  const labels_by_index = new Map<number, string>()
  const labels_dict: Record<string, Vec3> = {}
  const branches = data.path_segments.map((segment, segment_idx) => {
    const { start_index, end_index, start_label, end_label } = segment
    if (start_index < 0 || end_index < start_index || end_index >= data.qpoints.length) {
      throw new Error(
        `Phonon path segment ${segment_idx} has invalid bounds ${start_index}–${end_index} for ${data.qpoints.length} q-points`,
      )
    }
    if (start_label) {
      labels_by_index.set(start_index, start_label)
      labels_dict[start_label] = data.qpoints[start_index].q_position
    }
    if (end_label) {
      labels_by_index.set(end_index, end_label)
      labels_dict[end_label] = data.qpoints[end_index].q_position
    }
    return {
      start_index,
      end_index,
      name:
        start_label && end_label
          ? `${start_label}-${end_label}`
          : `segment-${segment_idx + 1}`,
    }
  })
  const qpoints: QPoint[] = data.qpoints.map(({ q_position, distance }, qpoint_idx) => ({
    label: labels_by_index.get(qpoint_idx) ?? null,
    frac_coords: q_position,
    distance: distance ?? undefined,
  }))
  const distance = data.qpoints.map(({ distance: qpoint_distance }) => {
    if (qpoint_distance === null) throw new Error(`Phonon band path contains a null distance`)
    return qpoint_distance
  })
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
    distance,
    nb_bands: bands.length,
    bands,
    has_imaginary_modes: bands.some((band) => band.some((frequency) => frequency < 0)),
  }
}

const multiply_complex = (left: Complex, right: Complex): Complex => [
  left[0] * right[0] - left[1] * right[1],
  left[0] * right[1] + left[1] * right[0],
]

const complex_phase = (angle: number): Complex => [Math.cos(angle), Math.sin(angle)]

// Maximum norm attained by Re(vector * exp(-i phase)) over one phase cycle.
function complex_vector_max_norm(vector: Complex[]): number {
  let real_norm_sq = 0
  let imag_norm_sq = 0
  let real_imag_dot = 0
  for (const [real_part, imag_part] of vector) {
    real_norm_sq += real_part ** 2
    imag_norm_sq += imag_part ** 2
    real_imag_dot += real_part * imag_part
  }
  const discriminant = Math.hypot(real_norm_sq - imag_norm_sq, 2 * real_imag_dot)
  return Math.sqrt(Math.max(0, (real_norm_sq + imag_norm_sq + discriminant) / 2))
}

function validate_selection(
  data: PhononModeData,
  selection: PhononModeSelection,
): NonNullable<(typeof data.qpoints)[number][`modes`][number][`eigenvector`]> {
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
  return mode.eigenvector
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
  const eigenvector = validate_selection(data, selection)
  if (eigenvector.length !== data.n_atoms) {
    throw new Error(
      `Phonon eigenvector has ${eigenvector.length} atom blocks but mode data declares ${data.n_atoms}`,
    )
  }
  const qpoint = data.qpoints[selection.qpoint_idx]
  const mode = qpoint.modes[selection.mode_idx]
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
      pbc: [true, true, true],
      ...math.calc_lattice_params(data.lattice),
    },
    properties: {
      phonon_q_position: qpoint.q_position,
      phonon_frequency: mode.frequency,
      phonon_mode_idx: selection.mode_idx,
    },
  }
  const equilibrium = make_supercell(unit_cell, scaling, false)
  const supercell_cart_to_frac = math.create_cart_to_frac(equilibrium.lattice.matrix)
  const n_cells = scaling[0] * scaling[1] * scaling[2]

  let anchor: Complex = [1, 0]
  let anchor_magnitude = -1
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
  const mass_scaled = eigenvector.map((atom_vector, atom_idx) => {
    const { mass } = data.atoms[atom_idx]
    if (!Number.isFinite(mass) || mass <= 0) {
      throw new Error(`Phonon atom ${atom_idx} has invalid mass ${mass}`)
    }
    const mass_scale = 1 / Math.sqrt(mass * n_cells)
    return atom_vector.map(
      ([real_part, imag_part]): Complex => [real_part * mass_scale, imag_part * mass_scale],
    )
  })
  const anchor_rotation = complex_phase(-Math.atan2(anchor[1], anchor[0]))
  const phase_anchored = mass_scaled.map((atom_vector) =>
    atom_vector.map((component) => multiply_complex(component, anchor_rotation)),
  )

  const cell_points = generate_lattice_points(scaling)
  const complex_displacements: Complex[][] = []
  for (const cell_point of cell_points) {
    for (const [atom_idx, atom_vector] of phase_anchored.entries()) {
      const atom_position = math.add(cell_point, data.atoms[atom_idx].coordinates)
      const spatial_angle = 2 * Math.PI * math.dot(qpoint.q_position, atom_position)
      const spatial_phase = complex_phase(spatial_angle)
      complex_displacements.push(
        atom_vector.map((component) => multiply_complex(component, spatial_phase)),
      )
    }
  }
  const max_excursion = Math.max(...complex_displacements.map(complex_vector_max_norm))
  if (!(max_excursion > 0)) throw new Error(`Phonon eigenvector has zero maximum excursion`)
  const amplitude_scale = amplitude / max_excursion

  const frames = Array.from({ length: n_frames }, (_, frame_idx) => {
    const phase = (2 * Math.PI * frame_idx) / n_frames
    const cos_phase = Math.cos(phase)
    const sin_phase = Math.sin(phase)
    const frame_sites = equilibrium.sites.map((site, site_idx) => {
      const displacement = complex_displacements[site_idx].map(
        ([real_part, imag_part]) =>
          amplitude_scale * (real_part * cos_phase + imag_part * sin_phase),
      ) as Vec3
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
      metadata: { phase, frequency: mode.frequency, q_position: qpoint.q_position },
    }
  })

  return {
    frames,
    metadata: {
      amplitude,
      frequency: mode.frequency,
      mode_idx: selection.mode_idx,
      qpoint_idx: selection.qpoint_idx,
      q_position: qpoint.q_position,
      supercell: scaling,
      is_commensurate: is_commensurate_phonon_supercell(qpoint.q_position, scaling),
    },
  }
}
