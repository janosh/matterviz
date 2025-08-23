import { elem_symbols, type ElementSymbol, type Site, type Vec3 } from '$lib'
import type { OptimadeStructure } from '$lib/api/optimade'
import { COMPRESSION_EXTENSIONS } from '$lib/io/decompress'
import type { Matrix3x3 } from '$lib/math'
import * as math from '$lib/math'
import type { AnyStructure, PymatgenStructure } from '$lib/structure'
import { load as yaml_load } from 'js-yaml'

export interface ParsedStructure {
  sites: Site[]
  lattice?: {
    matrix: Matrix3x3
    a: number
    b: number
    c: number
    alpha: number
    beta: number
    gamma: number
    volume: number
  }
}

export interface PhonopyCell {
  lattice: number[][]
  points: {
    symbol: string
    coordinates: number[]
    mass: number
    reduced_to?: number
  }[]
  reciprocal_lattice?: number[][]
}

export interface PhonopyData {
  phono3py?: {
    version: string
    [key: string]: unknown
  }
  phonopy?: {
    version: string
    [key: string]: unknown
  }
  space_group?: {
    type: string
    number: number
    Hall_symbol: string
  }
  primitive_cell?: PhonopyCell
  unit_cell?: PhonopyCell
  supercell?: PhonopyCell
  phonon_primitive_cell?: PhonopyCell
  phonon_supercell?: PhonopyCell
  phonon_displacements?: unknown[] // Ignored for performance
  [key: string]: unknown
}

// Normalize scientific notation in coordinate strings
// Handles eEdD and *^ notation variants
function normalize_scientific_notation(str: string): string {
  return str
    .toLowerCase()
    .replace(/d/g, `e`) // Replace D/d with e
    .replace(/\*\^/g, `e`) // Replace *^ with e
}

// Parse a coordinate value that might be in various scientific notation formats
function parse_coordinate(str: string): number {
  const normalized = normalize_scientific_notation(str.trim())
  const value = parseFloat(normalized)
  if (isNaN(value)) {
    throw `Invalid coordinate value: ${str}`
  }
  return value
}

// Parse coordinates from a line, handling malformed formatting
function parse_coordinate_line(line: string): number[] {
  let tokens = line.trim().split(/\s+/)

  // Handle malformed coordinates like "1.0-2.0-3.0" (missing spaces)
  if (tokens.length < 3) {
    // Insert a space before '-' that follows a digit (but not after 'e'/'E')
    // Example: "0.1-0.2-0.3" -> "0.1 -0.2 -0.3"; preserves exponents like "1e-3"
    const sanitized = line.trim().replace(/([0-9])-/g, `$1 -`)
    tokens = sanitized.split(/\s+/)
  }

  if (tokens.length < 3) {
    throw `Insufficient coordinates in line: ${line}`
  }

  return tokens.slice(0, 3).map(parse_coordinate)
}

// Validate element symbol and provide fallback
function validate_element_symbol(symbol: string, index: number): ElementSymbol {
  // Clean symbol (remove suffixes like _pv, /hash)
  const clean_symbol = symbol.split(/[_/]/)[0]

  if (elem_symbols.includes(clean_symbol as ElementSymbol)) {
    return clean_symbol as ElementSymbol
  }

  // Fallback to default elements by atomic number
  const fallback_elements = [`H`, `He`, `Li`, `Be`, `B`, `C`, `N`, `O`, `F`, `Ne`]
  const fallback = fallback_elements[index % fallback_elements.length]
  console.warn(
    `Invalid element symbol '${symbol}', using fallback '${fallback}'`,
  )
  return fallback as ElementSymbol
}

