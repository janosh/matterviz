import type { Point2D } from '#lib/math.js'
import { assert_non_negative } from '#lib/math.js'

// Uniform-grid spatial index for nearest-point picking in screen pixels. Items are sorted by
// their cell's packed integer key (a stable radix sort, so each cell lists its items in input
// i.e. paint order) and a cell is a run of that order, found by binary search over the sorted
// keys. Typed arrays throughout: indexing a million markers allocates no per-point objects
// (a Map of per-cell arrays built 10x slower). Coordinates outside the exact packing range are
// irrelevant to on-screen picking and get dropped.
const COORD_OFFSET = 1 << 15
const COORD_STRIDE = 1 << 16
// In [0, 2^32) for in-grid cells, so the keys fit a Uint32Array
const pack_cell_key = (col: number, row: number): number =>
  (col + COORD_OFFSET) * COORD_STRIDE + (row + COORD_OFFSET)

// Keep one reference per point; cells hold item ids (indices into `items`), not wrappers.
export type Positioned = { cx: number; cy: number }

export type SpatialIndex<T> = {
  items: T[] // the indexed items in input order; an item's id is its position here
  cx: Float64Array // their pixel positions, by id
  cy: Float64Array
  cell_keys: Uint32Array // packed keys of the occupied cells, ascending
  cell_starts: Int32Array // cell i holds ids order[cell_starts[i]] .. order[cell_starts[i + 1] - 1]
  order: Int32Array // ids grouped by cell, ascending within each cell
  cell_size: number
  radius_px: number
}

const in_grid = (coord: number) => coord >= -COORD_OFFSET && coord < COORD_OFFSET

// Cell size matches the pick radius, limiting queries to at most 3x3 cells.
export function build_spatial_index<T extends Positioned>(
  items: Iterable<T>,
  radius_px: number,
): SpatialIndex<T> {
  const listed: readonly T[] = Array.isArray(items) ? items : [...items]
  const cx = Float64Array.from(listed, (item) => item.cx)
  const cy = Float64Array.from(listed, (item) => item.cy)
  return build_spatial_index_at(listed, cx, cy, radius_px)
}

// build_spatial_index for items whose pixel positions are given apart, by item index (a host
// projecting its own points needn't wrap each in a positioned object)
export function build_spatial_index_at<T>(
  items: readonly T[],
  cx: ArrayLike<number>,
  cy: ArrayLike<number>,
  radius_px: number,
): SpatialIndex<T> {
  assert_non_negative(radius_px, `radius_px`)
  const cell_size = Math.max(1, radius_px)
  const kept: T[] = []
  const xs = new Float64Array(items.length)
  const ys = new Float64Array(items.length)
  const keys = new Uint32Array(items.length)
  for (let idx = 0; idx < items.length; idx++) {
    const center_x = cx[idx]
    const center_y = cy[idx]
    if (!Number.isFinite(center_x) || !Number.isFinite(center_y)) continue
    const col = Math.floor(center_x / cell_size)
    const row = Math.floor(center_y / cell_size)
    if (!in_grid(col) || !in_grid(row)) continue
    xs[kept.length] = center_x
    ys[kept.length] = center_y
    keys[kept.length] = pack_cell_key(col, row)
    kept.push(items[idx])
  }
  const count = kept.length

  // Stable LSD radix sort of the ids by key, a byte per pass; a byte every key shares (most
  // of them on a plot-sized grid) skips its pass
  let order = Int32Array.from({ length: count }, (_, idx) => idx)
  let sorted = new Int32Array(count)
  const offsets = new Int32Array(257)
  for (let shift = 0; shift < 32; shift += 8) {
    offsets.fill(0)
    for (let idx = 0; idx < count; idx++) offsets[((keys[idx] >>> shift) & 255) + 1]++
    if (offsets.includes(count)) continue
    for (let byte = 0; byte < 256; byte++) offsets[byte + 1] += offsets[byte]
    for (let idx = 0; idx < count; idx++) {
      const id = order[idx]
      sorted[offsets[(keys[id] >>> shift) & 255]++] = id
    }
    ;[order, sorted] = [sorted, order]
  }

  const cell_keys: number[] = []
  const cell_starts: number[] = []
  for (let idx = 0; idx < count; idx++) {
    const key = keys[order[idx]]
    if (cell_keys.at(-1) === key) continue
    cell_keys.push(key)
    cell_starts.push(idx)
  }
  cell_starts.push(count)
  return {
    items: kept,
    cx: xs.subarray(0, count),
    cy: ys.subarray(0, count),
    cell_keys: Uint32Array.from(cell_keys),
    cell_starts: Int32Array.from(cell_starts),
    order,
    cell_size,
    radius_px,
  }
}

