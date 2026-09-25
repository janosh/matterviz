// @vitest-environment happy-dom
// Tests for FermiSlice.svelte component (ScatterPlot-based implementation)
import FermiSlice from '$lib/fermi-surface/FermiSlice.svelte'
import type { FermiSliceData, FermiSurfaceData } from '$lib/fermi-surface/types'
import { createRawSnippet, mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query, mount_sized } from '../setup'
import {
  BOX_TRI_FACES,
  BOX_VERTICES,
  make_fermi_isosurface,
  make_fermi_surface,
} from '../test-fixtures'

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
    // the compute error is forwarded once, as an Error naming the actual problem
    expect(mock_error).toHaveBeenCalledExactlyOnceWith(expect.any(Error))
    expect(mock_error.mock.calls[0][0].message).toMatch(/Degenerate plane normal/)
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

  // Labels come from the (u, v) directions points_2d use, not the Miller zeros: a (010)
  // slice's vertical axis runs along −kz, and (100) with an oblique b₁ is an oblique plane
  test.each([
    [`(001)`, [0, 0, 1], undefined, [`kₓ`, `kᵧ`]],
    [`(010)`, [0, 1, 0], undefined, [`kₓ`, `−kz`]],
    [
      `(100) with oblique b₁`,
      [1, 0, 0],
      [
        [Math.sqrt(3) / 2, -0.5, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      [`k₁ ∥ [0.5, 0.87, 0]`, `kz`],
    ],
  ] as const)(
    `labels the %s slice axes by their directions`,
    async (_desc, miller, k_lattice, expected) => {
      const fermi_data = create_mock_fermi_data([0])
      if (k_lattice)
        fermi_data.k_lattice = k_lattice.map((row) => [
          ...row,
        ]) as FermiSurfaceData[`k_lattice`]
      const plot = await mount_sized(
        FermiSlice,
        { fermi_data, miller_indices: [...miller], distance: 0.05 },
        { selector: `.fermi-slice` },
      )
      await tick()
      const text = plot.textContent ?? ``
      for (const label of expected) expect(text).toContain(label)
    },
  )
})
