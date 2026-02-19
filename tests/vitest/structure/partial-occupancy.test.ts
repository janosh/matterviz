import type { Site } from '$lib/structure'
import type { Vec3 } from '$lib/math'
import {
  compute_slice_geometry,
  merge_split_partial_sites,
  PARTIAL_OCCUPANCY_CAP_ARC,
} from '$lib/structure/partial-occupancy'
import { describe, expect, test } from 'vitest'

const make_site = (
  species: Site[`species`],
  xyz: Vec3,
  label: string,
): Site => ({
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
      name:
        `does not merge nearby split partial sites that differ by tiny coordinate offset`,
      sites: [
        make_site([{ element: `O`, occu: 0.5, oxidation_state: 0 }], [0, 0, 0], `O`),
        make_site(
          [{ element: `F`, occu: 0.5, oxidation_state: 0 }],
          [0, 0, 0.000004],
          `F`,
        ),
      ],
      expected_count: 2,
      expected_merged_elements: null,
    },
  ])(`$name`, ({ sites, expected_count, expected_merged_elements }) => {
    const render_sites = merge_split_partial_sites(sites)
    expect(render_sites).toHaveLength(expected_count)
    if (!expected_merged_elements) return
    const merged_site = render_sites.find((site_data) =>
      site_data.site.species.length === 2 &&
      site_data.site.species.some((species) => species.element === `O`) &&
      site_data.site.species.some((species) => species.element === `F`)
    )
    expect(merged_site).toBeDefined()
    if (!merged_site) throw new Error(`Expected merged O/F site to exist`)
    expect(merged_site.site.species.map((species) => species.element).sort()).toEqual(
      expected_merged_elements,
    )
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
      expect(slices[slice_idx].end_phi).toBeGreaterThanOrEqual(
        slices[slice_idx - 1].end_phi,
      )
    }
  })

  test(`normalizes overfull occupancies to avoid wedge overflow`, () => {
    const slices = compute_slice_geometry([
      { element: `O`, occu: 0.8, oxidation_state: 0 },
      { element: `F`, occu: 0.8, oxidation_state: 0 },
    ])
    expect(slices[0].render_start_cap).toBe(false)
    expect(slices[1].render_end_cap).toBe(false)
    expect(slices[1].end_phi).toBeLessThanOrEqual(2 * Math.PI + 1e-6)
  })

  test(`cap arc configuration intentionally uses same start angle for both caps`, () => {
    expect(PARTIAL_OCCUPANCY_CAP_ARC.start_cap_arc_start).toBe(
      PARTIAL_OCCUPANCY_CAP_ARC.end_cap_arc_start,
    )
  })
})
