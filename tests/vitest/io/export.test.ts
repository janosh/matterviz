import {
  canvas_to_png_blob,
  dpi_to_scale,
  export_canvas_as_png,
  export_svg_as_png,
  export_svg_as_svg,
  export_trajectory_video,
  get_ffmpeg_conversion_command,
  renderer_registry,
  svg_to_png_blob,
  svg_to_svg_string,
} from '$lib/io/export'
import { download } from '$lib/io/fetch'
import type { Camera, Scene, WebGPURenderer } from 'three/webgpu'
import { Vector2 } from 'three/webgpu'
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

// === Shared Helpers ===

const make_mock_canvas = (toBlob_impl?: (cb: BlobCallback) => void): HTMLCanvasElement =>
  ({
    toBlob: vi.fn(
      toBlob_impl ?? ((cb: BlobCallback) => cb(new Blob([`test`], { type: `image/png` }))),
    ),
    width: 800,
    height: 600,
  }) as unknown as HTMLCanvasElement

const make_mock_renderer = (): Partial<WebGPURenderer> => ({
  // Capture paths await init() before rendering, since WebGPURenderer.render() throws
  // while the GPU device is still being acquired.
  init: vi.fn().mockResolvedValue(undefined),
  render: vi.fn(),
  getPixelRatio: vi.fn().mockReturnValue(1),
  setPixelRatio: vi.fn(),
  getSize: vi.fn().mockReturnValue(new Vector2(800, 600)),
  setSize: vi.fn(),
})

function make_canvas_with_renderer(toBlob_impl?: (cb: BlobCallback) => void): {
  canvas: HTMLCanvasElement
  renderer: Partial<WebGPURenderer>
} {
  const renderer = make_mock_renderer()
  const canvas = make_mock_canvas(toBlob_impl)
  renderer_registry.set(canvas, renderer as WebGPURenderer)
  return { canvas, renderer }
}

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
    toBlob: vi.fn((cb: BlobCallback) => cb(new Blob([`test`], { type: `image/png` }))),
  }
  vi.spyOn(document, `createElement`).mockReturnValue(canvas as unknown as HTMLElement)
  return canvas as unknown as HTMLCanvasElement & { getContext: ReturnType<typeof vi.fn> }
}

// Replace Image so setting src synchronously fires `load` (or throws), restored on finish
const mock_image = (src_behaviour: `load` | `throw`) => {
  const orig_image = globalThis.Image
  globalThis.Image = class MockImage {
    load_listener: EventListener | null = null
    addEventListener(type: string, listener: EventListener): void {
      if (type === `load`) this.load_listener = listener
    }
    set src(_url: string) {
      if (src_behaviour === `throw`) throw new Error(`image setup failed`)
      queueMicrotask(() => this.load_listener?.(new Event(`load`)))
    }
  } as unknown as typeof Image
  return () => {
    globalThis.Image = orig_image
  }
}

// === Tests ===

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

describe(`get_ffmpeg_conversion_command`, () => {
  test.each([
    [
      `trajectory.webm`,
      `ffmpeg -i "trajectory.webm" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -movflags faststart "trajectory.mp4"`,
    ],
    [`path/to/video.WEBM`, `"path/to/video.mp4"`], // case-insensitive, path preserved
    [`recording.avi`, `"recording.avi"`], // non-.webm input keeps original extension
  ])(`%s → contains %s`, (input: string, expected: string) => {
    const result = get_ffmpeg_conversion_command(input)
    // Verify always returns a proper ffmpeg command, not just the filename
    expect(result).toMatch(/^ffmpeg\s+-i\s+/)
    expect(result).toContain(expected)
  })
})

// === canvas_to_png_blob (new data-returning function) ===

