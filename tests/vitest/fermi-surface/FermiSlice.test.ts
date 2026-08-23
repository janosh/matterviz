// @vitest-environment happy-dom
// Tests for FermiSlice.svelte component (ScatterPlot-based implementation)
import FermiSlice from '$lib/fermi-surface/FermiSlice.svelte'
import type { FermiSliceData, FermiSurfaceData } from '$lib/fermi-surface/types'
import type { Matrix3x3, Vec3 } from '$lib/math'
import { createRawSnippet, mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query, mount_sized } from '../setup'

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
      positions: Float32Array.from(vertices.flat()),
      indices: Uint32Array.from(faces.flat()),
      normals: Float32Array.from(vertices.flatMap(() => [0, 0, 1])),
      band_index,
      spin: null,
    })),
    k_lattice: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ] as Matrix3x3,
    fermi_energy: 0,
    reciprocal_cell: `wigner_seitz`,
    metadata: { n_bands: band_indices.length, n_surfaces: band_indices.length },
  }
}

describe(`FermiSlice`, () => {
  test.each([
    [`omitted defaults to visible for one band`, [0], undefined, true],
    [`false hides three bands`, [0, 1, 2], false, false],
  ] as const)(`legend visibility: %s`, async (_desc, bands, show_legend, expected) => {
    const plot = await mount_sized(
      FermiSlice,
      { fermi_data: create_mock_fermi_data([...bands]), show_legend, distance: 0.05 },
      { selector: `.fermi-slice` },
    )
    await tick()
    expect(Boolean(plot.querySelector(`.legend`))).toBe(expected)
  })

  test(`on_error callback when compute_fermi_slice throws`, async () => {
    const mock_error = vi.fn()
    const fermi_data = create_mock_fermi_data([0])
    fermi_data.k_lattice = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ] // degenerate
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
    type SnippetData = { slice_data: FermiSliceData | null; export_svg: () => string | null }
    let received: SnippetData | undefined
    const children_snippet = createRawSnippet<[SnippetData]>((data) => {
      received = data()
      return { render: () => `<div class="children-rendered"></div>` }
    })

    mount(FermiSlice, {
      target: document.body,
      // Cast needed: HTMLAttributes<HTMLDivElement> includes children?: Snippet<[]>
      // which conflicts with the component's typed children prop
      props: { children: children_snippet } as Record<string, unknown>,
    })
    await tick()

    expect(document.querySelector(`.children-rendered`)).not.toBeNull()
    expect(received?.slice_data).toBeNull() // null when no fermi_data
    // the empty axes still export as a standalone SVG document
    expect(received?.export_svg()).toMatch(/^<svg[^>]*role="application"/)
  })
})
