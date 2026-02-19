export function calc_auto_range(values: number[]): [number, number] {
  if (values.length === 0) return [0, 1]
  let [min_value, max_value] = [values[0], values[0]]
  for (const value of values) {
    if (value < min_value) min_value = value
    else if (value > max_value) max_value = value
  }
  const padding = (max_value - min_value) * 0.05 || 0.5
  return [min_value - padding, max_value + padding]
}
