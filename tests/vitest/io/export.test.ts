import {
  canvas_to_png_blob,
  dpi_to_scale,
  export_canvas_as_png,
  export_svg_as_png,
  export_svg_as_svg,
  export_trajectory_video,
  render_video_frames,
  renderer_registry,
  scene_registry,
  svg_to_png_blob,
  svg_to_svg_string,
} from '$lib/io/export'
import { download } from '$lib/io/fetch'
import type { Camera, Scene, WebGPURenderer } from 'three/webgpu'
import { Vector2, PerspectiveCamera } from 'three/webgpu'
import { plan_movie, movie_frame } from '$lib/trajectory/movie'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mock_object_url } from '../setup'

vi.mock(`$lib/io/fetch`, () => ({ download: vi.fn() }))

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
      expect(captured).toEqual([0, 3, 5])
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
    getContext: vi.fn().mockReturnValue({ clearRect: vi.fn(), drawImage: vi.fn() }),
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

describe(`dpi_to_scale`, () => {
  test.each([
    [72, 1], // baseline
    [150, 150 / 72],
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

  test(`scales plain 2D canvases for high-DPI export`, async () => {
    const scaled_canvas = mock_offscreen_canvas()
    const canvas = make_mock_canvas()

    await canvas_to_png_blob(canvas, 150)

    expect([scaled_canvas.width, scaled_canvas.height]).toEqual([1667, 1250])
    const context = scaled_canvas.getContext.mock.results[0].value as { drawImage: unknown }
    expect(context.drawImage).toHaveBeenCalledWith(canvas, 0, 0, 1667, 1250)
    expect(scaled_canvas.toBlob).toHaveBeenCalledOnce()
  })

  test(`uses direct capture when DPI <= ~72 (multiplier ≤ 1.1)`, async () => {
    const { canvas, renderer } = make_canvas_with_renderer()
    await canvas_to_png_blob(canvas, 72)
    expect(renderer.setDrawingBufferSize).not.toHaveBeenCalled()
  })

  test.each([
    [300, 1, 300 / 72],
    [300, 2, 2 * (300 / 72)],
    [7200, 1, 10],
  ])(
    `DPI %s scales display ratio %s to %s, renders and restores`,
    async (dpi, display_ratio, expected_ratio) => {
      const { canvas, renderer } = make_canvas_with_renderer()
      renderer.getPixelRatio.mockReturnValue(display_ratio)
      const scene = {} as Scene
      const camera = {} as Camera
      await canvas_to_png_blob(canvas, dpi, scene, camera)
      expect(renderer.render).toHaveBeenCalledWith(scene, camera)
      expect(renderer.setDrawingBufferSize.mock.calls).toEqual([
        [800, 600, expected_ratio],
        [800, 600, display_ratio],
      ])
    },
  )

  test.each([72, 432])(
    `rejects %s DPI when the GPU never initializes, without resizing`,
    async (dpi) => {
      vi.useFakeTimers()
      const { canvas, renderer } = make_canvas_with_renderer()
      renderer.init = vi.fn().mockReturnValue(new Promise<void>(() => {})) // never settles
      const pending = canvas_to_png_blob(canvas, dpi, {} as Scene, {} as Camera).catch(
        (error: unknown) => error,
      )
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
    [800, 600],
    [600, 800],
  ])(`refuses oversized HiDPI PNGs for %s×%s before resizing`, async (width, height) => {
    const { canvas, renderer } = make_canvas_with_renderer()
    renderer.getSize.mockReturnValue(new Vector2(width, height))
    renderer.getPixelRatio.mockReturnValue(2)
    await expect(canvas_to_png_blob(canvas, 432)).rejects.toThrow(
      `Export resolution ${width * 12}×${height * 12} exceeds this GPU's 8192px limit`,
    )
    expect(renderer.setDrawingBufferSize).not.toHaveBeenCalled()
    expect(canvas.toBlob).not.toHaveBeenCalled()
  })

  test(`rejects when toBlob returns null`, async () => {
    const canvas = make_mock_canvas((callback_fn) => callback_fn(null))
    await expect(canvas_to_png_blob(canvas, 72)).rejects.toThrow(`Failed to generate PNG`)
  })

  test(`rejects when toBlob throws`, async () => {
    const canvas = make_mock_canvas(() => {
      throw new Error(`Canvas tainted`)
    })
    await expect(canvas_to_png_blob(canvas, 72)).rejects.toThrow(`Canvas tainted`)
  })

  test.each([`setDrawingBufferSize`, `render`, `toBlob`] as const)(
    `restores the renderer and rejects when high-DPI %s fails`,
    async (failure_stage) => {
      const { canvas, renderer } = make_canvas_with_renderer()
      const method = failure_stage === `toBlob` ? canvas.toBlob : renderer[failure_stage]
      vi.mocked(method).mockImplementationOnce(() => {
        throw new Error(`${failure_stage} failed`)
      })

      await expect(canvas_to_png_blob(canvas, 300, {} as Scene, {} as Camera)).rejects.toThrow(
        `${failure_stage} failed`,
      )
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

describe(`svg_to_svg_string`, () => {
  test.each([
    [undefined, false],
    [`0 0 200 150`, false],
    [`0 0 100 100`, true],
  ])(
    `emits standalone SVG with viewBox=%s, xmlns=%s without mutation`,
    async (viewbox, xmlns) => {
      const svg = make_svg(viewbox)
      if (xmlns) svg.setAttribute(`xmlns`, `http://www.w3.org/2000/svg`)
      const original_attrs = svg.attributes.length
      const result = svg_to_svg_string(svg)
      expect(result).toContain(`font-family`)
      expect(result).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>\n<!DOCTYPE svg /)
      expect(result.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g)).toHaveLength(1)
      if (viewbox) expect(result).toContain(`viewBox="${viewbox}"`)
      else expect(result).not.toContain(`viewBox=`)
      expect(svg.attributes).toHaveLength(original_attrs)
      await export_svg_as_svg(svg, `output.svg`)
      expect(download).toHaveBeenCalledExactlyOnceWith(
        result,
        `output.svg`,
        `image/svg+xml;charset=utf-8`,
      )
    },
  )

  test.each([
    { name: `pads the export`, padding: 2, expected: `-2 -2 104 54` },
    { name: `ignores overflowing padding`, padding: Number.MAX_VALUE, expected: `0 0 100 50` },
  ])(`$name without mutating the source viewBox`, ({ padding, expected }) => {
    const svg = make_svg(`0 0 100 50`)
    const result = svg_to_svg_string(svg, [], { viewbox_padding: padding })
    expect(result).toContain(`viewBox="${expected}"`)
    expect(svg.getAttribute(`viewBox`)).toBe(`0 0 100 50`)
  })

  test.each([
    { attribute_width: `4`, style_width: ``, expected: `-2 -2 104 54` },
    { attribute_width: `2`, style_width: `8px`, expected: `-4 -4 108 58` },
  ])(
    `derives viewBox padding from rendered stroke width $style_width`,
    ({ attribute_width, style_width, expected }) => {
      const svg = make_svg(`0 0 100 50`)
      const rect = document.createElementNS(`http://www.w3.org/2000/svg`, `rect`)
      rect.setAttribute(`stroke`, `black`)
      rect.setAttribute(`stroke-width`, attribute_width)
      if (style_width) rect.style.strokeWidth = style_width
      svg.append(rect)
      const result = svg_to_svg_string(svg, [], { viewbox_padding: `stroke` })
      expect(result).toContain(`viewBox="${expected}"`)
    },
  )
})

describe(`svg_to_png_blob`, () => {
  let mock_canvas_element: HTMLCanvasElement
  let object_url: ReturnType<typeof mock_object_url>

  beforeEach(() => {
    mock_canvas_element = mock_offscreen_canvas()
    object_url = mock_object_url()
    mock_image(`load`)
  })

  // one row per svg_viewbox() rejection branch: length !== 4, non-finite, width/height <= 0
  test.each<[string | undefined, string]>([
    [undefined, `missing dimensions`],
    [`0 0`, `too few values`],
    [`0 0 foo 100`, `NaN width`],
    [`0 0 0 100`, `zero width`],
    [`0 0 100 -50`, `negative height`],
  ])(`rejects for invalid viewBox %s (%s)`, async (viewbox, _reason) => {
    await expect(svg_to_png_blob(make_svg(viewbox))).rejects.toThrow(
      `Invalid SVG dimensions for PNG export`,
    )
  })

  test.each([
    [0, `zero DPI`],
    [NaN, `NaN DPI`],
  ])(`rejects for invalid DPI %s (%s)`, async (dpi: number) => {
    await expect(svg_to_png_blob(make_svg(`0 0 100 100`), dpi)).rejects.toThrow(
      `Invalid PNG DPI`,
    )
  })

  test(`rejects padding that overflows PNG dimensions`, async () => {
    await expect(
      svg_to_png_blob(make_svg(`0 0 100 50`), 72, [], {
        viewbox_padding: Number.MAX_VALUE,
      }),
    ).rejects.toThrow(`Invalid SVG dimensions`)
  })

  test.each([
    { viewBox: `0,0,100,100`, dpi: 72, size: 100, label: `comma-separated viewBox` },
    { viewBox: `0 0 100 100`, dpi: 144, size: 200, label: `2x multiplier` },
    { viewBox: `0 0 100 100`, dpi: 1440, size: 1000, label: `capped at 10x` },
    // 10 viewBox units at the 1 DPI floor would round to 0 without the >=1px clamp
    { viewBox: `0 0 10 10`, dpi: 1, size: 1, label: `clamped to >=1px` },
  ])(`viewBox $viewBox at $dpi DPI → $size px ($label)`, async ({ viewBox, dpi, size }) => {
    expect(await svg_to_png_blob(make_svg(viewBox), dpi)).toBeInstanceOf(Blob)
    expect([mock_canvas_element.width, mock_canvas_element.height]).toEqual([size, size])
  })

  test.each([
    { source_viewbox: undefined, padding: 0, size: [200, 100], viewbox: `0 0 100 50` },
    { source_viewbox: undefined, padding: 2, size: [208, 108], viewbox: `-2 -2 104 54` },
    { source_viewbox: `0 0 100 50`, padding: 0, size: [200, 100], viewbox: `0 0 100 50` },
    { source_viewbox: `0 0 100 50`, padding: 2, size: [208, 108], viewbox: `-2 -2 104 54` },
  ])(
    `serializes viewBox $source_viewbox as an image blob with $padding padding`,
    async ({ source_viewbox, padding, size, viewbox }) => {
      const svg = make_svg(source_viewbox)
      // CSS overrides the attributes; export must follow the rendered viewport.
      svg.setAttribute(`width`, `80`)
      svg.setAttribute(`height`, `40`)
      svg.style.width = `100px`
      svg.style.height = `50px`
      document.body.append(svg)
      await svg_to_png_blob(svg, 144, [], { viewbox_padding: padding })
      expect([mock_canvas_element.width, mock_canvas_element.height]).toEqual(size)
      const svg_blob = object_url.create.mock.calls[0][0] as Blob
      expect(svg_blob.type).toBe(`image/svg+xml;charset=utf-8`)
      const exported = new DOMParser().parseFromString(
        await svg_blob.text(),
        `image/svg+xml`,
      ).documentElement
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
    [`empty`, `load`, `Failed to generate PNG blob`],
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

  test(`delegates to canvas_to_png_blob for high-DPI with renderer`, async () => {
    const { canvas, renderer } = make_canvas_with_renderer()
    const scene = {} as Scene
    const camera = {} as Camera
    await export_canvas_as_png(canvas, `test.png`, 150, scene, camera)
    expect(download).toHaveBeenCalledExactlyOnceWith(
      expect.any(Blob),
      `test-150dpi.png`,
      `image/png`,
    )
    // the renderer was bumped to the 150 dpi ratio, re-rendered with the given scene and
    // camera, then restored to its original ratio
    expect(renderer.setDrawingBufferSize.mock.calls).toEqual([
      [800, 600, dpi_to_scale(150)],
      [800, 600, 1],
    ])
    expect(renderer.render).toHaveBeenCalledExactlyOnceWith(scene, camera)
  })
})

describe(`export_svg_as_png`, () => {
  test(`reports missing SVG dimensions to the export UI`, async () => {
    await expect(export_svg_as_png(make_svg(), `test.png`)).rejects.toThrow(
      `Invalid SVG dimensions`,
    )
  })

  test(`downloads the rasterized PNG under the given filename`, async () => {
    const canvas = mock_offscreen_canvas()
    mock_object_url()
    mock_image(`load`)
    await export_svg_as_png(make_svg(`0 0 100 100`), `test.png`, 144)
    expect([canvas.width, canvas.height]).toEqual([200, 200])
    expect(download).toHaveBeenCalledWith(expect.any(Blob), `test.png`, `image/png`)
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

test.each([
  [export_canvas_as_png, `Canvas not found for PNG export`],
  [export_svg_as_svg, `SVG element not found for export`],
  [export_svg_as_png, `SVG element not found for PNG export`],
] as const)(`null input warns: %s`, async (export_image, message) => {
  const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
  await export_image(null, `test`)
  expect(warn).toHaveBeenCalledWith(message)
})
