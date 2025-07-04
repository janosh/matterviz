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

// Generate financial data with log-normal distribution
export function generate_financial_data(count: number): number[] {
  return Array.from({ length: count }, () => {
    const exponent = 4.5 + box_muller(0, 0.5)
    // Clamp to prevent overflow (exp(709) is near JS max safe float)
    return Math.exp(Math.min(exponent, 700))
  })
}

// Generate mixed data with multiple patterns
export function generate_mixed_data(count: number): number[] {
  return Array.from({ length: count }, () => {
    const rand = Math.random()
    if (rand < 0.3) return 10 + (Math.random() - 0.5) * 6 // Small peak around 10
    if (rand < 0.7) return 40 + (Math.random() - 0.5) * 20 // Large peak around 40
    return Math.random() * 80 // Uniform background
  })
}