// Parse VASP POSCAR file format
export function parse_poscar(content: string): ParsedStructure | null {
  try {
    const lines = content.replace(/^\s+/, ``).split(/\r?\n/)

    if (lines.length < 8) {
      console.error(`POSCAR file too short`)
      return null
    }

    // Parse scaling factor (line 2)
    let scale_factor = parseFloat(lines[1])
    if (isNaN(scale_factor)) {
      console.error(`Invalid scaling factor in POSCAR`)
      return null
    }

    // Parse lattice vectors (lines 3-5)
    const parse_vector = (line: string, line_num: number): Vec3 => {
      const coords = line.trim().split(/\s+/).map(parse_coordinate)
      if (coords.length !== 3) {
        throw `Invalid lattice vector on line ${line_num}: expected 3 coordinates, got ${coords.length}`
      }
      return coords as Vec3
    }

    const lattice_vecs: Matrix3x3 = [
      parse_vector(lines[2], 3),
      parse_vector(lines[3], 4),
      parse_vector(lines[4], 5),
    ]

    // Handle negative scale factor (volume-based scaling)
    if (scale_factor < 0) {
      const volume = Math.abs(math.det_3x3(lattice_vecs))
      scale_factor = Math.pow(-scale_factor / volume, 1 / 3)
    }

    // Scale lattice vectors
    const scaled_lattice: Matrix3x3 = [
      lattice_vecs[0].map((x) => x * scale_factor) as Vec3,
      lattice_vecs[1].map((x) => x * scale_factor) as Vec3,
      lattice_vecs[2].map((x) => x * scale_factor) as Vec3,
    ]

    // Parse element symbols and atom counts (may span multiple lines)
    let line_index = 5
    let element_symbols: string[] = []
    let atom_counts: number[] = []

    // Detect if this is VASP 5+ format (has element symbols)
    // Try to parse the first token as a number - if it succeeds, it's VASP 4 format
    const first_token = lines[line_index].trim().split(/\s+/)[0]
    const first_token_as_number = parseInt(first_token)
    const has_element_symbols = isNaN(first_token_as_number)

    if (has_element_symbols) {
      // VASP 5+ format - parse element symbols (may span multiple lines)
      let symbol_lines = 1

      // Look ahead to find where numbers start (atom counts)
      for (let lookahead_idx = 1; lookahead_idx < 10; lookahead_idx++) {
        if (line_index + lookahead_idx >= lines.length) break
        const next_line_first_token = lines[line_index + lookahead_idx]
          .trim()
          .split(/\s+/)[0]
        const next_token_as_number = parseInt(next_line_first_token)
        if (!isNaN(next_token_as_number)) {
          symbol_lines = lookahead_idx
          break
        }
      }

      // Collect all element symbols from the symbol lines
      for (
        let symbol_line_idx = 0;
        symbol_line_idx < symbol_lines;
        symbol_line_idx++
      ) {
        if (line_index + symbol_line_idx < lines.length) {
          element_symbols.push(
            ...lines[line_index + symbol_line_idx].trim().split(/\s+/),
          )
        }
      }

      // Parse atom counts (may span multiple lines)
      for (
        let count_line_idx = 0;
        count_line_idx < symbol_lines;
        count_line_idx++
      ) {
        if (line_index + symbol_lines + count_line_idx < lines.length) {
          const counts = lines[line_index + symbol_lines + count_line_idx]
            .trim()
            .split(/\s+/)
            .map(Number)
          atom_counts.push(...counts)
        }
      }

      line_index += 2 * symbol_lines
    } else {
      // VASP 4 format - only atom counts, generate default element symbols
      atom_counts = lines[line_index].trim().split(/\s+/).map(Number)
      element_symbols = atom_counts.map((_, idx) =>
        validate_element_symbol(`Element${idx}`, idx)
      )
      line_index += 1
    }

    if (element_symbols.length !== atom_counts.length) {
      console.error(`Mismatch between element symbols and atom counts`)
      return null
    }

    // Check for selective dynamics
    let has_selective_dynamics = false
    if (line_index < lines.length) {
      let coordinate_mode = lines[line_index].trim().toUpperCase()

      if (coordinate_mode.startsWith(`S`)) {
        has_selective_dynamics = true
        line_index += 1
        if (line_index < lines.length) {
          coordinate_mode = lines[line_index].trim().toUpperCase()
        } else {
          console.error(`Missing coordinate mode after selective dynamics`)
          return null
        }
      }

      // Determine coordinate mode
      const is_direct = coordinate_mode.startsWith(`D`)
      const is_cartesian = coordinate_mode.startsWith(`C`) ||
        coordinate_mode.startsWith(`K`)

      if (!is_direct && !is_cartesian) {
        console.error(`Unknown coordinate mode in POSCAR: ${coordinate_mode}`)
        return null
      }

      // Parse atomic positions
      const sites: Site[] = []
      let atom_index = 0

      for (let elem_idx = 0; elem_idx < element_symbols.length; elem_idx++) {
        const element = validate_element_symbol(
          element_symbols[elem_idx],
          elem_idx,
        )
        const count = atom_counts[elem_idx]

        for (let atom_count_idx = 0; atom_count_idx < count; atom_count_idx++) {
          const coord_line_idx = line_index + 1 + atom_index + atom_count_idx
          if (coord_line_idx >= lines.length) {
            console.error(`Not enough coordinate lines in POSCAR`)
            return null
          }

          const coords = parse_coordinate_line(lines[coord_line_idx])

          // Parse selective dynamics if present
          let selective_dynamics: [boolean, boolean, boolean] | undefined
          if (has_selective_dynamics) {
            const tokens = lines[coord_line_idx].trim().split(/\s+/)
            if (tokens.length >= 6) {
              selective_dynamics = [
                tokens[3] === `T`,
                tokens[4] === `T`,
                tokens[5] === `T`,
              ]
            }
          }
          let xyz: Vec3
          let abc: Vec3
          const [x, y, z] = coords

          if (is_direct) {
            // Store fractional coordinates, wrapping to [0, 1) range
            abc = [x - Math.floor(x), y - Math.floor(y), z - Math.floor(z)]
            // Convert fractional to Cartesian coordinates
            const lattice_transposed = math.transpose_3x3_matrix(scaled_lattice)
            xyz = math.mat3x3_vec3_multiply(lattice_transposed, abc)
          } else { // Already Cartesian, scale if needed
            xyz = math.scale([x, y, z], scale_factor)
            // Calculate fractional coordinates using proper matrix inversion
            // Note: Our lattice matrix is stored as row vectors, but for coordinate conversion
            // we need column vectors, so we transpose before inversion
            let raw_abc: Vec3
            try {
              const lattice_transposed = math.transpose_3x3_matrix(scaled_lattice)
              const lattice_inv = math.matrix_inverse_3x3(lattice_transposed)
              raw_abc = math.mat3x3_vec3_multiply(lattice_inv, xyz)
            } catch {
              // Fallback to simplified method if matrix is singular
              raw_abc = [
                xyz[0] / scaled_lattice[0][0],
                xyz[1] / scaled_lattice[1][1],
                xyz[2] / scaled_lattice[2][2],
              ]
            }
            // Wrap fractional coordinates to [0, 1) range
            abc = [
              raw_abc[0] - Math.floor(raw_abc[0]),
              raw_abc[1] - Math.floor(raw_abc[1]),
              raw_abc[2] - Math.floor(raw_abc[2]),
            ]
          }

          const site: Site = {
            species: [{ element, occu: 1, oxidation_state: 0 }],
            abc,
            xyz,
            label: `${element}${atom_index + atom_count_idx + 1}`,
            properties: selective_dynamics
              ? { selective_dynamics: selective_dynamics }
              : {},
          }

          sites.push(site)
        }

        atom_index += count
      }

      const lattice_params = math.calc_lattice_params(scaled_lattice)
      const structure: ParsedStructure = {
        sites,
        lattice: { matrix: scaled_lattice, ...lattice_params },
      }

      return structure
    } else {
      console.error(`Missing coordinate mode line in POSCAR`)
      return null
    }
  } catch (error) {
    console.error(`Error parsing POSCAR file:`, error)
    return null
  }
}

