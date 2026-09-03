import { get_d3_interpolator } from '$lib/colors'
import VolumeSlice from '$lib/isosurface/VolumeSlice.svelte'
import type { SliceResult } from '$lib/isosurface/slice'
import type { VolumeSliceMode } from '$lib/isosurface/slice-rendering'
import { mount, tick, type ComponentProps } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

const make_slice = (): SliceResult => {
  const width = 4
  const height = 4
  return {
    data: Float64Array.from({ length: width * height }, (_, data_idx) => data_idx),
    mask: new Uint8Array(width * height).fill(1),
    width,
    height,
    min: 0,
    max: width * height - 1,
    point: [0, 0, 0],
    normal: [0, 0, 1],
    u_axis: [1, 0, 0],
    v_axis: [0, 1, 0],
    u_range: [-2, 2],
    v_range: [-1, 1],
    polygon: [
      [-2, -1],
      [2, -1],
      [2, 1],
      [-2, 1],
    ],
  }
}

const style_with_color = (color: string): CSSStyleDeclaration => {
  const style = document.createElement(`div`).style
  style.color = color
  return style
}

const mock_context = () => ({
  beginPath: vi.fn(),
  clearRect: vi.fn(),
  clip: vi.fn(),
  closePath: vi.fn(),
  createImageData: vi.fn(
    (width: number, height: number) =>
      ({ data: new Uint8ClampedArray(width * height * 4) }) as ImageData,
  ),
  lineTo: vi.fn(),
  moveTo: vi.fn(),
  putImageData: vi.fn(),
  restore: vi.fn(),
  save: vi.fn(),
  stroke: vi.fn(),
  lineJoin: `round`,
  lineWidth: 1,
  strokeStyle: ``,
})

async function mount_volume_slice(props: Partial<ComponentProps<typeof VolumeSlice>> = {}) {
  const context = mock_context()
  vi.spyOn(HTMLCanvasElement.prototype, `getContext`).mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  )
  mount(VolumeSlice, {
    target: document.body,
    props: { slice: make_slice(), show_colorbar: false, ...props },
  })
  await tick()
  return { canvas: document.querySelector(`canvas`), context }
}

afterEach(() => {
  vi.restoreAllMocks()
  delete document.documentElement.dataset.theme
})

