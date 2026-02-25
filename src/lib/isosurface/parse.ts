// Parsers for volumetric data file formats (VASP CHGCAR, Gaussian .cube)
import { VASP_VOLUMETRIC_REGEX } from '$lib/constants'
import type { ElementSymbol } from '$lib/element'
import { ELEM_SYMBOLS } from '$lib/labels'
import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { Site } from '$lib/structure'
import type { ParsedStructure } from '$lib/structure/parse'
import type { DataRange, VolumetricData, VolumetricFileData } from './types'

// Bohr radius in Angstroms (for Gaussian .cube unit conversion)
const BOHR_TO_ANGSTROM = 0.529177249

// Wrap a value to [0, 1) range for fractional coordinates
const wrap_frac = (val: number): number => val - Math.floor(val)

// === Fast number parsing utilities ===

// Parse whitespace-separated numbers directly from a string, starting at `pos`.
// Writes into a pre-allocated Float64Array and returns { count, end_pos }.
// Stops at `max_count` numbers, end of string, or when encountering a line
// starting with a letter (e.g. "augmentation" in CHGCAR).
function parse_float_block(
  text: string,
  pos: number,
  max_count: number,
  data: Float64Array,
  data_offset: number = 0,
): { count: number; end_pos: number } {
  let idx = data_offset
  const target = data_offset + max_count
  const len = text.length

  while (idx < target && pos < len) {
    // Skip whitespace
    let char_code = text.charCodeAt(pos)
    while (pos < len && char_code <= 32) {
      // After a newline, check if the next non-space char is a letter (section break)
      if (char_code === 10 || char_code === 13) {
        let peek = pos + 1
        // Skip \r\n combo
        if (char_code === 13 && peek < len && text.charCodeAt(peek) === 10) peek++
        // Skip leading spaces on the new line
        while (peek < len && text.charCodeAt(peek) === 32) peek++
        if (peek < len) {
          const next_char = text.charCodeAt(peek)
          // Letter a-z or A-Z signals a non-numeric line (e.g. "augmentation")
          if (
            (next_char >= 65 && next_char <= 90) || (next_char >= 97 && next_char <= 122)
          ) {
            return { count: idx - data_offset, end_pos: pos }
          }
        }
      }
      char_code = text.charCodeAt(++pos)
    }
    if (pos >= len) break

    // Find end of token
    const start = pos
    while (pos < len && text.charCodeAt(pos) > 32) pos++

    // Parse number using unary + (handles scientific notation)
    const num = +text.substring(start, pos)
    if (!Number.isNaN(num)) {
      data[idx++] = num
    }
  }
  return { count: idx - data_offset, end_pos: pos }
}

// Find the character offset for line N in a string (0-indexed).
// Much faster than splitting the entire string into lines.
function find_line_offset(text: string, target_line: number): number {
  let line = 0
  let pos = 0
  while (line < target_line && pos < text.length) {
    if (text.charCodeAt(pos) === 10) line++
    pos++
  }
  return pos
}

// Read a single line from text at the given offset, returning the line and next offset
function read_line(text: string, pos: number): { line: string; next: number } {
  let end = pos
  while (
    end < text.length && text.charCodeAt(end) !== 10 && text.charCodeAt(end) !== 13
  ) end++
  const line = text.substring(pos, end)
  let next = end
  if (next < text.length && text.charCodeAt(next) === 13) next++ // skip \r
  if (next < text.length && text.charCodeAt(next) === 10) next++ // skip \n
  return { line, next }
}

// Read N lines starting from pos, returning array of trimmed lines and final offset
function read_lines(
  text: string,
  pos: number,
  count: number,
): { lines: string[]; next: number } {
  const result: string[] = []
  for (let idx = 0; idx < count; idx++) {
    const { line, next } = read_line(text, pos)
    result.push(line.trim())
    pos = next
  }
  return { lines: result, next: pos }
}

