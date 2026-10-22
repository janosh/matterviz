import {
  canvas_overlay_png_blob,
  canvas_to_png_blob,
  dpi_to_scale,
  export_canvas_as_png,
  export_sections,
  export_trajectory_video,
  html_to_svg,
  observe_canvas_presence,
  render_video_frames,
  renderer_registry,
  scene_registry,
  svg_to_png_blob,
  svg_to_string,
  type ExportSources,
} from '#lib/io/export.js'
import { canvas_painters } from '#lib/plot/core/utils.js'
import { download } from 'svelte-widgets/download'
import type { Camera, Scene, WebGPURenderer } from 'three/webgpu'
import { Vector2, PerspectiveCamera } from 'three/webgpu'
import { plan_movie, movie_frame } from '#lib/trajectory/movie.js'
import { afterEach, beforeEach, describe, expect, onTestFinished, test, vi } from 'vitest'
import { mock_object_url } from '../setup'

vi.mock(`svelte-widgets/download`, () => ({ download: vi.fn() }))

beforeEach(() => vi.clearAllMocks())
// Restores every vi.spyOn (console, document.createElement, URL) so stubs never leak
// across describes; the module-level `download` vi.fn is unaffected in vitest 4.
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const make_mock_canvas = (
  toBlob_impl?: (callback_fn: BlobCallback) => void,
): HTMLCanvasElement =>
  ({
    toBlob: vi.fn(
      toBlob_impl ??
        ((callback_fn: BlobCallback) =>
          callback_fn(new Blob([`test`], { type: `image/png` }))),
    ),
    width: 800,
    height: 600,
  }) as unknown as HTMLCanvasElement

function make_canvas_with_renderer(toBlob_impl?: (callback_fn: BlobCallback) => void) {
  const renderer = {
    // Capture paths await init() before rendering, since WebGPURenderer.render() throws
    // while the GPU device is still being acquired.
    init: vi.fn().mockResolvedValue(undefined),
    render: vi.fn(),
    getPixelRatio: vi.fn().mockReturnValue(1),
    setDrawingBufferSize: vi.fn(),
    getSize: vi.fn().mockReturnValue(new Vector2(800, 600)),
    getContext: vi.fn().mockReturnValue({
      getConfiguration: vi.fn().mockReturnValue({
        device: { limits: { maxTextureDimension2D: 8192 } },
      }),
    }),
  }
  const canvas = make_mock_canvas(toBlob_impl)
  renderer_registry.set(canvas, renderer as unknown as WebGPURenderer)
  return { canvas, renderer }
}

test.each([`success`, `sink-error`, `cancel`, `blocked-sink`] as const)(
  `offline video awaits slow frames and restores dimensions on %s`,
  async (outcome) => {
    vi.useFakeTimers()
    const { canvas, renderer } = make_canvas_with_renderer()
    const camera = new PerspectiveCamera(50, 4 / 3)
    camera.position.set(0, 0, 10)
    const original = camera.clone()
    scene_registry.set(canvas, { scene: {} as Scene, camera })
    const capture_canvas = mock_offscreen_canvas()
    const plan = plan_movie(
      {
        video: { width: 1280, height: 720, fps: 30, duration_s: 0.1 },
        source_frames: [0, 0, 5],
        camera: { preset: `orbit`, turns: 0.5 },
      },
      6,
      {
        position: [0, 0, 10],
        target: [0, 0, 0],
        quaternion: [0, 0, 0, 1],
        projection: `perspective`,
        zoom: 1,
        fov: 50,
        pan: [0, 0],
      },
    )
    const abort = new AbortController()
    let prepared = -1
    const captured: number[] = []
    const result = render_video_frames(
      canvas,
      {
        ...plan.video,
        total_frames: 3,
        camera_flight: plan.camera,
        signal: abort.signal,
        on_step: async (idx) => {
          await new Promise((resolve) => setTimeout(resolve, 200))
          prepared = movie_frame(plan, idx).source_frame
        },
      },
      {
        frame: async (frame, _idx, signal) => {
          expect(signal).toBe(abort.signal)
          expect(frame).toBe(capture_canvas)
          expect([frame.width, frame.height]).toEqual([1280, 720])
          captured.push(prepared)
          if (outcome === `sink-error`) throw new Error(`encoder failed`)
          if (outcome === `cancel`) abort.abort(new Error(`cancelled`))
          if (outcome === `blocked-sink`) {
            setTimeout(() => abort.abort(new Error(`cancelled`)), 20)
            await new Promise<void>(() => {})
          }
        },
      },
    ).catch((error: unknown) => error)
    await vi.runAllTimersAsync()
    if (outcome === `success`) {
      expect(await result).toBeUndefined()
      expect(captured).toEqual([0, 0, 5])
      const rendered_camera = renderer.render.mock.calls.at(-1)?.[1] as PerspectiveCamera
      expect(rendered_camera.aspect).toBe(16 / 9)
      expect(rendered_camera.position.toArray()).toEqual(
        plan.camera.keyframes.at(-1)?.position,
      )
    } else
      expect(await result).toMatchObject({
        message: outcome === `sink-error` ? `encoder failed` : `cancelled`,
      })
    expect(camera.position.toArray()).toEqual(original.position.toArray())
    expect(camera.projectionMatrix.elements).toEqual(original.projectionMatrix.elements)
    expect(renderer.setDrawingBufferSize.mock.calls).toEqual([
      [1280, 720, 1],
      [800, 600, 1],
    ])
  },
)

function make_svg(viewBox?: string): SVGElement {
  const svg = document.createElementNS(`http://www.w3.org/2000/svg`, `svg`)
  if (viewBox) svg.setAttribute(`viewBox`, viewBox)
  return svg
}

// Offscreen raster canvas returned by document.createElement(`canvas`) for the current
// test; exports draw into it and read its width/height.
const mock_offscreen_canvas = (): HTMLCanvasElement & {
  getContext: ReturnType<typeof vi.fn>
} => {
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi
      .fn()
      .mockReturnValue({ clearRect: vi.fn(), drawImage: vi.fn(), scale: vi.fn() }),
    toBlob: make_mock_canvas().toBlob,
  }
  vi.spyOn(document, `createElement`).mockReturnValue(canvas as unknown as HTMLElement)
  return canvas as unknown as HTMLCanvasElement & { getContext: ReturnType<typeof vi.fn> }
}

// Keep image events controllable, including slow loads and late events after a timeout.
const mock_image = (src_behaviour: `load` | `error` | `throw` | `never`, delay_ms = 0) => {
  const images: EventTarget[] = []
  vi.stubGlobal(
    `Image`,
    class MockImage extends EventTarget {
      constructor() {
        super()
        images.push(this)
      }
      set src(_url: string) {
        if (src_behaviour === `throw`) throw new Error(`image setup failed`)
        if (src_behaviour === `never`) return
        const dispatch = () => this.dispatchEvent(new Event(src_behaviour))
        if (delay_ms) setTimeout(dispatch, delay_ms)
        else queueMicrotask(dispatch)
      }
    },
  )
  return images
}

