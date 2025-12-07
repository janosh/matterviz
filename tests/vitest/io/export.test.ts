import {
  export_canvas_as_png,
  export_svg_as_png,
  export_svg_as_svg,
  export_trajectory_video,
  get_ffmpeg_conversion_command,
} from '$lib/io/export'
import { download } from '$lib/io/fetch'
import type { Camera, Scene, WebGLRenderer } from 'three'
import { Vector2 } from 'three'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock(`$lib/io/fetch`, () => ({ download: vi.fn() }))

describe(`get_ffmpeg_conversion_command`, () => {
  test.each([
    [
      `trajectory.webm`,
      `ffmpeg -i "trajectory.webm" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -movflags faststart "trajectory.mp4"`,
    ],
    [`my-video.webm`, `"my-video.mp4"`],
    [`path/to/file.webm`, `"path/to/file.mp4"`],
    [`video.WEBM`, `"video.mp4"`],
  ])(`%s → contains %s`, (input, expected) => {
    expect(get_ffmpeg_conversion_command(input)).toContain(expected)
  })
})

describe(`export_canvas_as_png`, () => {
  let mock_canvas: HTMLCanvasElement
  let mock_renderer: Partial<WebGLRenderer>
  let console_warn_spy: ReturnType<typeof vi.spyOn>
  let console_error_spy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    console_warn_spy = vi.spyOn(console, `warn`).mockImplementation(() => {})
    console_error_spy = vi.spyOn(console, `error`).mockImplementation(() => {})

    mock_canvas = {
      toBlob: vi.fn((callback: BlobCallback) =>
        callback(new Blob([`test`], { type: `image/png` }))
      ),
      width: 800,
      height: 600,
    } as unknown as HTMLCanvasElement

    mock_renderer = {
      render: vi.fn(),
      getPixelRatio: vi.fn().mockReturnValue(1),
      setPixelRatio: vi.fn(),
      getSize: vi.fn().mockReturnValue(new Vector2(800, 600)),
      setSize: vi.fn(),
    }
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
    [72, `72dpi.png`],
    [150, `-150dpi.png`],
  ])(`DPI %d includes correct suffix in filename`, (dpi, expected_suffix) => {
    export_canvas_as_png(mock_canvas, `structure.png`, dpi)
    expect(download).toHaveBeenCalledWith(
      expect.any(Blob),
      expect.stringContaining(expected_suffix),
      `image/png`,
    )
  })

  test(`appends .png if extension missing`, () => {
    export_canvas_as_png(mock_canvas, `structure`, 150)
    expect(download).toHaveBeenCalledWith(
      expect.any(Blob),
      `structure-150dpi.png`,
      `image/png`,
    )
  })

  test(`high-DPI export with renderer`, () => {
    const canvas_with_renderer = {
      ...mock_canvas,
      __renderer: mock_renderer as WebGLRenderer,
    }
    export_canvas_as_png(
      canvas_with_renderer as unknown as HTMLCanvasElement,
      `test.png`,
      150,
      {} as Scene,
      {} as Camera,
    )
    expect(mock_renderer.setPixelRatio).toHaveBeenCalled()
    expect(mock_renderer.render).toHaveBeenCalled()
  })

  test.each([
    [`blob null`, (cb: BlobCallback) => cb(null), `Failed to generate PNG`],
    [
      `error thrown`,
      () => {
        throw new Error(`Canvas tainted`)
      },
      undefined,
    ],
  ])(`handles failure: %s`, (_desc, toBlob_impl, _expected_msg) => {
    const fail_canvas = { toBlob: vi.fn(toBlob_impl) } as unknown as HTMLCanvasElement
    export_canvas_as_png(fail_canvas, `test.png`, 72)
    expect(console_warn_spy.mock.calls.length + console_error_spy.mock.calls.length)
      .toBeGreaterThan(0)
  })
})

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

  test.each([
    [`<?xml version`, `XML declaration`],
    [`viewBox="0 0 200 150"`, `viewBox preserved`],
    [`xmlns="http://www.w3.org/2000/svg"`, `xmlns added`],
    [`font-family`, `font-family set`],
    [`<!DOCTYPE svg`, `DOCTYPE included`],
  ])(`exports SVG containing %s`, (expected) => {
    const svg = document.createElementNS(`http://www.w3.org/2000/svg`, `svg`)
    svg.setAttribute(`viewBox`, `0 0 200 150`)
    export_svg_as_svg(svg, `output.svg`)
    expect(vi.mocked(download).mock.calls[0][0]).toContain(expected)
  })
})

describe(`export_svg_as_png`, () => {
  let console_warn_spy: ReturnType<typeof vi.spyOn>
  let mock_canvas_element: HTMLCanvasElement

  beforeEach(() => {
    vi.clearAllMocks()
    console_warn_spy = vi.spyOn(console, `warn`).mockImplementation(() => {})

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

  afterEach(() => console_warn_spy.mockRestore())

  test.each([
    [null, `0 0 100 100`, `SVG element not found for PNG export`, `null SVG`],
    [`valid`, ``, `SVG viewBox not found for PNG export`, `missing viewBox`],
    [`valid`, `0 0 0 100`, `Invalid SVG dimensions for PNG export`, `zero width`],
  ])(`warns for %s`, (_svg_type, view_box, expected_msg, _desc) => {
    const svg = _svg_type === null
      ? null
      : document.createElementNS(`http://www.w3.org/2000/svg`, `svg`)
    if (svg && view_box) svg.setAttribute(`viewBox`, view_box)
    export_svg_as_png(svg, `test.png`)
    expect(console_warn_spy).toHaveBeenCalledWith(expected_msg)
  })

  test(`warns when canvas context unavailable`, () => {
    const svg = document.createElementNS(`http://www.w3.org/2000/svg`, `svg`)
    svg.setAttribute(`viewBox`, `0 0 100 100`)
    vi.spyOn(document, `createElement`).mockReturnValue(
      { getContext: vi.fn().mockReturnValue(null) } as unknown as HTMLElement,
    )
    export_svg_as_png(svg, `test.png`)
    expect(console_warn_spy).toHaveBeenCalledWith(
      `Canvas 2D context not available for PNG export`,
    )
  })

  test.each([
    [144, 200, 2],
    [1440, 1000, 10], // capped at 10x
  ])(`DPI %d → canvas size %d (multiplier %dx)`, (dpi, expected_size) => {
    const svg = document.createElementNS(`http://www.w3.org/2000/svg`, `svg`)
    svg.setAttribute(`viewBox`, `0 0 100 100`)
    export_svg_as_png(svg, `test.png`, dpi)
    expect(mock_canvas_element.width).toBe(expected_size)
    expect(mock_canvas_element.height).toBe(expected_size)
  })
})

describe(`export_trajectory_video`, () => {
  let mock_canvas: HTMLCanvasElement

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, `error`).mockImplementation(() => {})
    mock_canvas = {
      captureStream: vi.fn().mockReturnValue({
        getVideoTracks: vi.fn().mockReturnValue([{ requestFrame: vi.fn() }]),
      }),
      width: 800,
      height: 600,
    } as unknown as HTMLCanvasElement
  })

  test.each([
    [null, `null canvas`],
    [`valid`, `MediaRecorder undefined`],
  ])(`throws for %s`, async (canvas_type, _desc) => {
    const canvas = canvas_type === null ? null : mock_canvas
    await expect(export_trajectory_video(canvas, `test.webm`)).rejects.toThrow(
      `WebM video recording not supported`,
    )
  })
})
