// Equations of state E(V) for energy–volume scans: closed-form energy and pressure for the
// Birch–Murnaghan (3rd order), Murnaghan and Vinet forms, and a least-squares fit of their four
// parameters (E0, V0, B0, B0') by Levenberg–Marquardt seeded from a parabola through the data.
// Energies in eV, volumes in A^3, so B0 comes out in eV/A^3 (× EV_PER_A3_TO_GPA for GPa).
import { array_max, array_min, dot, solve_linear_system } from '$lib/math'

export const EOS_KINDS = [`birch_murnaghan`, `murnaghan`, `vinet`] as const
export type EosKind = (typeof EOS_KINDS)[number]

export const EOS_KIND_LABELS: Record<EosKind, string> = {
  birch_murnaghan: `Birch–Murnaghan`,
  murnaghan: `Murnaghan`,
  vinet: `Vinet`,
}

export interface EosParams {
  e0: number // minimum energy, eV
  v0: number // equilibrium volume, A^3
  b0: number // bulk modulus at V0, eV/A^3
  b0_prime: number // pressure derivative of the bulk modulus, dimensionless
}

export interface EosFit extends EosParams {
  kind: EosKind
  rmse: number // root-mean-square energy residual, eV
}

// E(V) of each form. Birch–Murnaghan is the Eulerian-strain series to 3rd order, Murnaghan
// assumes B(P) = B0 + B0'·P and Vinet is the universal (Rose–Vinet) binding-energy form.
// Written so that eos_gradient below shares the same intermediate quantities:
//   BM:        E = E0 + (9 B0 V0 / 16) · h(s),     s = (V0/V)^(2/3) − 1, h = (B0' − 4) s³ + 2 s²
//   Murnaghan: E = E0 + (B0 V / B0') (r^B0' / (B0' − 1) + 1) − B0 V0 / (B0' − 1),  r = V0/V
//   Vinet:     E = E0 + (4 B0 V0 / (B0' − 1)²) · G(t), t = 3 (B0' − 1)(η − 1) / 2, η = (V/V0)^(1/3),
//              G = 1 − (1 + t) e^(−t)
// Murnaghan and Vinet divide by B0' − 1 (Murnaghan also by B0'): removable singularities far
// from physical B0' ≈ 3–6, so they are left as NaN rather than special-cased. The fitter never
// lands on them (a NaN trial cost is rejected as "not downhill").
export function eos_energy(kind: EosKind, params: EosParams, volume: number): number {
  const { e0, v0, b0, b0_prime } = params
  if (kind === `birch_murnaghan`) {
    const strain = (v0 / volume) ** (2 / 3) - 1
    return e0 + ((9 * b0 * v0) / 16) * ((b0_prime - 4) * strain ** 3 + 2 * strain ** 2)
  }
  const pm1 = b0_prime - 1
  if (kind === `murnaghan`) {
    return (
      e0 + ((b0 * volume) / b0_prime) * ((v0 / volume) ** b0_prime / pm1 + 1) - (b0 * v0) / pm1
    )
  }
  const t_arg = (3 * pm1 * ((volume / v0) ** (1 / 3) - 1)) / 2
  return e0 + ((4 * b0 * v0) / pm1 ** 2) * (1 - (1 + t_arg) * Math.exp(-t_arg))
}

// ∂E/∂(E0, V0, B0, B0') of each form at one volume, for the least-squares Jacobian
export function eos_gradient(kind: EosKind, params: EosParams, volume: number): EosParams {
  const { e0, v0, b0, b0_prime } = params
  const b0_deriv = (eos_energy(kind, params, volume) - e0) / b0 // E − E0 is linear in B0
  if (kind === `birch_murnaghan`) {
    const strain = (v0 / volume) ** (2 / 3) - 1
    const h_val = (b0_prime - 4) * strain ** 3 + 2 * strain ** 2
    const h_deriv = 3 * (b0_prime - 4) * strain ** 2 + 4 * strain
    // ds/dV0 = (2/3)(s + 1)/V0
    return {
      e0: 1,
      v0: ((9 * b0) / 16) * (h_val + (2 / 3) * (strain + 1) * h_deriv),
      b0: b0_deriv,
      b0_prime: ((9 * b0 * v0) / 16) * strain ** 3,
    }
  }
  const pm1 = b0_prime - 1
  if (kind === `murnaghan`) {
    const ratio = v0 / volume
    const ratio_pow = ratio ** b0_prime
    return {
      e0: 1,
      v0: (b0 * (ratio ** pm1 - 1)) / pm1,
      b0: b0_deriv,
      b0_prime:
        (-(b0 * volume) / b0_prime ** 2) * (ratio_pow / pm1 + 1) +
        ((b0 * volume) / b0_prime) * ratio_pow * (Math.log(ratio) / pm1 - 1 / pm1 ** 2) +
        (b0 * v0) / pm1 ** 2,
    }
  }
  const eta = (volume / v0) ** (1 / 3)
  const t_arg = (3 * pm1 * (eta - 1)) / 2
  const exp_neg = Math.exp(-t_arg)
  const g_val = 1 - (1 + t_arg) * exp_neg
  // dG/dt = t e^(−t); dt/dV0 = −(B0' − 1) η / (2 V0); dt/dB0' = t / (B0' − 1)
  return {
    e0: 1,
    v0: ((4 * b0) / pm1 ** 2) * (g_val - (t_arg * exp_neg * pm1 * eta) / 2),
    b0: b0_deriv,
    b0_prime: ((4 * b0 * v0) / pm1 ** 3) * (t_arg ** 2 * exp_neg - 2 * g_val),
  }
}

