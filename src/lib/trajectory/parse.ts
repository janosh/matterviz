// Parsing functions for trajectory data from various formats
import type { AnyStructure, ElementSymbol, Vec3 } from '$lib'
import { escape_html, is_binary } from '$lib'
import { parse_xyz } from '$lib/io/parse'
import type { Matrix3x3 } from '$lib/math'
import * as math from '$lib/math'
import * as h5wasm from 'h5wasm'
import type { Trajectory, TrajectoryFrame } from './index'

// Cache for matrix inversions to avoid repeated calculations
const matrix_inversion_cache = new WeakMap<
  Matrix3x3,
  Matrix3x3
>()

// Cached matrix inversion for coordinate transformations
function get_inverse_matrix(matrix: Matrix3x3): Matrix3x3 {
  // Check cache first
  const cached = matrix_inversion_cache.get(matrix)
  if (cached) return cached

  // Use the shared matrix_inverse_3x3 function
  const inverse = math.matrix_inverse_3x3(matrix)

  // Cache the result
  matrix_inversion_cache.set(matrix, inverse)
  return inverse
}

// Helper to convert ArrayBuffer to base64 data URL
export function array_buffer_to_data_url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const base64 = btoa(String.fromCharCode(...bytes))
  return `data:application/octet-stream;base64,${base64}`
}

// Helper to convert base64 data URL back to ArrayBuffer
export function data_url_to_array_buffer(data_url: string): ArrayBuffer {
  const base64 = data_url.replace(`data:application/octet-stream;base64,`, ``)
  const binary_string = atob(base64)
  const bytes = new Uint8Array(binary_string.length)
  for (let i = 0; i < binary_string.length; i++) {
    bytes[i] = binary_string.charCodeAt(i)
  }
  return bytes.buffer
}