// Build 3D grid directly from Float64Array, computing data_range in the same pass.
type BuildGridOptions = {
  data: Float64Array
  nx: number
  ny: number
  nz: number
  divisor?: number
  data_order?: `x_fastest` | `z_fastest`
}

function build_grid(
  { data, nx, ny, nz, divisor = 1, data_order = `z_fastest` }: BuildGridOptions,
): { grid: number[][][]; data_range: DataRange } {
  const grid: number[][][] = new Array(nx)
  let min_val = Infinity
  let max_val = -Infinity
  let sum = 0
  const total = nx * ny * nz
  const data_len = Math.min(data.length, total)

  if (data_len === 0) {
    // Empty data: return zeroed grid with neutral data_range
    for (let ix = 0; ix < nx; ix++) {
      const plane: number[][] = new Array(ny)
      for (let iy = 0; iy < ny; iy++) plane[iy] = new Array(nz).fill(0)
      grid[ix] = plane
    }
    return { grid, data_range: { min: 0, max: 0, abs_max: 0, mean: 0 } }
  }

  if (data_order === `z_fastest`) {
    // .cube convention: z varies fastest, then y, then x.
    const ny_nz = ny * nz
    for (let ix = 0; ix < nx; ix++) {
      const plane: number[][] = new Array(ny)
      for (let iy = 0; iy < ny; iy++) {
        const row = new Array<number>(nz).fill(0)
        const base = ix * ny_nz + iy * nz
        const row_end = Math.min(base + nz, data_len)
        for (let flat_idx = base; flat_idx < row_end; flat_idx++) {
          const val = data[flat_idx] / divisor
          row[flat_idx - base] = val
          if (val < min_val) min_val = val
          if (val > max_val) max_val = val
          sum += val
        }
        plane[iy] = row
      }
      grid[ix] = plane
    }
  } else {
    // VASP CHGCAR/ELFCAR/LOCPOT convention: x varies fastest, then y, then z.
    for (let ix = 0; ix < nx; ix++) {
      const plane: number[][] = new Array(ny)
      for (let iy = 0; iy < ny; iy++) plane[iy] = new Array(nz).fill(0)
      grid[ix] = plane
    }
    let flat_idx = 0
    let data_exhausted = false
    for (let iz = 0; iz < nz; iz++) {
      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          if (flat_idx >= data_len) {
            data_exhausted = true
            break
          }
          const val = data[flat_idx] / divisor
          grid[ix][iy][iz] = val
          if (val < min_val) min_val = val
          if (val > max_val) max_val = val
          sum += val
          flat_idx++
        }
        if (data_exhausted) break
      }
      if (data_exhausted) break
    }
  }

  const abs_max = Math.max(Math.abs(min_val), Math.abs(max_val))
  return {
    grid,
    data_range: {
      min: min_val,
      max: max_val,
      abs_max,
      mean: sum / data_len,
    },
  }
}

// === CHGCAR Parser ===

