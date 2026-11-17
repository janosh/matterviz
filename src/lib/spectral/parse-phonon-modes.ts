// Parsers for phonopy mode data (frequencies + eigenvectors) and Born effective charges,
// separate from `#lib/structure/parse.ts`, which discards the per-mode blocks.
// Eigenvectors (phonopy convention) are of the mass-weighted dynamical matrix with
// sum |e|^2 == 1; atom kappa moves by u_kappa = e_kappa / sqrt(M_kappa). Nothing here undoes
// that weighting: consumers needing displacements divide by sqrt(mass) themselves.

import { is_plain_object } from 'svelte-widgets/utils'
import { display_idx } from '#lib/labels.js'
import { load as yaml_load } from 'js-yaml'
import type { Matrix3x3, Vec3 } from '#lib/math.js'
import type {
  BornChargeData,
  Complex,
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
const is_positive_int = (val: unknown): val is number =>
  Number.isInteger(val) && Number(val) > 0

// Read exactly `len` finite numbers out of an unknown value, else throw with context.
// Shared by the YAML and BORN paths, which both consume fixed-length numeric rows.
function to_number_tuple(val: unknown, len: number, context: string): number[] {
  if (!Array.isArray(val) || val.length !== len) {
    const got = Array.isArray(val) ? `array of length ${val.length}` : typeof val
    throw new Error(`${context}: expected ${len} numbers, got ${got}`)
  }
  return val.map((entry, idx) => {
    if (!is_finite_number(entry))
      throw new Error(`${context}: entry ${idx} is not a finite number (got ${String(entry)})`)
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
  const { segment_nqpoint: raw_lengths, labels: raw_labels, npath: raw_npath } = data
  if (raw_lengths === undefined && raw_labels === undefined && raw_npath === undefined)
    return []
  if (!Array.isArray(raw_lengths) || raw_lengths.length === 0)
    throw new Error(`phonopy YAML 'segment_nqpoint' must be a non-empty list`)
  const lengths = raw_lengths.map((length, segment_idx) => {
    if (!is_positive_int(length))
      throw new Error(
        `phonopy YAML segment_nqpoint[${segment_idx}] must be a positive integer, got ${String(length)}`,
      )
    return length
  })
  if (raw_npath !== undefined) {
    if (!is_positive_int(raw_npath))
      throw new Error(
        `phonopy YAML 'npath' must be a positive integer, got ${JSON.stringify(raw_npath)}`,
      )
    if (raw_npath !== lengths.length)
      throw new Error(
        `phonopy YAML declares npath=${raw_npath} but segment_nqpoint lists ${lengths.length} path segments`,
      )
  }
  const declared_total = lengths.reduce((sum, length) => sum + length, 0)
  if (declared_total !== n_qpoints)
    throw new Error(
      `phonopy YAML segment_nqpoint sums to ${declared_total} but phonon lists ${n_qpoints} q-points`,
    )

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
      )
        throw new Error(
          `phonopy YAML labels[${segment_idx}] must contain two non-empty strings`,
        )
      return pair as [string, string]
    })
  }

  let end_index = -1
  return lengths.map((length, segment_idx) => {
    const [start_label, end_label] = labels[segment_idx]
    end_index += length
    return { start_index: end_index - length + 1, end_index, start_label, end_label }
  })
}

// One [real, imaginary] pair as written by phonopy. A bare number is accepted for the
// real-only shorthand some post-processing tools emit.
const to_complex = (val: unknown, context: string): Complex =>
  is_finite_number(val) ? [val, 0] : (to_number_tuple(val, 2, context) as Complex)

