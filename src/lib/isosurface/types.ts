// Type definitions and utilities for isosurface visualization (charge density, molecular orbitals, etc.)
import type { ColorScale } from '#lib/plot/core/types.js'
import { strip_compression_extensions } from '#lib/io/decompress.js'
import { format_num, zero_if_negligible } from '#lib/labels.js'
import type { Matrix3x3, Vec2, Vec3 } from '#lib/math.js'
import { is_finite_matrix3x3, is_finite_vec3 } from '#lib/math.js'
import type { Crystal } from '#lib/structure/index.js'
import { flatten_grid, type ScalarGrid3D } from './grid'

// Precomputed statistics for a volumetric grid (min, max, abs_max, mean)
export type DataRange = { min: number; max: number; abs_max: number; mean: number }

// A grid value at 3 significant digits, negligible ones (vacuum density ~1e-125) as 0
export const format_data_value = (
  value: number,
  { abs_max }: Pick<DataRange, `abs_max`>,
): string => format_num(zero_if_negligible(value, abs_max), `.3~g`)

// Volumetric scalar data on a 3D grid (charge density, potential, ...), flat in C order
// (index = (ix * ny + iy) * nz + iz), so the volume itself is a ScalarGrid3D marching cubes
// and the geometry worker consume without copying. Parsers transpose Fortran (VASP) order.
export interface VolumetricData extends ScalarGrid3D<Float64Array> {
  id: string // Stable field identity; independent of array order and display label
  order: `z_fastest`
  dims: Vec3 // [nx, ny, nz]
  lattice: Matrix3x3 // real-space lattice vectors (rows are a, b, c)
  origin: Vec3 // grid origin in the structure's Cartesian coordinate frame
  data_range: DataRange // precomputed min/max/mean statistics
  // Periodic grids (CHGCAR) span [0,1) with spacing 1/N; finite ones (molecular .cube) span
  // [0,1] with spacing 1/(N-1)
  periodic: boolean
  label?: string // e.g. "charge density", "spin density", "orbital"
  // Compression-stripped source filename; reimporting a source replaces its volumes
  source?: string
  source_filename?: string // with compression suffix, for picker/URL identity
  // Whether negative values are physical (magnetization, orbital, potential) and get a default
  // negative lobe; false for non-negative fields with numerical artifacts (electron density).
  // Unset infers it from the data.
  signed?: boolean
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
  // Checked first: dims [-2, -2, 2] or [2.5, 2, 2] multiply out to a plausible length
  if (!dims.every((count) => Number.isSafeInteger(count) && count >= 0)) {
    throw new RangeError(`Volume dims must be non-negative integers, got ${dims.join(`×`)}`)
  }
  const expected = dims[0] * dims[1] * dims[2]
  if (values.length !== expected) {
    throw new RangeError(
      `Volume values length ${values.length} does not match dims ${dims.join(`×`)} (${expected})`,
    )
  }
  return { values, dims, order: `z_fastest`, data_range: grid_data_range(values), ...fields }
}