// Parse VASP CHGCAR/AECCAR/ELFCAR/LOCPOT file format.
// CHGCAR consists of a POSCAR header followed by volumetric data on a 3D grid.
// Spin-polarized files contain two data blocks (total charge + magnetization).
export function parse_chgcar(content: string): VolumetricFileData | null {
  // Strip leading whitespace
  let pos = 0
  while (pos < content.length && content.charCodeAt(pos) <= 32) pos++

  // Parse header line by line (only the first ~20 lines, not the whole file)
  // Line 0: comment
  let cur = read_line(content, pos)
  pos = cur.next

  // Line 1: scale factor
  cur = read_line(content, pos)
  const scale_factor = parseFloat(cur.line)
  if (isNaN(scale_factor)) {
    console.error(`Invalid scaling factor in CHGCAR`)
    return null
  }
  pos = cur.next

  // Lines 2-4: lattice vectors
  const parse_vector = (line: string): Vec3 =>
    math.scale(line.trim().split(/\s+/).slice(0, 3).map(Number) as Vec3, scale_factor)

  const lat_lines = read_lines(content, pos, 3)
  const lattice: Matrix3x3 = [
    parse_vector(lat_lines.lines[0]),
    parse_vector(lat_lines.lines[1]),
    parse_vector(lat_lines.lines[2]),
  ]
  pos = lat_lines.next

  // Lines 5+: element symbols and atom counts
  let element_symbols: string[] = []
  let atom_counts: number[] = []

  cur = read_line(content, pos)
  if (pos >= content.length) {
    console.error(`CHGCAR: file ends before element/count lines`)
    return null
  }

  // Detect VASP 5+ format (has element symbols before counts)
  const first_token = cur.line.trim().split(/\s+/)[0]
  const has_element_symbols = isNaN(parseInt(first_token))

  if (has_element_symbols) {
    element_symbols = cur.line.trim().split(/\s+/)
    pos = cur.next
    cur = read_line(content, pos)
    if (pos >= content.length) {
      console.error(`CHGCAR: file ends before atom counts line`)
      return null
    }
    atom_counts = cur.line.trim().split(/\s+/).map(Number)
    pos = cur.next
  } else {
    atom_counts = cur.line.trim().split(/\s+/).map(Number)
    const fallback_elements = [`H`, `He`, `Li`, `Be`, `B`, `C`, `N`, `O`, `F`, `Ne`]
    element_symbols = atom_counts.map((_count, idx) =>
      fallback_elements[idx % fallback_elements.length]
    )
    pos = cur.next
  }

  if (pos >= content.length) {
    console.error(`CHGCAR: file ends before coordinate mode line`)
    return null
  }

  // Check for selective dynamics line
  cur = read_line(content, pos)
  if (cur.line.trim().toUpperCase().startsWith(`S`)) {
    pos = cur.next // skip selective dynamics line
    cur = read_line(content, pos)
  }

  if (pos >= content.length) {
    console.error(`CHGCAR: file ends before coordinate mode line`)
    return null
  }

  // Coordinate mode line
  const is_direct = cur.line.trim().toUpperCase().startsWith(`D`)
  pos = cur.next

  // Parse atomic positions
  const lattice_transposed = math.transpose_3x3_matrix(lattice)
  const lattice_inv = math.matrix_inverse_3x3(lattice_transposed)
  const sites: Site[] = []
  let atom_idx = 0

  for (let elem_idx = 0; elem_idx < element_symbols.length; elem_idx++) {
    const symbol = element_symbols[elem_idx].split(/[_/]/)[0]
    const element =
      (ELEM_SYMBOLS.includes(symbol as ElementSymbol) ? symbol : `H`) as ElementSymbol
    const count = atom_counts[elem_idx]

    for (let count_idx = 0; count_idx < count; count_idx++) {
      if (pos >= content.length) {
        console.error(`CHGCAR: file ends before all atom coordinates are read`)
        return null
      }
      cur = read_line(content, pos)
      const coords = cur.line.trim().split(/\s+/).slice(0, 3).map(Number) as Vec3
      pos = cur.next

      let abc: Vec3
      let xyz: Vec3

      if (is_direct) {
        abc = [wrap_frac(coords[0]), wrap_frac(coords[1]), wrap_frac(coords[2])]
        xyz = math.mat3x3_vec3_multiply(lattice_transposed, abc)
      } else {
        xyz = math.scale(coords, scale_factor)
        const raw = math.mat3x3_vec3_multiply(lattice_inv, xyz)
        abc = [wrap_frac(raw[0]), wrap_frac(raw[1]), wrap_frac(raw[2])]
      }

      sites.push({
        species: [{ element, occu: 1, oxidation_state: 0 }],
        abc,
        xyz,
        label: `${element}${atom_idx + count_idx + 1}`,
        properties: {},
      })
    }
    atom_idx += count
  }

  // Build the structure (volumetric files are always periodic)
  const lattice_params = math.calc_lattice_params(lattice)
  const structure: ParsedStructure = {
    sites,
    lattice: { matrix: lattice, pbc: [true, true, true], ...lattice_params },
  }

  // Parse volumetric data blocks
  const volumes: VolumetricData[] = []
  const volume_labels = [`charge density`, `magnetization density`]

  for (let vol_idx = 0; vol_idx < 2; vol_idx++) {
    // Skip blank lines
    while (pos < content.length) {
      cur = read_line(content, pos)
      if (cur.line.trim() !== ``) break
      pos = cur.next
    }

    if (pos >= content.length) break

    // Parse grid dimensions: NGX NGY NGZ
    cur = read_line(content, pos)
    const grid_tokens = cur.line.trim().split(/\s+/).map(Number)
    if (grid_tokens.length < 3 || grid_tokens.some(isNaN)) break

    const [ngx, ngy, ngz] = grid_tokens
    pos = cur.next

    // Fast-parse volumetric data directly from the string
    const total_points = ngx * ngy * ngz
    const data = new Float64Array(total_points)
    const { count: parsed_count, end_pos } = parse_float_block(
      content,
      pos,
      total_points,
      data,
    )
    pos = end_pos

    if (parsed_count < total_points) {
      console.warn(
        `CHGCAR volume ${vol_idx}: expected ${total_points} values, got ${parsed_count}`,
      )
      if (parsed_count === 0) break
    }

    // CHGCAR stores rho * V_cell, so normalize by dividing by cell volume.
    // Use Math.abs to guard against negative determinant (left-handed lattice).
    const cell_volume = Math.abs(lattice_params.volume)
    const divisor = cell_volume > 1e-30 ? cell_volume : 1
    const { grid, data_range } = build_grid({
      data: data.subarray(0, parsed_count),
      nx: ngx,
      ny: ngy,
      nz: ngz,
      divisor,
      data_order: `x_fastest`,
    })

    volumes.push({
      grid,
      grid_dims: [ngx, ngy, ngz],
      lattice,
      origin: [0, 0, 0],
      data_range,
      data_order: `x_fastest`,
      periodic: true, // VASP grids span [0,1) with N points, wrapping at boundaries
      label: volume_labels[vol_idx],
    })

    // Skip augmentation occupancies and any remaining non-numeric lines
    while (pos < content.length) {
      cur = read_line(content, pos)
      const trimmed = cur.line.trim()
      if (trimmed === `` || /^\d+\s+\d+\s+\d+$/.test(trimmed)) break
      pos = cur.next
    }
  }

  if (volumes.length === 0) {
    console.error(`No volumetric data found in CHGCAR`)
    return null
  }

  return { structure, volumes }
}

