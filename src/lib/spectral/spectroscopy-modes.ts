import { is_elem_symbol } from '$lib/element/helpers'
import { THZ_TO_INVERSE_CM } from '$lib/constants'
import * as math from '$lib/math'
import type { Vec3 } from '$lib/math'
import { make_site, type AnyStructure, type Crystal } from '$lib/structure'
import type { TrajectoryType } from '$lib/trajectory'
import { SvelteMap, SvelteSet } from 'svelte/reactivity'
import {
  complex_conjugate_product,
  complex_mode_displacement_frames,
  complex_phase,
  multiply_complex,
} from './complex-mode'
import type { Complex, PhononModeData } from './types'
import type {
  HarmonicModeMatch,
  TrajectorySpectroscopyResult,
} from './trajectory-spectroscopy'

export interface TrajectoryModeTrajectoryOptions {
  amplitude?: number
  n_frames?: number
  vector_key?: string
}

export interface HarmonicAtomMapping {
  primitive_atom_idx: number
  cell_translation: Vec3
}

export interface HarmonicMatchOptions {
  atom_mapping?: HarmonicAtomMapping[]
  minimum_overlap?: number
  degeneracy_tolerance_thz?: number
}

const mapping_key = ({ primitive_atom_idx, cell_translation }: HarmonicAtomMapping): string =>
  `${primitive_atom_idx}:${cell_translation.join(`,`)}`
// Normal-mode eigenvectors from a Hermitian dynamical matrix should be orthogonal to
// numerical precision. This leaves ample room above f64 solver noise without admitting
// a material duplicate contribution to a reported subspace overlap.
const HARMONIC_ORTHOGONALITY_TOLERANCE = 1e-6

// Build one phase cycle of an MD-extracted complex displacement.
export function trajectory_mode_trajectory(
  result: TrajectorySpectroscopyResult,
  peak_idx: number,
  options: TrajectoryModeTrajectoryOptions = {},
): TrajectoryType {
  const { amplitude = 0.3, n_frames = 48, vector_key = `spectroscopy_displacement` } = options
  const peak = result.peaks[peak_idx]
  if (!peak) throw new Error(`Spectroscopy peak ${peak_idx} does not exist`)
  if (!peak.displacement) {
    throw new Error(
      peak.displacement_unavailable_reason ??
        `Spectroscopy peak ${peak_idx} has no MD displacement`,
    )
  }
  const lattice = result.reference_lattice
  const cart_to_frac = lattice ? math.create_cart_to_frac(lattice) : null
  const sites = result.reference_positions.map((xyz_values, atom_idx) => {
    const element = result.elements[atom_idx]
    if (!is_elem_symbol(element))
      throw new Error(`Unknown element '${element}' at atom ${atom_idx}`)
    const xyz = xyz_values as Vec3
    return make_site(
      element,
      cart_to_frac ? cart_to_frac(xyz) : ([...xyz] as Vec3),
      [...xyz] as Vec3,
      `${element}${atom_idx + 1}`,
    )
  })
  const equilibrium: AnyStructure = lattice
    ? ({
        sites,
        lattice: { matrix: lattice, pbc: result.pbc, ...math.calc_lattice_params(lattice) },
      } satisfies Crystal)
    : { sites }
  const displacement_frames = complex_mode_displacement_frames(peak.displacement, {
    amplitude,
    n_frames,
    label: `Spectroscopy peak ${peak_idx}`,
    time_dependence: `exp_positive_i_phase`,
  })
  const frames = displacement_frames.map(({ phase, displacements }, frame_idx) => {
    const frame_sites = equilibrium.sites.map((site, atom_idx) => {
      const displacement = displacements[atom_idx]
      const xyz = math.add(site.xyz, displacement)
      return {
        ...site,
        xyz,
        abc: cart_to_frac ? cart_to_frac(xyz) : ([...xyz] as Vec3),
        properties: { ...site.properties, [vector_key]: displacement },
      }
    })
    return {
      structure: { ...equilibrium, sites: frame_sites },
      step: frame_idx,
      metadata: { phase, frequency: peak.frequency, frequency_unit: result.frequency_unit },
    }
  })
  return {
    frames,
    metadata: {
      amplitude,
      frequency: peak.frequency,
      frequency_unit: result.frequency_unit,
      peak_idx,
    },
  }
}

