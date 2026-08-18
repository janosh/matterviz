// LAMMPS trajectory (.lammpstrj) parsing
import type { ElementSymbol } from '$lib/element/types'
import { ELEM_SYMBOLS } from '$lib/labels'
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { Pbc } from '$lib/structure/pbc'
import type { TrajectoryFrame, TrajectoryType } from '$lib/trajectory/index'
import { coerce_elem_symbol } from '$lib/element/helpers'
import {
  count_elements,
  create_trajectory_frame,
  derive_time_step,
} from '$lib/trajectory/helpers'
import type { AtomTypeMapping } from '$lib/trajectory/types'
import { traj_warn } from './diagnostics'

const is_periodic = (token: string): boolean => token.toLowerCase().startsWith(`p`)

// Position column sets LAMMPS can dump, most to least informative. `scaled` coords are
// fractional and need the cell to become Cartesian. `unwrapped` means LAMMPS already
// removed the periodic images, so consumers (e.g. unwrap_flat_positions) must not
// re-apply the minimum image convention. x/y/z and xs/ys/zs are wrapped into the box.
const POS_COL_VARIANTS = [
  { keys: [`xu`, `yu`, `zu`], scaled: false, unwrapped: true },
  { keys: [`xsu`, `ysu`, `zsu`], scaled: true, unwrapped: true },
  { keys: [`xs`, `ys`, `zs`], scaled: true, unwrapped: false },
  { keys: [`x`, `y`, `z`], scaled: false, unwrapped: false },
] as const

// Dump column triples that become a single vec3 site property. `force` and `velocity` are
// the names the structure viewer's site-vector layers look for (see VECTOR_KEY_PREFIXES).
const LAMMPS_VECTOR_GROUPS = [
  { key: `velocity`, col_names: [`vx`, `vy`, `vz`] },
  { key: `force`, col_names: [`fx`, `fy`, `fz`] },
] as const

// Coordinates become positions and `element` becomes the species.
const NON_SCALAR_COLS: ReadonlySet<string> = new Set([
  ...POS_COL_VARIANTS.flatMap(({ keys }) => keys),
  `element`,
])

// Dump columns renamed on the way to site properties. Everything else keeps its dump name
// (`c_pe`, `v_myvar`, `id`, `type`, `mass`, ...) so compute/variable outputs stay traceable
// to the dump command that produced them.
const LAMMPS_COLUMN_ALIASES: Record<string, string> = { q: `charge` }

type LammpsBoxKind = `orthogonal` | `restricted_triclinic` | `general_triclinic`

