// Type definitions and utilities for isosurface visualization (charge density, molecular orbitals, etc.)
import type { D3InterpolateName } from '$lib/colors'
import { strip_compression_extensions } from '$lib/io/decompress'
import type { Matrix3x3, Vec2, Vec3 } from '$lib/math'
import type { Crystal } from '$lib/structure'
import { flatten_grid, type ScalarGrid3D } from './grid'

// Precomputed statistics for a volumetric grid (min, max, abs_max, mean)
export type DataRange = { min: number; max: number; abs_max: number; mean: number }

// Volumetric scalar data on a 3D grid (e.g. charge density, electrostatic potential).
// Values are stored flat in C order (z fastest: index = (ix * ny + iy) * nz + iz) so the
// volume itself is a ScalarGrid3D that marching cubes and the geometry worker consume
// without copying. Parsers transpose Fortran-ordered sources (VASP) once at load time.
export interface VolumetricData extends ScalarGrid3D<Float64Array> {
  id: string // Stable field identity; independent of array order and display label
  order: `z_fastest`
  dims: Vec3 // [nx, ny, nz]
  lattice: Matrix3x3 // real-space lattice vectors (rows are a, b, c)
  origin: Vec3 // grid origin in the structure's Cartesian coordinate frame
  data_range: DataRange // precomputed min/max/mean statistics
  // Whether the grid has periodic boundary conditions (affects coordinate scaling).
  // Periodic grids (CHGCAR) span [0,1) with spacing 1/N; non-periodic (.cube molecular)
  // span [0,1] with spacing 1/(N-1).
  periodic: boolean
  label?: string // e.g. "charge density", "spin density", "orbital"
  // Stable identity of the file this volume came from (compression-stripped
  // filename). Reimporting the same source replaces its previous volumes.
  source?: string
  // Original filename including compression suffix, for picker/URL identity.
  source_filename?: string
}

// The geometric core of a VolumetricData: enough to sample, resample, and contour it.
// Also the structured-cloneable shape posted to the geometry worker.
export type VolumeGrid = Pick<
  VolumetricData,
  `values` | `dims` | `order` | `lattice` | `origin` | `periodic`
>

// Assemble a VolumetricData from flat values, computing data_range in the same pass
export function make_volume(
  values: Float64Array,
  dims: Vec3,
  fields: Omit<VolumetricData, `values` | `dims` | `order` | `data_range`>,
): VolumetricData {
  if (!fields.id?.trim()) throw new TypeError(`Volume id must be a nonempty string`)
  const expected = dims[0] * dims[1] * dims[2]
  if (values.length !== expected) {
    throw new RangeError(
      `Volume values length ${values.length} does not match dims ${dims.join(`×`)} (${expected})`,
    )
  }
  return { values, dims, order: `z_fastest`, data_range: grid_data_range(values), ...fields }
}

// Coerce a JSON/IPC payload (pymatviz widget traits, dropped .json files) into a
// VolumetricData. Accepts flat `values` (typed array or number[]) with `dims`, or the
// nested `grid` [x][y][z] encoding JSON producers emit, and recomputes data_range.
export function volume_from_json(raw: unknown): VolumetricData {
  if (typeof raw !== `object` || raw === null) {
    throw new TypeError(`Volumetric data must be an object, got ${typeof raw}`)
  }
  const data = raw as Record<string, unknown>
  const is_vec3 = (value: unknown): value is Vec3 =>
    Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
  const is_matrix = (value: unknown): value is Matrix3x3 =>
    Array.isArray(value) && value.length === 3 && value.every(is_vec3)
  if (!is_matrix(data.lattice)) throw new TypeError(`Volumetric data needs a 3x3 lattice`)
  if (!is_vec3(data.origin)) throw new TypeError(`Volumetric data needs a Vec3 origin`)
  if (typeof data.periodic !== `boolean`) {
    throw new TypeError(`Volumetric data needs a boolean periodic flag`)
  }

  let grid: ScalarGrid3D<Float64Array>
  if (Array.isArray(data.grid)) {
    grid = flatten_grid(data.grid as number[][][])
  } else if (data.values !== undefined) {
    const { dims } = data
    if (!is_vec3(dims)) throw new TypeError(`Volumetric data with flat values needs dims`)
    const values =
      data.values instanceof Float64Array
        ? data.values
        : Float64Array.from(data.values as ArrayLike<number>)
    grid = { values, dims: [...dims], order: `z_fastest` }
  } else {
    throw new TypeError(`Volumetric data needs a nested grid or flat values + dims`)
  }
  const optional = (key: `label` | `source` | `source_filename`) =>
    typeof data[key] === `string` ? { [key]: data[key] } : {}
  return make_volume(grid.values, grid.dims, {
    id: typeof data.id === `string` ? data.id : ``,
    lattice: data.lattice,
    origin: data.origin,
    periodic: data.periodic,
    ...optional(`label`),
    ...optional(`source`),
    ...optional(`source_filename`),
  })
}