// Parse XYZ file format. Supports both standard XYZ and extended XYZ formats with multi-frame support
export function parse_xyz(content: string): ParsedStructure | null {
  try {
    const normalized_content = content.trim()
    if (!normalized_content) {
      console.error(`Empty XYZ file`)
      return null
    }

    // Split into frames by reading the atom count and slicing lines
    const all_lines = normalized_content.split(/\r?\n/)
    const frames: string[] = []
    let line_idx = 0

    while (line_idx < all_lines.length) {
      const numAtoms = parseInt(all_lines[line_idx].trim(), 10)
      if (
        !isNaN(numAtoms) &&
        numAtoms > 0 &&
        line_idx + numAtoms + 1 < all_lines.length
      ) {
        const frameLines = all_lines.slice(line_idx, line_idx + numAtoms + 2)
        frames.push(frameLines.join(`\n`))
        line_idx += numAtoms + 2
      } else line_idx++
    }

    // If no frames found, try simple parsing
    if (frames.length === 0) frames.push(normalized_content)

    // Parse the last frame (or only frame)
    const frame_content = frames[frames.length - 1]
    const lines = frame_content.trim().split(/\r?\n/)

    if (lines.length < 2) {
      console.error(`XYZ frame too short`)
      return null
    }

    // Parse number of atoms (line 1)
    const num_atoms = parseInt(lines[0].trim())
    if (isNaN(num_atoms) || num_atoms <= 0) {
      console.error(`Invalid number of atoms in XYZ file`)
      return null
    }

    // Parse comment line (line 2) - may contain lattice info for extended XYZ
    const comment_line = lines[1]
    let lattice: ParsedStructure[`lattice`] | undefined

    // Check for extended XYZ lattice information in comment line
    const lattice_match = comment_line.match(/Lattice="([^"]+)"/)
    if (lattice_match) {
      const lattice_values = lattice_match[1].split(/\s+/).map(parse_coordinate)
      if (lattice_values.length === 9) {
        const lattice_vectors: Matrix3x3 = [
          [lattice_values[0], lattice_values[1], lattice_values[2]],
          [lattice_values[3], lattice_values[4], lattice_values[5]],
          [lattice_values[6], lattice_values[7], lattice_values[8]],
        ]

        const lattice_params = math.calc_lattice_params(lattice_vectors)
        lattice = { matrix: lattice_vectors, ...lattice_params }
      }
    }

    // Parse atomic coordinates (starting from line 3)
    const sites: Site[] = []

    for (let atom_idx = 0; atom_idx < num_atoms; atom_idx++) {
      const line_idx = atom_idx + 2
      if (line_idx >= lines.length) {
        console.error(`Not enough coordinate lines in XYZ file`)
        return null
      }

      const parts = lines[line_idx].trim().split(/\s+/)
      if (parts.length < 4) {
        console.error(`Invalid coordinate line in XYZ file`)
        return null
      }

      const element = validate_element_symbol(parts[0], atom_idx)
      const coords = [
        parse_coordinate(parts[1]),
        parse_coordinate(parts[2]),
        parse_coordinate(parts[3]),
      ]

      // For XYZ files, coordinates are typically in Cartesian
      const xyz: Vec3 = [coords[0], coords[1], coords[2]]

      // Calculate fractional coordinates if lattice is available
      let abc: Vec3 = [0, 0, 0]
      if (lattice) {
        // Calculate fractional coordinates using proper matrix inversion
        // Note: Our lattice matrix is stored as row vectors, but for coordinate conversion
        // we need column vectors, so we transpose before inversion
        try {
          const lattice_transposed = math.transpose_3x3_matrix(lattice.matrix)
          const lattice_inv = math.matrix_inverse_3x3(lattice_transposed)
          abc = math.mat3x3_vec3_multiply(lattice_inv, xyz)
        } catch {
          // Fallback to simplified method if matrix is singular
          abc = [xyz[0] / lattice.a, xyz[1] / lattice.b, xyz[2] / lattice.c]
        }

        // Ensure fractional coordinates are wrapped into [0, 1) for consistency
        abc = [
          abc[0] - Math.floor(abc[0]),
          abc[1] - Math.floor(abc[1]),
          abc[2] - Math.floor(abc[2]),
        ]

        // Keep rendered atoms inside primary unit cell by recomputing xyz
        // from the wrapped fractional coordinates using transpose(lattice)
        const lattice_transposed = math.transpose_3x3_matrix(lattice.matrix)
        const wrapped_xyz = math.mat3x3_vec3_multiply(lattice_transposed, abc)
        xyz[0] = wrapped_xyz[0]
        xyz[1] = wrapped_xyz[1]
        xyz[2] = wrapped_xyz[2]
      }

      const species = [{ element, occu: 1, oxidation_state: 0 }]
      const label = `${element}${atom_idx + 1}`
      const site: Site = { species, abc, xyz, label, properties: {} }

      sites.push(site)
    }

    const structure: ParsedStructure = { sites, ...(lattice && { lattice }) }

    return structure
  } catch (error) {
    console.error(`Error parsing XYZ file:`, error)
    return null
  }
}

// Apply symmetry operations to generate equivalent positions
const apply_symmetry_ops = (
  atom: CifAtom,
  symmetry_ops: string[],
  wrap_frac: boolean,
): CifAtom[] => {
  if (symmetry_ops.length === 0) return [atom]

  const equivalent_atoms: CifAtom[] = []
  const seen = new Set<string>()
  const wrap = (
    v: Vec3,
  ): Vec3 => (wrap_frac ? v.map((c) => c - Math.floor(c)) as Vec3 : v)
  const key = (v: Vec3): string =>
    `${v[0].toFixed(12)},${v[1].toFixed(12)},${v[2].toFixed(12)}`

  // Always include base atom (optionally wrapped)
  const base_coords = wrap(atom.coords as Vec3)
  seen.add(key(base_coords))
  equivalent_atoms.push({ ...atom, coords: base_coords })

  for (const operation of symmetry_ops) {
    const operation_match = operation.match(/['"]([^'"]+)['"]/)
    const expr_str = operation_match ? operation_match[1] : operation.trim()
    const parts = expr_str.split(`,`).map((part) => part.trim())
    if (parts.length !== 3) continue

    const new_coords: Vec3 = [0, 0, 0]

    for (let dim = 0; dim < 3; dim++) {
      const part = parts[dim]
      let expr = part.replace(/\s+/g, ``)

      let coord = 0
      let translation = 0

      // Support both var+number and number+var forms, with optional sign on var
      const var_match = expr.match(/([+-]?)(x|y|z)/)
      if (var_match) {
        const sign_char = var_match[1]
        const var_char = var_match[2]
        const var_index = var_char === `x` ? 0 : var_char === `y` ? 1 : 2
        const var_sign = sign_char === `-` ? -1 : 1
        coord = var_sign * atom.coords[var_index]
        // Remove the variable term (including its sign) to leave pure translation
        expr = expr.replace(var_match[0], ``)

        // Normalize the remaining expression: trim whitespace and remove trailing operators
        expr = expr.trim()
        if (expr.endsWith(`+`) || expr.endsWith(`-`)) expr = expr.slice(0, -1)

        // Treat empty expression as "0"
        if (expr.length === 0) expr = `0`
      }

      if (expr.length > 0) {
        // Remaining is numeric translation, possibly with leading sign
        let sign = 1
        let number_str = expr
        if (expr[0] === `+` || expr[0] === `-`) {
          sign = expr[0] === `-` ? -1 : 1
          number_str = expr.slice(1)
        }
        if (number_str.includes(`/`)) {
          const [num, den] = number_str.split(`/`)
          const numerator = parseFloat(num)
          const denominator = parseFloat(den)
          if (!isNaN(numerator) && !isNaN(denominator) && denominator !== 0) {
            translation = sign * (numerator / denominator)
          }
        } else {
          const val = parseFloat(number_str)
          if (!isNaN(val)) translation = sign * val
        }
      }

      new_coords[dim] = coord + translation
    }

    // Wrap and deduplicate transformed coordinates
    const wrapped = wrap(new_coords)
    const k = key(wrapped)
    if (seen.has(k)) continue
    seen.add(k)

    equivalent_atoms.push({
      ...atom,
      coords: wrapped,
      id: `${atom.id}_${equivalent_atoms.length}`,
    })
  }

  return equivalent_atoms
}

const extract_cif_cell_parameters = (
  text: string,
  type: string,
  strict = true,
): number[] => {
  return text
    .split(`\n`)
    .filter((line) => line.startsWith(`_${type}`))
    .map((line) => {
      const tokens = line.split(/\s+/).filter((token) => token.length > 0)
      if (tokens.length < 2) {
        if (strict) throw new Error(`Invalid CIF cell parameter line format: ${line}`)
        return null
      }
      const value = parseFloat(tokens[tokens.length - 1].split(`(`)[0])
      if (isNaN(value)) {
        if (strict) throw new Error(`Invalid CIF cell parameter in line: ${line}`)
        return null // Return null for invalid values in non-strict mode
      }
      return value
    })
    .filter((v): v is number => v !== null)
}