// Parse LAMMPS box bounds into the lattice and its Cartesian origin. MatterViz lattices
// start at zero, so absolute x/y/z and xu/yu/zu coordinates must later subtract origin.
// Triclinic: converts bounding box to actual dims per https://docs.lammps.org/Howto_triclinic.html
// Lattice vectors: a=(lx,0,0), b=(xy,ly,0), c=(xz,yz,lz)
function parse_lammps_box(
  box_lines: string[],
  box_kind: LammpsBoxKind,
): { lattice_matrix: math.Matrix3x3; origin: Vec3 } | null {
  if (box_lines.length !== 3) return null
  const bounds = box_lines.map((line) => line.split(/\s+/).map(Number))
  const min_cols = box_kind === `orthogonal` ? 2 : box_kind === `restricted_triclinic` ? 3 : 4
  if (bounds.some((row) => row.length < min_cols || row.slice(0, min_cols).some(isNaN))) {
    return null
  }

  if (box_kind === `orthogonal`) {
    // Orthogonal: bounds = [lo, hi] per dimension
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
  // Triclinic: bounds = [lo_bound, hi_bound, tilt] with tilts xy, xz, yz
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

// Parse LAMMPS trajectory (.lammpstrj). Atom types mapped to elements via atom_type_mapping
// or by default: 1→H, 2→He, etc. Supports orthogonal, restricted triclinic, and
// general triclinic simulation boxes.
export function parse_lammps_trajectory(
  content: string,
  filename?: string,
  atom_type_mapping?: AtomTypeMapping,
): TrajectoryType {
  const lines = content.trim().split(/\r?\n/)
  const frames: TrajectoryFrame[] = []
  // Absolute simulation time per kept frame, or null when omitted
  const frame_times: (number | null)[] = []
  const atom_types_found = new Set<number>()
  let reference_atom_ids: number[] | undefined
  let identity_uses_ids: boolean | undefined
  let idx = 0

  const read_line = (): string => lines[idx++]?.trim() ?? ``
  const peek_line = (): string => lines[idx]?.trim() ?? ``
  const skip_to = (prefix: string): boolean => {
    while (idx < lines.length && !peek_line().startsWith(prefix)) idx++
    return idx < lines.length
  }

  // Helper to map atom type to element symbol
  const get_element = (atom_type: number): ElementSymbol => {
    if (atom_type_mapping?.[atom_type]) return atom_type_mapping[atom_type]
    return ELEM_SYMBOLS[Math.max(0, atom_type - 1) % ELEM_SYMBOLS.length]
  }

  while (idx < lines.length) {
    // `ITEM: TIMESTEP` also starts with `ITEM: TIME`, so this finds either frame prefix.
    if (!skip_to(`ITEM: TIME`)) break
    let time: number | null = null
    if (peek_line() === `ITEM: TIME`) {
      idx++
      const parsed = Number(read_line())
      time = Number.isFinite(parsed) ? parsed : null
      if (!skip_to(`ITEM: TIMESTEP`)) break
    }
    idx++
    const timestep_text = read_line()
    const timestep = Number(timestep_text)
    if (!Number.isInteger(timestep)) {
      traj_warn(`Skipping LAMMPS frame with invalid timestep "${timestep_text}"`)
      continue
    }

    if (!skip_to(`ITEM: NUMBER OF ATOMS`)) break
    idx++
    const num_atoms = Math.trunc(Number(read_line()))
    if (!num_atoms || num_atoms <= 0) continue

    // BOX BOUNDS: orthogonal="pp pp pp", restricted triclinic="xy xz yz pp pp pp",
    // general triclinic="abc origin pp pp pp"
    if (!skip_to(`ITEM: BOX BOUNDS`)) break
    const box_header = read_line()
    const box_kind: LammpsBoxKind = /BOX BOUNDS\s+abc\s+origin/i.test(box_header)
      ? `general_triclinic`
      : /BOX BOUNDS\s+xy\s+xz\s+yz/i.test(box_header)
        ? `restricted_triclinic`
        : `orthogonal`
    const tokens = box_header.replace(`ITEM: BOX BOUNDS`, ``).trim().split(/\s+/).slice(-3)
    const pbc: Pbc =
      tokens.length === 3
        ? [is_periodic(tokens[0]), is_periodic(tokens[1]), is_periodic(tokens[2])]
        : [true, true, true]

    const parsed_box = parse_lammps_box([read_line(), read_line(), read_line()], box_kind)
    if (!parsed_box) continue
    const { lattice_matrix, origin: box_origin } = parsed_box

    // Find ITEM: ATOMS and parse column headers
    if (!skip_to(`ITEM: ATOMS`)) break
    const cols = read_line().replace(`ITEM: ATOMS`, ``).trim().toLowerCase().split(/\s+/)
    const col = Object.fromEntries(cols.map((name, col_idx) => [name, col_idx]))

    const pos_variant = POS_COL_VARIANTS.find(({ keys }) => keys.every((key) => key in col))
    if (!pos_variant) continue
    const pos_cols = pos_variant.keys.map((key) => col[key])
    // Atom identity comes from numeric type or an explicit element symbol.
    const type_col = col.type
    const element_col = col.element
    const id_col = col.id
    const max_col_idx = Math.max(...pos_cols, type_col ?? -1, element_col ?? -1, id_col ?? -1)

    if (type_col === undefined && element_col === undefined) {
      traj_warn(`Skipping LAMMPS frame at timestep ${timestep}: missing type/element column`)
      continue
    }

    // Columns not consumed as coordinates or as the element symbol become site properties:
    // vx/vy/vz and fx/fy/fz grouped into vec3s, the rest as scalars under their dump name
    // (aliased where LAMMPS' name is cryptic). `type` and `id` are kept as scalars too —
    // they carry per-atom information (species grouping, atom identity) that is not
    // recoverable from the element symbol alone.
    const vector_props = LAMMPS_VECTOR_GROUPS.filter(({ col_names }) =>
      col_names.every((name) => name in col),
    ).map(({ key, col_names }) => ({ key, indices: col_names.map((name) => col[name]) }))
    const scalar_props = cols.flatMap((name, col_idx) =>
      NON_SCALAR_COLS.has(name) ||
      vector_props.some(({ indices }) => indices.includes(col_idx))
        ? []
        : [{ key: LAMMPS_COLUMN_ALIASES[name] ?? name, col_idx }],
    )

    // Parse atom data
    let positions: number[][] = []
    let elements: ElementSymbol[] = []
    let site_properties: Record<string, unknown>[] = []
    const frac_to_cart = pos_variant.scaled ? math.create_frac_to_cart(lattice_matrix) : null

    for (let atom = 0; atom < num_atoms && idx < lines.length; atom++) {
      const parts = read_line().split(/\s+/)
      const coords = pos_cols.map((col_idx) => Number(parts[col_idx]))
      if (coords.some(isNaN) || parts.length <= max_col_idx) continue

      // Scaled coordinates are already relative to the cell origin. Absolute LAMMPS
      // coordinates use the simulation-box origin, which MatterViz's zero-origin lattice
      // cannot represent separately, so translate them into the displayed cell.
      const xyz: Vec3 = frac_to_cart
        ? frac_to_cart(coords as Vec3)
        : math.subtract(coords as Vec3, box_origin)
      let element_symbol: ElementSymbol | undefined

      if (type_col !== undefined) {
        // Map atom type to element using custom mapping or default (type 1 -> H, etc.)
        const raw_atom_type = parts[type_col]
        const atom_type = Number(raw_atom_type)
        if (!Number.isInteger(atom_type) || atom_type <= 0) {
          traj_warn(
            `Skipping LAMMPS atom with invalid type "${raw_atom_type}" at timestep ${timestep}`,
          )
          continue
        }
        atom_types_found.add(atom_type)
        element_symbol = get_element(atom_type)
      } else if (element_col !== undefined) {
        const raw_symbol = parts[element_col]
        if (!raw_symbol) continue
        element_symbol = coerce_elem_symbol(raw_symbol)
        if (!element_symbol) {
          traj_warn(
            `Skipping LAMMPS atom with unknown element symbol "${raw_symbol}" at timestep ${timestep}`,
          )
          continue
        }
      }

      if (!element_symbol) continue
      positions.push(xyz)
      elements.push(element_symbol)

      // Non-numeric entries are dropped rather than stored as NaN, which would poison
      // min/max color ranges and vector magnitudes downstream
      const props: Record<string, unknown> = {}
      for (const { key, indices } of vector_props) {
        const vec = indices.map((col_idx) => Number(parts[col_idx]))
        if (vec.every(Number.isFinite)) props[key] = vec
      }
      for (const { key, col_idx } of scalar_props) {
        const raw = parts[col_idx]
        if (raw === undefined || raw === ``) continue
        const value = Number(raw)
        if (Number.isFinite(value)) props[key] = value
      }
      site_properties.push(props)
    }

    if (positions.length === num_atoms) {
      const frame_uses_ids = id_col !== undefined
      if (identity_uses_ids !== undefined && frame_uses_ids !== identity_uses_ids) {
        traj_warn(
          `Skipping LAMMPS frame at timestep ${timestep}: atom ID column presence changed`,
        )
        continue
      }
      if (frame_uses_ids) {
        const atom_ids = site_properties.map(({ id }) => id)
        if (
          atom_ids.some(
            (atom_id) =>
              typeof atom_id !== `number` || !Number.isInteger(atom_id) || atom_id <= 0,
          )
        ) {
          traj_warn(
            `Skipping LAMMPS frame at timestep ${timestep}: atom IDs must be positive integers`,
          )
          continue
        }
        const numeric_atom_ids = atom_ids as number[]
        if (new Set(numeric_atom_ids).size !== numeric_atom_ids.length) {
          traj_warn(`Skipping LAMMPS frame at timestep ${timestep}: duplicate atom IDs`)
          continue
        }
        const order = Array.from(
          { length: num_atoms },
          (_unused, atom_idx) => atom_idx,
        ).toSorted(
          (left_idx, right_idx) => numeric_atom_ids[left_idx] - numeric_atom_ids[right_idx],
        )
        const sorted_atom_ids = order.map((atom_idx) => numeric_atom_ids[atom_idx])
        const expected_atom_ids = reference_atom_ids
        if (
          expected_atom_ids &&
          sorted_atom_ids.some((atom_id, atom_idx) => atom_id !== expected_atom_ids[atom_idx])
        ) {
          traj_warn(`Skipping LAMMPS frame at timestep ${timestep}: atom ID set changed`)
          continue
        }
        reference_atom_ids ??= sorted_atom_ids
        positions = order.map((atom_idx) => positions[atom_idx])
        elements = order.map((atom_idx) => elements[atom_idx])
        site_properties = order.map((atom_idx) => site_properties[atom_idx])
      }
      const { volume } = math.calc_lattice_params(lattice_matrix)
      const frame = create_trajectory_frame(
        positions,
        elements,
        lattice_matrix,
        pbc,
        timestep,
        {
          volume,
          timestep,
          coords_unwrapped: pos_variant.unwrapped,
          box_origin,
          ...(time === null ? {} : { time }),
        },
      )
      for (const [site_idx, site] of frame.structure.sites.entries()) {
        site.properties = { ...site.properties, ...site_properties[site_idx] }
      }
      frames.push(frame)
      frame_times.push(time)
      identity_uses_ids ??= frame_uses_ids
    }
  }

  if (frames.length === 0) {
    throw new Error(`No valid frames found in LAMMPS trajectory`)
  }
  if (frames.length > 1 && identity_uses_ids === false) {
    throw new Error(
      `Multi-frame LAMMPS trajectories must include an atom ID column so atom identity can be verified across frames`,
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

  const first_frame = frames[0]
  const element_counts = count_elements(
    first_frame.structure.sites.map((site) => site.species[0].element),
  )

  // LAMMPS dumps omit the units setting, so do not guess time_unit.
  const time_step = derive_time_step(
    frame_times,
    frames.map((frame) => frame.step),
  )

  return {
    frames,
    ...(time_step === undefined ? {} : { time_step }),
    metadata: {
      filename,
      source_format: `lammps_trajectory`,
      frame_count: frames.length,
      total_atoms: first_frame.structure.sites.length,
      periodic_boundary_conditions:
        `lattice` in first_frame.structure
          ? first_frame.structure.lattice.pbc
          : [true, true, true],
      atom_types: Array.from(atom_types_found).toSorted((a, b) => a - b),
      element_counts,
    },
  }
}