// Position of a cell among the occupied ones, or -1 when it holds no item
function find_cell(index: SpatialIndex<unknown>, col: number, row: number): number {
  const { cell_keys } = index
  const key = pack_cell_key(col, row)
  let [lo, hi] = [0, cell_keys.length]
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (cell_keys[mid] < key) lo = mid + 1
    else hi = mid
  }
  return cell_keys[lo] === key ? lo : -1
}

// Id of the nearest indexed item within `radius_px` of `pointer` (inclusive) that `accept`
// allows, or -1. Exact distance ties always resolve to the earlier-indexed item, including
// across cells.
export function query_nearest_id<T>(
  index: SpatialIndex<T>,
  pointer: Point2D,
  accept?: (item: T) => boolean,
): number {
  const { items, cx, cy, cell_starts, order, cell_size, radius_px } = index
  if (!Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) return -1
  const center_col = Math.floor(pointer.x / cell_size)
  const center_row = Math.floor(pointer.y / cell_size)
  let best_dist_sq = radius_px * radius_px
  let best_idx = Infinity

  // Visit the pointer's cell first, then prune cells farther away than the best hit.
  // Strict > preserves earlier-indexed ties on shared cell boundaries.
  const offsets = radius_px === 0 ? [0] : [0, -1, 1]
  for (const col_offset of offsets) {
    const col = center_col + col_offset
    if (!in_grid(col)) continue
    const dx_min = Math.max(col * cell_size - pointer.x, 0, pointer.x - (col + 1) * cell_size)
    for (const row_offset of offsets) {
      const row = center_row + row_offset
      if (!in_grid(row)) continue
      const dy_min = Math.max(
        row * cell_size - pointer.y,
        0,
        pointer.y - (row + 1) * cell_size,
      )
      if (dx_min * dx_min + dy_min * dy_min > best_dist_sq) continue
      const cell = find_cell(index, col, row)
      if (cell < 0) continue
      for (let pos = cell_starts[cell]; pos < cell_starts[cell + 1]; pos++) {
        const idx = order[pos]
        if (accept && !accept(items[idx])) continue
        const delta_x = pointer.x - cx[idx]
        const delta_y = pointer.y - cy[idx]
        const dist_sq = delta_x * delta_x + delta_y * delta_y
        if (dist_sq < best_dist_sq || (dist_sq === best_dist_sq && idx < best_idx)) {
          best_dist_sq = dist_sq
          best_idx = idx
        }
      }
    }
  }

  return best_idx === Infinity ? -1 : best_idx
}

// The item query_nearest_id finds, or null
export function query_nearest<T>(
  index: SpatialIndex<T>,
  pointer: Point2D,
  accept?: (item: T) => boolean,
): T | null {
  const idx = query_nearest_id(index, pointer, accept)
  return idx < 0 ? null : index.items[idx]
}

// Last-painted candidate accepted by `contains`. The index radius must bound the
// predicate's hit radius; visiting neighboring cells then preserves exact hit rules.
export function query_topmost<T>(
  index: SpatialIndex<T>,
  pointer: Point2D,
  contains: (item: T) => boolean,
): T | null {
  if (!Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) return null
  const { cell_starts, order } = index
  const col = Math.floor(pointer.x / index.cell_size)
  const row = Math.floor(pointer.y / index.cell_size)
  let best_idx = -1
  for (let col_offset = -1; col_offset <= 1; col_offset++) {
    const cell_col = col + col_offset
    if (!in_grid(cell_col)) continue
    for (let row_offset = -1; row_offset <= 1; row_offset++) {
      const cell_row = row + row_offset
      if (!in_grid(cell_row)) continue
      const cell = find_cell(index, cell_col, cell_row)
      if (cell < 0) continue
      for (let pos = cell_starts[cell + 1] - 1; pos >= cell_starts[cell]; pos--) {
        const idx = order[pos]
        if (idx <= best_idx) break
        if (contains(index.items[idx])) {
          best_idx = idx
          break
        }
      }
    }
  }
  return index.items[best_idx] ?? null
}