// Parse one mode's eigenvector block: a list over atoms, each a list of 3 [re, im] pairs.
function parse_eigenvector(val: unknown, n_atoms: number, context: string): Complex[][] {
  if (!Array.isArray(val) || val.length !== n_atoms) {
    const got = Array.isArray(val) ? `${val.length} atom blocks` : typeof val
    throw new Error(
      `${context}: 'eigenvector' must be a list over ${n_atoms} atoms, got ${got}`,
    )
  }
  return val.map((atom_block, atom_idx) => {
    if (!Array.isArray(atom_block) || atom_block.length !== 3)
      throw new Error(
        `${context}: eigenvector atom ${display_idx(atom_idx)} needs 3 cartesian components`,
      )
    return atom_block.map((component, dir_idx) =>
      to_complex(
        component,
        `${context}: eigenvector atom ${display_idx(atom_idx)} component ${display_idx(dir_idx)}`,
      ),
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
    const context = `phonopy YAML atom ${display_idx(atom_idx)}`
    if (!is_plain_object(point)) throw new Error(`${context} is not a mapping`)
    const { symbol, mass } = point
    if (typeof symbol !== `string` || symbol.length === 0)
      throw new Error(`${context} has no 'symbol'`)
    if (!is_finite_number(mass) || mass <= 0)
      throw new Error(`${context} (${symbol}) has invalid 'mass' (got ${String(mass)})`)
    const coords = point.coordinates ?? point.position
    return { symbol, mass, coordinates: to_vec3(coords, `${context} (${symbol}) coordinates`) }
  })
}

// Parse a phonopy band.yaml / mesh.yaml into per-q-point mode lists (qpoints.yaml lacks the
// atom masses that undo the mass weighting).
// Frequencies are returned in the file's own unit, which phonopy writes as THz.
export function parse_phonon_modes(content: string): PhononModeData {
  const parsed: unknown = yaml_load(content)
  if (!is_plain_object(parsed)) throw new Error(`phonopy YAML did not parse to a mapping`)

  const atoms = parse_atoms(parsed)
  const n_atoms = atoms.length
  if (is_finite_number(parsed.natom) && parsed.natom !== n_atoms)
    throw new Error(`phonopy YAML declares natom=${parsed.natom} but lists ${n_atoms} atoms`)

  const raw_phonon = parsed.phonon
  if (!Array.isArray(raw_phonon) || raw_phonon.length === 0) {
    const keys = Object.keys(parsed).join(`, `)
    throw new Error(
      `phonopy YAML has no non-empty 'phonon' list (top-level keys: ${keys}). ` +
        `Expected band.yaml / mesh.yaml style content.`,
    )
  }

  const qpoints: PhononQPointModes[] = raw_phonon.map((entry, q_idx) => {
    if (!is_plain_object(entry))
      throw new Error(`phonopy YAML phonon[${q_idx}] is not a mapping`)
    const q_position = to_vec3(entry[`q-position`], `phonopy YAML phonon[${q_idx}] q-position`)
    const raw_band = entry.band
    if (!Array.isArray(raw_band) || raw_band.length === 0)
      throw new Error(`phonopy YAML phonon[${q_idx}] has no non-empty 'band' list`)

    const modes: PhononMode[] = raw_band.map((band_entry, mode_idx) => {
      const context = `phonopy YAML phonon[${q_idx}].band[${mode_idx}]`
      if (!is_plain_object(band_entry)) throw new Error(`${context} is not a mapping`)
      const { frequency } = band_entry
      if (!is_finite_number(frequency))
        throw new Error(`${context}: 'frequency' is not a finite number`)
      if (band_entry.eigenvector === undefined) return { frequency, eigenvector: null }
      const eigenvector = parse_eigenvector(band_entry.eigenvector, n_atoms, context)
      const norm_sq = eigenvector_norm_sq(eigenvector)
      if (Math.abs(norm_sq - 1) > EIGENVECTOR_NORM_TOL)
        throw new Error(
          `${context}: eigenvector is not normalised (sum |e|^2 = ${norm_sq}, expected 1 ` +
            `within ${EIGENVECTOR_NORM_TOL})`,
        )
      return { frequency, eigenvector }
    })

    if (modes.length !== 3 * n_atoms)
      throw new Error(
        `phonopy YAML phonon[${q_idx}] lists ${modes.length} bands but a ${n_atoms}-atom cell ` +
          `has 3N = ${3 * n_atoms} modes`,
      )

    const distance = is_finite_number(entry.distance) ? entry.distance : null
    return { q_position, distance, modes }
  })

  if (qpoints.every(({ modes }) => modes.every((mode) => !mode.eigenvector)))
    throw new Error(
      `phonopy YAML contains frequencies but no 'eigenvector' blocks. Re-run phonopy with ` +
        `eigenvectors enabled (band.conf: EIGENVECTORS = .TRUE., or 'phonopy --eigenvectors').`,
    )

  if (parsed.nqpoint !== undefined) {
    if (!is_finite_number(parsed.nqpoint) || !Number.isInteger(parsed.nqpoint))
      throw new Error(
        `phonopy YAML 'nqpoint' must be an integer, got ${JSON.stringify(parsed.nqpoint)}`,
      )
    if (parsed.nqpoint !== qpoints.length)
      throw new Error(
        `phonopy YAML declares nqpoint=${parsed.nqpoint} but lists ${qpoints.length} q-points`,
      )
  }

  const lattice = parse_matrix3x3(parsed.lattice, `phonopy YAML 'lattice'`)
  const path_segments = parse_path_segments(parsed, qpoints.length)
  if (path_segments.length > 0 && qpoints.some(({ distance }) => distance === null))
    throw new Error(`phonopy band path contains a q-point without a finite 'distance'`)

  return { n_atoms, atoms, lattice, qpoints, path_segments }
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
        if (!Number.isFinite(value))
          throw new TypeError(`BORN file line ${line_idx + 1}: '${token}' is not a number`)
        return value
      }),
    )

