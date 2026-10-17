import { THZ_TO_INVERSE_CM } from '#lib/constants.js'
import type { Matrix3x3, Vec2, Vec3 } from '#lib/math.js'
import {
  convert_frequencies,
  frequency_unit_label,
  frequency_unit_text,
} from '#lib/spectral/frequency-units.js'
import type { PymatgenCompleteDos } from '#lib/spectral/helpers.js'
import {
  ACOUSTIC_FREQ_THRESHOLD,
  are_qpoints_equivalent,
  band_k_path,
  apply_gaussian_smearing,
  gaussian_kernel_smooth,
  branch_path_label,
  branch_segment_keys,
  build_point_metadata,
  classify_acoustic,
  compute_frequency_range,
  density_divisor,
  extract_k_path_points,
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
import { describe, expect, it, vi } from 'vitest'

// pymatgen input needs a reciprocal lattice to measure its k-path; the identity keeps the
// hand-computed fractional distances valid
const identity_rec = { lattice_rec: { matrix: IDENTITY_MATRIX3 } }

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
  const branches = label_indices.slice(1).map((end_index, branch_idx) => ({
    start_index: label_indices[branch_idx],
    end_index,
    name: `${labels[label_indices[branch_idx]]}-${labels[end_index]}`,
  }))
  const bands = overrides.bands ?? [qpoints.map((_, idx) => idx)]
  return {
    type: `phonon`,
    qpoints,
    branches: branches.length
      ? branches
      : [{ start_index: 0, end_index: qpoints.length - 1, name: `path` }],
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

describe(`apply_gaussian_smearing`, () => {
  const energies = [0, 1, 2, 3, 4]
  const spike = [0, 0, 10, 0, 0]

  it(`returns degenerate input untouched`, () => {
    expect(apply_gaussian_smearing(energies, spike, 0)).toBe(spike)
    expect(apply_gaussian_smearing(energies, [0, 0, 0, 0, 0], 0.5)).toEqual([0, 0, 0, 0, 0])
    // a grid with no extent has zero trapezoid weights everywhere, so the convolution scaled
    // every density to 0 rather than passing it through
    expect(apply_gaussian_smearing([0], [5], 0.5)).toEqual([5]) // one-point grid
    expect(apply_gaussian_smearing([1, 1, 1], [2, 2, 2], 0.5)).toEqual([2, 2, 2]) // no extent
  })

  it(`spreads a spike symmetrically with the normalized Gaussian shape`, () => {
    const smeared = apply_gaussian_smearing(energies, spike, 0.5)
    expect(smeared[1]).toBeCloseTo(smeared[3], 12)
    expect(smeared[1]).toBeGreaterThan(0)
    // Gaussian ratio exp(-1/(2·0.25)) = e^-2 between the first neighbour and the centre
    expect(smeared[1] / smeared[2]).toBeCloseTo(Math.exp(-2), 12)
    // the centre carries the spike's weight (1 wide here) times the kernel peak 1/(σ√2π)
    expect(smeared[2]).toBeCloseTo(10 / (0.5 * Math.sqrt(2 * Math.PI)), 12)
  })

  // the old measure-free form weighted by POINT DENSITY: a flat DOS came out anywhere from
  // 0.235 to 1.950 over this grid's interior. gaussian_kernel_smooth is its Nadaraya-Watson
  // sibling: exact on constants everywhere, with no quadrature measure.
  it(`leaves a flat density alone on a clustered grid, as does gaussian_kernel_smooth`, () => {
    const clustered = [
      ...Array.from({ length: 40 }, (_, idx) => -4 + idx * 0.1),
      ...Array.from({ length: 60 }, (_, idx) => idx * 0.005),
      ...Array.from({ length: 40 }, (_, idx) => 0.3 + idx * 0.1),
    ]
    const ones = clustered.map(() => 1)
    const smeared = apply_gaussian_smearing(clustered, ones, 0.3)
    // interior only (the convolution loses mass past the grid ends); ±4σ truncation plus
    // trapezoid error at the 0.005 → 0.1 spacing jump measures 3.21e-3
    const errors = clustered.flatMap((x_val, idx) =>
      Math.abs(x_val) > 2.5 ? [] : [Math.abs(smeared[idx] - 1)],
    )
    expect(Math.max(...errors)).toBeLessThan(5e-3)
    for (const val of gaussian_kernel_smooth(clustered, ones, 0.3)) {
      expect(val).toBeCloseTo(1, 12)
    }
    // still an actual smoother, and sigma <= 0 passes straight through
    const alternating = clustered.map((_unused, idx) => (idx % 2 === 0 ? 1 : -1))
    const smoothed = gaussian_kernel_smooth(clustered, alternating, 0.3)
    for (const val of smoothed.slice(45, 55)) expect(Math.abs(val)).toBeLessThan(0.5)
    expect(gaussian_kernel_smooth(clustered, alternating, 0)).toBe(alternating)
  })

  // The two-pointer window is only valid on an ascending grid; anything else falls back to
  // scanning every point. Pin that fallback to an unwindowed reference.
  const brute_force = (x_values: number[], y_values: number[], sigma: number): number[] => {
    const weights = trapezoid_weights(x_values)
    const kernel = (delta: number) =>
      Math.abs(delta) > 4 * sigma ? 0 : Math.exp(-(delta ** 2) / (2 * sigma ** 2))
    const norm = sigma * Math.sqrt(2 * Math.PI)
    return x_values.map(
      (energy) =>
        x_values.reduce(
          (sum, other, jdx) => sum + y_values[jdx] * weights[jdx] * kernel(energy - other),
          0,
        ) / norm,
    )
  }
  const grid = Array.from({ length: 60 }, (_, idx) => idx * 0.1)
  it.each([
    [`ascending`, grid],
    // every non-monotonic grid takes the same unwindowed fallback
    [`descending`, grid.toReversed()],
    [`with duplicates`, grid.map((val, idx) => (idx % 4 === 0 ? grid[0] : val))],
  ])(`matches an unwindowed reference on a %s grid`, (_label, x_values) => {
    const y_values = x_values.map((_, idx) => ((idx * 37) % 11) + 0.5)
    const expected = brute_force(x_values, y_values, 0.25)
    const smeared = apply_gaussian_smearing(x_values, y_values, 0.25)
    const errors = smeared.map((val, idx) => Math.abs(val - expected[idx]))
    expect(Math.max(...errors)).toBeLessThan(1e-10)
  })
})

describe(`branch_segment_keys`, () => {
  it(`keys labelled branches by label pair, numbers repeats and positions unlabeled ones`, () => {
    // Γ→X→Γ→X→(unlabeled)
    const band_structure = make_bs([`GAMMA`, null, `X`, null, `GAMMA`, `X`])
    band_structure.branches.push({ start_index: 5, end_index: 5, name: `tail` })
    band_structure.qpoints[5] = { label: null, frac_coords: [1, 0, 0] }
    expect(branch_segment_keys(band_structure)).toEqual([
      `GAMMA_X`,
      `X_GAMMA`,
      `GAMMA_null`,
      `branch:3`,
    ])
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

describe(`extract_k_path_points`, () => {
  const fcc_recip = math.vec9_to_mat3x3([-1, 1, 1, 1, -1, 1, 1, 1, -1])

  it(`maps fractional to Cartesian with row-vector reciprocal vectors, folding to the zone`, () => {
    const band_structure = make_bs([`GAMMA`, `X`, `K`])
    band_structure.qpoints[2].frac_coords = [1 / 3, 1 / 3, 0]
    const recip = math.vec9_to_mat3x3([2, 0.5, 0, 0, 2, 0, 0, 0, 1])
    const [gamma, x_point, k_point] = extract_k_path_points(band_structure, recip, {
      wrap_to_bz: false,
    })
    expect(gamma).toEqual([0, 0, 0])
    expect(x_point).toEqual([1, 0.25, 0]) // 0.5·b1
    expect(k_point[0]).toBeCloseTo(2 / 3, 12)
    expect(k_point[1]).toBeCloseTo(0.5 / 3 + 2 / 3, 12)
    expect(extract_k_path_points(make_bs([], { qpoints: [], branches: [] }), recip)).toEqual(
      [],
    )
    expect(() => extract_k_path_points(band_structure, [[1, 0]] as never)).toThrow(/3×3/)
    // the per-point conversion Bands uses for a clicked symmetry point agrees exactly
    expect(frac_k_to_cartesian([1 / 3, 1 / 3, 0], recip, false)).toEqual(k_point)
    // a point near FCC K where per-axis wrapping is not the Wigner-Seitz image
    const near_k = make_bs([`K`], {
      qpoints: [{ label: `K`, frac_coords: [0.3713, 0.3713, 0.7425] }],
    })
    const [folded_k] = extract_k_path_points(near_k, fcc_recip)
    expect(folded_k.map((val) => Math.round(val * 1e4) / 1e4)).toEqual([
      0.7425, 0.7425, 0.0001,
    ])
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
    const recip_t = math.transpose_3x3_matrix(recip)
    for (let trial = 0; trial < 200; trial++) {
      const frac: Vec3 = [rand(), rand(), rand()]
      const folded = frac_k_to_cartesian(frac, recip)
      let min_norm = Infinity
      for (let n_1 = -8; n_1 <= 8; n_1++)
        for (let n_2 = -8; n_2 <= 8; n_2++)
          for (let n_3 = -8; n_3 <= 8; n_3++) {
            const image = math.mat3x3_vec3_multiply(recip_t, [
              frac[0] + n_1,
              frac[1] + n_2,
              frac[2] + n_3,
            ])
            min_norm = Math.min(min_norm, Math.hypot(...image))
          }
      // brute force and the fold agree to round-off (measured ≤ 1.3e-15)
      expect(Math.abs(Math.hypot(...folded) - min_norm)).toBeLessThan(1e-12)
      // and the fold moved the point by a lattice vector only
      const shift = math.mat3x3_vec3_multiply(
        math.matrix_inverse_3x3(recip_t),
        math.subtract(folded, math.mat3x3_vec3_multiply(recip_t, frac)),
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
    branches: [
      { start_index: 0, end_index: 11, name: `M-K` },
      { start_index: 11, end_index: 33, name: `K-GAMMA` },
    ],
  }
  // Wigner-Seitz test: no lattice vector G is nearer than Γ, i.e. 2k·G ≤ |G|² (to the fold's
  // 1e-6 relative tie tolerance; the 8-decimal storage noise is ~1e-8)
  const outside_first_bz = (point: Vec3, recip: Matrix3x3): boolean => {
    const recip_t = math.transpose_3x3_matrix(recip)
    for (let n_1 = -2; n_1 <= 2; n_1++)
      for (let n_2 = -2; n_2 <= 2; n_2++)
        for (let n_3 = -2; n_3 <= 2; n_3++) {
          const lattice_vec = math.mat3x3_vec3_multiply(recip_t, [n_1, n_2, n_3])
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
      branches: [
        { start_index: 0, end_index: 4, name: `a` },
        { start_index: 4, end_index: 6, name: `b` },
      ],
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
    [`a distance/qpoints length mismatch`, one_qpt({ distance: [0, 1] })],
    [`a band of the wrong length`, one_qpt({ bands: [[0, 1]] })],
    [`a branch past the last q-point`, one_qpt({ branches: [{ start_index: 0, end_index: 5, name: `t` }] })],
    [`a branch with a NaN start index`, one_qpt({ branches: [{ start_index: NaN, end_index: 0, name: `t` }] })],
    [`pymatgen input without bands`, pmg({ qpoints: line(2), bands: null })],
    [`pymatgen input with an unknown unit`, pmg({ qpoints: line(2), bands: [[0, 1]], unit: `GHz` })],
    [`pymatgen input with empty kpoints`, { kpoints: [], bands: { '1': [] } }],
  ])(`returns null for %s`, (_label, input) => {
    expect(normalize_band_structure(input)).toBeNull()
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
    const qpoints = [
      [0.00001, -0.00001, 0],
      [0.49999, 0.00001, 0],
    ]
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
    expect(result?.branches).toEqual([
      { start_index: 0, end_index: 2, name: `GAMMA-X` },
      { start_index: 3, end_index: 5, name: `W-L` },
    ])
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
        lattice_rec: { matrix: math.vec9_to_mat3x3([1, 0, 0, 0, 1, 0, 0, 0, 10]) },
      }),
    )
    // Γ-X spans 0.5, X-R spans 10 * 0.5 = 5
    expect(result?.distance.at(-1)).toBeCloseTo(5.5, 12)
    expect(result?.branches.map(({ name }) => name)).toEqual([`GAMMA-X`, `X-R`])
  })

  // Reciprocal lattice of a hexagonal cell: a* = b* = 1 at 60°, c* = 0.4. The fractional
  // metric would give |M-K| = sqrt(1/36 + 1/9) and |K-GAMMA| = sqrt(2/9); the Cartesian one
  // gives sqrt(3)/6 and 1/sqrt(3).
  const hex_matrix = math.vec9_to_mat3x3([1, 0, 0, 0.5, Math.sqrt(3) / 2, 0, 0, 0, 0.4])
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
    result?.recip_lattice?.forEach((row, row_idx) =>
      row.forEach((val, col_idx) =>
        expect(val).toBeCloseTo(hex_matrix[row_idx][col_idx] * scale, 12),
      ),
    )
    expect(result?.recip_lattice).toHaveLength(3)
    // every labeled q-point bounds a branch, so all four legs get axis labels
    expect(result?.branches.map((branch) => branch.name)).toEqual([
      `GAMMA-M`,
      `M-K`,
      `K-GAMMA`,
      `GAMMA-A`,
    ])
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
        const expected = names.map((name, idx) => ({ start_index: 3 * idx, end_index: 3 * idx + 2, name }))
        expect(result?.branches).toEqual(expected)
        expect(spy).not.toHaveBeenCalled()
        spy.mockRestore()
      },
    )

    it(`keeps valid explicit branches and drops invalid ones before falling back`, () => {
      const spy = warn()
      const explicit = normalize_band_structure(
        pmg({
          qpoints: line(3),
          bands: [[0, 1, 2]],
          branches: [
            { start_index: 0, end_index: 1, name: `a` },
            { start_index: 1, end_index: 2, name: `b` },
          ],
        }),
      )
      expect(explicit?.branches.map((branch) => branch.name)).toEqual([`a`, `b`])
      expect(spy).not.toHaveBeenCalled()
      const invalid = normalize_band_structure(
        pmg({
          qpoints: line(2),
          bands: [[0, 1]],
          branches: [
            { start_index: -1, end_index: 0, name: `x` },
            { start_index: 0, end_index: 99, name: `y` },
          ],
        }),
      )
      expect(invalid?.branches).toEqual([{ start_index: 0, end_index: 1, name: `?-?` }])
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    })
  })

  describe(`electronic (kpoints, spin-keyed bands)`, () => {
    // oxfmt-ignore
    const [up, down] = [[[0, 1], [2, 3]], [[0.1, 1.1], [2.1, 3.1]]]
    it(`reads both spin channels and drops a malformed spin-down channel`, () => {
      const with_down = (spin_down: number[][]) =>
        normalize_band_structure({
          ...identity_rec,
          kpoints: line(2),
          bands: { '1': up, '-1': spin_down },
        })
      expect(with_down(down)).toMatchObject({ bands: up, spin_down_bands: down, nb_bands: 2 })
      expect(with_down([[0.1], [2.1, 3.1]])?.spin_down_bands).toBeUndefined() // ragged
    })

    it(`recognises pymatgen input by kpoints, @class or @module, but not bare branched input`, () => {
      const branched = {
        ...identity_rec,
        kpoints: line(2),
        bands: { '1': [[0, 1]] },
        branches: [{ name: `\\Gamma-X`, start_index: 0, end_index: 1 }],
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
    expect(electronic_band_gap(bands, filling)).toEqual(expected)
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
      efermi: 2,
      energies: [-5, 0, 5],
      densities: up,
      spin_down_densities,
      spin_polarized: spin_down_densities !== undefined,
    })
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
    [`null`, null],
    [`a string`, `dos`],
    [`missing densities`, { frequencies: [1, 2] }],
    [`a length mismatch`, { frequencies: [1, 2, 3], densities: [0, 1] }],
    [`an empty spin record`, { energies: [0, 1], densities: {} }],
    [`an unknown frequency unit`, { frequencies: [1], densities: [1], unit: `GHz` }],
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
  ): PymatgenCompleteDos => ({
    energies,
    densities: energies.map(() => 1),
    efermi,
    ...extra,
  })

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
    const nested = {
      '@class': `Dos`,
      energies: [0, 5, 10],
      densities: [0.3, 0.6, 0.3],
      efermi: 5,
    }
    const shifted = shift_to_fermi(
      dos(5, [0, 5, 10], {
        '@class': `LobsterCompleteDos`,
        structure: { lattice: {} },
        atom_dos: { Fe: nested },
        spd_dos: { s: nested },
      }),
    )
    expect(shifted).toMatchObject({
      '@class': `LobsterCompleteDos`,
      structure: { lattice: {} },
      efermi: 0,
      energies: [-5, 0, 5],
    })
    for (const inner of [shifted.atom_dos?.Fe, shifted.spd_dos?.s]) {
      expect(inner).toEqual({ ...nested, efermi: 0, energies: [-5, 0, 5] })
    }
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
    sample: make_bs(
      bands[0].map(() => null),
      { bands, type },
    ),
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
  // oxfmt-ignore
  it.each([
    [`bands`, { ...bands_of([[0, 10]]), electronic: bands_of([[0, 10]], `electronic`).sample }, {}],
    [`dos`, {}, { ...dos_of([0, 10]), ...electronic_dos }],
    [`both`, bands_of([[0, 10]]), electronic_dos],
  ])(`rejects mixed spectral types in %s`, (_scope, bands, doses) => {
    expect(() => compute_frequency_range(bands, doses)).toThrow(
      /Cannot mix phonon and electronic spectra/,
    )
  })

  it(`returns undefined for empty collections and honours padding`, () => {
    expect(compute_frequency_range({}, {})).toBeUndefined()
    expect(compute_frequency_range({}, dos_of([0, 10]), 0.1)).toEqual([0, 11])
  })

  it.each([
    [`efermi`, { efermi: 5 }, true],
    [`kpoints`, { kpoints: [{ frac_coords: [0, 0, 0] }] }, true],
    [`electronic @class`, { '@class': `BandStructureSymmLine`, ...identity_rec }, true],
    [
      `electronic @module`,
      { '@module': `pymatgen.electronic_structure.bandstructure`, ...identity_rec },
      true,
    ],
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
    const [first, last] = build({
      x_vals: [0, 2],
      y_vals: [5, 9],
      band_idx: 1,
      spin: `down`,
      is_acoustic: null,
      start_idx: 1,
    })
    expect(first).toMatchObject({
      qpoint_idx: 1,
      band_idx: 1,
      spin: `down`,
      is_acoustic: null,
      band_width: 0.5,
      slope: 2,
      aria_label: `Select band 2, q-point 2`,
    })
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
