import { display_idx } from '#lib/labels.js'
import type { ElementSymbol } from '#lib/element/types.js'
import * as math from '#lib/math.js'
import { LineScanner } from '#lib/structure/parsers/shared.js'
import type { Pbc } from '#lib/structure/pbc.js'
import type { AtomTypeMapping, TrajectoryFrame } from '#lib/trajectory/index.js'
import { element_from_lammps_type, symbol_to_atomic_number } from '#lib/element/helpers.js'
import { element_for_mass } from '#lib/element/data.js'
import {
  create_plot_row_frame,
  create_trajectory_frame,
  elem_symbol_from_token,
  holds_numbers,
  TextLines,
} from '#lib/trajectory/helpers.js'
import type { AseFrames } from './ase'
import {
  create_numeric_md_frame,
  encode_frame,
  type NumericFrame,
  write_frame_vector,
} from '../frame'
import type { ParsedTrajectory, WarnFn } from './shared'

const is_periodic = (token: string): boolean => token.toLowerCase().startsWith(`p`)

const POS_COL_VARIANTS = [
  { keys: [`xu`, `yu`, `zu`], scaled: false, unwrapped: true },
  { keys: [`xsu`, `ysu`, `zsu`], scaled: true, unwrapped: true },
  { keys: [`xs`, `ys`, `zs`], scaled: true, unwrapped: false },
  { keys: [`x`, `y`, `z`], scaled: false, unwrapped: false },
] as const

const LAMMPS_VECTOR_GROUPS = [
  { key: `velocity`, col_names: [`vx`, `vy`, `vz`] },
  { key: `force`, col_names: [`fx`, `fy`, `fz`] },
] as const

const NON_SCALAR_COLS: ReadonlySet<string> = new Set([
  ...POS_COL_VARIANTS.flatMap(({ keys }) => keys),
  `element`,
])

const LAMMPS_COLUMN_ALIASES: Record<string, string> = { q: `charge` }

type LammpsBoxKind = `orthogonal` | `restricted_triclinic` | `general_triclinic`

function parse_lammps_box(
  box_lines: string[],
  box_kind: LammpsBoxKind,
): { lattice_matrix: math.Matrix3x3; origin: math.Vec3 } | null {
  if (box_lines.length !== 3) return null
  const bounds = box_lines.map((line) => line.split(/\s+/).map(Number))
  const min_cols = box_kind === `orthogonal` ? 2 : box_kind === `restricted_triclinic` ? 3 : 4
  if (bounds.some((row) => row.length < min_cols || row.slice(0, min_cols).some(isNaN))) {
    return null
  }

  if (box_kind === `orthogonal`) {
    const [[lo_x, hi_x], [lo_y, hi_y], [lo_z, hi_z]] = bounds
    return {
      lattice_matrix: [
        [hi_x - lo_x, 0, 0],
        [0, hi_y - lo_y, 0],
        [0, 0, hi_z - lo_z],
      ],
      origin: [lo_x, lo_y, lo_z],
    }
  }
  if (box_kind === `general_triclinic`) {
    return {
      lattice_matrix: bounds.map((row) => row.slice(0, 3)) as math.Matrix3x3,
      origin: [bounds[0][3], bounds[1][3], bounds[2][3]],
    }
  }
  const [[xlo_b, xhi_b, coords_xy], [ylo_b, yhi_b, tilt_xz], [zlo_b, zhi_b, tilt_yz]] = bounds
  const xlo = xlo_b - Math.min(0, coords_xy, tilt_xz, coords_xy + tilt_xz)
  const xhi = xhi_b - Math.max(0, coords_xy, tilt_xz, coords_xy + tilt_xz)
  const ylo = ylo_b - Math.min(0, tilt_yz)
  const yhi = yhi_b - Math.max(0, tilt_yz)
  const length_z = zhi_b - zlo_b
  return {
    lattice_matrix: [
      [xhi - xlo, 0, 0],
      [coords_xy, yhi - ylo, 0],
      [tilt_xz, tilt_yz, length_z],
    ],
    origin: [xlo, ylo, zlo_b],
  }
}

