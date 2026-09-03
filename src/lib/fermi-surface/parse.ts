// Parsers for Fermi surface file formats (BXSF, FRMSF, JSON)
import { BOHR_TO_ANGSTROM, HARTREE_TO_EV } from '$lib/constants'
import { checked_grid_points, parse_float_block } from '$lib/isosurface/parse'
import { flatten_grid } from '$lib/isosurface/grid'
import { compute_vertex_normals } from '$lib/marching-cubes'
import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import { read_text_line } from '$lib/structure/parsers/vasp-header'
import { is_plain_object, normalize_scientific_notation, to_error } from '$lib/utils'
import type {
  BandEnergyGrid,
  BandGridData,
  FermiSurfaceData,
  FermiIsosurface,
  SpinChannel,
} from './types'

// Parse whitespace-separated floats from a line. Normalizes Fortran D-exponents
// (`0.1234D+01`) which Fortran codes emit in BXSF/FRMSF and Number() rejects
const parse_floats = (line: string): number[] =>
  normalize_scientific_notation(line).split(/\s+/).filter(Boolean).map(Number)

// Parse whitespace-separated integers from a line
const parse_ints = (line: string): number[] =>
  line
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => Math.trunc(Number(part)))

const make_band_grid = (values: Float64Array, dims: Vec3): BandEnergyGrid => ({
  values,
  dims,
  order: `z_fastest`,
})

// Cursor over the text that hands out trimmed non-empty (optionally non-comment) lines
// without splitting the whole file — BXSF/FRMSF bodies are hundreds of thousands of lines
function line_reader(content: string, start = 0) {
  let pos = start
  return {
    position: () => pos,
    seek: (next: number) => (pos = next),
    // Next trimmed non-empty line, skipping `#` comments; throws at end of input
    next: (): string => {
      while (pos < content.length) {
        const { line, next } = read_text_line(content, pos)
        pos = next
        const trimmed = line.trim()
        if (trimmed && !trimmed.startsWith(`#`)) return trimmed
      }
      throw new Error(`Unexpected end of file`)
    },
  }
}

