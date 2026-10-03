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
  TextLines,
} from '#lib/trajectory/helpers.js'
import type { AseFrames } from './ase'
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

// Only the final frame of a dump may be incomplete (the writer is still appending); the
// same damage anywhere else is corruption and must not silently drop a frame.
class TornLammpsFrameError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TornLammpsFrameError'
  }
}

type LammpsFrameHeader = {
  timestep: number
  pbc: Pbc
  lattice_matrix: math.Matrix3x3
  metadata: Record<string, unknown>
}
// One frame as read from the dump, atoms in file order. `positions` and `site_properties`
// stay empty when read without sites (the indexed open's validating scan); `ids` is empty
// without an id column.
type LammpsFrameRead = {
  header: LammpsFrameHeader
  elements: ElementSymbol[]
  ids: number[]
  positions: math.Vec3[]
  site_properties: Record<string, unknown>[]
}

// Frames sorted by atom id (when the dump has ids) so every frame lists atoms in one order
const lammps_frame = (read: LammpsFrameRead, warn: WarnFn): TrajectoryFrame => {
  const { header, ids, elements, positions, site_properties } = read
  const order = Array.from({ length: elements.length }, (_unused, atom_idx) => atom_idx)
  if (ids.length > 0) order.sort((left_idx, right_idx) => ids[left_idx] - ids[right_idx])
  return create_trajectory_frame(
    order.map((atom_idx) => positions[atom_idx]),
    order.map((atom_idx) => elements[atom_idx]),
    header.lattice_matrix,
    header.pbc,
    header.timestep,
    header.metadata,
    order.map((atom_idx) => site_properties[atom_idx]),
    warn,
  )
}

