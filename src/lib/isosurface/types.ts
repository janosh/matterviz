// Type definitions and utilities for isosurface visualization (charge density, molecular orbitals, etc.)
import type { D3InterpolateName } from '$lib/colors'
import type { Matrix3x3, Vec2, Vec3 } from '$lib/math'
import type { Crystal } from '$lib/structure'
import { flatten_grid, type ScalarGrid3D } from './grid'

// Precomputed statistics for a volumetric grid (min, max, abs_max, mean)
export interface DataRange {
  min: number
  max: number
  abs_max: number
  mean: number
}

// Volumetric scalar data on a 3D grid (e.g. charge density, electrostatic potential).
// Values are stored flat in C order (z fastest: index = (ix * ny + iy) * nz + iz) so the
// volume itself is a ScalarGrid3D that marching cubes and the geometry worker consume
// without copying. Parsers transpose Fortran-ordered sources (VASP) once at load time.
export interface VolumetricData extends ScalarGrid3D<Float64Array> {
  order: `z_fastest`
  dims: Vec3 // [nx, ny, nz]
  lattice: Matrix3x3 // real-space lattice vectors (rows are a, b, c)
  origin: Vec3 // grid origin in Cartesian coordinates
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
    lattice: data.lattice,
    origin: data.origin,
    periodic: data.periodic,
    ...optional(`label`),
    ...optional(`source`),
    ...optional(`source_filename`),
  })
}

// Reset an out-of-range active volume index while preserving valid or empty states.
export const normalize_active_volume_idx = (
  active_volume_idx: number,
  volume_count: number,
): number =>
  volume_count > 0 && (active_volume_idx < 0 || active_volume_idx >= volume_count)
    ? 0
    : active_volume_idx

// Result of parsing a volumetric file (contains both structure and volumetric data)
export interface VolumetricFileData {
  structure: Crystal
  volumes: VolumetricData[] // one or more volumes (e.g. total + magnetization for spin-polarized)
}

// A single isosurface layer at a specific isovalue with its own appearance.
// Layers reference volumes by index into the loaded volumes array: `volume_idx`
// picks the geometry source (marching cubes input) and `color_volume_idx`
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
  // Geometry-source volume index (defaults to the active volume when omitted)
  volume_idx?: number
  // Scalar-color-source volume index; unset preserves solid-color behavior
  color_volume_idx?: number
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

const clamp_dim = (src: number, fac: number) =>
  Math.min(src, Math.max(2, Math.ceil(src / fac)))
const partition_ranges = (n_out: number, n_src: number): Vec2[] =>
  Array.from({ length: n_out }, (_, idx) => [
    Math.round((idx * n_src) / n_out),
    Math.round(((idx + 1) * n_src) / n_out),
  ])

// Max total grid points before downsampling is applied for isosurface extraction.
// 500K balances visual quality with interactive performance (<200ms marching cubes).
export const MAX_GRID_POINTS = 500_000

