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

// Convert flat array to 3D grid [nx][ny][nz], computing data_range in the same pass.
// When divisor != 1, each value is divided by divisor (e.g. cell volume for CHGCAR normalization).
function flat_to_3d_grid(
  flat_data: number[],
  nx: number,
  ny: number,
  nz: number,
  divisor: number = 1,
): { grid: number[][][]; data_range: DataRange } {
  const grid: number[][][] = Array.from(
    { length: nx },
    () => Array.from({ length: ny }, () => new Array(nz).fill(0)),
  )
  const total = nx * ny * nz
  const is_complete = flat_data.length >= total
  const ny_nz = ny * nz
  let min_val = Infinity
  let max_val = -Infinity
  let sum = 0
  let count = 0

  for (let ix = 0; ix < nx; ix++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let iz = 0; iz < nz; iz++) {
        const flat_idx = ix * ny_nz + iy * nz + iz
        if (is_complete || flat_idx < flat_data.length) {
          const val = flat_data[flat_idx] / divisor
          grid[ix][iy][iz] = val
          if (val < min_val) min_val = val
          if (val > max_val) max_val = val
          sum += val
          count++
        }
      }
    }
  }

  const abs_max = Math.max(Math.abs(min_val), Math.abs(max_val))
  const data_range: DataRange = {
    min: min_val,
    max: max_val,
    abs_max,
    mean: count > 0 ? sum / count : 0,
  }
  return { grid, data_range }
}

// === CHGCAR Parser ===