// Utility function to load trajectory from URL with automatic format detection
export async function load_trajectory_from_url(
  url: string,
): Promise<Trajectory> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch trajectory file: ${response.status}`)
  }

  // Check response headers to determine if decompression is needed
  const content_encoding = response.headers.get(`content-encoding`)
  const content_type = response.headers.get(`content-type`)

  let filename = url.split(`/`).pop() || `trajectory`

  // Check if this is an HDF5 file first (regardless of content-encoding)
  if ([`h5`, `hdf5`].includes(filename.toLowerCase().split(`.`).pop() || ``)) {
    // Handle HDF5 files as binary: always use arrayBuffer()
    const buffer = await response.arrayBuffer()
    return await parse_trajectory_data(buffer, filename)
  }

  // For non-HDF5 files, handle based on content encoding
  // If server sends gzip content-encoding, the browser auto-decompresses
  // If content-type is application/json, it's likely already decompressed
  if (content_encoding === `gzip` || content_type?.includes(`json`)) {
    // Server already decompressed the content, use it directly
    const content = await response.text()
    // Remove .gz extension from filename if it exists
    filename = filename.replace(/\.gz$/, ``)
    return await parse_trajectory_data(content, filename)
  } else {
    // Manual decompression needed (for cases where server sends raw gzip)
    const { decompress_file } = await import(`$lib/io/decompress`)
    const blob = await response.blob()
    const file = new File([blob], filename, {
      type: response.headers.get(`content-type`) || `application/octet-stream`,
    })
    const result = await decompress_file(file)
    return await parse_trajectory_data(result.content, result.filename)
  }
}

// Atomic number to element symbol mapping
const ATOMIC_NUMBER_TO_SYMBOL: Record<number, ElementSymbol> = {
  1: `H`,
  2: `He`,
  3: `Li`,
  4: `Be`,
  5: `B`,
  6: `C`,
  7: `N`,
  8: `O`,
  9: `F`,
  10: `Ne`,
  11: `Na`,
  12: `Mg`,
  13: `Al`,
  14: `Si`,
  15: `P`,
  16: `S`,
  17: `Cl`,
  18: `Ar`,
  19: `K`,
  20: `Ca`,
  21: `Sc`,
  22: `Ti`,
  23: `V`,
  24: `Cr`,
  25: `Mn`,
  26: `Fe`,
  27: `Co`,
  28: `Ni`,
  29: `Cu`,
  30: `Zn`,
  31: `Ga`,
  32: `Ge`,
  33: `As`,
  34: `Se`,
  35: `Br`,
  36: `Kr`,
  37: `Rb`,
  38: `Sr`,
  39: `Y`,
  40: `Zr`,
  41: `Nb`,
  42: `Mo`,
  43: `Tc`,
  44: `Ru`,
  45: `Rh`,
  46: `Pd`,
  47: `Ag`,
  48: `Cd`,
  49: `In`,
  50: `Sn`,
  51: `Sb`,
  52: `Te`,
  53: `I`,
  54: `Xe`,
  55: `Cs`,
  56: `Ba`,
  57: `La`,
  58: `Ce`,
  59: `Pr`,
  60: `Nd`,
  61: `Pm`,
  62: `Sm`,
  63: `Eu`,
  64: `Gd`,
  65: `Tb`,
  66: `Dy`,
  67: `Ho`,
  68: `Er`,
  69: `Tm`,
  70: `Yb`,
  71: `Lu`,
  72: `Hf`,
  73: `Ta`,
  74: `W`,
  75: `Re`,
  76: `Os`,
  77: `Ir`,
  78: `Pt`,
  79: `Au`,
  80: `Hg`,
  81: `Tl`,
  82: `Pb`,
  83: `Bi`,
  84: `Po`,
  85: `At`,
  86: `Rn`,
  87: `Fr`,
  88: `Ra`,
  89: `Ac`,
  90: `Th`,
  91: `Pa`,
  92: `U`,
  93: `Np`,
  94: `Pu`,
  95: `Am`,
  96: `Cm`,
  97: `Bk`,
  98: `Cf`,
  99: `Es`,
  100: `Fm`,
  101: `Md`,
  102: `No`,
  103: `Lr`,
  104: `Rf`,
  105: `Db`,
  106: `Sg`,
  107: `Bh`,
  108: `Hs`,
  109: `Mt`,
  110: `Ds`,
  111: `Rg`,
  112: `Cn`,
  113: `Nh`,
  114: `Fl`,
  115: `Mc`,
  116: `Lv`,
  117: `Ts`,
  118: `Og`,
}

// Parse torch-sim HDF5 trajectory file
export async function parse_torch_sim_hdf5(
  buffer: ArrayBuffer,
  filename?: string,
): Promise<Trajectory> {
  try {
    // Initialize h5wasm
    await h5wasm.ready
    const { FS } = await h5wasm.ready

    // Write buffer to virtual filesystem
    const temp_filename = filename || `temp.h5`
    FS.writeFile(temp_filename, new Uint8Array(buffer))

    // Open the file
    const f = new h5wasm.File(temp_filename, `r`)

    try {
      // Define types for h5wasm objects since they don't have proper TypeScript definitions
      type H5Group = {
        keys(): string[]
        get(name: string): H5Dataset | H5Group | null
        attrs?: Record<string, { toString(): string }>
      }

      type H5Dataset = {
        to_array(): unknown
      }

      // Validate torch-sim format by checking for required groups
      const data_group = f.get(`data`) as H5Group | null
      if (!data_group) {
        throw new Error(`Invalid torch-sim HDF5 format: missing data group`)
      }

      const data_group_keys = data_group.keys()
      if (
        !data_group_keys.includes(`atomic_numbers`) ||
        !data_group_keys.includes(`positions`)
      ) {
        throw new Error(
          `Invalid torch-sim HDF5 format: missing required datasets`,
        )
      }

      // Read atomic numbers and convert to element symbols
      const atomic_numbers_dataset = data_group.get(
        `atomic_numbers`,
      ) as H5Dataset | null
      if (!atomic_numbers_dataset) {
        throw new Error(`Missing atomic_numbers dataset`)
      }
      const atomic_numbers_data = atomic_numbers_dataset.to_array() as number[][]
      const atom_numbers = atomic_numbers_data[0] // First (and only) row

      const elements = atom_numbers.map((num: number) => {
        return ATOMIC_NUMBER_TO_SYMBOL[num] || (`X` as ElementSymbol)
      })

      // Read positions data
      const positions_dataset = data_group.get(`positions`) as H5Dataset | null
      if (!positions_dataset) {
        throw new Error(`Missing positions dataset`)
      }
      const positions = positions_dataset.to_array() as number[][][]

      // Read cell data if available
      let cells: number[][][] | undefined
      try {
        const cell_dataset = data_group.get(`cell`) as H5Dataset | null
        if (cell_dataset) {
          cells = cell_dataset.to_array() as number[][][]
        }
      } catch {
        // Cell data might not be available
      }

      // Read energies if available
      let potential_energies: number[] | undefined
      let kinetic_energies: number[] | undefined

      try {
        const pe_dataset = data_group.get(
          `potential_energy`,
        ) as H5Dataset | null
        if (pe_dataset) {
          const pe_array = pe_dataset.to_array() as number[][]
          potential_energies = pe_array.map((row) => row[0])
        }
      } catch {
        // Potential energy might not be available
      }

      try {
        const ke_dataset = data_group.get(`kinetic_energy`) as H5Dataset | null
        if (ke_dataset) {
          const ke_array = ke_dataset.to_array() as number[][]
          kinetic_energies = ke_array.map((row) => row[0])
        }
      } catch {
        // Kinetic energy might not be available
      }

      // Get periodic boundary conditions if available
      let pbc: boolean[] = [true, true, true] // Default
      try {
        const pbc_dataset = data_group.get(`pbc`) as H5Dataset | null
        if (pbc_dataset) {
          const pbc_array = pbc_dataset.to_array() as number[]
          pbc = pbc_array.slice(0, 3).map((val) => val !== 0)
        }
      } catch {
        // PBC might not be available
      }

      const frames: TrajectoryFrame[] = positions.map(
        (frame_positions, frame_idx) => {
          // Get the lattice matrix for this frame
          const lattice_matrix = (cells?.[frame_idx]
            ? (cells[frame_idx].map((row) =>
              row.slice()
            ))
            : [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) as Matrix3x3

          const lattice_params = math.calc_lattice_params(lattice_matrix)
          const lattice = { matrix: lattice_matrix, ...lattice_params, pbc }

          // Cache inverse matrix for coordinate transformations
          const inv_matrix = get_inverse_matrix(lattice_matrix)

          // Create sites array in the expected format
          const sites = frame_positions.map((xyz_pos, atom_idx) => {
            // Convert Cartesian coordinates to fractional coordinates efficiently
            const abc = math.mat3x3_vec3_multiply(inv_matrix, xyz_pos as Vec3)

            return {
              species: [{ element: elements[atom_idx], occu: 1, oxidation_state: 0 }],
              abc,
              xyz: xyz_pos.slice() as Vec3,
              label: `${elements[atom_idx]}${atom_idx + 1}`,
              properties: {},
            }
          })

          const structure: AnyStructure = { sites, lattice }

          const metadata: Record<string, unknown> = {
            volume: lattice.volume,
            ...(potential_energies &&
              frame_idx < potential_energies.length && {
              energy: potential_energies[frame_idx],
            }),
            ...(kinetic_energies &&
              frame_idx < kinetic_energies.length && {
              kinetic_energy: kinetic_energies[frame_idx],
            }),
          }

          return { structure, step: frame_idx, metadata }
        },
      )

      // Get metadata if available
      let title = `TorchSim Trajectory`
      let program = `Unknown`
      try {
        const header_group = f.get(`header`) as H5Group | null
        title = header_group?.attrs?.title?.toString() ?? title
        program = header_group?.attrs?.program?.toString() ?? program
      } catch {
        // Header might not be available
      }

      // Count unique elements
      const element_counts: Record<string, number> = {}
      elements.forEach((element) => {
        element_counts[element] = (element_counts[element] || 0) + 1
      })

      return {
        frames,
        metadata: {
          title,
          program,
          num_atoms: elements.length,
          num_frames: frames.length,
          periodic_boundary_conditions: pbc,
          ...(potential_energies && { has_energy: true }),
          ...(kinetic_energies && { has_kinetic_energy: true }),
          element_counts,
        },
      }
    } finally {
      f.close()
      // Clean up temporary file
      try {
        FS.unlink(temp_filename)
      } catch {
        // Ignore cleanup errors
      }
    }
  } catch (error) {
    throw new Error(`Failed to parse torch-sim HDF5 file: ${error}`)
  }
}

// Check if a file is a torch-sim HDF5 trajectory
export function is_torch_sim_hdf5(
  content: unknown,
  filename?: string,
): boolean {
  // Check filename extension first
  const has_hdf5_extension = filename &&
    (filename.toLowerCase().endsWith(`.h5`) ||
      filename.toLowerCase().endsWith(`.hdf5`))

  if (filename && !has_hdf5_extension) {
    return false
  }

  // If we only have filename (no content), return based on extension
  if (
    !content ||
    (content instanceof ArrayBuffer && content.byteLength === 0)
  ) {
    return Boolean(has_hdf5_extension)
  }

  // Check if content is binary (HDF5 files are binary)
  if (typeof content === `string`) {
    return false // HDF5 files should not be parsed as text
  }

  // Check for HDF5 signature at the beginning of the file
  if (content instanceof ArrayBuffer && content.byteLength >= 8) {
    const view = new Uint8Array(content.slice(0, 8))
    // HDF5 signature: \211HDF\r\n\032\n
    const hdf5_signature = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]
    return hdf5_signature.every((byte, idx) => view[idx] === byte)
  }

  return false
}

// Parse VASP XDATCAR format
export function parse_vasp_xdatcar(content: string): Trajectory {
  const lines = content.trim().split(/\r?\n/)
  let line_idx = 0

  if (lines.length < 10) {
    throw new Error(`XDATCAR file too short`)
  }

  // Parse header
  const title = lines[line_idx++].trim()
  const scale_factor = parseFloat(lines[line_idx++])

  if (isNaN(scale_factor)) {
    throw new Error(`Invalid scale factor in XDATCAR`)
  }

  // Parse lattice vectors (3 lines)
  const lattice_vectors: Matrix3x3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (let i = 0; i < 3; i++) {
    const coords = lines[line_idx++].trim().split(/\s+/).map(Number)
    if (coords.length !== 3 || coords.some(isNaN)) {
      throw new Error(`Invalid lattice vector at line ${line_idx}`)
    }
    lattice_vectors[i] = coords.map((x) => x * scale_factor) as Vec3
  }

  const lattice_params = math.calc_lattice_params(lattice_vectors)
  const lattice = { matrix: lattice_vectors, ...lattice_params, pbc: [true, true, true] }

  // Parse element names and counts
  const element_line = lines[line_idx++].trim().split(/\s+/)
  const count_line = lines[line_idx++].trim().split(/\s+/).map(Number)

  if (element_line.length !== count_line.length || count_line.some(isNaN)) {
    throw new Error(`Element names and counts don't match`)
  }

  // Create element array for sites
  const elements: ElementSymbol[] = []
  for (let i = 0; i < element_line.length; i++) {
    for (let j = 0; j < count_line[i]; j++) {
      elements.push(element_line[i] as ElementSymbol)
    }
  }

  const total_atoms = count_line.reduce((sum, count) => sum + count, 0)
  const frames: TrajectoryFrame[] = []

  // Parse configurations
  while (line_idx < lines.length) {
    // Look for configuration header
    const config_line = lines[line_idx++]
    if (!config_line || !config_line.includes(`Direct configuration=`)) {
      continue
    }

    const config_match = config_line.match(/configuration=\s*(\d+)/)
    const step = config_match ? parseInt(config_match[1]) : frames.length + 1

    // Parse atomic positions
    const sites = []
    for (let atom_idx = 0; atom_idx < total_atoms; atom_idx++) {
      if (line_idx >= lines.length) break

      const pos_line = lines[line_idx++].trim()
      const parts = pos_line.split(/\s+/)

      // Handle different XDATCAR formats:
      // 1. Just coordinates: x y z
      // 2. Coordinates with element: x y z Element
      let coords: number[]
      let element: ElementSymbol

      if (parts.length >= 4 && isNaN(Number(parts[3]))) {
        // Format: x y z Element
        coords = parts.slice(0, 3).map(Number)
        element = parts[3] as ElementSymbol
      } else {
        // Format: x y z (use element from header)
        coords = parts.slice(0, 3).map(Number)
        element = elements[atom_idx]
      }

      if (coords.length < 3 || coords.some(isNaN)) {
        console.warn(`Invalid coordinate line: ${pos_line}`)
        continue
      }

      const abc: Vec3 = [coords[0], coords[1], coords[2]]

      // Convert fractional to Cartesian coordinates efficiently
      const xyz = math.mat3x3_vec3_multiply(math.transpose_matrix(lattice_vectors), abc)

      sites.push({
        species: [{ element, occu: 1, oxidation_state: 0 }],
        abc,
        xyz,
        label: `${element}${atom_idx + 1}`,
        properties: {},
      })
    }

    if (sites.length === total_atoms) {
      frames.push({
        structure: { sites, lattice },
        step,
        metadata: { volume: lattice.volume },
      })
    }
  }

  if (frames.length === 0) {
    throw new Error(`No valid configurations found in XDATCAR`)
  }

  return {
    frames,
    metadata: {
      title,
      source_format: `vasp_xdatcar`,
      frame_count: frames.length,
      total_atoms,
      elements: element_line,
      element_counts: count_line,
    },
  }
}

