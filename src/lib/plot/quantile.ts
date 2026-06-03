// Shared quantile + selection helpers used by box-plot.ts and kde.ts.
// quickselect partially sorts in place; quantile_unordered mutates its input
// (quantile_sorted assumes an already-ascending array and never mutates).

export function quickselect(values: number[], kth: number): number {
  let left = 0
  let right = values.length - 1
  while (left < right) {
    const pivot = values[(left + right) >>> 1]
    let i = left
    let j = right
    while (i <= j) {
      while (values[i] < pivot) i++
      while (values[j] > pivot) j--
      if (i <= j) {
        const tmp = values[i]
        values[i] = values[j]
        values[j] = tmp
        i++
        j--
      }
    }
    if (kth <= j) right = j
    else if (kth >= i) left = i
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
