import type { Site } from '$lib/structure'
import type { Vec3 } from '$lib/math'
import {
  compute_slice_geometry,
  merge_split_partial_sites,
} from '$lib/structure/partial-occupancy'
import { describe, expect, test } from 'vitest'

const make_site = (species: Site[`species`], xyz: Vec3, label: string): Site => ({
  species,
  abc: [0, 0, 0],
  xyz,
  properties: {},
  label,
})

describe(`partial occupancy render-site logic`, () => {
  test.each([
    {
      name: `merges split partial sites at identical coordinates`,
      sites: [
        make_site(
          [{ element: `O`, occu: 0.5, oxidation_state: 0 }],
          [1.234567, 2.345678, 3.456789],
          `O`,
        ),
        make_site(
          [{ element: `F`, occu: 0.5, oxidation_state: 0 }],
          [1.234567, 2.345678, 3.456789],
          `F`,
        ),
        make_site([{ element: `Mg`, occu: 1, oxidation_state: 0 }], [9, 9, 9], `Mg`),
      ],
      expected_count: 2,
      expected_merged_elements: [`F`, `O`],
    },
    {
      name: `does not merge full-occupancy single-species sites at same coordinates`,
      sites: [
        make_site([{ element: `Na`, occu: 1, oxidation_state: 0 }], [0, 0, 0], `Na1`),
        make_site([{ element: `Na`, occu: 1, oxidation_state: 0 }], [0, 0, 0], `Na2`),
      ],
      expected_count: 2,
      expected_merged_elements: null,
    },
    {
      name: `does not merge nearby split partial sites that differ by tiny coordinate offset`,
      sites: [
        make_site([{ element: `O`, occu: 0.5, oxidation_state: 0 }], [0, 0, 0], `O`),
        make_site([{ element: `F`, occu: 0.5, oxidation_state: 0 }], [0, 0, 0.000004], `F`),
      ],
      expected_count: 2,
      expected_merged_elements: null,
    },
  ])(`$name`, ({ sites, expected_count, expected_merged_elements }) => {
    const render_sites = merge_split_partial_sites(sites)
    expect(render_sites).toHaveLength(expected_count)
    if (!expected_merged_elements) return
    const merged_site = render_sites.find(
      (site_data) =>
        site_data.site.species.length === 2 &&
        site_data.site.species.some((species) => species.element === `O`) &&
        site_data.site.species.some((species) => species.element === `F`),
    )
    expect(merged_site).toBeDefined()
    if (!merged_site) throw new Error(`Expected merged O/F site to exist`)
    expect(merged_site.site.species.map((species) => species.element).toSorted()).toEqual(
      expected_merged_elements,
    )
  })

  // Grouping is a bucket lookup rather than a scan over every group, because this runs per
  // trajectory frame and the scan was quadratic (218 ms a frame at 8k sites, which hiding one
  // species of an alloy reaches at any count - that leaves one visible species summing under 1).
  // A bucket index can only match what shares a bucket, so the case to pin is a pair closer
  // than the merge tolerance that still rounds to opposite sides of a bucket face.
  test(`merges a coincident pair that straddles a lookup bucket boundary`, () => {
    const bucket = 1e-5 // MERGE_BUCKET_SIZE
    for (const n_buckets of [1, 2, 7, 1234]) {
      const face = n_buckets * bucket + bucket / 2 // exactly on a bucket face
      const sites = [
        make_site([{ element: `O`, occu: 0.5, oxidation_state: 0 }], [face - 1e-9, 0, 0], `O`),
        make_site([{ element: `F`, occu: 0.5, oxidation_state: 0 }], [face + 1e-9, 0, 0], `F`),
      ]
      const [merged, ...rest] = merge_split_partial_sites(sites)
      expect(rest).toEqual([]) // 2 Å apart in bucket terms, 2e-9 Å apart in real terms
      expect(merged.site.species.map((sp) => sp.element).toSorted()).toEqual([`F`, `O`])
    }
  })

  // Still O(n): the scan grew 4x per doubling, so 8k sites would blow far past this budget
  test(`groups 8k split-partial sites in linear time`, () => {
    const sites = Array.from({ length: 8000 }, (_unused, idx) =>
      make_site(
        [{ element: `Na`, occu: 0.5, oxidation_state: 0 }],
        [idx * 3, 0, 0],
        `Na${idx}`,
      ),
    )
    const start = performance.now()
    expect(merge_split_partial_sites(sites)).toHaveLength(8000)
    expect(performance.now() - start).toBeLessThan(100)
  })
})

describe(`partial occupancy slice flags`, () => {
  test.each([
    {
      name: `single species with vacancy renders both caps`,
      site: make_site([{ element: `O`, occu: 0.5, oxidation_state: 0 }], [0, 0, 0], `O`),
      expected_start: true,
      expected_end: true,
    },
    {
      name: `two species filling full sphere renders no caps`,
      site: make_site(
        [
          { element: `O`, occu: 0.5, oxidation_state: 0 },
          { element: `F`, occu: 0.5, oxidation_state: 0 },
        ],
        [0, 0, 0],
        `OF`,
      ),
      expected_start: false,
      expected_end: false,
    },
  ])(`$name`, ({ site, expected_start, expected_end }) => {
    const slices = compute_slice_geometry(site.species)
    expect(slices[0].render_start_cap).toBe(expected_start)
    expect(slices[slices.length - 1].render_end_cap).toBe(expected_end)
    for (const slice of slices) expect(slice.phi_length).toBeGreaterThan(0)
    for (let slice_idx = 1; slice_idx < slices.length; slice_idx += 1) {
      expect(slices[slice_idx].start_phi).toBeGreaterThanOrEqual(
        slices[slice_idx - 1].start_phi,
      )
      expect(slices[slice_idx].end_phi).toBeGreaterThanOrEqual(slices[slice_idx - 1].end_phi)
    }
  })

  test(`normalizes overfull occupancies to avoid wedge overflow`, () => {
    const slices = compute_slice_geometry([
      { element: `O`, occu: 0.8, oxidation_state: 0 },
      { element: `F`, occu: 0.8, oxidation_state: 0 },
    ])
    // 0.8 + 0.8 is rescaled to a full turn split evenly, with no vacancy caps and only the
    // half-gap (1e-3 / 2) trimmed off each wedge end
    expect(slices.map((slice) => slice.occupancy)).toEqual([0.5, 0.5])
    expect(slices.map((slice) => slice.render_start_cap)).toEqual([false, false])
    expect(slices.map((slice) => slice.render_end_cap)).toEqual([false, false])
    expect(slices[0].start_phi).toBeCloseTo(5e-4, 12)
    expect(slices[0].end_phi).toBeCloseTo(Math.PI - 5e-4, 12)
    expect(slices[1].start_phi).toBeCloseTo(Math.PI + 5e-4, 12)
    expect(slices[1].end_phi).toBeCloseTo(2 * Math.PI - 5e-4, 12)
  })
})