// P(V) = −dE/dV of each form, in eV/A^3
export function eos_pressure(kind: EosKind, params: EosParams, volume: number): number {
  const { v0, b0, b0_prime } = params
  if (kind === `birch_murnaghan`) {
    const ratio = (v0 / volume) ** (1 / 3)
    return (
      1.5 * b0 * (ratio ** 7 - ratio ** 5) * (1 + 0.75 * (b0_prime - 4) * (ratio ** 2 - 1))
    )
  }
  if (kind === `murnaghan`) return (b0 / b0_prime) * ((v0 / volume) ** b0_prime - 1)
  const eta = (volume / v0) ** (1 / 3)
  return ((3 * b0 * (1 - eta)) / eta ** 2) * Math.exp(1.5 * (b0_prime - 1) * (1 - eta))
}

export const PARAM_KEYS = [`e0`, `v0`, `b0`, `b0_prime`] as const

// Parabola through the lowest-energy point and its two neighbours in volume, read off as an
// EOS guess: V0 at the vertex, E0 = E(V0), B0 = V0·d²E/dV² and the near-universal B0' ≈ 4.
function parabola_guess(volumes: readonly number[], energies: readonly number[]): EosParams {
  const order = volumes
    .map((_, idx) => idx)
    .toSorted((idx_a, idx_b) => volumes[idx_a] - volumes[idx_b])
  const min_pos = order.indexOf(energies.indexOf(Math.min(...energies)))
  // Same guard as pymatgen's EOS: a scan that does not bracket its minimum starts the
  // 4-parameter fit far from the truth and can settle in a wrong local minimum without any
  // symptom other than a large RMSE, so refuse it up front. Judged by the lowest-energy point,
  // not the parabola vertex: anharmonicity biases the vertex low, so a scan with more expansion
  // than compression can put the vertex outside the range while V0 itself is well inside.
  if (min_pos === 0 || min_pos === order.length - 1) {
    throw new Error(
      `EOS fit: lowest energy is at the edge of the scan (V=${volumes[order[min_pos]]} of [${volumes[order[0]]}, ${volumes[order.at(-1) ?? 0]}]); the scan must bracket the energy minimum`,
    )
  }
  const [[v_a, e_a], [v_b, e_b], [v_c, e_c]] = order
    .slice(min_pos - 1, min_pos + 2)
    .map((idx) => [volumes[idx], energies[idx]])
  // Newton form E = e_a + slope (V − v_a) + curvature (V − v_a)(V − v_b)
  const slope = (e_b - e_a) / (v_b - v_a)
  const curvature = ((e_c - e_b) / (v_c - v_b) - slope) / (v_c - v_a)
  if (!(curvature > 0)) {
    throw new Error(`EOS fit: energies have no minimum in volume (curvature ${curvature})`)
  }
  const v0 = (v_a + v_b) / 2 - slope / (2 * curvature)
  return {
    e0: e_a + slope * (v0 - v_a) + curvature * (v0 - v_a) * (v0 - v_b),
    v0,
    b0: 2 * curvature * v0,
    b0_prime: 4,
  }
}

const MAX_ITERATIONS = 500
const REL_STEP_TOL = 1e-12

