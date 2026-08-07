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
  const cell_radius = Math.ceil(radius_px / cell_size)
  if (
    center_col + cell_radius < -COORD_OFFSET ||
    center_col - cell_radius >= COORD_OFFSET ||
    center_row + cell_radius < -COORD_OFFSET ||
    center_row - cell_radius >= COORD_OFFSET
  ) {
    return null
  }
  const min_col = Math.max(-COORD_OFFSET, center_col - cell_radius)
  const max_col = Math.min(COORD_OFFSET - 1, center_col + cell_radius)
  const min_row = Math.max(-COORD_OFFSET, center_row - cell_radius)
  const max_row = Math.min(COORD_OFFSET - 1, center_row + cell_radius)
  const max_dist_sq = radius_px * radius_px
  let best: T | null = null
  let best_dist_sq = Infinity
  let best_idx = Infinity

  for (let col = min_col; col <= max_col; col++) {
    for (let row = min_row; row <= max_row; row++) {
      const bucket = cells.get(pack_cell_key(col, row))
      if (!bucket) continue
      for (const { item, idx } of bucket) {
        const dx = pointer.x - item.cx
        const dy = pointer.y - item.cy
        const dist_sq = dx * dx + dy * dy
        if (dist_sq > max_dist_sq) continue
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
