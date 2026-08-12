// Parsers for phonopy mode data (frequencies + eigenvectors) and Born effective charges.
//
// These are deliberately separate from `$lib/structure/parse.ts`, which only extracts cells
// from phonopy YAML and explicitly discards the per-mode blocks we need here.
//
// Eigenvector convention (phonopy): the `eigenvector` blocks in band.yaml / qpoints.yaml /
// mesh.yaml are eigenvectors of the mass-weighted (dynamical) matrix, normalised so that
// sum over atoms and cartesian directions of |e|^2 == 1. The physical displacement of atom
// kappa is u_kappa = e_kappa / sqrt(M_kappa). Nothing here undoes that weighting; consumers
// that need displacements must divide by sqrt(mass) themselves.

import { load as yaml_load } from 'js-yaml'
import type { Matrix3x3, Vec3 } from '$lib/math'
import type {
  BornChargeData,
  PhononMode,
  PhononModeAtom,
  PhononModeData,
  PhononPathSegment,
  PhononQPointModes,
} from './types'

// Tolerance on sum |e|^2 == 1 for a parsed eigenvector. phonopy writes ~14 significant
// digits, so anything beyond this is a malformed or non-normalised file, not round-off.
const EIGENVECTOR_NORM_TOL = 1e-3

const is_finite_number = (val: unknown): val is number =>
  typeof val === `number` && Number.isFinite(val)

const is_record = (val: unknown): val is Record<string, unknown> =>
  val !== null && typeof val === `object` && !Array.isArray(val)

// Read exactly `len` finite numbers out of an unknown value, else throw with context.
// Shared by the YAML and BORN paths, which both consume fixed-length numeric rows.
function to_number_tuple(val: unknown, len: number, context: string): number[] {
  if (!Array.isArray(val) || val.length !== len) {
    const got = Array.isArray(val) ? `array of length ${val.length}` : typeof val
    throw new Error(`${context}: expected ${len} numbers, got ${got}`)
  }
  return val.map((entry, idx) => {
    if (!is_finite_number(entry)) {
      throw new Error(`${context}: entry ${idx} is not a finite number (got ${String(entry)})`)
    }
    return entry
  })
}

const to_vec3 = (val: unknown, context: string): Vec3 =>
  to_number_tuple(val, 3, context) as Vec3

function parse_matrix3x3(val: unknown, context: string): Matrix3x3 | null {
  if (val === undefined) return null
  if (!Array.isArray(val) || val.length !== 3) {
    const rows = Array.isArray(val) ? val.length : typeof val
    throw new Error(`${context}: expected 3 rows, got ${rows}`)
  }
  return val.map((row, row_idx) => to_vec3(row, `${context} row ${row_idx}`)) as Matrix3x3
}

function parse_path_segments(
  data: Record<string, unknown>,
  n_qpoints: number,
): PhononPathSegment[] {
  const raw_lengths = data.segment_nqpoint
  const raw_labels = data.labels
  if (raw_lengths === undefined && raw_labels === undefined) return []
  if (!Array.isArray(raw_lengths) || raw_lengths.length === 0) {
    throw new Error(`phonopy YAML 'segment_nqpoint' must be a non-empty list`)
  }
  const lengths = raw_lengths.map((length, segment_idx) => {
    if (!is_finite_number(length) || !Number.isInteger(length) || length <= 0) {
      throw new Error(
        `phonopy YAML segment_nqpoint[${segment_idx}] must be a positive integer, got ${String(length)}`,
      )
    }
    return length
  })
  const declared_total = lengths.reduce((sum, length) => sum + length, 0)
  if (declared_total !== n_qpoints) {
    throw new Error(
      `phonopy YAML segment_nqpoint sums to ${declared_total} but phonon lists ${n_qpoints} q-points`,
    )
  }

  let labels: [string | null, string | null][] = lengths.map(() => [null, null])
  if (raw_labels !== undefined) {
    if (!Array.isArray(raw_labels) || raw_labels.length !== lengths.length) {
      const count = Array.isArray(raw_labels) ? raw_labels.length : typeof raw_labels
      throw new Error(
        `phonopy YAML 'labels' must contain one pair for each of ${lengths.length} path segments, got ${count}`,
      )
    }
    labels = raw_labels.map((pair, segment_idx) => {
      if (
        !Array.isArray(pair) ||
        pair.length !== 2 ||
        pair.some((label) => typeof label !== `string` || label.length === 0)
      ) {
        throw new Error(
          `phonopy YAML labels[${segment_idx}] must contain two non-empty strings`,
        )
      }
      return pair as [string, string]
    })
  }

  let start_index = 0
  return lengths.map((length, segment_idx) => {
    const [start_label, end_label] = labels[segment_idx]
    const segment = {
      start_index,
      end_index: start_index + length - 1,
      start_label,
      end_label,
    }
    start_index += length
    return segment
  })
}