describe(`canvas_to_png_blob`, () => {
  test(`returns a valid PNG Blob from plain canvas (no renderer)`, async () => {
    const canvas = make_mock_canvas()
    const blob = await canvas_to_png_blob(canvas, 72)
    expect(blob.type).toBe(`image/png`)
    expect(await blob.text()).toBe(`test`)
    // at native resolution the canvas itself is encoded, with no offscreen rescale
    expect(canvas.toBlob).toHaveBeenCalledExactlyOnceWith(expect.any(Function), `image/png`)
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
    expect(renderer.setPixelRatio).not.toHaveBeenCalled()
  })

  test(`high-DPI capture renders the scene, then restores renderer pixel ratio`, async () => {
    const { canvas, renderer } = make_canvas_with_renderer()
    const scene = {} as Scene
    const camera = {} as Camera
    await canvas_to_png_blob(canvas, 300, scene, camera)
    expect(renderer.render).toHaveBeenCalledWith(scene, camera)
    expect(renderer.setPixelRatio).toHaveBeenCalledTimes(2) // set high + restore
    expect(renderer.setSize).toHaveBeenCalledTimes(2)
    expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(1)
  })

  test(`still resolves when the GPU device never comes up`, async () => {
    vi.useFakeTimers()
    const { canvas, renderer } = make_canvas_with_renderer()
    renderer.init = vi.fn().mockReturnValue(new Promise<void>(() => {})) // never settles
    const pending = canvas_to_png_blob(canvas, 300, {} as Scene, {} as Camera)
    await vi.advanceTimersByTimeAsync(6000)
    expect(await pending).toBeInstanceOf(Blob)
    expect(renderer.render).not.toHaveBeenCalled() // render() would throw without a device
    expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(1) // still restored
  })

  test(`rejects when toBlob returns null`, async () => {
    const canvas = make_mock_canvas((cb) => cb(null))
    await expect(canvas_to_png_blob(canvas, 72)).rejects.toThrow(`Failed to generate PNG`)
  })

  test(`rejects when toBlob throws`, async () => {
    const canvas = make_mock_canvas(() => {
      throw new Error(`Canvas tainted`)
    })
    await expect(canvas_to_png_blob(canvas, 72)).rejects.toThrow(`Canvas tainted`)
  })

  test.each([`setSize`, `toBlob`] as const)(
    `falls back to native resolution when high-DPI %s fails`,
    async (failure_stage) => {
      let to_blob_calls = 0
      const to_blob_impl =
        failure_stage === `toBlob`
          ? (callback: BlobCallback) => {
              to_blob_calls += 1
              if (to_blob_calls === 1) throw new Error(`toBlob failed`)
              callback(new Blob([`fallback`], { type: `image/png` }))
            }
          : undefined
      const { canvas, renderer } = make_canvas_with_renderer(to_blob_impl)
      if (failure_stage === `setSize`) {
        const set_size = renderer.setSize
        if (!set_size) throw new Error(`Mock renderer is missing setSize`)
        vi.mocked(set_size).mockImplementationOnce(() => {
          throw new Error(`setSize failed`)
        })
      }

      const blob = await canvas_to_png_blob(canvas, 300, {} as Scene, {} as Camera)
      expect(blob).toBeInstanceOf(Blob)
      expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(1)
      expect(renderer.setSize).toHaveBeenLastCalledWith(800, 600, false)
    },
  )

  test(`high-DPI render failures still export the current canvas buffer`, async () => {
    const { canvas, renderer } = make_canvas_with_renderer()
    const render = renderer.render
    if (!render) throw new Error(`Mock renderer is missing render`)
    vi.mocked(render).mockImplementationOnce(() => {
      throw new Error(`render failed`)
    })
    const warn_spy = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const blob = await canvas_to_png_blob(canvas, 300, {} as Scene, {} as Camera)
    expect(blob).toBeInstanceOf(Blob)
    expect(warn_spy).toHaveBeenCalledWith(
      expect.stringContaining(`re-render failed`),
      expect.any(Error),
    )
    expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(1)
  })

  test(`rejects when toBlob never calls back`, async () => {
    vi.useFakeTimers()
    const canvas = make_mock_canvas(() => {}) // never invokes callback
    let outcome: { error: Error } | { blob: Blob } | undefined
    // Attach handlers before the timeout fires so the rejection is never unhandled.
    const pending = canvas_to_png_blob(canvas, 72).then(
      (blob) => {
        outcome = { blob }
      },
      (error: unknown) => {
        outcome = { error: error instanceof Error ? error : new Error(String(error)) }
      },
    )
    await vi.advanceTimersByTimeAsync(6000)
    await pending
    expect(outcome).toEqual({ error: expect.any(Error) })
    if (!outcome || !(`error` in outcome)) throw new Error(`expected timeout rejection`)
    expect(outcome.error.message).toContain(`toBlob timed out`)
  })

  test(`caps DPI multiplier at 10x`, async () => {
    const { canvas, renderer } = make_canvas_with_renderer()
    await canvas_to_png_blob(canvas, 7200) // 7200/72 = 100x, should cap at 10
    expect(renderer.setPixelRatio).toHaveBeenCalledWith(10)
  })
})

