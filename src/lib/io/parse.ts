import { elem_symbols, type ElementSymbol, type Site, type Vec3 } from '$lib'
import type { Matrix3x3 } from '$lib/math'
import * as math from '$lib/math'

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
    const new_tokens: string[] = []
    for (const token of tokens) {
      // Split on minus signs that aren't at the start or after 'e'/'E'
      const parts = token
        .split(/(?<!^|[eE])-/)
        .filter((part) => part.length > 0)
      if (parts.length > 1) {
        new_tokens.push(parts[0])
        for (let part_idx = 1; part_idx < parts.length; part_idx++) {
          new_tokens.push(`-` + parts[part_idx])
        }
      } else {
        new_tokens.push(token)
      }
    }
    tokens = new_tokens
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
  const fallback_elements = [
    `H`,
    `He`,
    `Li`,
    `Be`,
    `B`,
    `C`,
    `N`,
    `O`,
    `F`,
    `Ne`,
  ]
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
      const volume = Math.abs(
        lattice_vecs[0][0] *
            (lattice_vecs[1][1] * lattice_vecs[2][2] -
              lattice_vecs[1][2] * lattice_vecs[2][1]) +
          lattice_vecs[0][1] *
            (lattice_vecs[1][2] * lattice_vecs[2][0] -
              lattice_vecs[1][0] * lattice_vecs[2][2]) +
          lattice_vecs[0][2] *
            (lattice_vecs[1][0] * lattice_vecs[2][1] -
              lattice_vecs[1][1] * lattice_vecs[2][0]),
      )
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
      element_symbols = atom_counts.map((_, i) =>
        validate_element_symbol(`Element${i}`, i)
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

          if (is_direct) {
            // Store fractional coordinates
            abc = [coords[0], coords[1], coords[2]]
            // Convert fractional to Cartesian coordinates
            xyz = [
              coords[0] * scaled_lattice[0][0] +
              coords[1] * scaled_lattice[1][0] +
              coords[2] * scaled_lattice[2][0],
              coords[0] * scaled_lattice[0][1] +
              coords[1] * scaled_lattice[1][1] +
              coords[2] * scaled_lattice[2][1],
              coords[0] * scaled_lattice[0][2] +
              coords[1] * scaled_lattice[1][2] +
              coords[2] * scaled_lattice[2][2],
            ]
          } else {
            // Already Cartesian, scale if needed
            xyz = [
              coords[0] * scale_factor,
              coords[1] * scale_factor,
              coords[2] * scale_factor,
            ]
            // Calculate fractional coordinates using proper matrix inversion
            // Note: Our lattice matrix is stored as row vectors, but for coordinate conversion
            // we need column vectors, so we transpose before inversion
            try {
              const lattice_transposed = math.transpose_matrix(scaled_lattice)
              const lattice_inv = math.matrix_inverse_3x3(lattice_transposed)
              abc = math.mat3x3_vec3_multiply(lattice_inv, xyz)
            } catch {
              // Fallback to simplified method if matrix is singular
              abc = [
                xyz[0] / scaled_lattice[0][0],
                xyz[1] / scaled_lattice[1][1],
                xyz[2] / scaled_lattice[2][2],
              ]
            }
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
        lattice: {
          matrix: scaled_lattice,
          ...lattice_params,
        },
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
      } else {
        line_idx++
      }
    }

    // If no frames found, try simple parsing
    if (frames.length === 0) {
      frames.push(normalized_content)
    }

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
        lattice = {
          matrix: lattice_vectors,
          ...lattice_params,
        }
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
          const lattice_transposed = math.transpose_matrix(lattice.matrix)
          const lattice_inv = math.matrix_inverse_3x3(lattice_transposed)
          abc = math.mat3x3_vec3_multiply(lattice_inv, xyz)
        } catch {
          // Fallback to simplified method if matrix is singular
          abc = [xyz[0] / lattice.a, xyz[1] / lattice.b, xyz[2] / lattice.c]
        }
      }

      const site: Site = {
        species: [{ element, occu: 1, oxidation_state: 0 }],
        abc,
        xyz,
        label: `${element}${atom_idx + 1}`,
        properties: {},
      }

      sites.push(site)
    }

    const structure: ParsedStructure = {
      sites,
      ...(lattice && { lattice }),
    }

    return structure
  } catch (error) {
    console.error(`Error parsing XYZ file:`, error)
    return null
  }
}

