import { HARTREE_TO_EV, THZ_TO_INVERSE_CM } from '#lib/constants.js'
import type { Matrix3x3, Vec2, Vec3 } from '#lib/math.js'
import {
  canonical_frequency_unit,
  convert_frequencies,
  frequency_unit_label,
  frequency_unit_text,
} from '#lib/spectral/frequency-units.js'
import type { PymatgenCompleteDos } from '#lib/spectral/helpers.js'
import {
  ACOUSTIC_FREQ_THRESHOLD,
  are_qpoints_equivalent,
  band_crossings,
  band_k_path,
  display_smoother,
  gaussian_kernel_smooth,
  branch_path_label,
  branch_segment_keys,
  build_point_metadata,
  classify_acoustic,
  compute_frequency_range,
  density_divisor,
  extract_k_path_points,
  extract_pdos,
  find_gamma_indices,
  branch_qpoint_range,
  find_qpoint_at_rescaled_x,
  frac_k_to_cartesian,
  generate_ribbon_path,
  is_electronic_band_struct,
  negative_fraction,
  normalize_band_structure,
  trapezoid_weights,
  electronic_band_gap,
  normalize_dos,
  pretty_sym_point,
  qpoint_x_position,
  resolve_spin_mode,
  shift_bands_to_fermi,
  shift_to_fermi,
} from '#lib/spectral/helpers.js'
import type { BaseBandStructure, QPoint } from '#lib/spectral/types.js'
import { parse_phonon_modes } from '#lib/spectral/parse-phonon-modes.js'
import { phonon_band_structure_from_modes } from '#lib/spectral/phonon-modes.js'
import cao_json from '#site/electronic/bands/cao-2605-bands.json.gz?raw'
import vbr2_json from '#site/electronic/bands/vbr2-971787-bands.json.gz?raw'
import mgb2_band_yaml from '#site/phonons/ir-raman/MgB2-band.yaml.gz?raw'
import * as math from '#lib/math.js'
import { IDENTITY_MATRIX3 } from '../test-fixtures'
import { describe, expect, it, vi } from 'vite-plus/test'

// pymatgen input needs a reciprocal lattice to measure its k-path; the identity keeps the
// hand-computed fractional distances valid
const identity_rec = { lattice_rec: { matrix: IDENTITY_MATRIX3 } }

const make_branch = (start_index: number, end_index: number, name: string) => ({
  start_index,
  end_index,
  name,
})
// Band structure along a labelled path with unit spacing; `labels[idx]` null for interior points
const make_bs = (
  labels: (string | null)[],
  overrides: Partial<BaseBandStructure> = {},
): BaseBandStructure => {
  const qpoints: QPoint[] = labels.map((label, idx) => ({
    label,
    frac_coords: [idx / Math.max(1, labels.length - 1), 0, 0],
  }))
  const label_indices = labels.flatMap((label, idx) => (label ? [idx] : []))
  const branches = label_indices.slice(1).map((end_index, branch_idx) => {
    const start_index = label_indices[branch_idx]
    return make_branch(start_index, end_index, `${labels[start_index]}-${labels[end_index]}`)
  })
  const bands = overrides.bands ?? [qpoints.map((_, idx) => idx)]
  return {
    type: `phonon`,
    qpoints,
    branches: branches.length ? branches : [make_branch(0, qpoints.length - 1, `path`)],
    distance: qpoints.map((_, idx) => idx),
    bands,
    nb_bands: bands.length,
    labels_dict: {},
    ...overrides,
  }
}

it.each([
  [[0.25, 0, 0.5], [1.25, -1, 0.5], true],
  [[0.25, 0, 0.5], [0.250002, 0, 0.5], false],
] as [Vec3, Vec3, boolean][])(
  `are_qpoints_equivalent(%j, %j) → %s`,
  (first, second, expected) => {
    expect(are_qpoints_equivalent(first, second)).toBe(expected)
  },
)

it.each([
  [`GAMMA`, `Γ`],
  [`\\Gamma`, `Γ`],
  [`SIGMA3`, `Σ₃`],
  [`LAMBDA`, `Λ`],
  [`X1`, `X₁`],
  [`K12`, `K₁₂`],
  [`S_0`, `S₀`],
  [`GAMMA_1`, `Γ₁`],
  // phonopy BAND_LABELS are LaTeX math; the `$` used to reach the tick labels
  [`$\\Gamma$`, `Γ`],
  [`$\\mathrm{X}$`, `X`],
  [`$S_{0}$`, `S₀`],
  [``, ``],
])(`pretty_sym_point(%s) → %s`, (input, expected) => {
  expect(pretty_sym_point(input)).toBe(expected)
})

describe(`convert_frequencies`, () => {
  // CODATA 2018: h·1 THz = 4.135667696e-3 eV; 1 THz = 33.35640952 cm^-1; 1 Ha = 27.211386 eV
  it.each([
    [`THz`, 1],
    [`eV`, 4.135667696e-3],
    [`meV`, 4.135667696],
    [`cm^-1`, 33.35640951981521],
    [`Ha`, 4.135667696e-3 / 27.211386245981],
  ] as const)(`1 THz = %f %s to 1e-9 relative`, (unit, per_thz) => {
    const [value] = convert_frequencies([1], unit)
    expect(Math.abs(value / per_thz - 1)).toBeLessThan(1e-9)
  })

  it(`maps every element, returns the same array for THz and rejects unknown units`, () => {
    const [one, two] = convert_frequencies([1, 2], `meV`)
    expect(one).toBeCloseTo(4.135667696, 8)
    expect(two).toBeCloseTo(8.271335392, 8)
    const input = [1, 2]
    expect(convert_frequencies(input, `THz`)).toBe(input)
    // both sides default to THz, so the one-arg form is a no-op
    expect(convert_frequencies(input)).toBe(input)
    expect(() => convert_frequencies([1], `GHz` as never)).toThrow(/Invalid unit: GHz/)
    // an inherited key is no unit either: `constructor` returned Object as the factor (NaN)
    expect(() => convert_frequencies([1], `constructor` as never)).toThrow(/Invalid unit/)
    // a component's `units` prop: aliases canonicalize, an unknown unit throws at the prop
    expect(canonical_frequency_unit(` CM-1 `)).toBe(`cm^-1`)
    expect(() => canonical_frequency_unit(`GHz`)).toThrow(/Invalid unit: GHz. Must be one of/)
  })
})

describe(`density_divisor`, () => {
  const densities = [1, 2, 3, 2, 1]
  const energies = [0, 1, 2, 3, 4]
  // trapezoid weights [0.5, 1, 1, 1, 0.5] give ∫ = 8, not the 9 a left-Riemann sum reports.
  // Channels (e.g. both spins) share one divisor: the max over all, or their summed sum/∫
  it.each([
    [`max`, 3, 3],
    [`sum`, 9, 9 + 4.5],
    [`integral`, 8, 8 + 4],
    [null, 1, 1],
  ] as const)(`mode %s`, (mode, divisor, two_channel_divisor) => {
    expect(density_divisor([densities], energies, mode)).toBe(divisor)
    const half = densities.map((val) => val / 2)
    expect(density_divisor([densities, half], energies, mode)).toBe(two_channel_divisor)
  })

  // the old left-Riemann sum read only x[1] - x[0]: 11.1% low on a uniform grid, 245% off here
  it(`integral mode makes ∫ = 1 on a non-uniform grid; degenerate and huge inputs`, () => {
    const grid = [0, 0.1, 0.2, 3, 10]
    const divisor = density_divisor([densities], grid, `integral`)
    const normalized = densities.map((val) => val / divisor)
    const integral = grid
      .slice(1)
      .reduce(
        (acc, x_val, idx) =>
          acc + ((normalized[idx] + normalized[idx + 1]) / 2) * (x_val - grid[idx]),
        0,
      )
    expect(integral).toBeCloseTo(1, 12)
    expect(density_divisor([[0, 0]], [0, 1], `max`)).toBe(1)
    expect(density_divisor([[1]], [0], `integral`)).toBe(1)
    // all-negative channels must not flip the curve's sign
    expect(density_divisor([[-2, -1]], [0, 1], `max`)).toBe(1)
    // Math.max(...densities) overflows the argument limit; DOS grids reach 1e7 points
    const large = Array.from({ length: 300_000 }, (_, idx) => (idx % 97) + 1)
    expect(density_divisor([large], large, `max`)).toBe(97)
  })
})