// === svg_to_svg_string (new data-returning function) ===

describe(`svg_to_svg_string`, () => {
  test(`emits a standalone SVG document without mutating the source element`, () => {
    const svg = make_svg(`0 0 200 150`)
    const original_attrs = svg.attributes.length
    const result = svg_to_svg_string(svg)
    for (const expected of [
      `<?xml version="1.0"`,
      `<!DOCTYPE svg`,
      `xmlns="http://www.w3.org/2000/svg"`,
      `font-family`,
      `viewBox="0 0 200 150"`,
    ])
      expect(result).toContain(expected)
    expect(svg.attributes).toHaveLength(original_attrs)
  })

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

  test(`preserves xmlns if already set`, () => {
    const svg = make_svg(`0 0 100 100`)
    svg.setAttribute(`xmlns`, `http://www.w3.org/2000/svg`)
    const result = svg_to_svg_string(svg)
    // Should not have duplicate xmlns
    const xmlns_count = (result.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g) ?? [])
      .length
    expect(xmlns_count).toBe(1)
  })

  test(`works with SVG that has no viewBox and does not invent one`, () => {
    const result = svg_to_svg_string(make_svg())
    expect(result).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>\n<!DOCTYPE svg /)
    expect(result).toContain(`xmlns="http://www.w3.org/2000/svg"`)
    expect(result).not.toContain(`viewBox=`)
  })
})

// === svg_to_png_blob (new data-returning function) ===

