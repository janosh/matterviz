import {
  export_canvas_as_png,
  export_svg_as_png,
  export_svg_as_svg,
} from '$lib/io/export'
import { download } from '$lib/io/fetch'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { simple_structure } from '../setup'

vi.mock(`$lib/io/fetch`, () => ({ download: vi.fn() }))
const mock_download = vi.mocked(download)

// Helper functions
function create_mock_svg(view_box = `0 0 100 100`): SVGElement {
  const svg = document.createElementNS(`http://www.w3.org/2000/svg`, `svg`)
  svg.setAttribute(`viewBox`, view_box)
  svg.setAttribute(`width`, `100`)
  svg.setAttribute(`height`, `100`)
  return svg
}

function create_mock_canvas(): HTMLCanvasElement & { __customRenderer?: unknown } {
  const canvas = document.createElement(`canvas`) as HTMLCanvasElement & {
    __customRenderer?: unknown
  }
  canvas.toBlob = vi.fn((cb: (blob: Blob | null) => void) =>
    cb(new Blob([`pngdata`], { type: `image/png` }))
  ) as unknown as (HTMLCanvasElement & { __customRenderer?: unknown })[`toBlob`]
  return canvas
}

function create_mock_image(): HTMLImageElement {
  return {
    crossOrigin: ``,
    onload: null,
    onerror: null,
    src: ``,
  } as unknown as HTMLImageElement
}