// One [real, imaginary] pair as written by phonopy. A bare number is accepted for the
// real-only shorthand some post-processing tools emit.
const to_complex = (val: unknown, context: string): [number, number] =>
  is_finite_number(val) ? [val, 0] : (to_number_tuple(val, 2, context) as [number, number])

// Parse one mode's eigenvector block: a list over atoms, each a list of 3 [re, im] pairs.
function parse_eigenvector(
  val: unknown,
  n_atoms: number,
  context: string,
): [number, number][][] {
  if (!Array.isArray(val) || val.length !== n_atoms) {
    const got = Array.isArray(val) ? `${val.length} atom blocks` : typeof val
    throw new Error(
      `${context}: 'eigenvector' must be a list over ${n_atoms} atoms, got ${got}`,
    )
  }
  return val.map((atom_block, atom_idx) => {
    if (!Array.isArray(atom_block) || atom_block.length !== 3) {
      throw new Error(`${context}: eigenvector atom ${atom_idx} needs 3 cartesian components`)
    }
    return atom_block.map((component, dir_idx) =>
      to_complex(component, `${context}: eigenvector atom ${atom_idx} component ${dir_idx}`),
    )
  })
}

// Squared norm sum |e|^2 over all atoms and cartesian directions.
export const eigenvector_norm_sq = (eigenvector: [number, number][][]): number =>
  eigenvector.flat().reduce((acc, [re_part, im_part]) => acc + re_part ** 2 + im_part ** 2, 0)

// phonopy writes cells either as `points` (current) with `coordinates`, or as `atoms`
// (legacy) with `position`. Both carry `symbol` and `mass`.
function parse_atoms(data: Record<string, unknown>): PhononModeAtom[] {
  const raw_points = data.points ?? data.atoms
  if (!Array.isArray(raw_points) || raw_points.length === 0) {
    const keys = Object.keys(data).join(`, `)
    throw new Error(
      `phonopy YAML has no 'points'/'atoms' list with per-atom masses (top-level keys: ${keys}). ` +
        `Mass weighting cannot be undone without it.`,
    )
  }
  return raw_points.map((point, atom_idx) => {
    if (!is_record(point)) throw new Error(`phonopy YAML atom ${atom_idx} is not a mapping`)
    const { symbol, mass } = point
    if (typeof symbol !== `string` || symbol.length === 0) {
      throw new Error(`phonopy YAML atom ${atom_idx} has no 'symbol'`)
    }
    if (!is_finite_number(mass) || mass <= 0) {
      throw new Error(
        `phonopy YAML atom ${atom_idx} (${symbol}) has invalid 'mass' (got ${String(mass)})`,
      )
    }
    const coords = point.coordinates ?? point.position
    return {
      symbol,
      mass,
      coordinates: to_vec3(coords, `phonopy YAML atom ${atom_idx} (${symbol}) coordinates`),
    }
  })
}