// build header index mapping for atom site data (supports fract and Cartn coordinates)
const build_cif_atom_site_header_indices = (
  headers: string[],
): Record<string, number> => {
  const indices: Record<string, number> = {}
  const mappings = [
    [`_atom_site_label`, `label`],
    [`_atom_site_type_symbol`, `symbol`],
    [`_atom_site_fract_x`, `x`],
    [`_atom_site_fract_y`, `y`],
    [`_atom_site_fract_z`, `z`],
    [`_atom_site_cartn_x`, `cart_x`],
    [`_atom_site_cartn_y`, `cart_y`],
    [`_atom_site_cartn_z`, `cart_z`],
    [`_atom_site_occupancy`, `occupancy`],
    [`_atom_site_disorder_group`, `disorder`],
  ]

  headers.forEach((header, idx) => {
    const lower = header.trim().toLowerCase()
    const mapping = mappings.find(([suffix]) => lower.endsWith(suffix))
    if (mapping) indices[mapping[1]] = idx
  })

  return indices
}

type CifAtom = {
  id: string
  element: string
  coords: Vec3
  coords_type: `fract` | `cart`
  occupancy: number
}

// Parse atom data from CIF with robust error handling
const parse_cif_atom_data = (
  raw_data: string[],
  indices: Record<string, number>,
  coords_type: `fract` | `cart`,
): CifAtom => {
  const { label = 0, symbol = -1, occupancy = -1 } = indices
  const coord_indices = coords_type === `fract`
    ? [indices.x, indices.y, indices.z]
    : [indices.cart_x, indices.cart_y, indices.cart_z]

  if (coord_indices.some((idx) => idx === undefined)) {
    throw new Error(`Missing coordinate indices`)
  }

  const coords_triplet = coord_indices.map((idx) => {
    if (idx === undefined) throw new Error(`Invalid coordinate index`)
    const coord_str = raw_data[idx]
    if (!coord_str) throw new Error(`Missing coordinate at index ${idx}`)
    const coord = parseFloat(coord_str.split(`(`)[0])
    if (isNaN(coord)) throw new Error(`Invalid coordinate: ${coord_str}`)
    return coord
  }) as Vec3

  const occu = occupancy >= 0 && raw_data[occupancy]
    ? parseFloat(raw_data[occupancy].split(`(`)[0]) || 1.0
    : 1.0

  const element_symbol =
    (symbol >= 0 && raw_data[symbol]?.match(/^([A-Z][a-z]*)/)?.[1]) ||
    raw_data[label]?.match(/([A-Z][a-z]*)/g)?.[0] ||
    (() => {
      throw new Error(`Could not extract element symbol from: ${raw_data.join(` `)}`)
    })()

  return {
    id: raw_data[label],
    element: element_symbol,
    coords: coords_triplet,
    coords_type,
    occupancy: occu,
  }
}

