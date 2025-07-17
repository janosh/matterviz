import type { AnyStructure } from '$lib'
import { electro_neg_formula } from '$lib'
import { download } from '$lib/mp-api'
import type * as THREE from 'three'
import { Vector2, WebGLRenderer } from 'three'

export interface CanvasWithRenderer extends HTMLCanvasElement {
  __customRenderer?: WebGLRenderer
}

// Generate a filename for structure exports based on structure metadata
export function create_structure_filename(
  structure: AnyStructure | undefined,
  extension: string,
): string {
  if (!structure) return `structure.${extension}`

  const parts: string[] = []

  if (structure.id) parts.push(structure.id) // Add ID if available

  // Add formula
  const formula_html = electro_neg_formula(structure)
  if (formula_html && formula_html !== `Unknown`) {
    const formula_plain = formula_html.replace(/<\/?sub>/g, ``)
    parts.push(formula_plain)
  }

  // Add space group if available
  if (
    `symmetry` in structure &&
    structure.symmetry &&
    typeof structure.symmetry === `object` &&
    `space_group_symbol` in structure.symmetry
  ) parts.push(String(structure.symmetry.space_group_symbol))

  // Add lattice system if available
  if (
    `lattice` in structure &&
    structure.lattice &&
    typeof structure.lattice === `object` &&
    `lattice_system` in structure.lattice
  ) parts.push(String(structure.lattice.lattice_system))

  // Add number of sites
  if (structure.sites?.length) parts.push(`${structure.sites.length}sites`)

  const base_name = parts.length > 0 ? parts.join(`_`) : `structure`
  return `${base_name}.${extension}`
}

// Generate XYZ content string without saving
export function structure_to_xyz_str(structure?: AnyStructure): string {
  if (!structure?.sites) throw new Error(`No structure or sites to export`)

  const lines: string[] = []

  // First line: number of atoms
  lines.push(String(structure.sites.length))

  // Second line: comment (structure ID, formula, or default)
  const comment_parts: string[] = []
  if (structure.id) comment_parts.push(structure.id)
  const formula = electro_neg_formula(structure)
  if (formula && formula !== `Unknown`) comment_parts.push(formula)
  const comment = comment_parts.length > 0
    ? comment_parts.join(` `)
    : `Generated from structure`
  lines.push(comment)

  // Atom lines: element symbol followed by x, y, z coordinates
  for (const site of structure.sites) {
    // Extract element symbol from species
    let element_symbol = `X` // default fallback
    if (
      site.species &&
      Array.isArray(site.species) &&
      site.species.length > 0
    ) {
      // species is an array of Species objects with element property
      const first_species = site.species[0]
      if (
        first_species && `element` in first_species && first_species.element
      ) {
        element_symbol = first_species.element
      }
    }

    // Get coordinates - prefer abc (fractional) converted to cartesian, fallback to xyz
    let coords: number[]
    if (site.xyz && Array.isArray(site.xyz) && site.xyz.length >= 3) {
      coords = site.xyz.slice(0, 3)
    } else if (
      site.abc &&
      Array.isArray(site.abc) &&
      site.abc.length >= 3 &&
      `lattice` in structure &&
      structure.lattice
    ) {
      // Convert fractional coordinates to cartesian
      const [a, b, c] = site.abc
      const lattice = structure.lattice
      if (
        lattice.matrix &&
        Array.isArray(lattice.matrix) &&
        lattice.matrix.length >= 3
      ) {
        coords = [
          a * lattice.matrix[0][0] +
          b * lattice.matrix[1][0] +
          c * lattice.matrix[2][0],
          a * lattice.matrix[0][1] +
          b * lattice.matrix[1][1] +
          c * lattice.matrix[2][1],
          a * lattice.matrix[0][2] +
          b * lattice.matrix[1][2] +
          c * lattice.matrix[2][2],
        ]
      } else {
        coords = [0, 0, 0] // fallback
      }
    } else {
      coords = [0, 0, 0] // fallback
    }

    // Format coordinates to reasonable precision
    const [x, y, z] = coords.map((coord) => coord.toFixed(6))
    lines.push(`${element_symbol} ${x} ${y} ${z}`)
  }

  return lines.join(`\n`)
}

// Generate JSON content string without saving
export function structure_to_json_str(structure?: AnyStructure): string {
  if (!structure) throw new Error(`No structure to export`)
  return JSON.stringify(structure, null, 2)
}

// Copy text to clipboard
export async function copy_to_clipboard(text: string): Promise<void> {
  if (!navigator.clipboard) throw new Error(`Clipboard API not available`)
  await navigator.clipboard.writeText(text)
}

// Export structure as XYZ format. Format specification:
// - Line 1: Number of atoms
// - Line 2: Comment line (structure ID, formula, etc.)
// - Remaining lines: Element symbol followed by x, y, z coordinates (in Angstroms)
export function export_structure_as_xyz(structure?: AnyStructure): void {
  try {
    const xyz_content = structure_to_xyz_str(structure)
    const filename = create_structure_filename(structure, `xyz`)
    download(xyz_content, filename, `text/plain`)
  } catch (error) {
    console.error(`Error exporting XYZ:`, error)
  }
}

// Export structure in pymatgen JSON format
export function export_structure_as_json(structure?: AnyStructure): void {
  try {
    const data = structure_to_json_str(structure)
    const filename = create_structure_filename(structure, `json`)
    download(data, filename, `application/json`)
  } catch (error) {
    console.error(`Error exporting JSON:`, error)
  }
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
