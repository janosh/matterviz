// @vitest-environment happy-dom
// Tests for FermiSlice.svelte component
import FermiSlice from '$lib/fermi-surface/FermiSlice.svelte'
import type { FermiSurfaceData } from '$lib/fermi-surface/types'
import type { Matrix3x3, Vec3 } from '$lib/math'
import { mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

// Create mock Fermi surface data with configurable bands
function create_mock_fermi_data(band_indices: number[] = [0, 1]): FermiSurfaceData {
  const identity_lattice: Matrix3x3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  const vertices: Vec3[] = [
    [-0.5, -0.5, 0],
    [0.5, -0.5, 0],
    [0.5, 0.5, 0],
    [-0.5, 0.5, 0],
    [-0.5, -0.5, 0.1],
    [0.5, -0.5, 0.1],
    [0.5, 0.5, 0.1],
    [-0.5, 0.5, 0.1],
  ]
  const faces: number[][] = [
    [0, 1, 2],
    [0, 2, 3],
    [4, 6, 5],
    [4, 7, 6],
    [0, 4, 5],
    [0, 5, 1],
    [2, 6, 7],
    [2, 7, 3],
    [0, 3, 7],
    [0, 7, 4],
    [1, 5, 6],
    [1, 6, 2],
  ]
  return {
    isosurfaces: band_indices.map((band_index) => ({
      vertices,
      faces,
      normals: vertices.map(() => [0, 0, 1] as Vec3),
      band_index,
      spin: null,
    })),
    k_lattice: identity_lattice,
    fermi_energy: 0,
    reciprocal_cell: `wigner_seitz`,
    metadata: {
      n_bands: band_indices.length,
      n_surfaces: band_indices.length,
      total_area: 1,
    },
  }
}

describe(`FermiSlice`, () => {
  describe(`basic rendering`, () => {
    test(`renders container and SVG with correct class`, () => {
      mount(FermiSlice, { target: document.body, props: {} })
      expect(doc_query(`.fermi-slice-container`)).toBeTruthy()
      expect(doc_query(`.fermi-slice`)).toBeTruthy()
    })

    test.each([
      { label: `no fermi_data`, props: {}, expected: `No Fermi data` },
      {
        label: `no intersecting isolines`,
        props: { fermi_data: create_mock_fermi_data([0]), distance: 10 },
        expected: /No (isolines|slice data)/,
      },
    ])(`shows empty message when $label`, async ({ props, expected }) => {
      mount(FermiSlice, { target: document.body, props })
      await tick()
      const empty_text = doc_query(`.empty`)
      if (expected instanceof RegExp) {
        expect(empty_text?.textContent?.trim()).toMatch(expected)
      } else {
        expect(empty_text?.textContent?.trim()).toBe(expected)
      }
    })

    test(`renders paths with custom line_width`, async () => {
      const fermi_data = create_mock_fermi_data([0])
      mount(FermiSlice, {
        target: document.body,
        props: { fermi_data, miller_indices: [0, 0, 1], distance: 0.05, line_width: 5 },
      })
      await tick()
      const paths = document.querySelectorAll(`path`)
      expect(paths.length).toBeGreaterThan(0)
      expect(paths[0]?.getAttribute(`stroke-width`)).toBe(`5`)
    })
  })

  describe(`axes and labels`, () => {
    test.each([
      { show_axes: true, axis_count: 2, label_count: 2 },
      { show_axes: false, axis_count: 0, label_count: 0 },
    ])(
      `show_axes=$show_axes renders $axis_count axes`,
      ({ show_axes, axis_count, label_count }) => {
        mount(FermiSlice, { target: document.body, props: { show_axes } })
        expect(document.querySelectorAll(`.axis`).length).toBe(axis_count)
        expect(document.querySelectorAll(`.label`).length).toBe(label_count)
      },
    )

    test.each([
      { miller: [1, 0, 0] as Vec3, expected: [`kᵧ`, `kz`] },
      { miller: [0, 1, 0] as Vec3, expected: [`kₓ`, `kz`] },
      { miller: [0, 0, 1] as Vec3, expected: [`kₓ`, `kᵧ`] },
      { miller: [1, 1, 0] as Vec3, expected: [`k⊥`, `kz`] },
      { miller: [1, 0, 1] as Vec3, expected: [`k⊥`, `kᵧ`] },
      { miller: [0, 1, 1] as Vec3, expected: [`k⊥`, `kₓ`] },
      { miller: [1, 1, 1] as Vec3, expected: [`k₁`, `k₂`] },
      {
        miller: null,
        labels: [`Custom X`, `Custom Y`] as [string, string],
        expected: [`Custom X`, `Custom Y`],
      },
    ])(`axis labels for miller=$miller`, ({ miller, labels, expected }) => {
      mount(FermiSlice, {
        target: document.body,
        props: {
          miller_indices: miller ?? undefined,
          axis_labels: labels,
          show_axes: true,
        },
      })
      const rendered = Array.from(document.querySelectorAll(`.label`)).map((el) =>
        el.textContent?.trim()
      )
      expect(rendered).toEqual(expected)
    })
  })

  describe(`legend and band visibility`, () => {
    test.each([
      { show_legend: true, expected_items: 2 },
      { show_legend: false, expected_items: 0 },
    ])(`show_legend=$show_legend`, async ({ show_legend, expected_items }) => {
      const fermi_data = create_mock_fermi_data([0, 1])
      mount(FermiSlice, {
        target: document.body,
        props: { fermi_data, distance: 0.05, show_legend },
      })
      await tick()
      const items = document.querySelectorAll(`.legend-item`)
      expect(items.length).toBe(expected_items)
      if (show_legend) expect(doc_query(`.legend`)).toBeTruthy()
      else expect(document.querySelector(`.legend`)).toBeNull()
    })

    test(`legend items show 1-indexed band numbers`, async () => {
      const fermi_data = create_mock_fermi_data([0, 2, 5])
      mount(FermiSlice, { target: document.body, props: { fermi_data, distance: 0.05 } })
      await tick()
      const labels = Array.from(document.querySelectorAll(`.legend-label`)).map((el) =>
        el.textContent?.trim()
      )
      expect(labels).toEqual([`Band 1`, `Band 3`, `Band 6`])
    })

    test(`clicking legend item toggles band visibility (hide and show)`, async () => {
      const fermi_data = create_mock_fermi_data([0, 1])
      mount(FermiSlice, { target: document.body, props: { fermi_data, distance: 0.05 } })
      await tick()

      const initial_paths = document.querySelectorAll(`path`).length
      expect(initial_paths).toBeGreaterThan(0)

      const legend_items = document.querySelectorAll<HTMLElement>(`.legend-item`)
      legend_items[0].click()
      await tick()
      expect(document.querySelectorAll(`path`).length).toBeLessThan(initial_paths)
      expect(legend_items[0].classList.contains(`hidden`)).toBe(true)

      legend_items[0].click()
      await tick()
      expect(document.querySelectorAll(`path`).length).toBe(initial_paths)
      expect(legend_items[0].classList.contains(`hidden`)).toBe(false)
    })

    test(`double-clicking legend item isolates that band`, async () => {
      const fermi_data = create_mock_fermi_data([0, 1, 2])
      mount(FermiSlice, { target: document.body, props: { fermi_data, distance: 0.05 } })
      await tick()

      const legend_items = document.querySelectorAll<HTMLElement>(`.legend-item`)
      expect(legend_items.length).toBe(3)

      legend_items[1].dispatchEvent(new MouseEvent(`dblclick`, { bubbles: true }))
      await tick()
      expect([...legend_items].map((el) => el.classList.contains(`hidden`))).toEqual([
        true,
        false,
        true,
      ])

      legend_items[1].dispatchEvent(new MouseEvent(`dblclick`, { bubbles: true }))
      await tick()
      expect([...legend_items].every((el) => !el.classList.contains(`hidden`))).toBe(true)
    })
  })

  describe(`tooltips`, () => {
    test.each([
      { show_tooltips: true, expect_tooltip: true },
      { show_tooltips: false, expect_tooltip: false },
    ])(`show_tooltips=$show_tooltips`, async ({ show_tooltips, expect_tooltip }) => {
      const fermi_data = create_mock_fermi_data([0])
      mount(FermiSlice, {
        target: document.body,
        props: { fermi_data, distance: 0.05, show_tooltips },
      })
      await tick()
      const titles = document.querySelectorAll(`title`)
      if (expect_tooltip) {
        expect(titles.length).toBeGreaterThan(0)
        expect(titles[0].textContent).toContain(`Band 1`)
      } else {
        expect(titles.length).toBe(0)
      }
    })
  })

  describe(`SVG attributes`, () => {
    test.each([
      { preserve_aspect_ratio: false, expected: `none` },
      { preserve_aspect_ratio: true, expected: `xMidYMid meet` },
    ])(
      `preserveAspectRatio=$preserve_aspect_ratio → "$expected"`,
      ({ preserve_aspect_ratio, expected }) => {
        mount(FermiSlice, { target: document.body, props: { preserve_aspect_ratio } })
        expect(doc_query(`.fermi-slice`)?.getAttribute(`preserveAspectRatio`)).toBe(
          expected,
        )
      },
    )

    test.each([
      { has_data: true, contains: [`Fermi slice`, `isolines`, `bands`] },
      { has_data: false, exact: `Empty Fermi slice` },
    ])(`aria-label when has_data=$has_data`, async ({ has_data, contains, exact }) => {
      const props = has_data
        ? { fermi_data: create_mock_fermi_data([0, 1]), distance: 0.05 }
        : {}
      mount(FermiSlice, { target: document.body, props })
      await tick()
      const label = doc_query(`.fermi-slice`)?.getAttribute(`aria-label`)
      if (exact) expect(label).toBe(exact)
      else contains?.forEach((text) => expect(label).toContain(text))
    })
  })

  describe(`legend positioning`, () => {
    test.each(
      [
        { position: `top-left`, checks: [`left:`, `top:`] },
        { position: `top-right`, checks: [`right:`, `top:`] },
        { position: `bottom-left`, checks: [`left:`, `bottom:`] },
        { position: `bottom-right`, checks: [`right:`, `bottom:`] },
      ] as const,
    )(`positions legend at $position`, async ({ position, checks }) => {
      const fermi_data = create_mock_fermi_data([0])
      mount(FermiSlice, {
        target: document.body,
        props: { fermi_data, distance: 0.05, legend_position: position },
      })
      await tick()
      const style = doc_query(`.legend`)?.getAttribute(`style`) ?? ``
      checks.forEach((check) => expect(style).toContain(check))
    })
  })

  describe(`error handling and custom colors`, () => {
    test(`calls on_error when compute_fermi_slice throws`, async () => {
      const mock_error = vi.fn()
      const fermi_data = create_mock_fermi_data([0])
      fermi_data.k_lattice = [[0, 0, 0], [0, 0, 0], [0, 0, 0]] // Degenerate to trigger error
      mount(FermiSlice, {
        target: document.body,
        props: { fermi_data, miller_indices: [1, 0, 0], on_error: mock_error },
      })
      await tick()
      expect(mock_error).toHaveBeenCalled()
      expect(mock_error.mock.calls[0][0]).toBeInstanceOf(Error)
    })

    test(`applies custom band_colors`, async () => {
      const fermi_data = create_mock_fermi_data([0])
      mount(FermiSlice, {
        target: document.body,
        props: { fermi_data, distance: 0.05, band_colors: [`#ff0000`, `#00ff00`] },
      })
      await tick()
      expect(doc_query(`path`)?.getAttribute(`stroke`)).toBe(`#ff0000`)
    })
  })
})