// Detect if content is VASP XDATCAR format
export function is_vasp_xdatcar(content: string, filename?: string): boolean {
  // Check filename patterns (XDATCAR files typically named "XDATCAR" or variants)
  if (filename) {
    const basename = filename.toLowerCase().split(`/`).pop() || ``
    if (basename === `xdatcar` || basename.startsWith(`xdatcar`)) {
      return true
    }
  }

  // Check content patterns - XDATCAR files have a specific structure:
  // 1. Title line
  // 2. Scale factor (single number)
  // 3. Three lattice vectors (3 numbers each)
  // 4. Element names
  // 5. Element counts
  // 6. Configurations starting with "Direct configuration="
  const lines = content.trim().split(/\r?\n/)
  if (lines.length < 10) return false

  // Look for "Direct configuration=" pattern which is unique to XDATCAR
  const has_config_pattern = lines.some((line) => line.includes(`Direct configuration=`))

  // Check if second line is a number (scale factor)
  const second_line_is_number = !isNaN(parseFloat(lines[1]))

  // Check if we have lattice vectors (lines 2-4 should be 3 numbers each)
  let has_lattice_vectors = true
  for (let i = 2; i < 5 && i < lines.length; i++) {
    const coords = lines[i].trim().split(/\s+/)
    if (
      coords.length !== 3 ||
      coords.some((coord) => isNaN(parseFloat(coord)))
    ) {
      has_lattice_vectors = false
      break
    }
  }

  return has_config_pattern && second_line_is_number && has_lattice_vectors
}

