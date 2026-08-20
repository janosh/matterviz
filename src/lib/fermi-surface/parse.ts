// Parsers for Fermi surface file formats (BXSF, FRMSF, JSON)
import { BOHR_TO_ANGSTROM, HARTREE_TO_EV } from '$lib/constants'
import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import {
  is_plain_object,
  normalize_scientific_notation,
  parse_leading_num,
  to_error,
} from '$lib/utils'
import { flatten_grid } from '$lib/isosurface/grid'
import { compute_vertex_normals } from '$lib/marching-cubes'
import type {
  BandEnergyGrid,
  BandGridData,
  FermiSurfaceData,
  FermiIsosurface,
  SpinChannel,
  SurfaceDimensionality,
} from './types'

const parse_number_tokens = (line: string): string[] => line.split(/\s+/).filter(Boolean)

// Parse whitespace-separated floats from a line. Normalizes Fortran D-exponents
// (`0.1234D+01`) which Fortran codes emit in BXSF/FRMSF and Number() rejects
const parse_floats = (line: string): number[] =>
  parse_number_tokens(normalize_scientific_notation(line)).map(Number)

// Append a line's floats to `values` starting at `offset`, dropping tokens past the end of
// the buffer. Returns the new fill count. Writing in place (rather than `push(...floats)`)
// keeps memory flat and avoids the argument-count limit a spread hits on very long lines.
function fill_floats(values: Float64Array, offset: number, line: string): number {
  const tokens = parse_number_tokens(normalize_scientific_notation(line))
  const count = Math.min(tokens.length, values.length - offset)
  for (let idx = 0; idx < count; idx++) values[offset + idx] = Number(tokens[idx])
  return offset + count
}

// Leading number of a trimmed, non-empty line. FRMSF bodies are tens of thousands of
// one-number lines, so try Number() on the bare token first and only fall back to the
// regex-based Fortran D-exponent / unicode-minus normalization when that yields NaN.
function parse_leading_energy(line: string): number {
  let end = line.indexOf(` `)
  const tab_idx = line.indexOf(`\t`)
  if (tab_idx !== -1 && (end === -1 || tab_idx < end)) end = tab_idx
  const fast = Number(end === -1 ? line : line.slice(0, end))
  return Number.isNaN(fast) ? parse_leading_num(normalize_scientific_notation(line)) : fast
}

const make_band_grid = (values: Float64Array, dims: Vec3): BandEnergyGrid => ({
  values,
  dims,
  order: `z_fastest`,
})

// Parse whitespace-separated integers from a line
const parse_ints = (line: string): number[] =>
  parse_number_tokens(line).map((part) => Math.trunc(Number(part)))

