import {
  available_site_vector_keys,
  get_site,
  numeric_sites,
  site_count,
  type DisplayMetrics,
} from './site'
import { characteristic_atom_spacing } from './density'
import { EPS, normalize_vec, compute_in_plane_basis, type Vec3 } from '$lib/math'
import type { VectorLayerConfig } from '$lib/settings'
import type { AnyStructure, Site } from './index'

// Recognized prefixes for per-site vector data (force, magnetic moment, spin, velocity).
// Both singular and plural forms are accepted. Keys matching exactly or starting
// with one of these followed by `_` (e.g. `force_DFT`) are treated as vectors.
const VECTOR_KEY_PREFIXES = [
  `force`,
  `forces`,
  `magmom`,
  `magmoms`,
  `spin`,
  `spins`,
  `velocity`,
  `velocities`,
  `phonon`,
  `dipole`,
] as const

// Memoised: the scan below asks this for every property key of every site on every
// trajectory frame, and the set of distinct key names in a session is tiny
const vector_key_memo = new Map<string, boolean>()
export const is_vector_key = (key: string): boolean => {
  let is_vector = vector_key_memo.get(key)
  if (is_vector === undefined) {
    is_vector = VECTOR_KEY_PREFIXES.some(
      (prefix) => key === prefix || key.startsWith(`${prefix}_`),
    )
    if (vector_key_memo.size >= 1024) vector_key_memo.clear()
    vector_key_memo.set(key, is_vector)
  }
  return is_vector
}

// Default color palette for distinguishing multiple vector layers
export const VECTOR_PALETTE = [
  `#e74c3c`,
  `#3498db`,
  `#2ecc71`,
  `#f39c12`,
  `#9b59b6`,
  `#1abc9c`,
] as const

// Same key shape as is_vector_key, restricted to the velocity prefixes
const is_velocity_vector_key = (key: string): boolean =>
  [`velocity`, `velocities`].some((prefix) => key === prefix || key.startsWith(`${prefix}_`))

// MD velocities are much larger than typical force-vector values in supported file units.
// Shorter, thinner defaults keep velocity arrows from overwhelming the structure or cell.
export const vector_display_defaults = (key: string) =>
  is_velocity_vector_key(key)
    ? { scale: 0.05, shaft_radius: 0.2, arrow_head_radius: 0.1, arrow_head_length: 0.1 }
    : { scale: null, shaft_radius: 1, arrow_head_radius: 1, arrow_head_length: 1 }

// Single key → null color (semantic coloring); multiple keys → palette colors.
export const default_vector_configs = (keys: string[]) =>
  Object.fromEntries(
    keys.map((key, idx) => [
      key,
      {
        visible: true,
        color: keys.length > 1 ? VECTOR_PALETTE[idx % VECTOR_PALETTE.length] : null,
        scale: vector_display_defaults(key).scale,
      },
    ]),
  )

export function try_parse_vec3(val: unknown): Vec3 | null {
  if (
    Array.isArray(val) &&
    val.length === 3 &&
    val.every((elem) => typeof elem === `number` && isFinite(elem))
  )
    return val as Vec3
  if (typeof val === `number` && isFinite(val)) return [0, 0, val]
  return null
}

// Bind a channel once per pass. Numeric reads reuse one scratch vector; scalar columns
// override dense vectors. Cached magnitudes already encode validity with NaN.
// Returned vectors are borrowed: consume them before the next read.
export function vector_reader(
  structure: AnyStructure,
  key: string,
  magnitudes?: Float64Array,
): ((idx: number) => Vec3 | null) | undefined {
  const columns = numeric_sites.get(structure)
  if (!columns) return (idx) => try_parse_vec3(structure.sites[idx].properties?.[key])
  const { coordinates, stride } = columns
  const column = columns.vector_keys.indexOf(key)
  const scalars = Object.hasOwn(columns.scalar_columns ?? {}, key)
    ? columns.scalar_columns?.[key]
    : undefined
  if (column === -1 && !scalars) return undefined // Advertised but not loaded.
  const vector: Vec3 = [0, 0, 0]
  if (scalars)
    return (idx) => {
      if (magnitudes ? Number.isNaN(magnitudes[idx]) : !Number.isFinite(scalars[idx]))
        return null
      vector[2] = scalars[idx]
      return vector
    }
  return (idx) => {
    if (magnitudes && Number.isNaN(magnitudes[idx])) return null
    const offset = idx * stride + 6 + column * 3
    vector[0] = coordinates[offset]
    vector[1] = coordinates[offset + 1]
    vector[2] = coordinates[offset + 2]
    return magnitudes ||
      (Number.isFinite(vector[0]) && Number.isFinite(vector[1]) && Number.isFinite(vector[2]))
      ? vector
      : null
  }
}