// === Gaussian .cube Parser ===

// Parse Gaussian .cube file format.
// Contains atomic structure and volumetric data in a single file.
// Units: if grid dimensions are positive, coordinates are in Bohr; if negative, in Angstrom.
export function parse_cube(
  content: string,
  options: { periodic?: boolean } = {},
): VolumetricFileData | null {
  // Quick line count check: need at least 7 lines (2 title + 1 header + 3 voxel + 1 atom)
  let line_count = 0
  for (let idx = 0; idx < content.length && line_count < 7; idx++) {
    if (content.charCodeAt(idx) === 10) line_count++
  }
  if (line_count < 6) {
    console.error(`.cube file too short`)
    return null
  }

  // Parse header (first 6 lines + atom lines)
  let pos = 0
  const header = read_lines(content, pos, 6)
  pos = header.next

  // Line 2: n_atoms, origin_x, origin_y, origin_z
  // (negative n_atoms indicates orbital data with extra header line)
  const line2 = header.lines[2].split(/\s+/).map(Number)
  if (line2.length < 4 || line2.some(isNaN)) {
    console.error(`.cube header line 3 malformed: expected 4 numbers`)
    return null
  }
  const n_atoms = Math.abs(line2[0])
  const has_orbital_header = line2[0] < 0
  const raw_origin: Vec3 = [line2[1], line2[2], line2[3]]

  // Lines 3-5: grid dimensions and voxel vectors
  // Positive N means coordinates in Bohr, negative N means Angstrom
  const voxel_lines = [
    header.lines[3].split(/\s+/).map(Number),
    header.lines[4].split(/\s+/).map(Number),
    header.lines[5].split(/\s+/).map(Number),
  ]
  if (voxel_lines.some((line) => line.length < 4 || line.some(isNaN))) {
    console.error(`.cube voxel lines malformed: expected 4 numbers per line`)
    return null
  }

  const n_grid: Vec3 = [
    Math.abs(voxel_lines[0][0]),
    Math.abs(voxel_lines[1][0]),
    Math.abs(voxel_lines[2][0]),
  ]

  // Per Gaussian .cube convention, the sign of the first axis N determines units
  const is_bohr = voxel_lines[0][0] > 0
  const unit_scale = is_bohr ? BOHR_TO_ANGSTROM : 1.0

  // Voxel vectors (convert to Angstrom if needed)
  const [voxel_a, voxel_b, voxel_c] = voxel_lines.map(
    (line) => math.scale(line.slice(1, 4) as Vec3, unit_scale),
  )

  // Lattice vectors = grid_dim * voxel_vector
  const lattice: Matrix3x3 = [
    math.scale(voxel_a, n_grid[0]),
    math.scale(voxel_b, n_grid[1]),
    math.scale(voxel_c, n_grid[2]),
  ]

  const origin = math.scale(raw_origin, unit_scale)

  // Periodicity: use explicit override if provided, else heuristic based on origin.
  // Molecular .cube files have a non-zero origin (bounding box offset); periodic
  // systems (QE, CP2K) have origin at (0,0,0). Pass { periodic: true/false } to
  // override when the heuristic is wrong (e.g. molecule centered at origin).
  const is_periodic = options.periodic ?? Math.hypot(...origin) < 1e-6

  // Parse atomic positions
  const sites: Site[] = []
  const lattice_transposed = math.transpose_3x3_matrix(lattice)

  let lattice_inv: Matrix3x3
  try {
    lattice_inv = math.matrix_inverse_3x3(lattice_transposed)
  } catch {
    // Non-periodic system (molecule), use identity
    lattice_inv = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  }

  for (let atom_idx = 0; atom_idx < n_atoms; atom_idx++) {
    const cur = read_line(content, pos)
    const atom_line = cur.line.trim().split(/\s+/).map(Number)
    pos = cur.next

    // Validate: need atomic_number, charge, x, y, z (5 tokens, indices 2-4 finite)
    if (
      atom_line.length < 5 || !isFinite(atom_line[2]) || !isFinite(atom_line[3]) ||
      !isFinite(atom_line[4])
    ) {
      console.warn(
        `.cube atom ${atom_idx}: malformed line "${cur.line.trim()}", skipping`,
      )
      continue
    }

    // atom_line[1] is the charge (often 0)
    const raw_xyz = math.scale(
      [atom_line[2], atom_line[3], atom_line[4]] as Vec3,
      unit_scale,
    )

    // Convert Cartesian to fractional, accounting for origin offset.
    // Store lattice-frame xyz (shifted) so abc and xyz stay consistent.
    const xyz = math.subtract(raw_xyz, origin)
    const abc = math.mat3x3_vec3_multiply(lattice_inv, xyz)

    const element = atomic_number_to_symbol(atom_line[0])
    sites.push({
      species: [{ element, occu: 1, oxidation_state: 0 }],
      abc,
      xyz,
      label: `${element}${atom_idx + 1}`,
      properties: {},
    })
  }

  // Build structure
  const lattice_params = math.calc_lattice_params(lattice)
  const structure: ParsedStructure = {
    sites,
    lattice: {
      matrix: lattice,
      pbc: [is_periodic, is_periodic, is_periodic],
      ...lattice_params,
    },
  }

  // Skip orbital header line if present
  if (has_orbital_header && pos < content.length) {
    const cur = read_line(content, pos)
    pos = cur.next
  }

  // Fast-parse volumetric data directly from the string
  const total_points = n_grid[0] * n_grid[1] * n_grid[2]
  const data = new Float64Array(total_points)
  const { count: parsed_count } = parse_float_block(content, pos, total_points, data)

  if (parsed_count < total_points) {
    console.warn(
      `.cube: expected ${total_points} data values, got ${parsed_count}`,
    )
    if (parsed_count === 0) {
      console.error(`No volumetric data found in .cube file`)
      return null
    }
  }

  const { grid, data_range } = build_grid({
    data: data.subarray(0, parsed_count),
    nx: n_grid[0],
    ny: n_grid[1],
    nz: n_grid[2],
  })

  const volumes: VolumetricData[] = [{
    grid,
    grid_dims: n_grid,
    lattice,
    origin,
    data_range,
    data_order: `z_fastest`,
    periodic: is_periodic, // periodic systems wrap; molecular .cube files include both endpoints
    label: `volumetric data`,
  }]

  return { structure, volumes }
}

