// LAMMPS trajectory (.lammpstrj) parsing
import type { ElementSymbol } from '$lib/element'
import { ELEM_SYMBOLS } from '$lib/labels'
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { Pbc } from '$lib/structure'
import type { AtomTypeMapping } from '../types'
import type { TrajectoryFrame, TrajectoryType } from '../index'
import {
  coerce_element_symbol,
  create_trajectory_frame,
  is_valid_element_symbol,
} from '../helpers'

// Parse LAMMPS box bounds → lattice matrix. Handles orthogonal and triclinic boxes.
// Triclinic: converts bounding box to actual dims per https://docs.lammps.org/Howto_triclinic.html
// Lattice vectors: a=(lx,0,0), b=(xy,ly,0), c=(xz,yz,lz)
export function parse_lammps_box(
  box_lines: string[],
  is_triclinic: boolean,
): math.Matrix3x3 | null {
  if (box_lines.length !== 3) return null
  const bounds = box_lines.map((line) => line.split(/\s+/).map(Number))
  const min_cols = is_triclinic ? 3 : 2
  if (bounds.some((row) => row.length < min_cols || row.slice(0, min_cols).some(isNaN))) {
    return null
  }

  if (!is_triclinic) {
    // Orthogonal: bounds = [lo, hi] per dimension
    const [[lo_x, hi_x], [lo_y, hi_y], [lo_z, hi_z]] = bounds
    return [[hi_x - lo_x, 0, 0], [0, hi_y - lo_y, 0], [0, 0, hi_z - lo_z]]
  }
  // Triclinic: bounds = [lo_bound, hi_bound, tilt] with tilts xy, xz, yz
  const [[xlo_b, xhi_b, xy], [ylo_b, yhi_b, xz], [zlo_b, zhi_b, yz]] = bounds
  const lx = (xhi_b - Math.max(0, xy, xz, xy + xz)) -
    (xlo_b - Math.min(0, xy, xz, xy + xz))
  const ly = (yhi_b - Math.max(0, yz)) - (ylo_b - Math.min(0, yz))
  const lz = zhi_b - zlo_b
  return [[lx, 0, 0], [xy, ly, 0], [xz, yz, lz]]
}

// Parse LAMMPS trajectory (.lammpstrj). Atom types mapped to elements via atom_type_mapping
// or by default: 1→H, 2→He, etc. Supports orthogonal and triclinic simulation boxes.
export function parse_lammps_trajectory(
  content: string,
  filename?: string,
  atom_type_mapping?: AtomTypeMapping,
): TrajectoryType {
  const lines = content.trim().split(/\r?\n/)
  const frames: TrajectoryFrame[] = []
  const atom_types_found = new Set<number>()
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
    if (!skip_to(`ITEM: TIMESTEP`)) break
    idx++
    const timestep = parseInt(read_line(), 10) || 0

    if (!skip_to(`ITEM: NUMBER OF ATOMS`)) break
    idx++
    const num_atoms = parseInt(read_line(), 10)
    if (!num_atoms || num_atoms <= 0) continue

    // BOX BOUNDS: orthogonal="pp pp pp", triclinic="xy xz yz pp pp pp"
    if (!skip_to(`ITEM: BOX BOUNDS`)) break
    const box_header = read_line()
    const is_triclinic = /BOX BOUNDS\s+xy\s+xz\s+yz/i.test(box_header)
    const tokens = box_header.replace(`ITEM: BOX BOUNDS`, ``).trim().split(/\s+/).slice(
      -3,
    )
    const is_periodic = (tok: string): boolean => tok.toLowerCase().startsWith(`p`)
    const pbc: Pbc = tokens.length === 3
      ? [is_periodic(tokens[0]), is_periodic(tokens[1]), is_periodic(tokens[2])]
      : [true, true, true]

    const lattice_matrix = parse_lammps_box(
      [read_line(), read_line(), read_line()],
      is_triclinic,
    )
    if (!lattice_matrix) continue

    // Find ITEM: ATOMS and parse column headers
    if (!skip_to(`ITEM: ATOMS`)) break
    const cols = read_line().replace(`ITEM: ATOMS`, ``).trim().toLowerCase().split(/\s+/)
    const col = Object.fromEntries(cols.map((name, col_idx) => [name, col_idx]))

    // Determine position columns: prefer unwrapped (xu/yu/zu) > scaled (xs/ys/zs) > regular (x/y/z)
    const pos_keys = [`xu`, `yu`, `zu`].every((key) => key in col)
      ? [`xu`, `yu`, `zu`]
      : [`xs`, `ys`, `zs`].every((key) => key in col)
      ? [`xs`, `ys`, `zs`]
      : [`x`, `y`, `z`]
    const pos_cols = pos_keys.map((key) => col[key])
    // Atom identity: prefer numeric type, else explicit element symbol.
    const type_col = col.type
    const element_col = col.element
    const use_scaled = pos_keys[0] === `xs`

    if (pos_cols.some((col_idx) => col_idx === undefined)) continue
    if (type_col === undefined && element_col === undefined) {
      console.warn(
        `Skipping LAMMPS frame at timestep ${timestep}: missing type/element column`,
      )
      continue
    }

    // Parse atom data
    const positions: number[][] = []
    const elements: ElementSymbol[] = []
    const frac_to_cart = use_scaled ? math.create_frac_to_cart(lattice_matrix) : null

    for (let atom = 0; atom < num_atoms && idx < lines.length; atom++) {
      const parts = read_line().split(/\s+/)
      const coords = pos_cols.map((col_idx) => parseFloat(parts[col_idx]))

      const max_col_idx = Math.max(...pos_cols, type_col ?? -1, element_col ?? -1)
      if (coords.some(isNaN) || parts.length <= max_col_idx) continue

      // Convert scaled coordinates to Cartesian if needed
      const xyz = frac_to_cart ? frac_to_cart(coords as Vec3) : coords
      positions.push(xyz)

      if (type_col !== undefined) {
        // Map atom type to element using custom mapping or default (type 1 -> H, etc.)
        const atom_type = parseInt(parts[type_col], 10) || 1
        atom_types_found.add(atom_type)
        elements.push(get_element(atom_type))
      } else if (element_col !== undefined) {
        const raw_symbol = parts[element_col]
        if (!raw_symbol) continue
        if (!is_valid_element_symbol(raw_symbol)) {
          console.warn(
            `Unknown LAMMPS element symbol "${raw_symbol}" at timestep ${timestep}, using X`,
          )
        }
        elements.push(coerce_element_symbol(raw_symbol))
      }
    }

    if (positions.length === num_atoms) {
      const { volume } = math.calc_lattice_params(lattice_matrix)
      frames.push(create_trajectory_frame(
        positions,
        elements,
        lattice_matrix,
        pbc,
        timestep,
        { volume, timestep },
      ))
    }
  }

  if (frames.length === 0) {
    throw new Error(`No valid frames found in LAMMPS trajectory`)
  }

  const first_frame = frames[0]
  const element_counts = first_frame.structure.sites.reduce<Record<string, number>>(
    (counts, site) => {
      const elem = site.species[0].element
      counts[elem] = (counts[elem] || 0) + 1
      return counts
    },
    {},
  )

  return {
    frames,
    metadata: {
      filename,
      source_format: `lammps_trajectory`,
      frame_count: frames.length,
      total_atoms: first_frame.structure.sites.length,
      periodic_boundary_conditions: (`lattice` in first_frame.structure)
        ? first_frame.structure.lattice.pbc
        : [true, true, true],
      atom_types: Array.from(atom_types_found).sort((a, b) => a - b),
      element_counts,
    },
  }
}
