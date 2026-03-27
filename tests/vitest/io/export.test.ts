import {
  canvas_to_png_blob,
  export_canvas_as_png,
  export_svg_as_png,
  export_svg_as_svg,
  export_trajectory_video,
  get_ffmpeg_conversion_command,
  svg_to_png_blob,
  svg_to_svg_string,
} from '$lib/io/export'
import { download } from '$lib/io/fetch'
import type { Camera, Scene, WebGLRenderer } from 'three'
import { Vector2 } from 'three'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock(`$lib/io/fetch`, () => ({ download: vi.fn() }))

// === Shared Helpers ===

function make_mock_canvas(toBlob_impl?: (cb: BlobCallback) => void): HTMLCanvasElement {
  return {
    toBlob: vi.fn(
      toBlob_impl ?? ((cb: BlobCallback) => cb(new Blob([`test`], { type: `image/png` }))),
    ),
    width: 800,
    height: 600,
  } as unknown as HTMLCanvasElement
}

function make_mock_renderer(): Partial<WebGLRenderer> {
  return {
    render: vi.fn(),
    getPixelRatio: vi.fn().mockReturnValue(1),
    setPixelRatio: vi.fn(),
    getSize: vi.fn().mockReturnValue(new Vector2(800, 600)),
    setSize: vi.fn(),
  }
}

function make_canvas_with_renderer(toBlob_impl?: (cb: BlobCallback) => void): {
  canvas: HTMLCanvasElement
  renderer: Partial<WebGLRenderer>
} {
  const renderer = make_mock_renderer()
  const canvas = Object.assign(make_mock_canvas(toBlob_impl), {
    __renderer: renderer as WebGLRenderer,
  }) as unknown as HTMLCanvasElement
  return { canvas, renderer }
}

function make_svg(viewBox?: string): SVGElement {
  const svg = document.createElementNS(`http://www.w3.org/2000/svg`, `svg`)
  if (viewBox) svg.setAttribute(`viewBox`, viewBox)
  return svg
}

// === Tests ===

