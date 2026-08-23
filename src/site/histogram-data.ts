// Shared data generation utilities for histogram examples. Every generator takes an `rng`
// last (default Math.random) so demos can pass `seeded_rng(...)` and look the same on reload.

export type Rng = () => number

// Deterministic uniform [0, 1) generator (LCG). Math.imul keeps the multiply in 32-bit
// integer space; a plain `*` exceeds 2^53 and silently drops the low bits.
export const seeded_rng = (seed: number): Rng => {
  let state = seed
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff
    return state / 0x7fffffff
  }
}

// Uniform draw clamped away from zero, so -log(u) stays finite
const positive_uniform = (rng: Rng): number => Math.max(rng(), Number.EPSILON)

// Box-Muller transform for generating normal random numbers
export function box_muller(mean = 0, std_dev = 1, rng: Rng = Math.random): number {
  const rand_1 = positive_uniform(rng)
  const rand_2 = rng()
  const z0 = Math.sqrt(-2 * Math.log(rand_1)) * Math.cos(2 * Math.PI * rand_2)
  return mean + z0 * std_dev
}

// Generate normal distribution data
export function generate_normal(
  count: number,
  mean = 0,
  std_dev = 1,
  rng: Rng = Math.random,
): number[] {
  if (count <= 0) throw new Error(`Count must be positive`)
  return Array.from({ length: count }, () => box_muller(mean, std_dev, rng))
}

// Mix of near-zero (-10..10), positive (0..1000) and negative (-1000..0) values, for
// symlog/arcsinh axis demos
export const generate_signed_data = (count: number, rng: Rng = Math.random): number[] =>
  Array.from({ length: count }, () => {
    const kind = rng()
    if (kind < 0.4) return (rng() - 0.5) * 20
    if (kind < 0.7) return rng() * 1000
    return -rng() * 1000
  })

// Generate exponential distribution data
export function generate_exponential(
  count: number,
  lambda: number,
  rng: Rng = Math.random,
): number[] {
  if (count <= 0) throw new Error(`Count must be positive`)
  if (lambda <= 0) throw new Error(`Lambda must be positive`)

  return Array.from({ length: count }, () => -Math.log(1 - positive_uniform(rng)) / lambda)
}

// Generate uniform distribution data
export function generate_uniform(
  count: number,
  min_val: number,
  max_val: number,
  rng: Rng = Math.random,
): number[] {
  if (count <= 0) throw new Error(`Count must be positive`)
  if (min_val >= max_val) throw new Error(`min_val must be less than max_val`)

  return Array.from({ length: count }, () => min_val + rng() * (max_val - min_val))
}

// Generate log-normal distribution data
export const generate_log_normal = (
  count: number,
  mu: number,
  sigma: number,
  rng: Rng = Math.random,
) => Array.from({ length: count }, () => Math.exp(box_muller(mu, sigma, rng)))

// Generate power law distribution data
export const generate_power_law = (
  count: number,
  alpha: number,
  x_min = 1,
  rng: Rng = Math.random,
) => Array.from({ length: count }, () => x_min * (1 - rng()) ** (-1 / (alpha - 1)))

// Generate Pareto distribution data
export const generate_pareto = (
  count: number,
  x_min: number,
  alpha: number,
  rng: Rng = Math.random,
) => Array.from({ length: count }, () => x_min * rng() ** (-1 / alpha))

// Generate gamma distribution data (approximation)
// Note: This approximation works best for integer alpha values
export function generate_gamma(
  count: number,
  alpha: number,
  beta: number,
  rng: Rng = Math.random,
): number[] {
  if (count <= 0) throw new Error(`Count must be positive`)
  if (alpha <= 0) throw new Error(`Alpha must be positive`)
  if (beta <= 0) throw new Error(`Beta must be positive`)

  // For integer alpha, sum of exponentials is exact
  const is_integer = Math.abs(alpha - Math.round(alpha)) < 1e-10
  const floor_alpha = Math.floor(alpha)
  const frac_alpha = alpha - floor_alpha

  return Array.from({ length: count }, () => {
    let sum = 0
    // Integer part: sum of exponentials
    for (let idx = 0; idx < floor_alpha; idx++) {
      sum += -Math.log(positive_uniform(rng)) / beta
    }

    // Fractional part: beta distribution approximation
    if (frac_alpha > 0 && !is_integer) {
      const u1 = positive_uniform(rng)
      const u2 = positive_uniform(rng)
      const beta_sample =
        u1 ** (1 / frac_alpha) / (u1 ** (1 / frac_alpha) + u2 ** (1 / (1 - frac_alpha)))
      sum += (-Math.log(positive_uniform(rng)) * beta_sample) / beta
    }

    return sum
  })
}

