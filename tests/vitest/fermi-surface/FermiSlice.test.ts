// @vitest-environment happy-dom
// Tests for FermiSlice.svelte component (ScatterPlot-based implementation)
import FermiSlice from '$lib/fermi-surface/FermiSlice.svelte'
import type { FermiSliceData, FermiSurfaceData } from '$lib/fermi-surface/types'
import type { Matrix3x3, Vec3 } from '$lib/math'
import { createRawSnippet, mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

// Create mock Fermi surface data with configurable bands
function create_mock_fermi_data(band_indices: number[] = [0, 1]): FermiSurfaceData {
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
  const faces = [
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
    k_lattice: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Matrix3x3,
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
  // Consolidated mounting tests for all prop combinations
  test.each([
    { desc: `empty props`, props: {} },
    { desc: `single band`, props: { fermi_data: create_mock_fermi_data([0]) } },
    { desc: `multiple bands`, props: { fermi_data: create_mock_fermi_data([0, 1, 2]) } },
    {
      desc: `miller x-normal`,
      props: {
        fermi_data: create_mock_fermi_data([0]),
        miller_indices: [1, 0, 0] as Vec3,
      },
    },
    {
      desc: `miller y-normal`,
      props: {
        fermi_data: create_mock_fermi_data([0]),
        miller_indices: [0, 1, 0] as Vec3,
      },
    },
    {
      desc: `miller z-normal`,
      props: {
        fermi_data: create_mock_fermi_data([0]),
        miller_indices: [0, 0, 1] as Vec3,
      },
    },
    {
      desc: `miller diagonal`,
      props: {
        fermi_data: create_mock_fermi_data([0]),
        miller_indices: [1, 1, 1] as Vec3,
      },
    },
    {
      desc: `positive distance`,
      props: { fermi_data: create_mock_fermi_data([0]), distance: 0.05 },
    },
    {
      desc: `negative distance`,
      props: { fermi_data: create_mock_fermi_data([0]), distance: -0.05 },
    },
    {
      desc: `large distance`,
      props: { fermi_data: create_mock_fermi_data([0]), distance: 100 },
    },
    { desc: `show_axes=false`, props: { show_axes: false } },
    { desc: `show_legend=false`, props: { show_legend: false } },
    { desc: `custom line_width`, props: { line_width: 5 } },
    { desc: `custom band_colors`, props: { band_colors: [`#ff0000`, `#00ff00`] } },
    {
      desc: `custom axis_labels`,
      props: { axis_labels: [`X`, `Y`] as [string, string] },
    },
  ])(`mounts without error: $desc`, ({ props }) => {
    expect(() => mount(FermiSlice, { target: document.body, props })).not.toThrow()
    expect(doc_query(`.fermi-slice`)).toBeTruthy()
  })

  test(`on_error callback when compute_fermi_slice throws`, async () => {
    const mock_error = vi.fn()
    const fermi_data = create_mock_fermi_data([0])
    fermi_data.k_lattice = [[0, 0, 0], [0, 0, 0], [0, 0, 0]] // degenerate
    mount(FermiSlice, {
      target: document.body,
      props: { fermi_data, miller_indices: [1, 0, 0], on_error: mock_error },
    })
    await tick()
    expect(mock_error).toHaveBeenCalled()
    expect(mock_error.mock.calls[0][0]).toBeInstanceOf(Error)
  })

  test(`passes class and style to wrapper`, () => {
    mount(FermiSlice, {
      target: document.body,
      props: { class: `custom-class`, style: `background: red;` },
    })
    const wrapper = doc_query(`.fermi-slice`)
    expect(wrapper.classList.contains(`custom-class`)).toBe(true)
    expect(wrapper.getAttribute(`style`)).toContain(`background: red`)
  })

  test(`children snippet receives export_svg and slice_data`, async () => {
    let snippet_called = false
    let export_svg_fn: (() => string | null) | undefined
    let received_slice_data: FermiSliceData | null = `not-set` as unknown as
      | FermiSliceData
      | null

    const children_snippet = createRawSnippet<
      [{ slice_data: FermiSliceData | null; export_svg: () => string | null }]
    >((data) => {
      snippet_called = true
      export_svg_fn = data().export_svg
      received_slice_data = data().slice_data
      return { render: () => `<div class="children-rendered"></div>` }
    })

    mount(FermiSlice, {
      target: document.body,
      // Cast needed: HTMLAttributes<HTMLDivElement> includes children?: Snippet<[]>
      // which conflicts with the component's typed children prop
      props: { children: children_snippet } as Record<string, unknown>,
    })
    await tick()

    expect(snippet_called).toBe(true)
    expect(typeof export_svg_fn).toBe(`function`)
    expect(document.querySelector(`.children-rendered`)).toBeTruthy()
    expect(received_slice_data).toBeNull() // null when no fermi_data

    // export_svg should be consistent with DOM state: returns SVG outerHTML if present, null otherwise
    // Note: In happy-dom, ScatterPlot's SVG may not render due to ResizeObserver limitations
    if (export_svg_fn) {
      const result = export_svg_fn()
      const svg_in_dom = document.querySelector(`.fermi-slice`)?.querySelector(`svg`)
      if (svg_in_dom) {
        expect(result).toBe(svg_in_dom.outerHTML)
        expect(result).toContain(`<svg`)
      } else {
        expect(result).toBeNull()
      }
    }
  })
})
