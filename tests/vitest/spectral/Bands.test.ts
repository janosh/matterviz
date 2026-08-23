import type { Vec2 } from '$lib/math'
import Bands from '$lib/spectral/Bands.svelte'
import type { BaseBandStructure, FrequencyUnit } from '$lib/spectral/types'
import type { ComponentProps } from 'svelte'
import { mount, tick } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import { bind_props, expect_plot_controls, mount_sized } from '../setup'

const base_band_structure: BaseBandStructure = {
  qpoints: [
    { label: `GAMMA`, frac_coords: [0, 0, 0] },
    { label: null, frac_coords: [0.25, 0, 0] },
    { label: null, frac_coords: [0.5, 0, 0] },
    { label: `X`, frac_coords: [0.75, 0, 0] },
  ],
  branches: [{ start_index: 0, end_index: 3, name: `GAMMA-X` }],
  labels_dict: { GAMMA: [0, 0, 0], X: [0.75, 0, 0] },
  distance: [0, 1, 2, 3],
  nb_bands: 4,
  bands: [
    [0.0, 0.5, 1.0, 1.5],
    [0.8, 1.3, 1.8, 2.3],
    [1.6, 2.1, 2.6, 3.1],
    [2.4, 2.9, 3.4, 3.9],
  ],
}

const path_mismatch_structure: BaseBandStructure = {
  ...base_band_structure,
  qpoints: [
    { label: `GAMMA`, frac_coords: [0, 0, 0] },
    { label: null, frac_coords: [0.3, 0.3, 0] },
    { label: `K`, frac_coords: [0.5, 0.5, 0] },
  ],
  branches: [{ start_index: 0, end_index: 2, name: `GAMMA-K` }],
  labels_dict: { GAMMA: [0, 0, 0], K: [0.5, 0.5, 0] },
  distance: [0, 1, 2],
  nb_bands: 4,
  bands: [
    [0.1, 0.7, 1.2],
    [0.9, 1.5, 2.0],
    [1.7, 2.3, 2.8],
    [2.5, 3.1, 3.6],
  ],
}

const make_unlabeled_band_structure = (
  branch_names = [`segment-1`, `segment-2`],
): BaseBandStructure => ({
  ...base_band_structure,
  qpoints: base_band_structure.qpoints.map((qpoint) => ({ ...qpoint, label: null })),
  branches: branch_names.map((name, branch_idx) => ({
    start_index: branch_idx * 2,
    end_index: branch_idx * 2 + 1,
    name,
    is_discontinuity: false,
  })),
  labels_dict: {},
})

const spin_polarized_electronic = {
  ...base_band_structure,
  bands: [
    [-1.2, -0.6, -0.1, 0.3],
    [-0.6, -0.1, 0.4, 0.9],
    [0.2, 0.8, 1.4, 2.0],
    [1.1, 1.7, 2.3, 2.9],
  ],
  spin_down_bands: [
    [-1.0, -0.4, 0.1, 0.5],
    [-0.4, 0.1, 0.6, 1.1],
    [0.4, 1.0, 1.6, 2.2],
    [1.3, 1.9, 2.5, 3.1],
  ],
  efermi: 0,
} as BaseBandStructure & { efermi: number; spin_down_bands: number[][] }

const mount_bands = async (props: ComponentProps<typeof Bands>): Promise<void> => {
  mount(Bands, { target: document.body, props })
  await tick()
}

const line_count = (): number => document.querySelectorAll(`svg path[fill="none"]`).length