// Parse CIF (Crystallographic Information File) format
export function parse_cif(content: string): ParsedStructure | null {
  try {
    const lines = content.trim().split(/\r?\n/)

    if (lines.length < 2) {
      console.error(`CIF file too short`)
      return null
    }

    // Parse unit cell parameters
    let [cell_a, cell_b, cell_c] = [1, 1, 1]
    let [alpha, beta, gamma] = [90, 90, 90]

    // Find unit cell parameters
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith(`_cell_length_a`)) {
        cell_a = parseFloat(trimmed.split(/\s+/)[1])
      } else if (trimmed.startsWith(`_cell_length_b`)) {
        cell_b = parseFloat(trimmed.split(/\s+/)[1])
      } else if (trimmed.startsWith(`_cell_length_c`)) {
        cell_c = parseFloat(trimmed.split(/\s+/)[1])
      } else if (trimmed.startsWith(`_cell_angle_alpha`)) {
        alpha = parseFloat(trimmed.split(/\s+/)[1])
      } else if (trimmed.startsWith(`_cell_angle_beta`)) {
        beta = parseFloat(trimmed.split(/\s+/)[1])
      } else if (trimmed.startsWith(`_cell_angle_gamma`)) {
        gamma = parseFloat(trimmed.split(/\s+/)[1])
      }
    }

    // Calculate lattice vectors from unit cell parameters using math utility
    const lattice_matrix = math.cell_to_lattice_matrix(
      ...[cell_a, cell_b, cell_c, alpha, beta, gamma],
    )

    // Calculate lattice parameters (including volume)
    const calculated_lattice_params = math.calc_lattice_params(lattice_matrix)

    // Find atom site data
    const sites: Site[] = []
    let in_atom_site_loop = false
    let atom_site_headers: string[] = []
    let header_indices: Record<string, number> = {}

    for (let line_idx = 0; line_idx < lines.length; line_idx++) {
      const line = lines[line_idx].trim()

      // Look for atom site loop
      if (line === `loop_`) {
        // Check if next few lines contain atom site labels
        let next_line_idx = line_idx + 1
        const potential_headers: string[] = []

        while (next_line_idx < lines.length) {
          const next_line = lines[next_line_idx].trim()
          if (next_line.startsWith(`_atom_site_`)) {
            potential_headers.push(next_line)
            next_line_idx++
          } else {
            break
          }
        }

        if (potential_headers.length > 0) {
          in_atom_site_loop = true
          atom_site_headers = potential_headers

          // Build header-to-index mapping once
          header_indices = {}
          for (
            let header_idx = 0;
            header_idx < atom_site_headers.length;
            header_idx++
          ) {
            const header = atom_site_headers[header_idx]
            if (header.includes(`_atom_site_label`)) {
              header_indices.label = header_idx
            } else if (header.includes(`_atom_site_type_symbol`)) {
              header_indices.symbol = header_idx
            } else if (header.includes(`_atom_site_fract_x`)) {
              header_indices.x = header_idx
            } else if (header.includes(`_atom_site_fract_y`)) {
              header_indices.y = header_idx
            } else if (header.includes(`_atom_site_fract_z`)) {
              header_indices.z = header_idx
            } else if (header.includes(`_atom_site_occupancy`)) {
              header_indices.occupancy = header_idx
            }
          }

          line_idx = next_line_idx - 1 // Skip to data section
          continue
        }
      }

      // Parse atom site data
      if (
        in_atom_site_loop &&
        line &&
        !line.startsWith(`_`) &&
        !line.startsWith(`#`)
      ) {
        const tokens = line.split(/\s+/)

        if (tokens.length >= atom_site_headers.length) {
          // Use precomputed header indices
          const label_idx = header_indices.label >= 0 ? header_indices.label : -1
          const symbol_idx = header_indices.symbol >= 0 ? header_indices.symbol : -1
          const x_idx = header_indices.x >= 0 ? header_indices.x : -1
          const y_idx = header_indices.y >= 0 ? header_indices.y : -1
          const z_idx = header_indices.z >= 0 ? header_indices.z : -1
          const occ_idx = header_indices.occupancy >= 0 ? header_indices.occupancy : -1

          if (symbol_idx >= 0 && x_idx >= 0 && y_idx >= 0 && z_idx >= 0) {
            try {
              const element_symbol = tokens[symbol_idx]
              const fract_x = parseFloat(tokens[x_idx])
              const fract_y = parseFloat(tokens[y_idx])
              const fract_z = parseFloat(tokens[z_idx])
              const occupancy = occ_idx >= 0 ? parseFloat(tokens[occ_idx]) : 1.0
              const label = label_idx >= 0 ? tokens[label_idx] : element_symbol

              if (isNaN(fract_x) || isNaN(fract_y) || isNaN(fract_z)) {
                continue
              }

              const element = validate_element_symbol(
                element_symbol,
                sites.length,
              )
              const abc: Vec3 = [fract_x, fract_y, fract_z]

              // Convert fractional to Cartesian coordinates
              const xyz = math.mat3x3_vec3_multiply(
                math.transpose_matrix(lattice_matrix),
                abc,
              )

              const site: Site = {
                species: [{ element, occu: occupancy, oxidation_state: 0 }],
                abc,
                xyz,
                label,
                properties: {},
              }

              sites.push(site)
            } catch (error) {
              console.warn(`Error parsing CIF atom site line: ${line}`, error)
            }
          }
        }
      }

      // End of loop or start of new section
      if (
        in_atom_site_loop &&
        (line.startsWith(`loop_`) || line.startsWith(`data_`) || line === ``)
      ) {
        in_atom_site_loop = false
      }
    }

    if (sites.length === 0) {
      console.error(`No atom sites found in CIF file`)
      return null
    }

    const structure: ParsedStructure = {
      sites,
      lattice: {
        matrix: lattice_matrix,
        ...calculated_lattice_params,
      },
    }

    return structure
  } catch (error) {
    console.error(`Error parsing CIF file:`, error)
    return null
  }
}