// Parse BXSF (Band-XSF) format used by XCrySDen, Quantum ESPRESSO, etc.
// Format specification: http://www.xcrysden.org/doc/XSF.html
function parse_bxsf(content: string): BandGridData {
  const lines = content.split(/\r?\n/).map((line) => line.trim())
  let line_idx = 0

  // Helper to get next non-empty, non-comment line
  const next_line = (): string => {
    while (line_idx < lines.length) {
      const line = lines[line_idx++]
      if (line && !line.startsWith(`#`)) return line
    }
    throw new Error(`Unexpected end of BXSF file`)
  }

  // Find BEGIN_BLOCK_BANDGRID_3D
  while (line_idx < lines.length) {
    if (lines[line_idx].includes(`BEGIN_BLOCK_BANDGRID_3D`)) {
      line_idx++
      break
    }
    line_idx++
  }
  if (line_idx >= lines.length) {
    throw new Error(`BXSF file missing BEGIN_BLOCK_BANDGRID_3D`)
  }

  // Skip block identifier line (e.g. "band_energies")
  next_line()

  // Parse BEGIN_BANDGRID_3D or BANDGRID_3D_BANDS (both variants exist)
  const bandgrid_line = next_line()
  if (!bandgrid_line.includes(`BANDGRID_3D`)) {
    throw new Error(`Expected BANDGRID_3D header, got: ${bandgrid_line}`)
  }

  // Parse number of bands
  const n_bands = Math.trunc(Number(next_line()))
  if (isNaN(n_bands) || n_bands <= 0) {
    throw new Error(`Invalid number of bands in BXSF file`)
  }

  // Parse grid dimensions (nx ny nz)
  const grid_dims = parse_ints(next_line())
  if (grid_dims.length !== 3) {
    throw new Error(`Expected 3 grid dimensions, got ${grid_dims.length}`)
  }
  const k_grid: Vec3 = [grid_dims[0], grid_dims[1], grid_dims[2]]

  // Parse origin
  const origin_vals = parse_floats(next_line())
  if (origin_vals.length !== 3) {
    throw new Error(`Expected 3 origin values, got ${origin_vals.length}`)
  }
  const origin: Vec3 = [origin_vals[0], origin_vals[1], origin_vals[2]]

  // Parse 3 spanning vectors (reciprocal lattice)
  const spanning_vectors: Matrix3x3 = [
    parse_floats(next_line()).slice(0, 3) as Vec3,
    parse_floats(next_line()).slice(0, 3) as Vec3,
    parse_floats(next_line()).slice(0, 3) as Vec3,
  ]

  // Validate spanning vectors
  for (const vec of spanning_vectors) {
    if (vec.length !== 3 || vec.some(isNaN)) {
      throw new Error(`Invalid spanning vector in BXSF file`)
    }
  }

  // Parse band data. Format: BAND: band_number followed by energy values in z-fastest
  // order, which is exactly the flat BandEnergyGrid layout — no reshaping needed.
  const energies: BandEnergyGrid[][] = [[]] // [spin=1][band]
  const total_points = k_grid[0] * k_grid[1] * k_grid[2]

  for (let band_idx = 0; band_idx < n_bands; band_idx++) {
    // Find BAND: line
    let band_line = next_line()
    while (!band_line.startsWith(`BAND:`)) {
      band_line = next_line()
    }

    // Read energy values for this band
    const energy_values = new Float64Array(total_points)
    let n_read = 0
    while (n_read < total_points) {
      const line = next_line()
      if (line.startsWith(`END_BANDGRID`) || line.startsWith(`BAND:`)) {
        // Unread this line: after next_line() returns, line_idx points past the
        // returned line, so decrementing by 1 restores to the line just read
        line_idx--
        break
      }
      n_read = fill_floats(energy_values, n_read, line)
    }

    if (n_read < total_points) {
      throw new Error(`Band ${band_idx}: expected ${total_points} values, got ${n_read}`)
    }
    energies[0].push(make_band_grid(energy_values, k_grid))
  }

  // Try to find Fermi energy (often in a comment or as FERMI_ENERGY keyword)
  let fermi_energy = 0
  for (const line of lines) {
    const lower = line.toLowerCase()
    if (lower.includes(`fermi`) && lower.includes(`energy`)) {
      // Match patterns like "Fermi Energy = 5.123" or "fermi_energy: -0.5"
      const match = /(?:=|:)\s*(?<value>[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i.exec(line)
      if (match) {
        fermi_energy = Number(match[1])
        break
      }
    }
  }

  return {
    energies,
    k_grid,
    k_lattice: spanning_vectors,
    fermi_energy,
    n_bands,
    n_spins: 1,
    origin,
  }
}

// Parse FRMSF format used by FermiSurfer
// Format: https://mitsuaki1987.github.io/fermisurfer/en/_build/html/ops.html
function parse_frmsf(content: string): BandGridData {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  let line_idx = 0

  // Line 1: grid dimensions (ng[0] ng[1] ng[2])
  const grid_dims = parse_ints(lines[line_idx++])
  if (grid_dims.length !== 3) {
    throw new Error(`FRMSF: Expected 3 grid dimensions`)
  }
  const k_grid: Vec3 = [grid_dims[0], grid_dims[1], grid_dims[2]]

  // Line 2: lshift (grid shift type)
  // 0 = Monkhorst-Pack grid (shifted)
  // 1 = Gamma-centered grid
  // 2 = Gamma + half grid shift
  const lshift = Math.trunc(Number(lines[line_idx++]))
  if (isNaN(lshift) || lshift < 0 || lshift > 2) {
    throw new Error(`FRMSF: Invalid lshift value (expected 0, 1, or 2)`)
  }

  // Line 3: number of bands
  const n_bands = Math.trunc(Number(lines[line_idx++]))
  if (isNaN(n_bands) || n_bands <= 0) {
    throw new Error(`FRMSF: Invalid number of bands`)
  }

  // Lines 4-6: reciprocal lattice vectors (in Bohr^-1, convert to Å^-1)
  const inv_bohr = 1 / BOHR_TO_ANGSTROM
  const parse_k_vector = (): Vec3 =>
    parse_floats(lines[line_idx++])
      .slice(0, 3)
      .map((val) => val * inv_bohr) as Vec3
  const k_lattice: Matrix3x3 = [parse_k_vector(), parse_k_vector(), parse_k_vector()]

  const total_points = k_grid[0] * k_grid[1] * k_grid[2]

  // Parse band energies (FRMSF has a single spin channel — no spin-polarized support
  // in the standard format). One energy value per line per grid point in z-fastest order;
  // any additional columns (e.g. auxiliary color/velocity data) are ignored to prevent
  // grid corruption. Values are converted from Hartree to eV as they are read.
  const energies: BandEnergyGrid[][] = [[]]
  for (let band_idx = 0; band_idx < n_bands; band_idx++) {
    const energy_values = new Float64Array(total_points)
    let n_read = 0

    // Read energy values (first value per line only, ignore auxiliary columns)
    while (n_read < total_points && line_idx < lines.length) {
      const energy = parse_leading_energy(lines[line_idx])
      if (isNaN(energy)) break
      energy_values[n_read++] = energy * HARTREE_TO_EV
      line_idx++
    }

    if (n_read < total_points) {
      throw new Error(`FRMSF band ${band_idx}: expected ${total_points} values, got ${n_read}`)
    }
    energies[0].push(make_band_grid(energy_values, k_grid))
  }

  return {
    energies,
    k_grid,
    k_lattice,
    fermi_energy: 0, // FRMSF typically expects Fermi level at 0
    n_bands,
    n_spins: 1,
    periodic: true, // FRMSF stores k=i/n with no duplicated endpoint (unlike BXSF)
  }
}

// Validate that an object has the required FermiIsosurface shape
function is_valid_isosurface(obj: unknown): obj is FermiIsosurface {
  if (!is_plain_object(obj)) return false
  const { vertices, faces, normals, band_index, spin } = obj

  if (!Array.isArray(vertices) || vertices.length === 0) return false
  if (!Array.isArray(faces)) return false
  if (!Array.isArray(normals)) return false
  if (typeof band_index !== `number` || !Number.isFinite(band_index)) return false
  if (spin !== null && spin !== `up` && spin !== `down`) return false

  return true
}

// Validate FermiSurfaceData shape
function is_valid_fermi_surface_data(obj: unknown): obj is FermiSurfaceData {
  if (!is_plain_object(obj)) return false

  // Check required fields
  if (!Array.isArray(obj.isosurfaces)) return false
  if (!math.is_square_matrix(obj.k_lattice, 3)) return false
  if (typeof obj.fermi_energy !== `number`) return false
  if (obj.reciprocal_cell !== `wigner_seitz` && obj.reciprocal_cell !== `parallelepiped`) {
    return false
  }
  if (!obj.metadata || typeof obj.metadata !== `object`) return false

  // Validate each isosurface
  return obj.isosurfaces.every(is_valid_isosurface)
}

// BandGridData as it appears in JSON: energies are nested [spin][band][kx][ky][kz] arrays
type BandGridJson = Omit<BandGridData, `energies`> & { energies: number[][][][][] }

// Validate the JSON BandGridData shape: non-empty energies grid, 3 k-grid dims, 3x3 k-lattice
function is_valid_band_grid_json(obj: unknown): obj is BandGridJson {
  if (!is_plain_object(obj)) return false
  const { energies, k_grid, k_lattice } = obj
  if (!Array.isArray(energies) || energies.length === 0) return false
  if (
    !Array.isArray(k_grid) ||
    k_grid.length !== 3 ||
    !k_grid.every((dim) => Number.isInteger(dim) && dim > 0)
  )
    return false
  return math.is_square_matrix(k_lattice, 3)
}

// Flatten nested JSON band grids into BandEnergyGrid storage, checking that every band
// matches k_grid (a ragged or mis-sized band would otherwise read garbage in marching cubes)
function normalize_band_grid_json(json: BandGridJson): BandGridData {
  const { k_grid } = json
  const energies = json.energies.map((bands, spin_idx) => {
    if (!Array.isArray(bands)) {
      throw new TypeError(`BandGridData JSON: energies[${spin_idx}] is not an array of bands`)
    }
    return bands.map((band, band_idx) => {
      if (!Array.isArray(band)) {
        throw new TypeError(
          `BandGridData JSON: energies[${spin_idx}][${band_idx}] is not a [kx][ky][kz] grid`,
        )
      }
      const grid = flatten_grid(band)
      if (grid.dims.some((dim, axis) => dim !== k_grid[axis])) {
        throw new Error(
          `BandGridData JSON: energies[${spin_idx}][${band_idx}] has shape ${grid.dims.join(`×`)} but k_grid is ${k_grid.join(`×`)}`,
        )
      }
      return grid
    })
  })
  return { ...json, energies }
}

// First non-zero number in a fallback chain (an explicit 0 falls through like undefined)
const first_nonzero = (...values: unknown[]): number | undefined =>
  values.find((val): val is number => typeof val === `number` && val !== 0)

// Parse Matterviz/IFermi JSON format for Fermi surface data
// Throws on invalid input; returns parsed data on success
function parse_fermi_json(content: string): FermiSurfaceData | BandGridData {
  const data = JSON.parse(content)

  // Check if it's already in our FermiSurfaceData format with full validation
  if (data.isosurfaces && Array.isArray(data.isosurfaces)) {
    if (is_valid_fermi_surface_data(data)) {
      return data
    }
    throw new Error(
      `Invalid FermiSurfaceData JSON: isosurfaces array present but missing required fields`,
    )
  }

  // Check if it's IFermi format (isosurfaces is an object keyed by band index)
  if (
    data[`@class`] === `FermiSurface` &&
    data.isosurfaces &&
    typeof data.isosurfaces === `object`
  ) {
    return parse_ifermi_surface(data)
  }

  // Check if it's BandGridData (raw grid data)
  if (data.energies && data.k_grid && data.k_lattice) {
    if (!is_valid_band_grid_json(data)) {
      throw new Error(
        `Invalid BandGridData JSON: expected non-empty 'energies' grid, 3 'k_grid' dims, and 3x3 'k_lattice'`,
      )
    }
    return normalize_band_grid_json(data)
  }

  // Try to extract from nested structure (e.g. IFermi output)
  if (data.fermi_surface) {
    if (!is_valid_fermi_surface_data(data.fermi_surface)) {
      throw new Error(
        `Invalid nested 'fermi_surface' JSON: expected isosurfaces array, 3x3 k_lattice, numeric fermi_energy, reciprocal_cell, and metadata`,
      )
    }
    return data.fermi_surface
  }

  if (data.band_structure?.energies || data.bands?.energies) {
    const bs = data.band_structure ?? data.bands
    const grid_data = {
      energies: bs.energies,
      k_grid: bs.k_grid ?? bs.kgrid,
      k_lattice: bs.k_lattice ?? bs.reciprocal_lattice,
      fermi_energy: bs.fermi_energy ?? bs.efermi ?? 0,
      n_bands: first_nonzero(bs.n_bands, bs.nbands, bs.energies[0]?.length) ?? 0,
      n_spins: first_nonzero(bs.n_spins, bs.nspins, bs.energies.length) ?? 1,
    }
    if (!is_valid_band_grid_json(grid_data)) {
      throw new Error(
        `Invalid band_structure JSON: expected non-empty 'energies' grid, 3 'k_grid' dims, and 3x3 'k_lattice'`,
      )
    }
    return normalize_band_grid_json(grid_data)
  }

  // Check for pymatgen BandStructure format (k-path, not k-grid)
  // These files cannot be used for Fermi surface visualization directly
  if (data.bs?.[`@class`] === `BandStructure` || data[`@class`] === `BandStructure`) {
    throw new Error(
      `This is a pymatgen BandStructure file (band data along k-path). ` +
        `Fermi surface visualization requires a uniform 3D k-grid of eigenvalues. ` +
        `Use IFermi or a BXSF/FRMSF file instead.`,
    )
  }

  throw new Error(`Unrecognized JSON format: missing required fields for Fermi surface data`)
}

// Helper type for IFermi isosurface JSON
interface IFermiIsosurface {
  vertices: number[][]
  faces: number[][]
  band_idx: number
  properties?: Record<string, number[]>
  dimensionality?: string
  orientation?: number[] | null
}

// Parse IFermi's JSON output format
function parse_ifermi_surface(data: Record<string, unknown>): FermiSurfaceData {
  const isosurfaces_obj = data.isosurfaces as Record<string, IFermiIsosurface[]>
  const reciprocal_space = data.reciprocal_space as
    | {
        reciprocal_lattice?: number[][]
        vertices?: number[][]
        faces?: number[][]
      }
    | undefined

  // Extract reciprocal lattice
  const k_lattice: Matrix3x3 = reciprocal_space?.reciprocal_lattice
    ? (reciprocal_space.reciprocal_lattice as Matrix3x3)
    : [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ]

  // Convert IFermi isosurfaces to our format
  const isosurfaces: FermiIsosurface[] = []
  const band_indices = new Set<number>()
  let has_spin = false

  for (const [band_key, iso_list] of Object.entries(isosurfaces_obj)) {
    const band_index = Math.trunc(Number(band_key))
    // spin is determined by sign: positive = up, negative = down
    const spin: SpinChannel = band_index < 0 ? `down` : `up`
    const abs_band_idx = Math.abs(band_index)
    band_indices.add(abs_band_idx)
    if (band_index < 0) has_spin = true

    for (const ifermi_iso of iso_list) {
      const vertices = ifermi_iso.vertices as Vec3[]
      const faces = ifermi_iso.faces

      // Compute vertex normals from faces
      const normals = compute_vertex_normals(vertices, faces)

      // IFermi stores properties like fermi_velocity, spin, etc.
      // Use first available property as vertex colors
      const properties: number[] | undefined = Object.values(ifermi_iso.properties ?? {})[0]

      // Parse dimensionality
      let dimensionality: SurfaceDimensionality | undefined
      if (ifermi_iso.dimensionality) {
        const dim = ifermi_iso.dimensionality.toLowerCase()
        if (dim.includes(`1d`)) dimensionality = `1D`
        else if (dim.includes(`quasi`)) dimensionality = `quasi-2D`
        else if (dim.includes(`2d`)) dimensionality = `2D`
        else if (dim.includes(`3d`)) dimensionality = `3D`
      }

      // Compute area for this isosurface using fan triangulation for N-gons
      let area = 0
      for (const face of faces) {
        if (face.length < 3) continue
        // Validate face indices are within bounds to prevent NaN from undefined vertices
        if (face.some((idx) => idx < 0 || idx >= vertices.length)) continue
        // Fan triangulation: for N vertices, create N-2 triangles (0,1,2), (0,2,3), ...
        const v0 = vertices[face[0]]
        for (let fan_idx = 1; fan_idx < face.length - 1; fan_idx++) {
          const v1 = vertices[face[fan_idx]]
          const v2 = vertices[face[fan_idx + 1]]
          const cross = math.cross_3d(math.subtract(v1, v0), math.subtract(v2, v0))
          area += 0.5 * Math.hypot(...cross)
        }
      }

      isosurfaces.push({
        vertices,
        faces,
        normals,
        properties,
        band_index: abs_band_idx,
        spin,
        area,
        dimensionality,
        orientation: ifermi_iso.orientation as Vec3 | null,
      })
    }
  }

  // Compute total surface area
  const total_area = isosurfaces.reduce((sum, iso) => sum + (iso.area ?? 0), 0)

  return {
    isosurfaces,
    k_lattice,
    fermi_energy: 0, // IFermi surfaces are typically relative to Fermi level
    reciprocal_cell: `wigner_seitz`, // IFermi typically uses Wigner-Seitz cells
    metadata: {
      n_bands: band_indices.size,
      n_surfaces: isosurfaces.length,
      total_area,
      source_format: `ifermi-json`,
      has_spin,
      has_velocities: isosurfaces.some((iso) => iso.properties !== undefined),
    },
  }
}

// Auto-detect file format and parse; throws an Error aggregating per-format failure reasons when nothing parses
export function parse_fermi_file(
  content: string,
  filename?: string,
): BandGridData | FermiSurfaceData {
  const lower_name = filename?.toLowerCase() ?? ``
  const errors: string[] = []
  const attempt = <T>(format: string, parse: () => T): T | null => {
    try {
      return parse()
    } catch (error) {
      errors.push(`${format}: ${to_error(error).message}`)
      console.error(`${format} parse error:`, error)
      return null
    }
  }
  const fail = (): never => {
    const detail = errors.length ? `: ${errors.join(`; `)}` : `: unrecognized format`
    throw new Error(
      `Failed to parse Fermi surface file${filename ? ` '${filename}'` : ``}${detail}`,
    )
  }

  // Detect by filename extension (authoritative: parse failure throws immediately)
  if (lower_name.endsWith(`.bxsf`) || lower_name.endsWith(`.bxsf.gz`)) {
    return attempt(`BXSF`, () => parse_bxsf(content)) ?? fail()
  }

  if (lower_name.endsWith(`.frmsf`) || lower_name.endsWith(`.frmsf.gz`)) {
    return attempt(`FRMSF`, () => parse_frmsf(content)) ?? fail()
  }

  if (lower_name.endsWith(`.json`) || lower_name.endsWith(`.json.gz`)) {
    return attempt(`JSON`, () => parse_fermi_json(content)) ?? fail()
  }

  // Try auto-detection based on content
  const trimmed = content.trim()

  // BXSF format detection
  if (trimmed.includes(`BEGIN_BLOCK_BANDGRID_3D`) || trimmed.includes(`BEGIN_BANDGRID_3D`)) {
    const result = attempt(`BXSF`, () => parse_bxsf(content))
    if (result) return result
  }

  // JSON format detection
  if (trimmed.startsWith(`{`) || trimmed.startsWith(`[`)) {
    const result = attempt(`JSON`, () => parse_fermi_json(content))
    if (result) return result
  }

  // FRMSF format detection (starts with grid dimensions)
  const first_line = trimmed.split(/\r?\n/)[0]
  const first_tokens = first_line.split(/\s+/).filter(Boolean)
  if (first_tokens.length === 3 && first_tokens.every((token) => /^\d+$/.test(token))) {
    const result = attempt(`FRMSF`, () => parse_frmsf(content))
    if (result) return result
  }

  return fail()
}