// Export panes enable canvas formats once the viewer holds a <canvas>. Only a canvas (or a
// subtree holding one) coming or going can change that, so other DOM churn under the wrapper,
// like a table re-rendering on every frame, must not re-query the whole tree.
test(`observe_canvas_presence hands over canvases coming and going, ignoring other churn`, async () => {
  const wrapper = document.createElement(`div`)
  document.body.append(wrapper)
  onTestFinished(() => wrapper.remove())
  const set = vi.fn()
  const query_spy = vi.spyOn(wrapper, `querySelector`)
  const stop = observe_canvas_presence(wrapper, set)
  onTestFinished(() => stop?.())
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
  expect(set.mock.calls).toEqual([[null]])
  const row = document.createElement(`p`)
  wrapper.append(row)
  row.textContent = `frame 2`
  await flush()
  expect(set).toHaveBeenCalledOnce()
  const nested = document.createElement(`div`)
  const canvas = document.createElement(`canvas`)
  nested.append(canvas)
  wrapper.append(nested)
  await flush()
  expect(set.mock.lastCall?.[0]).toBe(canvas)
  nested.remove()
  await flush()
  expect(set).toHaveBeenLastCalledWith(null)
  expect(query_spy).toHaveBeenCalledTimes(3)
  // without a wrapper there is nothing to observe
  const unwrapped = vi.fn()
  expect(observe_canvas_presence(undefined, unwrapped)).toBeUndefined()
  expect(unwrapped.mock.calls).toEqual([[null]])
})

describe(`dpi_to_scale`, () => {
  test.each([
    [72, 1], // baseline
    [144, 2],
    [1440, 10], // capped at 10x
    [0.01, 1 / 72], // tiny positives floored at 1 DPI (no 0x0 canvases)
    [0, 1 / 72],
    [-50, 1 / 72],
    [NaN, 1], // non-finite (incl. Infinity) falls back to the 72 DPI baseline
    [Infinity, 1],
  ])(`dpi=%s -> scale=%s`, (png_dpi, expected) => {
    expect(dpi_to_scale(png_dpi)).toBeCloseTo(expected, 12)
  })
})

describe(`canvas_to_png_blob`, () => {
  test.each([
    { width: 800, height: 600, delay_ms: 0 },
    { width: 800, height: 600, delay_ms: 6000 },
    { width: 4000, height: 4000, delay_ms: 40_000 },
  ])(`encodes $width×$height PNG after $delay_ms ms`, async ({ width, height, delay_ms }) => {
    vi.useFakeTimers()
    const blob = new Blob([`test`], { type: `image/png` })
    const canvas = make_mock_canvas((callback) => setTimeout(() => callback(blob), delay_ms))
    Object.assign(canvas, { width, height })
    const pending = canvas_to_png_blob(canvas, 72).catch((error: unknown) => error)
    await vi.runAllTimersAsync()
    expect(await pending).toBe(blob)
    // at native resolution the canvas itself is encoded, with no offscreen rescale
    expect(canvas.toBlob).toHaveBeenCalledExactlyOnceWith(expect.any(Function), `image/png`)
    expect(vi.getTimerCount()).toBe(0)
  })

  test.each([
    // backing store already at 2x CSS size (a HiDPI screen): encoded as-is, no resampling
    { client: [400, 300], dpi: 144, direct: true, size: [800, 600] },
    // 1x screen: redrawn into an offscreen canvas at the export size
    { client: [800, 600], dpi: 144, direct: false, size: [1600, 1200] },
    // unmeasured (detached) canvases treat their backing store as CSS pixels
    { client: [0, 0], dpi: 150, direct: false, size: [1667, 1250] },
  ])(
    `2D canvas at $dpi DPI with CSS size $client -> $size (direct=$direct)`,
    async ({ client, dpi, direct, size }) => {
      const canvas = make_mock_canvas()
      Object.assign(canvas, { clientWidth: client[0], clientHeight: client[1] })
      const scaled_canvas = mock_offscreen_canvas()
      await canvas_to_png_blob(canvas, dpi)
      expect(canvas.toBlob).toHaveBeenCalledTimes(direct ? 1 : 0)
      if (direct) return
      expect([scaled_canvas.width, scaled_canvas.height]).toEqual(size)
      const context = scaled_canvas.getContext.mock.results[0].value as { drawImage: unknown }
      expect(context.drawImage).toHaveBeenCalledWith(canvas, 0, 0, ...size)
    },
  )

  test.each([
    [72, 1, 1, false],
    [300, 1, 300 / 72, true],
    // the export ratio is absolute: a HiDPI screen's ratio is not multiplied in again
    [300, 2, 300 / 72, true],
    [144, 2, 2, false],
    [7200, 1, 10, true],
  ])(
    `GPU canvas at DPI %s with display ratio %s renders at ratio %s (resize=%s)`,
    async (dpi, display_ratio, expected_ratio, resize) => {
      const { canvas, renderer } = make_canvas_with_renderer()
      renderer.getPixelRatio.mockReturnValue(display_ratio)
      const view = { scene: {} as Scene, camera: {} as Camera }
      scene_registry.set(canvas, view)
      await canvas_to_png_blob(canvas, dpi)
      // the drawing buffer is cleared after present, so even same-size captures re-render
      expect(renderer.render).toHaveBeenCalledExactlyOnceWith(view.scene, view.camera)
      expect(renderer.setDrawingBufferSize.mock.calls).toEqual(
        resize
          ? [
              [800, 600, expected_ratio],
              [800, 600, display_ratio],
            ]
          : [],
      )
    },
  )

  test.each([72, 432])(
    `rejects %s DPI when the GPU never initializes, without resizing`,
    async (dpi) => {
      vi.useFakeTimers()
      const { canvas, renderer } = make_canvas_with_renderer()
      renderer.init = vi.fn().mockReturnValue(new Promise<void>(() => {})) // never settles
      const pending = canvas_to_png_blob(canvas, dpi).catch((error: unknown) => error)
      await vi.advanceTimersByTimeAsync(6000)
      expect(await pending).toMatchObject({
        message: `GPU initialization timed out after 5000ms`,
      })
      expect(renderer.render).not.toHaveBeenCalled() // render() would throw without a device
      expect(renderer.setDrawingBufferSize).not.toHaveBeenCalled()
      expect(canvas.toBlob).not.toHaveBeenCalled()
    },
  )

  test.each([
    [900, 600],
    [600, 900],
  ])(`refuses oversized PNGs for %s×%s before resizing`, async (width, height) => {
    const { canvas, renderer } = make_canvas_with_renderer()
    renderer.getSize.mockReturnValue(new Vector2(width, height))
    await expect(canvas_to_png_blob(canvas, 720)).rejects.toThrow(
      `Export resolution ${width * 10}×${height * 10} exceeds this GPU's 8192px limit`,
    )
    expect(renderer.setDrawingBufferSize).not.toHaveBeenCalled()
    expect(canvas.toBlob).not.toHaveBeenCalled()
  })

  test.each<[string, (callback_fn: BlobCallback) => void, string]>([
    [`returns null`, (callback_fn) => callback_fn(null), `Failed to generate PNG`],
    [
      `throws`,
      () => {
        throw new Error(`Canvas tainted`)
      },
      `Canvas tainted`,
    ],
  ])(`rejects when toBlob %s`, async (_desc, to_blob, message) => {
    await expect(canvas_to_png_blob(make_mock_canvas(to_blob), 72)).rejects.toThrow(message)
  })

  test.each([`setDrawingBufferSize`, `render`, `toBlob`] as const)(
    `restores the renderer and rejects when high-DPI %s fails`,
    async (failure_stage) => {
      const { canvas, renderer } = make_canvas_with_renderer()
      scene_registry.set(canvas, { scene: {} as Scene, camera: {} as Camera })
      const method = failure_stage === `toBlob` ? canvas.toBlob : renderer[failure_stage]
      vi.mocked(method).mockImplementationOnce(() => {
        throw new Error(`${failure_stage} failed`)
      })

      await expect(canvas_to_png_blob(canvas, 300)).rejects.toThrow(`${failure_stage} failed`)
      expect(renderer.setDrawingBufferSize).toHaveBeenLastCalledWith(800, 600, 1)
      expect(canvas.toBlob).toHaveBeenCalledTimes(failure_stage === `toBlob` ? 1 : 0)
    },
  )

  test.each([
    { width: 800, height: 600, deadline_ms: 31_920 },
    { width: 20_000, height: 20_000, deadline_ms: 300_000 },
  ])(`bounds a stalled $width×$height PNG encode`, async ({ width, height, deadline_ms }) => {
    vi.useFakeTimers()
    const canvas = make_mock_canvas(() => {}) // never invokes callback
    Object.assign(canvas, { width, height })
    const settled = vi.fn()
    void canvas_to_png_blob(canvas, 72).then(settled, settled)
    await vi.advanceTimersByTimeAsync(deadline_ms - 1)
    expect(settled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: expect.stringContaining(`toBlob timed out`) }),
    )
    expect(vi.getTimerCount()).toBe(0)
  })
})