// Validate the registry once and resolve every reference by stable field identity.
export function index_volumes(
  volumes: readonly VolumetricData[],
): Map<string, VolumetricData> {
  const indexed = new Map<string, VolumetricData>()
  for (const volume of volumes) {
    if (typeof volume.id !== `string` || !volume.id.trim())
      throw new TypeError(`Volume id must be a nonempty string`)
    if (indexed.has(volume.id)) throw new Error(`Duplicate volume id: ${volume.id}`)
    indexed.set(volume.id, volume)
  }
  return indexed
}

export const normalize_active_volume_id = (
  active_volume_id: string | undefined,
  volumes: readonly VolumetricData[],
): string | undefined =>
  volumes.some(({ id }) => id === active_volume_id) ? active_volume_id : volumes[0]?.id

// Result of parsing a volumetric file (contains both structure and volumetric data)
export interface VolumetricFileData {
  structure: Crystal
  volumes: VolumetricData[] // one or more volumes (e.g. total + magnetization for spin-polarized)
}

// A single isosurface layer at a specific isovalue with its own appearance.
// Layers reference stable volume IDs: `volume_id`
// picks the geometry source (marching cubes input) and `color_volume_id`
// optionally picks a different volume whose scalar field is sampled at surface
// vertices to drive a colormap (e.g. density surface colored by ESP).
export interface IsosurfaceLayer {
  isovalue: number
  color: string
  opacity: number
  visible: boolean
  // When true, also render the -isovalue surface in `negative_color`
  show_negative: boolean
  negative_color: string
  // Geometry-source volume ID
  volume_id: string
  // Scalar-color-source volume ID; unset preserves solid-color behavior
  color_volume_id?: string
  // Continuous colormap applied to sampled scalars (default interpolateViridis)
  colormap?: D3InterpolateName
  // Scalar range mapped onto the colormap; inverted [max, min] flips the map.
  // When unset, the renderer auto-fits the range to the values sampled on the
  // surface (symmetric about zero for signed fields).
  color_range?: Vec2
}

// Isosurface rendering settings: every rendered surface is an explicit layer (an empty
// `layers` array renders nothing), plus options shared by all layers.
export interface IsosurfaceSettings {
  layers: IsosurfaceLayer[]
  wireframe: boolean
  halo: number // fraction of cell to extend isosurface beyond boundaries (0 = clip at cell edge, 0.5 = half cell)
  // Fractional display range per lattice axis for periodic volumes, VESTA-style:
  // e.g. [[-0.15, 2.15], [-0.15, 2.15], [0, 1]] repeats surfaces periodically and
  // clips them exactly at the fractional bounds. Unset = follow the structure's
  // integer supercell. Independent of the atom supercell, so structure, surface,
  // and cell outline remain separately controllable.
  display_range?: [Vec2, Vec2, Vec2]
}

// Categorical palette for auto-coloring isosurface layers (Tailwind-inspired)
export const LAYER_COLORS = [
  `#3b82f6`, // blue
  `#ef4444`, // red
  `#22c55e`, // green
  `#a855f7`, // purple
  `#f97316`, // orange
  `#06b6d4`, // cyan
  `#eab308`, // yellow
  `#ec4899`, // pink
] as const

// Compute min/max/abs_max/mean of flat grid values in one pass.
// Prefer the precomputed `data_range` field on VolumetricData when available.
export function grid_data_range(values: ArrayLike<number>): DataRange {
  const count = values.length
  if (count === 0) return { min: 0, max: 0, abs_max: 0, mean: 0 }
  let [min_val, max_val, sum] = [Infinity, -Infinity, 0]
  for (let idx = 0; idx < count; idx++) {
    const val = values[idx]
    if (val < min_val) min_val = val
    if (val > max_val) max_val = val
    sum += val
  }
  const abs_max = Math.max(Math.abs(min_val), Math.abs(max_val))
  return { min: min_val, max: max_val, abs_max, mean: sum / count }
}

// Max total grid points the geometry grid is resampled down to for isosurface extraction.
// 500K balances visual quality with interactive performance (<200ms marching cubes).
export const MAX_GRID_POINTS = 500_000

// Default isosurface rendering settings (no layers: nothing renders until a volume adds one)
export const DEFAULT_ISOSURFACE_SETTINGS: IsosurfaceSettings = {
  layers: [],
  wireframe: false,
  halo: 0,
}