// Fit the four EOS parameters to an energy–volume scan. Throws on malformed input (mismatched
// lengths, fewer than four volumes, repeated volumes, non-finite values), a scan that does not
// bracket its energy minimum, or a fit that diverges.
export function fit_eos(
  volumes: readonly number[],
  energies: readonly number[],
  kind: EosKind = `birch_murnaghan`,
): EosFit {
  if (!EOS_KINDS.includes(kind)) throw new Error(`Unknown EOS kind ${JSON.stringify(kind)}`)
  if (volumes.length !== energies.length) {
    throw new Error(`EOS fit: ${volumes.length} volumes but ${energies.length} energies`)
  }
  // Finiteness first: NaN volumes are all "distinct" to a Set and would pass as such
  const bad_idx = volumes.findIndex(
    (vol, idx) => !(Number.isFinite(vol) && vol > 0) || !Number.isFinite(energies[idx]),
  )
  if (bad_idx !== -1) {
    throw new Error(
      `EOS fit: volumes must be finite and positive and energies finite, got V=${volumes[bad_idx]}, E=${energies[bad_idx]} at index ${bad_idx}`,
    )
  }
  if (volumes.length < 4)
    throw new Error(`EOS fit needs at least 4 volumes, got ${volumes.length}`)
  if (new Set(volumes).size !== volumes.length) {
    throw new Error(`EOS fit: volumes must be distinct, got ${JSON.stringify(volumes)}`)
  }

  const residuals = (params: EosParams): number[] =>
    volumes.map((vol, idx) => eos_energy(kind, params, vol) - energies[idx])

  let params = parabola_guess(volumes, energies)
  let res = residuals(params)
  let current_cost = dot(res, res)
  let damping = 1e-3
  let converged = false
  for (let iter = 0; iter < MAX_ITERATIONS && !converged; iter++) {
    // Jacobian of the residuals, one column per parameter, with Marquardt scaling: each column
    // is normalized so the normal matrix has a unit diagonal. The eV, A^3 and eV/A^3 columns can
    // differ by 1e10 (soft materials, tiny cells), which the solver's largest-entry pivot test
    // would otherwise reject as singular, and it lets one damping factor act on every parameter
    // relative to its own curvature
    const gradients = volumes.map((vol) => eos_gradient(kind, params, vol))
    const scale = PARAM_KEYS.map((key) => Math.hypot(...gradients.map((grad) => grad[key])))
    const jacobian = PARAM_KEYS.map((key, col) =>
      gradients.map((grad) => grad[key] / scale[col]),
    )
    const normal = jacobian.map((col_a) => jacobian.map((col_b) => dot(col_a, col_b)))
    const rhs = jacobian.map((col) => -dot(col, res))

    // Restart the ladder each outer iteration, as textbook LM does: a carried-over damping of
    // 1e11 froze every later step at ~1e-11 of Gauss-Newton and was read as convergence
    damping = Math.min(damping, 1e-3)
    let moved = false
    while (damping < 1e12) {
      const damped = normal.map((row, idx) => row.with(idx, 1 + damping))
      const step = solve_linear_system(damped, rhs)?.map((val, idx) => val / scale[idx])
      if (!step) {
        damping *= 4
        continue
      }
      const [e0, v0, b0, b0_prime] = PARAM_KEYS.map((key, idx) => params[key] + step[idx])
      const trial = { e0, v0, b0, b0_prime }
      const trial_res = residuals(trial)
      const trial_cost = dot(trial_res, trial_res)
      // uphill and non-finite trials raise the damping
      if (!(trial_cost < current_cost)) {
        damping *= 4
        continue
      }
      // converged once every parameter moves by less than REL_STEP_TOL of its magnitude
      // (or of 1 for parameters near zero, e.g. E0 of energies referenced to the minimum)
      moved = step.some(
        (val, idx) =>
          Math.abs(val) > REL_STEP_TOL * Math.max(Math.abs(params[PARAM_KEYS[idx]]), 1),
      )
      params = trial
      res = trial_res
      current_cost = trial_cost
      damping = Math.max(damping / 3, 1e-15)
      break
    }
    // tiny step, or no downhill direction left; with the reset above, an exhausted ladder
    // means |Jᵀr| really is stationary
    converged = !moved
  }

  const { v0, b0, b0_prime } = params
  if (!Object.values(params).every(Number.isFinite) || v0 <= 0 || b0 <= 0) {
    throw new Error(`EOS fit (${kind}) diverged: ${JSON.stringify(params)}`)
  }
  if (!converged) {
    throw new Error(
      `EOS fit (${kind}) did not converge in ${MAX_ITERATIONS} iterations: ${JSON.stringify(params)}`,
    )
  }
  // V0 outside the scanned volumes is an extrapolation the data cannot support and B0' <= 1
  // sits on the 1/(B0' - 1)^2 pole of the Murnaghan and Vinet forms
  const [v_min, v_max] = [array_min(volumes), array_max(volumes)]
  if (v0 < v_min || v0 > v_max || b0_prime <= 1) {
    throw new Error(
      `EOS fit (${kind}) is unphysical: V0 = ${v0} A^3 must lie inside the scanned range [${v_min}, ${v_max}] A^3 and B0' = ${b0_prime} must exceed 1`,
    )
  }
  return { kind, ...params, rmse: Math.sqrt(current_cost / volumes.length) }
}