const parse_svg = (markup: string): Element =>
  new DOMParser().parseFromString(markup, `image/svg+xml`).documentElement

describe(`svg_to_string`, () => {
  test.each([
    [undefined, false],
    [`0 0 200 150`, false],
    [`0 0 100 100`, true],
  ])(`emits standalone SVG with viewBox=%s, xmlns=%s without mutation`, (viewbox, xmlns) => {
    const svg = make_svg(viewbox)
    if (xmlns) svg.setAttribute(`xmlns`, `http://www.w3.org/2000/svg`)
    const original_attrs = svg.attributes.length
    const result = svg_to_string(svg)
    expect(result).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>\n<svg /)
    expect(result).not.toContain(`<!DOCTYPE`)
    expect(result.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g)).toHaveLength(1)
    if (viewbox) {
      expect(result).toContain(`viewBox="${viewbox}"`)
      const [, , width, height] = viewbox.split(` `)
      expect(result).toContain(`width="${width}" height="${height}"`)
    } else expect(result).not.toContain(`viewBox=`)
    expect(svg.attributes).toHaveLength(original_attrs)
  })

  test.each([
    { attribute_width: `4`, style_width: ``, expected: `-2 -2 104 54` },
    { attribute_width: `2`, style_width: `8px`, expected: `-4 -4 108 58` },
  ])(
    `pads the viewBox by half the widest stroke $style_width`,
    ({ attribute_width, style_width, expected }) => {
      const svg = make_svg(`0 0 100 50`)
      const rect = document.createElementNS(`http://www.w3.org/2000/svg`, `rect`)
      rect.setAttribute(`stroke`, `black`)
      rect.setAttribute(`stroke-width`, attribute_width)
      if (style_width) rect.style.strokeWidth = style_width
      svg.append(rect)
      expect(svg_to_string(svg)).toContain(`viewBox="${expected}"`)
      expect(svg.getAttribute(`viewBox`)).toBe(`0 0 100 50`)
    },
  )

  test(`inlines stylesheet colors and fonts minimally and drops redundant attributes`, () => {
    const style = document.createElement(`style`)
    style.textContent = `.tick-label { fill: rgb(200, 0, 0); font-size: 13px } .themed { stroke: rgb(0, 0, 200); stroke-width: 3px }`
    document.head.append(style)
    onTestFinished(() => style.remove())
    document.body.innerHTML = `<svg viewBox="0 0 100 100" style="cursor: crosshair" class="svelte-4hqm71"><g fill="blue"><text class="tick-label svelte-1stqk4m">1</text><rect class="themed" width="10" height="10"/><circle fill="blue" r="2"/></g></svg>`
    const svg = document.querySelector(`svg`)
    if (!svg) throw new Error(`svg not mounted`)
    const exported = parse_svg(svg_to_string(svg))
    const [text, rect, circle] = [`text`, `rect`, `circle`].map((tag) =>
      exported.querySelector(tag),
    )
    // class-based styles survive without the page stylesheet...
    expect(text?.getAttribute(`fill`)).toBe(`rgb(200, 0, 0)`)
    expect(text?.getAttribute(`font-size`)).toBe(`13`)
    expect(rect?.getAttribute(`stroke`)).toBe(`rgb(0, 0, 200)`)
    expect(rect?.getAttribute(`stroke-width`)).toBe(`3`)
    // ...inherited values are written once on the ancestor, not repeated per child
    expect(exported.querySelector(`g`)?.getAttribute(`fill`)).toBe(`blue`)
    expect(circle?.hasAttribute(`fill`)).toBe(false)
    // classes stay as layer names for vector editors, minus Svelte scoping hashes
    expect(text?.getAttribute(`class`)).toBe(`tick-label`)
    expect(exported.getAttributeNames()).not.toContain(`class`)
    expect(exported.getAttributeNames()).not.toContain(`style`) // interaction-only cursor
  })

  test(`strips hidden, transparent and interaction-only markup but keeps export-only`, () => {
    document.body.innerHTML = `<svg viewBox="0 0 100 100" role="application" tabindex="0">
      <!-- svelte anchor -->
      <rect class="visible" width="5" height="5" fill="red" data-series-id="a" aria-label="bar"/>
      <rect width="5" height="5" fill="red" display="none"/>
      <rect width="5" height="5" fill="red" opacity="0"/>
      <circle class="marker-hit-target" r="8" fill="transparent"/>
      <line x1="0" x2="5" stroke="transparent" stroke-width="8"/>
      <g data-export-exclude><text>tooltip</text></g>
      <g><rect width="1" height="1" display="none"/></g>
      <text data-export-only display="none">static label</text>
      <defs><clipPath id="clip"><rect width="5" height="5" fill="none"/></clipPath></defs>
    </svg>`
    const svg = document.querySelector(`svg`)
    if (!svg) throw new Error(`svg not mounted`)
    const result = svg_to_string(svg)
    const exported = parse_svg(result)
    expect(exported.querySelectorAll(`rect`)).toHaveLength(2) // the visible one + clip shape
    expect(exported.querySelector(`circle, line`)).toBeNull()
    expect([...exported.querySelectorAll(`text`)].map((el) => el.textContent)).toEqual([
      `static label`,
    ])
    expect(exported.querySelector(`text`)?.hasAttribute(`display`)).toBe(false)
    expect(exported.querySelectorAll(`g`)).toHaveLength(0) // emptied groups are dropped
    expect(exported.querySelector(`clipPath rect`)).not.toBeNull()
    expect(result).not.toMatch(/<!--|data-|aria-|role=|tabindex=/)
  })

  test(`rounds coordinates to 2 decimals, leaving text, ids and hrefs untouched`, () => {
    document.body.innerHTML = `<svg viewBox="0 0 100.123456 50"><path id="p0.123456" d="M1.23456,2.5L-3.00499,4.1234e-7" stroke="black"/><text x="10.98765">0.123456</text></svg>`
    const svg = document.querySelector(`svg`)
    if (!svg) throw new Error(`svg not mounted`)
    const exported = parse_svg(svg_to_string(svg))
    expect(exported.querySelector(`path`)?.getAttribute(`d`)).toBe(`M1.23,2.5L-3,0`)
    expect(exported.querySelector(`path`)?.id).toBe(`p0.123456`)
    expect(exported.querySelector(`text`)?.getAttribute(`x`)).toBe(`10.99`)
    expect(exported.querySelector(`text`)?.textContent).toBe(`0.123456`)
    expect(exported.getAttribute(`viewBox`)).toBe(`-0.5 -0.5 101.12 51`)
  })

  test(`a 1000-point chart exports at under a third of its raw markup`, () => {
    const style = document.createElement(`style`)
    style.textContent = `.series { fill: rgb(31, 119, 180); stroke: white; stroke-width: 0.5px }`
    document.head.append(style)
    onTestFinished(() => style.remove())
    const rng = (idx: number) => Math.abs(Math.sin(idx * 12.9898) * 43758.5453) % 400
    const points = Array.from(
      { length: 1000 },
      (_, idx) =>
        `<!----><circle class="pt" cx="${rng(idx)}" cy="${rng(idx + 1)}" r="3" data-point-idx="${idx}" role="button" tabindex="-1" aria-label="point ${idx}"></circle>`,
    ).join(``)
    document.body.innerHTML = `<svg viewBox="0 0 400 400"><g class="series">${points}</g></svg>`
    const svg = document.querySelector(`svg`)
    if (!svg) throw new Error(`svg not mounted`)
    const result = svg_to_string(svg)
    expect(result.length).toBeLessThan(svg.outerHTML.length / 3)
    const circles = parse_svg(result).querySelectorAll(`circle`)
    expect(circles).toHaveLength(1000)
    // colors inherited from the group are written once there, not on 1000 circles
    expect(parse_svg(result).querySelector(`g`)?.getAttribute(`fill`)).toBe(
      `rgb(31, 119, 180)`,
    )
    expect(circles[0].getAttributeNames().toSorted()).toEqual([`class`, `cx`, `cy`, `r`])
  })

  test(`embeds foreign canvases via their registered painter at the export scale`, () => {
    document.body.innerHTML = `<svg viewBox="0 0 100 50"><foreignObject x="0" y="0" width="100" height="50"><canvas width="100" height="50"></canvas></foreignObject></svg>`
    const canvas = document.querySelector(`canvas`)
    const svg = document.querySelector(`svg`)
    if (!canvas || !svg) throw new Error(`canvas not mounted`)
    Object.assign(canvas, { width: 100, height: 50 })
    const painter = vi.fn((target: HTMLCanvasElement) => {
      target.toDataURL = () => `data:image/png;base64,PAINTED`
    })
    canvas_painters.set(canvas, painter)
    const image = parse_svg(svg_to_string(svg)).querySelector(`image`)
    expect(painter).toHaveBeenCalledExactlyOnceWith(expect.any(HTMLCanvasElement), 2)
    expect(image?.getAttribute(`href`)).toBe(`data:image/png;base64,PAINTED`)
    expect(image?.getAttribute(`width`)).toBe(`100`)
  })
})