// Compute once in the worker; color, visibility and normalization stay viewer settings.
export function compute_display_metrics(structure: AnyStructure): DisplayMetrics {
  const count = site_count(structure)
  const vector_magnitudes: DisplayMetrics[`vector_magnitudes`] = {}
  for (const key of get_structure_vector_keys(structure)) {
    const read = vector_reader(structure, key)
    if (!read) continue
    const values = new Float64Array(count).fill(NaN)
    let max = 0
    for (let idx = 0; idx < count; idx++) {
      const vector = read(idx)
      if (!vector) continue
      const magnitude = Math.hypot(vector[0], vector[1], vector[2])
      values[idx] = magnitude
      max = Math.max(max, magnitude)
    }
    vector_magnitudes[key] = { values, max }
  }
  return {
    vector_magnitudes,
    characteristic_atom_spacing: characteristic_atom_spacing(structure),
  }
}

export type VectorGeometrySettings = {
  vector_configs: Record<string, Pick<VectorLayerConfig, 'visible' | 'scale'>>
  vector_normalize: boolean
  vector_scale: number
  vector_uniform_thickness: boolean
  vector_shaft_radius: number
  vector_arrow_head_radius: number
  vector_arrow_head_length: number
}

export type VectorGeometryFilter = {
  nothing_hidden: boolean
  is_site_visible: (site_idx: number) => boolean
  vector_origin_gap: number
  get_site_radius: (site: Site, site_idx: number) => number
}

export type PreparedVectorGeometry = {
  settings: VectorGeometrySettings
  spacing: number
  max_magnitude: number
  layers: {
    key: string
    site_indices: Uint32Array<ArrayBuffer>
    placements: ArrowPlacements
  }[]
}

// Compare only geometry inputs: colors may change without rebuilding placements.
export function same_vector_geometry(
  left: VectorGeometrySettings,
  right: VectorGeometrySettings,
): boolean {
  for (const key of [
    `vector_normalize`,
    `vector_scale`,
    `vector_uniform_thickness`,
    `vector_shaft_radius`,
    `vector_arrow_head_radius`,
    `vector_arrow_head_length`,
  ] as const)
    if (!Object.is(left[key], right[key])) return false
  const keys = new Set([
    ...Object.keys(left.vector_configs),
    ...Object.keys(right.vector_configs),
  ])
  for (const key of keys) {
    const first = left.vector_configs[key]
    const second = right.vector_configs[key]
    if (
      (first?.visible !== false) !== (second?.visible !== false) ||
      !Object.is(first?.scale ?? 1, second?.scale ?? 1)
    )
      return false
  }
  return true
}