// Parse BXSF (Band-XSF) format used by XCrySDen, Quantum ESPRESSO, etc.
// Format specification: http://www.xcrysden.org/doc/XSF.html
function parse_bxsf(content: string): BandGridData {
  const block_start = content.indexOf(`BEGIN_BLOCK_BANDGRID_3D`)
  if (block_start === -1) throw new Error(`BXSF file missing BEGIN_BLOCK_BANDGRID_3D`)

  // The Fermi energy lives in the header (BEGIN_INFO block or a comment) before the band
  // grid, e.g. "Fermi Energy: 19.0343" — only that slice is scanned, not the data body
  const fermi_match =
    /fermi[\s_]*energy[^\n=:]*(?:=|:)\s*(?<value>[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i.exec(
      content.slice(0, block_start),
    )
  const fermi_energy = Number(fermi_match?.groups?.value ?? 0)

  const reader = line_reader(content, block_start)
  reader.next() // BEGIN_BLOCK_BANDGRID_3D
  reader.next() // block identifier (e.g. "band_energies")

  // BEGIN_BANDGRID_3D or BANDGRID_3D_BANDS (both variants exist)
  const bandgrid_line = reader.next()
  if (!bandgrid_line.includes(`BANDGRID_3D`)) {
    throw new Error(`Expected BANDGRID_3D header, got: ${bandgrid_line}`)
  }

  const n_bands = Math.trunc(Number(reader.next()))
  if (!Number.isFinite(n_bands) || n_bands <= 0) {
    throw new Error(`Invalid number of bands in BXSF file`)
  }

  const grid_dims = parse_ints(reader.next())
  if (grid_dims.length !== 3) {
    throw new Error(`Expected 3 grid dimensions, got ${grid_dims.length}`)
  }
  const k_grid: Vec3 = [grid_dims[0], grid_dims[1], grid_dims[2]]

  const origin_vals = parse_floats(reader.next())
  if (origin_vals.length !== 3) {
    throw new Error(`Expected 3 origin values, got ${origin_vals.length}`)
  }
  // The origin was never applied: extract_fermi_surface re-centres on Γ unconditionally, so a
  // header encoding that shift would apply it twice, landing the surface a half-diagonal off.
  // Negated comparison, so NaN and Infinity are rejected too (NaN > 1e-8 is false)
  if (!origin_vals.every((val) => Math.abs(val) <= 1e-8)) {
    throw new Error(
      `BXSF grid origin [${origin_vals.join(`, `)}] is not supported: only Γ-centred grids ` +
        `(origin 0 0 0) can be rendered, since the surface is re-centred on Γ internally.`,
    )
  }

  // 3 spanning vectors (reciprocal lattice)
  const spanning_vectors = [0, 1, 2].map(() => parse_floats(reader.next()).slice(0, 3))
  if (spanning_vectors.some((vec) => vec.length !== 3 || vec.some(Number.isNaN))) {
    throw new Error(`Invalid spanning vector in BXSF file`)
  }

  // Band data: "BAND: n" followed by energies in z-fastest order, which is exactly the flat
  // BandEnergyGrid layout. parse_float_block reads the numbers straight off the string and
  // stops at the next line starting with a letter (the next BAND: or END_BANDGRID_3D).
  const energies: BandEnergyGrid[][] = [[]] // [spin=1][band]
  const total_points = checked_grid_points(
    k_grid,
    content.length - reader.position(),
    `BXSF`,
    n_bands,
  )

  for (let band_idx = 0; band_idx < n_bands; band_idx++) {
    let band_line = reader.next()
    while (!band_line.startsWith(`BAND:`)) band_line = reader.next()

    const energy_values = new Float64Array(total_points)
    const { count, end_pos } = parse_float_block(
      content,
      reader.position(),
      total_points,
      energy_values,
    )
    reader.seek(end_pos)
    if (count < total_points) {
      throw new Error(`Band ${band_idx}: expected ${total_points} values, got ${count}`)
    }
    energies[0].push(make_band_grid(energy_values, k_grid))
  }

  return {
    energies,
    k_grid,
    k_lattice: spanning_vectors as Matrix3x3,
    fermi_energy,
    n_bands,
    n_spins: 1,
  }
}

// Parse FRMSF format used by FermiSurfer
// Format: https://mitsuaki1987.github.io/fermisurfer/en/_build/html/ops.html
function parse_frmsf(content: string): BandGridData {
  const reader = line_reader(content)

  // Line 1: grid dimensions (ng[0] ng[1] ng[2])
  const grid_dims = parse_ints(reader.next())
  if (grid_dims.length !== 3) throw new Error(`FRMSF: Expected 3 grid dimensions`)
  const k_grid: Vec3 = [grid_dims[0], grid_dims[1], grid_dims[2]]

  // Line 2: lshift. lshift=1 is Γ-centred (point i at i/n), lshift=2 is Γ + half step
  // ((i + ½)/n). lshift=0 is a Monkhorst-Pack mesh whose file order starts at the most
  // negative k: point i sits at (2i − n + 1)/(2n) = (i + ½)/n − ½ for any n (FermiSurfer's
  // read_file.cpp rotates the indices by ⌊(n+1)/2⌋ and adds ((n+1) mod 2)/(2n), which is the
  // same position modulo a reciprocal lattice vector), so its shift is also ½.
  const lshift = Math.trunc(Number(reader.next()))
  if (![0, 1, 2].includes(lshift)) {
    throw new Error(`FRMSF: Invalid lshift value ${lshift} (expected 0, 1, or 2)`)
  }
  const grid_shift: Vec3 = lshift === 1 ? [0, 0, 0] : [0.5, 0.5, 0.5]

  // Line 3: number of bands
  const n_bands = Math.trunc(Number(reader.next()))
  if (!Number.isFinite(n_bands) || n_bands <= 0) {
    throw new Error(`FRMSF: Invalid number of bands`)
  }

  // Lines 4-6: reciprocal lattice vectors (in Bohr^-1, convert to Å^-1)
  const inv_bohr = 1 / BOHR_TO_ANGSTROM
  const k_lattice = [0, 1, 2].map(() =>
    parse_floats(reader.next())
      .slice(0, 3)
      .map((val) => val * inv_bohr),
  ) as Matrix3x3
  if (k_lattice.some((row) => row.length !== 3 || row.some(Number.isNaN))) {
    throw new Error(`FRMSF: Invalid reciprocal lattice vector`)
  }

  // Band energies, one per line in z-fastest order (trailing columns such as FermiSurfer's
  // auxiliary colour data are dropped), converted from Hartree to eV. FRMSF has a single spin
  // channel (no spin-polarized support in the standard format).
  const total_points = checked_grid_points(
    k_grid,
    content.length - reader.position(),
    `FRMSF`,
    n_bands,
  )
  const energies: BandEnergyGrid[][] = [[]]
  for (let band_idx = 0; band_idx < n_bands; band_idx++) {
    const energy_values = new Float64Array(total_points)
    const { count, end_pos } = parse_float_block(
      content,
      reader.position(),
      total_points,
      energy_values,
      0,
      true,
    )
    reader.seek(end_pos)
    if (count < total_points) {
      throw new Error(`FRMSF band ${band_idx}: expected ${total_points} values, got ${count}`)
    }
    for (let idx = 0; idx < total_points; idx++) energy_values[idx] *= HARTREE_TO_EV
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
    grid_shift,
  }
}

// === JSON ===

// Mesh fields as JSON producers (IFermi, pymatviz, our own exports) emit them
interface JsonMesh {
  vertices: number[][]
  faces: number[][]
  normals?: number[][]
  properties?: number[]
}

const is_number_rows = (value: unknown, width: number): value is number[][] =>
  Array.isArray(value) &&
  value.every(
    (row) => Array.isArray(row) && row.length === width && row.every(Number.isFinite),
  )

// Pack a JSON mesh into typed arrays: xyz vertices flatten to Float32 positions, faces (any
// polygon size) fan-triangulate into a Uint32 index, normals are taken when present for
// every vertex and recomputed otherwise. Faces referencing missing vertices throw.
function isosurface_from_json(
  mesh: JsonMesh,
  band_index: number,
  spin: SpinChannel,
): FermiIsosurface {
  const { vertices, faces } = mesh
  const n_vertices = vertices.length
  const positions = new Float32Array(3 * n_vertices)
  for (let idx = 0; idx < n_vertices; idx++) positions.set(vertices[idx], 3 * idx)

  let n_triangles = 0
  for (const face of faces) n_triangles += Math.max(face.length - 2, 0)
  const indices = new Uint32Array(3 * n_triangles)
  let n_indices = 0
  for (const face of faces) {
    for (const idx of face) {
      if (!Number.isInteger(idx) || idx < 0 || idx >= n_vertices) {
        throw new RangeError(`Face references vertex ${idx} of a ${n_vertices}-vertex mesh`)
      }
    }
    // Fan triangulation: (0,1,2), (0,2,3), ...
    for (let fan_idx = 1; fan_idx < face.length - 1; fan_idx++) {
      indices[n_indices++] = face[0]
      indices[n_indices++] = face[fan_idx]
      indices[n_indices++] = face[fan_idx + 1]
    }
  }

  const normals =
    mesh.normals?.length === n_vertices
      ? Float32Array.from(mesh.normals.flat())
      : compute_vertex_normals(positions, indices)
  const properties =
    mesh.properties?.length === n_vertices ? Float32Array.from(mesh.properties) : undefined

  return { positions, indices, normals, properties, band_index, spin }
}

// Validate that an object has the JSON FermiIsosurface shape
function is_valid_json_isosurface(obj: unknown): obj is JsonIsosurface {
  if (!is_plain_object(obj)) return false
  const { vertices, faces, band_index, spin } = obj
  if (!is_number_rows(vertices, 3) || vertices.length === 0) return false
  if (!Array.isArray(faces)) return false
  if (typeof band_index !== `number` || !Number.isFinite(band_index)) return false
  return spin === null || spin === `up` || spin === `down`
}

// FermiSurfaceData as it appears in JSON: same fields with plain-array meshes
export type JsonIsosurface = JsonMesh & { band_index: number; spin: SpinChannel }
export type FermiSurfaceJson = Omit<FermiSurfaceData, `isosurfaces`> & {
  isosurfaces: JsonIsosurface[]
}

function is_valid_fermi_surface_json(obj: unknown): obj is FermiSurfaceJson {
  if (!is_plain_object(obj)) return false
  if (!Array.isArray(obj.isosurfaces)) return false
  if (!math.is_square_matrix(obj.k_lattice, 3)) return false
  if (typeof obj.fermi_energy !== `number`) return false
  if (obj.reciprocal_cell !== `wigner_seitz` && obj.reciprocal_cell !== `parallelepiped`) {
    return false
  }
  if (!is_plain_object(obj.metadata)) return false
  return obj.isosurfaces.every(is_valid_json_isosurface)
}

const fermi_surface_from_json = (json: FermiSurfaceJson): FermiSurfaceData => ({
  ...json,
  isosurfaces: json.isosurfaces.map((iso) =>
    isosurface_from_json(iso, iso.band_index, iso.spin),
  ),
})

// BandGridData as it appears in JSON: energies are nested [spin][band][kx][ky][kz] arrays
export type BandGridJson = Omit<BandGridData, `energies`> & { energies: number[][][][][] }

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
// matches k_grid (a ragged or mis-sized band would otherwise read garbage in marching cubes).
// `source` names the offending input in the error for a malformed shape.
function band_grid_from_json(json: unknown, source: string): BandGridData {
  if (!is_valid_band_grid_json(json)) {
    throw new Error(
      `Invalid ${source}: expected non-empty 'energies' grid, 3 'k_grid' dims, and 3x3 'k_lattice'`,
    )
  }
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
  const data: unknown = JSON.parse(content)
  if (!is_plain_object(data)) throw new Error(`Unrecognized JSON format: expected an object`)
  return fermi_data_from_json(data)
}

// Typed-array FermiSurfaceData (every sheet already a packed mesh; an empty surface counts)
const is_typed_fermi_surface = (data: unknown): data is FermiSurfaceData =>
  is_plain_object(data) &&
  Array.isArray(data.isosurfaces) &&
  data.isosurfaces.every(
    (iso) => is_plain_object(iso) && iso.positions instanceof Float32Array,
  )

// Typed BandGridData: every band is a flat ScalarGrid3D rather than a nested JSON grid
const is_typed_band_grid = (data: unknown): data is BandGridData =>
  is_plain_object(data) &&
  Array.isArray(data.energies) &&
  data.energies.length > 0 &&
  data.energies.every(
    (bands) =>
      Array.isArray(bands) &&
      bands.every((band) => is_plain_object(band) && band.values instanceof Float64Array),
  )

// Bring a `fermi_data` prop into the typed-array form the renderer consumes. Typed data passes
// through untouched (identity preserved); the JSON mesh form (`vertices`/`faces`/`normals`
// rows as IFermi's `as_dict()` and pymatviz's `FermiSurfaceWidget(fermi_data=...)` emit,
// which can only travel as JSON) is packed into typed arrays. Throws on anything else.
export function normalize_fermi_surface(
  data: FermiSurfaceData | FermiSurfaceJson | Record<string, unknown>,
): FermiSurfaceData {
  if (is_typed_fermi_surface(data)) return data
  const parsed = fermi_data_from_json(data)
  if (!(`isosurfaces` in parsed)) {
    throw new Error(`fermi_data holds a band grid, pass it as band_data instead`)
  }
  return parsed
}

// Same for a `band_data` prop: flat Float64Array grids pass through, nested JSON
// [spin][band][kx][ky][kz] energies are flattened and shape-checked against k_grid
export function normalize_band_grid(
  data: BandGridData | BandGridJson | Record<string, unknown>,
): BandGridData {
  return is_typed_band_grid(data) ? data : band_grid_from_json(data, `band_data`)
}

// Route an already-parsed JSON object to the matching Fermi surface / band grid shape
function fermi_data_from_json(data: Record<string, unknown>): FermiSurfaceData | BandGridData {
  // Check if it's already in our FermiSurfaceData format with full validation
  if (data.isosurfaces && Array.isArray(data.isosurfaces)) {
    if (is_valid_fermi_surface_json(data)) return fermi_surface_from_json(data)
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
    return band_grid_from_json(data, `BandGridData JSON`)
  }

  // Try to extract from nested structure (e.g. IFermi output)
  if (data.fermi_surface) {
    if (!is_valid_fermi_surface_json(data.fermi_surface)) {
      throw new Error(
        `Invalid nested 'fermi_surface' JSON: expected isosurfaces array, 3x3 k_lattice, numeric fermi_energy, reciprocal_cell, and metadata`,
      )
    }
    return fermi_surface_from_json(data.fermi_surface)
  }

  const bs = [data.band_structure, data.bands].find(
    (cand): cand is Record<string, unknown> & { energies: unknown[] } =>
      is_plain_object(cand) && Array.isArray(cand.energies),
  )
  if (bs) {
    const first_spin = bs.energies[0]
    return band_grid_from_json(
      {
        energies: bs.energies,
        k_grid: bs.k_grid ?? bs.kgrid,
        k_lattice: bs.k_lattice ?? bs.reciprocal_lattice,
        fermi_energy: bs.fermi_energy ?? bs.efermi ?? 0,
        n_bands:
          first_nonzero(
            bs.n_bands,
            bs.nbands,
            Array.isArray(first_spin) ? first_spin.length : undefined,
          ) ?? 0,
        n_spins: first_nonzero(bs.n_spins, bs.nspins, bs.energies.length) ?? 1,
      },
      `band_structure JSON`,
    )
  }

  // Check for pymatgen BandStructure format (k-path, not k-grid)
  // These files cannot be used for Fermi surface visualization directly
  const bs_class = is_plain_object(data.bs) ? data.bs[`@class`] : undefined
  if (bs_class === `BandStructure` || data[`@class`] === `BandStructure`) {
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
}

// Parse IFermi's JSON output format
function parse_ifermi_surface(data: Record<string, unknown>): FermiSurfaceData {
  const isosurfaces_obj = data.isosurfaces as Record<string, IFermiIsosurface[]>
  const reciprocal_space = data.reciprocal_space as
    | { reciprocal_lattice?: number[][] }
    | undefined

  const k_lattice: Matrix3x3 = reciprocal_space?.reciprocal_lattice
    ? (reciprocal_space.reciprocal_lattice as Matrix3x3)
    : [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ]

  const isosurfaces: FermiIsosurface[] = []
  const band_indices = new Set<number>()

  for (const [band_key, iso_list] of Object.entries(isosurfaces_obj)) {
    const band_index = Math.trunc(Number(band_key))
    // spin is determined by sign: positive = up, negative = down
    const spin: SpinChannel = band_index < 0 ? `down` : `up`
    const abs_band_idx = Math.abs(band_index)
    band_indices.add(abs_band_idx)

    for (const ifermi_iso of iso_list) {
      // IFermi stores properties like fermi_velocity, spin, etc.; the first one colours the mesh
      const properties = Object.values(ifermi_iso.properties ?? {})[0]
      isosurfaces.push(isosurface_from_json({ ...ifermi_iso, properties }, abs_band_idx, spin))
    }
  }

  return {
    isosurfaces,
    k_lattice,
    fermi_energy: 0, // IFermi surfaces are typically relative to Fermi level
    reciprocal_cell: `wigner_seitz`, // IFermi typically uses Wigner-Seitz cells
    metadata: {
      n_bands: band_indices.size,
      n_surfaces: isosurfaces.length,
      source_format: `ifermi-json`,
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
