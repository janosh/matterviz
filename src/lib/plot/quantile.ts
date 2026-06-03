// Shared quantile + selection helpers used by box-plot.ts and kde.ts.
// quickselect partially sorts in place; quantile_unordered mutates its input
// (quantile_sorted assumes an already-ascending array and never mutates).
//
// Unguarded contract: quickselect, quantile_sorted and quantile_unordered all assume
// values.length > 0 and 0 <= p <= 1. Out-of-range inputs index past the array and
// yield undefined/NaN — callers (box-plot.ts, kde.ts) must length- and p-range-check
// before calling.

export function quickselect(values: number[], kth: number): number {
  let left = 0
  let right = values.length - 1
  while (left < right) {
    const pivot = values[(left + right) >>> 1]
    let scan_lo = left
    let scan_hi = right
    while (scan_lo <= scan_hi) {
      while (values[scan_lo] < pivot) scan_lo++
      while (values[scan_hi] > pivot) scan_hi--
      if (scan_lo <= scan_hi) {
        const tmp = values[scan_lo]
        values[scan_lo] = values[scan_hi]
        values[scan_hi] = tmp
        scan_lo++
        scan_hi--
      }
    }
    if (kth <= scan_hi) right = scan_hi
    else if (kth >= scan_lo) left = scan_lo
    else return values[kth]
  }
  return values[kth]
}

export function quantile_sorted(values: readonly number[], p: number): number {
  const idx = (values.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  const frac = idx - lo
  const lo_val = values[lo]
  return hi === lo ? lo_val : lo_val + (values[hi] - lo_val) * frac
}

export function quantile_unordered(values: number[], p: number): number {
  const idx = (values.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  const frac = idx - lo
  const lo_val = quickselect(values, lo)
  return hi === lo ? lo_val : lo_val + (quickselect(values, hi) - lo_val) * frac
}
