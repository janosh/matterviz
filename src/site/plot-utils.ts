// Shared data generation utilities for histogram examples

// Box-Muller transform for generating normal random numbers
export function box_muller(mean = 0, std_dev = 1): number {
  const u1 = Math.max(Math.random(), Number.EPSILON)
  const u2 = Math.random()
  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return mean + z0 * std_dev
}

// Generate normal distribution data
export function generate_normal(count: number, mean = 0, std_dev = 1): number[] {
  if (count <= 0) throw new Error(`Count must be positive`)
  return Array.from({ length: count }, () => box_muller(mean, std_dev))
}

// Generate exponential distribution data
export function generate_exponential(count: number, lambda: number): number[] {
  if (count <= 0) throw new Error(`Count must be positive`)
  if (lambda <= 0) throw new Error(`Lambda must be positive`)

  return Array.from({ length: count }, () => {
    const u = Math.max(Math.random(), Number.EPSILON)
    return -Math.log(1 - u) / lambda
  })
}

// Generate uniform distribution data
export function generate_uniform(
  count: number,
  min_val: number,
  max_val: number,
): number[] {
  if (count <= 0) throw new Error(`Count must be positive`)
  if (min_val >= max_val) throw new Error(`min_val must be less than max_val`)

  return Array.from(
    { length: count },
    () => min_val + Math.random() * (max_val - min_val),
  )
}

// Generate log-normal distribution data
export const generate_log_normal = (count: number, mu: number, sigma: number) =>
  Array.from({ length: count }, () => Math.exp(box_muller(mu, sigma)))

// Generate power law distribution data
export const generate_power_law = (count: number, alpha: number, x_min = 1) =>
  Array.from({ length: count }, () => {
    const u = Math.random()
    return x_min * Math.pow(1 - u, -1 / (alpha - 1))
  })

// Generate Pareto distribution data
export const generate_pareto = (count: number, x_min: number, alpha: number) =>
  Array.from({ length: count }, () => {
    const u = Math.random()
    return x_min * Math.pow(u, -1 / alpha)
  })

// Generate gamma distribution data (approximation)
// Note: This approximation works best for integer alpha values
export function generate_gamma(count: number, alpha: number, beta: number): number[] {
  if (count <= 0) throw new Error(`Count must be positive`)
  if (alpha <= 0) throw new Error(`Alpha must be positive`)
  if (beta <= 0) throw new Error(`Beta must be positive`)

  return Array.from({ length: count }, () => {
    // For integer alpha, sum of exponentials is exact
    const is_integer = Math.abs(alpha - Math.round(alpha)) < 1e-10
    const floor_alpha = Math.floor(alpha)
    const frac_alpha = alpha - floor_alpha

    let sum = 0
    // Integer part: sum of exponentials
    for (let k = 0; k < floor_alpha; k++) {
      sum += -Math.log(Math.max(Math.random(), Number.EPSILON)) / beta
    }

    // Fractional part: beta distribution approximation
    if (frac_alpha > 0 && !is_integer) {
      const u1 = Math.max(Math.random(), Number.EPSILON)
      const u2 = Math.max(Math.random(), Number.EPSILON)
      const beta_sample = Math.pow(u1, 1 / frac_alpha) /
        (Math.pow(u1, 1 / frac_alpha) + Math.pow(u2, 1 / (1 - frac_alpha)))
      sum += -Math.log(Math.max(Math.random(), Number.EPSILON)) * beta_sample / beta
    }

    return sum
  })
}

// Generate complex mixture distribution
export const generate_mixture = (count: number) =>
  Array.from({ length: count }, () => {
    const rand = Math.random()
    if (rand < 0.3) return box_muller(10, 2) // Normal around 10
    if (rand < 0.6) return box_muller(30, 3) // Normal around 30
    if (rand < 0.8) return box_muller(50, 1.5) // Normal around 50
    return box_muller(70, 4) // Normal around 70
  })

