// Parsers for Fermi surface file formats (BXSF, FRMSF, JSON)
import type { Matrix3x3, Vec3 } from '$lib/math'
import * as constants from './constants'
import { compute_vertex_normals } from './marching-cubes'
import type {
  BandGridData,
  EnergyGrid5D,
  FermiSurfaceData,
  Isosurface,
  SpinChannel,
  SurfaceDimensionality,
} from './types'

// Parse whitespace-separated floats from a line (optimized with unary +)
function parse_floats(line: string): number[] {
  const parts = line.split(/\s+/)
  const result: number[] = []
  for (let idx = 0; idx < parts.length; idx++) {
    if (parts[idx]) result.push(+parts[idx])
  }
  return result
}

// Parse whitespace-separated integers from a line
function parse_ints(line: string): number[] {
  const parts = line.split(/\s+/)
  const result: number[] = []
  for (let idx = 0; idx < parts.length; idx++) {
    if (parts[idx]) result.push(parseInt(parts[idx], 10))
  }
  return result
}

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

  // Skip block identifier line (e.g., "band_energies")
  next_line()

  // Parse BEGIN_BANDGRID_3D or BANDGRID_3D_BANDS (both variants exist)
  const bandgrid_line = next_line()
  if (!bandgrid_line.includes(`BANDGRID_3D`)) {
    throw new Error(`Expected BANDGRID_3D header, got: ${bandgrid_line}`)
  }

  // Parse number of bands
  const n_bands = parseInt(next_line(), 10)
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

  // Parse band data
  // Format: BAND: band_number followed by energy values on grid
  const energies: EnergyGrid5D = [[]] // [spin=1][band][kx][ky][kz]
  const [nx, ny, nz] = k_grid
  const total_points = nx * ny * nz

  for (let band_idx = 0; band_idx < n_bands; band_idx++) {
    // Find BAND: line
    let band_line = next_line()
    while (!band_line.startsWith(`BAND:`)) {
      band_line = next_line()
    }

    // Read energy values for this band
    const energy_values: number[] = []
    while (energy_values.length < total_points) {
      const line = next_line()
      if (line.startsWith(`END_BANDGRID`) || line.startsWith(`BAND:`)) {
        // Unread this line: after next_line() returns, line_idx points past the
        // returned line, so decrementing by 1 restores to the line just read
        line_idx--
        break
      }
      energy_values.push(...parse_floats(line))
    }

    if (energy_values.length < total_points) {
      throw new Error(
        `Band ${band_idx}: expected ${total_points} values, got ${energy_values.length}`,
      )
    }

    // Reshape into 3D grid [kx][ky][kz] (preallocated for speed)
    const band_grid: number[][][] = new Array(nx)
    let val_idx = 0
    for (let ix = 0; ix < nx; ix++) {
      const iy_arr: number[][] = new Array(ny)
      for (let iy = 0; iy < ny; iy++) {
        const iz_arr = energy_values.slice(val_idx, val_idx + nz)
        val_idx += nz
        iy_arr[iy] = iz_arr
      }
      band_grid[ix] = iy_arr
    }
    energies[0].push(band_grid)
  }

  // Try to find Fermi energy (often in a comment or as FERMI_ENERGY keyword)
  let fermi_energy = 0
  for (const line of lines) {
    const lower = line.toLowerCase()
    if (lower.includes(`fermi`) && lower.includes(`energy`)) {
      // Match patterns like "Fermi Energy = 5.123" or "fermi_energy: -0.5"
      const match = line.match(/(?:=|:)\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i)
      if (match) {
        fermi_energy = parseFloat(match[1])
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
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
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
  const lshift = parseInt(lines[line_idx++], 10)
  if (isNaN(lshift) || lshift < 0 || lshift > 2) {
    throw new Error(`FRMSF: Invalid lshift value (expected 0, 1, or 2)`)
  }

  // Line 3: number of bands
  const n_bands = parseInt(lines[line_idx++], 10)
  if (isNaN(n_bands) || n_bands <= 0) {
    throw new Error(`FRMSF: Invalid number of bands`)
  }

  // FRMSF format has single spin channel (no spin-polarized support in standard format)
  const n_spins = 1

  // Lines 4-6: reciprocal lattice vectors (in Bohr^-1, convert to Å^-1)
  const inv_bohr = 1 / constants.BOHR_TO_ANGSTROM
  const k_lattice: Matrix3x3 = [
    parse_floats(lines[line_idx++]).slice(0, 3).map((val) => val * inv_bohr) as Vec3,
    parse_floats(lines[line_idx++]).slice(0, 3).map((val) => val * inv_bohr) as Vec3,
    parse_floats(lines[line_idx++]).slice(0, 3).map((val) => val * inv_bohr) as Vec3,
  ]

  const [nx, ny, nz] = k_grid
  const total_points = nx * ny * nz

  // Parse band energies for each spin and band
  // FRMSF format: one energy value per line per grid point. Any additional columns
  // (e.g., auxiliary color/velocity data) are ignored to prevent grid corruption.
  const energies: EnergyGrid5D = []
  for (let spin_idx = 0; spin_idx < n_spins; spin_idx++) {
    energies[spin_idx] = []
    for (let band_idx = 0; band_idx < n_bands; band_idx++) {
      const energy_values: number[] = []

      // Read energy values (first value per line only, ignore auxiliary columns)
      while (energy_values.length < total_points && line_idx < lines.length) {
        const line = lines[line_idx]
        const first_token = line?.split(/\s+/)[0]
        if (first_token && !isNaN(parseFloat(first_token))) {
          energy_values.push(parseFloat(first_token))
          line_idx++
        } else {
          break
        }
      }

      if (energy_values.length < total_points) {
        throw new Error(
          `FRMSF spin ${spin_idx} band ${band_idx}: expected ${total_points} values, got ${energy_values.length}`,
        )
      }

      // Reshape into 3D grid [kx][ky][kz]
      const band_grid: number[][][] = []
      let val_idx = 0
      for (let ix = 0; ix < nx; ix++) {
        band_grid[ix] = []
        for (let iy = 0; iy < ny; iy++) {
          band_grid[ix][iy] = []
          for (let iz = 0; iz < nz; iz++) {
            // FRMSF uses Hartree, convert to eV
            band_grid[ix][iy][iz] = energy_values[val_idx++] * constants.HARTREE_TO_EV
          }
        }
      }
      energies[spin_idx].push(band_grid)
    }
  }

  return {
    energies,
    k_grid,
    k_lattice,
    fermi_energy: 0, // FRMSF typically expects Fermi level at 0
    n_bands,
    n_spins,
  }
}

// Validate that an object has the required Isosurface shape
function is_valid_isosurface(obj: unknown): obj is Isosurface {
  if (!obj || typeof obj !== `object`) return false
  const iso = obj as Record<string, unknown>

  // Required array fields
  if (!Array.isArray(iso.vertices) || iso.vertices.length === 0) return false
  if (!Array.isArray(iso.faces)) return false
  if (!Array.isArray(iso.normals)) return false

  // Required scalar fields
  if (typeof iso.band_index !== `number`) return false
  if (iso.spin !== null && iso.spin !== `up` && iso.spin !== `down`) return false

  return true
}

// Validate FermiSurfaceData shape
function is_valid_fermi_surface_data(obj: unknown): obj is FermiSurfaceData {
  if (!obj || typeof obj !== `object`) return false
  const data = obj as Record<string, unknown>

  // Check required fields
  if (!Array.isArray(data.isosurfaces)) return false
  if (!Array.isArray(data.k_lattice) || data.k_lattice.length !== 3) return false
  if (typeof data.fermi_energy !== `number`) return false
  if (
    data.reciprocal_cell !== `wigner_seitz` && data.reciprocal_cell !== `parallelepiped`
  ) {
    return false
  }
  if (!data.metadata || typeof data.metadata !== `object`) return false

  // Validate each isosurface
  for (const iso of data.isosurfaces) {
    if (!is_valid_isosurface(iso)) return false
  }

  return true
}

// Parse Matterviz/IFermi JSON format for Fermi surface data
// Throws on invalid input; returns parsed data on success
function parse_fermi_json(
  content: string,
): FermiSurfaceData | BandGridData {
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
    data[`@class`] === `FermiSurface` && data.isosurfaces &&
    typeof data.isosurfaces === `object`
  ) {
    return parse_ifermi_surface(data)
  }

  // Check if it's BandGridData (raw grid data)
  if (data.energies && data.k_grid && data.k_lattice) {
    return data as BandGridData
  }

  // Try to extract from nested structure (e.g., IFermi output)
  if (data.fermi_surface) {
    return data.fermi_surface as FermiSurfaceData
  }

  if (data.band_structure?.energies || data.bands?.energies) {
    const bs = data.band_structure || data.bands
    return {
      energies: bs.energies,
      k_grid: bs.k_grid || bs.kgrid,
      k_lattice: bs.k_lattice || bs.reciprocal_lattice,
      fermi_energy: bs.fermi_energy || bs.efermi || 0,
      n_bands: bs.n_bands || bs.nbands || bs.energies[0]?.length || 0,
      n_spins: bs.n_spins || bs.nspins || bs.energies.length || 1,
    } as BandGridData
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

  throw new Error(
    `Unrecognized JSON format: missing required fields for Fermi surface data`,
  )
}

// Helper type for IFermi Isosurface format
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
  const reciprocal_space = data.reciprocal_space as {
    reciprocal_lattice?: number[][]
    vertices?: number[][]
    faces?: number[][]
  } | undefined

  // Extract reciprocal lattice
  const k_lattice: Matrix3x3 = reciprocal_space?.reciprocal_lattice
    ? (reciprocal_space.reciprocal_lattice as Matrix3x3)
    : [[1, 0, 0], [0, 1, 0], [0, 0, 1]]

  // Convert IFermi isosurfaces to our format
  const isosurfaces: Isosurface[] = []
  const band_indices = new Set<number>()
  let has_spin = false

  for (const [band_key, iso_list] of Object.entries(isosurfaces_obj)) {
    const band_index = parseInt(band_key, 10)
    // spin is determined by sign: positive = up, negative = down
    const spin: SpinChannel = band_index < 0 ? `down` : `up`
    const abs_band_idx = Math.abs(band_index)
    band_indices.add(abs_band_idx)
    if (band_index < 0) has_spin = true

    for (const ifermi_iso of iso_list) {
      const vertices = ifermi_iso.vertices as Vec3[]
      const faces = ifermi_iso.faces as number[][]

      // Compute vertex normals from faces
      const normals = compute_vertex_normals(vertices, faces)

      // Extract properties if available
      let properties: number[] | undefined
      if (ifermi_iso.properties) {
        // IFermi stores properties like fermi_velocity, spin, etc.
        const prop_keys = Object.keys(ifermi_iso.properties)
        if (prop_keys.length > 0) {
          // Use first available property as vertex colors
          properties = ifermi_iso.properties[prop_keys[0]]
        }
      }

      // Parse dimensionality
      let dimensionality: SurfaceDimensionality | undefined
      if (ifermi_iso.dimensionality) {
        const dim = ifermi_iso.dimensionality.toLowerCase()
        if (dim.includes(`1d`) || dim === `1d`) dimensionality = `1D`
        else if (dim.includes(`quasi`) || dim === `quasi-2d`) dimensionality = `quasi-2D`
        else if (dim.includes(`2d`) || dim === `2d`) dimensionality = `2D`
        else if (dim.includes(`3d`) || dim === `3d`) dimensionality = `3D`
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
          const e1: Vec3 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]]
          const e2: Vec3 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]]
          const cross: Vec3 = [
            e1[1] * e2[2] - e1[2] * e2[1],
            e1[2] * e2[0] - e1[0] * e2[2],
            e1[0] * e2[1] - e1[1] * e2[0],
          ]
          area += 0.5 * Math.sqrt(cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2)
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
  const total_area = isosurfaces.reduce((sum, iso) => sum + (iso.area || 0), 0)

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

// Auto-detect file format and parse accordingly
export function parse_fermi_file(
  content: string,
  filename?: string,
): BandGridData | FermiSurfaceData | null {
  const lower_name = filename?.toLowerCase() || ``

  // Detect by filename extension
  if (lower_name.endsWith(`.bxsf`) || lower_name.endsWith(`.bxsf.gz`)) {
    try {
      return parse_bxsf(content)
    } catch (error) {
      console.error(`BXSF parse error:`, error)
      return null
    }
  }

  if (lower_name.endsWith(`.frmsf`) || lower_name.endsWith(`.frmsf.gz`)) {
    try {
      return parse_frmsf(content)
    } catch (error) {
      console.error(`FRMSF parse error:`, error)
      return null
    }
  }

  if (lower_name.endsWith(`.json`) || lower_name.endsWith(`.json.gz`)) {
    try {
      return parse_fermi_json(content)
    } catch (error) {
      console.error(`JSON parse error:`, error)
      return null
    }
  }

  // Try auto-detection based on content
  const trimmed = content.trim()

  // BXSF format detection
  if (
    trimmed.includes(`BEGIN_BLOCK_BANDGRID_3D`) ||
    trimmed.includes(`BEGIN_BANDGRID_3D`)
  ) {
    try {
      return parse_bxsf(content)
    } catch (error) {
      console.error(`BXSF auto-detect parse error:`, error)
    }
  }

  // JSON format detection
  if (trimmed.startsWith(`{`) || trimmed.startsWith(`[`)) {
    try {
      return parse_fermi_json(content)
    } catch (error) {
      console.error(`JSON auto-detect parse error:`, error)
    }
  }

  // FRMSF format detection (starts with grid dimensions)
  const first_line = trimmed.split(/\r?\n/)[0]
  const first_tokens = first_line.split(/\s+/).filter(Boolean)
  if (
    first_tokens.length === 3 &&
    first_tokens.every((t) => /^\d+$/.test(t))
  ) {
    try {
      return parse_frmsf(content)
    } catch (error) {
      console.error(`FRMSF auto-detect parse error:`, error)
    }
  }

  console.warn(`Could not detect Fermi surface file format for: ${filename}`)
  return null
}