// A frame read_run drops with a warning instead of failing the dump: a torn final frame (the
// writer is still appending; the same damage anywhere else is corruption), or with `torn`
// false one whose coordinates LAMMPS printed as `nan`/`inf` after an MD blow-up (as XYZ skips)
class SkippedLammpsFrameError extends Error {
  torn: boolean
  constructor(message: string, torn = true) {
    super(message)
    this.name = 'SkippedLammpsFrameError'
    this.torn = torn
  }
}

type LammpsFrameHeader = {
  timestep: number
  pbc: Pbc
  lattice_matrix: math.Matrix3x3
  metadata: Record<string, unknown>
}
// How much of each atom a frame read checks and keeps: past the first frame only the first and
// last atom line (the indexed open's scan), elements only (plot rows), Site records (the eager
// parser), or packed columns (the indexed run's numeric frames)
type LammpsSites = `sample` | `none` | `records` | `columns`
// Per-atom values packed in file order: 3 per atom for positions and vectors, 1 for scalars.
// `dense` is false once any vector or scalar value is missing or non-finite.
type LammpsColumns = {
  positions: Float64Array
  vector_keys: string[]
  vectors: Float64Array[]
  scalar_keys: string[]
  scalars: Float64Array[]
  dense: boolean
}
// One frame as read from the dump, atoms in file order. `positions` and `site_properties`
// are filled only for `records`, `columns` only for `columns`; `ids` is empty without an id
// column.
type LammpsFrameRead = {
  header: LammpsFrameHeader
  elements: ElementSymbol[]
  ids: number[]
  positions: math.Vec3[]
  site_properties: Record<string, unknown>[]
  columns?: LammpsColumns
  // deferred for sampled reads
  merge_guesses: () => void
}

// Frame order: by atom id when the dump has ids, so every frame lists atoms in one order.
// Null when the file order already is that order (no ids, or ids written ascending, as
// `dump_modify sort id` and serial runs do), sparing a sort and a permuted copy per column.
const atom_order = ({ ids }: LammpsFrameRead): number[] | null => {
  if (is_ascending(ids)) return null
  const order = Array.from({ length: ids.length }, (_unused, atom_idx) => atom_idx)
  order.sort((left_idx, right_idx) => ids[left_idx] - ids[right_idx])
  return order
}
const is_ascending = (ids: readonly number[]): boolean => {
  for (let idx = 1; idx < ids.length; idx++) if (!(ids[idx] > ids[idx - 1])) return false
  return true
}

// Frames sorted by atom id (when the dump has ids) so every frame lists atoms in one order
const lammps_frame = (read: LammpsFrameRead, warn: WarnFn): TrajectoryFrame => {
  const { header, elements, positions, site_properties } = read
  const order = atom_order(read)
  const sorted = <Value>(values: Value[]): Value[] =>
    order ? order.map((atom_idx) => values[atom_idx]) : values
  return create_trajectory_frame(
    sorted(positions),
    sorted(elements),
    header.lattice_matrix,
    header.pbc,
    header.timestep,
    header.metadata,
    sorted(site_properties),
    warn,
  )
}

// The numeric frame encode_frame makes of lammps_frame's, built from a `columns` read without
// Site records or per-atom arrays. Null when that encoding would keep per-site records
// instead: a missing value, an element without atomic number, or property keys that do not
// map one-to-one onto columns.
const lammps_numeric_frame = (read: LammpsFrameRead, warn: WarnFn): NumericFrame | null => {
  const { header, elements, columns } = read
  if (!columns?.dense) return null
  const keys = [...columns.vector_keys, ...columns.scalar_keys]
  // a record's integer-like keys enumerate first, which would reorder its vector columns
  if (new Set(keys).size !== keys.length || keys.some((key) => /^\d+$|^__proto__$/.test(key)))
    return null
  const order = atom_order(read)
  const n_atoms = elements.length
  const numbers = new Uint8Array(n_atoms)
  // the read's columns are its own, so file order hands them over as they are
  const permute = (values: Float64Array, width: number): Float64Array => {
    if (!order) return values
    const sorted = new Float64Array(values.length)
    for (let idx = 0; idx < n_atoms; idx++)
      for (let axis = 0; axis < width; axis++)
        sorted[idx * width + axis] = values[order[idx] * width + axis]
    return sorted
  }
  for (let idx = 0; idx < n_atoms; idx++) {
    const atomic_number = symbol_to_atomic_number(elements[order ? order[idx] : idx])
    if (!atomic_number) return null
    numbers[idx] = atomic_number
  }
  const frame = create_numeric_md_frame(
    permute(columns.positions, 3),
    numbers,
    header.lattice_matrix,
    header.pbc,
    header.timestep,
    header.metadata,
    columns.vector_keys,
    { fixed_order: false, warn },
  )
  columns.vectors.forEach((values, column) =>
    write_frame_vector(frame, column, permute(values, 3)),
  )
  if (columns.scalar_keys.length === 0) return frame
  const scalar_columns = Object.fromEntries(
    columns.scalar_keys.map((key, column) => [key, permute(columns.scalars[column], 1)]),
  )
  return { ...frame, scalar_columns }
}