// Parse a phonopy band.yaml / qpoints.yaml / mesh.yaml into per-q-point mode lists.
// Frequencies are returned in the file's own unit, which phonopy writes as THz.
export function parse_phonon_modes(content: string): PhononModeData {
  const parsed: unknown = yaml_load(content)
  if (!is_record(parsed)) throw new Error(`phonopy YAML did not parse to a mapping`)

  const atoms = parse_atoms(parsed)
  const n_atoms = atoms.length
  if (is_finite_number(parsed.natom) && parsed.natom !== n_atoms) {
    throw new Error(`phonopy YAML declares natom=${parsed.natom} but lists ${n_atoms} atoms`)
  }

  const raw_phonon = parsed.phonon
  if (!Array.isArray(raw_phonon) || raw_phonon.length === 0) {
    const keys = Object.keys(parsed).join(`, `)
    throw new Error(
      `phonopy YAML has no non-empty 'phonon' list (top-level keys: ${keys}). ` +
        `Expected band.yaml / qpoints.yaml / mesh.yaml style content.`,
    )
  }

  const qpoints: PhononQPointModes[] = raw_phonon.map((entry, q_idx) => {
    if (!is_record(entry)) throw new Error(`phonopy YAML phonon[${q_idx}] is not a mapping`)
    const q_position = to_vec3(entry[`q-position`], `phonopy YAML phonon[${q_idx}] q-position`)
    const raw_band = entry.band
    if (!Array.isArray(raw_band) || raw_band.length === 0) {
      throw new Error(`phonopy YAML phonon[${q_idx}] has no non-empty 'band' list`)
    }

    const modes: PhononMode[] = raw_band.map((band_entry, mode_idx) => {
      const context = `phonopy YAML phonon[${q_idx}].band[${mode_idx}]`
      if (!is_record(band_entry)) throw new Error(`${context} is not a mapping`)
      const { frequency } = band_entry
      if (!is_finite_number(frequency)) {
        throw new Error(`${context}: 'frequency' is not a finite number`)
      }
      if (band_entry.eigenvector === undefined) return { frequency, eigenvector: null }
      const eigenvector = parse_eigenvector(band_entry.eigenvector, n_atoms, context)
      const norm_sq = eigenvector_norm_sq(eigenvector)
      if (Math.abs(norm_sq - 1) > EIGENVECTOR_NORM_TOL) {
        throw new Error(
          `${context}: eigenvector is not normalised (sum |e|^2 = ${norm_sq}, expected 1 ` +
            `within ${EIGENVECTOR_NORM_TOL})`,
        )
      }
      return { frequency, eigenvector }
    })

    if (modes.length !== 3 * n_atoms) {
      throw new Error(
        `phonopy YAML phonon[${q_idx}] lists ${modes.length} bands but a ${n_atoms}-atom cell ` +
          `has 3N = ${3 * n_atoms} modes`,
      )
    }

    return {
      q_position,
      distance: is_finite_number(entry.distance) ? entry.distance : null,
      modes,
    }
  })

  if (qpoints.every(({ modes }) => modes.every((mode) => !mode.eigenvector))) {
    throw new Error(
      `phonopy YAML contains frequencies but no 'eigenvector' blocks. Re-run phonopy with ` +
        `eigenvectors enabled (band.conf: EIGENVECTORS = .TRUE., or 'phonopy --eigenvectors').`,
    )
  }

  if (parsed.nqpoint !== undefined) {
    if (!is_finite_number(parsed.nqpoint) || !Number.isInteger(parsed.nqpoint)) {
      throw new Error(
        `phonopy YAML 'nqpoint' must be an integer, got ${JSON.stringify(parsed.nqpoint)}`,
      )
    }
    if (parsed.nqpoint !== qpoints.length) {
      throw new Error(
        `phonopy YAML declares nqpoint=${parsed.nqpoint} but lists ${qpoints.length} q-points`,
      )
    }
  }

  const lattice = parse_matrix3x3(parsed.lattice, `phonopy YAML 'lattice'`)
  const reciprocal_lattice = parse_matrix3x3(
    parsed.reciprocal_lattice,
    `phonopy YAML 'reciprocal_lattice'`,
  )
  const path_segments = parse_path_segments(parsed, qpoints.length)
  if (
    path_segments.length > 0 &&
    qpoints.some(({ distance }) => distance === null || !Number.isFinite(distance))
  ) {
    throw new Error(`phonopy band path contains a q-point without a finite 'distance'`)
  }

  return { n_atoms, atoms, lattice, reciprocal_lattice, qpoints, path_segments }
}

