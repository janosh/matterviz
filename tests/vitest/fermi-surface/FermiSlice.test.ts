// @vitest-environment happy-dom
// Tests for FermiSlice.svelte component (ScatterPlot-based implementation)
import FermiSlice from '$lib/fermi-surface/FermiSlice.svelte'
import type { FermiSliceData, FermiSurfaceData } from '$lib/fermi-surface/types'
import { createRawSnippet, mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import {
  BOX_TRI_FACES,
  BOX_VERTICES,
  doc_query,
  make_fermi_isosurface,
  make_fermi_surface,
  mount_sized,
} from '../setup'

// Box-shaped Fermi surface data with one sheet per band
const create_mock_fermi_data = (band_indices: number[] = [0, 1]): FermiSurfaceData =>
  make_fermi_surface(
    band_indices.map((band_index) =>
      make_fermi_isosurface(BOX_VERTICES, BOX_TRI_FACES, { band_index }),
    ),
  )

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