describe(`html_to_svg`, () => {
  test(`redraws an HTML grid's cell backgrounds and text as SVG`, () => {
    document.body.innerHTML = `<div class="grid"><span style="background-color: rgb(255, 0, 0)">Fe</span></div>`
    const grid = document.querySelector<HTMLElement>(`.grid`)
    if (!grid) throw new Error(`grid not mounted`)
    vi.spyOn(Element.prototype, `getBoundingClientRect`).mockReturnValue(
      new DOMRect(0, 0, 40, 20),
    )
    const exported = parse_svg(svg_to_string(html_to_svg(grid)))
    expect(exported.getAttribute(`viewBox`)).toBe(`0 0 40 20`)
    expect(exported.querySelector(`rect`)?.getAttribute(`fill`)).toBe(`rgb(255, 0, 0)`)
  })
})

describe(`export_sections`, () => {
  const sources: ExportSources = {
    png: vi.fn(async (png_dpi: number) => new Blob([`${png_dpi}`])),
    svg: () => `<svg/>`,
    csv: () => `a,b`,
    json: () => `{}`,
  }
  const context = (save = vi.fn()) => ({
    filename: `chart`,
    save,
    prepare: vi.fn(),
    png_dpi: 300,
  })
  const labels = (sections: ReturnType<typeof export_sections>) =>
    sections.map(({ title, items }) => [title, items.map((item) => item.label)])

  test.each([
    [
      undefined,
      [
        [`Image`, [`PNG`, `SVG`]],
        [`Data`, [`CSV`, `JSON`]],
      ],
    ],
    [
      [`json`, `png`] as const,
      [
        [`Image`, [`PNG`]],
        [`Data`, [`JSON`]],
      ],
    ],
    [[`csv`, `md`] as const, [[`Data`, [`CSV`]]]], // formats without a source are skipped
    [[] as const, []], // [] hides everything
  ])(`export_formats=%j offers %j`, (export_formats, expected) => {
    expect(labels(export_sections(sources, { export_formats }))).toEqual(expected)
  })

  test.each([
    [`png`, `chart.png`, `image/png`],
    [`svg`, `chart.svg`, `image/svg+xml;charset=utf-8`],
    [`csv`, `chart.csv`, `text/csv;charset=utf-8`],
    [`json`, `chart.json`, `application/json`],
  ] as const)(`%s saves %s as %s`, async (format, filename, mime) => {
    const items = export_sections(sources).flatMap((section) => section.items)
    const item = items.find((entry) => entry.label === format.toUpperCase())
    const save = vi.fn()
    await item?.on_download?.(context(save))
    expect(save).toHaveBeenCalledExactlyOnceWith(expect.anything(), filename, mime)
    if (format === `png`) expect(sources.png).toHaveBeenCalledWith(300) // the pane's DPI
    expect(item?.show_dpi).toBe(format === `png`)
    expect(Boolean(item?.copy_text)).toBe(format !== `png`)
  })

  test(`on_export receives the serialized file instead of the default save`, async () => {
    const on_export = vi.fn()
    const [section] = export_sections(sources, { export_formats: [`csv`], on_export })
    const save = vi.fn()
    await section.items[0].on_download?.(context(save))
    expect(save).not.toHaveBeenCalled()
    expect(on_export).toHaveBeenCalledExactlyOnceWith(
      `csv`,
      expect.objectContaining({
        data: `a,b`,
        mime: `text/csv;charset=utf-8`,
        filename: `chart`,
      }),
    )
    expect(await section.items[0].copy_text?.()).toBe(`a,b`)
  })
})