// Strip phonopy BORN comments (everything from '#') and blank lines, then tokenise.
const tokenize_born = (content: string): number[][] =>
  content
    .split(/\r?\n/)
    .map((line) => line.split(`#`)[0].trim())
    .filter((line) => line.length > 0)
    .map((line, line_idx) =>
      line.split(/\s+/).map((token) => {
        const value = Number(token)
        if (!Number.isFinite(value)) {
          throw new TypeError(`BORN file line ${line_idx + 1}: '${token}' is not a number`)
        }
        return value
      }),
    )

const to_matrix3x3 = (values: number[], context: string): Matrix3x3 => {
  const row_major = to_number_tuple(values, 9, `${context} (row-major 3x3)`)
  return [row_major.slice(0, 3), row_major.slice(3, 6), row_major.slice(6, 9)] as Matrix3x3
}

// Parse a phonopy BORN file. Format (after comment stripping):
//   line 1: NAC unit conversion factor, optionally followed by a q-direction (1-4 numbers)
//   line 2: high-frequency dielectric tensor, 9 numbers row-major
//   line 3+: Born effective charge tensor per atom, 9 numbers row-major
// Symmetry expansion over equivalent sites is NOT performed: the file must list one tensor
// per atom of the cell the eigenvectors belong to.
export function parse_born(content: string): BornChargeData {
  const lines = tokenize_born(content)
  if (lines.length < 3) {
    throw new Error(
      `BORN file has ${lines.length} data lines; need at least 3 (factor, dielectric, ` +
        `>=1 Born charge tensor)`,
    )
  }

  const [factor_line, dielectric_line, ...charge_lines] = lines
  if (factor_line.length > 4) {
    throw new Error(
      `BORN file line 1 has ${factor_line.length} numbers; expected the NAC unit conversion ` +
        `factor (optionally followed by a q-direction). A leading 9-number dielectric tensor ` +
        `without a factor line is not the phonopy BORN format.`,
    )
  }

  return {
    factor: factor_line[0],
    dielectric: to_matrix3x3(dielectric_line, `BORN file dielectric tensor`),
    born_charges: charge_lines.map((line, atom_idx) =>
      to_matrix3x3(line, `BORN file Born charge tensor for atom ${atom_idx}`),
    ),
  }
}

// Residual of the acoustic sum rule sum over atoms of Z*_kappa, which must vanish for a
// charge-neutral cell. Returned as a 3x3 tensor so callers can inspect the violation.
export function born_charge_sum(born_charges: Matrix3x3[]): Matrix3x3 {
  const total = [0, 1, 2].map(() => [0, 0, 0]) as Matrix3x3
  for (const charge of born_charges) {
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) total[row][col] += charge[row][col]
    }
  }
  return total
}

// Enforce the acoustic sum rule by distributing the residual equally over all atoms.
// Opt-in: parsing never silently corrects charges, since a large residual usually signals
// an unconverged calculation rather than round-off.
export function apply_born_sum_rule(born_charges: Matrix3x3[]): Matrix3x3[] {
  if (born_charges.length === 0) throw new Error(`apply_born_sum_rule: no Born charges given`)
  const residual = born_charge_sum(born_charges)
  const n_atoms = born_charges.length
  const shift = (row: number[], row_idx: number) =>
    row.map((val, col_idx) => val - residual[row_idx][col_idx] / n_atoms)
  return born_charges.map((charge) => charge.map(shift) as Matrix3x3)
}