// Parse multi-frame XYZ format for trajectories
export function parse_xyz_trajectory(content: string): Trajectory {
  const lines = content.trim().split(/\r?\n/)
  let line_idx = 0
  const frames: TrajectoryFrame[] = []

  while (line_idx < lines.length) {
    // Skip empty lines
    if (!lines[line_idx] || lines[line_idx].trim() === ``) {
      line_idx++
      continue
    }

    // Parse number of atoms (line 1 of each frame)
    const num_atoms_line = lines[line_idx]?.trim()
    if (!num_atoms_line) break

    const num_atoms = parseInt(num_atoms_line, 10)
    if (isNaN(num_atoms) || num_atoms <= 0) {
      line_idx++
      continue
    }

    // Check if we have enough lines for this frame
    if (line_idx + num_atoms + 1 >= lines.length) break

    // Parse comment line (line 2 of each frame) - may contain metadata
    line_idx++
    const comment_line = lines[line_idx] || ``
    const frame_metadata: Record<string, unknown> = {}

    // Try to extract step number from comment
    const step_match = comment_line.match(/step\s*[=:]?\s*(\d+)/i)
    const frame_match = comment_line.match(/frame\s*[=:]?\s*(\d+)/i)
    const ionic_step_match = comment_line.match(/ionic_step\s*[=:]?\s*(\d+)/i)

    const step = step_match
      ? parseInt(step_match[1])
      : frame_match
      ? parseInt(frame_match[1])
      : ionic_step_match
      ? parseInt(ionic_step_match[1])
      : frames.length

    // Extract various properties from extended XYZ comment line
    // Map canonical property names to possible alternative names
    const property_aliases: Record<string, string[]> = {
      energy: [`energy`, `E`, `total_energy`, `etot`, `total_e`],
      energy_per_atom: [`energy_per_atom`, `e_per_atom`, `energy/atom`, `epa`],
      volume: [`volume`, `vol`, `V`, `cell_volume`],
      pressure: [`pressure`, `P`, `press`],
      temperature: [`temperature`, `temp`, `T`, `kelvin`],
      bandgap: [`bandgap`, `E_gap`, `gap`, `band_gap`, `egap`, `bg`],
      force_max: [`max_force`, `force_max`, `fmax`, `maximum_force`],
      stress_max: [`max_stress`, `stress_max`, `maximum_stress`],
      stress_frobenius: [`stress_frobenius`, `frobenius_stress`, `stress_frob`],
    }

    // First, try to extract properties from within the Properties= string (extended XYZ format)
    const properties_match = comment_line.match(/Properties\s*=\s*"?([^"]*)"?/i)
    if (properties_match) {
      const properties_string = properties_match[1]

      // Split the Properties string by spaces and look for property=value pairs
      const property_parts = properties_string.split(/\s+/)
      for (const part of property_parts) {
        if (part.includes(`=`)) {
          const [key, value] = part.split(`=`, 2)
          const parsed_value = parseFloat(value)
          if (!isNaN(parsed_value)) {
            // Check if this key matches any of our canonical properties
            for (const [canonical_name, aliases] of Object.entries(property_aliases)) {
              if (aliases.some((alias) => key.toLowerCase() === alias.toLowerCase())) {
                frame_metadata[canonical_name] = parsed_value
                break
              }
            }
          }
        }
      }
    }

    // Then, extract other properties that might be outside the Properties string
    for (const [canonical_name, aliases] of Object.entries(property_aliases)) {
      // Skip if we already found this property in the Properties string
      if (canonical_name in frame_metadata) continue

      let found_value: number | undefined

      // Try each alias until we find a match
      for (const alias of aliases) {
        const regex = new RegExp(
          `${alias}\\s*[=:]?\\s*([-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?)`,
          `i`,
        )
        const match = comment_line.match(regex)
        if (match) {
          found_value = parseFloat(match[1])
          break // Stop at first match to avoid conflicts
        }
      }

      if (found_value !== undefined && !isNaN(found_value)) {
        frame_metadata[canonical_name] = found_value
      }
    }

    // Parse stress tensor if present (for extended XYZ format)
    const stress_match = comment_line.match(/stress\s*=\s*"([^"]+)"/i)
    if (stress_match) {
      const stress_values = stress_match[1].split(/\s+/).map(Number)
      if (stress_values.length === 9) {
        // Convert flat array to 3x3 stress tensor using helper function
        const stress_tensor = math.vec9_to_mat3x3(stress_values)

        // Store the full stress tensor
        frame_metadata.stress = stress_tensor
        // Convert to Voigt notation for stress_max calculation
        const [s11, s22, s33, s23, s13, s12] = math.to_voigt(stress_tensor)

        // Calculate von Mises stress (stress_max equivalent)
        frame_metadata.stress_max = Math.sqrt(
          0.5 * ((s11 - s22) ** 2 + (s22 - s33) ** 2 + (s33 - s11) ** 2) +
            3 * (s12 ** 2 + s13 ** 2 + s23 ** 2),
        )

        // Calculate Frobenius norm of stress tensor
        frame_metadata.stress_frobenius = Math.sqrt(
          stress_values.reduce((sum, val) => sum + val ** 2, 0),
        )

        // Calculate pressure (negative trace/3)
        frame_metadata.pressure = -(s11 + s22 + s33) / 3
      }
    }

    // Parse lattice matrix if present (for extended XYZ format)
    const lattice_match = comment_line.match(/Lattice\s*=\s*"([^"]+)"/i)
    let lattice = null
    if (lattice_match) {
      const lattice_values = lattice_match[1].split(/\s+/).map(Number)
      if (lattice_values.length === 9) {
        // Convert flat array to 3x3 matrix
        const lattice_matrix: Matrix3x3 = [
          [lattice_values[0], lattice_values[1], lattice_values[2]],
          [lattice_values[3], lattice_values[4], lattice_values[5]],
          [lattice_values[6], lattice_values[7], lattice_values[8]],
        ]

        const lattice_params = math.calc_lattice_params(lattice_matrix)
        lattice = { matrix: lattice_matrix, ...lattice_params, pbc: [true, true, true] }

        // Add calculated volume to metadata if not already present
        if (!frame_metadata.volume) frame_metadata.volume = lattice.volume
      }
    }

    // Parse atomic coordinates (lines 3 to N+2)
    const sites = []
    line_idx++

    // Pre-compute inverse matrix once per frame for efficiency
    const inv_matrix = lattice && get_inverse_matrix(lattice.matrix)

    for (let atom_idx = 0; atom_idx < num_atoms; atom_idx++) {
      if (line_idx >= lines.length) {
        throw new Error(`Incomplete XYZ frame: missing atomic coordinates`)
      }

      const coord_line = lines[line_idx].trim()
      if (!coord_line) {
        throw new Error(`Empty coordinate line in XYZ frame`)
      }

      const parts = coord_line.split(/\s+/)
      if (parts.length < 4) {
        throw new Error(`Invalid coordinate line in XYZ frame: ${coord_line}`)
      }

      const element = parts[0] as ElementSymbol
      const x = parseFloat(parts[1])
      const y = parseFloat(parts[2])
      const z = parseFloat(parts[3])

      if (isNaN(x) || isNaN(y) || isNaN(z)) {
        throw new Error(`Invalid coordinates in XYZ frame: ${coord_line}`)
      }

      // XYZ coordinates are typically in Angstroms (Cartesian)
      const xyz: Vec3 = [x, y, z]

      // Calculate fractional coordinates if lattice info is available
      const abc: Vec3 = inv_matrix
        ? math.mat3x3_vec3_multiply(inv_matrix, xyz)
        : [0, 0, 0]

      sites.push({
        species: [{ element, occu: 1, oxidation_state: 0 }],
        abc,
        xyz,
        label: `${element}${atom_idx + 1}`,
        properties: {},
      })

      line_idx++
    }

    // Create structure for this frame
    // Include lattice information if parsed from extended XYZ format
    const structure: AnyStructure = { sites, ...(lattice && { lattice }) }

    frames.push({ structure, step, metadata: frame_metadata })
  }

  if (frames.length === 0) {
    throw new Error(`No valid frames found in XYZ trajectory`)
  }

  return {
    frames,
    metadata: {
      source_format: `xyz_trajectory`,
      frame_count: frames.length,
      total_atoms: frames[0]?.structure.sites.length || 0,
      has_lattice_info: frames.some((f) => `lattice` in f.structure),
    },
  }
}