// Worker and custom viewer filters share one geometry path. Only the current site's
// vectors are scratch; placements go directly into their final f32 buffers.
export function prepare_vector_geometry(
  structure: AnyStructure,
  settings: VectorGeometrySettings,
  filter?: VectorGeometryFilter,
  spacing = characteristic_atom_spacing(structure),
): PreparedVectorGeometry {
  const {
    vector_configs,
    vector_normalize,
    vector_scale,
    vector_uniform_thickness,
    vector_shaft_radius,
    vector_arrow_head_radius,
    vector_arrow_head_length,
  } = settings
  const columns = numeric_sites.get(structure)
  const stride = columns?.stride ?? 0
  const count = site_count(structure)
  const nothing_hidden = filter?.nothing_hidden ?? true
  const sources = get_structure_vector_keys(structure)
    .filter((key) => vector_configs[key]?.visible !== false)
    .map((key) => {
      const cached = columns?.display_metrics?.vector_magnitudes[key]
      return {
        key,
        read: vector_reader(structure, key, cached?.values),
        cached,
        vector: [0, 0, 0] as Vec3,
        magnitude: NaN,
      }
    })
  const site_visible = (idx: number): boolean =>
    nothing_hidden
      ? Boolean(columns) || structure.sites[idx].species.length > 0
      : Boolean(filter?.is_site_visible(idx))
  const read_vector = (source: (typeof sources)[number], idx: number): boolean => {
    const vector = source.read?.(idx)
    if (!vector) return false
    source.vector = vector
    source.magnitude = source.cached ? source.cached.values[idx] : Math.hypot(...vector)
    return true
  }
  let max_magnitude = 0
  for (const source of sources) {
    if (source.cached && nothing_hidden) {
      max_magnitude = Math.max(max_magnitude, source.cached.max)
    } else {
      for (let idx = 0; idx < count; idx++)
        if (site_visible(idx) && read_vector(source, idx))
          max_magnitude = Math.max(max_magnitude, source.magnitude)
    }
  }
  const effective_max = vector_normalize ? 1 : max_magnitude
  const auto_scale = effective_max > 1e-10 ? (spacing * 1.8) / effective_max : 1
  const global_scale = auto_scale * vector_scale
  const uniform_size = (size: number): number =>
    vector_uniform_thickness && size < 0 ? spacing * -size : size
  const layers = sources.map((source) => {
    const defaults = vector_display_defaults(source.key)
    return {
      ...source,
      scale: global_scale * (vector_configs[source.key]?.scale ?? 1),
      site_indices: new Uint32Array(count),
      placements: create_arrow_placements(count, [
        uniform_size(vector_shaft_radius) * defaults.shaft_radius,
        uniform_size(vector_arrow_head_radius) * defaults.arrow_head_radius,
        uniform_size(vector_arrow_head_length) * defaults.arrow_head_length,
      ]),
      arrow_count: 0,
    }
  })
  const position: Vec3 = [0, 0, 0]
  const read_position = (site_idx: number): void => {
    const source = columns?.coordinates ?? structure.sites[site_idx].xyz
    const offset = columns ? site_idx * stride : 0
    position[0] = source[offset]
    position[1] = source[offset + 1]
    position[2] = source[offset + 2]
  }
  const append = (layer: (typeof layers)[number], site_idx: number): void => {
    const vector = vector_normalize ? normalize_vec(layer.vector) : layer.vector
    const magnitude = vector_normalize ? Math.hypot(...vector) : layer.magnitude
    write_arrow_placement(
      layer.placements,
      layer.arrow_count,
      position,
      vector,
      magnitude,
      layer.scale,
    )
    layer.site_indices[layer.arrow_count++] = site_idx
  }
  if (!(filter && filter.vector_origin_gap > 0 && layers.length > 1)) {
    for (const layer of layers)
      for (let site_idx = 0; site_idx < count; site_idx++) {
        if (!site_visible(site_idx) || !read_vector(layer, site_idx)) continue
        read_position(site_idx)
        append(layer, site_idx)
      }
  } else {
    const present: (typeof layers)[number][] = []
    for (let site_idx = 0; site_idx < count; site_idx++) {
      if (!site_visible(site_idx)) continue
      present.length = 0
      for (const layer of layers) if (read_vector(layer, site_idx)) present.push(layer)
      // Arrange multiple origins on a regular polygon perpendicular to the mean direction.
      const site = present.length > 1 ? get_site(structure, site_idx) : null
      let basis: [Vec3, Vec3] | undefined
      let gap_abs = 0
      if (site && filter) {
        gap_abs = filter.vector_origin_gap * (filter.get_site_radius(site, site_idx) * 0.5)
        const mean: Vec3 = [0, 0, 0]
        for (const { vector } of present) {
          const unit = normalize_vec(vector)
          for (let axis = 0; axis < 3; axis++) mean[axis] += unit[axis]
        }
        basis = compute_in_plane_basis(normalize_vec(mean, [0, 1, 0] as Vec3))
      }
      for (let layer_idx = 0; layer_idx < present.length; layer_idx++) {
        const layer = present[layer_idx]
        if (site && basis) {
          const angle = (2 * Math.PI * layer_idx) / present.length
          const along_u = gap_abs * Math.cos(angle)
          const along_v = gap_abs * Math.sin(angle)
          for (let axis = 0; axis < 3; axis++)
            position[axis] =
              site.xyz[axis] + (basis[0][axis] * along_u + basis[1][axis] * along_v)
        } else read_position(site_idx)
        append(layer, site_idx)
      }
    }
  }
  return {
    settings: {
      vector_configs: Object.fromEntries(
        Object.entries(vector_configs).map(([key, { visible, scale }]) => [
          key,
          { visible, scale },
        ]),
      ),
      vector_normalize,
      vector_scale,
      vector_uniform_thickness,
      vector_shaft_radius,
      vector_arrow_head_radius,
      vector_arrow_head_length,
    },
    spacing,
    max_magnitude,
    layers: layers.map(({ key, site_indices, placements, arrow_count }) => {
      if (arrow_count !== count) {
        site_indices = site_indices.slice(0, arrow_count)
        placements.origins = placements.origins.slice(0, arrow_count * 3)
        placements.rotations = placements.rotations.slice(0, arrow_count * 4)
        placements.lengths = placements.lengths.slice(0, arrow_count)
        placements.count = arrow_count
      }
      return { key, site_indices, placements }
    }),
  }
}

// Priority index for ordering: bare names first in VECTOR_KEY_PREFIXES order,
// then prefixed keys in the same prefix order, alphabetically within each prefix group.
function vector_key_sort_order(key: string): [number, number, string] {
  for (const [prefix_idx, prefix] of VECTOR_KEY_PREFIXES.entries()) {
    if (key === prefix) return [prefix_idx, 0, ``]
    if (key.startsWith(`${prefix}_`)) return [prefix_idx, 1, key]
  }
  return [VECTOR_KEY_PREFIXES.length, 0, key]
}

