import { calc_coordination_nums } from '$lib/coordination'
import { describe, expect, test } from 'vitest'
import { make_crystal } from '../setup'

describe(`calc_coordination_nums`, () => {
  // Simple cubic structure (NaCl-like)
  const simple_cubic = make_crystal(5, [
    [`Na`, [0, 0, 0], 1],
    [`Cl`, [0.5, 0.5, 0.5], -1],
    [`Na`, [0.5, 0, 0], 1],
    { element: `Cl`, abc: [0, 0.5, 0.5], oxidation_state: -1 },
  ])

  test.each([`electroneg_ratio`, `solid_angle`] as const)(
    `computes per-element coordination (%s)`,
    (strategy) => {
      const result = calc_coordination_nums(simple_cubic, strategy)
      expect(result.sites).toHaveLength(4)
      expect(result.cn_histogram.size).toBeGreaterThan(0)
      expect(result.cn_by_element.size).toBe(2) // Na and Cl
      for (const elem of [`Na`, `Cl`] as const) {
        expect(result.cn_by_element.has(elem)).toBe(true)
        expect(result.cn_histogram_by_element.has(elem)).toBe(true)
      }
    },
  )

  test(`should handle structure with distant atoms`, () => {
    const isolated_atoms = make_crystal(
      100,
      [
        [`H`, [0, 0, 0]],
        [`He`, [0.5, 0.5, 0.5]],
      ],
      { pbc: [false, false, false] },
    )

    // With atoms 50 Å apart, no bonds should form with default electroneg_ratio strategy
    const result = calc_coordination_nums(isolated_atoms, `electroneg_ratio`)

    expect(result.sites).toHaveLength(2)
    // Both atoms should have CN = 0 since they are too far apart for bonding
    const cn_values = result.sites.map((site) => site.coordination_num)
    expect(cn_values.every((cn) => cn === 0)).toBe(true)
    expect(result.cn_histogram.get(0)).toBe(2)
  })

  // PBC-expanded structures append image atoms after the originals and pass the
  // original-atom count as center_count; only the originals must appear as centers.
  test.each([
    [undefined, 4],
    [2, 2],
    [1, 1],
  ])(
    `center_count=%s restricts per-site data/histograms to %s centers`,
    (center_count, expected) => {
      const result = calc_coordination_nums(simple_cubic, `electroneg_ratio`, center_count)
      expect(result.sites).toHaveLength(expected)
      const histogram_total = [...result.cn_histogram.values()].reduce((sum, n) => sum + n, 0)
      expect(histogram_total).toBe(expected)
    },
  )

  test(`buckets disordered sites by majority element, not species[0]`, () => {
    const struct = make_crystal(3, [
      [`Cl`, [0, 0, 0]],
      [`O`, [0.5, 0.5, 0.5]],
    ])
    // Disordered site whose minority species (Na) is listed first
    struct.sites[0].species = [
      { element: `Na`, occu: 0.3, oxidation_state: 0 },
      { element: `Cl`, occu: 0.7, oxidation_state: 0 },
    ]
    const result = calc_coordination_nums(struct, `electroneg_ratio`)
    expect(result.cn_by_element.has(`Cl`)).toBe(true)
    expect(result.cn_histogram_by_element.has(`Cl`)).toBe(true)
    // Minority element must NOT create its own bucket for the disordered site
    expect(result.cn_by_element.has(`Na`)).toBe(false)
    expect(result.sites[0].element).toBe(`Cl`)
  })
})