// Parse VASP CHGCAR/AECCAR/ELFCAR/LOCPOT file format.
// CHGCAR consists of a POSCAR header followed by volumetric data on a 3D grid.
// Spin-polarized files contain two data blocks (total charge + magnetization).
export function parse_chgcar(content: string): VolumetricFileData | null {
  const lines = content.replace(/^\s+/, ``).split(/\r?\n/)
  if (lines.length < 10) {
    console.error(`CHGCAR file too short`)
    return null
  }

  // Parse the POSCAR header to find where the structure ends and volumetric data begins.
  // We reimplement the header parsing here rather than calling parse_poscar() directly
  // because we need to know the exact line index where atomic coordinates end.

  // Line 0: comment
  // Line 1: scale factor
  const scale_factor = parseFloat(lines[1])
  if (isNaN(scale_factor)) {
    console.error(`Invalid scaling factor in CHGCAR`)
    return null
  }

  // Lines 2-4: lattice vectors
  const parse_vector = (line: string): Vec3 =>
    math.scale(line.trim().split(/\s+/).slice(0, 3).map(Number) as Vec3, scale_factor)

  const lattice: Matrix3x3 = [
    parse_vector(lines[2]),
    parse_vector(lines[3]),
    parse_vector(lines[4]),
  ]

  // Lines 5+: element symbols and atom counts
  let line_idx = 5
  let element_symbols: string[] = []
  let atom_counts: number[] = []

  // Guard against premature end of file
  if (line_idx >= lines.length) {
    console.error(`CHGCAR: file ends before element/count lines`)
    return null
  }

  // Detect VASP 5+ format (has element symbols before counts)
  const first_token = lines[line_idx].trim().split(/\s+/)[0]
  const has_element_symbols = isNaN(parseInt(first_token))

  if (has_element_symbols) {
    element_symbols = lines[line_idx].trim().split(/\s+/)
    line_idx++
    if (line_idx >= lines.length) {
      console.error(`CHGCAR: file ends before atom counts line`)
      return null
    }
    atom_counts = lines[line_idx].trim().split(/\s+/).map(Number)
    line_idx++
  } else {
    atom_counts = lines[line_idx].trim().split(/\s+/).map(Number)
    const fallback_elements = [`H`, `He`, `Li`, `Be`, `B`, `C`, `N`, `O`, `F`, `Ne`]
    element_symbols = atom_counts.map((_count, idx) =>
      fallback_elements[idx % fallback_elements.length]
    )
    line_idx++
  }

  const total_atoms = atom_counts.reduce((sum, count) => sum + count, 0)

  if (line_idx >= lines.length) {
    console.error(`CHGCAR: file ends before coordinate mode line`)
    return null
  }

  // Check for selective dynamics line
  const mode_line = lines[line_idx].trim()
  if (mode_line.toUpperCase().startsWith(`S`)) {
    line_idx++ // skip selective dynamics line
  }

  if (line_idx >= lines.length) {
    console.error(`CHGCAR: file ends before coordinate mode line`)
    return null
  }

  // Coordinate mode line
  const coord_mode = lines[line_idx].trim().toUpperCase()
  const is_direct = coord_mode.startsWith(`D`)
  line_idx++

  // Parse atomic positions
  const lattice_transposed = math.transpose_3x3_matrix(lattice)
  // Pre-compute inverse for Cartesian→fractional conversion (hoisted out of atom loop)
  const lattice_inv = math.matrix_inverse_3x3(lattice_transposed)
  const sites: Site[] = []
  let atom_idx = 0

  for (let elem_idx = 0; elem_idx < element_symbols.length; elem_idx++) {
    const symbol = element_symbols[elem_idx].split(/[_/]/)[0]
    const element =
      (ELEM_SYMBOLS.includes(symbol as ElementSymbol) ? symbol : `H`) as ElementSymbol
    const count = atom_counts[elem_idx]

    for (let count_idx = 0; count_idx < count; count_idx++) {
      const atom_line_idx = line_idx + atom_idx + count_idx
      if (atom_line_idx >= lines.length) {
        console.error(`CHGCAR: file ends before all atom coordinates are read`)
        return null
      }
      const coords = lines[atom_line_idx]
        .trim()
        .split(/\s+/)
        .slice(0, 3)
        .map(Number) as Vec3

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

  line_idx += total_atoms

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
    while (line_idx < lines.length && lines[line_idx].trim() === ``) {
      line_idx++
    }

    if (line_idx >= lines.length) break

    // Parse grid dimensions: NGX NGY NGZ
    const grid_line = lines[line_idx].trim().split(/\s+/).map(Number)
    if (grid_line.length < 3 || grid_line.some(isNaN)) break

    const [ngx, ngy, ngz] = grid_line
    line_idx++

    // Read volumetric data values (Fortran-style, multiple values per line)
    // Data order in CHGCAR: x is outer loop, y middle, z inner (z-fastest)
    const total_points = ngx * ngy * ngz
    const flat_data: number[] = []

    while (flat_data.length < total_points && line_idx < lines.length) {
      const data_line = lines[line_idx].trim()
      // Stop at augmentation data or another grid dimensions line
      if (data_line.startsWith(`augmentation`)) break
      if (data_line === ``) break

      const values = data_line.split(/\s+/).map(Number)
      for (const val of values) {
        if (!isNaN(val) && flat_data.length < total_points) {
          flat_data.push(val)
        }
      }
      line_idx++
    }

    if (flat_data.length < total_points) {
      console.warn(
        `CHGCAR volume ${vol_idx}: expected ${total_points} values, got ${flat_data.length}`,
      )
      if (flat_data.length === 0) break
    }

    // CHGCAR stores rho * V_cell, so normalize by dividing by cell volume.
    // Use Math.abs to guard against negative determinant (left-handed lattice).
    const cell_volume = Math.abs(lattice_params.volume)
    const divisor = cell_volume > 1e-30 ? cell_volume : 1
    const { grid, data_range } = flat_to_3d_grid(flat_data, ngx, ngy, ngz, divisor)

    volumes.push({
      grid,
      grid_dims: [ngx, ngy, ngz],
      lattice,
      origin: [0, 0, 0],
      data_range,
      label: volume_labels[vol_idx],
    })

    // Skip augmentation occupancies section if present
    while (line_idx < lines.length) {
      const aug_line = lines[line_idx].trim()
      if (aug_line === `` || /^\d+\s+\d+\s+\d+$/.test(aug_line)) break
      line_idx++
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
export function parse_cube(content: string): VolumetricFileData | null {
  const lines = content.split(/\r?\n/)
  if (lines.length < 7) {
    console.error(`.cube file too short`)
    return null
  }

  // Lines 0-1: title/comment
  // Line 2: n_atoms, origin_x, origin_y, origin_z
  // (negative n_atoms indicates orbital data with extra header line)
  const header = lines[2].trim().split(/\s+/).map(Number)
  const n_atoms = Math.abs(header[0])
  const has_orbital_header = header[0] < 0
  const raw_origin: Vec3 = [header[1], header[2], header[3]]

  // Lines 3-5: grid dimensions and voxel vectors
  // Positive N means coordinates in Bohr, negative N means Angstrom
  const voxel_lines = [
    lines[3].trim().split(/\s+/).map(Number),
    lines[4].trim().split(/\s+/).map(Number),
    lines[5].trim().split(/\s+/).map(Number),
  ]

  const n_grid: [number, number, number] = [
    Math.abs(voxel_lines[0][0]),
    Math.abs(voxel_lines[1][0]),
    Math.abs(voxel_lines[2][0]),
  ]

  // Per Gaussian .cube convention, the sign of the first axis N determines units
  // for all axes (mixed signs are non-standard and unsupported)
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

  // Detect periodicity: .cube files from molecular calculations typically have
  // a non-zero origin (bounding box around molecule), while periodic systems
  // have origin at or near (0,0,0).
  const origin_magnitude = Math.hypot(...origin)
  const is_periodic = origin_magnitude < 1e-6

  // Parse atomic positions (lines 6 to 6+n_atoms-1)
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
    const atom_line = lines[6 + atom_idx].trim().split(/\s+/).map(Number)
    const atomic_number = atom_line[0]
    // atom_line[1] is the charge (often 0)
    const raw_xyz = math.scale(
      [atom_line[2], atom_line[3], atom_line[4]] as Vec3,
      unit_scale,
    )

    // Convert Cartesian to fractional, accounting for origin offset.
    // Store lattice-frame xyz (shifted) so abc and xyz stay consistent.
    const xyz = math.subtract(raw_xyz, origin)
    const abc = math.mat3x3_vec3_multiply(lattice_inv, xyz)

    const element = atomic_number_to_symbol(atomic_number)
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
  let data_line_idx = 6 + n_atoms
  if (has_orbital_header && data_line_idx < lines.length) {
    data_line_idx++ // skip the "NMO MO1 MO2 ..." line
  }

  // Parse volumetric data
  // .cube format: for each x, for each y, all z values (z-fastest, 6 per line)
  const total_points = n_grid[0] * n_grid[1] * n_grid[2]
  const flat_data: number[] = []

  while (flat_data.length < total_points && data_line_idx < lines.length) {
    const data_line = lines[data_line_idx].trim()
    if (data_line === ``) {
      data_line_idx++
      continue
    }

    const values = data_line.split(/\s+/).map(Number)
    for (const val of values) {
      if (!isNaN(val) && flat_data.length < total_points) {
        flat_data.push(val)
      }
    }
    data_line_idx++
  }

  if (flat_data.length < total_points) {
    console.warn(
      `.cube: expected ${total_points} data values, got ${flat_data.length}`,
    )
    if (flat_data.length === 0) {
      console.error(`No volumetric data found in .cube file`)
      return null
    }
  }

  const { grid, data_range } = flat_to_3d_grid(flat_data, n_grid[0], n_grid[1], n_grid[2])

  const volumes: VolumetricData[] = [{
    grid,
    grid_dims: n_grid,
    lattice,
    origin,
    data_range,
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

  // Content-based detection
  const lines = content.trim().split(/\r?\n/)

  // .cube detection: line 3 has 4 numbers (n_atoms + origin), line 4 has 4 numbers (grid dim + voxel)
  if (lines.length > 6) {
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
  if (lines.length > 8 && !isNaN(parseFloat(lines[1].trim()))) {
    const has_grid_dims = lines.slice(7).some((line) =>
      /^\s*\d+\s+\d+\s+\d+\s*$/.test(line)
    )
    if (has_grid_dims) return parse_chgcar(content)
  }

  return null
}