// Convert atomic number to element symbol using ELEM_SYMBOLS (1-indexed: H=1, He=2, ...)
function atomic_number_to_symbol(atomic_number: number): ElementSymbol {
  // ELEM_SYMBOLS is 0-indexed (H at index 0), atomic numbers are 1-indexed
  const idx = atomic_number - 1
  return (idx >= 0 && idx < ELEM_SYMBOLS.length
    ? ELEM_SYMBOLS[idx]
    : `H`) as ElementSymbol
}

// Auto-detect and parse volumetric file format based on filename and content
export function parse_volumetric_file(
  content: string,
  filename?: string,
): VolumetricFileData | null {
  // Strip compression suffixes so "CHGCAR.gz" and "molecule.cube.bz2" match correctly
  const lower_name = (filename ?? ``).toLowerCase().replace(/\.(gz|bz2|xz|zst)$/, ``)

  // Extension-based detection
  if (lower_name.endsWith(`.cube`)) return parse_cube(content)

  // VASP volumetric file detection by filename
  if (VASP_VOLUMETRIC_REGEX.test(lower_name)) return parse_chgcar(content)

  // Content-based detection (only parse first few lines, not the whole file)
  // Find enough lines for detection without splitting the entire string
  const detection_end = find_line_offset(content, 10)
  const detection_text = content.substring(0, detection_end)
  const lines = detection_text.split(/\r?\n/)

  // .cube detection: line 3 has 4 numbers (n_atoms + origin), line 4 has 4 numbers (grid dim + voxel)
  if (lines.length > 4) {
    const line2_tokens = lines[2].trim().split(/\s+/)
    const line3_tokens = lines[3].trim().split(/\s+/)
    if (
      line2_tokens.length === 4 &&
      line3_tokens.length === 4 &&
      line2_tokens.every((tok) => !isNaN(Number(tok))) &&
      line3_tokens.every((tok) => !isNaN(Number(tok)))
    ) {
      return parse_cube(content)
    }
  }

  // CHGCAR detection: requires POSCAR-like header (scale factor on line 2) AND
  // a grid dimensions line (3 integers) somewhere after the header. This distinguishes
  // CHGCAR from plain POSCAR/CONTCAR files which share the same header format.
  if (lines.length > 2 && !isNaN(parseFloat(lines[1].trim()))) {
    // Scan for grid dimensions line (3 integers) starting from ~line 7
    let scan_pos = find_line_offset(content, 7)
    // Only scan a limited window, not the entire file
    // Scan enough to cover large atom blocks (~100 chars/atom × ~200 atoms max)
    const scan_end = Math.min(content.length, scan_pos + 25000)
    while (scan_pos < scan_end) {
      const { line, next } = read_line(content, scan_pos)
      if (/^\s*\d+\s+\d+\s+\d+\s*$/.test(line)) {
        return parse_chgcar(content)
      }
      scan_pos = next
    }
  }

  return null
}