describe(`get_ffmpeg_conversion_command`, () => {
  test.each([
    [
      `trajectory.webm`,
      `ffmpeg -i "trajectory.webm" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -movflags faststart "trajectory.mp4"`,
    ],
    [`my-video.webm`, `"my-video.mp4"`],
    [`path/to/file.webm`, `"path/to/file.mp4"`],
    [`video.WEBM`, `"video.mp4"`],
    // Non-.webm input keeps original extension (no replacement)
    [`video.mp4`, `"video.mp4"`],
    [`recording.avi`, `"recording.avi"`],
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
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe(`image/png`)
  })

  test(`uses direct capture when DPI <= ~72 (multiplier ≤ 1.1)`, async () => {
    const { canvas, renderer } = make_canvas_with_renderer()
    await canvas_to_png_blob(canvas, 72)
    expect(renderer.setPixelRatio).not.toHaveBeenCalled()
  })

  test(`high-DPI capture adjusts and restores renderer pixel ratio`, async () => {
    const { canvas, renderer } = make_canvas_with_renderer()
    await canvas_to_png_blob(canvas, 300, {} as Scene, {} as Camera)
    expect(renderer.setPixelRatio).toHaveBeenCalledTimes(2) // set high + restore
    expect(renderer.setSize).toHaveBeenCalledTimes(2)
    expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(1)
  })

  test(`high-DPI capture renders scene before capture`, async () => {
    const { canvas, renderer } = make_canvas_with_renderer()
    const scene = {} as Scene
    const camera = {} as Camera
    await canvas_to_png_blob(canvas, 300, scene, camera)
    expect(renderer.render).toHaveBeenCalledWith(scene, camera)
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

  test(`restores renderer state when toBlob throws during high-DPI capture`, async () => {
    const { canvas, renderer } = make_canvas_with_renderer(() => {
      throw new Error(`tainted`)
    })
    await expect(canvas_to_png_blob(canvas, 300)).rejects.toThrow(`tainted`)
    expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(1)
  })

  test(`caps DPI multiplier at 10x`, async () => {
    const { canvas, renderer } = make_canvas_with_renderer()
    await canvas_to_png_blob(canvas, 7200) // 7200/72 = 100x, should cap at 10
    expect(renderer.setPixelRatio).toHaveBeenCalledWith(10)
  })
})

// === svg_to_svg_string (new data-returning function) ===

describe(`svg_to_svg_string`, () => {
  test.each([
    [`<?xml version="1.0"`, `XML declaration`],
    [`<!DOCTYPE svg`, `SVG DOCTYPE`],
    [`xmlns="http://www.w3.org/2000/svg"`, `xmlns namespace`],
    [`font-family`, `font-family attribute`],
    [`viewBox="0 0 200 150"`, `preserved viewBox`],
  ])(`output contains %s (%s)`, (expected: string) => {
    const svg = make_svg(`0 0 200 150`)
    const result = svg_to_svg_string(svg)
    expect(result).toContain(expected)
  })

  test(`does not modify the original SVG element`, () => {
    const svg = make_svg(`0 0 100 100`)
    const original_attrs = svg.attributes.length
    svg_to_svg_string(svg)
    expect(svg.attributes.length).toBe(original_attrs)
  })

  test(`preserves xmlns if already set`, () => {
    const svg = make_svg(`0 0 100 100`)
    svg.setAttribute(`xmlns`, `http://www.w3.org/2000/svg`)
    const result = svg_to_svg_string(svg)
    // Should not have duplicate xmlns
    const xmlns_count = (result.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g) || [])
      .length
    expect(xmlns_count).toBe(1)
  })

  test(`works with SVG that has no viewBox`, () => {
    const svg = make_svg()
    const result = svg_to_svg_string(svg)
    expect(result).toContain(`<?xml version`)
    expect(result).toContain(`xmlns`)
  })
})

// === svg_to_png_blob (new data-returning function) ===

describe(`svg_to_png_blob`, () => {
  let mock_canvas_element: HTMLCanvasElement
  let orig_createObjectURL: typeof URL.createObjectURL
  let orig_revokeObjectURL: typeof URL.revokeObjectURL

  beforeEach(() => {
    orig_createObjectURL = globalThis.URL.createObjectURL
    orig_revokeObjectURL = globalThis.URL.revokeObjectURL

    mock_canvas_element = {
      getContext: vi.fn().mockReturnValue({ clearRect: vi.fn(), drawImage: vi.fn() }),
      toBlob: vi.fn((cb: BlobCallback) => cb(new Blob([`test`], { type: `image/png` }))),
      width: 0,
      height: 0,
    } as unknown as HTMLCanvasElement

    vi.spyOn(document, `createElement`).mockReturnValue(
      mock_canvas_element as unknown as HTMLElement,
    )
    globalThis.URL.createObjectURL = vi.fn().mockReturnValue(`blob:test-url`)
    globalThis.URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    globalThis.URL.createObjectURL = orig_createObjectURL
    globalThis.URL.revokeObjectURL = orig_revokeObjectURL
  })

  test(`rejects when viewBox is missing`, async () => {
    await expect(svg_to_png_blob(make_svg())).rejects.toThrow(
      `SVG viewBox not found for PNG export`,
    )
  })

  test.each([
    [`0 0 0 100`, `zero width`],
    [`0 0 100 0`, `zero height`],
    [`0 0 0 0`, `zero both`],
    [`0 0 foo 100`, `NaN width`],
    [`0 0`, `too few values`],
    [`0 0 -100 100`, `negative width`],
    [`0 0 100 -50`, `negative height`],
    [`0 0 Infinity 100`, `Infinity width`],
  ])(`rejects for invalid viewBox %s (%s)`, async (viewBox: string) => {
    await expect(svg_to_png_blob(make_svg(viewBox))).rejects.toThrow(`Invalid SVG dimensions`)
  })

  test.each([
    [0, `zero DPI`],
    [-72, `negative DPI`],
    [Infinity, `Infinity DPI`],
    [NaN, `NaN DPI`],
  ])(`rejects for invalid DPI %s (%s)`, async (dpi: number) => {
    await expect(svg_to_png_blob(make_svg(`0 0 100 100`), dpi)).rejects.toThrow(
      `Invalid PNG DPI`,
    )
  })

  test(`parses comma-separated viewBox`, () => {
    const svg = make_svg(`0,0,100,100`)
    // canvas dimensions are set synchronously before the Image load promise
    svg_to_png_blob(svg, 72)
    expect(mock_canvas_element.width).toBe(100)
    expect(mock_canvas_element.height).toBe(100)
  })

  test(`rejects when canvas 2D context unavailable`, async () => {
    vi.spyOn(document, `createElement`).mockReturnValue({
      getContext: vi.fn().mockReturnValue(null),
    } as unknown as HTMLElement)
    await expect(svg_to_png_blob(make_svg(`0 0 100 100`))).rejects.toThrow(
      `Canvas 2D context not available`,
    )
  })

  // canvas dimensions and createObjectURL are set synchronously before Image load
  test.each([
    [144, 200, `2x multiplier`],
    [1440, 1000, `capped at 10x`],
  ])(`DPI %d → canvas size %dpx (%s)`, (dpi: number, expected_size: number) => {
    const svg = make_svg(`0 0 100 100`)
    svg_to_png_blob(svg, dpi)
    expect(mock_canvas_element.width).toBe(expected_size)
    expect(mock_canvas_element.height).toBe(expected_size)
  })

  test(`serializes cloned SVG as blob for image loading`, () => {
    const svg = make_svg(`0 0 100 100`)
    svg_to_png_blob(svg, 72)
    expect(URL.createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({ type: `image/svg+xml;charset=utf-8` }),
    )
  })

  test(`revokes object URL after image load`, async () => {
    // Mock Image so setting src synchronously triggers onload
    const orig_image = globalThis.Image
    globalThis.Image = class MockImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_url: string) {
        queueMicrotask(() => this.onload?.())
      }
    } as unknown as typeof Image
    try {
      const svg = make_svg(`0 0 100 100`)
      await svg_to_png_blob(svg, 72)
      expect(URL.revokeObjectURL).toHaveBeenCalled()
    } finally {
      globalThis.Image = orig_image
    }
  })
})