const default_mapping = (
  result: TrajectorySpectroscopyResult,
  harmonic: PhononModeData,
): HarmonicAtomMapping[] => {
  if (result.elements.length !== harmonic.n_atoms) {
    throw new Error(
      `MD trajectory has ${result.elements.length} atoms but harmonic data has ` +
        `${harmonic.n_atoms}; provide atom_mapping for a supercell`,
    )
  }
  return result.elements.map((element, atom_idx) => {
    if (harmonic.atoms[atom_idx]?.symbol !== element) {
      throw new Error(
        `Atom ${atom_idx} is ${element} in MD but ${harmonic.atoms[atom_idx]?.symbol} in ` +
          `harmonic data; provide an explicit atom_mapping`,
      )
    }
    return { primitive_atom_idx: atom_idx, cell_translation: [0, 0, 0] }
  })
}

const diagonal_supercell_scaling = (
  supercell_lattice: NonNullable<TrajectorySpectroscopyResult[`reference_lattice`]>,
  primitive_lattice: NonNullable<PhononModeData[`lattice`]>,
): Vec3 => {
  const scaling = primitive_lattice.map((primitive_vector, axis) => {
    const denominator = math.dot(primitive_vector, primitive_vector)
    const ratio = math.dot(supercell_lattice[axis], primitive_vector) / denominator
    const integer_ratio = Math.round(ratio)
    const residual = Math.hypot(
      ...supercell_lattice[axis].map(
        (value, component_idx) => value - integer_ratio * primitive_vector[component_idx],
      ),
    )
    const scale = Math.max(1, Math.hypot(...supercell_lattice[axis]))
    if (integer_ratio < 1 || residual > 1e-7 * scale) {
      throw new Error(
        `Automatic atom mapping only supports uniquely identifiable diagonal supercells; ` +
          `lattice vector ${axis} is not an integer multiple of its primitive vector`,
      )
    }
    return integer_ratio
  })
  return scaling as Vec3
}

const infer_diagonal_mapping = (
  result: TrajectorySpectroscopyResult,
  harmonic: PhononModeData,
): HarmonicAtomMapping[] => {
  if (!result.reference_lattice || !harmonic.lattice) {
    throw new Error(
      `MD trajectory has ${result.elements.length} atoms but harmonic data has ` +
        `${harmonic.n_atoms}; provide atom_mapping because lattice-based inference is unavailable`,
    )
  }
  const scaling = diagonal_supercell_scaling(result.reference_lattice, harmonic.lattice)
  const n_cells = scaling.reduce((total, value) => total * value, 1)
  if (result.elements.length !== harmonic.n_atoms * n_cells) {
    throw new Error(
      `Diagonal supercell scaling [${scaling.join(`, `)}] implies ` +
        `${harmonic.n_atoms * n_cells} atoms, got ${result.elements.length}`,
    )
  }
  const cart_to_primitive = math.create_cart_to_frac(harmonic.lattice)
  const md_fractional = result.reference_positions.map((position) =>
    cart_to_primitive(position as Vec3),
  )
  const anchor_element = result.elements[0]
  const anchor_candidates = harmonic.atoms
    .map((atom, primitive_atom_idx) => ({ atom, primitive_atom_idx }))
    .filter(({ atom }) => atom.symbol === anchor_element)
  const unique_mappings = new SvelteMap<string, HarmonicAtomMapping[]>()
  let ambiguous_candidates = false
  for (const { atom: anchor, primitive_atom_idx: anchor_idx } of anchor_candidates) {
    const shift = md_fractional[0].map((value, axis) => {
      const difference = value - anchor.coordinates[axis]
      return difference - Math.round(difference)
    })
    const mapping: HarmonicAtomMapping[] = []
    let valid = true
    for (const [atom_idx, fractional] of md_fractional.entries()) {
      const candidates = harmonic.atoms.flatMap((atom, primitive_atom_idx) => {
        if (atom.symbol !== result.elements[atom_idx]) return []
        const differences = fractional.map(
          (value, axis) => value - atom.coordinates[axis] - shift[axis],
        )
        const translation = differences.map(Math.round) as Vec3
        return differences.every(
          (difference, axis) => Math.abs(difference - translation[axis]) <= 1e-6,
        )
          ? [{ primitive_atom_idx, cell_translation: translation }]
          : []
      })
      if (candidates.length !== 1) {
        if (candidates.length > 1) ambiguous_candidates = true
        valid = false
        break
      }
      mapping.push(candidates[0])
    }
    if (!valid || mapping[0]?.primitive_atom_idx !== anchor_idx) continue
    const minima = ([0, 1, 2] as const).map((axis) =>
      math.array_min(mapping.map(({ cell_translation }) => cell_translation[axis])),
    )
    const canonical = mapping.map(({ primitive_atom_idx, cell_translation }) => ({
      primitive_atom_idx,
      cell_translation: cell_translation.map((value, axis) => value - minima[axis]) as Vec3,
    }))
    const translations_fit = canonical.every(({ cell_translation }) =>
      cell_translation.every((value, axis) => value >= 0 && value < scaling[axis]),
    )
    const canonical_keys = canonical.map(mapping_key)
    if (!translations_fit || new SvelteSet(canonical_keys).size !== canonical.length) continue
    unique_mappings.set(canonical_keys.join(`;`), canonical)
  }
  if (unique_mappings.size !== 1) {
    throw new Error(
      `Automatic diagonal-supercell atom mapping is ${
        unique_mappings.size === 0 && !ambiguous_candidates ? `invalid` : `ambiguous`
      }; provide an explicit atom_mapping`,
    )
  }
  return [...unique_mappings.values()][0]
}

