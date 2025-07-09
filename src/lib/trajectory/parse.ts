// Parsing functions for trajectory data from various formats
import type { AnyStructure, ElementSymbol, Vec3 } from '$lib'
import { is_binary } from '$lib'
import { atomic_number_to_symbol } from '$lib/composition/parse'
import { parse_xyz } from '$lib/io/parse'
import type { Matrix3x3 } from '$lib/math'
import * as math from '$lib/math'
import * as h5wasm from 'h5wasm'
import type { Trajectory, TrajectoryFrame } from './index'

// Common interfaces
export interface ParseProgress {
  current: number
  total: number
  stage: string
}

interface ParsedFrame {
  positions: number[][]
  elements: ElementSymbol[]
  lattice_matrix?: Matrix3x3
  pbc?: [boolean, boolean, boolean]
  metadata?: Record<string, unknown>
}

// Add interface for HDF5 group to replace 'any' type
interface Hdf5Group {
  get(name: string): Hdf5Dataset | Hdf5Group | null
  keys?(): string[] // Optional method for iterating through group contents
}

interface Hdf5Dataset {
  to_array(): unknown
}

// Type guard to check if an object is an Hdf5Dataset
const is_hdf5_dataset = (obj: Hdf5Dataset | Hdf5Group | null): obj is Hdf5Dataset => {
  return obj !== null && `to_array` in obj
}

// Cache for matrix inversions
const matrix_cache = new WeakMap<Matrix3x3, Matrix3x3>()

// Common utilities
const get_inverse_matrix = (matrix: Matrix3x3): Matrix3x3 => {
  const cached = matrix_cache.get(matrix)
  if (cached) return cached
  const inverse = math.matrix_inverse_3x3(matrix)
  matrix_cache.set(matrix, inverse)
  return inverse
}

const convert_atomic_numbers = (numbers: number[]): ElementSymbol[] =>
  numbers.map((num) => atomic_number_to_symbol[num] || (`X` as ElementSymbol))

const create_site = (
  element: ElementSymbol,
  xyz: Vec3,
  abc: Vec3,
  idx: number,
  properties: Record<string, unknown> = {},
) => ({
  species: [{ element, occu: 1, oxidation_state: 0 }],
  abc,
  xyz,
  label: `${element}${idx + 1}`,
  properties,
})

const create_lattice = (
  matrix: Matrix3x3,
  pbc: [boolean, boolean, boolean] = [true, true, true],
) => ({
  matrix,
  ...math.calc_lattice_params(matrix),
  pbc,
})

const create_structure = (
  positions: number[][],
  elements: ElementSymbol[],
  lattice_matrix?: Matrix3x3,
  pbc?: [boolean, boolean, boolean],
  force_data?: number[][],
): AnyStructure => {
  const inv_matrix = lattice_matrix ? get_inverse_matrix(lattice_matrix) : null
  const sites = positions.map((pos, idx) => {
    const xyz = pos as Vec3
    const abc = inv_matrix
      ? math.mat3x3_vec3_multiply(inv_matrix, xyz)
      : [0, 0, 0] as Vec3
    const properties = force_data?.[idx] ? { force: force_data[idx] as Vec3 } : {}
    return create_site(elements[idx], xyz, abc, idx, properties)
  })

  return lattice_matrix
    ? { sites, lattice: create_lattice(lattice_matrix, pbc) }
    : { sites }
}

const create_trajectory_frame = (
  parsed_frame: ParsedFrame,
  step: number,
): TrajectoryFrame => ({
  structure: create_structure(
    parsed_frame.positions,
    parsed_frame.elements,
    parsed_frame.lattice_matrix,
    parsed_frame.pbc,
    parsed_frame.metadata?.forces as number[][],
  ),
  step,
  metadata: parsed_frame.metadata || {},
})

const calculate_force_stats = (forces: number[][]): Record<string, number> => {
  const magnitudes = forces.map((f) => Math.sqrt(f[0] ** 2 + f[1] ** 2 + f[2] ** 2))
  return {
    force_max: Math.max(...magnitudes),
    force_norm: Math.sqrt(
      magnitudes.reduce((sum, f) => sum + f ** 2, 0) / magnitudes.length,
    ),
  }
}