// Frame reader over the dump's lines with the state frames share: `read_frame` reads the frame
// starting at line `start` (an `ITEM: TIME...` line) with every check, `read_run` all of them.
function create_lammps_reader(
  lines: TextLines,
  warn: WarnFn,
  atom_type_mapping?: AtomTypeMapping,
) {
  // LAMMPS atom types are bare integers whose meaning lives in the input script, not the
  // dump. An element per atom resolves as: the caller's atom_type_mapping (explicit intent),
  // then an `element` column (`dump_modify element Si O`), then atomic number N like ASE's
  // read_lammps_dump and the LAMMPS data parser; the guess warns once per file so a Si/O dump
  // showing up as H/He is traceable.
  const guessed_types = new Set<number>()
  const reported_guesses = new Set<number>()
  // warns the guesses not yet reported: all of them after an eager parse, new ones per indexed read
  const warn_guesses = (): void => {
    const unreported = [...guessed_types].filter(
      (atom_type) => !reported_guesses.has(atom_type),
    )
    if (unreported.length === 0) return
    for (const atom_type of unreported) reported_guesses.add(atom_type)
    const guesses = math
      .sorted_numbers(unreported)
      .map((atom_type) => `${atom_type}→${element_from_lammps_type(atom_type)}`)
    warn(
      `LAMMPS dump names no element for some atom types; read them as atomic numbers (${guesses.join(`, `)}). Pass atom_type_mapping (e.g. { 1: 'Si', 2: 'O' }) to name them.`,
    )
  }
  let identity_uses_ids: boolean | undefined
  const scanner = new LineScanner()
  let idx = 0

  const read_line = (): string => lines.line(idx++)?.trim() ?? ``
  const peek_line = (): string => lines.line(idx)?.trim() ?? ``
  // Header sections cut off by the end of the file are a torn tail; anything else missing
  // mid-file is corruption.
  const require_section = (prefix: string, timestep: number | null): void => {
    while (idx < lines.count && !peek_line().startsWith(prefix)) {
      if (peek_line().startsWith(`ITEM: TIME`)) {
        throw new Error(
          `LAMMPS frame at timestep ${timestep} is missing "${prefix}" before line ${idx + 1}`,
        )
      }
      idx++
    }
    if (idx < lines.count) return
    throw new SkippedLammpsFrameError(
      `LAMMPS frame${timestep === null ? `` : ` at timestep ${timestep}`} ends before "${prefix}"`,
    )
  }

  const read_frame = (
    start: number,
    has_previous_frame: boolean,
    sites: LammpsSites,
  ): LammpsFrameRead => {
    idx = start
    let time: number | null = null
    if (peek_line() === `ITEM: TIME`) {
      idx++
      const parsed = Number(read_line())
      time = Number.isFinite(parsed) ? parsed : null
      require_section(`ITEM: TIMESTEP`, null)
    }
    const timestep_line = idx + 2
    idx++
    const timestep_text = read_line()
    const timestep = Number(timestep_text)
    if (!Number.isInteger(timestep)) {
      throw new TypeError(
        `Invalid LAMMPS timestep "${timestep_text}" at line ${timestep_line}`,
      )
    }

    require_section(`ITEM: NUMBER OF ATOMS`, timestep)
    idx++
    const num_atoms_text = read_line()
    const num_atoms = Math.trunc(Number(num_atoms_text))
    if (!(num_atoms > 0)) {
      if (idx > lines.count) {
        throw new SkippedLammpsFrameError(
          `LAMMPS frame at timestep ${timestep} ends after "ITEM: NUMBER OF ATOMS"`,
        )
      }
      throw new Error(
        `Invalid LAMMPS atom count "${num_atoms_text}" at timestep ${timestep} (line ${idx})`,
      )
    }

    require_section(`ITEM: BOX BOUNDS`, timestep)
    const box_header = read_line()
    const box_kind: LammpsBoxKind = /BOX BOUNDS\s+abc\s+origin/i.test(box_header)
      ? `general_triclinic`
      : /BOX BOUNDS\s+xy\s+xz\s+yz/i.test(box_header)
        ? `restricted_triclinic`
        : `orthogonal`
    // The trailing three tokens are boundary flags only when they read as flags. A triclinic
    // header with none appended (`ITEM: BOX BOUNDS xy xz yz`) put `xy xz yz` here instead, none
    // of which starts with `p`, so the frame came out fully aperiodic and rendered with no
    // periodic images. Current LAMMPS always writes the flags; third-party writers need not.
    const tokens = box_header.replace(`ITEM: BOX BOUNDS`, ``).trim().split(/\s+/).slice(-3)
    const are_flags = tokens.length === 3 && tokens.every((token) => /^[pfsm]/i.test(token))
    const pbc: Pbc = are_flags
      ? [is_periodic(tokens[0]), is_periodic(tokens[1]), is_periodic(tokens[2])]
      : [true, true, true]

    const box_line = idx + 1
    const box_lines = [read_line(), read_line(), read_line()]
    const parsed_box = parse_lammps_box(box_lines, box_kind)
    if (!parsed_box) {
      if (idx >= lines.count) {
        throw new SkippedLammpsFrameError(
          `LAMMPS frame at timestep ${timestep} ends inside BOX BOUNDS`,
        )
      }
      throw new Error(
        `Invalid LAMMPS ${box_kind.replace(`_`, ` `)} BOX BOUNDS at timestep ${timestep} (lines ${box_line}-${box_line + 2}): ${box_lines.join(` | `)}`,
      )
    }
    const { lattice_matrix, origin: box_origin } = parsed_box

    require_section(`ITEM: ATOMS`, timestep)
    const cols = read_line().replace(`ITEM: ATOMS`, ``).trim().toLowerCase().split(/\s+/)
    // A header with no atom line after it is a torn tail, possibly cut inside its own column
    // list, so it is not validated as a frame that declares too few columns
    if (idx >= lines.count) {
      throw new SkippedLammpsFrameError(
        `LAMMPS frame at timestep ${timestep} ends after its "ITEM: ATOMS" header`,
      )
    }
    // A repeated name silently let the LAST index win, so `id type x y z x` read the trailing
    // column as the x coordinate. Every other malformed header here throws rather than guess.
    const duplicate = cols.find((name, col_idx) => cols.indexOf(name) !== col_idx)
    if (duplicate) {
      throw new Error(
        `LAMMPS frame at timestep ${timestep} declares column "${duplicate}" more than once in "ITEM: ATOMS ${cols.join(
          ` `,
        )}"`,
      )
    }
    const col = Object.fromEntries(cols.map((name, col_idx) => [name, col_idx]))

    const pos_variant = POS_COL_VARIANTS.find(({ keys }) => keys.every((key) => key in col))
    if (!pos_variant) {
      throw new Error(
        `LAMMPS frame at timestep ${timestep} has no position columns (x y z, xs ys zs, xu yu zu or xsu ysu zsu) in "ITEM: ATOMS ${cols.join(` `)}"`,
      )
    }
    const [x_col, y_col, z_col] = pos_variant.keys.map((key) => col[key])
    // Image flags turn wrapped coordinates into LAMMPS's own unwrapped ones, x + ix·a + iy·b +
    // iz·c. Without them MSD/VACF fall back to the frame-to-frame minimum image, which is
    // wrong for any atom that moves more than half a box between dumps.
    const image_cols = [`ix`, `iy`, `iz`].map((name) => col[name])
    const use_images =
      !pos_variant.unwrapped && image_cols.every((col_idx) => col_idx !== undefined)
    const type_col = col.type
    const element_col = col.element
    const mass_col = col.mass
    const id_col = col.id
    if (type_col === undefined && element_col === undefined && mass_col === undefined) {
      throw new Error(
        `LAMMPS frame at timestep ${timestep} has no type, element or mass column in "ITEM: ATOMS ${cols.join(` `)}"`,
      )
    }

    const vector_props = LAMMPS_VECTOR_GROUPS.filter(({ col_names }) =>
      col_names.every((name) => name in col),
    ).map(({ key, col_names }) => ({ key, indices: col_names.map((name) => col[name]) }))
    const scalar_props = cols.flatMap((name, col_idx) =>
      NON_SCALAR_COLS.has(name) ||
      vector_props.some(({ indices }) => indices.includes(col_idx))
        ? []
        : [{ key: LAMMPS_COLUMN_ALIASES[name] ?? name, col_idx }],
    )

    const elements: ElementSymbol[] = []
    const ids: number[] = []
    const positions: math.Vec3[] = []
    const site_properties: Record<string, unknown>[] = []
    const frac_to_cart = pos_variant.scaled ? math.create_frac_to_cart(lattice_matrix) : null
    const columns: LammpsColumns | undefined =
      sites === `columns`
        ? {
            positions: new Float64Array(num_atoms * 3),
            vector_keys: vector_props.map(({ key }) => key),
            vectors: vector_props.map(() => new Float64Array(num_atoms * 3)),
            scalar_keys: scalar_props.map(({ key }) => key),
            scalars: scalar_props.map(() => new Float64Array(num_atoms)),
            dense: true,
          }
        : undefined
    const scratch: math.Vec3 = [0, 0, 0]
    // merged only once the frame passes, so a skipped or failed frame adds no guess
    const frame_guesses = new Set<number>()
    // Skipping atom lines by count is safe only when the next frame (or the end) follows them;
    // a miscounted frame is read through to fail at the eager parse's line
    const atoms_end = idx + num_atoms
    const sampled =
      sites === `sample` &&
      has_previous_frame &&
      (atoms_end === lines.count ||
        /^ITEM: (?:TIME|UNITS)/.test(lines.line(atoms_end)?.trim() ?? ``))

    for (let atom = 0; atom < num_atoms; atom++) {
      if (sampled && atom === 1) {
        idx += num_atoms - 2
        atom = num_atoms - 1
      }
      if (idx >= lines.count) {
        throw new SkippedLammpsFrameError(
          `LAMMPS frame at timestep ${timestep} ends after ${atom} of ${num_atoms} atoms`,
        )
      }
      const line_number = idx + 1
      const n_cols = lines.scan(scanner, idx++)
      // A malformed last line after at least one complete frame is a half-written tail, not
      // corruption; a lone frame still reports the line so the problem is visible
      const torn_tail = idx >= lines.count && has_previous_frame
      if (n_cols < cols.length) {
        const message = `LAMMPS atom line ${line_number} (timestep ${timestep}) has ${n_cols} columns, expected ${cols.length}`
        throw torn_tail ? new SkippedLammpsFrameError(message) : new Error(message)
      }
      const coords: math.Vec3 = [scanner.num(x_col), scanner.num(y_col), scanner.num(z_col)]
      if (
        !Number.isFinite(coords[0]) ||
        !Number.isFinite(coords[1]) ||
        !Number.isFinite(coords[2])
      ) {
        const line = lines.line(idx - 1)
        if (holds_numbers(scanner, [x_col, y_col, z_col]))
          throw new SkippedLammpsFrameError(
            `at timestep ${timestep}: line ${line_number} "${line}"`,
            false,
          )
        const message = `LAMMPS atom line ${line_number} (timestep ${timestep}) has non-numeric coordinates: "${line}"`
        throw torn_tail ? new SkippedLammpsFrameError(message) : new TypeError(message)
      }
      let atom_type: number | undefined
      if (type_col !== undefined) {
        atom_type = scanner.num(type_col)
        if (!Number.isInteger(atom_type) || atom_type <= 0) {
          throw new TypeError(
            `LAMMPS atom line ${line_number} (timestep ${timestep}) has invalid type "${scanner.str(type_col)}"`,
          )
        }
      }
      // Some tools fill `element` with type labels (`Type1`, `2`), and coarse-grained or
      // isotope masses miss every standard atomic weight, so each source may come up empty
      let element_symbol = atom_type === undefined ? undefined : atom_type_mapping?.[atom_type]
      if (!element_symbol && element_col !== undefined)
        element_symbol = elem_symbol_from_token(scanner.str(element_col))
      // a per-atom mass (`dump custom ... mass`) names elements as a data file's Masses do
      if (!element_symbol && mass_col !== undefined)
        element_symbol = element_for_mass(scanner.num(mass_col)) ?? undefined
      if (!element_symbol) {
        if (atom_type === undefined) {
          const tried = [
            element_col === undefined ? `` : `element "${scanner.str(element_col)}"`,
            mass_col === undefined ? `` : `mass "${scanner.str(mass_col)}"`,
          ].filter(Boolean)
          throw new Error(
            `LAMMPS atom line ${line_number} (timestep ${timestep}) names no element (${tried.join(`, `)}) and has no type column to fall back on`,
          )
        }
        frame_guesses.add(atom_type)
        element_symbol = element_from_lammps_type(atom_type)
      }
      elements.push(element_symbol)
      // the only property column that can fail a frame
      if (id_col !== undefined) {
        const atom_id = scanner.num(id_col)
        if (!Number.isInteger(atom_id) || atom_id <= 0) {
          throw new Error(
            `LAMMPS atom line ${line_number} (timestep ${timestep}) has invalid ID "${scanner.str(id_col)}"`,
          )
        }
        ids.push(atom_id)
      }
      // checked before the elements-only skip, so the open and plot rows check it too
      const img_x = use_images ? scanner.num(image_cols[0]) : 0
      const img_y = use_images ? scanner.num(image_cols[1]) : 0
      const img_z = use_images ? scanner.num(image_cols[2]) : 0
      if (!Number.isInteger(img_x) || !Number.isInteger(img_y) || !Number.isInteger(img_z)) {
        throw new TypeError(
          `LAMMPS atom line ${line_number} (timestep ${timestep}) has non-integer image flags: "${lines.line(idx - 1)}"`,
        )
      }
      if (sites === `none` || sites === `sample`) continue
      // columns copy the position out, so they reuse one scratch vector
      const position: math.Vec3 = columns ? scratch : [0, 0, 0]
      if (frac_to_cart) frac_to_cart(coords, position)
      else {
        position[0] = coords[0] - box_origin[0]
        position[1] = coords[1] - box_origin[1]
        position[2] = coords[2] - box_origin[2]
      }
      if (use_images) {
        const [vec_a, vec_b, vec_c] = lattice_matrix
        for (let axis = 0; axis < 3; axis++) {
          // same left-to-right sum as three `+=`, so unwrapping stays bit-identical
          position[axis] =
            position[axis] + img_x * vec_a[axis] + img_y * vec_b[axis] + img_z * vec_c[axis]
        }
      }
      if (columns) {
        const offset = atom * 3
        columns.positions.set(position, offset)
        for (let column = 0; column < vector_props.length; column++) {
          const { indices } = vector_props[column]
          const values = columns.vectors[column]
          for (let axis = 0; axis < 3; axis++) {
            const value = scanner.num(indices[axis])
            if (!Number.isFinite(value)) columns.dense = false
            values[offset + axis] = value
          }
        }
        for (let column = 0; column < scalar_props.length; column++) {
          const value = scanner.num(scalar_props[column].col_idx)
          if (!Number.isFinite(value)) columns.dense = false
          columns.scalars[column][atom] = value
        }
        continue
      }
      positions.push(position)

      const props: Record<string, unknown> = {}
      for (const { key, indices } of vector_props) {
        const vec = [scanner.num(indices[0]), scanner.num(indices[1]), scanner.num(indices[2])]
        if (Number.isFinite(vec[0]) && Number.isFinite(vec[1]) && Number.isFinite(vec[2])) {
          props[key] = vec
        }
      }
      for (const { key, col_idx } of scalar_props) {
        const value = scanner.num(col_idx)
        if (Number.isFinite(value)) props[key] = value
      }
      site_properties.push(props)
    }

    const frame_uses_ids = id_col !== undefined
    if (identity_uses_ids !== undefined && frame_uses_ids !== identity_uses_ids) {
      throw new Error(
        `LAMMPS frame at timestep ${timestep} ${frame_uses_ids ? `gained` : `lost`} the atom ID column; atom identity must be tracked the same way in every frame`,
      )
    }
    // ascending ids cannot repeat, so only an unsorted frame needs the set
    if (!is_ascending(ids) && new Set(ids).size !== ids.length) {
      throw new Error(`LAMMPS frame at timestep ${timestep} has duplicate atom IDs`)
    }
    identity_uses_ids ??= frame_uses_ids
    const merge_guesses = (): void => {
      for (const atom_type of frame_guesses) guessed_types.add(atom_type)
    }
    // a sampled frame merges only once it survives the run's last-frame checks
    if (sites !== `sample`) merge_guesses()
    const metadata = {
      coords_unwrapped: pos_variant.unwrapped || use_images,
      box_origin,
      ...(time === null ? {} : { time }),
    }
    const header = { timestep, pbc, lattice_matrix, metadata }
    return { header, elements, ids, positions, site_properties, columns, merge_guesses }
  }

  // Hands each frame, from the top of the dump, to `on_frame` (a torn final frame is dropped
  // with a warning), then makes the run-level checks and warnings in the eager order and
  // returns the kept frames' starts
  const read_run = (
    sites: LammpsSites,
    on_frame?: (read: LammpsFrameRead, start: number) => void,
  ): number[] => {
    const steps: number[] = []
    const starts: number[] = []
    const merges: (() => void)[] = []
    // a blow-up leaves every later frame non-finite, so they share one warning naming the
    // earliest in the file
    const non_finite = { count: 0, first: ``, start: Infinity }
    const skip_non_finite = (error: SkippedLammpsFrameError, start: number): void => {
      if (start < non_finite.start) Object.assign(non_finite, { first: error.message, start })
      non_finite.count++
    }
    // A sampled frame may hide a non-finite line eager skips it for (the partial frame that
    // starts a blow-up), so the last kept frame is read in full where the run's shape hinges on it
    const last_hides_non_finite = (): SkippedLammpsFrameError | null => {
      if (sites !== `sample` || starts.length < 2) return null
      const resume = idx
      try {
        read_frame(starts[starts.length - 1], true, `none`)
        return null
      } catch (error) {
        if (!(error instanceof SkippedLammpsFrameError)) throw error
        return error
      } finally {
        idx = resume
      }
    }
    idx = 0
    for (;;) {
      while (idx < lines.count && !peek_line().startsWith(`ITEM: TIME`)) idx++
      if (idx >= lines.count) break
      const start = idx
      try {
        const read = read_frame(start, steps.length > 0, sites)
        const { timestep } = read.header
        // A restarted run appending to its dump writes the restart step again: keep the first
        // (eager keeps this copy when it skipped the first as non-finite)
        if (timestep === steps.at(-1)) {
          const error = last_hides_non_finite()
          if (error) {
            skip_non_finite(error, starts[starts.length - 1])
            starts[starts.length - 1] = start
            merges[merges.length - 1] = read.merge_guesses
          } else
            warn(`Skipping LAMMPS frame at line ${start + 1} repeating timestep ${timestep}`)
          continue
        }
        on_frame?.(read, start)
        steps.push(timestep)
        starts.push(start)
        merges.push(read.merge_guesses)
      } catch (error) {
        if (!(error instanceof SkippedLammpsFrameError)) throw error
        if (error.torn) {
          warn(`Dropping truncated final LAMMPS frame`, error)
          break
        }
        skip_non_finite(error, start)
      }
    }
    // a blow-up's partial frames pass the samples and would end the indexed run unreadable
    for (let error = last_hides_non_finite(); error; error = last_hides_non_finite()) {
      skip_non_finite(error, starts[starts.length - 1])
      starts.pop()
      steps.pop()
      merges.pop()
    }
    for (const merge of merges) merge()
    if (non_finite.count > 0)
      warn(
        `Skipping ${non_finite.count} LAMMPS frame(s) with non-finite coordinates, the first ${non_finite.first}`,
      )
    if (steps.length === 0) {
      throw new Error(`No valid frames found in LAMMPS trajectory`)
    }
    warn_guesses()
    if (steps.length > 1 && identity_uses_ids === false) {
      warn(
        `LAMMPS dump has no atom ID column; frames display as written but atom identity cannot be verified across frames, so displacement analyses may be meaningless`,
      )
    }
    for (let frame_idx = 1; frame_idx < steps.length; frame_idx++) {
      if (!(steps[frame_idx] > steps[frame_idx - 1])) {
        throw new Error(
          `LAMMPS timestep ${steps[frame_idx]} at frame ${display_idx(frame_idx)} must be ` +
            `greater than ${steps[frame_idx - 1]} at frame ${frame_idx}`,
        )
      }
    }
    return starts
  }

  return { read_frame, read_run, warn_guesses }
}

