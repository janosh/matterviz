import type { ElementSymbol } from '$lib/element/types'
import * as math from '$lib/math'
import { LineScanner } from '$lib/structure/parsers/shared'
import type { Pbc } from '$lib/structure/pbc'
import type { AtomTypeMapping, TrajectoryFrame } from '$lib/trajectory/index'
import { element_from_lammps_type } from '$lib/element/helpers'
import {
  create_trajectory_frame,
  elem_symbol_from_token,
  split_lines,
} from '$lib/trajectory/helpers'
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
  const [[xlo_b, xhi_b, xy], [ylo_b, yhi_b, xz], [zlo_b, zhi_b, yz]] = bounds
  const xlo = xlo_b - Math.min(0, xy, xz, xy + xz)
  const xhi = xhi_b - Math.max(0, xy, xz, xy + xz)
  const ylo = ylo_b - Math.min(0, yz)
  const yhi = yhi_b - Math.max(0, yz)
  const lz = zhi_b - zlo_b
  return {
    lattice_matrix: [
      [xhi - xlo, 0, 0],
      [xy, yhi - ylo, 0],
      [xz, yz, lz],
    ],
    origin: [xlo, ylo, zlo_b],
  }
}

// Only the final frame of a dump may be incomplete (the writer is still appending); the
// same damage anywhere else is corruption and must not silently drop a frame.
class TornLammpsFrameError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TornLammpsFrameError'
  }
}