function compare_vector_keys(left: string, right: string): number {
  const ord_l = vector_key_sort_order(left)
  const ord_r = vector_key_sort_order(right)
  return ord_l[0] - ord_r[0] || ord_l[1] - ord_r[1] || ord_l[2].localeCompare(ord_r[2])
}

// Extract ALL vector properties from a site (not just the first match).
// Returns entries for every key that is_vector_key() and has a valid 3D vector value.
// Ordered by VECTOR_KEY_PREFIXES priority by default; callers may skip sorting when order is unused.
export function get_all_site_vectors(
  site: Site,
  ordered = true,
): { vec: Vec3; key: string }[] {
  const props = site.properties
  if (!props) return []
  const results: { vec: Vec3; key: string }[] = []
  for (const key of Object.keys(props)) {
    if (!is_vector_key(key)) continue
    const vec = try_parse_vec3(props[key])
    if (vec) results.push({ vec, key })
  }
  if (ordered) results.sort((left, right) => compare_vector_keys(left.key, right.key))
  return results
}

// Collect the union of all vector property keys across all sites in a structure,
// preserving VECTOR_KEY_PREFIXES priority order. Memoised per structure: Structure, its
// controls and every scene pane ask for the same answer on every trajectory frame.
const vector_keys_memo = new WeakMap<AnyStructure, string[]>()
// A numeric trajectory advertises available channels separately from loaded columns, so
// turning a vector off does not remove its control or force decoding it just for discovery.
export const register_structure_vectors = (
  structure: AnyStructure,
  keys: readonly string[],
): void => {
  available_site_vector_keys.set(structure, keys)
  vector_keys_memo.delete(structure)
}
export function get_structure_vector_keys(structure: AnyStructure): string[] {
  const memo = vector_keys_memo.get(structure)
  if (memo) return memo
  const seen = new Set((available_site_vector_keys.get(structure) ?? []).filter(is_vector_key))
  const columns = numeric_sites.get(structure)
  if (columns) {
    for (const key of columns.property_keys()) if (is_vector_key(key)) seen.add(key)
  } else {
    for (const site of structure.sites) {
      const props = site.properties
      if (!props) continue
      // A key already seen skips its prefix and vector checks.
      for (const key of Object.keys(props)) {
        if (!seen.has(key) && is_vector_key(key) && try_parse_vec3(props[key])) seen.add(key)
      }
    }
  }
  // oxlint-disable-next-line eslint-plugin-unicorn/no-array-sort -- spread creates a fresh array
  const keys = [...seen].sort(compare_vector_keys)
  vector_keys_memo.set(structure, keys)
  return keys
}

export type ArrowPlacements = {
  origins: Float32Array<ArrayBuffer>
  lengths: Float32Array<ArrayBuffer>
  dimensions: [number, number, number]
  rotations: Float32Array<ArrayBuffer>
  count: number
}

export const create_arrow_placements = (
  count: number,
  dimensions: [number, number, number],
): ArrowPlacements => ({
  origins: new Float32Array(count * 3),
  lengths: new Float32Array(count),
  rotations: new Float32Array(count * 4),
  dimensions,
  count,
})

// Fill a fresh placement slot with the shared static-arrow and worker transform formula.
export function write_arrow_placement(
  placements: ArrowPlacements,
  idx: number,
  position: Vec3,
  vector: Vec3,
  magnitude: number,
  scale: number,
): void {
  const { origins, lengths, rotations, dimensions } = placements
  origins[idx * 3] = position[0]
  origins[idx * 3 + 1] = position[1]
  origins[idx * 3 + 2] = position[2]
  const length = magnitude * scale
  if (!Number.isFinite(length) || length <= EPS) {
    rotations[idx * 4 + 3] = 1
    return
  }
  const head_length = dimensions[2]
  const head_len = head_length < 0 ? length * -head_length : head_length
  const shaft_len = Math.max(0, length - head_len * 0.5)
  // Preserve the f64 shaft-visibility decision in the sign; the shader uses |length|.
  lengths[idx] = shaft_len > 0.01 ? length : -length
  // Quaternion.setFromUnitVectors(+Y, direction), including its antiparallel branch.
  let quat_x = vector[2] / magnitude
  let quat_z = -(vector[0] / magnitude)
  let quat_w = vector[1] / magnitude + 1
  if (quat_w < Number.EPSILON) {
    quat_x = 0
    quat_w = 0
    quat_z = 1
  }
  const squared_norm = quat_x * quat_x + quat_z * quat_z + quat_w * quat_w
  // oxlint-disable-next-line eslint-plugin-unicorn/prefer-modern-math-apis -- matches Quaternion.normalize arithmetic
  const inverse = 1 / Math.sqrt(squared_norm)
  rotations[idx * 4] = quat_x * inverse
  rotations[idx * 4 + 2] = quat_z * inverse
  rotations[idx * 4 + 3] = quat_w * inverse
}