const calculate_stress_stats = (stress: number[][]): Record<string, number> => {
  const [s11, s22, s33] = [stress[0][0], stress[1][1], stress[2][2]]
  const [s12, s13, s23] = [stress[0][1], stress[0][2], stress[1][2]]

  return {
    stress_max: Math.sqrt(
      0.5 * ((s11 - s22) ** 2 + (s22 - s33) ** 2 + (s33 - s11) ** 2) +
        3 * (s12 ** 2 + s13 ** 2 + s23 ** 2),
    ),
    stress_frobenius: Math.sqrt(stress.flat().reduce((sum, val) => sum + val ** 2, 0)),
    pressure: -(s11 + s22 + s33) / 3,
  }
}

// Format detection
const is_torch_sim_hdf5 = (content: unknown, filename?: string): boolean => {
  // Check filename extension first
  const has_hdf5_extension = filename &&
    (filename.toLowerCase().endsWith(`.h5`) || filename.toLowerCase().endsWith(`.hdf5`))

  if (filename && !has_hdf5_extension) return false

  // If no content or empty, return based on extension
  if (!content || (content instanceof ArrayBuffer && content.byteLength === 0)) {
    return Boolean(has_hdf5_extension)
  }

  // Check if content is binary (HDF5 files are binary)
  if (typeof content === `string`) return false

  // Check for HDF5 signature
  if (content instanceof ArrayBuffer && content.byteLength >= 8) {
    const view = new Uint8Array(content.slice(0, 8))
    const hdf5_signature = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]
    return hdf5_signature.every((byte, idx) => view[idx] === byte)
  }

  return false
}

const is_ase_format = (content: unknown, filename?: string): boolean => {
  if (filename && !filename.toLowerCase().endsWith(`.traj`)) return false
  if (!(content instanceof ArrayBuffer) || content.byteLength < 24) return false
  // ASE trajectory files start with "- of Ulm" signature
  const view = new Uint8Array(content.slice(0, 24))
  const signature = [0x2d, 0x20, 0x6f, 0x66, 0x20, 0x55, 0x6c, 0x6d]
  if (!signature.every((byte, idx) => view[idx] === byte)) return false
  // ASE trajectory files also have a tag that starts with "ASE-Trajectory"
  const tag = new TextDecoder().decode(view.slice(8, 24)).replace(/\0/g, ``)
  return tag.startsWith(`ASE-Trajectory`)
}

const is_vasp_format = (content: string, filename?: string): boolean => {
  if (filename) {
    const basename = filename.toLowerCase().split(`/`).pop() || ``
    if (basename === `xdatcar` || basename.startsWith(`xdatcar`)) return true
  }
  const lines = content.trim().split(/\r?\n/)
  return lines.length >= 10 &&
    lines.some((line) => line.includes(`Direct configuration=`)) &&
    !isNaN(parseFloat(lines[1])) &&
    lines.slice(2, 5).every((line) => line.trim().split(/\s+/).length === 3)
}

const is_xyz_multi_frame = (content: string, filename?: string): boolean => {
  if (!filename?.toLowerCase().match(/\.(xyz|extxyz)$/)) return false
  const lines = content.trim().split(/\r?\n/)
  let frame_count = 0
  let line_idx = 0

  while (line_idx < lines.length && frame_count < 10) {
    if (!lines[line_idx]?.trim()) {
      line_idx++
      continue
    }

    const num_atoms = parseInt(lines[line_idx].trim(), 10)
    if (isNaN(num_atoms) || num_atoms <= 0) {
      line_idx++
      continue
    }
    if (line_idx + num_atoms + 1 >= lines.length) break

    line_idx += 2 // Skip comment line
    let valid_coords = 0

    for (let idx = 0; idx < Math.min(num_atoms, 5); idx++) {
      const parts = lines[line_idx + idx]?.trim().split(/\s+/)
      if (parts?.length >= 4 && isNaN(parseInt(parts[0])) && parts[0].length <= 3) {
        if (parts.slice(1, 4).every((coord) => !isNaN(parseFloat(coord)))) {
          valid_coords++
        }
      }
    }

    if (valid_coords >= Math.min(num_atoms, 3)) {
      frame_count++
      line_idx += num_atoms
    } else {
      line_idx++
    }
  }

  return frame_count >= 2
}