export function parse_lammps_trajectory(
  content: string,
  warn: WarnFn,
  atom_type_mapping?: AtomTypeMapping,
): ParsedTrajectory {
  const lines = split_lines(content)
  const frames: TrajectoryFrame[] = []
  const atom_types_found = new Set<number>()
  let identity_uses_ids: boolean | undefined
  let idx = 0

  const read_line = (): string => lines[idx++]?.trim() ?? ``
  const peek_line = (): string => lines[idx]?.trim() ?? ``
  const skip_to = (prefix: string): boolean => {
    while (idx < lines.length && !peek_line().startsWith(prefix)) idx++
    return idx < lines.length
  }
  // Header sections cut off by the end of the file are a torn tail; anything else missing
  // mid-file is corruption.
  const require_section = (prefix: string, timestep: number | null): void => {
    while (idx < lines.length && !peek_line().startsWith(prefix)) {
      if (peek_line().startsWith(`ITEM: TIME`)) {
        throw new Error(
          `LAMMPS frame at timestep ${timestep} is missing "${prefix}" before line ${idx + 1}`,
        )
      }
      idx++
    }
    if (idx < lines.length) return
    throw new TornLammpsFrameError(
      `LAMMPS frame${timestep === null ? `` : ` at timestep ${timestep}`} ends before "${prefix}"`,
    )
  }

  // LAMMPS atom types are bare integers whose meaning lives in the input script, not the
  // dump. An element per atom resolves as: the caller's atom_type_mapping (explicit intent),
  // then an `element` column (`dump_modify element Si O`), then atomic number N like ASE's
  // read_lammps_dump and the LAMMPS data parser; the guess warns once per file so a Si/O dump
  // showing up as H/He is traceable.
  const guessed_types = new Set<number>()
  const scanner = new LineScanner()

  const parse_frame = (): void => {
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
      if (idx > lines.length) {
        throw new TornLammpsFrameError(
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
      if (idx >= lines.length) {
        throw new TornLammpsFrameError(
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
    const type_col = col.type
    const element_col = col.element
    const id_col = col.id
    if (type_col === undefined && element_col === undefined) {
      throw new Error(
        `LAMMPS frame at timestep ${timestep} has neither a type nor an element column in "ITEM: ATOMS ${cols.join(` `)}"`,
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

    let positions: number[][] = []
    let elements: ElementSymbol[] = []
    let site_properties: Record<string, unknown>[] = []
    const frac_to_cart = pos_variant.scaled ? math.create_frac_to_cart(lattice_matrix) : null

    for (let atom = 0; atom < num_atoms; atom++) {
      if (idx >= lines.length) {
        throw new TornLammpsFrameError(
          `LAMMPS frame at timestep ${timestep} ends after ${atom} of ${num_atoms} atoms`,
        )
      }
      const line_number = idx + 1
      const n_cols = scanner.scan(lines[idx++])
      // A malformed last line after at least one complete frame is a half-written tail, not
      // corruption; a lone frame still reports the line so the problem is visible
      const torn_tail = idx >= lines.length && frames.length > 0
      if (n_cols < cols.length) {
        const message = `LAMMPS atom line ${line_number} (timestep ${timestep}) has ${n_cols} columns, expected ${cols.length}`
        throw torn_tail ? new TornLammpsFrameError(message) : new Error(message)
      }
      const coords: math.Vec3 = [scanner.num(x_col), scanner.num(y_col), scanner.num(z_col)]
      if (
        !Number.isFinite(coords[0]) ||
        !Number.isFinite(coords[1]) ||
        !Number.isFinite(coords[2])
      ) {
        const message = `LAMMPS atom line ${line_number} (timestep ${timestep}) has non-numeric coordinates: "${lines[idx - 1]}"`
        throw torn_tail ? new TornLammpsFrameError(message) : new TypeError(message)
      }
      const xyz: math.Vec3 = frac_to_cart
        ? frac_to_cart(coords)
        : [coords[0] - box_origin[0], coords[1] - box_origin[1], coords[2] - box_origin[2]]
      let atom_type: number | undefined
      if (type_col !== undefined) {
        atom_type = scanner.num(type_col)
        if (!Number.isInteger(atom_type) || atom_type <= 0) {
          throw new TypeError(
            `LAMMPS atom line ${line_number} (timestep ${timestep}) has invalid type "${scanner.str(type_col)}"`,
          )
        }
        atom_types_found.add(atom_type)
      }
      let element_symbol = atom_type === undefined ? undefined : atom_type_mapping?.[atom_type]
      if (!element_symbol && element_col !== undefined) {
        element_symbol = elem_symbol_from_token(scanner.str(element_col))
        // Some tools fill `element` with type labels (`Type1`, `2`); with a type column to
        // fall back on that is a guess, not a corrupt file
        if (!element_symbol && atom_type === undefined) {
          throw new Error(
            `LAMMPS atom line ${line_number} (timestep ${timestep}) has unknown element symbol "${scanner.str(element_col)}"`,
          )
        }
      }
      if (!element_symbol) {
        // atom_type is set: a frame with neither column was rejected at the header
        guessed_types.add(atom_type as number)
        element_symbol = element_from_lammps_type(atom_type as number)
      }
      positions.push(xyz)
      elements.push(element_symbol)

      const props: Record<string, unknown> = {}
      for (const { key, indices } of vector_props) {
        const vec = [scanner.num(indices[0]), scanner.num(indices[1]), scanner.num(indices[2])]
        if (Number.isFinite(vec[0]) && Number.isFinite(vec[1]) && Number.isFinite(vec[2])) {
          props[key] = vec
        }
      }
      for (const { key, col_idx } of scalar_props) {
        const value = scanner.num(col_idx)
        if (key === `id` && (!Number.isInteger(value) || value <= 0)) {
          throw new Error(
            `LAMMPS atom line ${line_number} (timestep ${timestep}) has invalid ID "${scanner.str(col_idx)}"`,
          )
        }
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
    if (frame_uses_ids) {
      const numeric_atom_ids = site_properties.map(({ id }) => id as number)
      if (new Set(numeric_atom_ids).size !== numeric_atom_ids.length) {
        throw new Error(`LAMMPS frame at timestep ${timestep} has duplicate atom IDs`)
      }
      const order = Array.from(
        { length: num_atoms },
        (_unused, atom_idx) => atom_idx,
      ).toSorted(
        (left_idx, right_idx) => numeric_atom_ids[left_idx] - numeric_atom_ids[right_idx],
      )
      positions = order.map((atom_idx) => positions[atom_idx])
      elements = order.map((atom_idx) => elements[atom_idx])
      site_properties = order.map((atom_idx) => site_properties[atom_idx])
    }
    frames.push(
      create_trajectory_frame(
        positions,
        elements,
        lattice_matrix,
        pbc,
        timestep,
        {
          timestep,
          coords_unwrapped: pos_variant.unwrapped,
          box_origin,
          ...(time === null ? {} : { time }),
        },
        site_properties,
        warn,
      ),
    )
    identity_uses_ids ??= frame_uses_ids
  }

  while (skip_to(`ITEM: TIME`)) {
    try {
      parse_frame()
    } catch (error) {
      if (!(error instanceof TornLammpsFrameError)) throw error
      warn(`Dropping truncated final LAMMPS frame`, error)
      break
    }
  }

  if (frames.length === 0) {
    throw new Error(`No valid frames found in LAMMPS trajectory`)
  }
  if (guessed_types.size > 0) {
    const guesses = Array.from(guessed_types)
      .toSorted((left, right) => left - right)
      .map((atom_type) => `${atom_type}→${element_from_lammps_type(atom_type)}`)
    warn(
      `LAMMPS dump names no element for some atom types; read them as atomic numbers (${guesses.join(`, `)}). Pass atom_type_mapping (e.g. { 1: 'Si', 2: 'O' }) to name them.`,
    )
  }
  if (frames.length > 1 && identity_uses_ids === false) {
    warn(
      `LAMMPS dump has no atom ID column; frames display as written but atom identity cannot be verified across frames, so displacement analyses may be meaningless`,
    )
  }
  for (let frame_idx = 1; frame_idx < frames.length; frame_idx++) {
    if (!(frames[frame_idx].step > frames[frame_idx - 1].step)) {
      throw new Error(
        `LAMMPS timestep ${frames[frame_idx].step} at frame ${frame_idx} must be greater than ` +
          `${frames[frame_idx - 1].step} at frame ${frame_idx - 1}`,
      )
    }
  }
  return {
    format: `lammps`,
    frames,
    metadata: {
      atom_types: Array.from(atom_types_found).toSorted((left, right) => left - right),
    },
  }
}