// Generate complex mixture distribution
export const generate_mixture = (count: number, rng: Rng = Math.random) =>
  Array.from({ length: count }, () => {
    const rand = rng()
    if (rand < 0.3) return box_muller(10, 2, rng) // Normal around 10
    if (rand < 0.6) return box_muller(30, 3, rng) // Normal around 30
    if (rand < 0.8) return box_muller(50, 1.5, rng) // Normal around 50
    return box_muller(70, 4, rng) // Normal around 70
  })

// Generate large dataset for performance testing
export const generate_large_dataset = (
  count: number,
  type: `normal` | `uniform`,
  rng: Rng = Math.random,
) => {
  if (count <= 0) throw new Error(`Count must be positive`)
  return type === `uniform`
    ? generate_uniform(count, 0, 100, rng)
    : generate_normal(count, 50, 15, rng)
}

// Generate sparse data with many zeros
export const generate_sparse_data = (count: number, rng: Rng = Math.random) =>
  Array.from({ length: count }, () => {
    if (rng() < 0.7) return 0 // 70% zeros
    return rng() * 100 // 30% random values
  })

// Generate scientific measurement data
export const generate_scientific_data = (count: number, rng: Rng = Math.random) =>
  Array.from({ length: count }, () => {
    const base = rng() * 1000
    const noise = (rng() - 0.5) * 0.1 * base
    return Math.max(0, base + noise)
  })

// Weighted choice function for discrete distributions
const weighted_choice = (weights: number[], rng: Rng): number => {
  const total_weight = weights.reduce((sum, weight) => {
    if (!Number.isFinite(weight) || weight < 0) throw new RangeError(`invalid weights`)
    return sum + weight
  }, 0)
  if (weights.length === 0 || total_weight <= 0) throw new Error(`invalid weights`)

  const threshold = rng() * total_weight
  let cumulative = 0
  for (let idx = 0; idx < weights.length; idx++) {
    cumulative += weights[idx]
    if (threshold < cumulative) return idx
  }
  return weights.length - 1
}

// Generate bimodal distribution data
export const generate_bimodal = (count: number, rng: Rng = Math.random) =>
  Array.from({ length: count }, () => {
    const use_first_mode = rng() < 0.6
    const mean = use_first_mode ? 20 : 60
    const std_dev = use_first_mode ? 8 : 12
    return box_muller(mean, std_dev, rng)
  })

// Generate right-skewed distribution data
export const generate_skewed = (count: number, rng: Rng = Math.random) =>
  Array.from({ length: count }, () => {
    // Sum of exponentials approximates gamma
    let sum = 0
    for (let idx = 0; idx < 3; idx++) sum += -Math.log(positive_uniform(rng)) * 5
    return sum
  })

// Generate discrete distribution data with jitter
export const generate_discrete = (
  count: number,
  weights: number[] = [0.05, 0.08, 0.12, 0.15, 0.18, 0.199, 0.149, 0.05, 0.015, 0.005],
  rng: Rng = Math.random,
) =>
  Array.from({ length: count }, () => {
    const choice = weighted_choice(weights, rng)
    return choice + 1 + rng() * 0.8 - 0.4 // Add jitter
  })

// Generate age distribution data
export const generate_age_distribution = (count: number, rng: Rng = Math.random) =>
  Array.from({ length: count }, () => {
    const rand = rng()
    if (rand < 0.25) return rng() * 18 // 0-18
    if (rand < 0.6) return rng() * 25 + 18 // 18-43
    if (rand < 0.85) return rng() * 22 + 43 // 43-65
    return rng() * 25 + 65 // 65-90
  })

// Generate financial data (stock prices with trends)
export const generate_financial_data = (
  count: number,
  price: number = 100,
  rng: Rng = Math.random,
) =>
  Array.from({ length: count }, () => {
    const change = (rng() - 0.5) * 10 // Random price change
    price = Math.max(1, price + change) // Ensure positive price
    return price
  })

// Generate mixed data with multiple patterns
export const generate_mixed_data = (count: number, rng: Rng = Math.random) =>
  Array.from({ length: count }, () => {
    const rand = rng()
    if (rand < 0.4) return box_muller(20, 5, rng) // Normal around 20
    if (rand < 0.7) return box_muller(60, 8, rng) // Normal around 60
    if (rand < 0.85) return rng() * 100 // Uniform
    return -Math.log(positive_uniform(rng)) * 10 // Exponential
  })

// Generate complex distribution with multiple overlapping patterns
export const generate_complex_distribution = (count: number, rng: Rng = Math.random) =>
  Array.from({ length: count }, () => {
    const rand = rng()
    if (rand < 0.25) return box_muller(15, 3, rng) // Peak 1
    if (rand < 0.5) return box_muller(35, 4, rng) // Peak 2
    if (rand < 0.7) return box_muller(55, 2, rng) // Peak 3
    if (rand < 0.85) return box_muller(75, 6, rng) // Peak 4
    return rng() * 100 // Background noise
  })