// Specialized parsers
const parse_torch_sim_hdf5 = async (
  buffer: ArrayBuffer,
  filename?: string,
): Promise<Trajectory> => {
  await h5wasm.ready
  const { FS } = await h5wasm.ready
  const temp_filename = filename || `temp.h5`

  FS.writeFile(temp_filename, new Uint8Array(buffer))
  const h5_file = new h5wasm.File(temp_filename, `r`)

  try {
    // Cache for HDF5 dataset lookups to avoid redundant I/O operations
    const cache = new Map<string, Hdf5Dataset | Hdf5Group | null>()

    const get_dataset = (
      group: { get: (name: string) => unknown } | null,
      name: string,
      group_path: string,
    ) => {
      if (!group) return null
      const key = `${group_path}/${name}`
      if (cache.has(key)) {
        const cached_result = cache.get(key)
        return cached_result || null
      }
      const result = group.get(name) as Hdf5Dataset | Hdf5Group | null
      cache.set(key, result)
      return result
    }

    // Get main groups
    const groups = {
      root: h5_file,
      data: get_dataset(h5_file, `data`, `root`) as Hdf5Group | null,
      header: get_dataset(h5_file, `header`, `root`) as Hdf5Group | null,
      metadata: get_dataset(h5_file, `metadata`, `root`) as Hdf5Group | null,
      steps: get_dataset(h5_file, `steps`, `root`) as Hdf5Group | null,
    }

    // Find positions (required)
    let positions: number[][][] | null = null
    for (const [path, group] of Object.entries(groups)) {
      if (!group) continue
      const dataset = get_dataset(group, `positions`, path)
      if (is_hdf5_dataset(dataset)) {
        const raw = dataset.to_array() as number[][] | number[][][]
        positions = Array.isArray(raw[0]?.[0]) ? raw as number[][][] : [raw as number[][]]
        break
      }
    }

    if (!positions) {
      throw new Error(
        `Missing required 'positions' dataset in HDF5 file. ` +
          `Expected 3D array of atomic coordinates.`,
      )
    }

    // Find atomic numbers (required)
    let atomic_numbers: number[][] | null = null
    const atomic_number_names = [
      `atomic_numbers`,
      `numbers`,
      `Z`,
      `species`,
      `atoms`,
      `elements`,
      `atom_types`,
      `types`,
    ]

    for (const [path, group] of Object.entries(groups)) {
      if (!group || atomic_numbers) continue
      for (const name of atomic_number_names) {
        const dataset = get_dataset(group, name, path)
        if (is_hdf5_dataset(dataset)) {
          const raw = dataset.to_array() as number[] | number[][]
          atomic_numbers = Array.isArray(raw[0]) ? raw as number[][] : [raw as number[]]
          break
        }
      }
    }

    if (!atomic_numbers) {
      throw new Error(
        `Missing required atomic numbers in HDF5 file. ` +
          `Expected dataset with atomic numbers/species information.`,
      )
    }

    // Find optional datasets
    const find_optional = (names: string[]) => {
      for (const [path, group] of Object.entries(groups)) {
        if (!group) continue
        for (const name of names) {
          const dataset = get_dataset(group, name, path)
          if (is_hdf5_dataset(dataset)) return dataset.to_array()
        }
      }
      return null
    }

    const cells = find_optional([`cell`, `cells`, `lattice`]) as number[][][] | null
    const energies = find_optional([`potential_energy`, `energy`]) as number[][] | null
    const pbc_data = find_optional([`pbc`]) as number[] | null

    // Process data
    const elements = convert_atomic_numbers(atomic_numbers[0])
    const pbc = pbc_data?.length === 3
      ? [!!pbc_data[0], !!pbc_data[1], !!pbc_data[2]] as [boolean, boolean, boolean]
      : [false, false, false] as [boolean, boolean, boolean]

    const frames = positions.map((frame_positions, idx) => {
      const lattice_matrix = cells?.[idx] as Matrix3x3 | undefined
      const metadata: Record<string, unknown> = {}

      const energy_value = energies?.[idx]?.[0]
      if (energy_value !== null && energy_value !== undefined) {
        metadata.energy = energy_value
      }
      if (lattice_matrix) {
        metadata.volume = math.calc_lattice_params(lattice_matrix).volume
      }

      return create_trajectory_frame({
        positions: frame_positions,
        elements,
        lattice_matrix,
        pbc: lattice_matrix ? pbc : [false, false, false], // Use false PBC if no lattice
        metadata,
      }, idx)
    })

    return {
      frames,
      metadata: {
        title: `HDF5 Trajectory`,
        program: `HDF5`,
        source_format: `hdf5_trajectory`,
        num_atoms: elements.length,
        num_frames: frames.length,
        periodic_boundary_conditions: cells ? pbc : [false, false, false],
        has_cell_info: Boolean(cells),
        element_counts: elements.reduce((acc, el) => {
          acc[el] = (acc[el] || 0) + 1
          return acc
        }, {} as Record<string, number>),
      },
    }
  } finally {
    h5_file.close()
    try {
      FS.unlink(temp_filename)
    } catch {
      // Ignore cleanup errors
    }
  }
}