// Coerce a JSON/IPC payload (pymatviz widget traits, dropped .json) into a VolumetricData:
// flat `values` (typed array or number[]) with `dims`, or a nested [x][y][z] `grid`
export function volume_from_json(raw: unknown): VolumetricData {
  if (typeof raw !== `object` || raw === null) {
    throw new TypeError(`Volumetric data must be an object, got ${typeof raw}`)
  }
  const data = raw as Record<string, unknown>
  if (!is_finite_matrix3x3(data.lattice))
    throw new TypeError(`Volumetric data needs a 3x3 lattice`)
  if (!is_finite_vec3(data.origin)) throw new TypeError(`Volumetric data needs a Vec3 origin`)
  if (typeof data.periodic !== `boolean`) {
    throw new TypeError(`Volumetric data needs a boolean periodic flag`)
  }

  let grid: ScalarGrid3D<Float64Array>
  if (Array.isArray(data.grid)) {
    grid = flatten_grid(data.grid as number[][][])
  } else if (data.values !== undefined) {
    const { dims } = data
    if (!is_finite_vec3(dims))
      throw new TypeError(`Volumetric data with flat values needs dims`)
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
  if (data.signed !== undefined && typeof data.signed !== `boolean`)
    throw new TypeError(
      `Volumetric data signed flag must be a boolean, got ${JSON.stringify(data.signed)}`,
    )
  return make_volume(grid.values, grid.dims, {
    id: typeof data.id === `string` ? data.id : ``,
    lattice: data.lattice,
    origin: data.origin,
    periodic: data.periodic,
    ...optional(`label`),
    ...optional(`source`),
    ...optional(`source_filename`),
    ...(data.signed === undefined ? {} : { signed: data.signed }),
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
  volumes.some(({ id: identifier }) => identifier === active_volume_id)
    ? active_volume_id
    : volumes[0]?.id

// Result of parsing a volumetric file (contains both structure and volumetric data)
export interface VolumetricFileData {
  structure: Crystal
  volumes: VolumetricData[] // one or more volumes (e.g. total + magnetization for spin-polarized)
}

// One isosurface at an isovalue with its own appearance. `volume_id` picks the geometry
// source, `color_volume_id` optionally a volume sampled at the surface vertices to drive a
// colormap (e.g. a density surface colored by ESP).
export interface IsosurfaceLayer {
  // Any finite value in the volume's units: 0 draws a signed field's nodal surface
  isovalue: number
  color: string
  opacity: number
  visible: boolean
  // When true, also render the -isovalue surface; of the two, the lobe drawn at a negative
  // value takes `negative_color` and the positive one `color`
  show_negative: boolean
  negative_color: string
  // Geometry-source volume ID
  volume_id: string
  // Scalar-color-source volume ID; unset preserves solid-color behavior
  color_volume_id?: string
  // Color scale for the sampled scalars (default interpolateViridis). An inverted value_range
  // flips the map; unset ends fit the surface's values (symmetric about 0 for signed fields).
  color_scale?: ColorScale
}

// Every rendered surface is an explicit layer (none renders nothing), plus shared options
export interface IsosurfaceSettings {
  layers: IsosurfaceLayer[]
  wireframe: boolean
  halo: number // fraction of cell to extend isosurface beyond boundaries (0 = clip at cell edge, 0.5 = half cell)
  // VESTA-style fractional range per lattice axis for periodic volumes, e.g. [[-0.15, 2.15],
  // [-0.15, 2.15], [0, 1]] repeats surfaces and clips them exactly there. Unset follows the
  // structure's integer supercell; independent of the atom supercell and cell outline.
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

// min/max/abs_max/mean of flat grid values in one pass (VolumetricData precomputes it)
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

// [isovalue fraction of abs_max, opacity] for the nth shell auto-added to a volume: the usual
// 20% envelope, then alternating inner/outer steps so shells never coincide, inner ones more
// opaque so every shell stays visible. Cycles past 6.
export const SHELL_STEPS: readonly (readonly [fraction: number, opacity: number])[] = [
  [0.2, 0.6],
  [0.8, 0.8],
  [0.5, 0.7],
  [0.1, 0.3],
  [0.65, 0.75],
  [0.35, 0.65],
]

// Default layer for a volume: the `shell_idx`th SHELL_STEPS entry (`shell_idx` = layers it
// already has, so repeated "+" adds distinct shells), the next palette color (the negative
// lobe takes the one after) and the negative lobe on for signed fields (`signed` hint, else
// non-negligible negative values).
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
    show_negative: volume.signed ?? min < -abs_max * 0.01,
    negative_color: LAYER_COLORS[(color_offset + 1) % LAYER_COLORS.length],
    volume_id: volume.id,
  }
}

// === Isovalue slider aids ===

// Positive slider isovalues that draw any surface, as (low, high]. Marching cubes counts a
// corner below when value < isovalue, so the surface needs min < isovalue <= max and the
// mirrored lobe -max <= isovalue < -min; these meet in one interval (null if neither draws)
export function surface_isovalue_band(
  { min, max }: Pick<DataRange, `min` | `max`>,
  show_negative: boolean,
): Vec2 | null {
  const intervals: Vec2[] = []
  if (max > 0) intervals.push([Math.max(min, 0), max])
  if (show_negative && min < 0) intervals.push([Math.max(-max, 0), -min])
  if (intervals.length === 0) return null
  return [
    Math.min(...intervals.map(([low]) => low)),
    Math.max(...intervals.map(([, high]) => high)),
  ]
}

// Weak snap for an isovalue slider: a value just past an end of `band` (within `reach` of it)
// moves to the nearest slider step that still draws a surface. With `sticky` (a pointer drag)
// it holds there until the pointer leaves the reach; without it (keyboard steps) it holds once,
// so the next step from the edge passes through.
export function snap_isovalue(
  value: number,
  band: Vec2 | null,
  { min, step, reach, previous, sticky }: SnapIsovalueOptions,
): number {
  if (!band || !(step > 0)) return value
  const [low, high] = band
  const at_step = (count: number) => min + count * step
  let target: number
  if (value <= low && low - value <= reach) {
    let count = Math.floor((low - min) / step)
    while (at_step(count) <= low) count++
    target = at_step(count)
  } else if (value > high && value - high <= reach) {
    let count = Math.ceil((high - min) / step)
    while (at_step(count) > high) count--
    target = at_step(count)
  } else return value
  if (target <= low || target > high) return value // the band is narrower than one step
  // steps are min + k·step in floating point, so "already at the edge" allows rounding noise
  const at_edge = Math.abs(previous - target) <= step * 1e-9
  return sticky || !at_edge ? target : value
}
export interface SnapIsovalueOptions {
  min: number // slider minimum: steps sit at min + k * step
  step: number
  reach: number // how far past a band end the snap catches
  previous: number // isovalue before this input
  sticky: boolean
}

// Bin counts of a volume's values over the slider's [low, high], cached per volume. With
// `mirror` (negative lobe shown) bins count |value|, since one slider value draws both signs.
const histogram_cache = new WeakMap<VolumetricData, Map<string, Uint32Array>>()
export function isovalue_histogram(
  volume: VolumetricData,
  [low, high]: Vec2,
  mirror: boolean,
  n_bins = 64,
): Uint32Array {
  const key = `${low}|${high}|${mirror}|${n_bins}`
  let by_key = histogram_cache.get(volume)
  const cached = by_key?.get(key)
  if (cached) return cached
  const counts = new Uint32Array(n_bins)
  const span = high - low
  if (span > 0) {
    const scale = n_bins / span
    for (const raw of volume.values) {
      const value = mirror ? Math.abs(raw) : raw
      if (!(value >= low && value <= high)) continue // also drops NaN
      counts[Math.min(n_bins - 1, Math.floor((value - low) * scale))]++
    }
  }
  if (!by_key) histogram_cache.set(volume, (by_key = new Map()))
  by_key.set(key, counts)
  return counts
}

// Settings for a freshly loaded file: one auto layer on its first volume (later ones, e.g. a
// CHGCAR's magnetization, stay available as colour sources or manual surfaces)
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
  const retained = volumes.filter(({ id: identifier }) => identifier !== removed_id)
  return { volumes: retained, layers: retain_volume_layers(layers, index_volumes(retained)) }
}

// Label a file's volumes with a stable `source` (compression-stripped filename) and display
// label (multi-block files like spin-polarized CHGCAR get "<file>: <block label>")
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
  const sources = new Set(incoming.map(({ source }) => source))
  const volumes = existing.flatMap((volume) => {
    const replacement = replacements.get(volume.id)
    if (replacement) return [replacement]
    return volume.source !== undefined && sources.has(volume.source) ? [] : [volume]
  })
  const added = incoming.filter(({ id: identifier }) => !previous.has(identifier))
  volumes.push(...added)
  const layers = retain_volume_layers(existing_layers, index_volumes(volumes))
  for (const volume of added) layers.push(auto_volume_layer(volume, layers.length))
  return { volumes, layers, n_added: added.length }
}