// Detect if content is multi-frame XYZ trajectory format
export function is_xyz_trajectory(content: string, filename?: string): boolean {
  // Check filename patterns
  if (filename) {
    const basename = filename.toLowerCase().split(`/`).pop() || ``
    if (basename.endsWith(`.xyz`) || basename.endsWith(`.extxyz`)) {
      // Check if it's a multi-frame XYZ by simulating the parsing process
      const lines = content.trim().split(/\r?\n/)
      let line_idx = 0
      let frame_count = 0

      while (line_idx < lines.length && frame_count < 10) {
        // Skip empty lines
        if (!lines[line_idx] || lines[line_idx].trim() === ``) {
          line_idx++
          continue
        }

        // Try to parse atom count
        const num_atoms_line = lines[line_idx]?.trim()
        const num_atoms = parseInt(num_atoms_line, 10)

        if (isNaN(num_atoms) || num_atoms <= 0) {
          line_idx++
          continue
        }

        // Check if we have enough lines for this frame
        if (line_idx + num_atoms + 1 >= lines.length) break

        // Skip comment line
        line_idx++

        // Check if the coordinate lines look valid
        let valid_coordinates = 0
        for (let atom_idx = 0; atom_idx < Math.min(num_atoms, 5); atom_idx++) {
          line_idx++
          if (line_idx >= lines.length) break

          const coord_line = lines[line_idx]?.trim()
          if (coord_line) {
            const parts = coord_line.split(/\s+/)
            if (parts.length >= 4) {
              const first_token = parts[0]
              const coords = parts.slice(1, 4)
              const is_element = isNaN(parseInt(first_token)) && first_token.length <= 3
              const are_coords = coords.every((coord) => !isNaN(parseFloat(coord)))
              if (is_element && are_coords) {
                valid_coordinates++
              }
            }
          }
        }

        // If we found valid coordinates, count this as a frame
        if (valid_coordinates >= Math.min(num_atoms, 3)) {
          frame_count++

          // Skip remaining atoms in this frame
          line_idx += num_atoms - Math.min(num_atoms, 5)
        } else line_idx++
      }

      // Return true if we found at least 2 valid frames
      return frame_count >= 2
    }
  }

  return false
}