const parse_vasp_xdatcar = (content: string, filename?: string): Trajectory => {
  const lines = content.trim().split(/\r?\n/)
  if (lines.length < 10) throw new Error(`XDATCAR file too short`)

  const title = lines[0].trim()
  const scale = parseFloat(lines[1])
  if (isNaN(scale)) throw new Error(`Invalid scale factor`)

  const lattice_matrix = lines.slice(2, 5).map((line) =>
    line.trim().split(/\s+/).map((x) => parseFloat(x) * scale)
  ) as Matrix3x3

  const element_names = lines[5].trim().split(/\s+/)
  const element_counts = lines[6].trim().split(/\s+/).map(Number)
  const elements: ElementSymbol[] = element_names.flatMap((name, idx) =>
    Array(element_counts[idx]).fill(name as ElementSymbol)
  )

  const frames: TrajectoryFrame[] = []
  let line_idx = 7

  while (line_idx < lines.length) {
    if (!lines[line_idx]?.includes(`Direct configuration=`)) {
      line_idx++
      continue
    }

    const step_match = lines[line_idx].match(/configuration=\s*(\d+)/)
    const step = step_match ? parseInt(step_match[1]) : frames.length + 1
    line_idx++

    const positions = []
    for (let idx = 0; idx < elements.length && line_idx < lines.length; idx++) {
      const coords = lines[line_idx].trim().split(/\s+/).slice(0, 3).map(Number)
      if (coords.length === 3 && !coords.some(isNaN)) {
        const abc = coords as Vec3
        positions.push(
          math.mat3x3_vec3_multiply(math.transpose_matrix(lattice_matrix), abc),
        )
      }
      line_idx++
    }

    if (positions.length === elements.length) {
      frames.push(create_trajectory_frame({
        positions,
        elements,
        lattice_matrix,
        pbc: [true, true, true],
        metadata: { volume: math.calc_lattice_params(lattice_matrix).volume },
      }, step))
    }
  }

  return {
    frames,
    metadata: {
      filename,
      title,
      source_format: `vasp_xdatcar`,
      frame_count: frames.length,
      total_atoms: elements.length,
      elements: element_names,
      element_counts,
      periodic_boundary_conditions: [true, true, true],
    },
  }
}

