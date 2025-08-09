import type { AnyStructure } from '$lib'
import { download } from '$lib/io/fetch'
import { create_structure_filename } from '$lib/structure/export'
import type * as THREE from 'three'
import { Vector2, WebGLRenderer } from 'three'

export interface CanvasWithRenderer extends HTMLCanvasElement {
  __customRenderer?: WebGLRenderer
}

// Export structure as PNG image from canvas
export function export_canvas_as_png(
  canvas: HTMLCanvasElement | null,
  structure: AnyStructure | undefined,
  png_dpi = 150,
  scene: THREE.Scene | null = null,
  camera: THREE.Camera | null = null,
): void {
  try {
    if (!canvas) {
      if (typeof window !== `undefined`) {
        console.warn(`Canvas not found for PNG export`)
      }
      return
    }

    // Convert DPI to multiplier (72 DPI is baseline web resolution)
    const resolution_multiplier = png_dpi / 72
    const renderer = (canvas as CanvasWithRenderer).__customRenderer

    if (resolution_multiplier <= 1.1 || !renderer) {
      // Direct capture at current resolution (if DPI is close to 72 or renderer not available)
      try {
        canvas.toBlob((blob) => {
          if (blob) {
            const filename = create_structure_filename(structure, `png`)
            download(blob, filename, `image/png`)
          } else {
            if (typeof window !== `undefined`) {
              console.warn(`Failed to generate PNG - canvas may be empty`)
            }
          }
        }, `image/png`)
      } catch (error) {
        console.error(`Error during PNG export:`, error)
      }
      return
    }

    // Temporarily modify the renderer's pixel ratio for high-res capture
    const original_pixel_ratio = renderer.getPixelRatio()
    const original_size = renderer.getSize(new Vector2())

    try {
      // Set higher pixel ratio to increase rendering resolution
      renderer.setPixelRatio(resolution_multiplier)

      // Force the canvas to update its resolution
      renderer.setSize(original_size.width, original_size.height, false)

      if (scene && camera) {
        renderer.render(scene, camera)
      }

      // Capture the high-resolution render after paint completion
      canvas.toBlob((blob) => {
        // Restore original settings immediately
        renderer.setPixelRatio(original_pixel_ratio)
        renderer.setSize(original_size.width, original_size.height, false)

        if (blob) {
          const filename = create_structure_filename(structure, `png`)
          download(blob, filename, `image/png`)
        } else {
          if (typeof window !== `undefined`) {
            console.warn(`Failed to generate high-resolution PNG`)
          }
        }
      }, `image/png`)
    } catch (error) {
      console.error(`Error during high-res rendering:`, error)
      // Restore original settings
      renderer.setPixelRatio(original_pixel_ratio)
      renderer.setSize(original_size.width, original_size.height, false)
      if (typeof window !== `undefined`) {
        console.warn(
          `Failed to render at high resolution: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    }
  } catch (error) {
    console.error(`Error exporting PNG:`, error)
  }
}

// Helper to ensure font-family is set on SVG root
function set_svg_font_family(svg: SVGElement) {
  const style = svg.getAttribute(`style`) || ``
  if (!/font-family/.test(style)) {
    svg.setAttribute(`style`, `${style};font-family:sans-serif;`)
  }
  // Also set as attribute for extra robustness
  svg.setAttribute(`font-family`, `sans-serif`)
}

// Export SVG element as SVG file
export function export_svg_as_svg(
  svg_element: SVGElement | null,
  filename: string,
): void {
  try {
    if (!svg_element) {
      console.warn(`SVG element not found for export`)
      return
    }

    // Clone the SVG to avoid modifying the original
    const cloned_svg = svg_element.cloneNode(true) as SVGElement

    // Ensure the SVG has proper dimensions and viewBox
    const viewBox = svg_element.getAttribute(`viewBox`)
    if (viewBox) {
      cloned_svg.setAttribute(`viewBox`, viewBox)
    }

    // Ensure font-family is set
    set_svg_font_family(cloned_svg)

    // Convert SVG to string
    const svg_string = new XMLSerializer().serializeToString(cloned_svg)

    // Add XML declaration and DOCTYPE for proper SVG format
    const svg_content =
      `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n${svg_string}`

    download(svg_content, filename, `image/svg+xml`)
  } catch (error) {
    console.error(`Error exporting SVG:`, error)
  }
}

// Export SVG element as PNG by converting to canvas
export function export_svg_as_png(
  svg_element: SVGElement | null,
  filename: string,
  png_dpi = 150,
): void {
  try {
    if (!svg_element) {
      console.warn(`SVG element not found for PNG export`)
      return
    }

    // Get SVG dimensions
    const viewBox = svg_element.getAttribute(`viewBox`)
    if (!viewBox) {
      console.warn(`SVG viewBox not found for PNG export`)
      return
    }

    const [, , width, height] = viewBox.split(` `).map(Number)
    if (!width || !height) {
      console.warn(`Invalid SVG dimensions for PNG export`)
      return
    }

    // Convert DPI to pixel dimensions
    const resolution_multiplier = png_dpi / 72
    const pixel_width = Math.round(width * resolution_multiplier)
    const pixel_height = Math.round(height * resolution_multiplier)

    // Create a canvas for rendering
    const canvas = document.createElement(`canvas`)
    const ctx = canvas.getContext(`2d`)
    if (!ctx) {
      console.warn(`Canvas 2D context not available for PNG export`)
      return
    }

    // Set canvas dimensions
    canvas.width = pixel_width
    canvas.height = pixel_height

    // Clone and patch SVG for font-family
    const cloned_svg = svg_element.cloneNode(true) as SVGElement
    set_svg_font_family(cloned_svg)

    // Convert SVG to data URL to avoid tainted canvas issues
    const svg_string = new XMLSerializer().serializeToString(cloned_svg)
    const svg_data_url = `data:image/svg+xml;base64,${
      btoa(unescape(encodeURIComponent(svg_string)))
    }`

    // Create an image element to load the SVG
    const img = new Image()
    img.onload = () => {
      try {
        ctx.clearRect(0, 0, pixel_width, pixel_height)
        ctx.drawImage(img, 0, 0, pixel_width, pixel_height)
        canvas.toBlob(
          (blob) => {
            if (blob) download(blob, filename, `image/png`)
            else console.warn(`Failed to generate PNG blob`)
          },
          `image/png`,
          1, // set max PNG quality
        )
      } catch (error) {
        console.error(`Error during PNG generation:`, error)
      }
    }
    img.onerror = () => {
      console.error(`Failed to load SVG for PNG export`)
    }
    img.src = svg_data_url
  } catch (error) {
    console.error(`Error exporting PNG:`, error)
  }
}