// Parse pymatgen Trajectory format
export function parse_pymatgen_trajectory(
  obj_data: Record<string, unknown>,
  filename?: string,
): Trajectory {
  const species = obj_data.species as Array<{ element: ElementSymbol }>
  const coords = obj_data.coords as number[][][] // [frame][atom][xyz]
  const matrix = obj_data.lattice as Matrix3x3 // lattice vectors
  const frame_properties = obj_data.frame_properties as Array<
    Record<string, unknown>
  >

  const lattice_params = math.calc_lattice_params(matrix)

  const frames: TrajectoryFrame[] = coords.map((frame_coords, frame_idx) => {
    // Convert coordinates and species to sites
    const sites = frame_coords.map((xyz, site_idx) => {
      const abc = [xyz[0], xyz[1], xyz[2]] as Vec3 // pymatgen uses fractional coordinates
      const cartesian = math.mat3x3_vec3_multiply(math.transpose_matrix(matrix), abc)

      return {
        species: [{ element: species[site_idx].element, occu: 1, oxidation_state: 0 }],
        abc,
        xyz: cartesian,
        label: species[site_idx].element,
        properties: {},
      }
    })

    // Extract frame metadata
    const frame_props = frame_properties[frame_idx] || {}
    const metadata: Record<string, unknown> = { ...frame_props }

    // Process forces if available
    if (frame_props.forces && typeof frame_props.forces === `object`) {
      const forces_obj = frame_props.forces as { data?: number[][] }
      if (forces_obj.data && Array.isArray(forces_obj.data)) {
        metadata.forces = forces_obj.data

        // Calculate max force
        const forces = forces_obj.data as number[][]
        if (forces.length > 0) {
          const force_magnitudes = forces.map((force: number[]) =>
            Math.sqrt(force[0] ** 2 + force[1] ** 2 + force[2] ** 2)
          )
          metadata.force_max = Math.max(...force_magnitudes)
          metadata.force_rms = Math.sqrt(
            force_magnitudes.reduce((sum, f) => sum + f ** 2, 0) /
              force_magnitudes.length,
          )
        }
      }
    }

    // Process stress if available
    if (frame_props.stress && typeof frame_props.stress === `object`) {
      const stress_obj = frame_props.stress as { data?: number[][] }
      if (stress_obj.data && Array.isArray(stress_obj.data)) {
        metadata.stress = stress_obj.data

        // Calculate max stress (von Mises equivalent)
        const stress = stress_obj.data as number[][]
        if (stress.length === 3 && stress[0].length === 3) {
          const s11 = stress[0][0],
            s22 = stress[1][1],
            s33 = stress[2][2]
          const s12 = stress[0][1],
            s13 = stress[0][2],
            s23 = stress[1][2]

          metadata.stress_max = Math.sqrt(
            0.5 * ((s11 - s22) ** 2 + (s22 - s33) ** 2 + (s33 - s11) ** 2) +
              3 * (s12 ** 2 + s13 ** 2 + s23 ** 2),
          )

          // Calculate pressure (negative trace/3)
          metadata.pressure = -(s11 + s22 + s33) / 3
        }
      }
    }

    return {
      structure: {
        sites,
        charge: (obj_data.charge as number) || 0,
        lattice: { matrix, ...lattice_params, pbc: [true, true, true] },
      },
      step: frame_idx,
      metadata,
    }
  })

  return {
    frames,
    metadata: {
      filename: filename || obj_data.filename,
      source_format: `pymatgen_trajectory`,
      species_list: species.map((s) => s.element),
      constant_lattice: obj_data.constant_lattice as boolean,
      frame_count: frames.length,
    },
  }
}

