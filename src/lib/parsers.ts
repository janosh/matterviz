import { elem_symbols, type ElementSymbol, type Site, type Vector } from '$lib'

// Import matrix functions for proper fractional coordinate calculation
function matrix_inverse_3x3(
  matrix: [Vector, Vector, Vector],
): [Vector, Vector, Vector] {
  /** Calculate the inverse of a 3x3 matrix */
  const [[a, b, c], [d, e, f], [g, h, i]] = matrix

  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)

  if (Math.abs(det) < 1e-10) {
    throw `Matrix is singular and cannot be inverted`
  }

  const inv_det = 1 / det

  return [
    [
      (e * i - f * h) * inv_det,
      (c * h - b * i) * inv_det,
      (b * f - c * e) * inv_det,
    ],
    [
      (f * g - d * i) * inv_det,
      (a * i - c * g) * inv_det,
      (c * d - a * f) * inv_det,
    ],
    [
      (d * h - e * g) * inv_det,
      (b * g - a * h) * inv_det,
      (a * e - b * d) * inv_det,
    ],
  ]
}

function matrix_vector_multiply(
  matrix: [Vector, Vector, Vector],
  vector: Vector,
): Vector {
  /** Multiply a 3x3 matrix by a 3D vector */
  return [
    matrix[0][0] * vector[0] +
      matrix[0][1] * vector[1] +
      matrix[0][2] * vector[2],
    matrix[1][0] * vector[0] +
      matrix[1][1] * vector[1] +
      matrix[1][2] * vector[2],
    matrix[2][0] * vector[0] +
      matrix[2][1] * vector[1] +
      matrix[2][2] * vector[2],
  ]
}

function transpose_matrix(
  matrix: [Vector, Vector, Vector],
): [Vector, Vector, Vector] {
  /** Transpose a 3x3 matrix */
  return [
    [matrix[0][0], matrix[1][0], matrix[2][0]],
    [matrix[0][1], matrix[1][1], matrix[2][1]],
    [matrix[0][2], matrix[1][2], matrix[2][2]],
  ]
}

export interface ParsedStructure {
  sites: Site[]
  lattice?: {
    matrix: [Vector, Vector, Vector]
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
    throw new Error(`Invalid coordinate value: ${str}`)
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
        for (let i = 1; i < parts.length; i++) {
          new_tokens.push(`-` + parts[i])
        }
      } else {
        new_tokens.push(token)
      }
    }
    tokens = new_tokens
  }

  if (tokens.length < 3) {
    throw new Error(`Insufficient coordinates in line: ${line}`)
  }

  return tokens.slice(0, 3).map(parse_coordinate)
}

/**
 * Calculate lattice parameters from lattice vectors
 */
function calculate_lattice_parameters(matrix: [Vector, Vector, Vector]) {
  const [a_vec, b_vec, c_vec] = matrix

  const a = Math.sqrt(a_vec[0] ** 2 + a_vec[1] ** 2 + a_vec[2] ** 2)
  const b = Math.sqrt(b_vec[0] ** 2 + b_vec[1] ** 2 + b_vec[2] ** 2)
  const c = Math.sqrt(c_vec[0] ** 2 + c_vec[1] ** 2 + c_vec[2] ** 2)

  // Calculate angles in degrees
  const dot_ab = a_vec[0] * b_vec[0] + a_vec[1] * b_vec[1] + a_vec[2] * b_vec[2]
  const dot_ac = a_vec[0] * c_vec[0] + a_vec[1] * c_vec[1] + a_vec[2] * c_vec[2]
  const dot_bc = b_vec[0] * c_vec[0] + b_vec[1] * c_vec[1] + b_vec[2] * c_vec[2]

  const gamma = Math.acos(dot_ab / (a * b)) * (180 / Math.PI) // angle between a and b
  const beta = Math.acos(dot_ac / (a * c)) * (180 / Math.PI) // angle between a and c
  const alpha = Math.acos(dot_bc / (b * c)) * (180 / Math.PI) // angle between b and c

  // Calculate volume using scalar triple product
  const volume = Math.abs(
    a_vec[0] * (b_vec[1] * c_vec[2] - b_vec[2] * c_vec[1]) +
      a_vec[1] * (b_vec[2] * c_vec[0] - b_vec[0] * c_vec[2]) +
      a_vec[2] * (b_vec[0] * c_vec[1] - b_vec[1] * c_vec[0]),
  )

  return { a, b, c, alpha, beta, gamma, volume }
}