describe(`svg_to_png_blob`, () => {
  let mock_canvas_element: HTMLCanvasElement
  let object_url: ReturnType<typeof mock_object_url>

  beforeEach(() => {
    mock_canvas_element = mock_offscreen_canvas()
    object_url = mock_object_url()
    mock_image(`load`)
  })

  // one row per svg_viewbox() rejection branch (length !== 4, non-finite, width/height <= 0)
  // and per invalid DPI
  test.each<[string | undefined, number, string]>([
    [undefined, 72, `Invalid SVG dimensions for PNG export`],
    [`0 0`, 72, `Invalid SVG dimensions for PNG export`],
    [`0 0 foo 100`, 72, `Invalid SVG dimensions for PNG export`],
    [`0 0 0 100`, 72, `Invalid SVG dimensions for PNG export`],
    [`0 0 100 -50`, 72, `Invalid SVG dimensions for PNG export`],
    [`0 0 100 100`, 0, `Invalid PNG DPI`],
    [`0 0 100 100`, NaN, `Invalid PNG DPI`],
  ])(`rejects viewBox %s at %s DPI`, async (viewbox, dpi, message) => {
    await expect(svg_to_png_blob(make_svg(viewbox), dpi)).rejects.toThrow(message)
  })

  // CSS sizes (100x50px) override the width/height attributes (80x40): export follows the
  // rendered viewport when there is no viewBox, and pads by half the widest stroke. 1 DPI
  // rounds 10 viewBox units to 0 without the >=1px clamp; 1440 DPI is capped at 10x.
  test.each<[string | undefined, number, number, [number, number], string]>([
    [`0,0,100,100`, 72, 0, [100, 100], `0 0 100 100`],
    [`0 0 100 100`, 1440, 0, [1000, 1000], `0 0 100 100`],
    [`0 0 10 10`, 1, 0, [1, 1], `0 0 10 10`],
    [undefined, 144, 0, [200, 100], `0 0 100 50`],
    [undefined, 144, 4, [208, 108], `-2 -2 104 54`],
    [`0 0 100 50`, 144, 0, [200, 100], `0 0 100 50`],
    [`0 0 100 50`, 144, 4, [208, 108], `-2 -2 104 54`],
  ])(
    `rasterizes viewBox %s at %s DPI with stroke %s to %j px`,
    async (source_viewbox, dpi, stroke, size, viewbox) => {
      const svg = make_svg(source_viewbox)
      svg.setAttribute(`width`, `80`)
      svg.setAttribute(`height`, `40`)
      svg.style.width = `100px`
      svg.style.height = `50px`
      if (stroke) {
        const rect = document.createElementNS(`http://www.w3.org/2000/svg`, `rect`)
        rect.setAttribute(`stroke`, `red`)
        rect.setAttribute(`stroke-width`, String(stroke))
        svg.append(rect)
      }
      document.body.append(svg)
      expect(await svg_to_png_blob(svg, dpi)).toBeInstanceOf(Blob)
      expect([mock_canvas_element.width, mock_canvas_element.height]).toEqual(size)
      const svg_blob = object_url.create.mock.calls[0][0] as Blob
      expect(svg_blob.type).toBe(`image/svg+xml;charset=utf-8`)
      const exported = parse_svg(await svg_blob.text())
      expect(exported.getAttribute(`viewBox`)).toBe(viewbox)
      expect(exported.getAttribute(`width`)).toBe(String(size[0]))
      expect(exported.getAttribute(`height`)).toBe(String(size[1]))
      expect(svg.style.width).toBe(`100px`)
      expect(svg.getAttribute(`width`)).toBe(`80`)
      expect(svg.getAttribute(`viewBox`)).toBe(source_viewbox ?? null)
    },
  )

  test(`rejects when canvas 2D context unavailable`, async () => {
    vi.spyOn(document, `createElement`).mockReturnValue({
      getContext: vi.fn().mockReturnValue(null),
    } as unknown as HTMLElement)
    await expect(svg_to_png_blob(make_svg(`0 0 100 100`))).rejects.toThrow(
      `Canvas 2D context not available`,
    )
  })

  test.each([
    [`success`, `load`, null],
    [`empty`, `load`, `Failed to generate high-resolution PNG`],
    [`throw`, `load`, `encoding failed`],
    [`timeout`, `load`, `toBlob timed out`],
    [`image-throw`, `throw`, `image setup failed`],
    [`image-error`, `error`, `Failed to load SVG for PNG export`],
    [`image-timeout`, `never`, `SVG image load timed out`],
    [`image-slow`, `load`, null],
  ] as const)(`PNG export cleanup: %s`, async (outcome, image_event, message) => {
    vi.useFakeTimers()
    const images = mock_image(image_event, outcome === `image-slow` ? 40_000 : 0)
    if ([`empty`, `throw`, `timeout`].includes(outcome))
      vi.mocked(mock_canvas_element.toBlob).mockImplementation((callback) => {
        if (outcome === `throw`) throw new Error(`encoding failed`)
        if (outcome === `empty`) callback(null)
      })
    const size = outcome === `image-slow` ? 4000 : 100
    const result = svg_to_png_blob(make_svg(`0 0 ${size} ${size}`), 72).catch(
      (error: unknown) => error,
    )
    await vi.runAllTimersAsync()
    if (message)
      expect(await result).toMatchObject({ message: expect.stringContaining(message) })
    else expect(await result).toBeInstanceOf(Blob)
    expect(object_url.revoke).toHaveBeenCalledExactlyOnceWith(`blob:test-url`)
    expect(vi.getTimerCount()).toBe(0)
    if (image_event !== `load`) {
      images[0].dispatchEvent(new Event(`load`))
      await Promise.resolve()
      expect(mock_canvas_element.getContext(`2d`)?.drawImage).not.toHaveBeenCalled()
      expect(mock_canvas_element.toBlob).not.toHaveBeenCalled()
    }
  })
})