const supercell_scaling = (mapping: HarmonicAtomMapping[]): Vec3 => {
  const values = ([0, 1, 2] as const).map((axis) => {
    const translations = mapping.map(({ cell_translation }) => cell_translation[axis])
    return math.array_max(translations) - math.array_min(translations) + 1
  })
  return values as Vec3
}

const validate_mapping = (
  result: TrajectorySpectroscopyResult,
  harmonic: PhononModeData,
  mapping: HarmonicAtomMapping[],
): Vec3 => {
  const unique_pairs = new SvelteSet<string>()
  const cells = new SvelteSet<string>()
  for (const [atom_idx, item] of mapping.entries()) {
    if (!Number.isInteger(item.primitive_atom_idx)) {
      throw new TypeError(
        `atom_mapping entry ${atom_idx} has a non-integer primitive atom index`,
      )
    }
    const harmonic_atom = harmonic.atoms[item.primitive_atom_idx]
    if (!harmonic_atom || harmonic_atom.symbol !== result.elements[atom_idx]) {
      throw new Error(`atom_mapping entry ${atom_idx} does not preserve atom identity`)
    }
    if (
      item.cell_translation.length !== 3 ||
      item.cell_translation.some(
        (translation) => !Number.isFinite(translation) || !Number.isInteger(translation),
      )
    ) {
      throw new TypeError(
        `atom_mapping entry ${atom_idx} must have exactly three integer cell translations`,
      )
    }
    const md_mass = result.masses[atom_idx]
    const mass_scale = Math.max(Math.abs(md_mass), Math.abs(harmonic_atom.mass), 1)
    if (Math.abs(md_mass - harmonic_atom.mass) > 1e-6 * mass_scale) {
      throw new Error(
        `atom_mapping entry ${atom_idx} has MD mass ${md_mass} but harmonic mass ` +
          `${harmonic_atom.mass}`,
      )
    }
    const cell_key = item.cell_translation.join(`,`)
    const pair_key = `${item.primitive_atom_idx}:${cell_key}`
    if (unique_pairs.has(pair_key)) {
      throw new Error(`atom_mapping contains duplicate primitive-atom/cell pair ${pair_key}`)
    }
    unique_pairs.add(pair_key)
    cells.add(cell_key)
  }
  const scaling = supercell_scaling(mapping)
  const expected_cells = scaling.reduce((total, value) => total * value, 1)
  if (cells.size !== expected_cells || mapping.length !== harmonic.n_atoms * expected_cells) {
    throw new Error(
      `atom_mapping must describe a complete diagonal supercell; scaling ` +
        `[${scaling.join(`, `)}] requires ${expected_cells} cells and ` +
        `${harmonic.n_atoms * expected_cells} mapped atoms`,
    )
  }
  return scaling
}

const frequency_from_thz = (
  frequency: number,
  unit: TrajectorySpectroscopyResult[`frequency_unit`],
): number => {
  if (unit === `THz`) return frequency
  if (unit === `cm^-1`) return frequency * THZ_TO_INVERSE_CM
  throw new Error(`Cannot compare harmonic THz frequencies with a 1/frame trajectory spectrum`)
}