const to_matrix3x3 = (values: number[], context: string): Matrix3x3 => {
  const row_major = to_number_tuple(values, 9, `${context} (row-major 3x3)`)
  return [row_major.slice(0, 3), row_major.slice(3, 6), row_major.slice(6, 9)] as Matrix3x3
}

// Parse a phonopy BORN file. Lines (after comment stripping): the NAC unit conversion factor
// (optionally with G_cutoff and Lambda), the high-frequency dielectric tensor, then one Born
// effective charge tensor per atom (9 numbers row-major each).
// phonopy's own writer (phonopy-vasp-born) puts a `# epsilon and Z* of atoms 1 3 …` comment in
// the factor line's place: factor null, so the calculator's default applies. It lists only the
// symmetry-independent atoms (1-based), which are not expanded here: a comment naming fewer
// than the first n atoms throws, so the file must hold one tensor per atom of the cell.
export function parse_born(content: string): BornChargeData {
  const lines = tokenize_born(content)
  const n_lines = lines.length
  const comment_factor = lines[0]?.length === 9 && content.trimStart().startsWith(`#`)
  const factor_line = comment_factor ? undefined : lines.shift()
  const [dielectric_line, ...charge_lines] = lines
  if (!dielectric_line || charge_lines.length === 0) {
    const expected = comment_factor
      ? `2 after phonopy's comment line (dielectric, >=1 Born charge tensor)`
      : `3 (factor, dielectric, >=1 Born charge tensor)`
    throw new Error(`BORN file has ${n_lines} data lines; need at least ${expected}`)
  }
  if (factor_line && factor_line.length > 4)
    throw new Error(
      `BORN file line 1 has ${factor_line.length} numbers; expected the NAC unit conversion ` +
        `factor (optionally followed by G_cutoff and Lambda) or phonopy's leading comment ` +
        `line. A leading 9-number dielectric tensor without either is not the BORN format.`,
    )
  const atoms_comment = /^#\s*epsilon and Z\* of atoms\s+(?<atoms>[\d\s]+?)\s*$/i.exec(
    content.trimStart().split(/\r?\n/)[0],
  )?.groups?.atoms
  const atom_indices = atoms_comment?.split(/\s+/).map((atom) => Number(atom) - 1)
  const n_charges = charge_lines.length
  if (atom_indices && atom_indices.join(`,`) !== [...Array(n_charges).keys()].join(`,`))
    throw new Error(
      `BORN file's comment names atoms ${atoms_comment} for its ${n_charges} Z* tensors, not ` +
        `atoms 1 to ${n_charges}: phonopy writes only the symmetry-independent atoms, and ` +
        `expanding them to the whole cell needs its symmetry, which is unsupported. Write one ` +
        `tensor per atom.`,
    )

  return {
    factor: factor_line?.[0] ?? null,
    dielectric: to_matrix3x3(dielectric_line, `BORN file dielectric tensor`),
    born_charges: charge_lines.map((line, atom_idx) =>
      to_matrix3x3(line, `BORN file Born charge tensor for atom ${display_idx(atom_idx)}`),
    ),
    ...(atom_indices && { atom_indices }),
  }
}

// Residual of the acoustic sum rule sum over atoms of Z*_kappa, which must vanish for a
// charge-neutral cell. Returned as a 3x3 tensor so callers can inspect the violation.
export const born_charge_sum = (born_charges: Matrix3x3[]): Matrix3x3 =>
  [0, 1, 2].map((row) =>
    [0, 1, 2].map((col) => born_charges.reduce((sum, charge) => sum + charge[row][col], 0)),
  ) as Matrix3x3

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