// 3D charts lay HTML legends/color bars over a GPU canvas; the PNG redraws them on the frame
test(`canvas_overlay_png_blob draws the overlays' SVG redraw over the canvas frame`, async () => {
  const canvas = Object.assign(make_mock_canvas(), {
    clientWidth: 800,
    clientHeight: 600,
    getBoundingClientRect: () => new DOMRect(0, 0, 800, 600),
  })
  const legend = document.createElement(`div`)
  legend.innerHTML = `<svg><circle r="3" fill="red"></circle></svg>`
  document.body.append(legend)
  onTestFinished(() => legend.remove())
  const frame = { close: vi.fn() }
  vi.stubGlobal(
    `createImageBitmap`,
    vi.fn(async () => frame),
  )
  const object_url = mock_object_url()
  const images = mock_image(`load`)
  const offscreen = mock_offscreen_canvas()

  expect(await canvas_overlay_png_blob(canvas, [legend], 72)).toBeInstanceOf(Blob)
  const { drawImage } = offscreen.getContext.mock.results[0].value as {
    drawImage: ReturnType<typeof vi.fn>
  }
  expect(drawImage.mock.calls).toEqual([
    [frame, 0, 0, 800, 600],
    [images[0], 0, 0, 800, 600],
  ])
  expect(frame.close).toHaveBeenCalledOnce()
  const overlay_svg = parse_svg(await (object_url.create.mock.calls[0][0] as Blob).text())
  expect(overlay_svg.querySelector(`circle`)?.getAttribute(`fill`)).toBe(`red`)
})

// Without overlays the canvas frame passes through as is; overlays on a canvas that has not
// been laid out have no geometry to sit on and are refused
test.each([
  [`no overlays`, 0, 800, null],
  [`an unlaid-out canvas`, 1, 0, `has not been laid out (zero size)`],
])(`canvas_overlay_png_blob with %s`, async (_label, n_overlays, size, error) => {
  const frame_blob = new Blob([`frame`], { type: `image/png` })
  const canvas = Object.assign(
    make_mock_canvas((callback) => callback(frame_blob)),
    {
      getBoundingClientRect: () => new DOMRect(0, 0, size, size),
    },
  )
  const bitmap_spy = vi.fn()
  vi.stubGlobal(`createImageBitmap`, bitmap_spy)
  const overlays = Array.from({ length: n_overlays }, () => document.createElement(`div`))
  const result = canvas_overlay_png_blob(canvas, overlays, 72)
  if (error) await expect(result).rejects.toThrow(error)
  else expect(await result).toBe(frame_blob)
  expect(bitmap_spy).not.toHaveBeenCalled()
})

describe(`export_canvas_as_png`, () => {
  test.each([
    [`structure.png`, `structure-150dpi.png`], // suffix injected before extension
    [`structure.PNG`, `structure-150dpi.png`],
    [`structure`, `structure-150dpi.png`], // .png appended when missing
  ])(`downloads %s as %s`, async (filename, expected_filename) => {
    mock_offscreen_canvas() // 150 DPI rescales through an offscreen 2D canvas
    await export_canvas_as_png(make_mock_canvas(), filename, 150)
    expect(download).toHaveBeenCalledWith(expect.any(Blob), expected_filename, `image/png`)
  })
})

