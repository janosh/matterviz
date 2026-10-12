import FermiSlice from '#lib/fermi-surface/FermiSlice.svelte'
import type { FermiSliceData, FermiSurfaceData } from '#lib/fermi-surface/types.js'
import type { Matrix3x3, Vec3 } from '#lib/math.js'
import { createRawSnippet, mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { bind_props, doc_query, mount_sized } from '../setup'
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
    // one band sliced into two isolines: their shared legend_id folds them into one row
    [`omitted defaults to visible for one band`, [0, 0], undefined, [`Band 1`]],
    [`false hides three bands`, [0, 1, 2], false, []],
  ] as const)(`legend visibility: %s`, async (_desc, bands, show_legend, expected) => {
    const plot = await mount_sized(
      FermiSlice,
      { fermi_data: create_mock_fermi_data([...bands]), show_legend, distance: 0.05 },
      { selector: `.fermi-slice` },
    )
    await tick()
    // each box slices into one drawn isoline, so [0, 0] really draws band 1 twice
    expect(plot.querySelectorAll(`g[data-series-id^="iso-"]`)).toHaveLength(bands.length)
    const items = [...plot.querySelectorAll(`.legend-item`)]
    expect(items.map((item) => item.textContent?.trim())).toEqual(expected)
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

  test(`passes class/style to the wrapper and export_svg/slice_data to children`, async () => {
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
      props: {
        children: children_snippet,
        class: `custom-class`,
        style: `background: red;`,
      } as Record<string, unknown>,
    })
    await tick()
    const wrapper = doc_query(`.fermi-slice`)
    expect(wrapper.classList.contains(`custom-class`)).toBe(true)
    expect(wrapper.getAttribute(`style`)).toContain(`background: red`)

    expect(document.querySelector(`.children-rendered`)).not.toBeNull()
    expect(received?.slice_data).toBeNull() // null when no fermi_data
    // the empty axes still export as a standalone SVG document
    expect(received?.export_svg()).toMatch(/^<svg[^>]*role="application"/)
  })

  // Labels follow the in-plane directions: a (010) slice's vertical axis runs along −kz
  const oblique: Matrix3x3 = [
    [Math.sqrt(3) / 2, -0.5, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
  test.each<[Vec3, Matrix3x3 | undefined, string[]]>([
    [[0, 0, 1], undefined, [`kₓ`, `kᵧ`]],
    [[0, 1, 0], undefined, [`kₓ`, `−kz`]],
    [[1, 0, 0], oblique, [`k₁ ∥ [0.5, 0.87, 0]`, `kz`]],
  ])(`labels the %j slice axes by direction`, async (miller_indices, k_lattice, labels) => {
    const fermi_data = { ...create_mock_fermi_data([0]), ...(k_lattice && { k_lattice }) }
    const props = { fermi_data, miller_indices, distance: 0.05 }
    const plot = await mount_sized(FermiSlice, props, { selector: `.fermi-slice` })
    await tick()
    for (const label of labels) expect(plot.textContent).toContain(label)
  })
})

describe(`FermiSlice linked views`, () => {
  // `bound` props are two-way bound (see bind_props)
  const mount_slice = async (props: Record<string, unknown>, bound = {}) => {
    const plot = await mount_sized(
      FermiSlice,
      bind_props({ fermi_data: create_mock_fermi_data([0]), distance: 0.05, ...props }, bound),
      { selector: `.fermi-slice` },
    )
    await tick()
    return plot
  }

  // A k-point from the 3D viewer projects onto the (001) plane at z = 0.05: filled on the plane,
  // a dashed ring with its offset in the title when off it
  test.each([
    { marker: [0.2, -0.1, 0.05] as Vec3, on_plane: true, title: /On the slice plane/ },
    { marker: [0.2, -0.1, 0.45] as Vec3, on_plane: false, title: /0\.4 Å⁻¹ off/ },
  ])(`marks $marker (on plane: $on_plane)`, async ({ marker, on_plane, title }) => {
    const circle = (await mount_slice({ marker })).querySelector(`circle.fermi-marker`)
    expect(circle?.classList.contains(`on_plane`)).toBe(on_plane)
    expect(circle?.textContent).toMatch(title)
  })

  // selected_bands hides the other bands' contours (the 3D viewer's band toggles); the cursor
  // maps back to the Cartesian k on the plane (normal·k = distance)
  test(`filters contours by selected_bands and binds hovered_k on the plane`, async () => {
    const props: { hovered_k: Vec3 | null } = { hovered_k: null }
    const fermi_data = create_mock_fermi_data([0, 1, 2])
    const plot = await mount_slice({ fermi_data, selected_bands: [1] }, props)
    const drawn = [...plot.querySelectorAll(`g[data-series-id^="iso-"]`)]
    expect(drawn.map((group) => group.getAttribute(`data-series-id`))).toEqual([`iso-1-0`])
    const rect = plot.querySelector(`rect[role="presentation"]`)
    rect?.dispatchEvent(
      new PointerEvent(`pointermove`, { clientX: 120, clientY: 90, bubbles: true }),
    )
    expect(props.hovered_k?.[2]).toBeCloseTo(0.05, 12)
    rect?.dispatchEvent(new PointerEvent(`pointerleave`))
    expect(props.hovered_k).toBeNull()
  })
})