const parse_xyz_trajectory = (content: string): Trajectory => {
  const lines = content.trim().split(/\r?\n/)
  const frames: TrajectoryFrame[] = []
  let line_idx = 0

  while (line_idx < lines.length) {
    if (!lines[line_idx]?.trim()) {
      line_idx++
      continue
    }

    const num_atoms = parseInt(lines[line_idx].trim(), 10)
    if (isNaN(num_atoms) || num_atoms <= 0) {
      line_idx++
      continue
    }
    if (line_idx + num_atoms + 1 >= lines.length) break

    line_idx++
    const comment = lines[line_idx] || ``
    const metadata: Record<string, unknown> = {}

    // Extract step number
    const step_match = comment.match(/(?:step|frame|ionic_step)\s*[=:]?\s*(\d+)/i)
    const step = step_match ? parseInt(step_match[1]) : frames.length

    // Extract properties with comprehensive aliases
    const property_patterns = {
      energy:
        /(?:energy|E|etot|total_energy)\s*[=:]?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
      energy_per_atom:
        /(?:e_per_atom|energy\/atom)\s*[=:]?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
      volume: /(?:volume|vol|V)\s*[=:]?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
      pressure: /(?:pressure|press|P)\s*[=:]?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
      temperature: /(?:temperature|temp|T)\s*[=:]?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
      bandgap: /(?:E_gap|gap|bg)\s*[=:]?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
      force_max:
        /(?:max_force|force_max|fmax)\s*[=:]?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
      stress_max:
        /(?:max_stress|stress_max)\s*[=:]?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
      stress_frobenius: /stress_frobenius\s*[=:]?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
    }

    Object.entries(property_patterns).forEach(([key, pattern]) => {
      const match = comment.match(pattern)
      if (match) metadata[key] = parseFloat(match[1])
    })

    // Extract lattice matrix
    const lattice_match = comment.match(/Lattice\s*=\s*"([^"]+)"/i)
    let lattice_matrix: Matrix3x3 | undefined
    if (lattice_match) {
      const values = lattice_match[1].split(/\s+/).map(Number)
      if (values.length === 9) {
        lattice_matrix = [
          [values[0], values[1], values[2]],
          [values[3], values[4], values[5]],
          [values[6], values[7], values[8]],
        ]
        metadata.volume = math.calc_lattice_params(lattice_matrix).volume
      }
    }

    // Parse atoms
    line_idx++
    const positions: number[][] = []
    const elements: ElementSymbol[] = []
    const forces: number[][] = []
    const has_forces = comment.includes(`forces:R:3`) ||
      comment.includes(`Properties=`) && comment.includes(`forces:R:3`)

    for (let idx = 0; idx < num_atoms && line_idx < lines.length; idx++) {
      const parts = lines[line_idx].trim().split(/\s+/)
      if (parts.length >= 4) {
        elements.push(parts[0] as ElementSymbol)
        const pos: Vec3 = [
          parseFloat(parts[1]),
          parseFloat(parts[2]),
          parseFloat(parts[3]),
        ]
        positions.push(pos)

        if (
          has_forces && parts.length >= 7 &&
          parts.slice(4, 7).every((x) => !isNaN(parseFloat(x)))
        ) {
          forces.push([parseFloat(parts[4]), parseFloat(parts[5]), parseFloat(parts[6])])
        }
      }
      line_idx++
    }

    if (forces.length > 0) {
      metadata.forces = forces
      Object.assign(metadata, calculate_force_stats(forces))
    }

    frames.push(create_trajectory_frame({
      positions,
      elements,
      lattice_matrix,
      pbc: lattice_matrix ? [true, true, true] : undefined,
      metadata,
    }, step))
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

const parse_pymatgen_trajectory = (
  data: Record<string, unknown>,
  filename?: string,
): Trajectory => {
  const species = data.species as Array<{ element: ElementSymbol }>
  const coords = data.coords as number[][][]
  const matrix = data.lattice as Matrix3x3
  const frame_properties = data.frame_properties as Array<Record<string, unknown>>

  const frames = coords.map((frame_coords, idx) => {
    const frame_props = frame_properties?.[idx] || {}
    const metadata = { ...frame_props }

    // Extract forces
    const forces_data = (frame_props.forces as { data?: number[][] })?.data || null
    if (forces_data) {
      metadata.forces = forces_data
      Object.assign(metadata, calculate_force_stats(forces_data))
    }

    // Extract stress
    const stress_data = (frame_props.stress as { data?: number[][] })?.data
    if (stress_data?.length === 3) {
      metadata.stress = stress_data
      Object.assign(metadata, calculate_stress_stats(stress_data))
    }

    const positions = frame_coords.map((abc) =>
      math.mat3x3_vec3_multiply(math.transpose_matrix(matrix), abc as Vec3)
    )

    return create_trajectory_frame({
      positions,
      elements: species.map((s) => s.element),
      lattice_matrix: matrix,
      pbc: [true, true, true],
      metadata,
    }, idx)
  })

  return {
    frames,
    metadata: {
      filename,
      source_format: `pymatgen_trajectory`,
      species_list: species.map((s) => s.element),
      frame_count: frames.length,
      periodic_boundary_conditions: [true, true, true],
    },
  }
}

const parse_ase_trajectory = (buffer: ArrayBuffer, filename?: string): Trajectory => {
  const view = new DataView(buffer)
  let offset = 0

  // Validate signature
  const signature = new TextDecoder().decode(new Uint8Array(buffer, 0, 8))
  if (signature !== `- of Ulm`) throw new Error(`Invalid ASE trajectory`)
  offset += 8

  const tag = new TextDecoder().decode(new Uint8Array(buffer, offset, 16)).replace(
    /\0/g,
    ``,
  ).trim()
  if (!tag.startsWith(`ASE-Trajectory`)) throw new Error(`Invalid ASE trajectory`)
  offset += 16

  // Read header
  const _version = Number(view.getBigInt64(offset, true))
  offset += 8
  const n_items = Number(view.getBigInt64(offset, true))
  offset += 8
  const offsets_pos = Number(view.getBigInt64(offset, true))
  offset += 8

  if (n_items <= 0) throw new Error(`Invalid frame count`)

  // Read offsets
  const frame_offsets = []
  offset = offsets_pos
  for (let idx = 0; idx < n_items; idx++) {
    frame_offsets.push(Number(view.getBigInt64(offset, true)))
    offset += 8
  }

  const read_ndarray = (ref: { ndarray: unknown[] }): number[][] => {
    const [shape, dtype, array_offset] = ref.ndarray as [number[], string, number]
    const total = shape.reduce((a, b) => a * b, 1)
    const data: number[] = []
    let pos = array_offset

    for (let idx = 0; idx < total; idx++) {
      let value: number
      if (dtype === `int64`) {
        value = Number(view.getBigInt64(pos, true))
        pos += 8
      } else if (dtype === `int32`) {
        value = view.getInt32(pos, true)
        pos += 4
      } else if (dtype === `float64`) {
        value = view.getFloat64(pos, true)
        pos += 8
      } else if (dtype === `float32`) {
        value = view.getFloat32(pos, true)
        pos += 4
      } else throw new Error(`Unsupported dtype: ${dtype}`)
      data.push(value)
    }

    return shape.length === 1
      ? [data]
      : shape.length === 2
      ? Array.from({ length: shape[0] }, (_, i) =>
        data.slice(i * shape[1], (i + 1) * shape[1]))
      : (() => {
        throw new Error(`Unsupported shape`)
      })()
  }

  const frames: TrajectoryFrame[] = []
  let global_numbers: number[] | undefined

  for (let idx = 0; idx < n_items; idx++) {
    offset = frame_offsets[idx]
    const json_length = Number(view.getBigInt64(offset, true))
    offset += 8

    const json_str = new TextDecoder().decode(new Uint8Array(buffer, offset, json_length))
    const frame_data = JSON.parse(json_str)

    const positions_ref = frame_data[`positions.`] || frame_data.positions
    const positions = positions_ref?.ndarray ? read_ndarray(positions_ref) : positions_ref
    const cell = frame_data.cell as Matrix3x3
    const numbers_ref: unknown = frame_data[`numbers.`] || frame_data.numbers ||
      global_numbers
    const numbers: number[] = (numbers_ref as { ndarray?: unknown })?.ndarray
      ? read_ndarray(numbers_ref as { ndarray: unknown[] }).flat()
      : numbers_ref as number[]

    if (numbers) global_numbers = numbers

    const elements = convert_atomic_numbers(numbers)
    const metadata = {
      filename,
      title: `ASE Trajectory`,
      program: `ASE`,
      num_atoms: global_numbers?.length || 0,
      num_frames: frames.length,
      source_format: `ase_trajectory`,
      periodic_boundary_conditions: [true, true, true],
      element_counts: global_numbers?.reduce((acc, num) => {
        const el = atomic_number_to_symbol[num] || `X`
        acc[el] = (acc[el] || 0) + 1
        return acc
      }, {} as Record<string, number>),
      ...(frame_data.calculator && { ...frame_data.calculator }),
      ...(frame_data.info && { ...frame_data.info }),
    }

    frames.push(create_trajectory_frame({
      positions,
      elements,
      lattice_matrix: cell,
      pbc: frame_data.pbc || [true, true, true],
      metadata,
    }, idx))
  }

  return {
    frames,
    metadata: {
      filename,
      title: `ASE Trajectory`,
      program: `ASE`,
      num_atoms: global_numbers?.length || 0,
      num_frames: frames.length,
      source_format: `ase_trajectory`,
      periodic_boundary_conditions: [true, true, true],
      element_counts: global_numbers?.reduce((acc, num) => {
        const el = atomic_number_to_symbol[num] || `X`
        acc[el] = (acc[el] || 0) + 1
        return acc
      }, {} as Record<string, number>),
    },
  }
}

// Main parsing entry point
export async function parse_trajectory_data(
  data: unknown,
  filename?: string,
): Promise<Trajectory> {
  if (data instanceof ArrayBuffer) {
    if (is_ase_format(data, filename)) return parse_ase_trajectory(data, filename)
    if (is_torch_sim_hdf5(data, filename)) {
      return await parse_torch_sim_hdf5(data, filename)
    }
    throw new Error(`Unsupported binary format`)
  }

  if (typeof data === `string`) {
    const content = data.trim()
    if (is_xyz_multi_frame(content, filename)) return parse_xyz_trajectory(content)
    if (is_vasp_format(content, filename)) return parse_vasp_xdatcar(content, filename)

    // Try single XYZ as fallback
    if (filename?.toLowerCase().match(/\.(?:xyz|extxyz)$/)) {
      try {
        const structure = parse_xyz(content)
        if (structure) {
          return {
            frames: [{ structure, step: 0, metadata: {} }],
            metadata: { source_format: `single_xyz`, frame_count: 1 },
          }
        }
      } catch {
        // Ignore XYZ parsing errors and try other formats
      }
    }

    try {
      data = JSON.parse(content)
    } catch {
      throw new Error(`Unsupported text format`)
    }
  }

  if (!data || typeof data !== `object`) throw new Error(`Invalid data format`)

  // Handle JSON formats
  if (Array.isArray(data)) {
    const frames = data.map((frame_data, idx) => {
      const frame_obj = frame_data as Record<string, unknown>
      const structure = (frame_obj.structure || frame_obj) as AnyStructure
      return {
        structure,
        step: frame_obj.step as number || idx,
        metadata: frame_obj.metadata as Record<string, unknown> || {},
      }
    })
    return { frames, metadata: { source_format: `array`, frame_count: frames.length } }
  }

  const obj = data as Record<string, unknown>

  // Pymatgen format
  if (obj[`@class`] === `Trajectory` && obj.species && obj.coords && obj.lattice) {
    return parse_pymatgen_trajectory(obj, filename)
  }

  // Object with frames
  if (obj.frames && Array.isArray(obj.frames)) {
    return {
      frames: obj.frames as TrajectoryFrame[],
      metadata: {
        ...obj.metadata as Record<string, unknown>,
        source_format: `object_with_frames`,
      },
    }
  }

  // Single structure
  if (obj.sites) {
    return {
      frames: [{ structure: obj as AnyStructure, step: 0, metadata: {} }],
      metadata: { source_format: `single_structure`, frame_count: 1 },
    }
  }

  throw new Error(`Unrecognized trajectory format`)
}

// Utility functions
export async function load_trajectory_from_url(url: string): Promise<Trajectory> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`)

  const filename = url.split(`/`).pop() || `trajectory`
  const is_hdf5 = filename.toLowerCase().match(/\.h5$|\.hdf5$/)

  if (is_hdf5) {
    return await parse_trajectory_data(await response.arrayBuffer(), filename)
  }

  const content_encoding = response.headers.get(`content-encoding`)
  if (content_encoding === `gzip`) {
    return await parse_trajectory_data(
      await response.text(),
      filename.replace(/\.gz$/, ``),
    )
  }

  const { decompress_file } = await import(`../io/decompress`)
  const file = new File([await response.blob()], filename)
  const result = await decompress_file(file)
  return await parse_trajectory_data(result.content, result.filename)
}

export function get_unsupported_format_message(
  filename: string,
  content: string,
): string | null {
  const lower = filename.toLowerCase()
  const formats = [
    { ext: [`.dump`, `.lammpstrj`], name: `LAMMPS`, tool: `pymatgen` },
    { ext: [`.nc`, `.netcdf`], name: `NetCDF`, tool: `MDAnalysis` },
    { ext: [`.dcd`], name: `DCD`, tool: `MDAnalysis` },
  ]

  for (const { ext, name, tool } of formats) {
    if (ext.some((e) => lower.endsWith(e))) {
      return `<div class="unsupported-format"><h4>🚫 ${name} format not supported</h4><p>Convert with ${tool} first</p></div>`
    }
  }

  return is_binary(content)
    ? `<div class="unsupported-format"><h4>🚫 Binary format not supported</h4></div>`
    : null
}

export async function parse_trajectory_async(
  data: ArrayBuffer | string,
  filename: string,
  on_progress?: (progress: ParseProgress) => void,
): Promise<Trajectory> {
  const update_progress = (current: number, stage: string) =>
    on_progress?.({ current, total: 100, stage })

  try {
    update_progress(0, `Detecting format...`)

    // Format detection and parsing in one step
    let result: Trajectory
    if (data instanceof ArrayBuffer) {
      if (is_ase_format(data, filename)) {
        update_progress(50, `Parsing ASE trajectory...`)
        result = parse_ase_trajectory(data, filename)
      } else if (is_torch_sim_hdf5(data, filename)) {
        update_progress(50, `Parsing TorchSim HDF5...`)
        result = await parse_torch_sim_hdf5(data, filename)
      } else {
        throw new Error(`Unsupported binary format`)
      }
    } else {
      const content = data.trim()
      if (is_xyz_multi_frame(content, filename)) {
        update_progress(50, `Parsing XYZ trajectory...`)
        result = parse_xyz_trajectory(content)
      } else if (is_vasp_format(content, filename)) {
        update_progress(50, `Parsing VASP XDATCAR...`)
        result = parse_vasp_xdatcar(content, filename)
      } else if (filename?.toLowerCase().match(/\.(?:xyz|extxyz)$/)) {
        update_progress(50, `Parsing single XYZ...`)
        const { parse_xyz } = await import(`../io/parse`)
        const structure = parse_xyz(content)
        if (!structure) throw new Error(`Failed to parse XYZ structure`)
        result = {
          frames: [{ structure, step: 0, metadata: {} }],
          metadata: { source_format: `single_xyz`, frame_count: 1 },
        }
      } else {
        update_progress(50, `Parsing JSON trajectory...`)
        try {
          result = await parse_trajectory_data(JSON.parse(content), filename)
        } catch {
          result = await parse_trajectory_data(data, filename)
        }
      }
    }

    update_progress(85, `Validating frames...`)
    if (!result.frames?.length) throw new Error(`No valid frames found`)

    if (result.metadata) {
      result.metadata.frame_count ??= result.frames.length
    }
    update_progress(100, `Complete`)
    return result
  } catch (error) {
    update_progress(
      100,
      `Error: ${error instanceof Error ? error.message : `Unknown error`}`,
    )
    throw error
  }
}