// Downsample a z-fastest grid to keep its point count under a budget via block
// averaging. Returns the input grid unchanged (factor 1) when already within budget.
export function downsample_grid(
  grid: ScalarGrid3D<Float64Array>,
  max_points: number = MAX_GRID_POINTS,
): { grid: ScalarGrid3D<Float64Array>; factor: number } {
  const [nx, ny, nz] = grid.dims
  const total = nx * ny * nz
  if (total <= max_points) return { grid, factor: 1 }
  if (grid.order !== `z_fastest`) {
    throw new RangeError(`downsample_grid expects z_fastest values, got ${grid.order}`)
  }
  // Floor at 1 to avoid Infinity in cbrt(total/0)
  max_points = Math.max(1, max_points)

  // Increase factor until the clamped output fits within budget.
  // A single cbrt step can overshoot for anisotropic grids where max(2,...)
  // clamping prevents a small axis from shrinking below 2.
  // clamp_dim: returns 1 for single-cell axes, otherwise clamps to [2, src]
  const clamp_dims = (fac: number): Vec3 => grid.dims.map((dim) => clamp_dim(dim, fac)) as Vec3
  const n_points = ([x_dim, y_dim, z_dim]: Vec3) => x_dim * y_dim * z_dim
  let factor = Math.ceil(Math.cbrt(total / max_points))
  let new_dims = clamp_dims(factor)
  while (n_points(new_dims) > max_points) {
    const next_dims = clamp_dims(++factor)
    // dims hit their floor (2 per axis or 1 for single-cell) — stop to avoid infinite loop
    if (n_points(next_dims) === n_points(new_dims)) break
    new_dims = next_dims
  }
  const [new_nx, new_ny, new_nz] = new_dims

  // Proportional partitioning: evenly divides [0, n) into new_n non-empty blocks.
  // Unlike fixed-stride (ix * factor), this is safe when max(2,...) clamping
  // produces more output cells than ceil(n/factor) would — no empty blocks.
  const [x_ranges, y_ranges, z_ranges] = new_dims.map((n_out, axis) =>
    partition_ranges(n_out, grid.dims[axis]),
  )

  const src = grid.values
  const out = new Float64Array(new_nx * new_ny * new_nz)
  let out_idx = 0
  for (let ix = 0; ix < new_nx; ix++) {
    const [sx_start, sx_end] = x_ranges[ix]
    for (let iy = 0; iy < new_ny; iy++) {
      const [sy_start, sy_end] = y_ranges[iy]
      for (let iz = 0; iz < new_nz; iz++) {
        const [sz_start, sz_end] = z_ranges[iz]
        let sum = 0
        for (let sx = sx_start; sx < sx_end; sx++) {
          for (let sy = sy_start; sy < sy_end; sy++) {
            const row_offset = (sx * ny + sy) * nz
            for (let sz = sz_start; sz < sz_end; sz++) sum += src[row_offset + sz]
          }
        }
        out[out_idx++] =
          sum / ((sx_end - sx_start) * (sy_end - sy_start) * (sz_end - sz_start))
      }
    }
  }

  return { grid: { values: out, dims: [new_nx, new_ny, new_nz], order: `z_fastest` }, factor }
}

// Default isosurface rendering settings (no layers: nothing renders until a volume adds one)
export const DEFAULT_ISOSURFACE_SETTINGS: IsosurfaceSettings = {
  layers: [],
  wireframe: false,
  halo: 0,
}

const field_has_significant_negatives = ({ min, abs_max }: DataRange): boolean =>
  min < -abs_max * 0.01

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
// Isovalue at a fraction of abs_max; all-zero grids fall back to a small positive value so
// controls stay usable
const fractional_isovalue = ({ abs_max }: DataRange, fraction: number): number =>
  abs_max > 0 ? abs_max * fraction : 0.05

// Visible layer colored from the categorical palette (negative lobe takes the next
// swatch) with the negative lobe enabled when the field is signed
const palette_layer = (
  data_range: DataRange,
  isovalue: number,
  opacity: number,
  color_offset: number,
): IsosurfaceLayer => ({
  isovalue,
  color: LAYER_COLORS[color_offset % LAYER_COLORS.length],
  opacity,
  visible: true,
  show_negative: field_has_significant_negatives(data_range),
  negative_color: LAYER_COLORS[(color_offset + 1) % LAYER_COLORS.length],
})

// Build a default isosurface layer for a volume: the `shell_idx`th SHELL_STEPS entry (20% of
// abs_max at opacity 0.6 for the first surface), next unused palette color, and negative
// lobe when the data is signed. `shell_idx` is how many layers the volume already has, so
// repeated "+" clicks add distinguishable shells instead of coincident copies.
export const auto_volume_layer = (
  volume: VolumetricData,
  volume_idx: number,
  color_offset = 0,
  shell_idx = 0,
): IsosurfaceLayer => {
  const [fraction, opacity] = SHELL_STEPS[shell_idx % SHELL_STEPS.length]
  return {
    ...palette_layer(
      volume.data_range,
      fractional_isovalue(volume.data_range, fraction),
      opacity,
      color_offset,
    ),
    volume_idx,
  }
}

// Settings for a freshly loaded file: one auto layer on its first volume (further volumes of
// the same file, e.g. a CHGCAR's magnetization block, stay available as colour sources or
// for manually added surfaces)
export const auto_isosurface_settings = (volume: VolumetricData): IsosurfaceSettings => ({
  ...DEFAULT_ISOSURFACE_SETTINGS,
  layers: [auto_volume_layer(volume, 0)],
})

// Pin layers still relying on the implicit active volume to an explicit volume_idx
export const pin_layers = (
  layers: IsosurfaceLayer[],
  active_volume_idx: number,
): (IsosurfaceLayer & { volume_idx: number })[] =>
  layers.map((layer) => ({ ...layer, volume_idx: layer.volume_idx ?? active_volume_idx }))