// Frame reader over the dump's lines with the state frames share: `read_frame` reads the frame
// starting at line `start` (an `ITEM: TIME...` line) with every check, `read_run` all of them.
function create_lammps_reader(
  lines: TextLines,
  warn: WarnFn,
  atom_type_mapping?: AtomTypeMapping,
) {
  const atom_types_found = new Set<number>()
  // LAMMPS atom types are bare integers whose meaning lives in the input script, not the
  // dump. An element per atom resolves as: the caller's atom_type_mapping (explicit intent),
  // then an `element` column (`dump_modify element Si O`), then atomic number N like ASE's
  // read_lammps_dump and the LAMMPS data parser; the guess warns once per file so a Si/O dump
  // showing up as H/He is traceable.
  const guessed_types = new Set<number>()
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
    throw new TornLammpsFrameError(
      `LAMMPS frame${timestep === null ? `` : ` at timestep ${timestep}`} ends before "${prefix}"`,
    )
  }

  const read_frame = (
    start: number,
    has_previous_frame: boolean,
    sites: boolean,
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
      if (idx >= lines.count) {
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

    for (let atom = 0; atom < num_atoms; atom++) {
      if (idx >= lines.count) {
        throw new TornLammpsFrameError(
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
        throw torn_tail ? new TornLammpsFrameError(message) : new Error(message)
      }
      const coords: math.Vec3 = [scanner.num(x_col), scanner.num(y_col), scanner.num(z_col)]
      if (
        !Number.isFinite(coords[0]) ||
        !Number.isFinite(coords[1]) ||
        !Number.isFinite(coords[2])
      ) {
        const message = `LAMMPS atom line ${line_number} (timestep ${timestep}) has non-numeric coordinates: "${lines.line(idx - 1)}"`
        throw torn_tail ? new TornLammpsFrameError(message) : new TypeError(message)
      }
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
        if (!element_symbol && atom_type === undefined && mass_col === undefined) {
          throw new Error(
            `LAMMPS atom line ${line_number} (timestep ${timestep}) has unknown element symbol "${scanner.str(element_col)}"`,
          )
        }
      }
      // A per-atom mass (`dump custom ... mass`) names real elements; only coarse-grained
      // or isotope masses miss every standard atomic weight
      if (!element_symbol && mass_col !== undefined) {
        element_symbol = element_for_mass(scanner.num(mass_col)) ?? undefined
        if (!element_symbol && atom_type === undefined) {
          throw new Error(
            `LAMMPS atom line ${line_number} (timestep ${timestep}) has mass "${scanner.str(mass_col)}" matching no element and no type column to fall back on`,
          )
        }
      }
      if (!element_symbol) {
        // atom_type is set: a frame without it threw above
        guessed_types.add(atom_type as number)
        element_symbol = element_from_lammps_type(atom_type as number)
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
      if (!sites) continue
      positions.push(
        frac_to_cart
          ? frac_to_cart(coords)
          : [coords[0] - box_origin[0], coords[1] - box_origin[1], coords[2] - box_origin[2]],
      )

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
    if (new Set(ids).size !== ids.length) {
      throw new Error(`LAMMPS frame at timestep ${timestep} has duplicate atom IDs`)
    }
    identity_uses_ids ??= frame_uses_ids
    const metadata = {
      coords_unwrapped: pos_variant.unwrapped,
      box_origin,
      ...(time === null ? {} : { time }),
    }
    const header = { timestep, pbc, lattice_matrix, metadata }
    return { header, elements, ids, positions, site_properties }
  }

  // Hands each frame, from the top of the dump, to `on_frame` (a torn final frame is dropped
  // with a warning), then makes the run-level checks and warnings in the eager order and
  // returns the run metadata
  const read_run = (
    sites: boolean,
    on_frame: (read: LammpsFrameRead, start: number) => void,
  ): Record<string, unknown> => {
    const steps: number[] = []
    idx = 0
    for (;;) {
      while (idx < lines.count && !peek_line().startsWith(`ITEM: TIME`)) idx++
      if (idx >= lines.count) break
      try {
        const start = idx
        const read = read_frame(start, steps.length > 0, sites)
        on_frame(read, start)
        steps.push(read.header.timestep)
      } catch (error) {
        if (!(error instanceof TornLammpsFrameError)) throw error
        warn(`Dropping truncated final LAMMPS frame`, error)
        break
      }
    }
    if (steps.length === 0) {
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
    if (steps.length > 1 && identity_uses_ids === false) {
      warn(
        `LAMMPS dump has no atom ID column; frames display as written but atom identity cannot be verified across frames, so displacement analyses may be meaningless`,
      )
    }
    for (let frame_idx = 1; frame_idx < steps.length; frame_idx++) {
      if (!(steps[frame_idx] > steps[frame_idx - 1])) {
        throw new Error(
          `LAMMPS timestep ${steps[frame_idx]} at frame ${frame_idx} must be greater than ` +
            `${steps[frame_idx - 1]} at frame ${frame_idx - 1}`,
        )
      }
    }
    return {
      atom_types: Array.from(atom_types_found).toSorted((left, right) => left - right),
    }
  }

  return { read_frame, read_run }
}

export function parse_lammps_trajectory(
  content: string | TextLines,
  warn: WarnFn,
  atom_type_mapping?: AtomTypeMapping,
): ParsedTrajectory {
  const frames: TrajectoryFrame[] = []
  const reader = create_lammps_reader(TextLines.of(content), warn, atom_type_mapping)
  const metadata = reader.read_run(true, (read) => frames.push(lammps_frame(read, warn)))
  return { format: `lammps`, frames, metadata }
}

// Indexed LAMMPS dump: open reads every frame with all the eager parser's checks (so a corrupt
// dump fails to open as it would eagerly, and run-level warnings and metadata match) but builds
// no positions or sites, keeping each frame's first line and what its plot row needs.
export function open_lammps_frames(
  lines: TextLines,
  warn: WarnFn,
  atom_type_mapping?: AtomTypeMapping,
): AseFrames {
  const reader = create_lammps_reader(lines, warn, atom_type_mapping)
  const frames: { start: number; header: LammpsFrameHeader; numbers: Uint8Array | null }[] = []
  const run_metadata = reader.read_run(false, ({ header, elements }, start) => {
    // 0 marks a symbol an atom_type_mapping gave no atomic number, whose plot row needs sites
    const numbers = new Uint8Array(
      elements.map((element) => symbol_to_atomic_number(element) ?? 0),
    )
    frames.push({ start, header, numbers: numbers.includes(0) ? null : numbers })
  })
  const decode = (frame_idx: number): TrajectoryFrame =>
    lammps_frame(reader.read_frame(frames[frame_idx].start, frame_idx > 0, true), warn)
  return {
    frame_count: frames.length,
    metadata: run_metadata,
    decode,
    plot_row_frame: (frame_idx) => {
      const { numbers, header } = frames[frame_idx]
      const { lattice_matrix, pbc, timestep, metadata } = header
      return numbers
        ? create_plot_row_frame(numbers, lattice_matrix, pbc, timestep, metadata, warn)
        : decode(frame_idx)
    },
  }
}
