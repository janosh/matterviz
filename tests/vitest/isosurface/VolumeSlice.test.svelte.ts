import { get_d3_interpolator } from '#lib/colors/index.js'
import VolumeSlice from '#lib/isosurface/VolumeSlice.svelte'
import VolumeSliceView from '#lib/isosurface/VolumeSliceView.svelte'
import * as slice_module from '#lib/isosurface/slice.js'
import type { VolumeSliceSettings } from '#lib/isosurface/slice-settings.js'
import type { SliceResult } from '#lib/isosurface/slice.js'
import type { VolumeSliceMode } from '#lib/isosurface/slice-rendering.js'
import type { Vec2 } from '#lib/math.js'
import { rgb } from 'd3-color'
import { mount, tick, type ComponentProps } from 'svelte'
import { afterEach, describe, expect, test, vi, onTestFinished } from 'vitest'
import { doc_query } from '../setup'
import { make_grid, make_volume } from '../test-fixtures'

// width x height ramp (0, 1, 2, ...) over the rectangle u_range x v_range, clipped to its corners
const make_slice = (
  width = 4,
  height = 4,
  [u_min, u_max]: Vec2 = [-2, 2],
  [v_min, v_max]: Vec2 = [-1, 1],
): SliceResult => ({
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
  u_range: [u_min, u_max],
  v_range: [v_min, v_max],
  polygon: [
    [u_min, v_min],
    [u_max, v_min],
    [u_max, v_max],
    [u_min, v_max],
  ],
})

const style_with_color = (color: string): CSSStyleDeclaration => {
  const style = document.createElement(`div`).style
  style.color = color
  return style
}

// Route every canvas getContext call to one recording 2D context
const mock_canvas = () => {
  const context = {
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
  }
  vi.spyOn(HTMLCanvasElement.prototype, `getContext`).mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  )
  return context
}

async function mount_volume_slice(
  overrides: Partial<ComponentProps<typeof VolumeSlice>> = {},
) {
  const context = mock_canvas()
  const props = $state<ComponentProps<typeof VolumeSlice>>({
    slice: make_slice(),
    color_bar: null,
    ...overrides,
  })
  mount(VolumeSlice, { target: document.body, props })
  await tick()
  return { canvas: document.querySelector(`canvas`), context, props }
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

    expect([canvas?.width, canvas?.height]).toEqual([4, 4])
    expect(canvas?.getAttribute(`aria-label`)).toBe(`Volumetric scalar-field slice`)
    expect(canvas?.getAttribute(`style`)).toContain(`aspect-ratio: 2`) // physical u:v extent
    expect(context.putImageData).toHaveBeenCalledTimes(fills ? 1 : 0)
    // every threshold level shares one stroked path
    expect(context.stroke).toHaveBeenCalledTimes(contours ? 1 : 0)
    expect(context.clip).toHaveBeenCalledTimes(contours ? 1 : 0)
    if (contours) {
      // the first clip-path corner is polygon corner (-2, -1) → pixel (0.5, 0.5), flipped
      // to v-up row 3.5; beyond the 4-corner clip polygon, contours add segments
      expect(context.moveTo).toHaveBeenNthCalledWith(1, 0.5, 3.5)
      expect(context.moveTo.mock.calls.length).toBeGreaterThan(4)
    } else expect(context.moveTo).not.toHaveBeenCalled()
  })

  test(`centers a bounded horizontal colorbar`, async () => {
    await mount_volume_slice({ color_bar: { orientation: `horizontal` } })
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

  // a vertical title beside the tick labels overlapped long labels and stood off short ones
  test(`puts a vertical colorbar title opposite its tick labels`, async () => {
    await mount_volume_slice({ color_bar: {} })
    const title_row = doc_query(`.slice-colorbar.vertical .title-row`, HTMLElement)
    expect(title_row.classList.contains(`left`)).toBe(true)
  })

  test(`co-registers flipped contours with filled pixel rows`, async () => {
    const data = new Float64Array([0, 0, 1, 1])
    const { context } = await mount_volume_slice({
      slice: { ...make_slice(2, 2, [0, 1], [0, 1]), data, max: 1 },
      mode: `both`,
      contour_levels: [0.5],
    })
    // d3-contour locates this horizontal boundary at sampled y=1. Reflecting
    // that pixel-center coordinate through a 2-row canvas keeps it at y=1.
    expect(context.lineTo).toHaveBeenCalledWith(1.5, 1)
  })

  // Masked pixels used to sit below every level, so each threshold crossed along the mask
  // edge of any field above it; they now repeat their row's nearest in-mask value (or the
  // nearest filled row), so a uniform field contours like its unmasked self
  test.each([
    { desc: `a masked corner below explicit thresholds`, value: -20, masked: [0] },
    { desc: `a masked column`, value: 20, masked: [0, 4, 8, 12] },
    { desc: `a masked first row`, value: 20, masked: [0, 1, 2, 3] },
    { desc: `a masked last row`, value: 20, masked: [12, 13, 14, 15] },
  ])(`a uniform field with $desc contours like an unmasked one`, async ({ value, masked }) => {
    const uniform_slice = () => {
      const slice = { ...make_slice(), min: value, max: value }
      slice.data.fill(value)
      return slice
    }
    // masked first, so the reused contour buffer holds no values from an unmasked pass
    const slice = uniform_slice()
    for (const idx of masked) [slice.mask[idx], slice.data[idx]] = [0, Number.NaN]
    const { context, props } = await mount_volume_slice({
      slice,
      mode: `contours`,
      color_scale: { value_range: [0, 1] },
      contour_levels: [-10, 10],
    })
    const n_masked = context.lineTo.mock.calls.length
    context.lineTo.mockClear()
    props.slice = uniform_slice()
    await tick()
    // clip path + d3's band-0 border ring for each level the field reaches
    expect(context.lineTo).toHaveBeenCalledTimes(value > 0 ? 3 + 16 * 2 : 3)
    expect(n_masked).toBe(context.lineTo.mock.calls.length)
  })

  // Canvas takes a colour value, so `currentColor` has to be sampled in JS and the slice
  // repainted on a theme flip -- the cascade cannot restyle pixels already drawn.
  const theme_colors = {
    light: `rgb(0, 0, 0)`,
    white: `rgb(20, 20, 20)`,
    dark: `rgb(255, 255, 255)`,
    black: `rgb(230, 230, 230)`,
  }
  test.each([
    [`light`, `white`],
    [`dark`, `black`],
  ] as const)(
    `resamples currentColor contours after a %s to %s theme switch`,
    async (initial_theme, next_theme) => {
      vi.spyOn(globalThis, `getComputedStyle`).mockImplementation(() => {
        const theme = document.documentElement.dataset.theme as keyof typeof theme_colors
        return style_with_color(theme_colors[theme])
      })
      document.documentElement.dataset.theme = initial_theme
      const { context } = await mount_volume_slice({ mode: `contours`, contour_levels: [4] })
      expect(context.strokeStyle).toBe(theme_colors[initial_theme])
      document.documentElement.dataset.theme = next_theme
      await tick() // watch_dark_mode reports via MutationObserver, so not synchronously
      expect(context.strokeStyle).toBe(theme_colors[next_theme])
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
    const { context, props } = await mount_volume_slice()
    context.clearRect.mockClear()
    props.slice = null
    await tick()
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 4, 4)
  })

  // a config without scheme keeps the slice's diverging RdBu default, not viridis
  test.each([{ scheme: `interpolateRdBu` as const }, {}])(
    `keeps an inverted colorbar consistent with pixel colors %o`,
    async (scheme) => {
      const { context } = await mount_volume_slice({
        color_bar: {},
        color_scale: { ...scheme, value_range: [3, -1] },
      })
      const gradient = document.querySelector(`.colorbar .bar`)?.getAttribute(`style`) ?? ``
      const interpolator = get_d3_interpolator(`interpolateRdBu`)

      expect(gradient.indexOf(interpolator(0))).toBeGreaterThanOrEqual(0)
      expect(gradient.indexOf(interpolator(0))).toBeLessThan(gradient.indexOf(interpolator(1)))
      // value 3 (first data row, col 3) sits on the flipped bottom row and maps to palette start
      const { data } = context.putImageData.mock.calls[0][0] as ImageData
      const { r: red, g: green, b: blue } = rgb(interpolator(0))
      expect(Array.from(data.subarray(15 * 4, 15 * 4 + 3))).toEqual([red, green, blue])
    },
  )
})

