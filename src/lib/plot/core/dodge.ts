// Beeswarm packing: push equal circles off a centerline just far enough that none overlap,
// keeping their positions along the line. Ported from layerchart's Dodge (after Observable
// Plot's dodge transform). Circles are placed in ascending position order, which gives the
// tidy symmetric swarm of seaborn's swarmplot. In that order the circles that can collide
// with the next one form a sliding window, which replaces layerchart's unbalanced interval
// tree (sorted inserts would degrade it to a list and recurse once per circle).

export type DodgeSide = `both` | `positive` | `negative`

// Offset of each circle from the centerline, in input order (NaN for non-finite positions).
// `both` packs outward on either side, nearest-to-center first; `positive`/`negative` stack
// on one side only, the first circle resting `radius + padding` off the line. A circle that
// would land past `max_offset` goes on an overflow pile at the edge instead and blocks no
// later circle, so heavily tied data (O(n^3) unbounded) stays fast.
export function dodge(
  positions: ArrayLike<number>,
  radius: number,
  opts: { padding?: number; side?: DodgeSide; max_offset?: number } = {},
): Float64Array {
  const { padding = 1, side = `both`, max_offset = Infinity } = opts
  if (!(radius >= 0)) throw new RangeError(`dodge: invalid radius ${radius}`)
  if (!(padding >= 0)) throw new RangeError(`dodge: invalid padding ${padding}`)
  const offsets = new Float64Array(positions.length).fill(NaN)
  const order: number[] = []
  for (let idx = 0; idx < positions.length; idx++) {
    if (Number.isFinite(positions[idx])) order.push(idx)
  }
  // Stable: ties keep input order
  order.sort((left, right) => positions[left] - positions[right])

  const symmetric = side === `both`
  const sign = side === `negative` ? -1 : 1
  const base = symmetric ? 0 : radius + padding
  const reach = 2 * radius + padding // center distance at which two circles touch
  // Placed (non-overflow) circles: position and offset relative to `base`
  const placed_pos: number[] = []
  const placed_off: number[] = []
  // Forbidden [lo, hi] offset zones, flat; slot 0/1 is a [0, 0] no-op zone that keeps the
  // centerline itself a candidate. Each neighbor's zone edges are the other candidates.
  const zones = new Float64Array(2 * order.length + 2)
  const candidates = new Float64Array(2 * order.length + 2)
  const by_abs = (left: number, right: number) => Math.abs(left) - Math.abs(right)
  let [window_start, n_overflow] = [0, 0]
  for (const idx of order) {
    const pos = positions[idx]
    // Same subtraction as `gap` below, so gap <= reach and the sqrt never sees a negative
    while (window_start < placed_pos.length && pos - placed_pos[window_start] > reach) {
      window_start++
    }
    let n_zones = 2
    for (let other = window_start; other < placed_pos.length; other++) {
      const gap = pos - placed_pos[other]
      const half_chord = Math.sqrt(reach * reach - gap * gap)
      zones[n_zones++] = placed_off[other] - half_chord
      zones[n_zones++] = placed_off[other] + half_chord
    }
    const view = candidates.subarray(0, n_zones)
    view.set(zones.subarray(0, n_zones))
    if (symmetric) view.sort(by_abs)
    else view.sort()
    let chosen = NaN
    candidate_loop: for (const candidate of view) {
      if (!symmetric && candidate < 0) continue
      // Candidates come nearest-first, so the rest are out of bounds too
      if (Math.abs(candidate) + base > max_offset) break
      for (let zone = 0; zone < n_zones; zone += 2) {
        // Strictly inside a zone (with slack for the sqrt round-trip) means an overlap
        if (zones[zone] + 1e-6 < candidate && candidate < zones[zone + 1] - 1e-6) {
          continue candidate_loop
        }
      }
      chosen = candidate
      break
    }
    if (Number.isNaN(chosen)) {
      // Symmetric overflow alternates edges so the pile stays balanced
      offsets[idx] = (symmetric && n_overflow++ % 2 === 0 ? -1 : sign) * max_offset
      continue
    }
    offsets[idx] = symmetric ? chosen : sign * (chosen + base)
    placed_pos.push(pos)
    placed_off.push(chosen)
  }
  return offsets
}