describe(`svg_to_png_blob`, () => {
  let mock_canvas_element: HTMLCanvasElement
  let object_url: ReturnType<typeof mock_object_url>

  beforeEach(() => {
    mock_canvas_element = mock_offscreen_canvas()
    object_url = mock_object_url()
  })

  test(`rejects when viewBox is missing`, async () => {
    await expect(svg_to_png_blob(make_svg())).rejects.toThrow(
      `SVG viewBox not found for PNG export`,
    )
  })

  // one row per svg_viewbox() rejection branch: length !== 4, non-finite, width/height <= 0
  test.each([
    [`0 0`, `too few values`],
    [`0 0 foo 100`, `NaN width`],
    [`0 0 0 100`, `zero width`],
    [`0 0 100 -50`, `negative height`],
  ])(`rejects for invalid viewBox %s (%s)`, async (viewBox: string) => {
    await expect(svg_to_png_blob(make_svg(viewBox))).rejects.toThrow(`Invalid SVG dimensions`)
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

  // canvas dimensions are set synchronously before the Image load promise
  test.each([
    { viewBox: `0,0,100,100`, dpi: 72, size: 100, label: `comma-separated viewBox` },
    { viewBox: `0 0 100 100`, dpi: 144, size: 200, label: `2x multiplier` },
    { viewBox: `0 0 100 100`, dpi: 1440, size: 1000, label: `capped at 10x` },
    // 10 viewBox units at the 1 DPI floor would round to 0 without the >=1px clamp
    { viewBox: `0 0 10 10`, dpi: 1, size: 1, label: `clamped to >=1px` },
  ])(`viewBox $viewBox at $dpi DPI → $size px ($label)`, ({ viewBox, dpi, size }) => {
    void svg_to_png_blob(make_svg(viewBox), dpi)
    expect([mock_canvas_element.width, mock_canvas_element.height]).toEqual([size, size])
  })

  test.each([
    { padding: 0, size: [100, 50], viewbox: `0 0 100 50`, keeps_dimensions: true },
    { padding: 2, size: [104, 54], viewbox: `-2 -2 104 54`, keeps_dimensions: false },
  ])(
    `serializes the cloned SVG as an image blob with $padding padding`,
    async ({ padding, size, viewbox, keeps_dimensions }) => {
      const svg = make_svg(`0 0 100 50`)
      svg.setAttribute(`width`, `100`)
      svg.setAttribute(`height`, `50`)
      void svg_to_png_blob(svg, 72, [], { viewbox_padding: padding })
      expect([mock_canvas_element.width, mock_canvas_element.height]).toEqual(size)
      const svg_blob = object_url.create.mock.calls[0][0] as Blob
      expect(svg_blob.type).toBe(`image/svg+xml;charset=utf-8`)
      const serialized = await svg_blob.text()
      expect(serialized).toContain(`viewBox="${viewbox}"`)
      expect(serialized.includes(`width="100"`)).toBe(keeps_dimensions)
      expect(serialized.includes(`height="50"`)).toBe(keeps_dimensions)
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

  test(`revokes object URL after image load`, async () => {
    const restore_image = mock_image(`load`)
    try {
      expect(await svg_to_png_blob(make_svg(`0 0 100 100`), 72)).toBeInstanceOf(Blob)
      expect(object_url.revoke).toHaveBeenCalledExactlyOnceWith(`blob:test-url`)
    } finally {
      restore_image()
    }
  })

  test(`revokes object URL when image setup throws`, async () => {
    const restore_image = mock_image(`throw`)
    try {
      await expect(svg_to_png_blob(make_svg(`0 0 100 100`), 72)).rejects.toThrow(
        `image setup failed`,
      )
      expect(object_url.revoke).toHaveBeenCalledExactlyOnceWith(`blob:test-url`)
    } finally {
      restore_image()
    }
  })
})

// === export_canvas_as_png (download wrapper, regression tests) ===

describe(`export_canvas_as_png`, () => {
  test(`warns when canvas is null`, () => {
    const warn_spy = vi.spyOn(console, `warn`).mockImplementation(() => {})
    export_canvas_as_png(null, undefined)
    expect(warn_spy).toHaveBeenCalledWith(`Canvas not found for PNG export`)
  })

  test.each([
    [`structure.png`, `structure-150dpi.png`], // suffix injected before extension
    [`structure`, `structure-150dpi.png`], // .png appended when missing
  ])(`downloads %s as %s`, async (filename, expected_filename) => {
    mock_offscreen_canvas() // 150 DPI rescales through an offscreen 2D canvas
    export_canvas_as_png(make_mock_canvas(), filename, 150)
    // canvas_to_png_blob is async, wait for download to be called
    await vi.waitFor(() => {
      expect(download).toHaveBeenCalledWith(expect.any(Blob), expected_filename, `image/png`)
    })
  })

  test(`delegates to canvas_to_png_blob for high-DPI with renderer`, async () => {
    const { canvas, renderer } = make_canvas_with_renderer()
    const scene = {} as Scene
    const camera = {} as Camera
    export_canvas_as_png(canvas, `test.png`, 150, scene, camera)
    await vi.waitFor(() => {
      expect(download).toHaveBeenCalledExactlyOnceWith(
        expect.any(Blob),
        `test-150dpi.png`,
        `image/png`,
      )
    })
    // the renderer was bumped to the 150 dpi ratio, re-rendered with the given scene and
    // camera, then restored to its original ratio
    expect(renderer.setPixelRatio).toHaveBeenCalledTimes(2)
    expect(renderer.setPixelRatio).toHaveBeenNthCalledWith(1, dpi_to_scale(150))
    expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(1)
    expect(renderer.render).toHaveBeenCalledExactlyOnceWith(scene, camera)
  })
})

// === export_svg_as_svg (download wrapper, regression tests) ===

describe(`export_svg_as_svg`, () => {
  test(`warns when SVG element is null`, () => {
    const warn_spy = vi.spyOn(console, `warn`).mockImplementation(() => {})
    export_svg_as_svg(null, `test.svg`)
    expect(warn_spy).toHaveBeenCalledWith(`SVG element not found for export`)
  })

  test(`delegates to svg_to_svg_string and downloads`, () => {
    export_svg_as_svg(make_svg(`0 0 200 150`), `output.svg`)
    const [content, filename, mime] = vi.mocked(download).mock.calls[0]
    expect(content).toContain(`<?xml version`)
    expect(content).toContain(`viewBox="0 0 200 150"`)
    expect(filename).toBe(`output.svg`)
    expect(mime).toBe(`image/svg+xml;charset=utf-8`)
  })
})

// === export_svg_as_png (download wrapper, regression tests) ===

describe(`export_svg_as_png`, () => {
  test(`warns when SVG element is null`, () => {
    const warn_spy = vi.spyOn(console, `warn`).mockImplementation(() => {})
    export_svg_as_png(null, `test.png`)
    expect(warn_spy).toHaveBeenCalledWith(`SVG element not found for PNG export`)
  })

  test(`logs error for missing viewBox (via svg_to_png_blob rejection)`, async () => {
    const error_spy = vi.spyOn(console, `error`).mockImplementation(() => {})
    export_svg_as_png(make_svg(), `test.png`)
    await vi.waitFor(() => {
      expect(error_spy).toHaveBeenCalledWith(`Error exporting PNG:`, expect.any(Error))
    })
  })

  test(`downloads the rasterized PNG under the given filename`, async () => {
    const canvas = mock_offscreen_canvas()
    mock_object_url()
    const restore_image = mock_image(`load`)
    try {
      export_svg_as_png(make_svg(`0 0 100 100`), `test.png`, 144)
      expect([canvas.width, canvas.height]).toEqual([200, 200])
      await vi.waitFor(() => {
        expect(download).toHaveBeenCalledWith(expect.any(Blob), `test.png`, `image/png`)
      })
    } finally {
      restore_image()
    }
  })
})

// === export_trajectory_video ===

describe(`export_trajectory_video`, () => {
  beforeEach(() => {
    vi.spyOn(console, `error`).mockImplementation(() => {})
  })

  test.each<[string | null, string]>([
    [null, `null canvas`],
    [`valid`, `MediaRecorder undefined`],
  ])(`throws for %s (%s)`, async (canvas_type) => {
    const mock_canvas = {
      captureStream: vi.fn().mockReturnValue({
        getVideoTracks: vi.fn().mockReturnValue([{ requestFrame: vi.fn() }]),
      }),
      width: 800,
      height: 600,
    } as unknown as HTMLCanvasElement

    const canvas = canvas_type === null ? null : mock_canvas
    await expect(export_trajectory_video(canvas, `test.webm`)).rejects.toThrow(
      `WebM video recording not supported`,
    )
  })

  test(`restores renderer state when high-resolution setup throws`, async () => {
    vi.stubGlobal(`MediaRecorder`, { isTypeSupported: () => true })
    const { canvas, renderer } = make_canvas_with_renderer()
    const set_size = renderer.setSize
    if (!set_size) throw new Error(`Mock renderer is missing setSize`)
    vi.mocked(set_size).mockImplementationOnce(() => {
      throw new Error(`resize failed`)
    })

    await expect(
      export_trajectory_video(canvas, `test.webm`, { resolution_multiplier: 2 }),
    ).rejects.toThrow(`resize failed`)
    expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(1)
    expect(renderer.setSize).toHaveBeenLastCalledWith(800, 600, false)
  })

  test.each([
    [`successful finalization`, `success`],
    [`download failure`, `download-error`],
    [`recording timeout`, `timeout`],
    [`step failure`, `step-error`],
  ] as const)(`releases recording resources after %s`, async (_label, outcome) => {
    const recorder_stop = vi.fn()
    class MockMediaRecorder extends EventTarget {
      static isTypeSupported(): boolean {
        return true
      }
      state: MediaRecorder[`state`] = `inactive`
      start = vi.fn(() => (this.state = `recording`))
      stop = vi.fn(() => {
        this.state = `inactive`
        recorder_stop()
        if (outcome !== `timeout`) this.dispatchEvent(new Event(`stop`))
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
    const canvas = {
      captureStream: vi.fn().mockReturnValue(stream),
      width: 800,
      height: 600,
    } as unknown as HTMLCanvasElement
    const expected_error = new Error(
      outcome === `step-error` ? `step failed` : `download failed`,
    )
    if (outcome === `download-error`) {
      vi.mocked(download).mockImplementationOnce(() => {
        throw expected_error
      })
    }
    if (outcome === `timeout`) vi.useFakeTimers()
    const on_step = vi.fn()
    if (outcome === `step-error`) on_step.mockRejectedValue(expected_error)

    const export_promise = export_trajectory_video(canvas, `test.webm`, {
      total_frames: outcome === `step-error` ? 1 : 0,
      on_step,
    })
    if (outcome === `success`) {
      await expect(export_promise).resolves.toBeUndefined()
    } else if (outcome === `timeout`) {
      const timeout_error = export_promise.catch((error: unknown) => error)
      await vi.advanceTimersByTimeAsync(5000)
      expect(await timeout_error).toEqual(
        new Error(`Recording timeout - recorder did not stop`),
      )
    } else {
      await expect(export_promise).rejects.toThrow(expected_error)
    }

    expect(recorder_stop).toHaveBeenCalledOnce()
    for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce()
  })
})
