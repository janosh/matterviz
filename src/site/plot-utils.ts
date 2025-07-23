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
  return Array.from({ length: count }, () => box_muller(mean, std_dev))
}

// Generate exponential distribution data
export function generate_exponential(count: number, lambda: number): number[] {
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
  return Array.from(
    { length: count },
    () => min_val + Math.random() * (max_val - min_val),
  )
}

// Generate log-normal distribution data
export function generate_log_normal(count: number, mu: number, sigma: number): number[] {
  return Array.from({ length: count }, () => Math.exp(box_muller(mu, sigma)))
}

// Generate power law distribution data
export function generate_power_law(count: number, alpha: number, x_min = 1): number[] {
  return Array.from({ length: count }, () => {
    const u = Math.random()
    return x_min * Math.pow(1 - u, -1 / (alpha - 1))
  })
}

// Generate Pareto distribution data
export function generate_pareto(count: number, x_min: number, alpha: number): number[] {
  return Array.from({ length: count }, () => {
    const u = Math.random()
    return x_min * Math.pow(u, -1 / alpha)
  })
}

// Generate gamma distribution data (approximation)
export function generate_gamma(count: number, alpha: number, beta: number): number[] {
  return Array.from({ length: count }, () => {
    // Sum of exponentials approximates gamma
    let sum = 0
    for (let k = 0; k < Math.floor(alpha); k++) {
      sum += -Math.log(Math.max(Math.random(), Number.EPSILON)) / beta
    }
    // Add fractional part
    const frac = alpha - Math.floor(alpha)
    if (frac > 0) {
      sum += -Math.log(Math.max(Math.random(), Number.EPSILON)) * frac / beta
    }
    return sum
  })
}

// Generate complex mixture distribution
export function generate_mixture(count: number): number[] {
  return Array.from({ length: count }, () => {
    const rand = Math.random()
    if (rand < 0.3) return box_muller(10, 2) // Normal around 10
    if (rand < 0.6) return box_muller(30, 3) // Normal around 30
    if (rand < 0.8) return box_muller(50, 1.5) // Normal around 50
    return box_muller(70, 4) // Normal around 70
  })
}

// Generate large dataset for performance testing
export function generate_large_dataset(
  count: number,
  type: `normal` | `uniform`,
): number[] {
  switch (type) {
    case `normal`:
      return generate_normal(count, 50, 15)
    case `uniform`:
      return generate_uniform(count, 0, 100)
    default:
      return generate_normal(count, 50, 15)
  }
}

// Generate sparse data with many zeros
export function generate_sparse_data(count: number): number[] {
  return Array.from({ length: count }, () => {
    if (Math.random() < 0.7) return 0 // 70% zeros
    return Math.random() * 100 // 30% random values
  })
}

// Generate scientific measurement data
export function generate_scientific_data(count: number): number[] {
  return Array.from({ length: count }, () => {
    const base = Math.random() * 1000
    const noise = (Math.random() - 0.5) * 0.1 * base
    return Math.max(0, base + noise)
  })
}

// Weighted choice function for discrete distributions
export function weighted_choice(weights: number[]): number {
  const rand = Math.random()
  let cumulative = 0
  for (let idx = 0; idx < weights.length; idx++) {
    cumulative += weights[idx]
    if (rand <= cumulative) return idx
  }
  return weights.length - 1
}

// Generate bimodal distribution data
export function generate_bimodal(count: number): number[] {
  return Array.from({ length: count }, () => {
    const use_first_mode = Math.random() < 0.6
    const mean = use_first_mode ? 20 : 60
    const std_dev = use_first_mode ? 8 : 12
    return box_muller(mean, std_dev)
  })
}

// Generate right-skewed distribution data
export function generate_skewed(count: number): number[] {
  return Array.from({ length: count }, () => {
    // Sum of exponentials approximates gamma
    let sum = 0
    for (let k = 0; k < 3; k++) {
      sum += -Math.log(Math.max(Math.random(), Number.EPSILON)) * 5
    }
    return sum
  })
}

// Generate discrete distribution data with jitter
export function generate_discrete(count: number): number[] {
  const weights = [0.05, 0.08, 0.12, 0.15, 0.18, 0.199, 0.149, 0.05, 0.015, 0.005]
  return Array.from({ length: count }, () => {
    const choice = weighted_choice(weights)
    return choice + 1 + Math.random() * 0.8 - 0.4 // Add jitter
  })
}

// Generate age distribution data
export function generate_age_distribution(count: number): number[] {
  return Array.from({ length: count }, () => {
    const rand = Math.random()
    if (rand < 0.25) return Math.random() * 18 // 0-18
    if (rand < 0.6) return Math.random() * 25 + 18 // 18-43
    if (rand < 0.85) return Math.random() * 22 + 43 // 43-65
    return Math.random() * 25 + 65 // 65-90
  })
}

// Generate financial data (stock prices with trends)
export function generate_financial_data(count: number): number[] {
  let price = 100
  return Array.from({ length: count }, () => {
    const change = (Math.random() - 0.5) * 10 // Random price change
    price = Math.max(1, price + change) // Ensure positive price
    return price
  })
}

// Generate mixed data with multiple patterns
export function generate_mixed_data(count: number): number[] {
  return Array.from({ length: count }, () => {
    const rand = Math.random()
    if (rand < 0.4) return box_muller(20, 5) // Normal around 20
    if (rand < 0.7) return box_muller(60, 8) // Normal around 60
    if (rand < 0.85) return Math.random() * 100 // Uniform
    return -Math.log(Math.max(Math.random(), Number.EPSILON)) * 10 // Exponential
  })
}

// Generate complex distribution with multiple overlapping patterns
export function generate_complex_distribution(count: number): number[] {
  return Array.from({ length: count }, () => {
    const rand = Math.random()
    if (rand < 0.25) return box_muller(15, 3) // Peak 1
    if (rand < 0.5) return box_muller(35, 4) // Peak 2
    if (rand < 0.7) return box_muller(55, 2) // Peak 3
    if (rand < 0.85) return box_muller(75, 6) // Peak 4
    return Math.random() * 100 // Background noise
  })
}