// Parse trajectory from various common formats
export async function parse_trajectory_data(
  data: unknown,
  filename?: string,
): Promise<Trajectory> {
  // Handle binary data (HDF5 files)
  if (data instanceof ArrayBuffer) {
    // Check if it's a torch-sim HDF5 file
    if (is_torch_sim_hdf5(data, filename)) {
      return await parse_torch_sim_hdf5(data, filename)
    }

    // If not a recognized HDF5 format, throw error
    throw new Error(`Unsupported binary file format`)
  }

  // Handle string data (raw file content)
  if (typeof data === `string`) {
    const content = data.trim()

    // Try multi-frame XYZ format first (before single XYZ)
    if (is_xyz_trajectory(content, filename)) {
      return parse_xyz_trajectory(content)
    }

    // Try VASP XDATCAR format
    if (is_vasp_xdatcar(content, filename)) {
      return parse_vasp_xdatcar(content)
    }

    // Try single-frame XYZ (convert to trajectory format)
    if (
      filename?.toLowerCase().endsWith(`.xyz`) ||
      filename?.toLowerCase().endsWith(`.extxyz`)
    ) {
      try {
        const single_structure = parse_xyz(content)
        if (single_structure) {
          return {
            frames: [{ structure: single_structure, step: 0, metadata: {} }],
            metadata: {
              filename,
              source_format: `single_xyz`,
              frame_count: 1,
            },
          }
        }
      } catch (error) {
        console.warn(`Failed to parse as single XYZ:`, error)
      }
    }

    // Try JSON parsing for other formats
    try {
      data = JSON.parse(content)
    } catch {
      throw new Error(
        `Content is not valid JSON, XYZ trajectory, single XYZ, VASP XDATCAR, or HDF5 format`,
      )
    }
  }

  if (!data || typeof data !== `object`) {
    throw new Error(`Invalid trajectory data: must be an object or array`)
  }

  // Handle array format (list of frames)
  if (Array.isArray(data)) {
    const frames: TrajectoryFrame[] = data.map((frame_data, idx) => {
      if (typeof frame_data !== `object` || frame_data === null) {
        throw new Error(`Invalid frame data at index ${idx}`)
      }

      // Try different possible structure keys
      const frame_obj = frame_data as Record<string, unknown>
      let structure: AnyStructure

      if (frame_obj.structure && typeof frame_obj.structure === `object`) {
        structure = frame_obj.structure as AnyStructure
      } else if (frame_obj.sites) {
        // Frame data is itself a structure
        structure = frame_data as AnyStructure
      } else {
        throw new Error(`No structure found in frame ${idx}`)
      }

      return {
        structure,
        step: typeof frame_obj.step === `number` ? frame_obj.step : idx,
        metadata: (frame_obj.metadata as Record<string, unknown>) || frame_obj,
      }
    })

    return {
      frames,
      metadata: {
        filename,
        source_format: `array`,
        frame_count: frames.length,
      },
    }
  }

  // Handle object format
  const obj_data = data as Record<string, unknown>

  // Check if it's a pymatgen Trajectory format
  if (
    obj_data[`@class`] === `Trajectory` &&
    obj_data.species &&
    Array.isArray(obj_data.species) &&
    obj_data.coords &&
    Array.isArray(obj_data.coords) &&
    obj_data.lattice &&
    obj_data.frame_properties &&
    Array.isArray(obj_data.frame_properties)
  ) {
    return parse_pymatgen_trajectory(obj_data, filename)
  }

  // Check if it has a frames property
  if (obj_data.frames && Array.isArray(obj_data.frames)) {
    return {
      frames: obj_data.frames as TrajectoryFrame[],
      metadata: {
        ...(obj_data.metadata as Record<string, unknown>),
        filename,
        source_format: `object_with_frames`,
      },
    }
  }

  // Check if it's a single structure
  if (obj_data.sites) {
    return {
      frames: [
        {
          structure: data as AnyStructure,
          step: 0,
          metadata: {},
        },
      ],
      metadata: {
        filename,
        source_format: `single_structure`,
        frame_count: 1,
      },
    }
  }

  throw new Error(
    `Unrecognized trajectory format: expected array of frames, object with frames property, single structure, or VASP XDATCAR format`,
  )
}