/**
 * Validate element symbol and provide fallback
 */
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
    const lattice_vecs: [Vector, Vector, Vector] = [
      lines[2].trim().split(/\s+/).map(parse_coordinate) as Vector,
      lines[3].trim().split(/\s+/).map(parse_coordinate) as Vector,
      lines[4].trim().split(/\s+/).map(parse_coordinate) as Vector,
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
    const scaled_lattice: [Vector, Vector, Vector] = [
      lattice_vecs[0].map((x) => x * scale_factor) as Vector,
      lattice_vecs[1].map((x) => x * scale_factor) as Vector,
      lattice_vecs[2].map((x) => x * scale_factor) as Vector,
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
      for (let i = 1; i < 10; i++) {
        if (line_index + i >= lines.length) break
        const next_line_first_token = lines[line_index + i]
          .trim()
          .split(/\s+/)[0]
        const next_token_as_number = parseInt(next_line_first_token)
        if (!isNaN(next_token_as_number)) {
          symbol_lines = i
          break
        }
      }

      // Collect all element symbols from the symbol lines
      for (let i = 0; i < symbol_lines; i++) {
        if (line_index + i < lines.length) {
          element_symbols.push(...lines[line_index + i].trim().split(/\s+/))
        }
      }

      // Parse atom counts (may span multiple lines)
      for (let i = 0; i < symbol_lines; i++) {
        if (line_index + symbol_lines + i < lines.length) {
          const counts = lines[line_index + symbol_lines + i]
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
        validate_element_symbol(`Element${i}`, i),
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
      const is_cartesian =
        coordinate_mode.startsWith(`C`) || coordinate_mode.startsWith(`K`)

      if (!is_direct && !is_cartesian) {
        console.error(`Unknown coordinate mode in POSCAR: ${coordinate_mode}`)
        return null
      }

      // Parse atomic positions
      const sites: Site[] = []
      let atom_index = 0

      for (let i = 0; i < element_symbols.length; i++) {
        const element = validate_element_symbol(element_symbols[i], i)
        const count = atom_counts[i]

        for (let j = 0; j < count; j++) {
          const coord_line_idx = line_index + 1 + atom_index + j
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

          let xyz: Vector
          let abc: Vector

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
              const lattice_transposed = transpose_matrix(scaled_lattice)
              const lattice_inv = matrix_inverse_3x3(lattice_transposed)
              abc = matrix_vector_multiply(lattice_inv, xyz)
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
            label: `${element}${atom_index + j + 1}`,
            properties: selective_dynamics
              ? { selective_dynamics: selective_dynamics }
              : {},
          }

          sites.push(site)
        }

        atom_index += count
      }

      const lattice_params = calculate_lattice_parameters(scaled_lattice)

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

    // Split into frames using regex pattern similar to pymatgen
    const frame_pattern =
      /^\s*\d+\s*\n[^\n]*\n((?:\s*\w+\s+[0-9\-\+\.*^eEdD]+\s+[0-9\-\+\.*^eEdD]+\s+[0-9\-\+\.*^eEdD]+.*\n?)+)/gm
    const frames = []
    let match

    while ((match = frame_pattern.exec(normalized_content)) !== null) {
      frames.push(match[0])
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
        const lattice_vectors: [Vector, Vector, Vector] = [
          [lattice_values[0], lattice_values[1], lattice_values[2]],
          [lattice_values[3], lattice_values[4], lattice_values[5]],
          [lattice_values[6], lattice_values[7], lattice_values[8]],
        ]

        const lattice_params = calculate_lattice_parameters(lattice_vectors)
        lattice = {
          matrix: lattice_vectors,
          ...lattice_params,
        }
      }
    }

    // Parse atomic coordinates (starting from line 3)
    const sites: Site[] = []

    for (let i = 0; i < num_atoms; i++) {
      const line_idx = i + 2
      if (line_idx >= lines.length) {
        console.error(`Not enough coordinate lines in XYZ file`)
        return null
      }

      const parts = lines[line_idx].trim().split(/\s+/)
      if (parts.length < 4) {
        console.error(`Invalid coordinate line in XYZ file`)
        return null
      }

      const element = validate_element_symbol(parts[0], i)
      const coords = [
        parse_coordinate(parts[1]),
        parse_coordinate(parts[2]),
        parse_coordinate(parts[3]),
      ]

      // For XYZ files, coordinates are typically in Cartesian
      const xyz: Vector = [coords[0], coords[1], coords[2]]

      // Calculate fractional coordinates if lattice is available
      let abc: Vector = [0, 0, 0]
      if (lattice) {
        // Calculate fractional coordinates using proper matrix inversion
        // Note: Our lattice matrix is stored as row vectors, but for coordinate conversion
        // we need column vectors, so we transpose before inversion
        try {
          const lattice_transposed = transpose_matrix(lattice.matrix)
          const lattice_inv = matrix_inverse_3x3(lattice_transposed)
          abc = matrix_vector_multiply(lattice_inv, xyz)
        } catch {
          // Fallback to simplified method if matrix is singular
          abc = [xyz[0] / lattice.a, xyz[1] / lattice.b, xyz[2] / lattice.c]
        }
      }

      const site: Site = {
        species: [{ element, occu: 1, oxidation_state: 0 }],
        abc,
        xyz,
        label: `${element}${i + 1}`,
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
          const is_element_symbol =
            isNaN(parseInt(first_token)) && first_token.length <= 3
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

  console.error(`Unable to determine file format`)
  return null
}