// Auto-detect file format and parse accordingly
export function parse_structure_file(
  content: string,
  filename?: string,
): ParsedStructure | null {
  // If a filename is provided, try to detect format by file extension first
  if (filename) {
    const ext = filename.toLowerCase().split(`.`).pop()

    // Try to detect format by file extension
    if (ext === `xyz`) {
      return parse_xyz(content)
    }

    // CIF files
    if (ext === `cif`) {
      return parse_cif(content)
    }

    // POSCAR files may not have extensions or have various names
    if (ext === `poscar` || filename.toLowerCase().includes(`poscar`)) {
      return parse_poscar(content)
    }
  }

  // Try to auto-detect based on content
  const lines = content.trim().split(/\r?\n/)

  if (lines.length < 2) {
    console.error(`File too short to determine format`)
    return null
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
    if (!isNaN(second_line_number)) {
      // Second line is a number (scale factor), likely POSCAR
      return parse_poscar(content)
    }
  }

  // CIF format detection: look for CIF-specific keywords
  const has_cif_keywords = lines.some(
    (line) =>
      line.startsWith(`data_`) ||
      line.includes(`_cell_length_`) ||
      line.includes(`_atom_site_`) ||
      line.trim() === `loop_`,
  )
  if (has_cif_keywords) {
    return parse_cif(content)
  }

  console.error(`Unable to determine file format`)
  return null
}