// [isovalue fraction of abs_max, opacity] for the nth shell auto-added to one volume. Shell 0
// is the usual 20% envelope; each further "+" steps through the 0.8 → 0.1 ladder
// (alternating inner/outer so consecutive shells never coincide), inner high-isovalue shells
// more opaque than the outer ones around them so every shell stays visible. Cycles past 6.
export const SHELL_STEPS: readonly (readonly [fraction: number, opacity: number])[] = [
  [0.2, 0.6],
  [0.8, 0.8],
  [0.5, 0.7],
  [0.1, 0.3],
  [0.65, 0.75],
  [0.35, 0.65],
]

// Build a default isosurface layer for a volume: the `shell_idx`th SHELL_STEPS entry (20% of
// abs_max at opacity 0.6 for the first surface), next unused palette color (the negative lobe
// takes the swatch after it) and the negative lobe enabled when the field is signed.
// `shell_idx` is how many layers the volume already has, so repeated "+" clicks add
// distinguishable shells instead of coincident copies.
export const auto_volume_layer = (
  volume: VolumetricData,
  color_offset = 0,
  shell_idx = 0,
): IsosurfaceLayer => {
  const { min, abs_max } = volume.data_range
  const [fraction, opacity] = SHELL_STEPS[shell_idx % SHELL_STEPS.length]
  return {
    // all-zero grids fall back to a small positive isovalue so controls stay usable
    isovalue: abs_max > 0 ? abs_max * fraction : 0.05,
    color: LAYER_COLORS[color_offset % LAYER_COLORS.length],
    opacity,
    visible: true,
    show_negative: min < -abs_max * 0.01,
    negative_color: LAYER_COLORS[(color_offset + 1) % LAYER_COLORS.length],
    volume_id: volume.id,
  }
}

// Settings for a freshly loaded file: one auto layer on its first volume (further volumes of
// the same file, e.g. a CHGCAR's magnetization block, stay available as colour sources or
// for manually added surfaces)
export const auto_isosurface_settings = (volume: VolumetricData): IsosurfaceSettings => ({
  ...DEFAULT_ISOSURFACE_SETTINGS,
  layers: [auto_volume_layer(volume)],
})

// Drop missing geometry sources and clear missing scalar-color sources without retargeting.
export const retain_volume_layers = (
  layers: IsosurfaceLayer[],
  volumes: ReadonlyMap<string, VolumetricData>,
): IsosurfaceLayer[] =>
  layers
    .filter((layer) => volumes.has(layer.volume_id))
    .map((layer) =>
      layer.color_volume_id !== undefined && !volumes.has(layer.color_volume_id)
        ? { ...layer, color_volume_id: undefined }
        : layer,
    )

export function remove_volume(
  volumes: VolumetricData[],
  layers: IsosurfaceLayer[],
  removed_id: string,
): { volumes: VolumetricData[]; layers: IsosurfaceLayer[] } {
  const retained = volumes.filter(({ id }) => id !== removed_id)
  return { volumes: retained, layers: retain_volume_layers(layers, index_volumes(retained)) }
}

// Label volumes parsed from a file with a stable `source` id (compression-
// stripped filename) and a display label (multi-block files like spin-polarized
// CHGCAR get "<file>: <block label>" labels).
export function label_file_volumes(
  volumes: VolumetricData[],
  filename: string,
  source_filename = filename,
): VolumetricData[] {
  // Case-preserving: this is a display label, so `CHGCAR.zip` must not become `chgcar`
  const source = strip_compression_extensions(filename, { lowercase: false })
  return volumes.map((vol, idx) => ({
    ...vol,
    id: JSON.stringify([source, vol.id]),
    source,
    source_filename,
    label: volumes.length > 1 ? `${source}: ${vol.label ?? idx + 1}` : source,
  }))
}

// A source publication replaces matching IDs and removes fields that disappeared.
// Surviving fields retain all user layers, including an intentionally empty set.
export function merge_imported_volumes(
  existing: VolumetricData[],
  existing_layers: IsosurfaceLayer[],
  incoming: VolumetricData[],
) {
  const previous = index_volumes(existing)
  const replacements = index_volumes(incoming)
  const sources = new Set(
    incoming.flatMap(({ source }) => (source === undefined ? [] : [source])),
  )
  const volumes = existing.flatMap((volume) => {
    const replacement = replacements.get(volume.id)
    if (replacement) return [replacement]
    return volume.source !== undefined && sources.has(volume.source) ? [] : [volume]
  })
  const added = incoming.filter(({ id }) => !previous.has(id))
  volumes.push(...added)
  const layers = retain_volume_layers(existing_layers, index_volumes(volumes))
  for (const volume of added) layers.push(auto_volume_layer(volume, layers.length))
  return { volumes, layers, n_added: added.length }
}