describe(`export_trajectory_video`, () => {
  beforeEach(() => {
    vi.spyOn(console, `error`).mockImplementation(() => {})
  })

  test.each([0, -1, NaN, Infinity, 2 ** 31])(`rejects stop_timeout_ms=%s`, async (timeout) => {
    const { canvas, renderer } = make_canvas_with_renderer()
    await expect(
      export_trajectory_video(canvas, `test`, { stop_timeout_ms: timeout }),
    ).rejects.toThrow(`Invalid stop_timeout_ms: ${timeout}`)
    expect(renderer.init).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
  })

  test.each([
    [`webm`, undefined],
    [`mp4`, undefined],
    [`webm`, `video/webm;codecs=vp9`],
    [`mp4`, `video/mp4;codecs=avc1`],
    [`webm`, `video/mp4;codecs=av01`],
    [`mp4`, `video/webm;codecs=av1`],
  ] as const)(`refuses %s when only %s is supported`, async (format, supported_mime) => {
    vi.stubGlobal(
      `MediaRecorder`,
      supported_mime
        ? { isTypeSupported: (mime: string) => mime === supported_mime }
        : undefined,
    )
    await expect(export_trajectory_video(null, `test`, { format })).rejects.toThrow(
      `Canvas not ready`,
    )
    await expect(
      export_trajectory_video(make_mock_canvas(), `test`, { format }),
    ).rejects.toThrow(`AV1 recording (video/${format};codecs=`)
    expect(download).not.toHaveBeenCalled()
  })

  test.each([
    `resize`,
    `width`,
    `height`,
    `webgl`,
    `unconfigured`,
    `init-failure`,
    `init-timeout`,
  ])(
    `handles video setup failure at %s without leaving the renderer resized`,
    async (failure) => {
      vi.useFakeTimers()
      vi.stubGlobal(`MediaRecorder`, { isTypeSupported: () => true })
      const { canvas, renderer } = make_canvas_with_renderer()
      const on_finish = vi.fn()
      let message = `resize failed`
      if (failure === `resize`)
        renderer.setDrawingBufferSize.mockImplementationOnce(() => {
          throw new Error(message)
        })
      else if (failure === `width` || failure === `height`) {
        renderer.getPixelRatio.mockReturnValue(2)
        renderer.getSize.mockReturnValue(
          failure === `width` ? new Vector2(800, 600) : new Vector2(600, 800),
        )
        message = `Export resolution ${failure === `width` ? `9600×7200` : `7200×9600`} exceeds this GPU's 8192px limit per dimension`
      } else if (failure === `webgl`) {
        renderer.getContext.mockReturnValue({
          MAX_TEXTURE_SIZE: 0x0d33,
          MAX_RENDERBUFFER_SIZE: 0x84e8,
          getParameter: (parameter: number) => (parameter === 0x0d33 ? 8192 : 4096),
        })
        message = `Export resolution 4800×3600 exceeds this GPU's 4096px limit per dimension`
      } else if (failure === `unconfigured`) {
        renderer.getContext().getConfiguration.mockReturnValue(null)
        message = `GPU canvas is not configured`
      } else {
        renderer.init.mockImplementation(() =>
          failure === `init-timeout`
            ? new Promise(() => {})
            : Promise.reject(new Error(`device failed`)),
        )
        message =
          failure === `init-timeout`
            ? `GPU initialization timed out after 5000ms`
            : `device failed`
      }

      const result = export_trajectory_video(canvas, `test.webm`, {
        resolution_multiplier: 6,
        total_frames: 0,
        on_finish,
      }).catch((error: unknown) => error)
      await vi.runAllTimersAsync()
      expect(await result).toMatchObject({ message: expect.stringContaining(message) })
      if (failure === `resize`) {
        expect(renderer.setDrawingBufferSize).toHaveBeenLastCalledWith(800, 600, 1)
      } else {
        expect(renderer.setDrawingBufferSize).not.toHaveBeenCalled()
      }
      expect(on_finish).toHaveBeenCalledOnce()
      expect(renderer.render).not.toHaveBeenCalled()
      expect(download).not.toHaveBeenCalled()
    },
  )

  test.each([`before-start`, `progress`, `render-wait`])(
    `cancels during %s without recording`,
    async (phase) => {
      vi.stubGlobal(`MediaRecorder`, { isTypeSupported: () => true })
      const request_frame = vi.fn().mockReturnValue(123)
      const cancel_frame = vi.fn()
      vi.stubGlobal(`requestAnimationFrame`, request_frame)
      vi.stubGlobal(`cancelAnimationFrame`, cancel_frame)
      const { canvas, renderer } = make_canvas_with_renderer()
      const controller = new AbortController()
      const cancel = () => controller.abort(new Error(`cancelled`))
      const on_step = vi.fn()
      if (phase === `before-start`) cancel()
      const result = export_trajectory_video(canvas, `test.webm`, {
        signal: controller.signal,
        on_step,
        on_progress: () => {
          if (phase === `progress`) cancel()
        },
      }).catch((error: unknown) => error)
      if (phase === `render-wait`) {
        await vi.waitFor(() => expect(request_frame).toHaveBeenCalledOnce())
        cancel()
        expect(cancel_frame).toHaveBeenCalledWith(123)
      }
      expect(await result).toEqual(new Error(`cancelled`))
      expect(on_step).toHaveBeenCalledTimes(phase === `render-wait` ? 1 : 0)
      expect(renderer.init).toHaveBeenCalledTimes(phase === `before-start` ? 0 : 1)
      expect(download).not.toHaveBeenCalled()
    },
  )

  test.each([
    [`success`, undefined],
    [`success-mp4`, undefined, { stop_delay_ms: 6000 }],
    [`success-save`, undefined, { stop_delay_ms: 6000 }],
    [`success-size-scaled`, undefined, { fps: 1 / 60, stop_delay_ms: 40_000 }],
    [`success-override`, undefined, { stop_delay_ms: 40_000, stop_timeout_ms: 60_000 }],
    [`save-error`, `folder write failed`],
    [`download-error`, `download failed`],
    [`timeout`, `Recording timeout - recorder did not stop`],
    [
      `timeout-override`,
      `Recording timeout - recorder did not stop`,
      {
        stop_timeout_ms: 1500,
        cleanup_delay_ms: 1500,
      },
    ],
    [
      `timeout-size-cap`,
      `Recording timeout - recorder did not stop`,
      {
        fps: 1 / 6000,
        cleanup_delay_ms: 300_000,
      },
    ],
    [`step-error`, `step failed`],
    [`start-error`, `MediaRecorder error: encoder failed`],
    [`start-throw`, `start failed`],
    [`start-timeout`, `Recording timeout - recorder did not start`],
    [`stop-error`, `stop failed`],
    [`abort-step`, `cancelled`],
    [`abort-read`, `cancelled`],
    [`abort-start`, `cancelled`],
    [`abort-start-string`, `cancelled`],
    [`abort-delay`, `cancelled`],
    [`abort-stop`, `cancelled`],
    [`abort-stop-delayed`, `cancelled`, { stop_delay_ms: 6000, cleanup_delay_ms: 1000 }],
    [`abort-finish`, `cancelled`],
    [`restore-size-error`, `resize restore failed`],
    [`finish-error`, `restore failed`],
  ] as const)(`releases resources after %s`, async (outcome, error_message, settings?) => {
    const {
      fps = 24,
      stop_delay_ms = 0,
      stop_timeout_ms,
      cleanup_delay_ms = 30_000,
    }: {
      fps?: number
      stop_delay_ms?: number
      stop_timeout_ms?: number
      cleanup_delay_ms?: number
    } = settings ?? {}
    vi.useFakeTimers()
    const controller = new AbortController()
    const cancel = () =>
      controller.abort(outcome === `abort-start-string` ? `cancelled` : new Error(`cancelled`))
    const recorder_stop = vi.fn()
    const recorder_create = vi.fn()
    const success = outcome.startsWith(`success`)
    const format = outcome === `success-mp4` ? `mp4` : undefined
    const mime_type = format === `mp4` ? `video/mp4;codecs=av01` : `video/webm;codecs=av1`
    let recording_started = false
    let recording_started_at = 0
    let stop_started = 0
    let cleanup_delay = 0
    class MockMediaRecorder extends EventTarget {
      constructor(stream: MediaStream, options: MediaRecorderOptions) {
        super()
        recorder_create(stream, options)
      }
      static isTypeSupported(mime: string): boolean {
        return mime === mime_type
      }
      state: MediaRecorder[`state`] = `inactive`
      start = vi.fn(() => {
        this.state = `recording`
        if (outcome === `start-throw`) throw new Error(`start failed`)
        if (outcome.startsWith(`abort-start`)) setTimeout(cancel, 1)
        if (outcome === `start-timeout`) return
        // Cold encoders can start after the entire short trajectory would have finished.
        setTimeout(() => {
          if (outcome === `start-error`) {
            this.dispatchEvent(new ErrorEvent(`error`, { error: new Error(`encoder failed`) }))
            return
          }
          recording_started = true
          recording_started_at = performance.now()
          this.dispatchEvent(new Event(`start`))
          if (outcome === `abort-delay`) setTimeout(cancel, 1)
        }, 500)
      })
      stop = vi.fn(() => {
        if (!outcome.startsWith(`start-`) && !outcome.startsWith(`abort-start`))
          expect(recording_started, `do not stop before the encoder starts`).toBe(true)
        recorder_stop()
        stop_started = performance.now()
        if (outcome === `stop-error`) throw new Error(`stop failed`)
        this.state = `inactive`
        if (outcome === `abort-stop`) cancel()
        if (outcome === `abort-stop-delayed`) setTimeout(cancel, 1000)
        const finish = () => {
          this.dispatchEvent(
            Object.assign(new Event(`dataavailable`), { data: new Blob([`encoded frame`]) }),
          )
          if (!outcome.startsWith(`timeout`)) this.dispatchEvent(new Event(`stop`))
        }
        if (stop_delay_ms) setTimeout(finish, stop_delay_ms)
        else finish()
      })
    }
    vi.stubGlobal(`MediaRecorder`, MockMediaRecorder)

    const tracks = [
      { requestFrame: vi.fn(), stop: vi.fn() },
      { requestFrame: vi.fn(), stop: vi.fn() },
    ]
    const stream = {
      getVideoTracks: vi.fn().mockReturnValue([tracks[0]]),
      getTracks: vi.fn().mockReturnValue(tracks),
    }
    const { canvas, renderer } = make_canvas_with_renderer()
    const view = { scene: {} as Scene, camera: {} as Camera }
    // The exact device limit is valid; only larger dimensions must be refused.
    renderer.getContext().getConfiguration().device.limits.maxTextureDimension2D =
      format === `mp4` ? 2400 : 1600
    scene_registry.set(canvas, view)
    const completed_frames = success || outcome === `timeout-size-cap`
    const total_frames =
      completed_frames ||
      [`step-error`, `abort-step`, `abort-delay`, `abort-read`].includes(outcome)
        ? 2
        : 0
    if (total_frames) {
      canvas.width = 300
      canvas.height = 150
      renderer.getSize.mockReturnValue(new Vector2(300, 150))
    }
    let current_step = -1
    let rendered_step = -1
    const captured_steps: number[] = []
    renderer.render.mockImplementation(() => (rendered_step = current_step))
    const capture_canvas = {
      captureStream: vi.fn().mockReturnValue(stream),
      width: 0,
      height: 0,
      getContext: () => ({
        clearRect: vi.fn(),
        drawImage: (source: HTMLCanvasElement) => {
          expect(source).toBe(canvas)
          captured_steps.push(rendered_step)
        },
      }),
    }
    vi.spyOn(document, `createElement`).mockReturnValue(
      capture_canvas as unknown as HTMLCanvasElement,
    )
    const expected_error = new Error(error_message)
    if (outcome === `restore-size-error`)
      renderer.setDrawingBufferSize.mockImplementation((_width, _height, ratio) => {
        if (ratio === 1) throw expected_error
      })
    const custom_save = outcome === `success-save` || outcome === `save-error`
    const on_save = vi.fn(async (_blob: Blob) => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      if (outcome === `save-error`) throw expected_error
    })
    if (outcome === `download-error`) {
      vi.mocked(download).mockImplementationOnce(() => {
        throw expected_error
      })
    }
    const read = Promise.withResolvers<undefined>()
    const on_step = vi.fn(async (step: number) => {
      canvas.width = 800
      canvas.height = 600
      renderer.getSize.mockReturnValue(new Vector2(800, 600))
      current_step = step
      if (outcome === `step-error` && step === 1) throw expected_error
      if (outcome === `abort-step` && step === 1) cancel()
      if (outcome === `abort-read` && step === 1) await read.promise
    })

    const export_promise = export_trajectory_video(canvas, `test.WEBM`, {
      format,
      fps,
      total_frames,
      stop_timeout_ms,
      on_step,
      on_save: custom_save ? on_save : undefined,
      resolution_multiplier: format === `mp4` ? undefined : 2,
      signal: controller.signal,
      on_finish: () => {
        cleanup_delay = performance.now() - stop_started
        expect(renderer.setDrawingBufferSize).toHaveBeenLastCalledWith(800, 600, 1)
        for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce()
        if (outcome === `abort-finish`) cancel()
        if (outcome === `finish-error`) throw expected_error
      },
    })
    const result = export_promise.catch((error: unknown) => error)
    if (success && stop_delay_ms && fps === 24) {
      await vi.advanceTimersByTimeAsync(6000)
      expect(recorder_stop).toHaveBeenCalledOnce()
      expect(download).not.toHaveBeenCalled()
      expect(on_save).not.toHaveBeenCalled()
      for (const track of tracks) expect(track.stop).not.toHaveBeenCalled()
      expect(renderer.setDrawingBufferSize).toHaveBeenLastCalledWith(
        800,
        600,
        format === `mp4` ? 3 : 2,
      )
    }
    if (outcome === `abort-read`) {
      await vi.advanceTimersByTimeAsync(600)
      expect(on_step).toHaveBeenLastCalledWith(1, controller.signal)
      cancel()
      expect(recorder_stop).toHaveBeenCalledOnce()
      read.resolve(undefined)
    }
    await vi.runAllTimersAsync()
    if (outcome.startsWith(`timeout`) || outcome === `abort-stop-delayed`)
      expect(cleanup_delay).toBe(cleanup_delay_ms)
    if (error_message) expect(await result).toEqual(expected_error)
    else {
      await expect(export_promise).resolves.toBeUndefined()
      expect(renderer.render).toHaveBeenLastCalledWith(view.scene, view.camera)
      const container = format ?? `webm`
      if (custom_save) expect(on_save).toHaveBeenCalledExactlyOnceWith(expect.any(Blob))
      else
        expect(download).toHaveBeenCalledExactlyOnceWith(
          expect.any(Blob),
          `test.${container}`,
          `video/${container}`,
        )
      const blob = custom_save
        ? on_save.mock.calls[0][0]
        : vi.mocked(download).mock.calls[0][0]
      if (!(blob instanceof Blob)) throw new Error(`Expected a video Blob`)
      expect(blob.type).toBe(`video/${container}`)
      expect(await blob.text()).toBe(`encoded frame`)
    }

    expect(recorder_create).toHaveBeenCalledExactlyOnceWith(stream, {
      mimeType: mime_type,
      videoBitsPerSecond: fps === 24 ? 1_152_000 : 1_000_000,
    })
    expect(recorder_stop).toHaveBeenCalledTimes(outcome === `stop-error` ? 2 : 1)
    expect(renderer.setDrawingBufferSize.mock.calls).toEqual([
      [800, 600, format === `mp4` ? 3 : 2],
      [800, 600, 1],
    ])
    expect(capture_canvas.captureStream).toHaveBeenCalledWith(fps)
    expect([capture_canvas.width, capture_canvas.height]).toEqual([800, 600])
    expect(captured_steps).toEqual(completed_frames ? [0, 1] : total_frames ? [0] : [])
    if (outcome === `success`) {
      // Frame preparation fits inside each 24 FPS interval; it must not add another delay.
      expect(stop_started - recording_started_at).toBeLessThan(
        (total_frames * 1000) / fps + 10,
      )
    }
    expect(tracks[0].requestFrame).toHaveBeenCalledTimes(
      completed_frames ? 2 : total_frames ? 1 : 0,
    )
    expect(download).toHaveBeenCalledTimes(
      !custom_save && (success || outcome === `download-error`) ? 1 : 0,
    )
    expect(on_save).toHaveBeenCalledTimes(custom_save ? 1 : 0)
    for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce()
  })
})