// Generate large dataset for performance testing
export const generate_large_dataset = (count: number, type: `normal` | `uniform`) => {
  if (count <= 0) throw new Error(`Count must be positive`)

  if (type === `normal`) return generate_normal(count, 50, 15)
  else if (type === `uniform`) return generate_uniform(count, 0, 100)
  else return generate_normal(count, 50, 15)
}

// Generate sparse data with many zeros
export const generate_sparse_data = (count: number) =>
  Array.from({ length: count }, () => {
    if (Math.random() < 0.7) return 0 // 70% zeros
    return Math.random() * 100 // 30% random values
  })

// Generate scientific measurement data
export const generate_scientific_data = (count: number) =>
  Array.from({ length: count }, () => {
    const base = Math.random() * 1000
    const noise = (Math.random() - 0.5) * 0.1 * base
    return Math.max(0, base + noise)
  })

// Weighted choice function for discrete distributions
export const weighted_choice = (weights: number[]): number => {
  const total_weight = weights.reduce((sum, weight) => {
    if (!Number.isFinite(weight) || weight < 0) throw new RangeError(`invalid weights`)
    return sum + weight
  }, 0)
  if (weights.length === 0 || total_weight <= 0) throw new Error(`invalid weights`)

  const threshold = Math.random() * total_weight
  let cumulative = 0
  for (let idx = 0; idx < weights.length; idx++) {
    cumulative += weights[idx]
    if (threshold < cumulative) return idx
  }
  return weights.length - 1
}

// Generate bimodal distribution data
export const generate_bimodal = (count: number) =>
  Array.from({ length: count }, () => {
    const use_first_mode = Math.random() < 0.6
    const mean = use_first_mode ? 20 : 60
    const std_dev = use_first_mode ? 8 : 12
    return box_muller(mean, std_dev)
  })

// Generate right-skewed distribution data
export const generate_skewed = (count: number) =>
  Array.from({ length: count }, () => {
    // Sum of exponentials approximates gamma
    let sum = 0
    for (let k = 0; k < 3; k++) {
      sum += -Math.log(Math.max(Math.random(), Number.EPSILON)) * 5
    }
    return sum
  })

// Generate discrete distribution data with jitter
export const generate_discrete = (
  count: number,
  weights: number[] = [0.05, 0.08, 0.12, 0.15, 0.18, 0.199, 0.149, 0.05, 0.015, 0.005],
) =>
  Array.from({ length: count }, () => {
    const choice = weighted_choice(weights)
    return choice + 1 + Math.random() * 0.8 - 0.4 // Add jitter
  })

// Generate age distribution data
export const generate_age_distribution = (count: number) =>
  Array.from({ length: count }, () => {
    const rand = Math.random()
    if (rand < 0.25) return Math.random() * 18 // 0-18
    if (rand < 0.6) return Math.random() * 25 + 18 // 18-43
    if (rand < 0.85) return Math.random() * 22 + 43 // 43-65
    return Math.random() * 25 + 65 // 65-90
  })

// Generate financial data (stock prices with trends)
export const generate_financial_data = (count: number, price: number = 100) =>
  Array.from({ length: count }, () => {
    const change = (Math.random() - 0.5) * 10 // Random price change
    price = Math.max(1, price + change) // Ensure positive price
    return price
  })

// Generate mixed data with multiple patterns
export const generate_mixed_data = (count: number) =>
  Array.from({ length: count }, () => {
    const rand = Math.random()
    if (rand < 0.4) return box_muller(20, 5) // Normal around 20
    if (rand < 0.7) return box_muller(60, 8) // Normal around 60
    if (rand < 0.85) return Math.random() * 100 // Uniform
    return -Math.log(Math.max(Math.random(), Number.EPSILON)) * 10 // Exponential
  })

// Generate complex distribution with multiple overlapping patterns
export const generate_complex_distribution = (count: number) =>
  Array.from({ length: count }, () => {
    const rand = Math.random()
    if (rand < 0.25) return box_muller(15, 3) // Peak 1
    if (rand < 0.5) return box_muller(35, 4) // Peak 2
    if (rand < 0.7) return box_muller(55, 2) // Peak 3
    if (rand < 0.85) return box_muller(75, 6) // Peak 4
    return Math.random() * 100 // Background noise
  })