// Parse CIF (Crystallographic Information File) format
export function parse_cif(
  content: string,
  wrap_frac: boolean = true,
  strict: boolean = true,
): ParsedStructure | null {
  try {
    const text = content.trim()
    if (!text) {
      console.error(`CIF file is empty`)
      return null
    }

    // Find atom site loop that actually contains coordinates (fract or Cartn)
    const lines = text.split(`\n`)
    let atom_headers: string[] = []
    const atom_data_lines: string[] = []
    const symmetry_ops: string[] = []

    for (let ii = 0; ii < lines.length; ii++) {
      if (lines[ii].trim() !== `loop_`) continue

      let jj = ii + 1
      const headers: string[] = []

      // Collect headers for this loop
      while (jj < lines.length && lines[jj].trim().startsWith(`_`)) {
        headers.push(lines[jj].trim())
        jj++
      }

      // Check if this is a symmetry operations loop
      if (
        headers.some((h) =>
          h.includes(`_symmetry_equiv_pos_as_xyz`) ||
          h.includes(`_space_group_symop_operation_xyz`)
        )
      ) {
        // Collect symmetry operations
        while (jj < lines.length) {
          const line = lines[jj].trim()
          if (line === `loop_` || line.startsWith(`data_`)) break
          if (line && !line.startsWith(`#`) && !line.startsWith(`;`)) {
            symmetry_ops.push(line)
          }
          jj++
        }
        continue
      }

      // Not an atom-site loop → continue search
      if (!headers.some((h) => h.includes(`_atom_site_`))) continue

      // Check if this loop contains coordinate headers
      const indices_preview = build_cif_atom_site_header_indices(headers)
      const has_coords =
        (indices_preview.x !== undefined && indices_preview.y !== undefined &&
          indices_preview.z !== undefined) ||
        (indices_preview.cart_x !== undefined && indices_preview.cart_y !== undefined &&
          indices_preview.cart_z !== undefined)

      if (!has_coords) {
        ii = jj - 1
        continue
      }

      // This is the desired atom-site loop with coordinates: collect data lines
      atom_headers = headers
      while (jj < lines.length) {
        const line = lines[jj].trim()
        if (line === `loop_` || line.startsWith(`data_`)) break
        if (line && !line.startsWith(`#`)) {
          if (line.startsWith(`;`)) {
            let multi_line_data = ``
            while (jj < lines.length && !lines[jj].trim().endsWith(`;`)) {
              multi_line_data += lines[jj] + `\n`
              jj++
            }
            multi_line_data += lines[jj]
            atom_data_lines.push(multi_line_data.trim())
          } else {
            atom_data_lines.push(line)
          }
        }
        jj++
      }
      if (atom_data_lines.length > 0) break
    }

    if (!atom_headers.length || !atom_data_lines.length) {
      console.error(`No valid atom site loop found in CIF file`)
      return null
    }

    // Parse atom data with error handling
    const header_indices = build_cif_atom_site_header_indices(atom_headers)

    // Determine available coordinate type
    const coords_type: `fract` | `cart` | null =
      header_indices.x !== undefined && header_indices.y !== undefined &&
        header_indices.z !== undefined
        ? `fract`
        : header_indices.cart_x !== undefined && header_indices.cart_y !== undefined &&
            header_indices.cart_z !== undefined
        ? `cart`
        : null

    if (!coords_type) {
      console.error(`CIF atom site loop missing coordinates (fract or Cartn)`)
      return null
    }

    // Collect required coordinate indices
    const required_indices = coords_type === `fract`
      ? [header_indices.x, header_indices.y, header_indices.z]
      : [header_indices.cart_x, header_indices.cart_y, header_indices.cart_z]

    const atoms = atom_data_lines
      .map((line) => {
        // Handle quoted multi-word values by splitting only on whitespace
        // that is not inside quotes.
        const tokens = line.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []
        return tokens.map((token) => token.replace(/['"]/g, ``))
      })
      .filter((tokens) => {
        const { disorder } = header_indices
        const max_required_idx = Math.max(...required_indices)
        return (
          !(disorder !== undefined && tokens[disorder] === `2`) &&
          tokens.length > max_required_idx
        )
      })
      .map((tokens) => {
        try {
          return parse_cif_atom_data(tokens, header_indices, coords_type)
        } catch (error) {
          console.warn(`Skipping invalid atom data: ${error}`)
          return null
        }
      })
      .filter((atom): atom is NonNullable<typeof atom> => atom !== null)

    if (!atoms.length) {
      console.error(`No valid atoms found in CIF file`)
      return null
    }

    // Extract cell parameters and build lattice
    const lengths = extract_cif_cell_parameters(text, `cell_length`, strict)
    const angles = extract_cif_cell_parameters(text, `cell_angle`, strict)

    if (lengths.length < 3 || angles.length < 3) {
      console.error(`Insufficient cell parameters in CIF file`)
      return null
    }

    // Build lattice and create sites
    const [a, b, c] = lengths
    const [alpha, beta, gamma] = angles
    const lattice_matrix = math.cell_to_lattice_matrix(a, b, c, alpha, beta, gamma)
    const lattice_params = math.calc_lattice_params(lattice_matrix)
    const lattice_T = math.transpose_3x3_matrix(lattice_matrix)
    let lattice_invT: Matrix3x3 | null = null
    try {
      lattice_invT = math.matrix_inverse_3x3(lattice_T)
    } catch {
      lattice_invT = null
    }

    // Create sites with coordinate conversion and symmetry operations
    const wrap_vec3 = (v: Vec3): Vec3 =>
      wrap_frac ? v.map((coord) => coord - Math.floor(coord)) as Vec3 : v

    // Apply symmetry operations to generate all equivalent positions
    const all_sites: Site[] = []

    // Normalize symmetry operations (trim/strip quotes) but preserve duplicates; we deduplicate positions later
    const normalized_ops = symmetry_ops
      .map((op) => op.match(/['\"]([^'\"]+)['\"]/)?.[1] || op.trim())
      .map((op) => op.replace(/\s+/g, ``))

    // Rely on symmetry operations list for all centering/translations to avoid double-counting
    const centering_vectors: Vec3[] = [[0, 0, 0]]

    // Inspect optional _atom_type_number_in_cell loop to see if atom sites are already expanded
    const atom_type_counts: Record<string, number> = (() => {
      const map: Record<string, number> = {}
      const text_lines = text.split(`\n`)
      for (let li = 0; li < text_lines.length; li++) {
        if (text_lines[li].trim() !== `loop_`) {
          continue
        }
        let lj = li + 1
        const hdrs: string[] = []
        while (lj < text_lines.length && text_lines[lj].trim().startsWith(`_`)) {
          hdrs.push(text_lines[lj].trim().toLowerCase())
          lj++
        }
        const sym_idx = hdrs.findIndex((h) => h.endsWith(`_atom_type_symbol`))
        const num_idx = hdrs.findIndex((h) => h.endsWith(`_atom_type_number_in_cell`))
        if (sym_idx !== -1 && num_idx !== -1) {
          while (lj < text_lines.length) {
            const line = text_lines[lj].trim()
            if (!line || line === `loop_` || line.startsWith(`data_`)) break
            if (line.startsWith(`#`)) {
              lj++
              continue
            }
            const toks = (line.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []).map((t) =>
              t.replace(/['"]/g, ``)
            )
            if (toks.length > Math.max(sym_idx, num_idx)) {
              // Normalize type symbol to bare element (e.g., 'Sn2+' -> 'Sn')
              const match = toks[sym_idx]?.match(/^([A-Z][a-z]*)/)
              const sym = match ? match[1] : toks[sym_idx]
              const num = parseInt(toks[num_idx])
              if (sym && !Number.isNaN(num)) map[sym] = num
            }
            lj++
          }
          break
        }
      }
      return map
    })()

    const observed_counts: Record<string, number> = {}
    for (const a of atoms) {
      observed_counts[a.element] = (observed_counts[a.element] || 0) + 1
    }

    const has_expected_counts = Object.keys(atom_type_counts).length > 0
    const already_enumerated = has_expected_counts &&
      Object.entries(atom_type_counts).every(([el, exp]) =>
        (observed_counts[el] || 0) >= exp
      )

    const ops_to_use = already_enumerated ? [] : normalized_ops

    // Global deduplication of final sites (per element + coordinates)
    const seen_site_keys = new Set<string>()
    const site_key = (element: string, abc: Vec3): string =>
      `${element}|${abc[0].toFixed(12)},${abc[1].toFixed(12)},${abc[2].toFixed(12)}`

    for (const atom of atoms) {
      const element = validate_element_symbol(atom.element, all_sites.length)

      // Convert to fractional coordinates if needed
      let fract_atom: CifAtom
      if (atom.coords_type === `fract`) {
        fract_atom = {
          ...atom,
          coords: wrap_vec3(atom.coords as Vec3),
          coords_type: `fract`,
        }
      } else {
        const xyz_base: Vec3 = [atom.coords[0], atom.coords[1], atom.coords[2]]
        let atom_abc: Vec3
        if (lattice_invT) {
          const raw = math.mat3x3_vec3_multiply(lattice_invT, xyz_base)
          atom_abc = wrap_vec3(raw as Vec3)
        } else atom_abc = wrap_vec3([xyz_base[0] / a, xyz_base[1] / b, xyz_base[2] / c])
        fract_atom = { ...atom, coords: atom_abc, coords_type: `fract` }
      }

      // First apply symmetry operations in fractional space
      const equiv_atoms = apply_symmetry_ops(fract_atom, ops_to_use, wrap_frac)

      // Then apply lattice centering shifts to each equivalent position
      for (const equiv_atom of equiv_atoms) {
        for (const cv of centering_vectors) {
          const abc = wrap_vec3([
            equiv_atom.coords[0] + cv[0],
            equiv_atom.coords[1] + cv[1],
            equiv_atom.coords[2] + cv[2],
          ] as Vec3)
          const key = site_key(element, abc)
          if (seen_site_keys.has(key)) continue
          seen_site_keys.add(key)
          const xyz = math.mat3x3_vec3_multiply(lattice_T, abc)
          all_sites.push({
            species: [{ element, occu: equiv_atom.occupancy, oxidation_state: 0 }],
            abc,
            xyz,
            label: equiv_atom.id,
            properties: {},
          })
        }
      }
    }

    const sites = all_sites
    return { sites, lattice: { matrix: lattice_matrix, ...lattice_params } }
  } catch (error) {
    console.error(`Error parsing CIF file:`, error)
    return null
  }
}

// Convert phonopy cell to ParsedStructure
function convert_phonopy_cell(cell: PhonopyCell): ParsedStructure {
  const sites: Site[] = []
  // Phonopy stores lattice vectors as rows, use them directly
  const lattice_matrix = cell.lattice as Matrix3x3

  // Process each atomic site
  for (const point of cell.points) {
    const element = validate_element_symbol(point.symbol, sites.length)
    const abc: Vec3 = [
      point.coordinates[0],
      point.coordinates[1],
      point.coordinates[2],
    ]

    // Convert fractional to Cartesian coordinates
    const xyz = math.mat3x3_vec3_multiply(
      math.transpose_3x3_matrix(lattice_matrix),
      abc,
    )

    const properties = {
      mass: point.mass,
      ...(point.reduced_to !== undefined && { reduced_to: point.reduced_to }),
    }
    const species = [{ element, occu: 1.0, oxidation_state: 0 }]
    const site: Site = { species, abc, xyz, label: point.symbol, properties }
    sites.push(site)
  }

  // Calculate lattice parameters
  const calculated_lattice_params = math.calc_lattice_params(lattice_matrix)

  return { sites, lattice: { matrix: lattice_matrix, ...calculated_lattice_params } }
}

export type CellType =
  | `primitive_cell`
  | `unit_cell`
  | `supercell`
  | `phonon_primitive_cell`
  | `phonon_supercell`
  | `auto`

// Parse phonopy YAML file and return the requested cell type (or preferred single structure)
export function parse_phonopy_yaml(
  content: string,
  cell_type?: CellType,
): ParsedStructure | null {
  try {
    // Parse YAML content but exclude large phonon_displacements array for performance
    const lines = content.split(`\n`)
    const filtered_lines = []
    let skip_displacements = false

    for (const line of lines) {
      // Skip phonon_displacements section for performance
      if (line.trim().startsWith(`phonon_displacements:`)) {
        skip_displacements = true
        continue
      }

      // Check if we're still in the phonon_displacements section
      if (skip_displacements) {
        if (line.match(/^[a-zA-Z_]/)) {
          // New top-level key, stop skipping
          skip_displacements = false
        } else continue // Still in phonon_displacements, skip this line
      }

      filtered_lines.push(line)
    }

    const filtered_content = filtered_lines.join(`\n`)
    const data = yaml_load(filtered_content) as PhonopyData

    if (!data) {
      console.error(`Failed to parse phonopy YAML`)
      return null
    }

    // If specific cell type requested, parse only that one
    if (cell_type && cell_type !== `auto`) {
      const cell = data[cell_type]
      if (cell) return convert_phonopy_cell(cell)
      else {
        console.error(`Requested cell type '${cell_type}' not found in phonopy YAML`)
        return null
      }
    }

    // Auto mode: return preferred structure in order of preference
    // 1. supercell (most detailed)
    // 2. phonon_supercell
    // 3. unit_cell
    // 4. phonon_primitive_cell
    // 5. primitive_cell

    if (data.supercell) return convert_phonopy_cell(data.supercell)
    else if (data.phonon_supercell) return convert_phonopy_cell(data.phonon_supercell)
    else if (data.unit_cell) return convert_phonopy_cell(data.unit_cell)
    else if (data.phonon_primitive_cell) {
      return convert_phonopy_cell(data.phonon_primitive_cell)
    } else if (data.primitive_cell) return convert_phonopy_cell(data.primitive_cell)

    console.error(`No valid cells found in phonopy YAML`)
    return null
  } catch (error) {
    console.error(`Error parsing phonopy YAML:`, error)
    return null
  }
}

// Recursively search for a valid structure object in nested JSON
function find_structure_in_json(
  obj: unknown,
  visited = new WeakSet(),
): ParsedStructure | null {
  // Check if current object is null or undefined
  if (obj === null || obj === undefined) {
    return null
  }

  // If it's not an object, skip it
  if (typeof obj !== `object`) {
    return null
  }

  // Check for circular references
  if (visited.has(obj)) return null
  visited.add(obj)

  // If it's an array, search through each element
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const result = find_structure_in_json(item, visited)
      if (result) return result
    }
    return null
  }

  // Check if this object looks like a valid structure
  const potential_structure = obj as Record<string, unknown>
  if (is_valid_structure_object(potential_structure)) {
    return potential_structure as unknown as ParsedStructure
  }

  // Otherwise, recursively search through all properties
  for (const value of Object.values(potential_structure)) {
    const result = find_structure_in_json(value, visited)
    if (result) return result
  }

  return null
}

// Check if an object looks like a valid structure
function is_valid_structure_object(obj: Record<string, unknown>): boolean {
  // Must have sites array
  if (!obj.sites || !Array.isArray(obj.sites)) {
    return false
  }

  // Sites array must not be empty and contain valid site objects
  if (obj.sites.length === 0) {
    return false
  }

  // Check if first site looks valid (has species and coordinates)
  const first_site = obj.sites[0] as Record<string, unknown>
  if (!first_site || typeof first_site !== `object`) {
    return false
  }

  // Must have species (array) and either abc or xyz coordinates
  const has_species = Array.isArray(first_site.species) && first_site.species.length > 0
  const has_coordinates = Array.isArray(first_site.abc) || Array.isArray(first_site.xyz)

  return has_species && has_coordinates
}

// Auto-detect file format and parse accordingly
export function parse_structure_file(
  content: string,
  filename?: string,
): ParsedStructure | null {
  // If a filename is provided, try to detect format by file extension first
  if (filename) {
    // Handle compressed files by removing compression extensions
    let base_filename = filename.toLowerCase()
    const extensions = COMPRESSION_EXTENSIONS.map((ext: string) => ext.slice(1))
    const compression_regex = new RegExp(`\\.(${extensions.join(`|`)})$`, `i`)
    while (compression_regex.test(base_filename)) {
      base_filename = base_filename.replace(compression_regex, ``)
    }

    const ext = base_filename.split(`.`).pop()

    // Try to detect format by file extension
    if (ext === `xyz`) {
      return parse_xyz(content)
    }

    // CIF files
    if (ext === `cif`) {
      return parse_cif(content)
    }

    // JSON files - try OPTIMADE JSON structure format first, then pymatgen
    if (ext === `json`) {
      try {
        // Parse once, reuse for detection and parsing
        const parsed = JSON.parse(content)
        if (is_optimade_raw(parsed)) {
          const result = parse_optimade_from_raw(parsed)
          if (result) return result
        }
        // Otherwise, try to parse as pymatgen/nested structure JSON
        const structure = find_structure_in_json(parsed)
        if (structure) {
          return structure
        }
        console.error(`JSON file does not contain a valid structure format`)
        return null
      } catch (error) {
        console.error(`Error parsing JSON file:`, error)
        return null
      }
    }

    // YAML files (phonopy)
    if (ext === `yaml` || ext === `yml`) return parse_phonopy_yaml(content)

    // POSCAR files may not have extensions or have various names
    if (ext === `poscar` || base_filename.includes(`poscar`)) {
      return parse_poscar(content)
    }
  }

  // Try to auto-detect based on content
  const lines = content.trim().split(/\r?\n/)

  if (lines.length < 2) {
    console.error(`File too short to determine format`)
    return null
  }

  // JSON format detection: try to parse as JSON first
  try {
    const parsed = JSON.parse(content)
    if (is_optimade_raw(parsed)) {
      const result = parse_optimade_from_raw(parsed)
      if (result) return result
    }
    // Otherwise try parsing as regular JSON structure
    const structure = find_structure_in_json(parsed)
    if (structure) {
      return structure
    }
  } catch {
    // Not JSON, continue with other format detection
  }

  // XYZ format detection: first line should be a number, second line is comment
  const first_line_number = parseInt(lines[0].trim())
  if (!isNaN(first_line_number) && first_line_number > 0) {
    // Check if this looks like XYZ format
    if (lines.length >= first_line_number + 2) {
      // Try to parse a coordinate line to see if it looks like XYZ
      const coord_line_idx = 2 // First coordinate line in XYZ
      if (coord_line_idx < lines.length) {
        const parts = lines[coord_line_idx].trim().split(/\s+/)
        // XYZ format: element symbol followed by 3 coordinates
        if (parts.length >= 4) {
          const first_token = parts[0]
          const coords = parts.slice(1, 4)

          // Check if first token looks like an element symbol (not a number)
          // and the next 3 tokens look like coordinates (numbers)
          const is_element_symbol = isNaN(parseInt(first_token)) &&
            first_token.length <= 3
          const are_coordinates = coords.every(
            (coord) => !isNaN(parseFloat(coord)),
          )

          if (is_element_symbol && are_coordinates) {
            // First token is likely an element symbol, likely XYZ
            return parse_xyz(content)
          }
        }
      }
    }
  }

  // POSCAR format detection: look for typical structure
  if (lines.length >= 8) {
    const second_line_number = parseFloat(lines[1].trim())
    // Second line is a number (scale factor), likely POSCAR
    if (!isNaN(second_line_number)) return parse_poscar(content)
  }

  // CIF format detection: look for CIF-specific keywords
  const has_cif_keywords = lines.some(
    (line) =>
      line.startsWith(`data_`) ||
      line.includes(`_cell_length_`) ||
      line.includes(`_atom_site_`) ||
      line.trim() === `loop_`,
  )
  if (has_cif_keywords) return parse_cif(content)

  // YAML format detection: look for phonopy-specific keywords
  const has_phonopy_keywords = lines.some(
    (line) =>
      line.includes(`phono3py:`) ||
      line.includes(`phonopy:`) ||
      line.includes(`primitive_cell:`) ||
      line.includes(`supercell:`) ||
      line.includes(`phonon_supercell:`),
  )
  if (has_phonopy_keywords) return parse_phonopy_yaml(content)

  console.error(`Unable to determine file format`)
  return null
}

// Universal parser that handles JSON and structure files
export function parse_any_structure(
  content: string,
  filename: string,
): AnyStructure | null {
  // Try JSON first, but handle nested structures properly
  try {
    const parsed = JSON.parse(content)

    // Check if it's already a valid structure
    if (parsed.sites && Array.isArray(parsed.sites)) return parsed
    // If not, use parse_structure_file to find nested structures
    const structure = parse_structure_file(content, filename)

    if (structure) {
      return {
        sites: structure.sites,
        charge: 0,
        ...(structure.lattice && {
          lattice: { ...structure.lattice, pbc: [true, true, true] },
        }),
      }
    } else return null
  } catch {
    // Try structure file formats
    const parsed = parse_structure_file(content, filename)
    if (parsed) {
      return {
        sites: parsed.sites,
        charge: 0,
        ...(parsed.lattice && {
          lattice: { ...parsed.lattice, pbc: [true, true, true] },
        }),
      }
    } else return null
  }
}

// Parse OPTIMADE JSON format
export function parse_optimade_json(content: string): ParsedStructure | null {
  try {
    const raw = JSON.parse(content) as unknown
    return parse_optimade_from_raw(raw)
  } catch (error) {
    console.error(`Error parsing OPTIMADE JSON:`, error)
    return null
  }
}

// Parse OPTIMADE from already-parsed JSON
export function parse_optimade_from_raw(raw: unknown): ParsedStructure | null {
  try {
    const structure = extract_optimade_structure_from_raw(raw)
    if (!structure) {
      console.error(`No valid OPTIMADE structure found in JSON`)
      return null
    }
    const attrs = structure.attributes

    // Inline validation for conciseness
    const positions_raw = (attrs as Record<string, unknown>).cartesian_site_positions
    const species_raw = (attrs as Record<string, unknown>).species_at_sites
    if (!(Array.isArray(positions_raw) && Array.isArray(species_raw))) {
      console.error(`OPTIMADE JSON missing required position or species data`)
      return null
    }
    if (positions_raw.length !== species_raw.length) {
      console.error(`OPTIMADE JSON position/species count mismatch`)
      return null
    }
    const positions = positions_raw as number[][]
    const species = species_raw as string[]

    // Optimade stores lattice vectors as rows, so use as is
    const lattice_matrix = attrs.lattice_vectors as Matrix3x3 | undefined

    // Parse atomic sites
    const sites: Site[] = []
    for (let idx = 0; idx < positions.length; idx++) {
      const pos = positions[idx]
      const element_symbol = species[idx]

      if (!pos || pos.length < 3) {
        console.warn(`Invalid position data at site ${idx}`)
        continue
      }

      const element = validate_element_symbol(element_symbol, idx)
      const xyz: Vec3 = [pos[0], pos[1], pos[2]]

      // Calculate fractional coordinates if lattice is available
      let abc: Vec3 = [0, 0, 0]
      if (lattice_matrix) {
        try {
          const lattice_transposed = math.transpose_3x3_matrix(lattice_matrix)
          const lattice_inv = math.matrix_inverse_3x3(lattice_transposed)
          abc = math.mat3x3_vec3_multiply(lattice_inv, xyz)
        } catch {
          // Fallback if matrix inversion fails
          console.warn(
            `Failed to calculate fractional coordinates for OPTIMADE structure`,
          )
        }
      }

      const site: Site = {
        species: [{ element, occu: 1, oxidation_state: 0 }],
        abc,
        xyz,
        label: `${element}${idx + 1}`,
        properties: {},
      }

      sites.push(site)
    }

    if (sites.length === 0) {
      console.error(`No valid sites found in OPTIMADE JSON`)
      return null
    }

    // Create structure object
    let lattice: ParsedStructure[`lattice`] | undefined
    if (lattice_matrix) {
      const lattice_params = math.calc_lattice_params(lattice_matrix)
      lattice = { matrix: lattice_matrix, ...lattice_params }
    }

    const structure_result: ParsedStructure = {
      sites,
      ...(lattice && { lattice }),
    }

    return structure_result
  } catch (error) {
    console.error(`Error parsing OPTIMADE JSON:`, error)
    return null
  }
}

// Check if JSON content is OPTIMADE format by looking for structure attributes
export function is_optimade_json(content: string): boolean {
  try {
    const raw = JSON.parse(content) as unknown
    return is_optimade_raw(raw)
  } catch {
    return false
  }
}

// Check if already-parsed JSON is OPTIMADE-like
export function is_optimade_raw(raw: unknown): boolean {
  return Boolean(extract_optimade_structure_from_raw(raw))
}

// Shared helper to extract an OPTIMADE structure from raw JSON-like data
function extract_optimade_structure_from_raw(raw: unknown): OptimadeStructure | null {
  const payload = unwrap_data(raw)
  const candidate = Array.isArray(payload) ? payload[0] : payload
  return is_optimade_structure_object(candidate) ? (candidate as OptimadeStructure) : null
}

const unwrap_data = (value: unknown): unknown =>
  (value && typeof value === `object` && `data` in (value as Record<string, unknown>))
    ? (value as { data: unknown }).data
    : value

// Type guard: verify minimal OPTIMADE structure shape
function is_optimade_structure_object(value: unknown): value is OptimadeStructure {
  if (!value || typeof value !== `object`) return false
  const obj = value as { type?: unknown; id?: unknown; attributes?: unknown }
  return obj.type === `structures` && typeof obj.id === `string` &&
    typeof obj.attributes === `object` && obj.attributes !== null
}

// Convert OPTIMADE structure to Pymatgen format
export function optimade_to_pymatgen(
  optimade_structure: OptimadeStructure,
): PymatgenStructure | null {
  const attrs = optimade_structure.attributes

  if (
    !attrs.lattice_vectors || !attrs.cartesian_site_positions || !attrs.species_at_sites
  ) {
    console.error(`Missing required OPTIMADE structure data`)
    return null
  }

  try {
    // Convert lattice vectors to matrix format
    const lattice_matrix: [Vec3, Vec3, Vec3] = [
      attrs.lattice_vectors[0] as Vec3,
      attrs.lattice_vectors[1] as Vec3,
      attrs.lattice_vectors[2] as Vec3,
    ]

    // Use math utilities to calculate lattice parameters
    const lattice_params = math.calc_lattice_params(lattice_matrix)

    // Create sites with proper fractional coordinate conversion
    const sites = attrs.cartesian_site_positions.map((pos, idx) => {
      const element_symbol = attrs.species_at_sites?.[idx]
      if (!element_symbol) {
        throw new Error(`Missing species for site ${idx}`)
      }
      const element = validate_element_symbol(element_symbol, idx)

      // Convert to fractional coordinates using matrix inversion
      const xyz: Vec3 = [pos[0], pos[1], pos[2]]
      let abc: Vec3
      try {
        const lattice_transposed = math.transpose_3x3_matrix(lattice_matrix)
        const inv_matrix = math.matrix_inverse_3x3(lattice_transposed)
        abc = math.mat3x3_vec3_multiply(inv_matrix, xyz)
      } catch (err) {
        console.warn(`Failed to convert to fractional coordinates for site ${idx}:`, err)
        abc = [0, 0, 0] // Fallback to origin
      }

      return {
        species: [{ element, occu: 1, oxidation_state: 0 }],
        abc,
        xyz,
        label: `${element}${idx + 1}`,
        properties: {},
      }
    })

    return {
      sites,
      lattice: {
        matrix: lattice_matrix,
        ...lattice_params,
        pbc: [true, true, true],
      },
      id: optimade_structure.id,
    }
  } catch (err) {
    console.error(`Error converting OPTIMADE to Pymatgen format:`, err)
    return null
  }
}

// Check if filename indicates a structure file
export function is_structure_file(filename: string): boolean {
  const name = filename.toLowerCase()

  // Trajectory-only formats (can't be structures)
  if (/\.(traj|xtc|h5|hdf5)$/i.test(name) || /xdatcar/i.test(name)) return false

  // Always structure formats
  if (/\.(cif|poscar|vasp|lmp|data|dump|pdb|mol|mol2|sdf|mmcif)$/i.test(name)) return true
  if (/(poscar|contcar|potcar|incar|kpoints|outcar)/i.test(name)) return true

  // .xyz files: structure unless they have trajectory keywords, .extxyz files: trajectory by default
  if (/\.extxyz$/i.test(name)) return false
  if (/\.xyz$/i.test(name)) {
    return !/(trajectory|traj|relax|npt|nvt|nve|qha|md|dynamics|simulation)/i.test(name)
  }

  // Keyword-based detection for YAML/JSON/XML
  const structure_keywords =
    /(structure|phono|vasp|crystal|material|lattice|geometry|unit_?cell|atoms|sites|data|phono3?py)/i
  const trajectory_keywords =
    /(trajectory|traj|relax|npt|nvt|nve|qha|md|dynamics|simulation)/i
  const config_dirs =
    /(\.vscode|\.idea|\.nyc_output|\.cache|\.tmp|\.temp|node_modules|dist|build|coverage)\//i

  if (/\.(yaml|yml)$/i.test(name) && structure_keywords.test(name)) return true
  if (/\.xml$/i.test(name) && structure_keywords.test(name)) return true
  if (
    /\.json$/i.test(name) && structure_keywords.test(name) &&
    !trajectory_keywords.test(name) && !config_dirs.test(name)
  ) return true

  // Compressed files - check base filename recursively
  if (/\.(gz|zip|xz)$/i.test(name)) {
    return is_structure_file(name.replace(/\.(gz|zip|xz)$/i, ``))
  }

  return false
}

export const detect_structure_type = (
  filename: string,
  content: string,
): `crystal` | `molecule` | `unknown` => {
  const lower_filename = filename.toLowerCase()

  // Normalize compressed suffixes (gz, gzip, zip, xz, bz2) for detection parity
  let name_to_check = lower_filename
  const extensions = COMPRESSION_EXTENSIONS.map((ext: string) => ext.slice(1))
  const compression_regex = new RegExp(`\\.(${extensions.join(`|`)})$`, `i`)
  while (compression_regex.test(name_to_check)) {
    name_to_check = name_to_check.replace(compression_regex, ``)
  }

  if (name_to_check.endsWith(`.json`)) {
    try {
      const parsed = JSON.parse(content)
      // Check for OPTIMADE JSON format (has data.attributes.lattice_vectors)
      if (parsed.data?.attributes?.lattice_vectors) return `crystal`
      // Check for dimension_types (OPTIMADE format)
      if (parsed.data?.attributes?.dimension_types?.some((dim: number) => dim > 0)) {
        return `crystal`
      }
      // Check for pymatgen JSON format (has lattice property)
      if (parsed.lattice) return `crystal`
      // Check for other crystal indicators
      if (parsed.data?.attributes?.nperiodic_dimensions > 0) return `crystal`

      return `molecule`
    } catch {
      return `unknown`
    }
  }

  if (name_to_check.endsWith(`.cif`)) return `crystal`
  if (name_to_check.includes(`poscar`)) return `crystal`

  if (name_to_check.endsWith(`.yaml`) || name_to_check.endsWith(`.yml`)) {
    const lower_content = content.toLowerCase()
    return lower_content.includes(`phono3py:`) || lower_content.includes(`phonopy:`)
      ? `crystal`
      : `unknown`
  }

  if (name_to_check.match(/\.(xyz|extxyz)$/)) {
    const lines = content.trim().split(/\r?\n/)
    return lines.length >= 2 && lines[1].includes(`Lattice=`) ? `crystal` : `molecule`
  }

  return `unknown`
}