describe(`Export functionality`, () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe(`Canvas PNG export`, () => {
    it(`exports PNG for direct export`, () => {
      const mock_canvas = create_mock_canvas()
      export_canvas_as_png(mock_canvas, simple_structure, 72)
      expect(mock_canvas.toBlob).toHaveBeenCalled()
      expect(mock_download).toHaveBeenCalledWith(
        expect.any(Blob),
        expect.stringContaining(`.png`),
        `image/png`,
      )
    })

    it(`exports high-res PNG with renderer`, () => {
      const mock_canvas = create_mock_canvas()
      const mock_renderer = {
        getPixelRatio: vi.fn(() => 1),
        setPixelRatio: vi.fn(),
        getSize: vi.fn(() => ({ width: 100, height: 100 })),
        setSize: vi.fn(),
        render: vi.fn(),
      }
      mock_canvas.__customRenderer = mock_renderer
      export_canvas_as_png(mock_canvas, simple_structure, 144)
      expect(mock_renderer.setPixelRatio).toHaveBeenCalledWith(2)
      expect(mock_renderer.setSize).toHaveBeenCalledWith(100, 100, false)
      expect(mock_download).toHaveBeenCalledWith(
        expect.any(Blob),
        expect.stringContaining(`.png`),
        `image/png`,
      )
    })

    it.each([
      { canvas: null, warn_msg: `Canvas not found for PNG export` },
      {
        canvas: create_mock_canvas(),
        warn_msg: `Failed to generate PNG - canvas may be empty`,
        setup: (canvas: HTMLCanvasElement) => {
          canvas.toBlob = vi.fn((cb: (blob: Blob | null) => void) =>
            cb(null)
          ) as unknown as (HTMLCanvasElement & { __customRenderer?: unknown })[`toBlob`]
        },
      },
    ])(`handles canvas issues`, ({ canvas, warn_msg, setup }) => {
      if (setup) setup(canvas as HTMLCanvasElement)
      const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
      export_canvas_as_png(canvas, simple_structure)
      expect(warn).toHaveBeenCalledWith(warn_msg)
      expect(mock_download).not.toHaveBeenCalled()
      warn.mockRestore()
    })
  })

  describe(`SVG export`, () => {
    let mock_xml_serializer: { serializeToString: ReturnType<typeof vi.fn> }

    beforeEach(() => {
      mock_xml_serializer = { serializeToString: vi.fn(() => `<svg></svg>`) }
      globalThis.XMLSerializer = vi.fn(() =>
        mock_xml_serializer
      ) as unknown as typeof XMLSerializer
    })

    it(`exports SVG with XML/DOCTYPE and font-family`, () => {
      const mock_svg = create_mock_svg()
      const mock_cloned_svg = create_mock_svg()
      mock_svg.cloneNode = vi.fn(() => mock_cloned_svg)
      export_svg_as_svg(mock_svg, `f.svg`)
      expect(mock_xml_serializer.serializeToString).toHaveBeenCalledWith(mock_cloned_svg)
      expect(mock_download).toHaveBeenCalledWith(
        expect.stringContaining(`<?xml version="1.0"`),
        `f.svg`,
        `image/svg+xml`,
      )
      expect(mock_download).toHaveBeenCalledWith(
        expect.stringContaining(`<!DOCTYPE svg PUBLIC`),
        `f.svg`,
        `image/svg+xml`,
      )
      expect(mock_cloned_svg.getAttribute(`font-family`)).toBe(`sans-serif`)
      expect(mock_cloned_svg.getAttribute(`style`)).toContain(`font-family:sans-serif`)
      expect(mock_svg.cloneNode).toHaveBeenCalledWith(true)
    })

    it(`preserves existing font-family`, () => {
      const mock_svg = create_mock_svg()
      const mock_cloned_svg = create_mock_svg()
      mock_cloned_svg.setAttribute(`style`, `color: red; font-family: Arial;`)
      mock_svg.cloneNode = vi.fn(() => mock_cloned_svg)
      export_svg_as_svg(mock_svg, `f.svg`)
      expect(mock_cloned_svg.getAttribute(`style`)).toBe(
        `color: red; font-family: Arial;`,
      )
    })

    it(`handles null SVG`, () => {
      const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
      export_svg_as_svg(null, `f.svg`)
      expect(warn).toHaveBeenCalledWith(`SVG element not found for export`)
      expect(mock_download).not.toHaveBeenCalled()
      warn.mockRestore()
    })

    it(`handles serialization errors`, () => {
      const mock_svg = create_mock_svg()
      const mock_cloned_svg = create_mock_svg()
      mock_svg.cloneNode = vi.fn(() => mock_cloned_svg)
      mock_xml_serializer.serializeToString.mockImplementation(() => {
        throw new Error(`fail`)
      })
      const err = vi.spyOn(console, `error`).mockImplementation(() => {})
      export_svg_as_svg(mock_svg, `f.svg`)
      expect(err).toHaveBeenCalledWith(`Error exporting SVG:`, expect.any(Error))
      expect(mock_download).not.toHaveBeenCalled()
      err.mockRestore()
    })
  })

  describe(`SVG to PNG export`, () => {
    let mock_svg: SVGElement
    let mock_cloned_svg: SVGElement
    let mock_canvas: HTMLCanvasElement
    let mock_context: CanvasRenderingContext2D
    let mock_image: HTMLImageElement
    let mock_xml_serializer: { serializeToString: ReturnType<typeof vi.fn> }

    beforeEach(() => {
      mock_svg = create_mock_svg()
      mock_cloned_svg = create_mock_svg()
      mock_svg.cloneNode = vi.fn(() => mock_cloned_svg)
      mock_canvas = create_mock_canvas()
      mock_context = {
        clearRect: vi.fn(),
        drawImage: vi.fn(),
      } as unknown as CanvasRenderingContext2D
      mock_canvas.getContext = vi.fn(() =>
        mock_context
      ) as unknown as HTMLCanvasElement[`getContext`]
      mock_image = create_mock_image()
      mock_xml_serializer = { serializeToString: vi.fn(() => `<svg></svg>`) }
      globalThis.XMLSerializer = vi.fn(() =>
        mock_xml_serializer
      ) as unknown as typeof XMLSerializer
      globalThis.document.createElement = vi.fn((tag) =>
        tag === `canvas`
          ? mock_canvas
          : tag === `img`
          ? mock_image
          : document.createElement(tag)
      ) as typeof document.createElement
      globalThis.Image = vi.fn(() => mock_image) as unknown as typeof Image
    })

    it(`exports PNG with correct dimensions and DPI`, () => {
      export_svg_as_png(mock_svg, `f.png`, 150)
      expect(mock_canvas.width).toBe(208)
      expect(mock_canvas.height).toBe(208)
      expect(mock_image.src).toMatch(/^data:image\/svg\+xml;base64,/)
      mock_image.onload?.call(mock_image, new Event(`load`))
      expect(mock_context.clearRect).toHaveBeenCalledWith(0, 0, 208, 208)
      expect(mock_context.drawImage).toHaveBeenCalledWith(mock_image, 0, 0, 208, 208)
      expect(mock_canvas.toBlob).toHaveBeenCalled()
      expect(mock_download).toHaveBeenCalledWith(expect.any(Blob), `f.png`, `image/png`)
      expect(mock_cloned_svg.getAttribute(`font-family`)).toBe(`sans-serif`)
    })

    it.each([
      { dpi: undefined, width: 208, height: 208 },
      { dpi: 300, width: 417, height: 417 },
      { dpi: 144, width: 200, height: 200 },
    ])(`uses DPI $dpi correctly`, ({ dpi, width, height }) => {
      export_svg_as_png(mock_svg, `f.png`, dpi)
      expect(mock_canvas.width).toBe(width)
      expect(mock_canvas.height).toBe(height)
    })

    it.each([
      { svg: null, warn_msg: `SVG element not found for PNG export` },
      {
        svg: create_mock_svg(),
        warn_msg: `SVG viewBox not found for PNG export`,
        setup: (svg: SVGElement) => svg.removeAttribute(`viewBox`),
      },
      {
        svg: create_mock_svg(`0 0 0 0`),
        warn_msg: `Invalid SVG dimensions for PNG export`,
      },
      {
        svg: create_mock_svg(),
        warn_msg: `Canvas 2D context not available for PNG export`,
        setup: () => {
          mock_canvas.getContext = vi.fn(() =>
            null
          ) as unknown as HTMLCanvasElement[`getContext`]
        },
      },
    ])(`handles SVG issues: $warn_msg`, ({ svg, warn_msg, setup }) => {
      if (setup && svg) setup(svg)
      const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
      export_svg_as_png(svg as SVGElement | null, `f.png`)
      expect(warn).toHaveBeenCalledWith(warn_msg)
      expect(mock_download).not.toHaveBeenCalled()
      warn.mockRestore()
    })

    it(`handles image load error`, () => {
      const err = vi.spyOn(console, `error`).mockImplementation(() => {})
      export_svg_as_png(mock_svg, `f.png`, 150)
      if (typeof mock_image.onerror === `function`) {
        mock_image.onerror.call(mock_image, new Event(`error`))
      }
      expect(err).toHaveBeenCalledWith(`Failed to load SVG for PNG export`)
      expect(mock_download).not.toHaveBeenCalled()
      err.mockRestore()
    })

    it(`handles toBlob null`, () => {
      mock_canvas.toBlob = vi.fn((cb: (b: Blob | null) => void) =>
        cb(null)
      ) as unknown as (HTMLCanvasElement & { __customRenderer?: unknown })[`toBlob`]
      const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
      export_svg_as_png(mock_svg, `f.png`)
      mock_image.onload?.call(mock_image, new Event(`load`))
      expect(warn).toHaveBeenCalledWith(`Failed to generate PNG blob`)
      expect(mock_download).not.toHaveBeenCalled()
      warn.mockRestore()
    })

    it(`handles drawImage error`, () => {
      const error = new Error(`Draw failed`)
      mock_context.drawImage = vi.fn(() => {
        throw error
      })
      const err = vi.spyOn(console, `error`).mockImplementation(() => {})
      export_svg_as_png(mock_svg, `f.png`)
      mock_image.onload?.call(mock_image, new Event(`load`))
      expect(err).toHaveBeenCalledWith(`Error during PNG generation:`, error)
      expect(mock_download).not.toHaveBeenCalled()
      err.mockRestore()
    })

    it(`handles non-integer dimensions`, () => {
      mock_svg.setAttribute(`viewBox`, `0 0 50.5 75.3`)
      export_svg_as_png(mock_svg, `f.png`, 144)
      expect(mock_canvas.width).toBe(101)
      expect(mock_canvas.height).toBe(151)
    })
  })
})