const normalized_md_mode = (
  result: TrajectorySpectroscopyResult,
  displacement: Complex[][],
): Complex[] => {
  const flattened: Complex[] = []
  let norm_squared = 0
  for (const [atom_idx, atom_vector] of displacement.entries()) {
    const mass_scale = Math.sqrt(result.masses[atom_idx])
    for (const [real, imaginary] of atom_vector) {
      // extract_displacements stores forward-DFT coefficients. Conjugating recovers
      // the physical mode convention used by harmonic eigenvectors and Bloch phases.
      const component: Complex = [mass_scale * real, -mass_scale * imaginary]
      flattened.push(component)
      norm_squared += component[0] ** 2 + component[1] ** 2
    }
  }
  const norm = Math.sqrt(norm_squared)
  if (!(norm > 0)) throw new Error(`MD mode has zero mass-weighted norm`)
  return flattened.map(([real, imaginary]) => [real / norm, imaginary / norm])
}

const harmonic_overlap = (
  md_mode: Complex[],
  eigenvector: Complex[][],
  q_position: Vec3,
  mapping: HarmonicAtomMapping[],
  n_cells: number,
): number => {
  const expanded: Complex[] = []
  let harmonic_norm_squared = 0
  const cell_scale = 1 / Math.sqrt(n_cells)
  for (const { primitive_atom_idx, cell_translation } of mapping) {
    const atom_vector = eigenvector[primitive_atom_idx]
    if (!atom_vector)
      throw new Error(`Harmonic eigenvector lacks primitive atom ${primitive_atom_idx}`)
    const phase = complex_phase(2 * Math.PI * math.dot(q_position, cell_translation))
    for (const component of atom_vector) {
      const [real, imaginary] = multiply_complex(component, phase)
      const phased: Complex = [real * cell_scale, imaginary * cell_scale]
      expanded.push(phased)
      harmonic_norm_squared += phased[0] ** 2 + phased[1] ** 2
    }
  }
  if (expanded.length !== md_mode.length || !(harmonic_norm_squared > 0)) return 0
  let overlap_real = 0
  let overlap_imaginary = 0
  const harmonic_norm = Math.sqrt(harmonic_norm_squared)
  for (let component_idx = 0; component_idx < md_mode.length; component_idx++) {
    const product = complex_conjugate_product(md_mode[component_idx], expanded[component_idx])
    overlap_real += product[0] / harmonic_norm
    overlap_imaginary += product[1] / harmonic_norm
  }
  return overlap_real ** 2 + overlap_imaginary ** 2
}

const eigenvector_overlap = (left: Complex[][], right: Complex[][]): number => {
  if (left.length !== right.length) {
    throw new Error(
      `Degenerate harmonic eigenvectors have different atom counts ` +
        `(${left.length} and ${right.length})`,
    )
  }
  let overlap_real = 0
  let overlap_imaginary = 0
  let left_norm_squared = 0
  let right_norm_squared = 0
  for (let atom_idx = 0; atom_idx < left.length; atom_idx++) {
    const left_atom = left[atom_idx]
    const right_atom = right[atom_idx]
    if (left_atom.length !== right_atom.length) {
      throw new Error(
        `Degenerate harmonic eigenvectors differ at atom ${atom_idx}: ` +
          `${left_atom.length} and ${right_atom.length} components`,
      )
    }
    for (let component_idx = 0; component_idx < left_atom.length; component_idx++) {
      const left_component = left_atom[component_idx]
      const right_component = right_atom[component_idx]
      const product = complex_conjugate_product(left_component, right_component)
      overlap_real += product[0]
      overlap_imaginary += product[1]
      left_norm_squared += left_component[0] ** 2 + left_component[1] ** 2
      right_norm_squared += right_component[0] ** 2 + right_component[1] ** 2
    }
  }
  if (!(left_norm_squared > 0 && right_norm_squared > 0)) return 0
  return (
    Math.hypot(overlap_real, overlap_imaginary) /
    Math.sqrt(left_norm_squared * right_norm_squared)
  )
}

const validate_degenerate_eigenvectors = (
  mode_indices: number[],
  modes: PhononModeData[`qpoints`][number][`modes`],
  qpoint_idx: number,
): void => {
  for (let left_idx = 0; left_idx < mode_indices.length; left_idx++) {
    const left_mode_idx = mode_indices[left_idx]
    const left = modes[left_mode_idx]?.eigenvector
    if (!left) continue
    for (let right_idx = left_idx + 1; right_idx < mode_indices.length; right_idx++) {
      const right_mode_idx = mode_indices[right_idx]
      const right = modes[right_mode_idx]?.eigenvector
      if (!right) continue
      const overlap = eigenvector_overlap(left, right)
      if (overlap > HARMONIC_ORTHOGONALITY_TOLERANCE) {
        throw new Error(
          `Degenerate harmonic modes ${left_mode_idx} and ${right_mode_idx} at q-point ` +
            `${qpoint_idx} are not orthogonal (normalized overlap ${overlap}); ` +
            `orthonormalize the eigenvectors before matching`,
        )
      }
    }
  }
}