describe(`Bands component`, () => {
  it.each([
    {
      name: `single structure`,
      props: { band_structs: base_band_structure },
      expected_line_count: 4,
    },
    {
      name: `electronic spin overlay`,
      props: {
        band_structs: spin_polarized_electronic,
        band_type: `electronic` as const,
        band_spin_mode: `overlay` as const,
      },
      expected_line_count: 8,
    },
    {
      name: `electronic spin up only`,
      props: {
        band_structs: spin_polarized_electronic,
        band_type: `electronic` as const,
        band_spin_mode: `up_only` as const,
      },
      expected_line_count: 4,
    },
    {
      name: `electronic spin down only`,
      props: {
        band_structs: spin_polarized_electronic,
        band_type: `electronic` as const,
        band_spin_mode: `down_only` as const,
      },
      expected_line_count: 4,
    },
    {
      name: `explicit physical two-point branch`,
      props: {
        band_structs: {
          ...base_band_structure,
          qpoints: [base_band_structure.qpoints[0], base_band_structure.qpoints[3]],
          branches: [
            { start_index: 0, end_index: 1, name: `GAMMA-X`, is_discontinuity: false },
          ],
          distance: [0, 3],
          bands: base_band_structure.bands.map((band) => [band[0], band[3]]),
        },
      },
      expected_line_count: 4,
    },
    {
      name: `multiple unlabeled branches`,
      props: { band_structs: make_unlabeled_band_structure() },
      expected_line_count: 8,
    },
    {
      // unlabeled segments match by occurrence, not producer-specific branch names
      name: `two structures with differently named unlabeled branches (strict)`,
      props: {
        band_structs: {
          unlabeled: make_unlabeled_band_structure([`first-a`, `first-b`]),
          renamed: make_unlabeled_band_structure([`renamed-a`, `renamed-b`]),
        },
        path_mode: `strict` as const,
      },
      expected_line_count: 16,
    },
    {
      // repeated labeled segments are distinct path occurrences
      name: `repeated GAMMA-X segments`,
      props: {
        band_structs: {
          ...base_band_structure,
          qpoints: base_band_structure.qpoints.map((qpoint, idx) => ({
            ...qpoint,
            label: idx % 2 ? `X` : `GAMMA`,
          })),
          branches: [
            { start_index: 0, end_index: 1, name: `GAMMA-X`, is_discontinuity: false },
            { start_index: 2, end_index: 3, name: `GAMMA-X`, is_discontinuity: false },
          ],
        },
      },
      expected_line_count: 8,
    },
  ])(`renders expected line count for $name`, async ({ props, expected_line_count }) => {
    await mount_bands(props)
    expect(line_count()).toBe(expected_line_count)
  })

  it(`renders strict-mode mismatch as EmptyState with message`, async () => {
    await mount_bands({
      band_structs: { canonical: base_band_structure, alt: path_mismatch_structure },
      path_mode: `strict`,
      'data-testid': `strict-mismatch-plot`,
      role: `status`,
      'aria-label': `Bands unavailable`,
    })
    expect(document.querySelector(`[data-testid="strict-mismatch-plot"]`)).toBeInstanceOf(
      HTMLElement,
    )
    expect(
      document.querySelector(`[role="status"][aria-label="Bands unavailable"]`),
    ).toBeInstanceOf(HTMLElement)
    expect(document.body.textContent).toContain(`different q-point paths`)
    expect(line_count()).toBe(0)
  })

  it.each([
    [`a single pymatgen dict`, (pmg: object) => pmg, ``],
    [`a labelled dict of structures`, (pmg: object) => ({ broken: pmg }), `broken: `],
  ])(
    `names the missing reciprocal lattice key for %s instead of the generic empty state`,
    async (_label, wrap, prefix) => {
      // pymatgen-shaped but without lattice_rec: the k-path cannot be measured
      const pmg = {
        '@class': `PhononBandStructureSymmLine`,
        qpoints: [
          [0, 0, 0],
          [0.5, 0, 0],
        ],
        bands: [[0, 1]],
      }
      await mount_bands({
        band_structs: wrap(pmg) as BaseBandStructure,
        'data-testid': `pmg-missing-lattice`,
      })
      expect(line_count()).toBe(0)
      const text = document.body.textContent ?? ``
      expect(text).toContain(
        `${prefix}pymatgen band structure needs a finite 3x3 reciprocal lattice under 'lattice_rec.matrix'`,
      )
      expect(text).not.toContain(`No valid band structure data`)
    },
  )

  // Mismatched paths: union appends the second structure's segment after the canonical path,
  // intersection has nothing in common and falls through to the EmptyState
  it.each([
    [`union`, 8, { GAMMA_X: [0, 3], GAMMA_K: [3, 5] }, `Wave Vector`],
    [`intersection`, 0, {}, `No plottable band segments`],
  ] as const)(
    `path_mode=%s lays out mismatched paths`,
    async (path_mode, expected_lines, expected_positions, expected_text) => {
      const state: { x_positions?: Record<string, Vec2> } = { x_positions: undefined }
      await mount_bands(
        bind_props(
          {
            band_structs: { canonical: base_band_structure, alt: path_mismatch_structure },
            path_mode,
          },
          state,
        ),
      )
      expect(line_count()).toBe(expected_lines)
      expect(state.x_positions).toEqual(expected_positions)
      expect(document.body.textContent).toContain(expected_text)
    },
  )

  // A single structure has legend=null; multiple structures use ScatterPlot's auto rule.
  // oxfmt-ignore
  it.each([
    [`auto hides one`, false, undefined, false],
    [`auto shows two`, true, undefined, true],
    [`true cannot beat legend=null`, false, true, false],
    [`false hides two`, true, false, false],
  ] as const)(`legend visibility: %s`, async (_desc, multi, show_legend, expected) => {
    const shifted = {
      ...base_band_structure,
      bands: base_band_structure.bands.map((band) => band.map((val) => val + 0.5)),
    }
    const plot = await mount_sized(
      Bands,
      {
        band_structs: multi
          ? { first: base_band_structure, second: shifted }
          : base_band_structure,
        show_legend,
        show_controls: false,
      },
      { selector: `.scatter` },
    )
    expect(Boolean(plot.querySelector(`.legend`))).toBe(expected)
  })

  // `cm-1`/`cm⁻¹` are the spellings found in the wild; they must map to cm^-1 at the prop
  // boundary instead of throwing inside convert_frequencies
  it.each([`cm^-1`, `cm-1`, `cm⁻¹`])(
    `renders the phonon y-axis in %s as cm⁻¹`,
    async (units) => {
      await mount_bands({
        band_structs: base_band_structure,
        units: units as FrequencyUnit,
        show_controls: true,
        controls_open: true,
      })
      expect(document.body.textContent).toContain(`Frequency (cm⁻¹)`)
      const select = document.querySelector<HTMLSelectElement>(`#bands-units`)
      expect(select?.value).toBe(`cm^-1`)
    },
  )

  it(`forwards flat control props and controls_open binding`, async () => {
    expect.hasAssertions()
    const controls_state = { controls_open: true }
    await mount_bands(
      bind_props(
        {
          band_structs: base_band_structure,
          controls_toggle_props: { 'data-testid': `bands-toggle` },
          controls_pane_props: { 'data-testid': `bands-pane`, style: `min-width: 20rem` },
        },
        controls_state,
      ),
    )
    // the pane attribute dict reaches PlotControls (it used to travel via ...rest only)
    expect(
      document.querySelector(`[data-testid="bands-pane"]`)?.getAttribute(`style`),
    ).toContain(`min-width: 20rem`)
    // The controls pane lives in CartesianFrame's measured-only branch, which renders once the
    // bind:clientWidth effect has flushed; poll for it rather than trusting a single tick.
    const path_select = await vi.waitFor(() => {
      const select = document.querySelector(`#bands-path-mode`)
      expect(select).not.toBeNull()
      return select
    })
    const path_section = path_select?.closest(`section`)
    const units_section = document.querySelector(`#bands-units`)?.closest(`section`)
    expect(path_section).not.toBeNull()
    expect(units_section).toBe(path_section)
    await expect_plot_controls(document, controls_state, `bands`)
  })

  it(`renders one highlight fill region from props`, async () => {
    await mount_bands({
      band_structs: base_band_structure,
      highlight_regions: [{ y_min: 0.5, y_max: 1.5, label: `Window` }],
    })
    const fill_region_paths = document.querySelectorAll(`g.fill-region path[fill-opacity]`)
    expect(fill_region_paths).toHaveLength(1)
  })

  it(`emphasizes the selection and extends clickable marker hit areas`, async () => {
    const on_point_click = vi.fn()
    await mount_bands({
      band_structs: base_band_structure,
      highlighted_band_index: 2,
      highlighted_qpoint_index: 1,
      on_point_click,
    })
    expect(
      document.querySelectorAll(`svg path[fill="none"][stroke*="--bands-selected-color"]`),
    ).toHaveLength(1)
    expect(
      document.querySelectorAll(`svg path[fill="none"][stroke*="--bands-muted-color"]`),
    ).toHaveLength(3)
    expect(document.querySelectorAll(`.effect-ring.selected`)).toHaveLength(1)

    const hit_target = document.querySelector<SVGCircleElement>(`.marker-hit-target`)
    expect(hit_target).not.toBeNull()
    expect(Number(hit_target?.getAttribute(`r`))).toBeGreaterThan(3)
    hit_target?.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
    expect(on_point_click).toHaveBeenCalledOnce()
  })

  it(`annotates the electronic gap and ignores the units prop for electronic values`, async () => {
    await mount_bands({
      band_structs: spin_polarized_electronic,
      band_type: `electronic`,
      band_spin_mode: `up_only`,
      units: `cm^-1`,
      show_gap_annotation: true,
    })
    expect(document.body.textContent).toContain(`Energy (eV)`)
    expect(document.body.textContent).toContain(`Eg:`)
    expect(document.body.textContent).toContain(`0.3 eV`)
  })
})