// The ascending fast path and the index-sorting path must give the same measure bit for bit:
// a shuffled or reversed grid gets the ascending grid's weights, permuted with it
it.each([
  [`uniform`, [0, 0.5, 1, 1.5, 2]],
  [`clustered`, [0, 0.1, 0.2, 3, 10]],
  [`negative`, [-7, -3.5, -3, 0.25, 4]],
])(`trapezoid_weights on a %s grid is order-independent`, (_label, ascending) => {
  const weights = trapezoid_weights(ascending)
  expect(weights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(
    ascending[ascending.length - 1] - ascending[0],
    14,
  )
  expect(trapezoid_weights(ascending.toReversed())).toEqual(weights.toReversed())
  const order = [3, 0, 4, 1, 2]
  const shuffled = order.map((idx) => ascending[idx])
  expect(trapezoid_weights(shuffled)).toEqual(order.map((idx) => weights[idx]))
})

// display_smoother draws a spectral density at a width's resolution: a dense comb of mode
// peaks melts into a curve keeping its area, a constant stays exact to the grid's ends, a width
// under the sampling leaves the curve as given, and a dense grid is binned so it stays O(n)
describe(`display_smoother`, () => {
  const grid = Array.from({ length: 1001 }, (_, idx) => idx * 0.05) // 0 to 50
  const comb = grid.map((_, idx) => (idx % 10 === 5 && idx > 100 && idx < 900 ? 1 : 0))
  const area = (xs: readonly number[], ys: readonly number[]) =>
    ys
      .slice(1)
      .reduce((sum, y_val, idx) => sum + ((y_val + ys[idx]) * (xs[idx + 1] - xs[idx])) / 2, 0)

  it(`melts a dense comb of peaks into a curve keeping its area`, () => {
    const { x, smooth } = display_smoother(grid, 50 / 300)
    const smoothed = smooth(comb)
    expect(x).toEqual(grid)
    expect(Math.max(...smoothed)).toBeLessThan(0.4)
    expect(area(x, smoothed)).toBeCloseTo(area(grid, comb), 3)
  })
  it.each([
    [`a constant stays exact up to the grid's ends`, 1, grid.map(() => 2), grid.map(() => 2)],
    [`a width under the sampling leaves the curve as given`, 0.005, comb, comb],
  ])(`%s`, (_desc, width, values, expected) => {
    const smoothed = display_smoother(grid, width).smooth(values)
    smoothed.forEach((value, idx) => expect(value).toBeCloseTo(expected[idx], 9))
  })
  it(`skips a NaN sample without spreading it`, () => {
    const holed = comb.map((value, idx) => (idx === 500 ? NaN : value))
    const { smooth } = display_smoother(grid, 0.2)
    const [clean, with_hole] = [smooth(comb), smooth(holed)]
    expect(with_hole.every(Number.isFinite)).toBe(true)
    // beyond the ±4 widths window around the hole nothing changes
    expect(with_hole.slice(0, 480)).toEqual(clean.slice(0, 480))
  })
  it(`smooths a descending grid as its ascending twin, in its own order`, () => {
    const ascending = display_smoother(grid, 0.2).smooth(comb)
    const descending = display_smoother(grid.toReversed(), 0.2)
    expect(descending.x).toEqual(grid.toReversed())
    const reversed = descending.smooth(comb.toReversed()).toReversed()
    reversed.forEach((value, idx) => expect(value).toBeCloseTo(ascending[idx], 12))
  })
  it(`bins a dense grid, staying fast and keeping the area`, () => {
    const dense = Array.from({ length: 100_001 }, (_, idx) => idx * 0.0005) // 0 to 50
    const spiky = dense.map((_, idx) => (idx % 97 === 0 ? 5 : 0.1))
    const start = performance.now()
    const { x, smooth } = display_smoother(dense, 50 / 300)
    const smoothed = smooth(spiky)
    expect(performance.now() - start).toBeLessThan(500)
    expect(x).toHaveLength(Math.ceil(50 / (50 / 300 / 4)))
    expect(area(x, smoothed)).toBeCloseTo(area(dense, spiky), 1)
  })
  it(`keeps a 1 eV gap open on a 52 eV span`, () => {
    const energies = Array.from({ length: 5001 }, (_, idx) => -25 + idx * 0.01)
    const gapped = energies.map((energy) => (Math.abs(energy) < 0.5 ? 0 : 1))
    const { x, smooth } = display_smoother(energies, 52 / 300) // binned: 100 samples per eV
    const smoothed = smooth(gapped)
    const mid_gap = x.reduce(
      (best, energy, idx) => (Math.abs(energy) < Math.abs(x[best]) ? idx : best),
      0,
    )
    expect(smoothed[mid_gap]).toBeLessThan(0.05)
  })
})

describe(`gaussian_kernel_smooth`, () => {
  it(`is exact on constants over a clustered grid and still smooths`, () => {
    const clustered = [
      ...Array.from({ length: 40 }, (_, idx) => -4 + idx * 0.1),
      ...Array.from({ length: 60 }, (_, idx) => idx * 0.005),
      ...Array.from({ length: 40 }, (_, idx) => 0.3 + idx * 0.1),
    ]
    for (const val of gaussian_kernel_smooth(
      clustered,
      clustered.map(() => 1),
      0.3,
    )) {
      expect(val).toBeCloseTo(1, 12)
    }
    const alternating = clustered.map((_unused, idx) => (idx % 2 === 0 ? 1 : -1))
    const smoothed = gaussian_kernel_smooth(clustered, alternating, 0.3)
    for (const val of smoothed.slice(45, 55)) expect(Math.abs(val)).toBeLessThan(0.5)
    expect(gaussian_kernel_smooth(clustered, alternating, 0)).toBe(alternating) // sigma <= 0
  })

  // The two-pointer window is only valid on an ascending grid; anything else falls back to
  // scanning every point. Pin both to an unwindowed reference.
  const brute_force = (x_values: number[], y_values: number[], sigma: number): number[] =>
    x_values.map((center) => {
      const kernels = x_values.map((other) =>
        Math.abs(center - other) > 4 * sigma
          ? 0
          : Math.exp(-((center - other) ** 2) / (2 * sigma ** 2)),
      )
      const total = kernels.reduce((sum, kernel) => sum + kernel, 0)
      return kernels.reduce((sum, kernel, jdx) => sum + kernel * y_values[jdx], 0) / total
    })
  const grid = Array.from({ length: 60 }, (_, idx) => idx * 0.1)
  it.each([
    [`ascending`, grid],
    // every non-monotonic grid takes the same unwindowed fallback
    [`descending`, grid.toReversed()],
    [`with duplicates`, grid.map((val, idx) => (idx % 4 === 0 ? grid[0] : val))],
  ])(`matches an unwindowed reference on a %s grid`, (_label, x_values) => {
    const y_values = x_values.map((_, idx) => ((idx * 37) % 11) + 0.5)
    const expected = brute_force(x_values, y_values, 0.25)
    const smoothed = gaussian_kernel_smooth(x_values, y_values, 0.25)
    const errors = smoothed.map((val, idx) => Math.abs(val - expected[idx]))
    expect(Math.max(...errors)).toBeLessThan(1e-10)
  })
})

describe(`branch_segment_keys`, () => {
  it(`keys labelled branches by label pair, numbers repeats and positions unlabeled ones`, () => {
    // Γ→X→Γ→X→(unlabeled)
    const band_structure = make_bs([`GAMMA`, null, `X`, null, `GAMMA`, `X`])
    band_structure.branches.push(make_branch(5, 5, `tail`))
    band_structure.qpoints[5] = { label: null, frac_coords: [1, 0, 0] }
    const keys = [`GAMMA_X`, `X_GAMMA`, `GAMMA_null`, `branch:3`]
    expect(branch_segment_keys(band_structure)).toEqual(keys)
    const repeated = make_bs([`GAMMA`, `X`, `GAMMA`, `X`])
    expect(branch_segment_keys(repeated)).toEqual([`GAMMA_X`, `X_GAMMA`, `GAMMA_X#2`])
  })

  // Read off the q-points: seekpath-style labels (S_0, X_1) contain the key separator, so
  // splitting the key S_0_X_1 gave `S → 0 → X → 1`
  it.each([
    [[`S_0`, null, `X_1`], `S₀ → X₁`],
    [[`GAMMA`, null, null], `Γ`],
    [[null, null, null], null],
  ] as const)(`branch_path_label of %j is %s`, (labels, expected) => {
    const band_structure = make_bs([...labels])
    const [branch] = band_structure.branches
    expect(branch_path_label(band_structure, branch)).toBe(expected)
  })
})

describe(`qpoint_x_position / find_qpoint_at_rescaled_x`, () => {
  // Γ→X (3 steps) and X→K (2 steps), plotted into [0, 1] and [1, 1.5]
  const band_structure = make_bs([`GAMMA`, null, null, `X`, null, `K`])
  const x_pos: Record<string, Vec2> = { GAMMA_X: [0, 1], X_K: [1, 1.5] }

  it.each([
    [0, 0],
    [3, 1],
    [5, 1.5],
    [4, 1.25],
    [1, 1 / 3],
  ])(`q-point %i sits at x = %f and maps back`, (idx, expected_x) => {
    const x_val = qpoint_x_position(band_structure, idx, x_pos)
    expect(x_val).toBeCloseTo(expected_x, 12)
    expect(find_qpoint_at_rescaled_x(band_structure, x_val ?? NaN, x_pos)).toBe(idx)
  })

  it(`rounds interior x to the nearest q-point and snaps off-path x to the nearest endpoint`, () => {
    expect(find_qpoint_at_rescaled_x(band_structure, 0.6, x_pos)).toBe(2) // 0.6 · 3 = 1.8 → idx 2
    expect(find_qpoint_at_rescaled_x(band_structure, 9, { GAMMA_X: [0, 1] })).toBe(3) // beyond the only segment
    expect(find_qpoint_at_rescaled_x(band_structure, 0.5, {})).toBe(0) // no segments: fallback index
    expect(qpoint_x_position(band_structure, 4, { GAMMA_X: [0, 1] })).toBeNull() // branch not plotted
  })

  it(`distinguishes a repeated Gamma and resolves a zero-length discontinuity`, () => {
    const loop = make_bs([`GAMMA`, null, `X`, null, `GAMMA`])
    const loop_pos: Record<string, Vec2> = { GAMMA_X: [0, 1], X_GAMMA: [1, 2] }
    expect(find_qpoint_at_rescaled_x(loop, 0, loop_pos)).toBe(0)
    expect(find_qpoint_at_rescaled_x(loop, 2, loop_pos)).toBe(4)
    const disc = make_bs([`GAMMA`, `X`, `K`])
    const disc_pos: Record<string, Vec2> = { GAMMA_X: [0, 0.5], X_K: [0.5, 0.5] }
    expect(find_qpoint_at_rescaled_x(disc, 0.5, disc_pos)).toBe(1)
    expect(qpoint_x_position(disc, 2, disc_pos)).toBe(0.5)
  })
})

// Branches minus the U|K / K|U jump make_bs draws between consecutive labels: a jump is no
// branch, while a real segment sampled at just 2 points (X→W below) is one
const without_jump = (labels: (string | null)[]): BaseBandStructure =>
  make_bs(labels, {
    branches: make_bs(labels).branches.filter(({ name }) => ![`U-K`, `K-U`].includes(name)),
  })

describe(`branch_qpoint_range`, () => {
  // Γ(0)→X(3)→K(5) sharing X, a K|U jump, then a 2-point segment U(6)→W(7)
  const band_structure = without_jump([`GAMMA`, null, null, `X`, null, `K`, `U`, `W`])
  it.each([
    [0, [0, 3]],
    [3, [0, 3]], // shared symmetry point belongs to the earlier branch
    [4, [3, 5]],
    [5, [3, 5]],
    [6, [6, 7]],
    [7, [6, 7]],
    [-1, null],
  ] as [number, Vec2 | null][])(`q-point %i lies in %j`, (qpoint_idx, expected) => {
    expect(branch_qpoint_range(band_structure, qpoint_idx)).toEqual(expected)
  })
})

// a hovered energy (FermiBandsLink calls this per band hover) scans only the bands whose
// cached [min, max] spans it, not every q-point of every band
it(`band_crossings skips the bands whose range excludes the energy`, () => {
  const reads = new Map<number, number>() // q-point reads per band
  // 20 bands 1 apart, each rising 0.5 over 11 q-points: only band 7 spans 0.33
  const bands = Array.from({ length: 20 }, (_, band) => {
    const energies = Array.from({ length: 11 }, (_unused, idx) => band - 7 + 0.05 * idx)
    return new Proxy(energies, {
      get: (target, key, receiver) => {
        if (typeof key === `string` && /^\d+$/.test(key))
          reads.set(band, (reads.get(band) ?? 0) + 1)
        return Reflect.get(target, key, receiver)
      },
    })
  })
  const band_structure = make_bs([`GAMMA`, ...Array(9).fill(null), `X`], { bands })
  const { points } = band_k_path(band_structure, IDENTITY_MATRIX3)
  const x_positions = { [branch_segment_keys(band_structure)[0]]: [0, 10] as Vec2 }
  const crossings_at = (energy: number) =>
    band_crossings(band_structure, energy, points, x_positions).map(({ band_idx, x }) => [
      band_idx,
      Math.round(x * 1e9) / 1e9,
    ])
  expect(crossings_at(0.33)).toEqual([[7, 6.6]]) // the first call caches every band's range
  reads.clear()
  expect(crossings_at(0.33)).toEqual([[7, 6.6]])
  expect([...reads.keys()]).toEqual([7])
  // a range's ends are inclusive: a band touching the energy at its max still crosses
  expect(crossings_at(-6.5)).toEqual([[0, 10]])
})

describe(`extract_k_path_points`, () => {
  const fcc_recip = math.mat3x3_from_flat_row_major([-1, 1, 1, 1, -1, 1, 1, 1, -1])

  it(`maps fractional to Cartesian with row-vector reciprocal vectors, folding to the zone`, () => {
    const band_structure = make_bs([`GAMMA`, `X`, `K`])
    band_structure.qpoints[2].frac_coords = [1 / 3, 1 / 3, 0]
    const recip = math.mat3x3_from_flat_row_major([2, 0.5, 0, 0, 2, 0, 0, 0, 1])
    const no_wrap = { wrap_to_bz: false }
    const [gamma, x_point, k_point] = extract_k_path_points(band_structure, recip, no_wrap)
    expect(gamma).toEqual([0, 0, 0])
    expect(x_point).toEqual([1, 0.25, 0]) // 0.5·b1
    expect(k_point[0]).toBeCloseTo(2 / 3, 12)
    expect(k_point[1]).toBeCloseTo(0.5 / 3 + 2 / 3, 12)
    const empty = make_bs([], { qpoints: [], branches: [] })
    expect(extract_k_path_points(empty, recip)).toEqual([])
    expect(() => extract_k_path_points(band_structure, [[1, 0]] as never)).toThrow(/3×3/)
    // the per-point conversion Bands uses for a clicked symmetry point agrees exactly
    expect(frac_k_to_cartesian([1 / 3, 1 / 3, 0], recip, false)).toEqual(k_point)
    // a point near FCC K where per-axis wrapping is not the Wigner-Seitz image
    const near_k = make_bs([`K`], {
      qpoints: [{ label: `K`, frac_coords: [0.3713, 0.3713, 0.7425] }],
    })
    const [folded_k] = extract_k_path_points(near_k, fcc_recip)
    expect(folded_k.map((val) => Number(val.toFixed(4)))).toEqual([0.7425, 0.7425, 0.0001])
  })

  // A sheared (non-reduced) basis needs shifts beyond ±1: the old 27-image search left
  // 25% of random points up to 2.7x too far from Γ, outside the rendered zone
  // oxfmt-ignore
  it.each([
    [`sheared cubic`, [[1, 0, 0], [-4, 1, 0], [0, 0, 1]]],
    [`sheared triclinic`, [[1, 0, 0], [-3.2, 1, 0], [-1.7, -2.4, 1]]],
    [`FCC`, fcc_recip],
  ] as [string, Matrix3x3][])(`folds into the first zone of a %s lattice`, (_name, recip) => {
    let seed = 3
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
    const recip_t = math.transpose_3x3(recip)
    for (let trial = 0; trial < 200; trial++) {
      const frac: Vec3 = [rand(), rand(), rand()]
      const folded = frac_k_to_cartesian(frac, recip)
      let min_norm = Infinity
      for (let n_1 = -8; n_1 <= 8; n_1++)
        for (let n_2 = -8; n_2 <= 8; n_2++)
          for (let n_3 = -8; n_3 <= 8; n_3++) {
            const image = math.mul_3x3_vec3(recip_t, [
              frac[0] + n_1,
              frac[1] + n_2,
              frac[2] + n_3,
            ])
            min_norm = Math.min(min_norm, Math.hypot(...image))
          }
      // brute force and the fold agree to round-off (measured ≤ 1.3e-15)
      expect(Math.abs(Math.hypot(...folded) - min_norm)).toBeLessThan(1e-12)
      // and the fold moved the point by a lattice vector only
      const shift = math.mul_3x3_vec3(
        math.inverse_3x3(recip_t),
        math.subtract(folded, math.mul_3x3_vec3(recip_t, frac)),
      )
      for (const coord of shift) expect(Math.abs(coord - Math.round(coord))).toBeLessThan(1e-9)
    }
  })

  // Zone-face points tie with their opposite-face image; folding must not flip them
  // oxfmt-ignore
  it.each([
    [`cubic X`, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0.5, 0, 0]],
    [`cubic M`, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0.5, 0.5, 0]],
    [`cubic R`, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0.5, 0.5, 0.5]],
    [`FCC X`, fcc_recip, [0.5, 0, 0.5]],
    [`FCC L`, fcc_recip, [0.5, 0.5, 0.5]],
    [`FCC K`, fcc_recip, [0.375, 0.375, 0.75]],
    [`FCC W`, fcc_recip, [0.5, 0.25, 0.75]],
    [`FCC U`, fcc_recip, [0.625, 0.25, 0.625]],
  ] as [string, Matrix3x3, Vec3][])(`leaves the zone-boundary point %s in place`, (_name, recip, frac) => {
    expect(frac_k_to_cartesian(frac, recip)).toEqual(frac_k_to_cartesian(frac, recip, false))
  })

  // The zone draws exactly the band branches: the U|K jump is none, the 2-point Γ→X one is
  it(`band_k_path pairs Cartesian points with labels and plotted branches`, () => {
    const band_structure = without_jump([`GAMMA`, null, `U`, `K`, null, `GAMMA`, `X`])
    const points = extract_k_path_points(band_structure, fcc_recip)
    const labels = [`Γ`, null, `U`, `K`, null, `Γ`, `X`]
    // oxfmt-ignore
    expect(band_k_path(band_structure, fcc_recip)).toEqual({ points, labels, branches: [[0, 2], [3, 5], [5, 6]] })
  })

  // Steps along a zone face (L→U, H→K) used to alternate faces: pymatgen stores 8 decimals, so
  // on-face points sit ~1e-8 outside it. cao's longest in-branch step was 35x the median. An
  // absolute tie tolerance then flipped whole VBr2 branches to the opposite face (junction
  // duplicates M, K, L, H up to 2.1 Å⁻¹ apart), and M→K's flipped shift, passed on through a
  // shared K, ended K→Γ at Γ+G (22 of 34 points outside the zone).
  const vbr2 = normalize_band_structure(JSON.parse(vbr2_json))
  if (!vbr2) throw new Error(`VBr2 fixture failed to normalize`)
  // VBr2's M(20)→K(31) and K(32)→Γ(54) joined at one K, its junction duplicate dropped
  const keep = Array.from({ length: 35 }, (_, offset) => 20 + offset).filter(
    (idx) => idx !== 32,
  )
  const vbr2_shared_k: BaseBandStructure = {
    ...vbr2,
    qpoints: keep.map((idx) => vbr2.qpoints[idx]),
    distance: keep.map((idx) => vbr2.distance[idx]),
    bands: vbr2.bands.map((band) => keep.map((idx) => band[idx])),
    branches: [make_branch(0, 11, `M-K`), make_branch(11, 33, `K-GAMMA`)],
  }
  // Wigner-Seitz test: no lattice vector G is nearer than Γ, i.e. 2k·G ≤ |G|² (to the fold's
  // 1e-6 relative tie tolerance; the 8-decimal storage noise is ~1e-8)
  const outside_first_bz = (point: Vec3, recip: Matrix3x3): boolean => {
    const recip_t = math.transpose_3x3(recip)
    for (let n_1 = -2; n_1 <= 2; n_1++)
      for (let n_2 = -2; n_2 <= 2; n_2++)
        for (let n_3 = -2; n_3 <= 2; n_3++) {
          const lattice_vec = math.mul_3x3_vec3(recip_t, [n_1, n_2, n_3])
          const norm_sq = math.dot(lattice_vec, lattice_vec)
          if (norm_sq && 2 * math.dot(point, lattice_vec) > norm_sq * (1 + 1e-6)) return true
        }
    return false
  }
  it.each([
    [`cao`, normalize_band_structure(JSON.parse(cao_json))],
    [`MgB2 band.yaml`, phonon_band_structure_from_modes(parse_phonon_modes(mgb2_band_yaml))],
    [`VBr2`, vbr2],
    [`VBr2 M→K→Γ sharing K`, vbr2_shared_k],
  ])(
    `band_k_path keeps %s branches continuous, joined and inside the first BZ`,
    (_name, band_structure) => {
      const recip = band_structure?.recip_lattice
      if (!band_structure || !recip) throw new Error(`fixture lacks a reciprocal lattice`)
      const { points, labels, branches } = band_k_path(band_structure, recip)
      const steps = branches
        .flatMap(([start, end]) =>
          points
            .slice(start, end)
            .map((point, offset) => math.euclidean_dist(point, points[start + offset + 1])),
        )
        .toSorted((step_a, step_b) => step_a - step_b)
      expect(steps.at(-1)).toBeLessThanOrEqual(2 * steps[steps.length >> 1])
      // a junction's duplicate symmetry point (X, X) is drawn where the next branch starts
      for (const [[, prev_end], [next_start]] of branches
        .slice(0, -1)
        .map((branch, idx) => [branch, branches[idx + 1]] as const)) {
        if (next_start !== prev_end + 1 || !labels[prev_end]) continue
        if (labels[prev_end] !== labels[next_start]) continue
        expect(math.euclidean_dist(points[prev_end], points[next_start])).toBeLessThan(1e-9)
      }
      expect(points.filter((point) => outside_first_bz(point, recip))).toEqual([])
    },
  )

  // A branch continuing at a shared end point keeps the previous branch's shift while that
  // still folds its own midpoint to a nearest image (a face tie), else takes its own. Paths
  // stored one lattice vector out, Γ'→X' then along the face X'→M' stays on the +x face; with
  // its own shift it would jump to the -x face. X'→2.3·x does not tie, so it takes its own
  // shift (back inside) rather than inheriting one that leaves it at 0.5..1.3, outside.
  // oxfmt-ignore
  it.each([
    [`keeps a face-tie shift`, [[1.5, 0.25, 0], [1.5, 0.5, 0]], [[0.5, 0, 0], [0.5, 0.25, 0], [0.5, 0.5, 0]]],
    [`refuses a shift that leaves the zone`, [[1.9, 0, 0], [2.3, 0, 0]], [[-0.5, 0, 0], [-0.1, 0, 0], [0.3, 0, 0]]],
  ] as [string, Vec3[], Vec3[]][])(`band_k_path at a shared end point %s`, (_name, tail, expected_tail) => {
    const frac: Vec3[] = [[1.1, 0, 0], [1.2, 0, 0], [1.3, 0, 0], [1.4, 0, 0], [1.5, 0, 0], ...tail]
    const band_structure = make_bs(frac.map(() => null), {
      qpoints: frac.map((frac_coords) => ({ label: null, frac_coords })),
      branches: [make_branch(0, 4, `a`), make_branch(4, 6, `b`)],
    })
    const { points } = band_k_path(band_structure, IDENTITY_MATRIX3)
    const expected = [[0.1, 0, 0], [0.2, 0, 0], [0.3, 0, 0], [0.4, 0, 0], ...expected_tail]
    const max_err = Math.max(
      ...points.flatMap((point, idx) => point.map((coord, axis) => Math.abs(coord - expected[idx][axis]))),
    )
    expect(max_err).toBeLessThan(1e-12)
  })
})