// Helper function to detect unsupported file formats and provide helpful messages
export function get_unsupported_format_message(
  filename: string,
  content: string,
): string | null {
  const lower_filename = filename.toLowerCase()

  // Check for binary ASE trajectory files
  if (lower_filename.endsWith(`.traj`)) {
    return create_format_error(`ASE Binary Trajectory`, filename, [
      {
        tool: `ASE`,
        code: `from ase.io import read, write
# Read ASE trajectory
traj = read('${filename}', index=':')
# Convert to multi-frame XYZ
write('${filename.replace(`.traj`, `.xyz`)}', traj)`,
      },
      {
        tool: `pymatgen`,
        code: `from pymatgen.io.ase import AseAtomsAdaptor
from ase.io import read
import json

# Read ASE trajectory and convert to pymatgen
traj = read('${filename}', index=':')
structures = [AseAtomsAdaptor.get_structure(atoms) for atoms in traj]

# Save as JSON for matterviz
trajectory_data = {
    "frames": [{"structure": struct.as_dict(), "step": i} for i, struct in enumerate(structures)]
}
with open('${filename.replace(`.traj`, `.json`)}', 'w') as file:
    json.dump(trajectory_data, file)`,
      },
    ])
  }

  // Check for LAMMPS trajectory files
  if (
    lower_filename.endsWith(`.dump`) ||
    lower_filename.endsWith(`.lammpstrj`)
  ) {
    return create_format_error(`LAMMPS Trajectory`, filename, [
      {
        tool: `pymatgen`,
        code: `from pymatgen.io.lammps.data import LammpsData
# Convert LAMMPS trajectory to supported format
# (specific code depends on LAMMPS trajectory format)`,
      },
    ])
  }

  // Check for NetCDF files (common in MD simulations)
  if (lower_filename.endsWith(`.nc`) || lower_filename.endsWith(`.netcdf`)) {
    return create_format_error(`NetCDF Trajectory`, filename, [
      {
        tool: `MDAnalysis`,
        code: `import MDAnalysis as mda
# Convert NetCDF to XYZ format
u = mda.Universe('topology.pdb', '${filename}')
u.atoms.write('${filename.replace(/\.(nc|netcdf)$/, `.xyz`)}', frames='all')`,
      },
    ])
  }

  // Check for DCD files (CHARMM/NAMD trajectories) # codespell:ignore
  if (lower_filename.endsWith(`.dcd`)) {
    return create_format_error(`DCD Trajectory`, filename, [
      {
        tool: `MDAnalysis`,
        code: `import MDAnalysis as mda
# You'll need a topology file (PSF, PDB, etc.)
u = mda.Universe('topology.psf', '${filename}')
u.atoms.write('${filename.replace(`.dcd`, `.xyz`)}', frames='all')`,
      },
    ])
  }

  // Check if content looks like binary data
  if (content.length > 0 && is_binary(content)) {
    return `
      <div class="unsupported-format">
        <h4>🚫 Unsupported Format: Binary File</h4>
        <p>The file <code>${
      escape_html(filename)
    }</code> appears to be a binary file and cannot be parsed as text.</p>
        <div class="code-options">
          <h5>💡 Supported Formats:</h5>
          <ul>
            <li>Multi-frame XYZ files (text-based)</li>
            <li>Pymatgen trajectory JSON</li>
            <li>VASP XDATCAR files</li>
            <li>Compressed versions (.gz) of the above</li>
          </ul>
          <p>Please convert your trajectory to one of these text-based formats.</p>
        </div>
      </div>
    `
  }

  return null
}

// Simplified format error creation
function create_format_error(
  format_name: string,
  filename: string,
  conversions: Array<{ tool: string; code: string }>,
): string {
  const conversion_html = conversions
    .map(
      ({ tool, code }) => `
        <div>
          <strong>${tool}:</strong>
          <pre class="language-python">${code}</pre>
        </div>`,
    )
    .join(``)

  return `
    <div class="unsupported-format">
      <h4>🚫 Unsupported Format: ${escape_html(format_name)}</h4>
      <p>The file <code>${escape_html(filename)}</code> appears to be a ${
    escape_html(format_name.toLowerCase())
  } file, which is not directly supported.</p>
      <h5>💡 Conversion Options:</h5>
      <div class="code-options">
        ${conversion_html}
      </div>
    </div>
  `
}