// Remove a volume from the registry: drops layers whose geometry references it,
// unsets color sources pointing at it, and shifts higher indices down by one.
// Layers without an explicit volume_idx implicitly reference `active_volume_idx`.
export function remove_volume(
  volumes: VolumetricData[],
  layers: IsosurfaceLayer[],
  removed_idx: number,
  active_volume_idx = 0,
): { volumes: VolumetricData[]; layers: IsosurfaceLayer[] } {
  const shift = (idx: number): number => (idx > removed_idx ? idx - 1 : idx)
  const remap = (idx: number | undefined): number | undefined =>
    idx === undefined || idx === removed_idx ? undefined : shift(idx)
  return {
    volumes: volumes.filter((_vol, idx) => idx !== removed_idx),
    layers: layers
      .filter((layer) => (layer.volume_idx ?? active_volume_idx) !== removed_idx)
      .map((layer) => ({
        ...layer,
        // the filter above already dropped layers on the removed volume, so only the shift remains
        volume_idx: shift(layer.volume_idx ?? active_volume_idx),
        color_volume_idx: remap(layer.color_volume_idx),
      })),
  }
}

// Label volumes parsed from a file with a stable `source` id (compression-
// stripped filename) and a display label (multi-block files like spin-polarized
// CHGCAR get "<file>: <block label>" labels).
export function label_file_volumes(
  volumes: VolumetricData[],
  filename: string,
  source_filename = filename,
): VolumetricData[] {
  const source = filename.replace(/\.(?:gz|gzip|bz2|xz|zst)$/i, ``)
  return volumes.map((vol, idx) => ({
    ...vol,
    source,
    source_filename,
    label: volumes.length > 1 ? `${source}: ${vol.label ?? idx + 1}` : source,
  }))
}

// Two lattices describe the same cell when all matrix entries agree within
// tolerance — the signal that an imported file is another scalar field of the
// already-loaded system and should be appended rather than replace the scene.
export const lattices_match = (
  lattice_a: readonly (readonly number[])[] | undefined,
  lattice_b: readonly (readonly number[])[] | undefined,
  tolerance = 0.05,
): boolean =>
  lattice_a !== undefined &&
  lattice_b !== undefined &&
  lattice_a.every((row, row_idx) =>
    row.every((val, col_idx) => Math.abs(val - lattice_b[row_idx][col_idx]) < tolerance),
  )

interface VolumeMergeResult {
  volumes: VolumetricData[]
  layers: IsosurfaceLayer[]
  first_touched_idx: number // index of the first replaced/added volume (new active)
  n_added: number // volumes appended (0 for a pure in-place reimport)
}

// Merge volumes from a newly imported file (pre-labeled via label_file_volumes)
// into an existing registry. Reimporting a source with the same block count
// replaces its volumes in place, preserving user-tuned layers; a changed block
// count drops the stale group (remapping layer indices) before appending fresh
// volumes. New volumes each get an auto-generated layer.
// Layers without an explicit volume_idx implicitly reference `active_volume_idx`
// and are pinned to it up front so index remapping treats them correctly.
export function merge_imported_volumes(
  existing: VolumetricData[],
  existing_layers: IsosurfaceLayer[],
  incoming: VolumetricData[],
  active_volume_idx = 0,
): VolumeMergeResult {
  const source = incoming[0]?.source
  let volumes = [...existing]
  let layers: IsosurfaceLayer[] = pin_layers(existing_layers, active_volume_idx)

  const group_indices = volumes
    .map((vol, idx) => (source !== undefined && vol.source === source ? idx : -1))
    .filter((idx) => idx >= 0)

  if (group_indices.length === incoming.length && incoming.length > 0) {
    // Same source, same block count: replace in place, keep layer settings
    for (const [incoming_idx, vol_idx] of group_indices.entries()) {
      volumes[vol_idx] = incoming[incoming_idx]
    }
    return { volumes, layers, first_touched_idx: group_indices[0], n_added: 0 }
  }

  // Drop any stale volumes from the same source (block count changed)
  for (let removed = group_indices.length - 1; removed >= 0; removed--) {
    ;({ volumes, layers } = remove_volume(volumes, layers, group_indices[removed]))
  }

  const first_touched_idx = volumes.length
  for (const vol of incoming) {
    layers.push(auto_volume_layer(vol, volumes.length, layers.length))
    volumes.push(vol)
  }
  return { volumes, layers, first_touched_idx, n_added: incoming.length }
}