describe(`normalize_band_structure`, () => {
  const pmg = (opts: Record<string, unknown>) => ({
    '@class': `PhononBandStructureSymmLine`,
    ...identity_rec,
    ...opts,
  })
  const line = (n_points: number) =>
    Array.from({ length: n_points }, (_, idx) => [idx / (n_points - 1), 0, 0])

  // a valid one-q-point matterviz input, broken one field at a time below
  const one_qpt = (overrides: Record<string, unknown>) => ({
    qpoints: [{ label: null, frac_coords: [0, 0, 0] }],
    branches: [],
    bands: [[0]],
    distance: [0],
    ...overrides,
  })
  it(`passes matterviz input through, filling nb_bands and labels_dict`, () => {
    const bands = [[0], [1]]
    const result = normalize_band_structure(one_qpt({ bands }))
    expect(result).toMatchObject({ nb_bands: 2, labels_dict: {}, bands })
  })
  // oxfmt-ignore
  it.each([
    [`null`, null],
    [`a string`, `bands`],
    [`an empty object`, {}],
    [`empty qpoints`, { qpoints: [], branches: [], bands: [], distance: [] }],
    [`pymatgen input without bands`, pmg({ qpoints: line(2), bands: null })],
    [`pymatgen input with an unknown unit`, pmg({ qpoints: line(2), bands: [[0, 1]], unit: `GHz` })],
    [`pymatgen input with empty kpoints`, { kpoints: [], bands: { '1': [] } }],
  ])(`returns null for %s`, (_label, input) => {
    expect(normalize_band_structure(input)).toBeNull()
  })

  // parts that disagree throw naming the mismatch: a dropped q-point used to shift later bands
  // oxfmt-ignore
  it.each([
    [`a distance/qpoints length mismatch`, one_qpt({ distance: [0, 1] }), `distance has 2 values, expected one per q-point (1)`],
    [`a band of the wrong length`, one_qpt({ bands: [[0], [0, 1]] }), `band 1 of 2 has 2 values, expected one per q-point (1)`],
    [`a ragged spin-down band`, one_qpt({ spin_down_bands: [[0, 1]] }), `spin-down band 0 of 1 has 2 values`],
    [`a branch past the last q-point`, one_qpt({ branches: [make_branch(0, 5, `t`)] }), `out of range for 1 q-points`],
    [`a branch with a NaN start index`, one_qpt({ branches: [make_branch(NaN, 0, `t`)] }), `out of range`],
    [`an unparsable pymatgen q-point`, pmg({ qpoints: [[0, 0, 0], `X`, [1, 0, 0]], bands: [[0, 1, 2]] }), `q-point 1 of 3 is not a 3-vector or k-point: "X"`],
    [`a pymatgen band of the wrong length`, pmg({ qpoints: line(3), bands: [[0, 1, 2], [0, 1]] }), `band 1 of 2 has 2 values, expected one per q-point (3)`],
    [`a ragged pymatgen spin-down band`, { ...identity_rec, kpoints: line(2), bands: { '1': [[0, 1], [2, 3]], '-1': [[0.1], [2.1, 3.1]] } }, `spin-down band 0 of 2 has 1 values`],
    [`a pymatgen spin-down band count mismatch`, { ...identity_rec, kpoints: line(2), bands: { '1': [[0, 1], [2, 3]], '-1': [[0.1, 1.1]] } }, `spin-down channel has 1 bands, expected 2`],
  ])(`throws for %s`, (_label, input, message) => {
    expect(() => normalize_band_structure(input)).toThrow(message)
  })

  // Bands are stored in THz; the factor is the module's own unit table, so the test pins the
  // direction of the conversion and the unit aliases rather than re-deriving constants
  it.each([
    [undefined, 5, 5],
    [null, 5, 5], // undeclared, like normalize_dos treats `unit: null`
    [`thz`, 5, 5],
    [`ev`, 4.135667696e-3, 1],
    [`meV`, 4.135667696, 1],
    [`cm-1`, THZ_TO_INVERSE_CM, 1],
    [`cm^-1`, 2 * THZ_TO_INVERSE_CM, 2],
  ])(`converts pymatgen bands declared in %s to THz`, (unit, input, expected_thz) => {
    const result = normalize_band_structure(
      pmg({ qpoints: line(2), bands: [[0, input]], ...(unit !== undefined && { unit }) }),
    )
    expect(result?.bands[0][1]).toBeCloseTo(expected_thz, 9)
  })

  // electronic energies were scaled to THz too: a declared eV turned 1 eV into 241.8. Energy
  // units convert to eV, frequency units are a malformed electronic input
  it.each([
    [undefined, 1, 1],
    [`eV`, 1, 1],
    [`meV`, 1000, 1],
    [`Ha`, 1 / HARTREE_TO_EV, 1],
    [`THz`, 1, null],
    [`cm-1`, 1, null],
  ])(`keeps electronic bands declared in %s in eV`, (unit, input, expected_ev) => {
    const kpoints = { '@class': `BandStructureSymmLine`, ...identity_rec, kpoints: line(2) }
    const bands = { '1': [[0, input]] }
    const result = normalize_band_structure({ ...kpoints, bands, unit, efermi: 5 * input })
    // the Fermi energy shares the bands' unit
    const expected = expected_ev === null ? null : [expected_ev, 5 * expected_ev]
    expect(result && [result.bands[0][1], result.efermi]).toEqual(
      expected?.map((energy) => expect.closeTo(energy, 12)) ?? null,
    )
  })

  // the matterviz shape read a declared unit as THz; converted once, `unit` is dropped so a
  // second normalization leaves the THz values alone
  it(`converts matterviz input declared in cm^-1 to THz once`, () => {
    const input = one_qpt({ bands: [[2 * THZ_TO_INVERSE_CM]], unit: `cm-1` })
    const once = normalize_band_structure(input)
    expect(once?.bands[0][0]).toBeCloseTo(2, 12)
    expect(once && `unit` in once).toBe(false)
    expect(normalize_band_structure(once)?.bands).toEqual(once?.bands)
    expect(normalize_band_structure(one_qpt({ type: `electronic`, unit: `THz` }))).toBeNull()
    const in_mev = one_qpt({ type: `electronic`, unit: `meV`, bands: [[2000]], efermi: 5000 })
    expect(normalize_band_structure(in_mev)).toMatchObject({ bands: [[2]], efermi: 5 })
  })

  it(`transposes the frequencies_cm layout (q-points × branches, in cm^-1)`, () => {
    const to_cm = (row: number[]) => row.map((val) => val * THZ_TO_INVERSE_CM)
    const frequencies_cm = [to_cm([1, 2]), to_cm([3, 4])]
    const result = normalize_band_structure(pmg({ qpoints: line(2), frequencies_cm }))
    const rounded = result?.bands.map((band) => band.map((val) => Math.round(val * 1e9) / 1e9))
    // oxfmt-ignore
    expect(rounded).toEqual([[1, 3], [2, 4]])
  })

  it(`labels q-points from Kpoint objects or by matching labels_dict within 1e-4`, () => {
    const from_kpoints = normalize_band_structure({
      ...identity_rec,
      qpoints: [
        { frac_coords: [0, 0, 0], label: `GAMMA` },
        { frac_coords: [0.5, 0, 0], label: `X` },
      ],
      bands: [[0, 1]],
    })
    expect(from_kpoints?.qpoints.map((qpt) => qpt.label)).toEqual([`GAMMA`, `X`])
    // oxfmt-ignore
    const qpoints = [[0.00001, -0.00001, 0], [0.49999, 0.00001, 0]]
    const labels_dict = { GAMMA: [0, 0, 0], X: [0.5, 0, 0] }
    const from_dict = normalize_band_structure(pmg({ qpoints, bands: [[0, 1]], labels_dict }))
    expect(from_dict?.qpoints.map((qpt) => qpt.label)).toEqual([`GAMMA`, `X`])
  })

  it(`accumulates distance along the path but not across a discontinuity`, () => {
    // oxfmt-ignore
    const qpoints = [[0, 0, 0], [0.05, 0, 0], [0.1, 0, 0], [0.9, 0.9, 0.9], [0.95, 0.95, 0.95], [1, 1, 1]]
    const result = normalize_band_structure(
      pmg({
        qpoints,
        bands: [[0, 1, 2, 3, 4, 5]],
        // the jump is X|W: a step between two labelled points, as in pymatgen paths
        labels_dict: { GAMMA: [0, 0, 0], X: [0.1, 0, 0], W: [0.9, 0.9, 0.9], L: [1, 1, 1] },
      }),
    )
    const step = Math.hypot(0.05, 0.05, 0.05)
    const expected = [0, 0.05, 0.1, 0.1, 0.1 + step, 0.1 + 2 * step]
    result?.distance.forEach((val, idx) => expect(val).toBeCloseTo(expected[idx], 12))
    expect(result?.branches).toEqual([make_branch(0, 2, `GAMMA-X`), make_branch(3, 5, `W-L`)])
  })

  // pymatgen and phonopy put a fixed point count in each segment, so in an anisotropic cell
  // every step of a long segment is many times the median. A 5x-median jump heuristic used to
  // flag all of them, giving Γ-Z zero width (audit repro: total path 1.07 vs pymatgen's 4.84).
  it(`keeps long segments of an anisotropic cell (only labelled-to-labelled steps jump)`, () => {
    const gamma_x = Array.from({ length: 6 }, (_, idx) => [idx / 10, 0, 0])
    const x_r = Array.from({ length: 6 }, (_, idx) => [0.5, 0, idx / 10])
    const result = normalize_band_structure(
      pmg({
        qpoints: [...gamma_x, ...x_r], // X duplicated at the junction, as pymatgen writes it
        bands: [Array.from({ length: 12 }, (_, idx) => idx)],
        labels_dict: { GAMMA: [0, 0, 0], X: [0.5, 0, 0], R: [0.5, 0, 0.5] },
        lattice_rec: { matrix: math.mat3x3_from_flat_row_major([1, 0, 0, 0, 1, 0, 0, 0, 10]) },
      }),
    )
    // Γ-X spans 0.5, X-R spans 10 * 0.5 = 5
    expect(result?.distance.at(-1)).toBeCloseTo(5.5, 12)
    expect(result?.branches.map(({ name }) => name)).toEqual([`GAMMA-X`, `X-R`])
  })

  // Reciprocal lattice of a hexagonal cell: a* = b* = 1 at 60°, c* = 0.4. The fractional
  // metric would give |M-K| = sqrt(1/36 + 1/9) and |K-GAMMA| = sqrt(2/9); the Cartesian one
  // gives sqrt(3)/6 and 1/sqrt(3).
  // oxfmt-ignore
  const hex_matrix: Matrix3x3 = [[1, 0, 0], [0.5, Math.sqrt(3) / 2, 0], [0, 0, 0.4]]
  // Midpoints between the high-symmetry points make each leg a segment: a step from one
  // labelled point straight to another is a path jump (pymatgen's rule)
  // oxfmt-ignore
  const hex_corners = [[0, 0, 0], [0.5, 0, 0], [1 / 3, 1 / 3, 0], [0, 0, 0], [0, 0, 0.5]]
  const hex_path = {
    qpoints: hex_corners.flatMap((corner, idx) => {
      const next = hex_corners[idx + 1]
      return next ? [corner, corner.map((val, dim) => (val + next[dim]) / 2)] : [corner]
    }),
    bands: [Array.from({ length: 9 }, (_, idx) => idx)],
    labels_dict: { GAMMA: [0, 0, 0], M: [0.5, 0, 0], K: [1 / 3, 1 / 3, 0], A: [0, 0, 0.5] },
  }
  const hex_legs = [0.5, Math.sqrt(3) / 6, 1 / Math.sqrt(3), 0.2]
  const hex_distance = [0, 1, 2, 3, 4].map((n_legs) =>
    hex_legs.slice(0, n_legs).reduce((acc, leg) => acc + leg, 0),
  )

  // pymatgen's lattice_rec already includes 2π; phonopy's recip_lattice does not and is scaled
  // so the kept reciprocal lattice (and the distances measured in it) share one convention
  it.each([
    [`lattice_rec`, 1],
    [`recip_lattice`, 2 * Math.PI],
  ])(`measures k-path distance in Cartesian reciprocal space from %s.matrix`, (key, scale) => {
    const result = normalize_band_structure({
      '@class': `PhononBandStructureSymmLine`,
      ...hex_path,
      [key]: { matrix: hex_matrix },
    })
    expect(result?.distance).toHaveLength(9)
    // corners sit at even indices
    hex_distance.forEach((val, idx) =>
      expect(result?.distance[2 * idx]).toBeCloseTo(val * scale, 12),
    )
    const expected_lattice = hex_matrix.map((row) =>
      row.map((val) => expect.closeTo(val * scale, 12)),
    )
    expect(result?.recip_lattice).toEqual(expected_lattice)
    // every labeled q-point bounds a branch, so all four legs get axis labels
    const names = [`GAMMA-M`, `M-K`, `K-GAMMA`, `GAMMA-A`]
    expect(result?.branches.map(({ name }) => name)).toEqual(names)
  })

  // oxfmt-ignore
  it.each([
    [`no reciprocal lattice`, {}],
    [`a 2x2 lattice_rec.matrix`, { lattice_rec: { matrix: [[1, 0], [0, 1]] } }],
    [`a non-finite recip_lattice.matrix`, { recip_lattice: { matrix: [[1, 0, 0], [0, NaN, 0], [0, 0, 1]] } }],
  ])(`throws naming lattice_rec.matrix for pymatgen input with %s`, (_label, lattice) => {
    // built without pmg(), which would add the identity lattice_rec
    const input = { '@class': `PhononBandStructureSymmLine`, qpoints: line(2), bands: [[0, 1]] }
    // a throw, not null: the shape is recognisably pymatgen, so the missing key is a
    // fixable defect reported by the file adapter (unrecognised shapes stay null)
    expect(() => normalize_band_structure({ ...input, ...lattice })).toThrow(
      /'lattice_rec\.matrix' \(or 'recip_lattice\.matrix'\).*got keys \[@class, qpoints, bands/,
    )
  })

  it(`passes pymatgen phonon flags through`, () => {
    const flagged = normalize_band_structure(
      pmg({ qpoints: line(2), bands: [[0, 1]], has_nac: true, has_imaginary_modes: false }),
    )
    expect(flagged).toMatchObject({ has_nac: true, has_imaginary_modes: false })
    const unflagged = normalize_band_structure(pmg({ qpoints: line(2), bands: [[0, 1]] }))
    expect(unflagged && `has_nac` in unflagged).toBe(false)
  })

  describe(`branches`, () => {
    const warn = () => vi.spyOn(console, `warn`).mockImplementation(() => {})

    // the one-discontinuity case is pinned in the distance test above
    // oxfmt-ignore
    it.each([
      [`a single unlabeled path`, [[0.1, 0, 0], [0.25, 0, 0], [0.4, 0, 0]], {}, [`?-?`]],
      [`labelled endpoints`, [[0, 0, 0], [0.25, 0, 0], [0.5, 0, 0]], { GAMMA: [0, 0, 0], X: [0.5, 0, 0] }, [`GAMMA-X`]],
      [
        `two discontinuities`,
        [[0, 0, 0], [0.05, 0, 0], [0.1, 0, 0], [0.5, 0.5, 0], [0.55, 0.5, 0], [0.6, 0.5, 0], [1, 1, 1], [1.05, 1, 1], [1.1, 1, 1]],
        { GAMMA: [0, 0, 0], X: [0.1, 0, 0], K: [0.5, 0.5, 0], U: [0.6, 0.5, 0], L: [1, 1, 1], W: [1.1, 1, 1] },
        [`GAMMA-X`, `K-U`, `L-W`],
      ],
    ])(
      `infers branches from discontinuities for %s (silently: pymatgen phonon JSON never has them)`,
      (_label, qpoints, labels_dict, names) => {
        const spy = warn()
        const result = normalize_band_structure(
          pmg({ qpoints, bands: [qpoints.map((_, idx) => idx)], labels_dict }),
        )
        // every branch spans 3 q-points
        const expected = names.map((name, idx) => make_branch(3 * idx, 3 * idx + 2, name))
        expect(result?.branches).toEqual(expected)
        expect(spy).not.toHaveBeenCalled()
        spy.mockRestore()
      },
    )

    it(`keeps valid explicit branches and drops invalid ones before falling back`, () => {
      const spy = warn()
      const branches = [make_branch(0, 1, `a`), make_branch(1, 2, `b`)]
      const explicit = normalize_band_structure(
        pmg({ qpoints: line(3), bands: [[0, 1, 2]], branches }),
      )
      expect(explicit?.branches.map((branch) => branch.name)).toEqual([`a`, `b`])
      expect(spy).not.toHaveBeenCalled()
      const bad_branches = [make_branch(-1, 0, `x`), make_branch(0, 99, `y`)]
      const invalid = normalize_band_structure(
        pmg({ qpoints: line(2), bands: [[0, 1]], branches: bad_branches }),
      )
      expect(invalid?.branches).toEqual([make_branch(0, 1, `?-?`)])
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    })
  })

  describe(`electronic (kpoints, spin-keyed bands)`, () => {
    // oxfmt-ignore
    const [up, down] = [[[0, 1], [2, 3]], [[0.1, 1.1], [2.1, 3.1]]]
    it(`reads both spin channels`, () => {
      const result = normalize_band_structure({
        ...identity_rec,
        kpoints: line(2),
        bands: { '1': up, '-1': down },
      })
      expect(result).toMatchObject({ bands: up, spin_down_bands: down, nb_bands: 2 })
    })

    it(`recognises pymatgen input by kpoints, @class or @module, but not bare branched input`, () => {
      const branched = {
        ...identity_rec,
        kpoints: line(2),
        bands: { '1': [[0, 1]] },
        branches: [make_branch(0, 1, `\\Gamma-X`)],
      }
      expect(normalize_band_structure(branched)).toBeNull()
      const by_class = { '@class': `BandStructureSymmLine`, ...branched }
      expect(normalize_band_structure(by_class)?.branches).toHaveLength(1)
      const by_module = {
        '@module': `pymatgen.electronic_structure.bandstructure`,
        ...branched,
      }
      expect(normalize_band_structure(by_module)?.qpoints).toHaveLength(2)
      const by_kpoints = { ...identity_rec, kpoints: line(2), bands: up }
      expect(normalize_band_structure(by_kpoints)?.nb_bands).toBe(2)
    })
  })
})

describe(`electronic_band_gap`, () => {
  // oxfmt-ignore
  it.each([
    [`insulator`, [[-2, -1], [1, 3]], 0, { vbm: -1, cbm: 1, gap: 2 }],
    // vasprun rounds eigenvalues to 1e-4 eV, so band edges at E_F land a hair past it
    [`VBM rounded just above E_F`, [[-2, 5e-5], [1, 2]], 0, { vbm: 5e-5, cbm: 1, gap: 1 - 5e-5 }],
    [`CBM rounded just below E_F`, [[-2, -1], [-5e-5, 1]], 0, { vbm: -1, cbm: -5e-5, gap: 1 - 5e-5 }],
    [`metal (band crosses E_F between filled and empty bands)`, [[-2], [-0.3, 0.2], [1]], 0, null],
    [`metal crossing E_F by just over the tolerance`, [[-2], [-2e-4, 2e-4], [1]], 0, null],
    [`all bands occupied`, [[-2, -1]], 0, null],
    [`non-finite energies skipped`, [[NaN, -1], [1, Infinity]], 0, { vbm: -1, cbm: 1, gap: 2 }],
    // non-SCF line-mode run: E_F = 0 from the SCF mesh calls this a metal, occupations don't
    [`VBM 30 meV above E_F, insulating occupations`, [[-1, 0.03], [0.5, 0.9]], [[1, 1], [0, 0]], { vbm: 0.03, cbm: 0.5, gap: 0.5 - 0.03 }],
    // smearing leaves band-edge states fractional, Blöchl corrections push them past [0, 1]
    [`smeared and Blöchl-corrected occupations`, [[-1, -0.1], [0.2, 1]], [[1.002, 0.93], [0.07, -0.002]], { vbm: -0.1, cbm: 0.2, gap: 0.2 + 0.1 }],
    [`metal by occupations though no band crosses E_F`, [[-2], [-1, -0.5], [1]], [[1], [1, 0], [0]], null],
    [`occupations of non-finite energies ignored`, [[-1, NaN], [1, 2]], [[1, 0], [0, 0]], { vbm: -1, cbm: 1, gap: 2 }],
  ])(`%s`, (_desc, bands, filling, expected) => {
    const result = electronic_band_gap(bands, filling)
    const energies = result && { vbm: result.vbm.energy, cbm: result.cbm.energy, gap: result.gap }
    expect(energies).toEqual(expected)
  })

  // Edges carry band, q-point and (with spin_down) spin; direct when one q-point reaches both
  // edges, the direct gap is per spin channel (pymatgen's get_direct_band_gap)
  // oxfmt-ignore
  it.each([
    [`indirect`, [[-2, -1, -1.5], [2, 1.5, 1]], undefined, {
      gap: 2, is_direct: false,
      vbm: { energy: -1, band_idx: 0, qpoint_idx: 1 }, cbm: { energy: 1, band_idx: 1, qpoint_idx: 2 },
      direct_gap: { energy: 2.5, qpoint_idx: 1 },
    }],
    [`direct`, [[-2, -1], [2, 1]], undefined, {
      gap: 2, is_direct: true,
      vbm: { energy: -1, band_idx: 0, qpoint_idx: 1 }, cbm: { energy: 1, band_idx: 1, qpoint_idx: 1 },
      direct_gap: { energy: 2, qpoint_idx: 1 },
    }],
    // a junction point repeated with eigenvalues a rounding step apart still makes it direct,
    // both edges reported at the first q-point reaching both
    [`direct across a repeated junction point`, [[-1, -2, -1.00005], [1.00003, 3, 1]], undefined, {
      gap: 2, is_direct: true,
      vbm: { energy: -1, band_idx: 0, qpoint_idx: 0 }, cbm: { energy: 1, band_idx: 1, qpoint_idx: 0 },
      direct_gap: { energy: 1.00003 + 1, qpoint_idx: 0 },
    }],
    [`degenerate VBM reports its lowest band`, [[-2, -1], [-3, -1], [1, 2]], undefined, {
      gap: 2, is_direct: false,
      vbm: { energy: -1, band_idx: 0, qpoint_idx: 1 }, cbm: { energy: 1, band_idx: 2, qpoint_idx: 0 },
      direct_gap: { energy: 3, qpoint_idx: 0 },
    }],
    [`spin-polarized, both edges spin down`, [[-1, -2], [2, 3]], { bands: [[-3, -0.5], [1.5, 0.8]], filling: 0 }, {
      gap: 1.3, is_direct: true,
      vbm: { energy: -0.5, band_idx: 0, qpoint_idx: 1, spin: `down` },
      cbm: { energy: 0.8, band_idx: 1, qpoint_idx: 1, spin: `down` },
      direct_gap: { energy: 1.3, qpoint_idx: 1, spin: `down` },
    }],
    // same q-point but different spins: direct in k, while no spin channel has a vertical gap
    // that small
    [`spin-flip edges at one q-point`, [[-0.5, -1], [3, 3]], { bands: [[-2, -2], [0.5, 1]], filling: 0 }, {
      gap: 1, is_direct: true,
      vbm: { energy: -0.5, band_idx: 0, qpoint_idx: 0, spin: `up` },
      cbm: { energy: 0.5, band_idx: 1, qpoint_idx: 0, spin: `down` },
      direct_gap: { energy: 2.5, qpoint_idx: 0, spin: `down` },
    }],
    [`no channel with filled and empty bands`, [[-1]], { bands: [[1]], filling: 0 }, {
      gap: 2, is_direct: true,
      vbm: { energy: -1, band_idx: 0, qpoint_idx: 0, spin: `up` },
      cbm: { energy: 1, band_idx: 0, qpoint_idx: 0, spin: `down` },
      direct_gap: null,
    }],
  ])(`edge locations: %s`, (_desc, bands, spin_down, expected) => {
    expect(electronic_band_gap(bands, 0, spin_down)).toEqual(expected)
  })

  it(`a partially filled spin-down band makes a metal`, () => {
    const spin_down = { bands: [[-0.5, 0.5]], filling: [[1, 0]] }
    expect(electronic_band_gap([[-1, -1]], [[1, 1]], spin_down)).toBeNull()
  })

  // pymatgen 2026.7.31 BandStructureSymmLine get_band_gap/get_vbm/get_cbm/
  // get_direct_band_gap_dict on the same files: CaO VBM at Γ (q-points 0, 63, 64, bands 5-7),
  // CBM at X (15, 16, 159; band 8), direct 4.0126 eV at q-point 15; VBr2 (spin-polarized) VBM
  // 110/13 and CBM 74/14 both spin up, direct 1.1572 eV at q-point 75 (spin up)
  // oxfmt-ignore
  it.each([
    [`CaO`, cao_json, {
      gap: 3.6348, is_direct: false,
      vbm: { energy: 2.2361, band_idx: 5, qpoint_idx: 0 }, cbm: { energy: 5.8709, band_idx: 8, qpoint_idx: 15 },
      direct_gap: { energy: 4.0126, qpoint_idx: 15 },
    }],
    [`VBr2`, vbr2_json, {
      gap: 1.1314, is_direct: false,
      vbm: { energy: 2.2647, band_idx: 13, qpoint_idx: 110, spin: `up` },
      cbm: { energy: 3.3961, band_idx: 14, qpoint_idx: 74, spin: `up` },
      direct_gap: { energy: 1.1572, qpoint_idx: 75, spin: `up` },
    }],
  ])(`matches pymatgen on the %s band fixture`, (_name, json, expected) => {
    const band_structure = normalize_band_structure(JSON.parse(json))
    if (!band_structure?.efermi) throw new Error(`fixture lacks bands or efermi`)
    const { bands, spin_down_bands, efermi } = band_structure
    const spin_down = spin_down_bands && { bands: spin_down_bands, filling: efermi }
    const result = electronic_band_gap(bands, efermi, spin_down)
    if (!result) throw new Error(`expected a gap`)
    // fixture energies have 4 decimals, so differences are exact to ~1e-12
    expect(result.gap).toBeCloseTo(expected.gap, 10)
    expect(result.direct_gap?.energy).toBeCloseTo(expected.direct_gap.energy, 10)
    const round = <T extends { energy: number }>(edge: T) => ({ ...edge, energy: Number(edge.energy.toFixed(4)) })
    expect({ ...result, gap: expected.gap, vbm: round(result.vbm), cbm: round(result.cbm),
      direct_gap: result.direct_gap && round(result.direct_gap) }).toEqual(expected)
  })

  // oxfmt-ignore
  it.each([
    [`too few bands (e.g. a missing spin-down channel)`, [[1, 1]], /1 occupation rows for 2 bands/],
    [`a ragged band`, [[1, 1], [0]], /occupation row 1 needs 2 finite values/],
    [`non-finite values`, [[1, NaN], [0, 0]], /occupation row 0 needs 2 finite values/],
  ])(`throws for occupations with %s`, (_desc, occupations, error) => {
    expect(() => electronic_band_gap([[-1, 0], [1, 2]], occupations)).toThrow(error)
  })
})

describe(`normalize_dos`, () => {
  const up = [0.5, 1, 0.5]
  const down = [0.4, 0.9, 0.4]
  it.each([
    [`numeric spin keys`, { '1': up, '-1': down }, down],
    [`Spin.up/Spin.down keys`, { 'Spin.up': up, 'Spin.down': down }, down],
    [`spin-up listed second`, { '-1': down, '1': up }, down],
    [`a plain array`, up, undefined],
  ])(`electronic densities as %s`, (_label, densities, spin_down_densities) => {
    expect(normalize_dos({ energies: [-5, 0, 5], densities, efermi: 2 })).toEqual({
      type: `electronic`,
      energy_unit: `eV`,
      efermi: 2,
      energies: [-5, 0, 5],
      densities: up,
      spin_down_densities,
      spin_polarized: spin_down_densities !== undefined,
    })
  })

  // An ElectronicDos carries its unit: normalizing it again is a no-op in eV, converts Ry to eV,
  // and keeps an unknown unit unknown (a band-grid DOS from a BXSF or FRMSF) instead of
  // reading it as eV
  it.each([
    [`eV`, `eV`, 1],
    [`Ry`, `eV`, HARTREE_TO_EV / 2],
    [null, null, 1],
  ] as const)(
    `a DOS with energy_unit %s normalizes to %s`,
    (energy_unit, expected, factor) => {
      const dos = {
        type: `electronic`,
        energy_unit,
        energies: [0, 2],
        densities: [1, 3],
        efermi: 1,
      }
      const result = normalize_dos(dos)
      if (result?.type !== `electronic`) throw new Error(`expected an electronic DOS`)
      expect(result.energy_unit).toBe(expected)
      expect(result.energies).toEqual([0, 2 * factor])
      expect(result.efermi).toBe(factor)
      expect(result.densities).toEqual([1 / factor, 3 / factor])
      expect(normalize_dos(result)).toEqual(result) // idempotent
    },
  )

  it.each([
    [{ energy_unit: `kcal`, energies: [0], densities: [1] }, /Invalid energy unit "kcal"/],
    [{ energy_unit: `eV`, unit: `Ha`, energies: [0], densities: [1] }, /both unit "Ha" and/],
  ])(`rejects a DOS with %j`, (dos, message) => {
    expect(() => normalize_dos(dos)).toThrow(message)
  })

  it(`honours an explicit spin_polarized flag and an explicit spin_down_densities field`, () => {
    const flat = { energies: [0, 1], densities: [1, 1] }
    const flagged = normalize_dos({ ...flat, spin_polarized: true })
    expect(flagged).toMatchObject({ spin_polarized: true })
    const with_down = normalize_dos({ ...flat, spin_down_densities: [2, 2] })
    expect(with_down).toMatchObject({ spin_polarized: true, spin_down_densities: [2, 2] })
  })

  // markup where it renders (axis labels, HTML: fonts set the ⁻ of ⁻¹ low), glyphs where
  // it can't (<option>, aria-label)
  it.each([
    [`cm^-1`, `cm<sup>−1</sup>`, `cm⁻¹`],
    [`THz`, `THz`, `THz`],
  ])(`%s reads as %s in markup and %s in plain text`, (unit, label, text) => {
    expect([frequency_unit_label(unit), frequency_unit_text(unit)]).toEqual([label, text])
  })

  it.each([
    [undefined, 1],
    [`THz`, 1],
    [`cm-1`, 1 / THZ_TO_INVERSE_CM],
    [`cm^-1`, 1 / THZ_TO_INVERSE_CM],
    [`cm⁻¹`, 1 / THZ_TO_INVERSE_CM],
    [`meV`, 1 / 4.135667696],
  ])(`phonon DOS in %s is stored in THz, keeping ∫g dν`, (frequency_unit, thz_per_unit) => {
    const result = normalize_dos({
      frequencies: [0, 10],
      densities: [0, 1],
      ...(frequency_unit && { frequency_unit }),
    })
    if (result?.type !== `phonon`)
      throw new Error(`expected a phonon DOS, got ${result?.type}`)
    expect(result.frequencies[1]).toBeCloseTo(10 * thz_per_unit, 8)
    expect(result.densities[1]).toBeCloseTo(1 / thz_per_unit, 8)
  })

  it.each([
    [undefined, 1],
    [`meV`, 1e-3],
    [`Ha`, HARTREE_TO_EV],
  ])(`electronic DOS in %s is stored in eV, keeping ∫g dE`, (unit, ev_per_unit) => {
    const densities = { '1': [0, 2], '-1': [0, 4] }
    const result = normalize_dos({ energies: [0, 10], densities, efermi: 5, unit })
    if (result?.type !== `electronic`) throw new Error(`expected an electronic DOS`)
    expect(result.energies[1]).toBeCloseTo(10 * ev_per_unit, 12)
    expect(result.efermi).toBeCloseTo(5 * ev_per_unit, 12)
    expect(result.densities[1]).toBeCloseTo(2 / ev_per_unit, 9)
    expect(result.spin_down_densities?.[1]).toBeCloseTo(4 / ev_per_unit, 9)
    // a projection converts like the total DOS whose unit it shares
    const atom_dos = { Fe: { energies: [0, 10], densities, efermi: 5 } }
    expect(extract_pdos({ unit, atom_dos }, `atom`)).toEqual({ Fe: result })
    // a malformed spin-down channel is dropped, not converted
    const flat = { energies: [0, 1], densities: [1, 2], unit }
    const no_down = normalize_dos({ ...flat, spin_down_densities: {}, spin_polarized: false })
    expect(no_down).toMatchObject({ spin_polarized: false, spin_down_densities: undefined })
  })

  it.each([
    [`null`, null],
    [`a string`, `dos`],
    [`an electronic DOS in a frequency unit`, { energies: [1], densities: [1], unit: `THz` }],
    [`missing densities`, { frequencies: [1, 2] }],
    [`a length mismatch`, { frequencies: [1, 2, 3], densities: [0, 1] }],
    [`an empty spin record`, { energies: [0, 1], densities: {} }],
    [`an unknown frequency unit`, { frequencies: [1], densities: [1], unit: `GHz` }],
    // an inherited Object.prototype key is no unit alias (it threw Invalid unit instead)
    [`a prototype-key unit`, { frequencies: [1], densities: [1], unit: `constructor` }],
    [`pymatgen input without an axis`, { '@class': `PhononDos`, densities: [0, 1] }],
  ])(`returns null for %s`, (_label, input) => {
    const spy = vi.spyOn(console, `warn`).mockImplementation(() => {})
    expect(normalize_dos(input)).toBeNull()
    spy.mockRestore()
  })
})

describe(`shift_to_fermi`, () => {
  const dos = (
    efermi: number,
    energies: number[],
    extra: Partial<PymatgenCompleteDos> = {},
  ): PymatgenCompleteDos => ({ energies, densities: energies.map(() => 1), efermi, ...extra })

  it.each([
    [5, [-10, 0, 10], [-15, -5, 5]],
    [0, [-5, 0, 5], [-5, 0, 5]],
    [-2.5, [-10, 0, 5], [-7.5, 2.5, 7.5]],
  ])(`shifts efermi %f to 0 without mutating the input`, (efermi, energies, expected) => {
    const input = dos(efermi, energies)
    const shifted = shift_to_fermi(input)
    expect(shifted.efermi).toBe(0)
    expect(shifted.energies).toEqual(expected)
    expect(input.energies).toEqual(energies)
    expect(shifted.densities).toBe(input.densities)
  })

  it(`shifts nested atom_dos and spd_dos and keeps every other field`, () => {
    const nested = { ...dos(5, [0, 5, 10]), '@class': `Dos`, densities: [0.3, 0.6, 0.3] }
    const extra = { '@class': `LobsterCompleteDos`, structure: { lattice: {} } } as const
    const projections = { atom_dos: { Fe: nested }, spd_dos: { s: nested } }
    const shifted = shift_to_fermi(dos(5, [0, 5, 10], { ...extra, ...projections }))
    expect(shifted).toMatchObject({ ...extra, efermi: 0, energies: [-5, 0, 5] })
    for (const inner of [shifted.atom_dos?.Fe, shifted.spd_dos?.s]) {
      expect(inner).toEqual({ ...nested, efermi: 0, energies: [-5, 0, 5] })
    }
  })

  // each material shifts by its own E_F, so band structures with different Fermi energies align
  it(`shift_bands_to_fermi puts both spin channels at E_F = 0 without mutating the input`, () => {
    const input = make_bs([`Γ`, `X`], {
      efermi: 5,
      bands: [[3, 6]],
      spin_down_bands: [[5, 5.5]],
    })
    const shifted = { ...input, efermi: 0, bands: [[-2, 1]], spin_down_bands: [[0, 0.5]] }
    expect(shift_bands_to_fermi(input)).toEqual(shifted)
    expect(input.bands).toEqual([[3, 6]])
    const { efermi: _efermi, ...no_efermi } = input
    expect(() => shift_bands_to_fermi(no_efermi)).toThrow(/no efermi/)
  })
})

describe(`generate_ribbon_path`, () => {
  const identifier = (val: number) => val
  it(`traces the upper edge forward and the lower edge back at y ∓ half-width px`, () => {
    const path = generate_ribbon_path([0, 1, 2], [5, 5, 5], [5, 10, 5], identifier, identifier)
    expect(path).toBe(
      `M0.00,0.00 L1.00,-5.00 L2.00,0.00 L2.00,10.00 L1.00,15.00 L0.00,10.00 Z`,
    )
    expect(generate_ribbon_path([0, 1], [5, 5], [20, 20], (val) => 2 * val, identifier)).toBe(
      `M0.00,-15.00 L2.00,-15.00 L2.00,25.00 L0.00,25.00 Z`,
    )
  })

  it.each([
    [`too few points`, [0], [0], [1]],
    [`mismatched y`, [0, 1, 2], [0, 1], [1, 1, 1]],
    [`mismatched widths`, [0, 1, 2], [0, 1, 2], [1, 1]],
  ])(`returns "" for %s`, (_label, x_vals, y_vals, half_widths) => {
    expect(generate_ribbon_path(x_vals, y_vals, half_widths, identifier, identifier)).toBe(``)
  })
})

describe(`compute_frequency_range`, () => {
  const bands_of = (bands: number[][], type: `phonon` | `electronic` = `phonon`) => ({
    sample: make_bs(Array(bands[0].length).fill(null), { bands, type }),
  })
  const dos_of = (frequencies: number[], density_of = (_freq: number) => 1) => ({
    sample: { type: `phonon` as const, frequencies, densities: frequencies.map(density_of) },
  })
  // grid -0.6…15 THz at unit density, with density `tail` below 0
  const stable_dos = (tail: number) =>
    dos_of(
      Array.from({ length: 157 }, (_, idx) => -0.6 + idx / 10),
      (freq) => (freq < 0 ? tail : 1),
    )
  // grid -1…20 THz: an imaginary-mode peak (2.0 at -0.8 THz) plus a broad band at 8 THz
  const imaginary_grid = Array.from({ length: 211 }, (_, idx) => -1 + idx / 10)
  const imaginary_density = (freq: number) =>
    2 * Math.exp(-(((freq + 0.8) / 0.15) ** 2)) + Math.exp(-(((freq - 8) / 4) ** 2))
  const soft_cell = [
    ...Array.from({ length: 24 }, (_band, band_idx) =>
      Array.from({ length: 300 }, (_qpt, q_idx) => 1 + (7 * ((band_idx + q_idx) % 24)) / 23),
    ),
    Array.from({ length: 300 }, (_, q_idx) => (q_idx < 15 ? -1.5 : 0)),
  ]
  const electronic_of = (energies: number[]) => ({
    sample: {
      type: `electronic` as const,
      energy_unit: `eV` as const,
      energies,
      densities: energies.map((_, idx) => idx % 2),
    },
  })
  // oxfmt-ignore
  it.each([
    [`phonon bands`, bands_of([[0, 5, 10], [2, 8, 15]]), {}, [0, 15.3]],
    [`a phonon DOS`, {}, dos_of([0, 5, 15]), [0, 15.3]],
    [`bands plus DOS`, bands_of([[0, 5]]), dos_of([0, 20]), [0, 20.4]],
    [`multiple band structures`, { ...bands_of([[0, 5]]), other: bands_of([[2, 12]]).sample }, {}, [0, 12.24]],
    [`multiple DOS`, {}, { ...dos_of([0, 8]), other: dos_of([0, 15]).sample }, [0, 15.3]],
    [`electronic DOS`, {}, electronic_of([-10, 0, 10]), [-10.4, 10.4]],
    [`non-finite band values`, bands_of([[0, NaN, 5, Infinity, 10]]), {}, [0, 10.2]],
    [`negative noise under 0.5%`, bands_of([[-0.01, 5, 10], [0, 8, 15]]), {}, [0, 15.3]],
    [`real imaginary modes`, bands_of([[-2, -1, 0, 5, 10]]), {}, [-2.24, 10.24]],
    // A soft branch in a large cell is well under 0.5% of all |values| but still a genuine
    // instability (< -0.5 THz); the noise clamp used to cut it off at [0, 8.14]
    [`a soft branch in a large cell`, bands_of(soft_cell), {}, [-1.5 - 9.5 * 0.02, 8 + 9.5 * 0.02]],
    // DOS grids run below 0 at zero density (-0.59 THz in mp-2691 PBE), or with a smearing
    // tail far below IMAGINARY_MODE_NOISE_THRESHOLD of the total density: no imaginary mode
    [`a DOS grid reaching below the imaginary cutoff`, bands_of([[0, 5, 10]]), stable_dos(0), [0, 15.3]],
    [`a DOS smearing tail below the imaginary cutoff`, bands_of([[0, 5, 10]]), stable_dos(1e-4), [0, 15.3]],
    // ...but DOS density below -0.5 THz is a real imaginary mode, with or without bands
    // (was clamped to [0, 20.4] when the bands had no negative frequency or were absent)
    [`a DOS imaginary-mode peak`, {}, dos_of(imaginary_grid, imaginary_density), [-1.42, 20.42]],
    [`a DOS imaginary-mode peak next to stable bands`, bands_of([[0, 5, 10]]), dos_of(imaginary_grid, imaginary_density), [-1.42, 20.42]],
    [`electronic bands retain small negative values`, bands_of([[-0.01, 5, 10]], `electronic`), {}, [-0.2102, 10.2002]],
    [`electronic DOS extends the bands range`, bands_of([[-0.01, 5, 10]], `electronic`), electronic_of([-5, 0, 5]), [-5.3, 10.3]],
    [`spin-down extrema in the shared electronic range`, { sample: { ...bands_of([[0, 1]], `electronic`).sample, spin_down_bands: [[-5, 10]] } }, {}, [-5.3, 10.3]],
  ])(`%s`, (_label, bands, doses, expected) => {
    const range = compute_frequency_range(bands, doses)
    expect(range?.[0]).toBeCloseTo(expected[0], 9)
    expect(range?.[1]).toBeCloseTo(expected[1], 9)
  })

  const electronic_dos = { electronic: electronic_of([0, 10]).sample }
  const in_unit = (energy_unit: `Ry` | null) => ({ ...electronic_dos.electronic, energy_unit })
  // one axis holds one energy unit, and band structures are eV
  // oxfmt-ignore
  it.each([
    [`bands`, { ...bands_of([[0, 10]]), electronic: bands_of([[0, 10]], `electronic`).sample }, {}, /Cannot mix phonon and electronic spectra/],
    [`dos`, {}, { ...dos_of([0, 10]), ...electronic_dos }, /Cannot mix phonon and electronic spectra/],
    [`both`, bands_of([[0, 10]]), electronic_dos, /Cannot mix phonon and electronic spectra/],
    [`DOS energy units`, {}, { ...electronic_dos, ry: in_unit(`Ry`) }, /energies in eV and Ry on one/],
    [`DOS and band units`, bands_of([[0, 10]], `electronic`), { dos: in_unit(null) }, /in unknown unit and eV on one/],
  ])(`rejects mixed %s`, (_scope, bands, doses, message) => {
    expect(() => compute_frequency_range(bands, doses)).toThrow(message)
  })

  it(`returns undefined for empty collections and honours padding`, () => {
    expect(compute_frequency_range({}, {})).toBeUndefined()
    expect(compute_frequency_range({}, dos_of([0, 10]), 0.1)).toEqual([0, 11])
  })

  // oxfmt-ignore
  it.each([
    [`efermi`, { efermi: 5 }, true],
    [`kpoints`, { kpoints: [{ frac_coords: [0, 0, 0] }] }, true],
    [`electronic @class`, { '@class': `BandStructureSymmLine`, ...identity_rec }, true],
    [`electronic @module`, { '@module': `pymatgen.electronic_structure.bandstructure`, ...identity_rec }, true],
    [`phonon @class`, { '@class': `PhononBandStructureSymmLine`, ...identity_rec }, false],
  ])(`adapter retains type and range from %s`, (_label, marker, is_electronic) => {
    const { type: _type, ...raw } = bands_of([[-0.01, 5, 10]]).sample
    const input = { ...raw, ...marker }
    expect(is_electronic_band_struct(input)).toBe(is_electronic)
    const normalized = normalize_band_structure(input)
    if (!normalized) throw new Error(`Expected canonical bands`)
    expect(normalized.type).toBe(is_electronic ? `electronic` : `phonon`)
    const range = compute_frequency_range({ sample: normalized }, {})
    expect(range?.[0]).toBeCloseTo(is_electronic ? -0.01 - 10.01 * 0.02 : 0, 9)
  })
})

it.each([
  [[], 0],
  [[1, 2, 3], 0],
  [[-1, -2, -3], 1],
  [[0, 0], 0],
  [[-2, -1, 7], 0.3],
  [[NaN, -1, 1, Infinity], 0.5],
  [[NaN, Infinity, -Infinity], 0],
])(`negative_fraction(%j) → %f`, (values, expected) => {
  expect(negative_fraction(values)).toBeCloseTo(expected, 12)
})

describe(`acoustic classification`, () => {
  // oxfmt-ignore
  it.each([
    [[[null, [1, 0, 0]], [null, [0.5, 0, 0]], [null, [-1, 0, 0]]], [0, 2]],
    [[[`GAMMA`, [0, 0, 0]], [`X`, [0.5, 0, 0]], [`GAMMA`, [0, 0, 0]]], [0, 2]],
    [[[`X`, [0.5, 0, 0]]], []],
    [[], []],
    [[[null, [0.02, 0, 0]]], []],
    [[[null, [0.009, -0.005, 0.001]]], [0]],
  ] as [[string | null, Vec3][], number[]][])(
    `find_gamma_indices(%j) → %j`,
    (qpoints, expected) => {
      const band_structure = make_bs([], {
        qpoints: qpoints.map(([label, frac_coords]) => ({ label, frac_coords })),
      })
      expect(find_gamma_indices(band_structure)).toEqual(expected)
    },
  )

  it.each([
    [[0, 5, 10], 0, [0], true],
    [[-0.3, 5, 10], 0, [0], true],
    [[ACOUSTIC_FREQ_THRESHOLD, 5, 10], 0, [0], false],
    [[5, 5, 10], 0, [], null], // no Gamma point: undecidable
    [[5, 10, 0.1], 0, [0, 2], true], // acoustic if any Gamma point is near zero
    [[0, 5, 10], 99, [0], false], // missing band
  ])(
    `classify_acoustic(%j, band %i, Gamma %j) → %s`,
    (band, band_idx, gamma_indices, expected) => {
      const band_structure = make_bs([null, null, null], { bands: [band] })
      expect(classify_acoustic(band_structure, band_idx, gamma_indices)).toBe(expected)
    },
  )
})

describe(`build_point_metadata`, () => {
  // oxfmt-ignore
  const band_structure = make_bs([`GAMMA`, null, `X`], {
    bands: [[0, 5, 10], [3, 6, 9]],
    band_widths: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]],
  })
  const build = (overrides: Partial<Parameters<typeof build_point_metadata>[0]> = {}) =>
    build_point_metadata({
      x_vals: [0, 1, 2],
      y_vals: [0, 5, 10],
      band_idx: 0,
      spin: `up`,
      is_acoustic: true,
      bs: band_structure,
      start_idx: 0,
      ...overrides,
    })

  it(`fills per-point q-point data, band widths and central-difference slopes`, () => {
    const [first, middle, last] = build()
    expect(first).toEqual({
      aria_label: `Select band 1, q-point 1`,
      band_idx: 0,
      qpoint_idx: 0,
      spin: `up`,
      is_acoustic: true,
      nb_bands: 2,
      frac_coords: [0, 0, 0],
      qpoint_label: `GAMMA`,
      band_width: 0.1,
      slope: 5,
    })
    expect(middle).toMatchObject({
      qpoint_label: null,
      qpoint_idx: 1,
      band_width: 0.2,
      slope: 5,
    })
    expect(last).toMatchObject({ qpoint_label: `X`, band_width: 0.3, slope: 5 })
  })

  it(`offsets into the path with start_idx and uses one-sided slopes at the ends`, () => {
    const spin_down = { band_idx: 1, spin: `down`, is_acoustic: null } as const
    const [first, last] = build({ ...spin_down, x_vals: [0, 2], y_vals: [5, 9], start_idx: 1 })
    expect(first).toMatchObject({ ...spin_down, qpoint_idx: 1, band_width: 0.5, slope: 2 })
    expect(first.aria_label).toBe(`Select band 2, q-point 2`)
    expect(last).toMatchObject({ qpoint_idx: 2, qpoint_label: `X`, band_width: 0.6, slope: 2 })
    const without_widths = build({
      bs: make_bs([`GAMMA`, null, `X`]),
      x_vals: [0],
      y_vals: [5],
    })
    expect(without_widths[0]).toMatchObject({ band_width: null, slope: null }) // single point: dx = 0
    expect(build({ x_vals: [], y_vals: [] })).toEqual([])
  })
})

// unpolarized bands always overlay, so `down_only` never draws nothing
it.each([
  [`overlay`, true, `overlay`],
  [`up_only`, true, `up_only`],
  [`down_only`, true, `down_only`],
  [null, true, `overlay`],
  [`up_only`, false, `overlay`],
  [`down_only`, false, `overlay`],
] as const)(`resolve_spin_mode(%s, has_spin_down=%s) → %s`, (mode, has_down, expected) => {
  expect(resolve_spin_mode(mode, has_down)).toBe(expected)
})