export function parse_lammps_trajectory(
  content: string | TextLines,
  warn: WarnFn,
  atom_type_mapping?: AtomTypeMapping,
): ParsedTrajectory {
  const frames: TrajectoryFrame[] = []
  const reader = create_lammps_reader(TextLines.of(content), warn, atom_type_mapping)
  reader.read_run(`records`, (read) => frames.push(lammps_frame(read, warn)))
  return { format: `lammps`, frames, metadata: {} }
}

// Indexed LAMMPS dump: open makes the eager parser's header, framing and run-level checks but
// reads atom lines only of the first frame and the first and last of the rest (all of the last
// kept frame and of a frame a restart repeats, so a blow-up's partial frames are skipped as
// eager does, and its other defects fail the open), keeping each frame's start. A defect in
// any other atom line (including non-finite coordinates eager skips the frame for) fails that
// frame's read and plot row. Read-time warnings (type guesses first met, skipped plot rows)
// reach `warnings` only after the open, not the open-time banner. An atom count overshooting
// by exactly one following frame drops that frame where eager rejects.
export function open_lammps_frames(
  lines: TextLines,
  warn: WarnFn,
  atom_type_mapping?: AtomTypeMapping,
): AseFrames {
  const reader = create_lammps_reader(lines, warn, atom_type_mapping)
  const starts = reader.read_run(`sample`)
  const read_frame = (frame_idx: number, sites: LammpsSites): LammpsFrameRead => {
    try {
      return reader.read_frame(starts[frame_idx], frame_idx > 0, sites)
    } catch (error) {
      // the only skip a read can hit: a non-finite line between the open's samples
      if (error instanceof SkippedLammpsFrameError)
        throw new Error(`Non-finite LAMMPS coordinates ${error.message}`, { cause: error })
      throw error
    } finally {
      reader.warn_guesses()
    }
  }
  const decode = (frame_idx: number): TrajectoryFrame =>
    lammps_frame(read_frame(frame_idx, `records`), warn)
  // Plot rows repeating the previous row's species share its array: 10k frames of 10k atoms
  // otherwise kept 100 MB of copies, and the plot rows count one topology's elements once
  let previous: Uint8Array | null = null
  return {
    frame_count: starts.length,
    read: (frame_idx) =>
      lammps_numeric_frame(read_frame(frame_idx, `columns`), warn) ??
      encode_frame(decode(frame_idx)),
    decode,
    plot_row_frame: (frame_idx) => {
      const { header, elements } = read_frame(frame_idx, `none`)
      // 0 marks a symbol an atom_type_mapping gave no atomic number, whose plot row needs sites
      const numbers = new Uint8Array(
        elements.map((element) => symbol_to_atomic_number(element) ?? 0),
      )
      if (numbers.includes(0)) return decode(frame_idx)
      if (!previous || !math.same_values(previous, numbers)) previous = numbers
      const { lattice_matrix, pbc, timestep, metadata } = header
      return create_plot_row_frame(previous, lattice_matrix, pbc, timestep, metadata, warn)
    },
  }
}