// === export_canvas_as_png (download wrapper, regression tests) ===

describe(`export_canvas_as_png`, () => {
  let console_warn_spy: ReturnType<typeof vi.spyOn>
  let console_error_spy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    console_warn_spy = vi.spyOn(console, `warn`).mockImplementation(() => {})
    console_error_spy = vi.spyOn(console, `error`).mockImplementation(() => {})
  })

  afterEach(() => {
    console_warn_spy.mockRestore()
    console_error_spy.mockRestore()
  })

  test(`warns when canvas is null`, () => {
    export_canvas_as_png(null, undefined)
    expect(console_warn_spy).toHaveBeenCalledWith(`Canvas not found for PNG export`)
  })

  test.each([
    [72, `-72dpi.png`],
    [150, `-150dpi.png`],
    [300, `-300dpi.png`],
  ])(`DPI %d injects %s suffix`, async (dpi: number, expected_suffix: string) => {
    export_canvas_as_png(make_mock_canvas(), `structure.png`, dpi)
    // canvas_to_png_blob is async, wait for download to be called
    await vi.waitFor(() => {
      expect(download).toHaveBeenCalledWith(
        expect.any(Blob),
        expect.stringContaining(expected_suffix),
        `image/png`,
      )
    })
  })

  test(`appends .png if extension missing`, async () => {
    export_canvas_as_png(make_mock_canvas(), `structure`, 150)
    await vi.waitFor(() => {
      expect(download).toHaveBeenCalledWith(
        expect.any(Blob),
        `structure-150dpi.png`,
        `image/png`,
      )
    })
  })

  test(`delegates to canvas_to_png_blob for high-DPI with renderer`, async () => {
    const { canvas, renderer } = make_canvas_with_renderer()
    export_canvas_as_png(canvas, `test.png`, 150, {} as Scene, {} as Camera)
    await vi.waitFor(() => {
      expect(renderer.setPixelRatio).toHaveBeenCalled()
      expect(renderer.render).toHaveBeenCalled()
      expect(download).toHaveBeenCalled()
    })
  })
})

// === export_svg_as_svg (download wrapper, regression tests) ===

describe(`export_svg_as_svg`, () => {
  let console_warn_spy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    console_warn_spy = vi.spyOn(console, `warn`).mockImplementation(() => {})
  })

  afterEach(() => console_warn_spy.mockRestore())

  test(`warns when SVG element is null`, () => {
    export_svg_as_svg(null, `test.svg`)
    expect(console_warn_spy).toHaveBeenCalledWith(`SVG element not found for export`)
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
  let console_warn_spy: ReturnType<typeof vi.spyOn>
  let console_error_spy: ReturnType<typeof vi.spyOn>
  let mock_canvas_element: HTMLCanvasElement

  beforeEach(() => {
    vi.clearAllMocks()
    console_warn_spy = vi.spyOn(console, `warn`).mockImplementation(() => {})
    console_error_spy = vi.spyOn(console, `error`).mockImplementation(() => {})

    mock_canvas_element = {
      getContext: vi.fn().mockReturnValue({ clearRect: vi.fn(), drawImage: vi.fn() }),
      toBlob: vi.fn((cb: BlobCallback) => cb(new Blob([`test`]))),
      width: 0,
      height: 0,
    } as unknown as HTMLCanvasElement
    vi.spyOn(document, `createElement`).mockReturnValue(
      mock_canvas_element as unknown as HTMLElement,
    )
    globalThis.URL.createObjectURL = vi.fn().mockReturnValue(`blob:test-url`)
    globalThis.URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    console_warn_spy.mockRestore()
    console_error_spy.mockRestore()
  })

  test(`warns when SVG element is null`, () => {
    export_svg_as_png(null, `test.png`)
    expect(console_warn_spy).toHaveBeenCalledWith(`SVG element not found for PNG export`)
  })

  test(`logs error for missing viewBox (via svg_to_png_blob rejection)`, async () => {
    export_svg_as_png(make_svg(), `test.png`)
    await vi.waitFor(() => {
      expect(console_error_spy).toHaveBeenCalledWith(`Error exporting PNG:`, expect.any(Error))
    })
  })

  test.each([
    [144, 200],
    [1440, 1000],
  ])(`DPI %d → canvas dimensions %dpx`, (dpi: number, expected_size: number) => {
    export_svg_as_png(make_svg(`0 0 100 100`), `test.png`, dpi)
    expect(mock_canvas_element.width).toBe(expected_size)
    expect(mock_canvas_element.height).toBe(expected_size)
  })
})

// === export_trajectory_video ===

describe(`export_trajectory_video`, () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
