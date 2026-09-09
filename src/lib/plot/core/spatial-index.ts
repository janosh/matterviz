import type { Point2D } from '$lib/math'

// Uniform-grid spatial hash for nearest-point picking in screen pixels.
// Integer keys avoid allocating strings; coordinates outside the exact packing range are
// irrelevant to on-screen picking and get dropped.
const COORD_OFFSET = 1 << 15
const COORD_STRIDE = 1 << 16
const pack_cell_key = (col: number, row: number): number =>
  (col + COORD_OFFSET) * COORD_STRIDE + (row + COORD_OFFSET)

// Index pixel-positioned values directly without wrappers.
export type Positioned = { cx: number; cy: number }

export type SpatialIndex<T extends Positioned> = {
  cells: Map<number, { item: T; idx: number }[]>
  cell_size: number
  radius_px: number
  count: number // indexed items, i.e. excluding those dropped as non-finite/off-grid
}

const in_grid = (coord: number) => coord >= -COORD_OFFSET && coord < COORD_OFFSET

// Cell size matches the pick radius, limiting queries to at most 3x3 cells.
export function build_spatial_index<T extends Positioned>(
  items: Iterable<T>,
  radius_px: number,
): SpatialIndex<T> {
  if (!Number.isFinite(radius_px) || radius_px < 0) {
    throw new RangeError(`radius_px must be a non-negative finite number, got ${radius_px}`)
  }
  const cell_size = Math.max(1, radius_px)
  const cells = new Map<number, { item: T; idx: number }[]>()
  let count = 0

  for (const item of items) {
    const { cx, cy } = item
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue

    const col = Math.floor(cx / cell_size)
    const row = Math.floor(cy / cell_size)
    if (!in_grid(col) || !in_grid(row)) continue

    const key = pack_cell_key(col, row)
    const entry = { item, idx: count++ }
    const bucket = cells.get(key)
    if (bucket) bucket.push(entry)
    else cells.set(key, [entry])
  }

  return { cells, cell_size, radius_px, count }
}

// Nearest indexed item within `radius_px` of `pointer` (inclusive), or null. Exact
// distance ties always resolve to the earlier-indexed item, including across cells.
export function query_nearest<T extends Positioned>(
  index: SpatialIndex<T>,
  pointer: Point2D,
): T | null {
  const { cells, cell_size, radius_px } = index
  if (!Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) return null
  const center_col = Math.floor(pointer.x / cell_size)
  const center_row = Math.floor(pointer.y / cell_size)
  let best: T | null = null
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
      const bucket = cells.get(pack_cell_key(col, row))
      if (!bucket) continue
      for (const { item, idx } of bucket) {
        const dx = pointer.x - item.cx
        const dy = pointer.y - item.cy
        const dist_sq = dx * dx + dy * dy
        if (dist_sq < best_dist_sq || (dist_sq === best_dist_sq && idx < best_idx)) {
          best_dist_sq = dist_sq
          best_idx = idx
          best = item
        }
      }
    }
  }

  return best
}