// Return a copy of the spectroscopy result with the top harmonic subspace matches attached
// to every detected peak. Frequency is displayed but never used as a substitute for overlap.
export function match_trajectory_modes_to_harmonic(
  result: TrajectorySpectroscopyResult,
  harmonic: PhononModeData,
  options: HarmonicMatchOptions = {},
): TrajectorySpectroscopyResult {
  const mapping =
    options.atom_mapping ??
    (result.elements.length === harmonic.n_atoms
      ? default_mapping(result, harmonic)
      : infer_diagonal_mapping(result, harmonic))
  if (mapping.length !== result.elements.length) {
    throw new Error(
      `atom_mapping has ${mapping.length} entries for ${result.elements.length} MD atoms`,
    )
  }
  const scaling = validate_mapping(result, harmonic, mapping)
  const n_cells = scaling.reduce((total, value) => total * value, 1)
  const minimum_overlap = options.minimum_overlap ?? 0.5
  const tolerance =
    options.degeneracy_tolerance_thz ??
    Math.max(
      0.01,
      result.vdos.rayleigh_resolution /
        (result.frequency_unit === `cm^-1` ? THZ_TO_INVERSE_CM : 1),
    )
  if (!Number.isFinite(minimum_overlap) || minimum_overlap < 0 || minimum_overlap > 1) {
    throw new Error(`minimum_overlap must be finite and between 0 and 1`)
  }
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error(`degeneracy_tolerance_thz must be finite and >= 0`)
  }
  const peaks = result.peaks.map((peak) => {
    if (!peak.displacement) return peak
    const md_mode = normalized_md_mode(result, peak.displacement)
    const matches: HarmonicModeMatch[] = []
    for (const [qpoint_idx, qpoint] of harmonic.qpoints.entries()) {
      const commensurate = qpoint.q_position.every(
        (coordinate, axis) =>
          Math.abs(coordinate * scaling[axis] - Math.round(coordinate * scaling[axis])) <=
          1e-8,
      )
      if (!commensurate) continue
      const groups: number[][] = []
      const indexed_modes = qpoint.modes
        .map((mode, mode_idx) => ({ mode, mode_idx }))
        .filter(({ mode }) => mode.eigenvector)
        .toSorted((left, right) => left.mode.frequency - right.mode.frequency)
      for (const { mode_idx, mode } of indexed_modes) {
        const group = groups.at(-1)
        const first_mode = group ? qpoint.modes[group[0]] : undefined
        if (
          group &&
          first_mode &&
          Math.abs(mode.frequency - first_mode.frequency) <= tolerance
        ) {
          group.push(mode_idx)
        } else groups.push([mode_idx])
      }
      for (const mode_indices of groups) {
        validate_degenerate_eigenvectors(mode_indices, qpoint.modes, qpoint_idx)
        const overlap = mode_indices.reduce((total, mode_idx) => {
          const eigenvector = qpoint.modes[mode_idx].eigenvector
          return (
            total +
            (eigenvector
              ? harmonic_overlap(md_mode, eigenvector, qpoint.q_position, mapping, n_cells)
              : 0)
          )
        }, 0)
        const frequency_thz =
          mode_indices.reduce(
            (total, mode_idx) => total + qpoint.modes[mode_idx].frequency,
            0,
          ) / mode_indices.length
        const frequency = frequency_from_thz(frequency_thz, result.frequency_unit)
        matches.push({
          qpoint_idx,
          mode_indices,
          frequency,
          frequency_difference: peak.frequency - frequency,
          overlap: Math.min(1, overlap),
          accepted: overlap >= minimum_overlap,
        })
      }
    }
    return {
      ...peak,
      harmonic_matches: matches
        .toSorted(
          (left, right) =>
            right.overlap - left.overlap ||
            Math.abs(left.frequency_difference) - Math.abs(right.frequency_difference),
        )
        .slice(0, 3),
    }
  })
  return { ...result, peaks }
}