test(`VolumeSliceView re-samples for plane changes only`, async () => {
  mock_canvas()
  const sample = vi.spyOn(slice_module, `sample_plane_slice`)
  const volume = make_volume(
    make_grid(6, 6, 6, (idx_x, idx_y, idx_z) => idx_x + idx_y + idx_z),
  )
  const props = $state({ volume, settings: { resolution: 16 } })
  mount(VolumeSliceView, { target: document.body, props })
  await tick()
  // edits coalesce to one resample per animation frame
  const settle = async (settings: Partial<VolumeSliceSettings>) => {
    props.settings = { ...props.settings, ...settings }
    await tick()
    await new Promise(requestAnimationFrame)
    await tick()
  }
  await settle({
    color_scale: { scheme: `interpolateViridis`, value_range: [0, 5] },
    contour_levels: 3,
  })
  await settle({ render_mode: `contours`, symmetric: true, show_plane: false })
  expect(sample).toHaveBeenCalledTimes(1)
  // a pane slider drag (one edit per frame) resamples every frame, not once it rests
  for (const [idx, position] of [0.25, 0.3, 0.35].entries()) {
    await settle({ position })
    expect(sample).toHaveBeenCalledTimes(2 + idx)
  }
})

// A drag must not drop to a lower preview resolution and then jump back once it rests
test(`VolumeSliceView keeps full resolution during rapid plane changes`, async () => {
  vi.useFakeTimers({
    toFake: [`performance`, `setTimeout`, `clearTimeout`, `requestAnimationFrame`],
  })
  onTestFinished(() => void vi.useRealTimers())
  mock_canvas()
  const sample = vi.spyOn(slice_module, `sample_plane_slice`)
  const volume = make_volume(
    make_grid(4, 4, 4, (idx_x, idx_y, idx_z) => idx_x + idx_y + idx_z),
  )
  const props = $state({ volume, settings: { resolution: 1024, position: 0.2 } })
  mount(VolumeSliceView, { target: document.body, props })
  await tick()
  // other tests' still-mounted views (6³ grids, refined to 66³) may resample; this view's 4³
  // grid is refined to 64³ before sampling, so pick its calls by grid size
  const resolutions = () =>
    sample.mock.calls
      .filter(([sampled]) => sampled.dims[0] === 64)
      .map(([, , options]) => options?.resolution)
  const full = [1024, 1024]
  expect(resolutions()).toEqual([full])
  for (const position of [0.25, 0.3, 0.35]) {
    props.settings = { ...props.settings, position }
    await tick()
    await vi.advanceTimersByTimeAsync(16)
    await tick()
  }
  expect(resolutions()).toEqual([full, full, full, full])
  // no extra full-resolution resample once the drag rests
  await vi.advanceTimersByTimeAsync(200)
  await tick()
  expect(resolutions()).toEqual([full, full, full, full])
})