describe(`VolumeSlice`, () => {
  const mode_cases = [
    { mode: `both`, fills: true, contours: true },
    { mode: `filled`, fills: true, contours: false },
    { mode: `contours`, fills: false, contours: true },
  ] satisfies { mode: VolumeSliceMode; fills: boolean; contours: boolean }[]

  test.each(mode_cases)(`renders $mode mode`, async ({ mode, fills, contours }) => {
    const { canvas, context } = await mount_volume_slice({ mode, contour_levels: [4, 8, 12] })

    expect(canvas?.width).toBe(4)
    expect(canvas?.height).toBe(4)
    expect(context.putImageData).toHaveBeenCalledTimes(fills ? 1 : 0)
    // one stroke per threshold level
    expect(context.stroke).toHaveBeenCalledTimes(contours ? 3 : 0)
  })

  test(`renders an accessible canvas with physical aspect ratio`, async () => {
    const { canvas } = await mount_volume_slice()
    expect(canvas?.getAttribute(`aria-label`)).toBe(`Volumetric scalar-field slice`)
    expect(canvas?.getAttribute(`style`)).toContain(`aspect-ratio: 2`)
  })

  test(`centers a bounded horizontal colorbar`, async () => {
    await mount_volume_slice({
      show_colorbar: true,
      colorbar_orientation: `horizontal`,
    })
    const colorbar = doc_query(`.slice-colorbar.horizontal`, HTMLElement)
    const colorbar_style = getComputedStyle(colorbar)

    expect(colorbar_style.left).toBe(`50%`)
    expect([``, `auto`]).toContain(colorbar_style.right)
    // happy-dom may resolve the var() chain or hand back the raw reference; accept either
    expect(colorbar_style.getPropertyValue(`--cbar-width`)).toMatch(
      /--volume-slice-colorbar-size|min\(70%,\s*360px\)/,
    )
    expect(colorbar_style.transform).toBe(`translateX(-50%)`)
  })

  test(`co-registers flipped contours with filled pixel rows`, async () => {
    const slice = make_slice()
    Object.assign(slice, {
      data: new Float64Array([0, 0, 1, 1]),
      mask: new Uint8Array(4).fill(1),
      width: 2,
      height: 2,
      min: 0,
      max: 1,
      u_range: [0, 1],
      v_range: [0, 1],
      polygon: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
    })
    const { context } = await mount_volume_slice({
      slice,
      mode: `both`,
      contour_levels: [0.5],
    })

    // d3-contour locates this horizontal boundary at sampled y=1. Reflecting
    // that pixel-center coordinate through a 2-row canvas keeps it at y=1.
    expect(context.lineTo).toHaveBeenCalledWith(1.5, 1)
  })

  test(`does not contour masked cells below explicit thresholds`, async () => {
    const slice = make_slice()
    slice.data.fill(-20)
    slice.mask[0] = 0
    slice.min = -20
    slice.max = -20
    const { context } = await mount_volume_slice({
      slice,
      mode: `contours`,
      color_range: [0, 1],
      contour_levels: [-10],
    })

    expect(context.moveTo).toHaveBeenCalledTimes(1)
    expect(context.lineTo).toHaveBeenCalledTimes(3)
  })

  test(`clips contours to the polygon in flipped (v up) canvas rows`, async () => {
    const { context } = await mount_volume_slice({ mode: `contours`, contour_levels: [4] })
    // the first clip-path corner is polygon corner (-2, -1) → pixel (0.5, 0.5), flipped to 3.5
    expect(context.moveTo).toHaveBeenNthCalledWith(1, 0.5, 3.5)
    expect(context.clip).toHaveBeenCalledOnce()
  })

  // Canvas takes a colour value, so `currentColor` has to be sampled in JS and the slice
  // repainted on a theme flip -- the cascade cannot restyle pixels already drawn.
  test.each([
    [`light`, `white`, `rgb(0, 0, 0)`, `rgb(20, 20, 20)`],
    [`dark`, `black`, `rgb(255, 255, 255)`, `rgb(230, 230, 230)`],
  ] as const)(
    `resamples currentColor contours after a %s to %s theme switch`,
    async (initial_theme, next_theme, initial_color, next_color) => {
      const theme_colors = {
        light: `rgb(0, 0, 0)`,
        white: `rgb(20, 20, 20)`,
        dark: `rgb(255, 255, 255)`,
        black: `rgb(230, 230, 230)`,
      }
      vi.spyOn(globalThis, `getComputedStyle`).mockImplementation(() => {
        const color =
          theme_colors[document.documentElement.dataset.theme as keyof typeof theme_colors]
        return style_with_color(color)
      })
      document.documentElement.dataset.theme = initial_theme
      const { context } = await mount_volume_slice({
        mode: `contours`,
        contour_levels: [4],
      })
      expect(context.strokeStyle).toBe(initial_color)

      document.documentElement.dataset.theme = next_theme
      await tick() // watch_dark_mode reports via MutationObserver, so not synchronously
      expect(context.strokeStyle).toBe(next_color)
    },
  )

  test(`resamples currentColor contours after an inherited style change`, async () => {
    vi.spyOn(globalThis, `getComputedStyle`).mockImplementation((element) => {
      const color =
        element
          .closest(`.volume-slice`)
          ?.getAttribute(`style`)
          ?.match(/--volume-slice-contour-color:\s*(?<color>[^;]+)/)?.groups?.color ??
        `rgb(0, 0, 0)`
      return style_with_color(color)
    })
    const { canvas, context } = await mount_volume_slice({
      mode: `contours`,
      contour_levels: [4],
    })
    expect(context.strokeStyle).toBe(`rgb(0, 0, 0)`)
    const wrapper = canvas?.closest<HTMLElement>(`.volume-slice`)
    if (!wrapper) throw new Error(`volume slice wrapper not rendered`)

    wrapper.style.setProperty(`--volume-slice-contour-color`, `rgb(12, 34, 56)`)
    await tick()

    expect(context.strokeStyle).toBe(`rgb(12, 34, 56)`)
  })

  test(`clears stale pixels when the slice is removed`, async () => {
    const context = mock_context()
    vi.spyOn(HTMLCanvasElement.prototype, `getContext`).mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    )
    const props = $state<{ show_colorbar: boolean; slice: SliceResult | null }>({
      show_colorbar: false,
      slice: make_slice(),
    })
    mount(VolumeSlice, { target: document.body, props })
    await tick()
    context.clearRect.mockClear()

    props.slice = null
    await tick()

    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 4, 4)
  })

  test(`keeps an inverted colorbar consistent with pixel colors`, async () => {
    await mount_volume_slice({
      show_colorbar: true,
      color_range: [3, -1],
      colormap: `interpolateRdBu`,
    })
    const gradient = document.querySelector(`.colorbar .bar`)?.getAttribute(`style`) ?? ``
    const interpolator = get_d3_interpolator(`interpolateRdBu`)

    expect(gradient.indexOf(interpolator(0))).toBeLessThan(gradient.indexOf(interpolator(1)))
  })
})
